import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
    downloadTemplate,
    parseGastaoTemplate,
    topoSortPreparos,
    UNIDADES,
    type ParsedTemplate,
    type Unidade,
} from '../lib/gastaoTemplate';
import { Loader2, UploadCloud, CheckCircle2, AlertTriangle, Download } from 'lucide-react';

// Conversão entre unidades da mesma família (kg↔g, l↔ml). Outras families: identidade se unidades iguais.
const convertUnit = (qty: number, from: string, to: string): number | null => {
    if (!from || !to || from === to) return qty;
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (f === 'g' && t === 'kg') return qty / 1000;
    if (f === 'kg' && t === 'g') return qty * 1000;
    if (f === 'ml' && t === 'l') return qty / 1000;
    if (f === 'l' && t === 'ml') return qty * 1000;
    return null;
};

const normKey = (s: string) => s.trim().toLowerCase();

interface ImportSummary {
    insumosNovos: number;
    preparosNovos: number;
    fichasNovas: number;
    compPreparosLinhas: number;
    compFichasLinhas: number;
    pulados: number;
}

export const ExcelImporter = ({ onComplete }: { onComplete: () => void }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
    const [logs, setLogs] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addLog = (msg: string) => setLogs(p => [...p, msg]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setStatus('processing');
        setLogs([]);
        addLog('📂 Lendo arquivo...');

        try {
            const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', user?.id).single();
            const restaurantId = profile?.restaurant_id;
            if (!restaurantId) throw new Error('Usuário não vinculado a um restaurante.');

            const buf = await file.arrayBuffer();
            const workbook = XLSX.read(buf, { type: 'array' });
            addLog(`📋 Abas detectadas: ${workbook.SheetNames.join(', ')}`);

            const { parsed, errors, warnings } = parseGastaoTemplate(workbook);

            if (warnings.length > 0) {
                addLog(`\n⚠️  ${warnings.length} aviso(s):`);
                warnings.slice(0, 10).forEach(w => addLog(`   · ${w.sheet} linha ${w.row}: ${w.message}`));
                if (warnings.length > 10) addLog(`   ... e mais ${warnings.length - 10}`);
            }

            if (errors.length > 0) {
                addLog(`\n❌ ${errors.length} erro(s) na planilha — nada foi importado:`);
                errors.slice(0, 25).forEach(er => addLog(`   · ${er.sheet} linha ${er.row}: ${er.message}`));
                if (errors.length > 25) addLog(`   ... e mais ${errors.length - 25}`);
                setStatus('error');
                return;
            }

            addLog(`\n✅ Parse OK: ${parsed.categorias.length} categorias, ${parsed.insumos.length} insumos, ${parsed.preparos.length} preparos, ${parsed.fichas.length} fichas`);

            const summary = await runImport(restaurantId, parsed, addLog);

            addLog(`\n🎉 Importação concluída:`);
            addLog(`   · ${summary.insumosNovos} insumos novos`);
            addLog(`   · ${summary.preparosNovos} preparos novos`);
            addLog(`   · ${summary.fichasNovas} fichas novas`);
            addLog(`   · ${summary.compPreparosLinhas + summary.compFichasLinhas} linhas de composição`);
            if (summary.pulados > 0) addLog(`   · ${summary.pulados} item(ns) já existiam no banco`);

            setStatus('success');
            onComplete();
        } catch (err: any) {
            addLog(`\n❌ Falha: ${err.message}`);
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStatus('idle');
        setLogs([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="bg-slate-50 border-2 border-dashed border-primary-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h3 className="font-bold text-slate-900 flex items-center text-lg">
                        <UploadCloud className="w-5 h-5 mr-2 text-primary-500" />
                        Importação via Planilha-Mãe
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Template multi-segmento. Captura Insumos → Preparos → Fichas com composição.
                    </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <button
                        onClick={downloadTemplate}
                        className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 flex items-center text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4 mr-2 text-green-600" />
                        Baixar Template
                    </button>
                    {status !== 'idle' ? (
                        <button onClick={reset} className="px-4 py-2 text-sm bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300">
                            Nova Importação
                        </button>
                    ) : (
                        <>
                            <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 flex items-center text-sm shadow-sm"
                            >
                                <UploadCloud className="w-4 h-4 mr-2" />
                                Importar Planilha
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Guia das abas */}
            {status === 'idle' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {[
                        { title: '_Categorias', hint: 'Governa os tipos' },
                        { title: 'Insumos', hint: 'Ingredientes crus' },
                        { title: 'Preparos', hint: 'Mini-receitas' },
                        { title: 'Fichas', hint: 'Produtos vendidos' },
                        { title: 'Composicao_Preparos', hint: 'O que entra nos preparos' },
                        { title: 'Composicao_Fichas', hint: 'O que entra nas fichas' },
                    ].map(t => (
                        <div key={t.title} className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="font-semibold text-slate-700 text-xs mb-1 truncate">📄 {t.title}</div>
                            <div className="text-xs text-slate-400">{t.hint}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Terminal de log */}
            {status !== 'idle' && (
                <div className="bg-slate-900 rounded-lg p-4 text-xs font-mono text-green-400 h-80 overflow-y-auto shadow-inner leading-relaxed">
                    {logs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
                    {loading && (
                        <div className="flex items-center text-primary-400 mt-2">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...
                        </div>
                    )}
                    {status === 'success' && <div className="flex items-center text-green-500 font-bold mt-2"><CheckCircle2 className="w-5 h-5 mr-2" /> Concluído.</div>}
                    {status === 'error' && <div className="flex items-center text-red-500 font-bold mt-2"><AlertTriangle className="w-5 h-5 mr-2" /> Abortado.</div>}
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Pipeline de import
// ─────────────────────────────────────────────────────────────

async function runImport(
    restaurantId: string,
    parsed: ParsedTemplate,
    log: (m: string) => void,
): Promise<ImportSummary> {
    const summary: ImportSummary = {
        insumosNovos: 0,
        preparosNovos: 0,
        fichasNovas: 0,
        compPreparosLinhas: 0,
        compFichasLinhas: 0,
        pulados: 0,
    };

    // ── Carregar existentes do banco ──
    const [existIngRes, existRecRes] = await Promise.all([
        supabase.from('ingredients').select('id, name, unit_type').eq('restaurant_id', restaurantId),
        supabase.from('recipes').select('id, product_name, tipo, yield_quantity, unit_type').eq('restaurant_id', restaurantId),
    ]);
    if (existIngRes.error) throw new Error('Falha ao carregar insumos existentes: ' + existIngRes.error.message);
    if (existRecRes.error) throw new Error('Falha ao carregar receitas existentes: ' + existRecRes.error.message);

    // Mapas case-insensitive por nome
    const ingByName = new Map<string, { id: string; unit_type: string }>();
    (existIngRes.data ?? []).forEach(i => ingByName.set(normKey(i.name), { id: i.id, unit_type: i.unit_type }));

    const preparoByName = new Map<string, { id: string; yield_unit: string }>();
    const fichaByName = new Map<string, { id: string }>();
    (existRecRes.data ?? []).forEach(r => {
        if (r.tipo === 'preparo') preparoByName.set(normKey(r.product_name), { id: r.id, yield_unit: r.unit_type ?? 'un' });
        else fichaByName.set(normKey(r.product_name), { id: r.id });
    });

    // ── 1) Inserir Insumos novos ──
    const insumosNovos = parsed.insumos.filter(i => !ingByName.has(normKey(i.nome)));
    const insumosPulados = parsed.insumos.length - insumosNovos.length;
    summary.pulados += insumosPulados;

    if (insumosNovos.length > 0) {
        log(`\n🔄 Inserindo ${insumosNovos.length} insumos...`);
        const { data, error } = await supabase.from('ingredients').insert(
            insumosNovos.map(i => ({
                restaurant_id: restaurantId,
                name: i.nome,
                tipo: i.tipoInsumo,
                categoria: i.categoria,
                unit_type: i.unidade,
                avg_cost_per_unit: i.preco,
                aproveitamento: i.aproveitamento,
                stock_quantity: 0,
                use_in_recipes: i.tipoInsumo !== 'insumo_direto' ? true : false,
            }))
        ).select('id, name, unit_type');
        if (error) throw new Error('Erro ao inserir insumos: ' + error.message);
        (data ?? []).forEach(i => ingByName.set(normKey(i.name), { id: i.id, unit_type: i.unit_type }));
        summary.insumosNovos = data?.length ?? 0;
        log(`   ✅ +${summary.insumosNovos} insumos`);
    }

    // ── 2) Topological sort dos preparos ──
    // Dependências: preparo X depende de preparo Y se há linha em compPreparos com Preparo=X, Componente=preparo, Item=Y
    const preparoNames = parsed.preparos.map(p => p.nome);
    const preparoNameSet = new Set(preparoNames.map(normKey));
    const knownPreparos = new Set([...preparoNameSet, ...Array.from(preparoByName.keys())]);

    const deps: Record<string, string[]> = {};
    preparoNames.forEach(n => { deps[n] = []; });

    for (const c of parsed.compPreparos) {
        if (c.componente !== 'preparo') continue;
        const parentKey = normKey(c.preparo);
        if (!preparoNameSet.has(parentKey)) continue; // erro tratado abaixo
        if (!knownPreparos.has(normKey(c.item))) continue; // erro tratado abaixo
        // só mapeia deps entre preparos DESTE arquivo; preparos já no banco são "resolvidos"
        if (preparoNameSet.has(normKey(c.item))) {
            // achar o nome canonico (da aba Preparos) em vez do normalizado
            const canonical = parsed.preparos.find(p => normKey(p.nome) === normKey(c.item))!.nome;
            const parentCanonical = parsed.preparos.find(p => normKey(p.nome) === parentKey)!.nome;
            if (!deps[parentCanonical].includes(canonical)) deps[parentCanonical].push(canonical);
        }
    }

    const { order, cycles } = topoSortPreparos(preparoNames, deps);
    if (cycles.length > 0) {
        log(`\n❌ Ciclos detectados nos preparos — import abortado:`);
        cycles.forEach(c => log(`   · ${c.join(' → ')}`));
        throw new Error(`${cycles.length} ciclo(s) de preparos detectados. Ajuste a planilha.`);
    }

    // ── 3) Validar referências das composições ──
    const errs: string[] = [];
    for (const c of parsed.compPreparos) {
        if (!preparoNameSet.has(normKey(c.preparo)) && !preparoByName.has(normKey(c.preparo))) {
            errs.push(`Composicao_Preparos: preparo "${c.preparo}" não existe em Preparos nem no banco.`);
        }
        if (c.componente === 'insumo' && !ingByName.has(normKey(c.item))) {
            errs.push(`Composicao_Preparos: insumo "${c.item}" não existe em Insumos nem no banco.`);
        }
        if (c.componente === 'preparo' && !preparoNameSet.has(normKey(c.item)) && !preparoByName.has(normKey(c.item))) {
            errs.push(`Composicao_Preparos: preparo "${c.item}" referenciado por "${c.preparo}" não existe.`);
        }
    }
    for (const c of parsed.compFichas) {
        if (!parsed.fichas.some(f => normKey(f.nome) === normKey(c.ficha)) && !fichaByName.has(normKey(c.ficha))) {
            errs.push(`Composicao_Fichas: ficha "${c.ficha}" não existe em Fichas nem no banco.`);
        }
        if (c.componente === 'insumo' && !ingByName.has(normKey(c.item))) {
            errs.push(`Composicao_Fichas: insumo "${c.item}" não existe.`);
        }
        if (c.componente === 'preparo' && !preparoNameSet.has(normKey(c.item)) && !preparoByName.has(normKey(c.item))) {
            errs.push(`Composicao_Fichas: preparo "${c.item}" não existe.`);
        }
    }

    if (errs.length > 0) {
        log(`\n❌ Referências inválidas nas composições — import abortado:`);
        errs.slice(0, 15).forEach(e => log(`   · ${e}`));
        if (errs.length > 15) log(`   ... e mais ${errs.length - 15}`);
        throw new Error(`${errs.length} referência(s) inválida(s).`);
    }

    // ── 4) Inserir Preparos em ordem topológica ──
    const preparoByCanonical = new Map(parsed.preparos.map(p => [p.nome, p]));
    const preparosNovos = order.filter(n => !preparoByName.has(normKey(n)));

    if (preparosNovos.length > 0) {
        log(`\n🔄 Inserindo ${preparosNovos.length} preparos em ordem topológica...`);
        // Insere em lote (ordem não importa pro insert em si; a dependência só mata a composição)
        const { data, error } = await supabase.from('recipes').insert(
            preparosNovos.map(n => {
                const p = preparoByCanonical.get(n)!;
                return {
                    restaurant_id: restaurantId,
                    product_name: p.nome,
                    tipo: 'preparo' as const,
                    category: p.categoria,
                    sale_price: 0,
                    yield_quantity: p.rendimentoQtd,
                    unit_type: p.rendimentoUnidade,
                };
            })
        ).select('id, product_name, unit_type');
        if (error) throw new Error('Erro ao inserir preparos: ' + error.message);
        (data ?? []).forEach(r => preparoByName.set(normKey(r.product_name), { id: r.id, yield_unit: r.unit_type ?? 'un' }));
        summary.preparosNovos = data?.length ?? 0;
        log(`   ✅ +${summary.preparosNovos} preparos`);
    }
    summary.pulados += parsed.preparos.length - preparosNovos.length;

    // ── 5) Inserir composição dos Preparos (somente dos que foram inseridos nesta run) ──
    // Insumos vão em recipe_ingredients; sub-preparos vão em recipe_sub_recipes
    // (tabela canônica do app — Recipes.tsx lê de lá).
    const preparoRiRows: any[] = [];
    const preparoRsrRows: any[] = [];
    for (const c of parsed.compPreparos) {
        const parentKey = normKey(c.preparo);
        // só grava composição de preparo novo (existente no banco presumidamente já tem)
        if (!preparosNovos.some(n => normKey(n) === parentKey)) continue;
        const parentId = preparoByName.get(parentKey)!.id;

        if (c.componente === 'insumo') {
            const ing = ingByName.get(normKey(c.item))!;
            const qty = convertUnit(c.quantidade, c.unidade || ing.unit_type, ing.unit_type);
            if (qty === null) {
                throw new Error(`Unidade incompatível: "${c.item}" é ${ing.unit_type}, mas composição usa "${c.unidade}". Preparo: ${c.preparo}.`);
            }
            preparoRiRows.push({
                recipe_id: parentId,
                ingredient_id: ing.id,
                quantity_needed: qty,
                unit: ing.unit_type,
            });
        } else {
            const sub = preparoByName.get(normKey(c.item))!;
            preparoRsrRows.push({
                recipe_id: parentId,
                sub_recipe_id: sub.id,
                quantity_needed: c.quantidade,
            });
        }
    }

    if (preparoRiRows.length > 0) {
        log(`\n🔄 Inserindo ${preparoRiRows.length} insumos em preparos...`);
        const chunkSize = 500;
        for (let i = 0; i < preparoRiRows.length; i += chunkSize) {
            const chunk = preparoRiRows.slice(i, i + chunkSize);
            const { error } = await supabase.from('recipe_ingredients').insert(chunk);
            if (error) throw new Error('Erro em composição de preparos: ' + error.message);
        }
        log(`   ✅ +${preparoRiRows.length} linhas`);
    }

    if (preparoRsrRows.length > 0) {
        log(`🔄 Inserindo ${preparoRsrRows.length} sub-preparos (preparo→preparo)...`);
        const chunkSize = 500;
        for (let i = 0; i < preparoRsrRows.length; i += chunkSize) {
            const chunk = preparoRsrRows.slice(i, i + chunkSize);
            const { error } = await supabase.from('recipe_sub_recipes').insert(chunk);
            if (error) throw new Error('Erro em sub-preparos: ' + error.message);
        }
        log(`   🔗 +${preparoRsrRows.length} linhas (profundidade arbitrária)`);
    }

    summary.compPreparosLinhas = preparoRiRows.length + preparoRsrRows.length;

    // ── 6) Inserir Fichas ──
    const fichasNovas = parsed.fichas.filter(f => !fichaByName.has(normKey(f.nome)));
    if (fichasNovas.length > 0) {
        log(`\n🔄 Inserindo ${fichasNovas.length} fichas...`);
        const { data, error } = await supabase.from('recipes').insert(
            fichasNovas.map(f => ({
                restaurant_id: restaurantId,
                product_name: f.nome,
                tipo: 'ficha_final' as const,
                category: f.categoria,
                sale_price: f.precoVenda,
                yield_quantity: 1,
                unit_type: f.unidadeVenda || 'un',
            }))
        ).select('id, product_name');
        if (error) throw new Error('Erro ao inserir fichas: ' + error.message);
        (data ?? []).forEach(r => fichaByName.set(normKey(r.product_name), { id: r.id }));
        summary.fichasNovas = data?.length ?? 0;
        log(`   ✅ +${summary.fichasNovas} fichas`);
    }
    summary.pulados += parsed.fichas.length - fichasNovas.length;

    // ── 7) Inserir composição das Fichas ──
    const fichaRiRows: any[] = []; // insumos diretos → recipe_ingredients
    const fichaRsrRows: any[] = []; // preparos → recipe_sub_recipes

    for (const c of parsed.compFichas) {
        const fichaKey = normKey(c.ficha);
        // só grava composição de ficha nova desta run
        if (!fichasNovas.some(f => normKey(f.nome) === fichaKey)) continue;
        const fichaId = fichaByName.get(fichaKey)!.id;

        if (c.componente === 'insumo') {
            const ing = ingByName.get(normKey(c.item))!;
            const qty = convertUnit(c.quantidade, c.unidade || ing.unit_type, ing.unit_type);
            if (qty === null) {
                throw new Error(`Unidade incompatível: "${c.item}" é ${ing.unit_type}, mas composição usa "${c.unidade}". Ficha: ${c.ficha}.`);
            }
            fichaRiRows.push({
                recipe_id: fichaId,
                ingredient_id: ing.id,
                quantity_needed: qty,
                unit: ing.unit_type,
            });
        } else {
            const sub = preparoByName.get(normKey(c.item))!;
            fichaRsrRows.push({
                recipe_id: fichaId,
                sub_recipe_id: sub.id,
                quantity_needed: c.quantidade,
            });
        }
    }

    if (fichaRiRows.length > 0) {
        log(`\n🔄 Inserindo ${fichaRiRows.length} insumos diretos em fichas...`);
        const { error } = await supabase.from('recipe_ingredients').insert(fichaRiRows);
        if (error) throw new Error('Erro em composição (insumos) das fichas: ' + error.message);
        summary.compFichasLinhas += fichaRiRows.length;
    }

    if (fichaRsrRows.length > 0) {
        log(`🔄 Inserindo ${fichaRsrRows.length} preparos em fichas...`);
        const { error } = await supabase.from('recipe_sub_recipes').insert(fichaRsrRows);
        if (error) throw new Error('Erro em composição (preparos) das fichas: ' + error.message);
        summary.compFichasLinhas += fichaRsrRows.length;
    }

    return summary;
}

// Re-export pra silenciar "unused" e deixar o tipo acessível
export type { Unidade };
export { UNIDADES };
