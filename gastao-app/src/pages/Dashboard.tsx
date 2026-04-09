import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TrendingDown, TrendingUp, AlertCircle, UtensilsCrossed, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildPreparoCostMap, calcFichaFinalCost, calcCMV } from '../lib/costCalculator';

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
    const { user } = useAuth();
    const [loadingStats, setLoadingStats] = useState(true);
    const [totalRevenue, setTotalRevenue] = useState(0);
    const [stockAlerts, setStockAlerts] = useState(0);
    const [cmvPct, setCmvPct] = useState(0);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);

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

        const { data: profile } = await supabase
            .from('profiles').select('restaurant_id').eq('id', user?.id).single();
        const restaurantId = profile?.restaurant_id;
        if (!restaurantId) { setLoadingStats(false); return; }

        const startOfMonth = new Date(selYear, selMonth, 1).toISOString();
        const endOfMonth   = new Date(selYear, selMonth + 1, 1).toISOString();

        // 6 fetches em paralelo — sem waterfall
        const [salesRes, stockAlertsRes, fichasRes, preparosRes, allIngsRes, subsRes] = await Promise.all([
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
                .select('recipe_id, quantity_needed, ingredients(avg_cost_per_unit)'),
            supabase.from('recipe_sub_recipes')
                .select('recipe_id, sub_recipe_id, quantity_needed'),
        ]);

        const salesData   = salesRes.data   ?? [];
        const alertsCount = stockAlertsRes.count ?? 0;
        const fichas      = fichasRes.data   ?? [];
        const preparos    = preparosRes.data ?? [];
        const allIngs     = allIngsRes.data  ?? [];
        const subs        = subsRes.data     ?? [];

        // Separa recipe_ingredients entre fichas e preparos
        const fichaIds = new Set(fichas.map((r: any) => r.id));
        const fichaIngsMap:   Record<string, { avg_cost_per_unit: number; quantity_needed: number }[]> = {};
        const preparoIngsMap: Record<string, { avg_cost_per_unit: number; quantity_needed: number }[]> = {};

        allIngs.forEach((ri: any) => {
            const entry = { avg_cost_per_unit: ri.ingredients?.avg_cost_per_unit ?? 0, quantity_needed: ri.quantity_needed };
            if (fichaIds.has(ri.recipe_id)) {
                if (!fichaIngsMap[ri.recipe_id]) fichaIngsMap[ri.recipe_id] = [];
                fichaIngsMap[ri.recipe_id].push(entry);
            } else {
                if (!preparoIngsMap[ri.recipe_id]) preparoIngsMap[ri.recipe_id] = [];
                preparoIngsMap[ri.recipe_id].push(entry);
            }
        });

        // Agrupa sub-receitas por ficha
        const subsMap: Record<string, { sub_recipe_id: string; quantity_needed: number }[]> = {};
        subs.forEach((s: any) => {
            if (!subsMap[s.recipe_id]) subsMap[s.recipe_id] = [];
            subsMap[s.recipe_id].push(s);
        });

        // Custo por unidade de cada preparo
        const preparoCostMap = buildPreparoCostMap(preparos, preparoIngsMap);

        // Custo total de cada ficha final (preparos + insumos diretos)
        const fichaCostMap: Record<string, number> = {};
        fichas.forEach((f: any) => {
            fichaCostMap[f.id] = calcFichaFinalCost(
                fichaIngsMap[f.id] ?? [],
                subsMap[f.id]      ?? [],
                preparoCostMap
            );
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

        setTotalRevenue(revenue);
        setStockAlerts(alertsCount);
        setCmvPct(cmv);
        setTopProducts(products);
        setLoadingStats(false);
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
                <h1 className="text-2xl font-bold text-slate-900">Visão Geral do Restaurante</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                    {isCurrentMonth ? 'Mês atual' : 'Período histórico'}
                </p>
            </div>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-1 py-1 shadow-sm self-start sm:self-auto">
                <button
                    onClick={goToPrev}
                    aria-label="Mês anterior"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                        <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                            <TrendingUp className="w-5 h-5" />
                        </span>
                    </div>
                    <div className="mt-4">
                        <span className="text-3xl font-bold tabular-nums text-slate-900">
                            R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <div className="mt-1 text-sm text-slate-500">
                            {topProducts.length > 0 ? `${topProducts.reduce((s, p) => s + p.total_sold, 0)} unidades vendidas` : 'Nenhuma venda registrada'}
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
                        <UtensilsCrossed className="w-5 h-5 mr-2 text-indigo-500" />
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
                                    <p className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{p.product_name}</p>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        CMV: <span className={p.sale_price <= 0 ? 'text-slate-400 font-medium' : p.cmv < 30 ? 'text-green-600 font-medium' : p.cmv < 40 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>{p.sale_price > 0 ? `${p.cmv.toFixed(1)}%` : '—'}</span>
                                        {' • '}Custo: R$ {p.food_cost.toFixed(2)}
                                        {' • '}{p.total_sold} vendido(s)
                                    </p>
                                </div>
                                <div className="text-right tabular-nums">
                                    <p className="font-bold text-slate-900">Venda: R$ {p.sale_price.toFixed(2)}</p>
                                    <p className="text-sm text-green-600">Margem: R$ {p.margin.toFixed(2)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
