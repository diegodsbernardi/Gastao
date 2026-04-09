import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────

export interface NotaFiscal {
    id: string;
    restaurante_id: string;
    numero_nota: string | null;
    fornecedor_nome: string | null;
    fornecedor_cnpj: string | null;
    data_emissao: string | null;
    valor_total: number | null;
    xml_url: string | null;
    status: 'pendente' | 'confirmada' | 'cancelada';
    criado_em: string;
}

export interface NfeItem {
    id: string;
    nota_fiscal_id: string;
    restaurante_id: string;
    codigo_produto: string | null;
    descricao_xml: string;
    quantidade: number;
    unidade: string;
    valor_unitario: number;
    valor_total: number;
    insumo_sugerido_id: string | null;
    insumo_confirmado_id: string | null;
    confianca_match: number | null;
    status: 'pendente' | 'vinculado' | 'ignorado' | 'novo_insumo';
    criado_em: string;
}

export interface CriarInsumoData {
    name: string;
    unit_type: string;
    type: string;
    avg_cost_per_unit: number;
    stock_quantity: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getEdgeFunctionUrl(name: string): string {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    return `${url}/functions/v1/${name}`;
}

async function getAuthToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Usuário não autenticado');
    return session.access_token;
}

async function getRestauranteId(): Promise<string> {
    const { data, error } = await supabase.rpc('get_my_membership');
    if (error || !data || data.length === 0) throw new Error('Restaurante não encontrado');
    return data[0].restaurante_id as string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Faz upload do XML, parseia, executa matching com IA e salva no banco.
 * Retorna o ID da nota fiscal criada.
 */
export async function uploadNfeXml(file: File): Promise<string> {
    const token = await getAuthToken();
    const restauranteId = await getRestauranteId();

    // 1. Upload do arquivo para o Storage
    const fileName = `${restauranteId}/${Date.now()}_${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('nfe-xml')
        .upload(fileName, file, { contentType: 'application/xml', upsert: false });

    if (uploadError) throw new Error('Erro ao fazer upload do XML: ' + uploadError.message);
    const xmlUrl = uploadData.path;

    // 2. Parsing do XML via Edge Function
    const formData = new FormData();
    formData.append('file', file);

    const parseRes = await fetch(getEdgeFunctionUrl('parse-nfe'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    });

    if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({ error: 'Erro desconhecido no parsing' }));
        throw new Error(err.error ?? 'Erro ao processar NF-e');
    }

    const { nota, itens } = await parseRes.json();

    // 3. Matching com IA
    type AIMatch = { item_index: number; insumo_id: string | null; confianca: number };
    let matches: AIMatch[] = [];

    const matchRes = await fetch(getEdgeFunctionUrl('match-nfe-items'), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itens, restaurant_id: restauranteId }),
    });

    if (matchRes.ok) {
        const matchData = await matchRes.json();
        matches = matchData.matches ?? [];
    }

    // 4. Insere nota fiscal
    const { data: notaData, error: notaError } = await supabase
        .from('notas_fiscais')
        .insert({
            restaurante_id: restauranteId,
            numero_nota: nota.numero || null,
            fornecedor_nome: nota.fornecedor_nome || null,
            fornecedor_cnpj: nota.fornecedor_cnpj || null,
            data_emissao: nota.data_emissao || null,
            valor_total: nota.valor_total || null,
            xml_url: xmlUrl,
            status: 'pendente',
        })
        .select('id')
        .single();

    if (notaError || !notaData) throw new Error('Erro ao salvar nota fiscal: ' + notaError?.message);
    const notaId = notaData.id as string;

    // 5. Insere itens com sugestões da IA
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itensParaInserir = itens.map((item: any, index: number) => {
        const match = matches.find(m => m.item_index === index);
        const temMatch = match && match.insumo_id && match.confianca >= 0.5;
        return {
            nota_fiscal_id: notaId,
            restaurante_id: restauranteId,
            codigo_produto: item.codigo_produto || null,
            descricao_xml: item.descricao,
            quantidade: item.quantidade,
            unidade: item.unidade,
            valor_unitario: item.valor_unitario,
            valor_total: item.valor_total,
            insumo_sugerido_id: temMatch ? match!.insumo_id : null,
            insumo_confirmado_id: null,
            confianca_match: match ? match.confianca : null,
            status: 'pendente',
        };
    });

    const { error: itensError } = await supabase.from('nfe_itens').insert(itensParaInserir);
    if (itensError) throw new Error('Erro ao salvar itens da nota: ' + itensError.message);

    return notaId;
}

/** Confirma a nota, atualizando estoque e custos dos insumos vinculados. */
export async function confirmarNfe(notaId: string): Promise<number> {
    const { data, error } = await supabase.rpc('confirmar_nfe', { p_nota_fiscal_id: notaId });
    if (error) throw new Error('Erro ao confirmar nota: ' + error.message);
    return data as number;
}

/** Vincula um item da NF-e a um insumo e marca como 'vinculado'. */
export async function confirmarItem(itemId: string, insumoId: string): Promise<void> {
    const { error } = await supabase
        .from('nfe_itens')
        .update({ insumo_confirmado_id: insumoId, status: 'vinculado' })
        .eq('id', itemId);
    if (error) throw new Error('Erro ao confirmar item: ' + error.message);
}

/** Marca um item como ignorado. */
export async function ignorarItem(itemId: string): Promise<void> {
    const { error } = await supabase
        .from('nfe_itens')
        .update({ status: 'ignorado' })
        .eq('id', itemId);
    if (error) throw new Error('Erro ao ignorar item: ' + error.message);
}

/** Cria um novo insumo a partir dos dados do item da NF-e e o vincula. */
export async function criarInsumoDeNfe(itemId: string, dadosInsumo: CriarInsumoData): Promise<void> {
    const restauranteId = await getRestauranteId();

    const { data: insumo, error: insumoError } = await supabase
        .from('ingredients')
        .insert({ ...dadosInsumo, restaurant_id: restauranteId })
        .select('id')
        .single();

    if (insumoError || !insumo) throw new Error('Erro ao criar insumo: ' + insumoError?.message);

    // Vincula o item ao insumo recém-criado e marca como novo_insumo
    const { error } = await supabase
        .from('nfe_itens')
        .update({ insumo_confirmado_id: insumo.id, status: 'novo_insumo' })
        .eq('id', itemId);
    if (error) throw new Error('Erro ao vincular item ao novo insumo: ' + error.message);
}
