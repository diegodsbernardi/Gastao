import { supabase } from './supabase';

// Alertas de variação de custo de insumo (gerados pelo confirmar_nfe, migration 030)

export interface FichaAfetada {
    id: string;
    nome: string;
}

export interface CmvAlerta {
    id: string;
    restaurante_id: string;
    insumo_id: string;
    nota_fiscal_id: string | null;
    custo_antes: number;
    custo_depois: number;
    variacao_pct: number;
    fichas_afetadas: FichaAfetada[];
    status: 'novo' | 'visto';
    criado_em: string;
    ingredients: { name: string; unit_type: string } | null;
}

/** Alertas ainda não vistos, mais recentes primeiro. */
export async function getAlertasNovos(): Promise<CmvAlerta[]> {
    const { data, error } = await supabase
        .from('cmv_alertas')
        .select('*, ingredients(name, unit_type)')
        .eq('status', 'novo')
        .order('criado_em', { ascending: false });
    if (error) throw new Error('Erro ao carregar alertas: ' + error.message);
    return (data ?? []) as CmvAlerta[];
}

/** Marca um alerta como visto (some do painel). */
export async function marcarAlertaVisto(id: string): Promise<void> {
    const { error } = await supabase
        .from('cmv_alertas')
        .update({ status: 'visto' })
        .eq('id', id);
    if (error) throw new Error('Erro ao marcar alerta: ' + error.message);
}
