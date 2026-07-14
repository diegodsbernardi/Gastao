import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ShoppingBag, Search, X, RotateCcw } from 'lucide-react';
import { fmtMoney } from '../lib/format';
import { traduzErro } from '../lib/erros';
import { useConfirm } from '../components/ConfirmDialog';
import { DecimalInput } from '../components/DecimalInput';

interface RecipeOption {
    id: string;
    product_name: string;
    sale_price: number;
}

interface SaleRecord {
    id: string;
    recipe_id: string;
    quantity_sold: number;
    unit_price: number;
    total_value: number;
    sold_at: string;
}

type DateFilter = 'today' | 'week' | 'month' | 'all';

const getStartDate = (filter: DateFilter): Date | null => {
    if (filter === 'all') return null; // sem filtro de data
    const now = new Date();
    if (filter === 'today') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (filter === 'week') {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() - 6);
        return d;
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
};

const formatDateTime = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const Sales = () => {
    const { user, restauranteId } = useAuth();
    const { confirm } = useConfirm();

    const [recipes, setRecipes] = useState<RecipeOption[]>([]);
    const [recipesMap, setRecipesMap] = useState<Record<string, string>>({});
    const [sales, setSales] = useState<SaleRecord[]>([]);
    const [loadingSales, setLoadingSales] = useState(true);

    // Form states
    const [selectedRecipeId, setSelectedRecipeId] = useState('');
    const [recipeSearch, setRecipeSearch] = useState('');
    const [isRecipeDropdownOpen, setIsRecipeDropdownOpen] = useState(false);
    const [quantitySold, setQuantitySold] = useState<number | ''>('');
    const [unitPrice, setUnitPrice] = useState(0);
    const [savingSale, setSavingSale] = useState(false);
    const [estornandoId, setEstornandoId] = useState<string | null>(null);

    const [dateFilter, setDateFilter] = useState<DateFilter>('month');

    const fetchRecipes = async () => {
        const { data } = await supabase
            .from('recipes')
            .select('id, product_name, sale_price')
            .eq('tipo', 'ficha_final')
            .order('product_name');
        if (data) {
            setRecipes(data);
            setRecipesMap(Object.fromEntries(data.map((r: RecipeOption) => [r.id, r.product_name])));
        }
    };

    const fetchSales = useCallback(async (filter: DateFilter) => {
        setLoadingSales(true);
        const startDate = getStartDate(filter);
        let query = supabase
            .from('sales')
            .select('id, recipe_id, quantity_sold, unit_price, total_value, sold_at')
            .order('sold_at', { ascending: false });
        if (startDate) query = query.gte('sold_at', startDate.toISOString());
        const { data } = await query;
        if (data) setSales(data);
        setLoadingSales(false);
    }, []);

    useEffect(() => {
        if (user) fetchRecipes();
    }, [user]);

    // Um único effect pra vendas (evita o double-fetch da montagem e corridas
    // entre trocas rápidas de filtro).
    useEffect(() => {
        if (user) fetchSales(dateFilter);
    }, [user, dateFilter, fetchSales]);

    const handleSaveSale = async () => {
        if (!selectedRecipeId || quantitySold === '' || Number(quantitySold) <= 0 || !restauranteId) return;
        setSavingSale(true);

        // RPC atômico: insere a venda e baixa o estoque de todos os insumos-folha,
        // expandindo preparos recursivamente (ver migration 022_registrar_venda_rpc).
        const { error: saleError } = await supabase.rpc('registrar_venda', {
            p_recipe_id: selectedRecipeId,
            p_qty: Number(quantitySold),
            p_unit_price: unitPrice,
        });

        if (saleError) {
            toast.error(traduzErro(saleError));
            setSavingSale(false);
            return;
        }

        setSelectedRecipeId('');
        setRecipeSearch('');
        setQuantitySold('');
        setUnitPrice(0);
        toast.success('Venda registrada com sucesso!');
        await fetchSales(dateFilter);
        setSavingSale(false);
    };

    const handleEstornar = async (sale: SaleRecord) => {
        const nome = recipesMap[sale.recipe_id] ?? 'produto';
        if (!(await confirm({
            title: 'Estornar venda?',
            message: `${sale.quantity_sold}× ${nome} — o estoque consumido será devolvido e a venda apagada.`,
            tone: 'danger',
            confirmText: 'Estornar',
        }))) return;
        setEstornandoId(sale.id);
        const { error } = await supabase.rpc('estornar_venda', { p_sale_id: sale.id });
        if (error) {
            toast.error(traduzErro(error));
            setEstornandoId(null);
            return;
        }
        toast.success('Venda estornada — estoque devolvido.');
        await fetchSales(dateFilter);
        setEstornandoId(null);
    };

    const totalRevenue = sales.reduce((sum, s) => sum + s.total_value, 0);
    const estimatedTotal = unitPrice * (Number(quantitySold) || 0);

    const filteredRecipesDropdown = recipes
        .filter(r => r.product_name.toLowerCase().includes(recipeSearch.toLowerCase()))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));

    const filterLabels: Record<DateFilter, string> = {
        today: 'Hoje',
        week: 'Esta Semana',
        month: 'Este Mês',
        all: 'Tudo',
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center">
                        <ShoppingBag className="w-6 h-6 mr-3 text-primary-500" />
                        Vendas e Entradas
                    </h1>
                    <p className="text-slate-500 mt-1">Registre vendas e acompanhe o faturamento com baixa automática de estoque.</p>
                </div>
            </div>

            {/* Nova Venda — inline form */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-base font-bold text-slate-900 mb-4">Registrar Nova Venda</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    {/* Searchable recipe picker */}
                    <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Produto</label>
                        <div
                            className="relative flex items-center w-full px-3 py-2 border border-slate-300 rounded-lg bg-white cursor-text focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500 transition-shadow"
                            onClick={() => setIsRecipeDropdownOpen(true)}
                        >
                            <Search className="w-4 h-4 text-slate-500 mr-2 flex-shrink-0" />
                            <input
                                type="text"
                                placeholder="Buscar produto..."
                                value={selectedRecipeId ? (recipesMap[selectedRecipeId] ?? '') : recipeSearch}
                                onChange={(e) => {
                                    setRecipeSearch(e.target.value);
                                    if (selectedRecipeId) { setSelectedRecipeId(''); setUnitPrice(0); }
                                    setIsRecipeDropdownOpen(true);
                                }}
                                onFocus={() => setIsRecipeDropdownOpen(true)}
                                onBlur={() => setTimeout(() => setIsRecipeDropdownOpen(false), 200)}
                                className="w-full outline-none text-sm text-slate-700 bg-transparent placeholder-slate-400"
                            />
                            {selectedRecipeId && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedRecipeId(''); setRecipeSearch(''); setUnitPrice(0); }}
                                    className="p-1 hover:bg-slate-100 rounded-md text-slate-500 transition-colors ml-1"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                            {isRecipeDropdownOpen && (
                                <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                    {filteredRecipesDropdown.length === 0 ? (
                                        <div className="px-4 py-4 text-center text-slate-500 text-sm italic">Nenhum produto encontrado.</div>
                                    ) : filteredRecipesDropdown.map(r => (
                                        <div
                                            key={r.id}
                                            onClick={() => {
                                                setSelectedRecipeId(r.id);
                                                setUnitPrice(r.sale_price);
                                                setRecipeSearch('');
                                                setIsRecipeDropdownOpen(false);
                                            }}
                                            className="px-4 py-3 hover:bg-primary-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0 transition-colors"
                                        >
                                            <span className="font-medium text-slate-700 text-sm">{r.product_name}</span>
                                            <span className="text-xs text-slate-500 font-medium">{fmtMoney(r.sale_price)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quantity */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Quantidade</label>
                        <DecimalInput
                            value={quantitySold}
                            onChange={setQuantitySold}
                            placeholder="1"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                        />
                    </div>

                    {/* Price info + button */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Preço Unitário</label>
                        <div className="flex items-center gap-3">
                            <DecimalInput
                                value={unitPrice || ''}
                                onChange={v => setUnitPrice(v === '' ? 0 : v)}
                                placeholder="0,00"
                                title="Ajuste para registrar venda em promoção ou combo"
                                className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm text-slate-700 font-semibold"
                            />
                            <button
                                onClick={handleSaveSale}
                                disabled={savingSale || !selectedRecipeId || quantitySold === '' || Number(quantitySold) <= 0}
                                className="px-5 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm shadow-sm whitespace-nowrap"
                            >
                                {savingSale ? 'Registrando...' : 'Registrar Venda'}
                            </button>
                        </div>
                        {estimatedTotal > 0 && (
                            <p className="mt-2 text-xs text-slate-500">
                                Total estimado: <strong className="text-slate-900">{fmtMoney(estimatedTotal)}</strong>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Sales history */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Filter tabs */}
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex space-x-1">
                    {(['today', 'week', 'month', 'all'] as DateFilter[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setDateFilter(f)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dateFilter === f
                                ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
                                }`}
                        >
                            {filterLabels[f]}
                        </button>
                    ))}
                </div>

                {/* Summary bar */}
                <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-100 flex justify-between items-center text-sm">
                    <span className="text-slate-500">{sales.length} venda{sales.length !== 1 ? 's' : ''}</span>
                    <span className="font-semibold text-slate-900">
                        Total: <span className="text-green-700">{fmtMoney(totalRevenue)}</span>
                    </span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                                <th className="p-4 font-bold">Data / Hora</th>
                                <th className="p-4 font-bold">Produto</th>
                                <th className="p-4 font-bold text-right">Qtd</th>
                                <th className="p-4 font-bold text-right">Preço Unit.</th>
                                <th className="p-4 font-bold text-right">Total</th>
                                <th className="p-4 font-bold text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loadingSales ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-500 animate-pulse">
                                        Carregando vendas...
                                    </td>
                                </tr>
                            ) : sales.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center text-slate-500">
                                        <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                        <p className="font-medium">Nenhuma venda registrada</p>
                                        <p className="text-sm text-slate-500 mt-1">{filterLabels[dateFilter].toLowerCase()}</p>
                                    </td>
                                </tr>
                            ) : (
                                sales.map(sale => (
                                    <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4 text-slate-500 text-sm">{formatDateTime(sale.sold_at)}</td>
                                        <td className="p-4 font-medium text-slate-900">{recipesMap[sale.recipe_id] ?? '—'}</td>
                                        <td className="p-4 text-right text-slate-600">{sale.quantity_sold}</td>
                                        <td className="p-4 text-right text-slate-600">{fmtMoney(sale.unit_price)}</td>
                                        <td className="p-4 text-right font-semibold text-green-700">{fmtMoney(sale.total_value)}</td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => handleEstornar(sale)}
                                                disabled={estornandoId === sale.id}
                                                title="Estornar venda (devolve o estoque)"
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
                                            >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                                {estornandoId === sale.id ? 'Estornando...' : 'Estornar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
