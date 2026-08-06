import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bike, Search, AlertTriangle, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { fmtMoney } from '../lib/format';
import { traduzErro } from '../lib/erros';
import { DecimalInput } from '../components/DecimalInput';
import { buildPreparoCostMapRecursive, type PreparoNode } from '../lib/costCalculator';

// Comissões praticadas pelo iFood. São valores de referência: o contrato de
// cada restaurante varia, por isso o campo continua editável.
const TAXA_PADRAO = { propria: 12.5, parceira: 24 } as const;

type Config = {
    modelo_entrega: 'propria' | 'parceira';
    taxa_pct: number;
    participa_campanhas: boolean;
    cupom_pct: number;
    frete_gratis: boolean;
    frete_gratis_valor: number;
};

const CONFIG_INICIAL: Config = {
    modelo_entrega: 'propria',
    taxa_pct: TAXA_PADRAO.propria,
    participa_campanhas: false,
    cupom_pct: 0,
    frete_gratis: false,
    frete_gratis_valor: 0,
};

type Ficha = {
    id: string;
    product_name: string;
    category: string;
    sale_price: number;
    sale_price_ifood: number | null;
    custo: number;
};

export const Ifood = () => {
    const { user, restauranteId } = useAuth();
    const { canEdit } = usePermissions();

    const [cfg, setCfg] = useState<Config>(CONFIG_INICIAL);
    const [fichas, setFichas] = useState<Ficha[]>([]);
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [busca, setBusca] = useState('');
    const [soNoIfood, setSoNoIfood] = useState(false);
    const [editandoPreco, setEditandoPreco] = useState<Record<string, number | ''>>({});

    useEffect(() => { if (user) carregar(); }, [user, restauranteId]);

    const carregar = async () => {
        setLoading(true);
        const [cfgRes, fichasRes, ingsRes, subsRes, prepsRes] = await Promise.all([
            supabase.from('ifood_config').select('*').maybeSingle(),
            supabase.from('recipes').select('id, product_name, category, sale_price, sale_price_ifood, yield_quantity')
                .eq('tipo', 'ficha_final').order('product_name'),
            supabase.from('recipe_ingredients').select('recipe_id, quantity_needed, ingredients(avg_cost_per_unit, aproveitamento)'),
            supabase.from('recipe_sub_recipes').select('recipe_id, sub_recipe_id, quantity_needed'),
            supabase.from('recipes').select('id, yield_quantity').eq('tipo', 'preparo'),
        ]);

        if (cfgRes.data) {
            const d = cfgRes.data as any;
            setCfg({
                modelo_entrega: d.modelo_entrega,
                taxa_pct: Number(d.taxa_pct),
                participa_campanhas: d.participa_campanhas,
                cupom_pct: Number(d.cupom_pct),
                frete_gratis: d.frete_gratis,
                frete_gratis_valor: Number(d.frete_gratis_valor),
            });
        }

        // Custo por ficha: insumos diretos + preparos resolvidos recursivamente
        // (mesma lógica da tela de Fichas — o número tem que bater com o de lá).
        const ingsPor: Record<string, any[]> = {};
        (ingsRes.data ?? []).forEach((r: any) => { if (r.ingredients) (ingsPor[r.recipe_id] ??= []).push(r); });
        const subsPor: Record<string, any[]> = {};
        (subsRes.data ?? []).forEach((r: any) => (subsPor[r.recipe_id] ??= []).push(r));

        const nodes: PreparoNode[] = (prepsRes.data ?? []).map((p: any) => ({
            id: p.id,
            yield_quantity: p.yield_quantity || 1,
            ingredients: (ingsPor[p.id] ?? []).map((i: any) => ({
                avg_cost_per_unit: i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1),
                quantity_needed: i.quantity_needed,
            })),
            subRecipes: (subsPor[p.id] ?? []).map((s: any) => ({
                sub_recipe_id: s.sub_recipe_id, quantity_needed: s.quantity_needed,
            })),
        }));
        const { costPerUnit } = buildPreparoCostMapRecursive(nodes);

        setFichas((fichasRes.data ?? []).map((f: any) => ({
            id: f.id,
            product_name: f.product_name,
            category: f.category,
            sale_price: Number(f.sale_price) || 0,
            sale_price_ifood: f.sale_price_ifood != null ? Number(f.sale_price_ifood) : null,
            custo: (ingsPor[f.id] ?? []).reduce((a, i: any) =>
                       a + (i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed, 0)
                 + (subsPor[f.id] ?? []).reduce((a, s: any) => a + (costPerUnit[s.sub_recipe_id] ?? 0) * s.quantity_needed, 0),
        })));
        setLoading(false);
    };

    // Fração do preço que NÃO chega ao restaurante (comissão + cupom).
    const descontoTotal = (cfg.taxa_pct + (cfg.participa_campanhas ? cfg.cupom_pct : 0)) / 100;
    const frete = cfg.frete_gratis ? cfg.frete_gratis_valor : 0;

    // Preço no iFood que empata a margem do salão:
    //   P·(1 - taxa - cupom) - frete - custo = precoSalao - custo
    //   P = (precoSalao + frete) / (1 - taxa - cupom)
    // O custo se cancela: o que muda o preço é a taxa, o cupom e o frete.
    const precoSugerido = (precoSalao: number) =>
        descontoTotal >= 1 ? null : (precoSalao + frete) / (1 - descontoTotal);

    // Quanto sobra de fato, dado um preço praticado.
    const liquido = (preco: number) => preco * (1 - descontoTotal) - frete;

    const salvarConfig = async () => {
        if (!restauranteId) return;
        setSalvando(true);
        const { error } = await supabase.from('ifood_config').upsert({
            restaurante_id: restauranteId, ...cfg, atualizado_em: new Date().toISOString(),
        }, { onConflict: 'restaurante_id' });
        setSalvando(false);
        if (error) return toast.error(traduzErro(error));
        toast.success('Configuração do iFood salva.');
    };

    const salvarPreco = async (ficha: Ficha) => {
        const valor = editandoPreco[ficha.id];
        if (valor === '' || valor == null) return;
        const { error } = await supabase.from('recipes')
            .update({ sale_price_ifood: Number(valor) }).eq('id', ficha.id);
        if (error) return toast.error(traduzErro(error));
        setFichas(prev => prev.map(f => f.id === ficha.id ? { ...f, sale_price_ifood: Number(valor) } : f));
        setEditandoPreco(prev => { const n = { ...prev }; delete n[ficha.id]; return n; });
        toast.success(`${ficha.product_name} atualizado no iFood.`);
    };

    const lista = useMemo(() => fichas
        .filter(f => f.product_name.toLowerCase().includes(busca.toLowerCase()))
        .filter(f => !soNoIfood || f.sale_price_ifood != null)
        .filter(f => f.sale_price > 0), [fichas, busca, soNoIfood]);

    // Produtos em que o preço praticado hoje não cobre a margem do salão.
    const abaixoDoIdeal = useMemo(() => lista.filter(f => {
        const sug = precoSugerido(f.sale_price);
        return f.sale_price_ifood != null && sug != null && f.sale_price_ifood < sug - 0.01;
    }), [lista, descontoTotal, frete]);

    if (loading) {
        return (
            <div className="max-w-6xl mx-auto space-y-4">
                {[1, 2, 3].map(n => <div key={n} className="h-32 bg-white rounded-2xl border border-slate-200 animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center">
                    <Bike className="w-5 h-5 sm:w-6 sm:h-6 mr-2.5 text-primary-500" />
                    iFood
                </h1>
                <p className="text-slate-500 mt-1 text-sm">
                    No delivery você não recebe o preço cheio. Preencha o que o iFood cobra e o
                    sistema calcula por quanto vender para manter a mesma margem do salão.
                </p>
            </div>

            {/* ── Configuração do canal ─────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-5">
                <h2 className="font-bold text-slate-900">Como funciona o seu iFood</h2>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Quem faz a entrega?</label>
                    <div className="flex flex-wrap gap-2">
                        {(['propria', 'parceira'] as const).map(modo => (
                            <button
                                key={modo}
                                disabled={!canEdit}
                                onClick={() => setCfg(c => ({ ...c, modelo_entrega: modo, taxa_pct: TAXA_PADRAO[modo] }))}
                                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                    cfg.modelo_entrega === modo
                                        ? 'bg-primary-600 text-white border-primary-600'
                                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                            >
                                {modo === 'propria' ? 'Eu entrego (~12,5%)' : 'Entrega do iFood (~24%)'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Taxa cobrada pelo iFood (%)
                        </label>
                        <DecimalInput
                            value={cfg.taxa_pct}
                            onChange={v => setCfg(c => ({ ...c, taxa_pct: v === '' ? 0 : v }))}
                            disabled={!canEdit}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                            Confira no extrato do iFood: o contrato varia de loja para loja.
                        </p>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={cfg.participa_campanhas}
                            disabled={!canEdit}
                            onChange={e => setCfg(c => ({ ...c, participa_campanhas: e.target.checked }))}
                            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                        />
                        <span className="text-sm font-medium text-slate-700">Participo de campanhas e cupons</span>
                    </label>
                    {cfg.participa_campanhas && (
                        <div className="pl-7 max-w-xs">
                            <label className="block text-sm text-slate-600 mb-1">Desconto médio que eu banco (%)</label>
                            <DecimalInput
                                value={cfg.cupom_pct}
                                onChange={v => setCfg(c => ({ ...c, cupom_pct: v === '' ? 0 : v }))}
                                disabled={!canEdit}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                            />
                        </div>
                    )}

                    <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={cfg.frete_gratis}
                            disabled={!canEdit}
                            onChange={e => setCfg(c => ({ ...c, frete_gratis: e.target.checked }))}
                            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                        />
                        <span className="text-sm font-medium text-slate-700">Ofereço frete grátis</span>
                    </label>
                    {cfg.frete_gratis && (
                        <div className="pl-7 max-w-xs">
                            <label className="block text-sm text-slate-600 mb-1">Quanto eu banco por pedido (R$)</label>
                            <DecimalInput
                                value={cfg.frete_gratis_valor}
                                onChange={v => setCfg(c => ({ ...c, frete_gratis_valor: v === '' ? 0 : v }))}
                                disabled={!canEdit}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                            />
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                    <div className="text-sm text-slate-600">
                        De cada R$ 100 vendidos, sobram para você{' '}
                        <strong className="text-slate-900">{fmtMoney(liquido(100))}</strong>
                        {frete > 0 && <span className="text-slate-500"> (já tirando o frete)</span>}
                    </div>
                    {canEdit && (
                        <button
                            onClick={salvarConfig}
                            disabled={salvando}
                            className="ml-auto px-5 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm shadow-sm"
                        >
                            {salvando ? 'Salvando...' : 'Salvar configuração'}
                        </button>
                    )}
                </div>
            </div>

            {abaixoDoIdeal.length > 0 && (
                <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900">
                        <strong>{abaixoDoIdeal.length} produto(s) com preço abaixo do ideal no iFood.</strong>{' '}
                        Neles você ganha menos por venda no delivery do que no salão. A coluna
                        "sugerido" mostra por quanto vender para empatar.
                    </div>
                </div>
            )}

            {/* ── Tabela de preços ──────────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center">
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={soNoIfood}
                            onChange={e => setSoNoIfood(e.target.checked)}
                            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                        />
                        Só os que já vendo no iFood
                    </label>
                    <div className="relative sm:ml-auto sm:w-72">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Buscar produto..."
                            value={busca}
                            onChange={e => setBusca(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                <th className="px-4 py-3 font-semibold">Produto</th>
                                <th className="px-4 py-3 font-semibold text-right">Salão</th>
                                <th className="px-4 py-3 font-semibold text-right">iFood hoje</th>
                                <th className="px-4 py-3 font-semibold text-right">Sugerido</th>
                                <th className="px-4 py-3 font-semibold text-right">Sobra por venda</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lista.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                                    Nenhum produto encontrado.
                                </td></tr>
                            )}
                            {lista.map(f => {
                                const sug = precoSugerido(f.sale_price);
                                const praticado = f.sale_price_ifood;
                                const sobra = praticado != null ? liquido(praticado) - f.custo : null;
                                const sobraSalao = f.sale_price - f.custo;
                                const abaixo = praticado != null && sug != null && praticado < sug - 0.01;
                                const emEdicao = editandoPreco[f.id] !== undefined;

                                return (
                                    <tr key={f.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{f.product_name}</div>
                                            <div className="text-xs text-slate-500">{f.category}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-700">{fmtMoney(f.sale_price)}</td>
                                        <td className="px-4 py-3 text-right">
                                            {canEdit ? (
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <DecimalInput
                                                        value={emEdicao ? editandoPreco[f.id] : (praticado ?? '')}
                                                        onChange={v => setEditandoPreco(p => ({ ...p, [f.id]: v }))}
                                                        placeholder="—"
                                                        className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 outline-none"
                                                    />
                                                    {emEdicao && (
                                                        <button
                                                            onClick={() => salvarPreco(f)}
                                                            className="px-2 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                                                        >
                                                            OK
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-slate-700">{praticado != null ? fmtMoney(praticado) : '—'}</span>
                                            )}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-semibold ${abaixo ? 'text-amber-700' : 'text-slate-900'}`}>
                                            {sug != null ? fmtMoney(sug) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {sobra != null ? (
                                                <div>
                                                    <span className={sobra < sobraSalao - 0.01 ? 'text-amber-700 font-semibold' : 'text-slate-900'}>
                                                        {fmtMoney(sobra)}
                                                    </span>
                                                    <div className="text-xs text-slate-500">salão: {fmtMoney(sobraSalao)}</div>
                                                </div>
                                            ) : <span className="text-slate-500">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
                <Info className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <div>
                    <p className="mb-1">
                        <strong className="text-slate-800">Como o sugerido é calculado:</strong> ele é o preço em que
                        a sobra por venda no iFood fica igual à do salão, depois de descontar a comissão,
                        o cupom e o frete que você banca.
                    </p>
                    <p>
                        Não é uma ordem: é o ponto de equilíbrio. Vender abaixo dele pode fazer sentido para
                        ganhar volume — desde que seja escolha sua, e não descoberta no fim do mês.
                    </p>
                </div>
            </div>
        </div>
    );
};
