import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TrendingDown, TrendingUp, AlertCircle, AlertTriangle, Check, UtensilsCrossed, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { buildPreparoCostMapRecursive, calcCMV, type PreparoNode } from '../lib/costCalculator';
import { fmtMoney } from '../lib/format';
import { CmvAlerta, getAlertasNovos, marcarAlertaVisto } from '../lib/alertas';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

interface TopProduct {
    recipe_id: string;
    product_name: string;
    sale_price: number;
    food_cost: number;
    total_sold: number;
    margin: number;
    cmv: number;
}

export const Dashboard = () => {
    const { user, restauranteId } = useAuth();
    const [loadingStats, setLoadingStats] = useState(true);
    const [totalRevenue, setTotalRevenue] = useState(0);
    const [totalUnitsSold, setTotalUnitsSold] = useState(0);
    const [stockAlerts, setStockAlerts] = useState(0);
    const [cmvPct, setCmvPct] = useState(0);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [cmvAlertas, setCmvAlertas] = useState<CmvAlerta[]>([]);
    // Custo/preço atuais por ficha — usados nos cards de alerta (CMV + sugestão de preço)
    const [fichaInfo, setFichaInfo] = useState<Record<string, { cost: number; sale_price: number }>>({});

    const now = new Date();
    const [selYear, setSelYear] = useState(now.getFullYear());
    const [selMonth, setSelMonth] = useState(now.getMonth()); // 0-indexed

    const isCurrentMonth = selYear === now.getFullYear() && selMonth === now.getMonth();

    const goToPrev = () => {
        if (selMonth === 0) { setSelYear(y => y - 1); setSelMonth(11); }
        else setSelMonth(m => m - 1);
    };
    const goToNext = () => {
        if (isCurrentMonth) return;
        if (selMonth === 11) { setSelYear(y => y + 1); setSelMonth(0); }
        else setSelMonth(m => m + 1);
    };

    useEffect(() => {
        if (user) fetchDashboardData();
    }, [user, selYear, selMonth]);

    const fetchDashboardData = async () => {
        setLoadingStats(true);

        const restaurantId = restauranteId;
        if (!restaurantId) { setLoadingStats(false); return; }

        const startOfMonth = new Date(selYear, selMonth, 1).toISOString();
        const endOfMonth   = new Date(selYear, selMonth + 1, 1).toISOString();

        // 7 fetches em paralelo — sem waterfall
        const [salesRes, stockAlertsRes, fichasRes, preparosRes, allIngsRes, subsRes, alertasRes] = await Promise.all([
            supabase.from('sales')
                .select('recipe_id, quantity_sold, total_value')
                .eq('restaurant_id', restaurantId)
                .gte('sold_at', startOfMonth)
                .lt('sold_at', endOfMonth),
            supabase.from('ingredients')
                .select('id', { count: 'exact', head: true })
                .eq('restaurant_id', restaurantId)
                .lte('stock_quantity', 0),
            supabase.from('recipes')
                .select('id, product_name, sale_price, yield_quantity')
                .eq('restaurant_id', restaurantId)
                .eq('tipo', 'ficha_final'),
            supabase.from('recipes')
                .select('id, yield_quantity')
                .eq('restaurant_id', restaurantId)
                .eq('tipo', 'preparo'),
            supabase.from('recipe_ingredients')
                .select('recipe_id, sub_recipe_id, quantity_needed, ingredients(avg_cost_per_unit, aproveitamento)'),
            supabase.from('recipe_sub_recipes')
                .select('recipe_id, sub_recipe_id, quantity_needed'),
            getAlertasNovos().catch(() => [] as CmvAlerta[]),
        ]);

        const salesData   = salesRes.data   ?? [];
        const alertsCount = stockAlertsRes.count ?? 0;
        const fichas      = fichasRes.data   ?? [];
        const preparos    = preparosRes.data ?? [];
        const allIngs     = allIngsRes.data  ?? [];
        const subs        = subsRes.data     ?? [];

        // Custo LÍQUIDO do insumo (aplica aproveitamento, igual às telas de ficha)
        const netCost = (ri: any) => {
            const bruto = ri.ingredients?.avg_cost_per_unit ?? 0;
            const aprov = ri.ingredients?.aproveitamento ?? 1;
            return aprov > 0 ? bruto / aprov : bruto;
        };

        // Insumos diretos (recipe_ingredients com ingredient) agrupados por receita
        const ingsByRecipe: Record<string, { avg_cost_per_unit: number; quantity_needed: number }[]> = {};
        // Sub-receitas — vindas dos DOIS locais: recipe_ingredients.sub_recipe_id E recipe_sub_recipes
        const subsByRecipe: Record<string, { sub_recipe_id: string; quantity_needed: number }[]> = {};

        allIngs.forEach((ri: any) => {
            if (ri.sub_recipe_id) {
                (subsByRecipe[ri.recipe_id] ??= []).push({ sub_recipe_id: ri.sub_recipe_id, quantity_needed: ri.quantity_needed });
            } else {
                (ingsByRecipe[ri.recipe_id] ??= []).push({ avg_cost_per_unit: netCost(ri), quantity_needed: ri.quantity_needed });
            }
        });
        subs.forEach((s: any) => {
            (subsByRecipe[s.recipe_id] ??= []).push({ sub_recipe_id: s.sub_recipe_id, quantity_needed: s.quantity_needed });
        });

        // Custo/un de cada preparo, resolvido recursivamente (preparo-dentro-de-preparo)
        const preparoNodes: PreparoNode[] = preparos.map((p: any) => ({
            id: p.id,
            yield_quantity: p.yield_quantity ?? 1,
            ingredients: ingsByRecipe[p.id] ?? [],
            subRecipes: subsByRecipe[p.id] ?? [],
        }));
        const { costPerUnit: preparoCostMap } = buildPreparoCostMapRecursive(preparoNodes);

        // Custo total de cada ficha final (insumos diretos líquidos + preparos)
        const fichaCostMap: Record<string, number> = {};
        fichas.forEach((f: any) => {
            const ingCost = (ingsByRecipe[f.id] ?? []).reduce((acc, i) => acc + i.avg_cost_per_unit * i.quantity_needed, 0);
            const subCost = (subsByRecipe[f.id] ?? []).reduce((acc, s) => acc + (preparoCostMap[s.sub_recipe_id] ?? 0) * s.quantity_needed, 0);
            fichaCostMap[f.id] = ingCost + subCost;
        });

        // Mapa de vendas do mês
        const salesMap: Record<string, { qty: number; revenue: number }> = {};
        salesData.forEach((s: any) => {
            if (!salesMap[s.recipe_id]) salesMap[s.recipe_id] = { qty: 0, revenue: 0 };
            salesMap[s.recipe_id].qty     += s.quantity_sold;
            salesMap[s.recipe_id].revenue += s.total_value;
        });

        const revenue = salesData.reduce((sum: number, s: any) => sum + s.total_value, 0);

        const totalFoodCostSold = salesData.reduce((sum: number, s: any) => {
            return sum + (fichaCostMap[s.recipe_id] ?? 0) * s.quantity_sold;
        }, 0);

        const cmv = calcCMV(totalFoodCostSold, revenue);

        const products: TopProduct[] = fichas
            .filter((r: any) => salesMap[r.id])
            .map((r: any) => {
                const cost = fichaCostMap[r.id] ?? 0;
                return {
                    recipe_id:    r.id,
                    product_name: r.product_name,
                    sale_price:   r.sale_price,
                    food_cost:    cost,
                    total_sold:   salesMap[r.id].qty,
                    margin:       r.sale_price - cost,
                    cmv:          calcCMV(cost, r.sale_price),
                };
            })
            .sort((a: TopProduct, b: TopProduct) => b.margin - a.margin)
            .slice(0, 5);

        const unitsSold = salesData.reduce((sum: number, s: any) => sum + s.quantity_sold, 0);

        setTotalRevenue(revenue);
        setTotalUnitsSold(unitsSold);
        setStockAlerts(alertsCount);
        setCmvPct(cmv);
        setTopProducts(products);
        setCmvAlertas(alertasRes);
        const info: Record<string, { cost: number; sale_price: number }> = {};
        fichas.forEach((f: any) => { info[f.id] = { cost: fichaCostMap[f.id] ?? 0, sale_price: f.sale_price ?? 0 }; });
        setFichaInfo(info);
        setLoadingStats(false);
    };

    const handleAlertaVisto = async (id: string) => {
        try {
            await marcarAlertaVisto(id);
            setCmvAlertas(prev => prev.filter(a => a.id !== id));
        } catch (err) {
            toast.error(String(err));
        }
    };

    const cmvColor = cmvPct === 0
        ? 'text-slate-500'
        : cmvPct < 30 ? 'text-green-600' : cmvPct < 40 ? 'text-amber-600' : 'text-red-600';

    const cmvBg = cmvPct === 0
        ? 'bg-slate-50'
        : cmvPct < 30 ? 'bg-green-50' : cmvPct < 40 ? 'bg-amber-50' : 'bg-red-50';

    const header = (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
                <h1 className="text-2xl font-bold text-ink">Como está o seu restaurante hoje</h1>
                <p className="text-warm-gray text-sm mt-0.5">
                    {isCurrentMonth ? 'Dados do mês atual' : 'Visão histórica deste mês'}
                </p>
            </div>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-1 py-1 shadow-sm self-start sm:self-auto">
                <button
                    onClick={goToPrev}
                    aria-label="Mês anterior"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-slate-800 px-3 min-w-[130px] text-center">
                    {MESES[selMonth]} {selYear}
                </span>
                <button
                    onClick={goToNext}
                    disabled={isCurrentMonth}
                    aria-label="Próximo mês"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );

    if (loadingStats) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                {header}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse">
                            <div className="h-4 bg-slate-200 rounded w-1/2 mb-4" />
                            <div className="h-8 bg-slate-200 rounded w-1/3" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {header}

            {/* Alertas de variação de custo (CMV) — nascem na confirmação de NF-e */}
            {cmvAlertas.length > 0 && (
                <div className="space-y-3">
                    {cmvAlertas.map(a => {
                        const subiu = a.variacao_pct > 0;
                        return (
                            <div
                                key={a.id}
                                className={`bg-white rounded-2xl border shadow-sm p-4 sm:p-5 border-l-4 ${subiu ? 'border-l-red-500 border-red-100' : 'border-l-green-500 border-green-100'}`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 p-2 rounded-xl ${subiu ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                            {subiu ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-800">
                                                {a.ingredients?.name ?? 'Insumo'} {subiu ? 'subiu' : 'caiu'} {Math.abs(a.variacao_pct).toFixed(1)}%
                                            </p>
                                            <p className="text-sm text-slate-500 mt-0.5">
                                                Custo: {fmtMoney(a.custo_antes)} → <span className="font-semibold text-slate-700">{fmtMoney(a.custo_depois)}</span>
                                                {a.ingredients?.unit_type ? ` por ${a.ingredients.unit_type}` : ''}
                                                {' · '}{new Date(a.criado_em).toLocaleDateString('pt-BR')}
                                            </p>
                                            {a.fichas_afetadas.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                                    {a.fichas_afetadas.map(f => {
                                                        const info = fichaInfo[f.id];
                                                        const cmv = info && info.sale_price > 0 ? (info.cost / info.sale_price) * 100 : null;
                                                        const sugerido = info && cmv !== null && cmv > 30 ? info.cost / 0.30 : null;
                                                        return (
                                                            <span
                                                                key={f.id}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600"
                                                                title={sugerido ? `Preço sugerido pra voltar a CMV 30%: ${fmtMoney(sugerido)}` : undefined}
                                                            >
                                                                <span className="font-medium text-slate-700">{f.nome}</span>
                                                                {cmv !== null && (
                                                                    <span className={cmv < 30 ? 'text-green-600' : cmv < 40 ? 'text-amber-600' : 'text-red-600'}>
                                                                        CMV {cmv.toFixed(0)}%
                                                                    </span>
                                                                )}
                                                                {sugerido && (
                                                                    <span className="text-primary-600 font-medium">→ {fmtMoney(sugerido)}</span>
                                                                )}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {a.fichas_afetadas.length === 0 && (
                                                <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                                                    <AlertTriangle className="w-3 h-3" /> Nenhuma ficha usa este insumo ainda.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleAlertaVisto(a.id)}
                                        className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                        Marcar visto
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* CMV */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
                    <div className="flex items-center justify-between">
                        <h2 className="text-slate-500 font-medium text-sm">CMV Geral — {MESES[selMonth]}</h2>
                        <span className={`p-2 ${cmvBg} ${cmvColor} rounded-lg`}>
                            <TrendingDown className="w-5 h-5" />
                        </span>
                    </div>
                    <div className="mt-4">
                        <span className={`text-3xl font-bold tabular-nums ${cmvColor}`}>
                            {cmvPct > 0 ? `${cmvPct.toFixed(1)}%` : '—'}
                        </span>
                        <div className={`mt-1 text-sm ${cmvColor}`}>
                            {cmvPct === 0 ? 'Sem vendas este mês' : cmvPct < 30 ? 'CMV excelente' : cmvPct < 40 ? 'CMV dentro do limite' : 'CMV acima do ideal'}
                        </div>
                    </div>
                </div>

                {/* Receita */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
                    <div className="flex items-center justify-between">
                        <h2 className="text-slate-500 font-medium text-sm">Receita do Mês</h2>
                        <span className="p-2 bg-primary-50 text-primary-600 rounded-lg">
                            <TrendingUp className="w-5 h-5" />
                        </span>
                    </div>
                    <div className="mt-4">
                        <span className="text-3xl font-bold tabular-nums text-slate-900">
                            R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <div className="mt-1 text-sm text-slate-500">
                            {totalUnitsSold > 0 ? `${totalUnitsSold} unidades vendidas` : 'Nenhuma venda registrada'}
                        </div>
                    </div>
                </div>

                {/* Alertas de Estoque */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
                    <div className="flex items-center justify-between">
                        <h2 className="text-slate-500 font-medium text-sm">Alertas de Estoque</h2>
                        <span className={`p-2 ${stockAlerts > 0 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'} rounded-lg`}>
                            <AlertCircle className="w-5 h-5" />
                        </span>
                    </div>
                    <div className="mt-4">
                        <span className={`text-3xl font-bold tabular-nums ${stockAlerts > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                            {stockAlerts} {stockAlerts === 1 ? 'Item' : 'Itens'}
                        </span>
                        <div className={`mt-1 text-sm ${stockAlerts > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                            {stockAlerts > 0 ? 'Com estoque zerado ou negativo' : 'Estoque sem alertas'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Top Produtos */}
            <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-slate-900 flex items-center">
                        <UtensilsCrossed className="w-5 h-5 mr-2 text-primary-500" />
                        Top Produtos — {MESES[selMonth]} {selYear}
                    </h2>
                </div>

                {topProducts.length === 0 ? (
                    <div className="py-12 text-center text-slate-500">
                        <UtensilsCrossed className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="font-medium">Nenhuma venda registrada este mês</p>
                        <p className="text-sm text-slate-400 mt-1">Registre vendas para ver o ranking de produtos.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {topProducts.map((p) => (
                            <div key={p.recipe_id} className="py-4 flex items-center justify-between group">
                                <div>
                                    <p className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{p.product_name}</p>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        CMV: <span className={p.sale_price <= 0 ? 'text-slate-400 font-medium' : p.cmv < 30 ? 'text-green-600 font-medium' : p.cmv < 40 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>{p.sale_price > 0 ? `${p.cmv.toFixed(1)}%` : '—'}</span>
                                        {' • '}Custo: {fmtMoney(p.food_cost)}
                                        {' • '}{p.total_sold} vendido(s)
                                    </p>
                                </div>
                                <div className="text-right tabular-nums">
                                    <p className="font-bold text-slate-900">Venda: {fmtMoney(p.sale_price)}</p>
                                    <p className="text-sm text-green-600">Margem: {fmtMoney(p.margin)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
