import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
    UtensilsCrossed, Plus, Trash2, Edit, Search, X, ChefHat, Package, Link2,
} from 'lucide-react';
import type { Ingredient, Recipe, RecipeIngredient, RecipeSubRecipe } from '../lib/types';
import { fmtMoney, fmtQty } from '../lib/format';
import { usePermissions } from '../hooks/usePermissions';

// ─── tipos locais para o modal ────────────────────────────────────────────────
type EditIngItem = RecipeIngredient;
type EditSubItem = Omit<RecipeSubRecipe, 'sub_recipe'> & {
    sub_recipe: Pick<Recipe, 'id' | 'product_name' | 'tipo' | 'yield_quantity'>;
};
type AddTab = 'preparo' | 'insumo' | 'embalagem';

const CATEGORIES = ['Lanche', 'Porção', 'Sobremesa', 'Combo', 'Bebida', 'Outro'];

export const Recipes = ({ categoryFilter }: { categoryFilter?: string } = {}) => {
    const { user, restauranteId } = useAuth();
    const { viewMode, canViewCMV, canViewCosts, canEdit } = usePermissions();

    // ── dados principais ──────────────────────────────────────────────────────
    const [fichas, setFichas] = useState<Recipe[]>([]);
    const [preparos, setPreparos] = useState<Recipe[]>([]);
    const [insumosDiretos, setInsumosDiretos] = useState<Ingredient[]>([]);
    const [embalagens, setEmbalagens] = useState<Ingredient[]>([]);
    // composições das fichas finais
    const [fichaIngs, setFichaIngs] = useState<Record<string, EditIngItem[]>>({});
    const [fichaSubs, setFichaSubs] = useState<Record<string, EditSubItem[]>>({});
    // composições dos preparos (para calcular custo/un)
    const [preparoIngs, setPreparoIngs] = useState<Record<string, RecipeIngredient[]>>({});
    // quem usa essa receita como sub-componente (id da receita usada → fichas que dependem)
    const [usedByMap, setUsedByMap] = useState<Record<string, { id: string; name: string }[]>>({});

    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('Todas');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // ── modal: nova ficha ─────────────────────────────────────────────────────
    const [showNewModal, setShowNewModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPrice, setNewPrice] = useState<number | ''>(0);
    const [newCategory, setNewCategory] = useState('Lanche');
    const [savingNew, setSavingNew] = useState(false);

    // ── editar info da ficha (nome, preço, categoria) ─────────────────────────
    const [editingInfoId, setEditingInfoId] = useState<string | null>(null);
    const [editInfoName, setEditInfoName] = useState('');
    const [editInfoPrice, setEditInfoPrice] = useState<number | ''>('');
    const [editInfoCategory, setEditInfoCategory] = useState('');
    const [savingInfo, setSavingInfo] = useState(false);

    // ── modal: editar composição ──────────────────────────────────────────────
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editIngItems, setEditIngItems] = useState<EditIngItem[]>([]);
    const [editSubItems, setEditSubItems] = useState<EditSubItem[]>([]);
    const [addTab, setAddTab] = useState<AddTab>('preparo');

    // picker: preparos
    const [prepSearch, setPrepSearch] = useState('');
    const [selPrepId, setSelPrepId] = useState('');
    const [selPrepQty, setSelPrepQty] = useState<number | ''>('');
    const [prepDropdown, setPrepDropdown] = useState(false);

    // picker: insumos diretos
    const [ingSearch, setIngSearch] = useState('');
    const [selIngId, setSelIngId] = useState('');
    const [selIngQty, setSelIngQty] = useState<number | ''>('');
    const [ingDropdown, setIngDropdown] = useState(false);

    // picker: embalagens
    const [embalSearch, setEmbalSearch] = useState('');
    const [selEmbalId, setSelEmbalId] = useState('');
    const [selEmbalQty, setSelEmbalQty] = useState<number | ''>('');
    const [embalDropdown, setEmbalDropdown] = useState(false);

    const [savingEdit, setSavingEdit] = useState(false);

    // ─────────────────────────────────────────────────────────────────────────
    useEffect(() => { if (user) fetchData(); }, [user]);

    const fetchData = async () => {
        setLoading(true);

        // Todos os fetches em paralelo — sem waterfall
        const [fichasRes, preparosRes, insumosDiretosRes, embalagemRes, allIngsRes, subsRes] = await Promise.all([
            supabase.from('recipes').select('*').eq('tipo', 'ficha_final').order('product_name'),
            supabase.from('recipes').select('*').eq('tipo', 'preparo').order('product_name'),
            supabase.from('ingredients').select('*').eq('tipo', 'insumo_direto').order('name'),
            supabase.from('ingredients').select('*').eq('tipo', 'embalagem').order('name'),
            supabase.from('recipe_ingredients').select(`
                id, recipe_id, ingredient_id, quantity_needed,
                ingredients ( id, name, unit_type, avg_cost_per_unit, aproveitamento, tipo )
            `),
            supabase.from('recipe_sub_recipes').select(`
                id, recipe_id, sub_recipe_id, quantity_needed,
                sub_recipe:recipes!recipe_sub_recipes_sub_recipe_id_fkey ( id, product_name, tipo, yield_quantity )
            `),
        ]);

        if (fichasRes.data) setFichas(fichasRes.data);
        if (preparosRes.data) setPreparos(preparosRes.data);
        if (insumosDiretosRes.data) setInsumosDiretos(insumosDiretosRes.data);
        if (embalagemRes.data) setEmbalagens(embalagemRes.data);

        // Agrupa recipe_ingredients: fichas vs preparos (pelo tipo da receita)
        if (allIngsRes.data && fichasRes.data && preparosRes.data) {
            const fichaIds = new Set(fichasRes.data.map((r: Recipe) => r.id));
            const prepIds  = new Set(preparosRes.data.map((r: Recipe) => r.id));

            const fichaIngMap: Record<string, EditIngItem[]> = {};
            const prepIngMap:  Record<string, RecipeIngredient[]> = {};

            allIngsRes.data.forEach((item: any) => {
                if (fichaIds.has(item.recipe_id)) {
                    if (!fichaIngMap[item.recipe_id]) fichaIngMap[item.recipe_id] = [];
                    fichaIngMap[item.recipe_id].push(item);
                } else if (prepIds.has(item.recipe_id)) {
                    if (!prepIngMap[item.recipe_id]) prepIngMap[item.recipe_id] = [];
                    prepIngMap[item.recipe_id].push(item);
                }
            });

            setFichaIngs(fichaIngMap);
            setPreparoIngs(prepIngMap);
        }

        if (subsRes.data) {
            const subMap: Record<string, EditSubItem[]> = {};
            const reverseMap: Record<string, { id: string; name: string }[]> = {};
            // Pai pode ser ficha_final OU preparo — incluir ambos pra cobrir qualquer
            // referência que bloqueie o delete via FK restrict de recipe_sub_recipes.
            const recipeNameById = new Map<string, string>();
            (fichasRes.data ?? []).forEach((f: Recipe) => recipeNameById.set(f.id, f.product_name));
            (preparosRes.data ?? []).forEach((p: Recipe) => recipeNameById.set(p.id, p.product_name));

            subsRes.data.forEach((item: any) => {
                if (!subMap[item.recipe_id]) subMap[item.recipe_id] = [];
                subMap[item.recipe_id].push(item);

                // Ignora auto-referência no mapa reverso
                if (item.recipe_id === item.sub_recipe_id) return;

                const parentName = recipeNameById.get(item.recipe_id);
                if (parentName) {
                    if (!reverseMap[item.sub_recipe_id]) reverseMap[item.sub_recipe_id] = [];
                    reverseMap[item.sub_recipe_id].push({ id: item.recipe_id, name: parentName });
                }
            });
            setFichaSubs(subMap);
            setUsedByMap(reverseMap);
        }

        setLoading(false);
    };

    // Custo por unidade de cada preparo — memoizado
    const preparoCostPerUnit = useMemo(() => {
        const map: Record<string, number> = {};
        preparos.forEach(p => {
            const items = preparoIngs[p.id] ?? [];
            const total = items.reduce((acc, i) => acc + (i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed, 0);
            map[p.id] = total / (p.yield_quantity || 1);
        });
        return map;
    }, [preparos, preparoIngs]);

    // Custo total de cada ficha final — memoizado
    // Suporta combos: fichas finais podem conter outras fichas finais como sub-itens
    const fichaCostMap = useMemo(() => {
        const map: Record<string, number> = {};

        // Mapa unificado: preparos + fichas já calculadas
        const recipeCostMap = { ...preparoCostPerUnit };

        // Múltiplas passadas para resolver dependências (combo que usa outra ficha)
        // Máximo 5 iterações para evitar ciclos
        for (let pass = 0; pass < 5; pass++) {
            let changed = false;
            fichas.forEach(f => {
                const ingCost = (fichaIngs[f.id] ?? []).reduce(
                    (acc, i) => acc + (i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed, 0
                );
                const subCost = (fichaSubs[f.id] ?? []).reduce(
                    (acc, s) => acc + (recipeCostMap[s.sub_recipe_id] ?? 0) * s.quantity_needed, 0
                );
                const newCost = ingCost + subCost;
                if (map[f.id] !== newCost) {
                    map[f.id] = newCost;
                    recipeCostMap[f.id] = newCost; // disponibiliza para combos que usam esta ficha
                    changed = true;
                }
            });
            if (!changed) break;
        }

        return map;
    }, [fichas, fichaIngs, fichaSubs, preparoCostPerUnit]);

    const categories = useMemo(
        () => ['Todas', ...Array.from(new Set(fichas.map(f => f.category).filter(Boolean)))],
        [fichas]
    );

    const filteredFichas = useMemo(() => fichas.filter(f => {
        const matchSearch = f.product_name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchCat = categoryFilter
            ? f.category === categoryFilter
            : (activeCategory === 'Todas' || f.category === activeCategory);
        return matchSearch && matchCat;
    }), [fichas, searchQuery, activeCategory, categoryFilter]);

    // ─── CRUD ────────────────────────────────────────────────────────────────

    const handleCreate = async () => {
        if (!newName.trim() || !restauranteId) return;
        setSavingNew(true);

        const { data, error } = await supabase.from('recipes').insert([{
            restaurant_id: restauranteId,
            product_name: newName.trim(),
            sale_price: Number(newPrice) || 0,
            category: newCategory,
            tipo: 'ficha_final',
            yield_quantity: 1,
        }]).select().single();

        if (!error && data) {
            setFichas(prev => [...prev, data].sort((a, b) => a.product_name.localeCompare(b.product_name)));
            setShowNewModal(false);
            setNewName(''); setNewPrice(0); setNewCategory('Lanche');
            toast.success('Ficha técnica criada!');
        } else {
            toast.error('Erro ao criar: ' + error?.message);
        }
        setSavingNew(false);
    };

    const handleSaveInfo = async () => {
        if (!editingInfoId || !editInfoName.trim()) return;
        setSavingInfo(true);
        const { error } = await supabase.from('recipes').update({
            product_name: editInfoName.trim(),
            sale_price: Number(editInfoPrice) || 0,
            category: editInfoCategory,
        }).eq('id', editingInfoId);
        if (!error) {
            setFichas(prev => prev.map(f => f.id === editingInfoId
                ? { ...f, product_name: editInfoName.trim(), sale_price: Number(editInfoPrice) || 0, category: editInfoCategory }
                : f
            ));
            setEditingInfoId(null);
            toast.success('Ficha atualizada!');
        } else {
            toast.error('Erro: ' + error.message);
        }
        setSavingInfo(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Excluir esta ficha técnica?')) return;

        // Remove auto-referência (ficha que aponta pra si mesma) antes de deletar —
        // o FK RESTRICT do recipe_sub_recipes bloquearia o delete por esse loop.
        await supabase
            .from('recipe_sub_recipes')
            .delete()
            .eq('recipe_id', id)
            .eq('sub_recipe_id', id);

        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (!error) {
            setFichas(prev => prev.filter(f => f.id !== id));
            setSelectedIds(prev => prev.filter(i => i !== id));
            toast.success('Ficha excluída.');
            return;
        }
        if (error.code === '23503') {
            const deps = usedByMap[id] ?? [];
            const lista = deps.map(d => d.name).join(', ');
            toast.error(
                deps.length
                    ? `Essa ficha é base de ${deps.length} outra(s): ${lista}. Remova a referência antes de excluir.`
                    : 'Essa ficha é usada em outras fichas. Remova a referência antes de excluir.',
                { duration: 7000 },
            );
            return;
        }
        toast.error('Erro: ' + error.message);
    };

    const handleBulkDelete = async () => {
        if (!confirm(`Excluir ${selectedIds.length} ficha(s)?`)) return;

        // Limpa auto-referências dos selecionados antes do bulk delete
        for (const id of selectedIds) {
            await supabase
                .from('recipe_sub_recipes')
                .delete()
                .eq('recipe_id', id)
                .eq('sub_recipe_id', id);
        }

        const { error } = await supabase.from('recipes').delete().in('id', selectedIds);
        if (!error) {
            setFichas(prev => prev.filter(f => !selectedIds.includes(f.id)));
            setSelectedIds([]);
            toast.success(`${selectedIds.length} ficha(s) excluída(s).`);
            return;
        }
        if (error.code === '23503') {
            const bloqueando = selectedIds
                .map(id => ({ id, deps: usedByMap[id] ?? [] }))
                .filter(x => x.deps.length > 0);
            if (bloqueando.length > 0) {
                const resumo = bloqueando
                    .map(({ id, deps }) => {
                        const ficha = fichas.find(f => f.id === id);
                        return `"${ficha?.product_name ?? id}" → usada em ${deps.map(d => d.name).join(', ')}`;
                    })
                    .join(' | ');
                toast.error(
                    `${bloqueando.length} ficha(s) não podem ser excluída(s) porque são base de outras. ${resumo}`,
                    { duration: 10000 },
                );
                return;
            }
        }
        toast.error('Erro: ' + error.message);
    };

    // ─── modal editar ─────────────────────────────────────────────────────────

    const openEdit = (ficha: Recipe) => {
        setEditingId(ficha.id);
        setEditIngItems(JSON.parse(JSON.stringify(fichaIngs[ficha.id] ?? [])));
        setEditSubItems(JSON.parse(JSON.stringify(fichaSubs[ficha.id] ?? [])));
        setAddTab('preparo');
        resetPickers();
    };

    const resetPickers = () => {
        setPrepSearch(''); setSelPrepId(''); setSelPrepQty(''); setPrepDropdown(false);
        setIngSearch('');  setSelIngId('');  setSelIngQty('');  setIngDropdown(false);
    };

    const handleAddPreparo = () => {
        if (!selPrepId || selPrepQty === '' || Number(selPrepQty) <= 0) return;
        const recipe = allRecipesForPicker.find(p => p.id === selPrepId);
        if (!recipe) return;
        setEditSubItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: editingId!,
            sub_recipe_id: recipe.id,
            quantity_needed: Number(selPrepQty),
            sub_recipe: recipe,
        }]);
        setSelPrepId(''); setPrepSearch(''); setSelPrepQty('');
    };

    const handleAddInsumo = () => {
        if (!selIngId || selIngQty === '' || Number(selIngQty) <= 0) return;
        const ing = insumosDiretos.find(i => i.id === selIngId);
        if (!ing) return;
        setEditIngItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: editingId!,
            ingredient_id: ing.id,
            quantity_needed: Number(selIngQty),
            ingredients: ing,
        }]);
        setSelIngId(''); setIngSearch(''); setSelIngQty('');
    };

    const handleAddEmbalagem = () => {
        if (!selEmbalId || selEmbalQty === '' || Number(selEmbalQty) <= 0) return;
        const emb = embalagens.find(e => e.id === selEmbalId);
        if (!emb) return;
        setEditIngItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: editingId!,
            ingredient_id: emb.id,
            quantity_needed: Number(selEmbalQty),
            ingredients: emb,
        }]);
        setSelEmbalId(''); setEmbalSearch(''); setSelEmbalQty('');
    };

    const handleSaveComposition = async () => {
        if (!editingId) return;
        setSavingEdit(true);

        const [delIngRes, delSubRes] = await Promise.all([
            supabase.from('recipe_ingredients').delete().eq('recipe_id', editingId),
            supabase.from('recipe_sub_recipes').delete().eq('recipe_id', editingId),
        ]);

        if (delIngRes.error || delSubRes.error) {
            toast.error('Erro ao salvar: ' + (delIngRes.error?.message ?? delSubRes.error?.message));
            setSavingEdit(false);
            return;
        }

        const insertOps = [];
        if (editIngItems.length > 0) {
            insertOps.push(supabase.from('recipe_ingredients').insert(
                editIngItems.map(i => ({
                    recipe_id: editingId,
                    ingredient_id: i.ingredient_id,
                    quantity_needed: i.quantity_needed,
                }))
            ));
        }
        if (editSubItems.length > 0) {
            insertOps.push(supabase.from('recipe_sub_recipes').insert(
                editSubItems.map(s => ({
                    recipe_id: editingId,
                    sub_recipe_id: s.sub_recipe_id,
                    quantity_needed: s.quantity_needed,
                }))
            ));
        }

        if (insertOps.length > 0) {
            const results = await Promise.all(insertOps);
            const failed = results.find(r => r.error);
            if (failed?.error) {
                toast.error('Erro ao salvar composição: ' + failed.error.message);
                setSavingEdit(false);
                fetchData(); // restaura estado do banco
                return;
            }
        }

        setFichaIngs(prev => ({ ...prev, [editingId]: editIngItems }));
        setFichaSubs(prev => ({ ...prev, [editingId]: editSubItems }));
        setEditingId(null);
        setSavingEdit(false);
        toast.success('Composição salva!');
    };

    // ─── cálculos do modal ────────────────────────────────────────────────────
    const editingFicha = fichas.find(f => f.id === editingId);
    // Mapa unificado de custo: preparos + fichas finais (para combos)
    const unifiedCostMap = useMemo(() => {
        return { ...preparoCostPerUnit, ...fichaCostMap };
    }, [preparoCostPerUnit, fichaCostMap]);

    const editTotalCost = useMemo(() => {
        const ing = editIngItems.reduce((acc, i) => acc + (i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed, 0);
        const sub = editSubItems.reduce((acc, s) => acc + (unifiedCostMap[s.sub_recipe_id] ?? 0) * s.quantity_needed, 0);
        return ing + sub;
    }, [editIngItems, editSubItems, unifiedCostMap]);

    // dropdowns filtrados
    // Combina preparos + fichas finais para o dropdown de sub-receitas (permite combos)
    const allRecipesForPicker = useMemo(() => {
        const editing = editingId;
        return [...preparos, ...fichas]
            .filter(r => r.id !== editing); // não pode adicionar a si mesmo
    }, [preparos, fichas, editingId]);

    const filteredPrepDropdown = allRecipesForPicker
        .filter(p => !editSubItems.some(s => s.sub_recipe_id === p.id))
        .filter(p => p.product_name.toLowerCase().includes(prepSearch.toLowerCase()));

    const filteredIngDropdown = insumosDiretos
        .filter(i => !editIngItems.some(e => e.ingredient_id === i.id))
        .filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()));

    const filteredEmbalDropdown = embalagens
        .filter(e => !editIngItems.some(i => i.ingredient_id === e.id))
        .filter(e => e.name.toLowerCase().includes(embalSearch.toLowerCase()));

    // ─────────────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-4">
                {[1, 2, 3].map(n => (
                    <div key={n} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />
                ))}
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center">
                        <UtensilsCrossed className="w-5 h-5 sm:w-6 sm:h-6 mr-2.5 text-primary-500" />
                        {categoryFilter ?? 'Fichas Técnicas'}
                    </h1>
                    <p className="text-slate-500 mt-1 hidden sm:block">
                        {categoryFilter ? `Fichas técnicas da categoria ${categoryFilter}.` : 'Produtos vendidos. Compostos por Preparos e Itens Prontos.'}
                    </p>
                </div>
                {canEdit && (
                    <div className="mt-3 sm:mt-0 flex flex-wrap gap-2 w-full sm:w-auto">
                        {selectedIds.length > 0 && (
                            <button
                                onClick={handleBulkDelete}
                                className="flex-1 sm:flex-none flex items-center justify-center px-3 py-2 text-sm bg-red-50 text-red-600 font-medium rounded-lg hover:bg-red-100 border border-red-200"
                            >
                                <Trash2 className="w-4 h-4 mr-1.5 shrink-0" />
                                Excluir ({selectedIds.length})
                            </button>
                        )}
                        <button
                            onClick={() => { setShowNewModal(true); if (categoryFilter) setNewCategory(categoryFilter); }}
                            className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 shadow-sm text-sm"
                        >
                            <Plus className="w-4 h-4 mr-1.5 shrink-0" />
                            {categoryFilter ? `Novo(a) ${categoryFilter}` : 'Nova Ficha'}
                        </button>
                    </div>
                )}
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                <div className="flex flex-wrap gap-2">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${activeCategory === cat ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
                <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar fichas..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                </div>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredFichas.length === 0 ? (
                    <div className="col-span-full py-16 text-center text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">
                        <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                        <p className="font-medium">Nenhuma ficha técnica encontrada.</p>
                    </div>
                ) : filteredFichas.map(ficha => {
                    const cost = fichaCostMap[ficha.id] ?? 0;
                    const cmv = ficha.sale_price > 0 ? (cost / ficha.sale_price * 100).toFixed(1) : null;
                    const ings = fichaIngs[ficha.id] ?? [];
                    const subs = fichaSubs[ficha.id] ?? [];

                    return (
                        <div
                            key={ficha.id}
                            className={`bg-white rounded-2xl border overflow-hidden shadow-sm flex flex-col transition-colors ${selectedIds.includes(ficha.id) ? 'ring-2 ring-primary-500 border-primary-300' : 'border-slate-200'}`}
                        >
                            {/* Card header */}
                            <div className={`p-5 border-b border-slate-100 flex justify-between items-start ${selectedIds.includes(ficha.id) ? 'bg-primary-50/40' : 'bg-slate-50'}`}>
                                <div className="flex items-start gap-3">
                                    {canEdit && (
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(ficha.id)}
                                            onChange={e => setSelectedIds(e.target.checked ? [...selectedIds, ficha.id] : selectedIds.filter(i => i !== ficha.id))}
                                            className="mt-1 rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
                                        />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        {editingInfoId === ficha.id ? (
                                            <div className="space-y-2 pr-2">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={editInfoName}
                                                    onChange={e => setEditInfoName(e.target.value)}
                                                    className="w-full px-2 py-1 border border-primary-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-primary-500 outline-none"
                                                />
                                                <div className="flex gap-2">
                                                    <select value={editInfoCategory} onChange={e => setEditInfoCategory(e.target.value)} className="flex-1 px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-primary-500">
                                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                    <input
                                                        type="number"
                                                        value={editInfoPrice}
                                                        onChange={e => setEditInfoPrice(e.target.value === '' ? '' : Number(e.target.value))}
                                                        onFocus={e => e.target.select()}
                                                        placeholder="Preço"
                                                        className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs text-right focus:ring-2 focus:ring-primary-500 outline-none"
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => setEditingInfoId(null)} className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
                                                    <button onClick={handleSaveInfo} disabled={savingInfo || !editInfoName.trim()} className="px-3 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                                                        {savingInfo ? '...' : 'Salvar'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-1">
                                                    <h3 className={`font-bold text-slate-900 leading-none mb-1 ${viewMode === 'operacao' ? 'text-xl' : 'text-base mb-2'}`}>
                                                        {ficha.product_name}
                                                    </h3>
                                                    {canEdit && (
                                                        <button
                                                            onClick={() => { setEditingInfoId(ficha.id); setEditInfoName(ficha.product_name); setEditInfoPrice(ficha.sale_price); setEditInfoCategory(ficha.category ?? 'Lanche'); }}
                                                            className="p-1 text-slate-300 hover:text-primary-500 rounded transition-colors mb-1"
                                                        >
                                                            <Edit className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                                {canViewCosts && (
                                                    <div className="flex gap-4 text-sm">
                                                        <span className="text-slate-500">Venda: <strong className="text-slate-900">{fmtMoney(ficha.sale_price)}</strong></span>
                                                        <span className="text-slate-500">Custo: <strong className="text-red-600">{fmtMoney(cost)}</strong></span>
                                                    </div>
                                                )}
                                                {viewMode === 'operacao' && (
                                                    <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{ficha.category}</span>
                                                )}
                                                {(usedByMap[ficha.id]?.length ?? 0) > 0 && (
                                                    <span
                                                        title={`Usada em: ${usedByMap[ficha.id].map(d => d.name).join(', ')}`}
                                                        className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                                    >
                                                        <Link2 className="w-3 h-3" />
                                                        Base de {usedByMap[ficha.id].length} ficha{usedByMap[ficha.id].length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {canViewCMV && (
                                        cmv !== null
                                            ? <span className={`px-3 py-1.5 rounded-lg font-bold text-sm ${Number(cmv) < 30 ? 'bg-green-100 text-green-700' : Number(cmv) < 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                                CMV {cmv}%
                                              </span>
                                            : <span className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 text-slate-400 font-medium">CMV —</span>
                                    )}
                                    {canEdit && (
                                        <button onClick={() => handleDelete(ficha.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Composição */}
                            <div className="p-5 flex-1 space-y-4">
                                {/* Preparos usados */}
                                {subs.length > 0 && (
                                    <div>
                                        <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                            <ChefHat className="w-3.5 h-3.5" /> Preparos
                                        </p>
                                        <ul className="space-y-1.5">
                                            {subs.map(s => (
                                                <li key={s.id} className="flex justify-between items-center text-sm">
                                                    <span className="font-medium text-slate-700">{s.sub_recipe.product_name}</span>
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <span>{s.quantity_needed} un</span>
                                                        <span className="font-semibold text-slate-700">
                                                            {fmtMoney((preparoCostPerUnit[s.sub_recipe_id] ?? 0) * s.quantity_needed)}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Insumos (base + direto) */}
                                {ings.filter(i => i.ingredients.tipo !== 'embalagem').length > 0 && (
                                    <div>
                                        <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                            <Package className="w-3.5 h-3.5" /> Insumos
                                        </p>
                                        <ul className="space-y-1.5">
                                            {ings.filter(i => i.ingredients.tipo !== 'embalagem').map(i => (
                                                <li key={i.id} className="flex justify-between items-center text-sm">
                                                    <span className="font-medium text-slate-700">{i.ingredients.name}</span>
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <span>{fmtQty(i.quantity_needed, i.ingredients.unit_type)} {i.ingredients.unit_type}</span>
                                                        <span className="font-semibold text-slate-700">
                                                            {fmtMoney((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed)}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Embalagens */}
                                {ings.filter(i => i.ingredients.tipo === 'embalagem').length > 0 && (
                                    <div>
                                        <p className="text-xs font-bold text-purple-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                            <Package className="w-3.5 h-3.5" /> Embalagens
                                        </p>
                                        <ul className="space-y-1.5">
                                            {ings.filter(i => i.ingredients.tipo === 'embalagem').map(i => (
                                                <li key={i.id} className="flex justify-between items-center text-sm">
                                                    <span className="font-medium text-slate-700">{i.ingredients.name}</span>
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <span>{fmtQty(i.quantity_needed, i.ingredients.unit_type)} {i.ingredients.unit_type}</span>
                                                        <span className="font-semibold text-slate-700">
                                                            {fmtMoney((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed)}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {ings.length === 0 && subs.length === 0 && (
                                    <p className="text-sm text-slate-400 italic">Sem composição. Clique em "Editar" para montar.</p>
                                )}
                            </div>

                            {/* Footer */}
                            {canEdit && (
                                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
                                    <button onClick={() => openEdit(ficha)} className="flex items-center text-xs text-primary-600 font-medium hover:text-primary-800">
                                        <Edit className="w-3.5 h-3.5 mr-1" />
                                        Editar composição
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Modal: Nova Ficha ─────────────────────────────────────────────────── */}
            {showNewModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-slate-900">Nova Ficha Técnica</h2>
                            <button onClick={() => setShowNewModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Produto</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="Ex: X-Tudo, Combo Simples"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                                    <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Preço de Venda (R$)</label>
                                    <input
                                        type="number"
                                        value={newPrice}
                                        onChange={e => setNewPrice(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="0.00"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowNewModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancelar</button>
                            <button
                                onClick={handleCreate}
                                disabled={savingNew || !newName.trim()}
                                className="px-5 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm shadow-sm"
                            >
                                {savingNew ? 'Criando...' : 'Criar Ficha'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Editar Composição ──────────────────────────────────────────── */}
            {editingId && editingFicha && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm overflow-y-auto z-50"
                    onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}
                >
                    <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-6">
                        <div className="bg-white w-full sm:rounded-2xl sm:max-w-2xl flex flex-col shadow-2xl">

                            {/* Header */}
                            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Composição</h2>
                                    <p className="text-sm text-slate-400">{editingFicha.product_name}</p>
                                </div>
                                <button onClick={() => setEditingId(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Preparos na composição */}
                            {editSubItems.length > 0 && (
                                <div className="px-6 pt-4">
                                    <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <ChefHat className="w-3.5 h-3.5" /> Preparos
                                    </p>
                                    <div className="space-y-2">
                                        {editSubItems.map((item, idx) => (
                                            <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-amber-50 rounded-xl border border-amber-100 group">
                                                <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.sub_recipe.product_name}</span>
                                                <input
                                                    type="number"
                                                    value={item.quantity_needed}
                                                    min="0.001"
                                                    onFocus={e => e.target.select()}
                                                    onChange={e => {
                                                        const next = [...editSubItems];
                                                        next[idx] = { ...next[idx], quantity_needed: Number(e.target.value) || 0 };
                                                        setEditSubItems(next);
                                                    }}
                                                    className="w-16 px-2 py-1 border border-amber-200 rounded-lg text-right text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                                                />
                                                <span className="text-xs text-slate-400 w-6">un</span>
                                                <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                                    {fmtMoney((preparoCostPerUnit[item.sub_recipe_id] ?? 0) * item.quantity_needed)}
                                                </span>
                                                <button
                                                    onClick={() => setEditSubItems(editSubItems.filter((_, i) => i !== idx))}
                                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Insumos (base + direto) na composição */}
                            {editIngItems.filter(i => i.ingredients.tipo !== 'embalagem').length > 0 && (
                                <div className="px-6 pt-4">
                                    <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <Package className="w-3.5 h-3.5" /> Insumos
                                    </p>
                                    <div className="space-y-2">
                                        {editIngItems.map((item, idx) => item.ingredients.tipo === 'embalagem' ? null : (
                                            <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-amber-50 rounded-xl border border-amber-100 group">
                                                <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.ingredients.name}</span>
                                                <input
                                                    type="number"
                                                    value={item.quantity_needed}
                                                    min="0.001"
                                                    onFocus={e => e.target.select()}
                                                    onChange={e => {
                                                        const next = [...editIngItems];
                                                        next[idx] = { ...next[idx], quantity_needed: Number(e.target.value) || 0 };
                                                        setEditIngItems(next);
                                                    }}
                                                    className="w-16 px-2 py-1 border border-amber-200 rounded-lg text-right text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                                                />
                                                <span className="text-xs text-slate-400 w-6">{item.ingredients.unit_type}</span>
                                                <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                                    {fmtMoney(item.ingredients.avg_cost_per_unit * item.quantity_needed)}
                                                </span>
                                                <button
                                                    onClick={() => setEditIngItems(editIngItems.filter((_, i) => i !== idx))}
                                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Embalagens na composição */}
                            {editIngItems.filter(i => i.ingredients.tipo === 'embalagem').length > 0 && (
                                <div className="px-6 pt-4">
                                    <p className="text-xs font-bold text-purple-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <Package className="w-3.5 h-3.5" /> Embalagens
                                    </p>
                                    <div className="space-y-2">
                                        {editIngItems.map((item, idx) => item.ingredients.tipo !== 'embalagem' ? null : (
                                            <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-purple-50 rounded-xl border border-purple-100 group">
                                                <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.ingredients.name}</span>
                                                <input
                                                    type="number"
                                                    value={item.quantity_needed}
                                                    min="0.001"
                                                    onFocus={e => e.target.select()}
                                                    onChange={e => {
                                                        const next = [...editIngItems];
                                                        next[idx] = { ...next[idx], quantity_needed: Number(e.target.value) || 0 };
                                                        setEditIngItems(next);
                                                    }}
                                                    className="w-16 px-2 py-1 border border-purple-200 rounded-lg text-right text-sm focus:ring-2 focus:ring-purple-400 outline-none bg-white"
                                                />
                                                <span className="text-xs text-slate-400 w-6">{item.ingredients.unit_type}</span>
                                                <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                                    {fmtMoney(item.ingredients.avg_cost_per_unit * item.quantity_needed)}
                                                </span>
                                                <button
                                                    onClick={() => setEditIngItems(editIngItems.filter((_, i) => i !== idx))}
                                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {editSubItems.length === 0 && editIngItems.length === 0 && (
                                <div className="px-6 py-8 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl mx-6 mt-4 text-sm">
                                    Composição vazia. Adicione preparos ou itens prontos abaixo.
                                </div>
                            )}

                            {/* Seção de adição — tabs */}
                            <div className="px-6 pt-5 pb-2 border-t border-slate-100 mt-4 shrink-0">
                                {/* Tabs */}
                                <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit mb-4">
                                    <button
                                        onClick={() => setAddTab('preparo')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${addTab === 'preparo' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        <ChefHat className="w-3.5 h-3.5" /> Receita
                                    </button>
                                    <button
                                        onClick={() => setAddTab('insumo')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${addTab === 'insumo' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        <Package className="w-3.5 h-3.5" /> Item Pronto
                                    </button>
                                    <button
                                        onClick={() => setAddTab('embalagem')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${addTab === 'embalagem' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        <Package className="w-3.5 h-3.5" /> Embalagem
                                    </button>
                                </div>

                                {/* Picker: Preparos */}
                                {addTab === 'preparo' && (
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-amber-400 focus-within:border-transparent">
                                                <ChefHat className="w-4 h-4 text-slate-400 shrink-0" />
                                                <input
                                                    type="text"
                                                    placeholder={selPrepId ? allRecipesForPicker.find(p => p.id === selPrepId)?.product_name : 'Buscar receita ou preparo...'}
                                                    value={selPrepId ? (allRecipesForPicker.find(p => p.id === selPrepId)?.product_name ?? '') : prepSearch}
                                                    onChange={e => { setPrepSearch(e.target.value); setSelPrepId(''); setPrepDropdown(true); }}
                                                    onFocus={() => setPrepDropdown(true)}
                                                    onBlur={() => setTimeout(() => setPrepDropdown(false), 150)}
                                                    className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                                />
                                                {selPrepId && (
                                                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setSelPrepId(''); setPrepSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            {prepDropdown && !selPrepId && (
                                                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                    {filteredPrepDropdown.length === 0
                                                        ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum preparo disponível.</p>
                                                        : filteredPrepDropdown.map(p => (
                                                            <div
                                                                key={p.id}
                                                                onMouseDown={e => e.preventDefault()}
                                                                onClick={() => { setSelPrepId(p.id); setPrepSearch(''); setPrepDropdown(false); }}
                                                                className="px-4 py-2.5 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                                                            >
                                                                <span className="text-sm font-medium text-slate-700">{p.product_name}</span>
                                                                <span className="text-xs text-amber-600 font-semibold">
                                                                    {p.tipo === 'ficha_final' ? fmtMoney(fichaCostMap[p.id] ?? 0) : `${fmtMoney(preparoCostPerUnit[p.id] ?? 0)}/un`}
                                                                </span>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="number"
                                            value={selPrepQty}
                                            onChange={e => setSelPrepQty(e.target.value === '' ? '' : Number(e.target.value))}
                                            placeholder="Qtd"
                                            className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        <button
                                            onClick={handleAddPreparo}
                                            disabled={!selPrepId || selPrepQty === '' || Number(selPrepQty) <= 0}
                                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg shrink-0"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                )}

                                {/* Picker: Insumos Diretos */}
                                {addTab === 'insumo' && (
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-amber-400 focus-within:border-transparent">
                                                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                                                <input
                                                    type="text"
                                                    placeholder={selIngId ? insumosDiretos.find(i => i.id === selIngId)?.name : 'Buscar item pronto...'}
                                                    value={selIngId ? (insumosDiretos.find(i => i.id === selIngId)?.name ?? '') : ingSearch}
                                                    onChange={e => { setIngSearch(e.target.value); setSelIngId(''); setIngDropdown(true); }}
                                                    onFocus={() => setIngDropdown(true)}
                                                    onBlur={() => setTimeout(() => setIngDropdown(false), 150)}
                                                    className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                                />
                                                {selIngId && (
                                                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setSelIngId(''); setIngSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            {ingDropdown && !selIngId && (
                                                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                    {filteredIngDropdown.length === 0
                                                        ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum item pronto encontrado.</p>
                                                        : filteredIngDropdown.map(ing => (
                                                            <div
                                                                key={ing.id}
                                                                onMouseDown={e => e.preventDefault()}
                                                                onClick={() => { setSelIngId(ing.id); setIngSearch(''); setIngDropdown(false); }}
                                                                className="px-4 py-2.5 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                                                            >
                                                                <span className="text-sm font-medium text-slate-700">{ing.name}</span>
                                                                <span className="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded">{ing.unit_type}</span>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="number"
                                            value={selIngQty}
                                            onChange={e => setSelIngQty(e.target.value === '' ? '' : Number(e.target.value))}
                                            placeholder="Qtd"
                                            className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        <button
                                            onClick={handleAddInsumo}
                                            disabled={!selIngId || selIngQty === '' || Number(selIngQty) <= 0}
                                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg shrink-0"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                )}

                                {/* Picker: Embalagens */}
                                {addTab === 'embalagem' && (
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-purple-400 focus-within:border-transparent">
                                                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                                                <input
                                                    type="text"
                                                    placeholder={selEmbalId ? embalagens.find(e => e.id === selEmbalId)?.name : 'Buscar embalagem...'}
                                                    value={selEmbalId ? (embalagens.find(e => e.id === selEmbalId)?.name ?? '') : embalSearch}
                                                    onChange={e => { setEmbalSearch(e.target.value); setSelEmbalId(''); setEmbalDropdown(true); }}
                                                    onFocus={() => setEmbalDropdown(true)}
                                                    onBlur={() => setTimeout(() => setEmbalDropdown(false), 150)}
                                                    className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                                />
                                                {selEmbalId && (
                                                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setSelEmbalId(''); setEmbalSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            {embalDropdown && !selEmbalId && (
                                                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                    {filteredEmbalDropdown.length === 0
                                                        ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhuma embalagem encontrada.</p>
                                                        : filteredEmbalDropdown.map(emb => (
                                                            <div
                                                                key={emb.id}
                                                                onMouseDown={e => e.preventDefault()}
                                                                onClick={() => { setSelEmbalId(emb.id); setEmbalSearch(''); setEmbalDropdown(false); }}
                                                                className="px-4 py-2.5 hover:bg-purple-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                                                            >
                                                                <span className="text-sm font-medium text-slate-700">{emb.name}</span>
                                                                <span className="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded">{emb.unit_type}</span>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="number"
                                            value={selEmbalQty}
                                            onChange={e => setSelEmbalQty(e.target.value === '' ? '' : Number(e.target.value))}
                                            placeholder="Qtd"
                                            className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-purple-400 outline-none"
                                        />
                                        <button
                                            onClick={handleAddEmbalagem}
                                            disabled={!selEmbalId || selEmbalQty === '' || Number(selEmbalQty) <= 0}
                                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg shrink-0"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 sm:rounded-b-2xl flex justify-between items-center shrink-0">
                                <div className="text-sm text-slate-500">
                                    Custo total: <strong className="text-slate-900 text-base">{fmtMoney(editTotalCost)}</strong>
                                    {editingFicha.sale_price > 0 && (
                                        <span className={`ml-3 font-bold ${editTotalCost / editingFicha.sale_price < 0.3 ? 'text-green-600' : editTotalCost / editingFicha.sale_price < 0.4 ? 'text-amber-600' : 'text-red-600'}`}>
                                            CMV {(editTotalCost / editingFicha.sale_price * 100).toFixed(1)}%
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setEditingId(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancelar</button>
                                    <button
                                        onClick={handleSaveComposition}
                                        disabled={savingEdit}
                                        className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold shadow-sm disabled:opacity-50"
                                    >
                                        {savingEdit ? 'Salvando...' : 'Salvar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
