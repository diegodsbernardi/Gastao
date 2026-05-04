import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ChefHat, Plus, Trash2, Edit, Search, X, ArrowRight, Link2, Layers } from 'lucide-react';
import type { Ingredient, Recipe, RecipeIngredient } from '../lib/types';
import { fmtMoney, fmtQty } from '../lib/format';
import { buildPreparoCostMapRecursive, type PreparoNode } from '../lib/costCalculator';

const UNIT_OPTIONS = ['un', 'porção', 'g', 'ml', 'kg', 'l'];

// Sub-preparo dentro de outro preparo (linha em recipe_ingredients com sub_recipe_id preenchido)
interface PreparoSubEntry {
    id: string; // id local temporário ou real do row em recipe_ingredients
    recipe_id: string;
    sub_recipe_id: string;
    quantity_needed: number;
    sub_recipe: {
        id: string;
        product_name: string;
        unit_type: string;
        yield_quantity: number;
    };
}

export const Preparos = () => {
    const { user, restauranteId } = useAuth();

    const [preparos, setPreparos] = useState<Recipe[]>([]);
    const [ingredients, setIngredients] = useState<Ingredient[]>([]);
    const [compositions, setCompositions] = useState<Record<string, RecipeIngredient[]>>({});
    // Sub-preparos usados por cada preparo (preparo pai → lista de sub-preparos)
    const [subCompositions, setSubCompositions] = useState<Record<string, PreparoSubEntry[]>>({});
    // Quem usa esse preparo como sub-componente (preparo → fichas/preparos que dependem)
    const [usedByMap, setUsedByMap] = useState<Record<string, { id: string; name: string; kind: 'ficha' | 'preparo' }[]>>({});
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('Todas');
    const [customCategories, setCustomCategories] = useState<string[]>([]);

    // Modal: novo preparo
    const [showNewModal, setShowNewModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newUnit, setNewUnit] = useState('un');
    const [newYield, setNewYield] = useState<number | ''>(1);
    const [savingNew, setSavingNew] = useState(false);
    const [newItems, setNewItems] = useState<RecipeIngredient[]>([]);
    const [newSubItems, setNewSubItems] = useState<PreparoSubEntry[]>([]);
    const [newIngSearch, setNewIngSearch] = useState('');
    const [newSelIngId, setNewSelIngId] = useState('');
    const [newSelQty, setNewSelQty] = useState<number | ''>('');
    const [newDropdown, setNewDropdown] = useState(false);
    const [newInputUnit, setNewInputUnit] = useState<'kg' | 'g'>('kg');
    const [newSubSearch, setNewSubSearch] = useState('');
    const [newSelSubId, setNewSelSubId] = useState('');
    const [newSelSubQty, setNewSelSubQty] = useState<number | ''>('');
    const [newSubDropdown, setNewSubDropdown] = useState(false);

    // Modal: editar composição + info básica
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editItems, setEditItems] = useState<RecipeIngredient[]>([]);
    const [editSubItems, setEditSubItems] = useState<PreparoSubEntry[]>([]);
    const [editItemUnits, setEditItemUnits] = useState<Record<number, 'kg' | 'g'>>({});
    const [editPreparoName, setEditPreparoName] = useState('');
    const [editPreparoYield, setEditPreparoYield] = useState<number | ''>(1);
    const [editPreparoUnit, setEditPreparoUnit] = useState('un');
    const [ingSearch, setIngSearch] = useState('');
    const [selectedIngId, setSelectedIngId] = useState('');
    const [editInputUnit, setEditInputUnit] = useState<'kg' | 'g'>('kg');
    const [selectedQty, setSelectedQty] = useState<number | ''>('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [subSearch, setSubSearch] = useState('');
    const [selectedSubId, setSelectedSubId] = useState('');
    const [selectedSubQty, setSelectedSubQty] = useState<number | ''>('');
    const [subDropdownOpen, setSubDropdownOpen] = useState(false);

    useEffect(() => {
        if (user) fetchData();
    }, [user]);

    const fetchData = async () => {
        setLoading(true);

        const [preparosRes, ingredientsRes, compositionsRes, subsRes, catsRes] = await Promise.all([
            supabase.from('recipes').select('*').eq('tipo', 'preparo').order('product_name'),
            supabase.from('ingredients').select('*').eq('tipo', 'insumo_base').order('name'),
            // Agora trazemos sub_recipe_id também + join do sub-preparo
            supabase.from('recipe_ingredients').select(`
                id, recipe_id, ingredient_id, sub_recipe_id, quantity_needed,
                ingredients ( id, name, unit_type, avg_cost_per_unit, aproveitamento, tipo ),
                sub_recipe:recipes!recipe_ingredients_sub_recipe_id_fkey ( id, product_name, unit_type, yield_quantity, tipo )
            `),
            // Uso reverso: fichas que usam cada preparo (via recipe_sub_recipes)
            supabase.from('recipe_sub_recipes').select(`
                recipe_id, sub_recipe_id,
                parent:recipes!recipe_sub_recipes_recipe_id_fkey ( id, product_name, tipo )
            `),
            supabase.from('recipe_categories').select('name').eq('recipe_tipo', 'preparo').order('name'),
        ]);

        if (preparosRes.data) setPreparos(preparosRes.data);
        if (ingredientsRes.data) setIngredients(ingredientsRes.data);
        if (catsRes.data) setCustomCategories(catsRes.data.map((c: any) => c.name));

        const ingsGrouped: Record<string, RecipeIngredient[]> = {};
        const subsGrouped: Record<string, PreparoSubEntry[]> = {};

        if (compositionsRes.data) {
            compositionsRes.data.forEach((item: any) => {
                if (item.ingredient_id && item.ingredients) {
                    if (!ingsGrouped[item.recipe_id]) ingsGrouped[item.recipe_id] = [];
                    ingsGrouped[item.recipe_id].push(item);
                } else if (item.sub_recipe_id && item.sub_recipe) {
                    if (!subsGrouped[item.recipe_id]) subsGrouped[item.recipe_id] = [];
                    subsGrouped[item.recipe_id].push({
                        id: item.id,
                        recipe_id: item.recipe_id,
                        sub_recipe_id: item.sub_recipe_id,
                        quantity_needed: item.quantity_needed,
                        sub_recipe: item.sub_recipe,
                    });
                }
            });
        }

        setCompositions(ingsGrouped);
        setSubCompositions(subsGrouped);

        // Uso reverso: fichas E também preparos (via recipe_ingredients.sub_recipe_id) que usam esse preparo
        const reverse: Record<string, { id: string; name: string; kind: 'ficha' | 'preparo' }[]> = {};

        if (subsRes.data) {
            subsRes.data.forEach((item: any) => {
                if (!item.parent) return;
                if (item.recipe_id === item.sub_recipe_id) return;
                if (!reverse[item.sub_recipe_id]) reverse[item.sub_recipe_id] = [];
                reverse[item.sub_recipe_id].push({ id: item.parent.id, name: item.parent.product_name, kind: 'ficha' });
            });
        }
        // Preparo A que usa preparo B → B.usedByMap inclui A
        if (compositionsRes.data) {
            compositionsRes.data.forEach((item: any) => {
                if (!item.sub_recipe_id || !item.sub_recipe) return;
                if (item.recipe_id === item.sub_recipe_id) return;
                // Parent recipe precisa ser um preparo — mas não temos isso no select. Inferir pelo preparos[]:
                // (fazemos o enrich depois que `preparos` estiver carregado — por isso usamos State)
                if (!reverse[item.sub_recipe_id]) reverse[item.sub_recipe_id] = [];
                reverse[item.sub_recipe_id].push({ id: item.recipe_id, name: '(preparo)', kind: 'preparo' });
            });
        }
        setUsedByMap(reverse);

        setLoading(false);
    };

    // Ajuste fino do usedByMap: preencher os nomes de preparos que usam X (linhas "kind: preparo")
    useEffect(() => {
        if (preparos.length === 0) return;
        setUsedByMap(prev => {
            const next: typeof prev = {};
            for (const [key, list] of Object.entries(prev)) {
                next[key] = list.map(e => {
                    if (e.kind !== 'preparo' || e.name !== '(preparo)') return e;
                    const p = preparos.find(pp => pp.id === e.id);
                    return { ...e, name: p?.product_name ?? '(preparo)' };
                });
            }
            return next;
        });
    }, [preparos.length]);

    // Descendentes recursivos por preparo (para bloquear ciclo no picker)
    const descendantsMap = useMemo(() => {
        const adj: Record<string, string[]> = {};
        preparos.forEach(p => {
            adj[p.id] = (subCompositions[p.id] ?? []).map(s => s.sub_recipe_id);
        });
        const cache: Record<string, Set<string>> = {};
        const visit = (id: string, seen = new Set<string>()): Set<string> => {
            if (cache[id]) return cache[id];
            if (seen.has(id)) return new Set();
            seen.add(id);
            const out = new Set<string>();
            for (const d of adj[id] ?? []) {
                out.add(d);
                visit(d, seen).forEach(x => out.add(x));
            }
            cache[id] = out;
            return out;
        };
        preparos.forEach(p => visit(p.id));
        return cache;
    }, [preparos, subCompositions]);

    // Cálculo de custo recursivo (trata sub-preparos e profundidade arbitrária)
    const costMap = useMemo(() => {
        const nodes: PreparoNode[] = preparos.map(p => ({
            id: p.id,
            yield_quantity: p.yield_quantity || 1,
            ingredients: (compositions[p.id] ?? []).map(i => ({
                avg_cost_per_unit: i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1),
                quantity_needed: i.quantity_needed,
            })),
            subRecipes: (subCompositions[p.id] ?? []).map(s => ({
                sub_recipe_id: s.sub_recipe_id,
                quantity_needed: s.quantity_needed,
            })),
        }));
        const { costPerUnit } = buildPreparoCostMapRecursive(nodes);
        const map: Record<string, { total: number; perUnit: number }> = {};
        preparos.forEach(p => {
            const perUnit = costPerUnit[p.id] ?? 0;
            map[p.id] = { total: perUnit * (p.yield_quantity || 1), perUnit };
        });
        return map;
    }, [preparos, compositions, subCompositions]);

    // Chips de categoria: união de categorias usadas pelos preparos + cadastradas em recipe_categories.
    // 'Preparo' (default do create manual) não polui o filtro.
    const categories = useMemo(() => {
        const fromPreparos = preparos
            .map(p => p.category)
            .filter((c): c is string => !!c && c !== 'Preparo');
        return ['Todas', ...Array.from(new Set([...fromPreparos, ...customCategories]))];
    }, [preparos, customCategories]);

    const filteredPreparos = useMemo(
        () => preparos.filter(p => {
            const matchSearch = p.product_name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchCat = activeCategory === 'Todas' || p.category === activeCategory;
            return matchSearch && matchCat;
        }),
        [preparos, searchQuery, activeCategory]
    );

    // Sub-preparos permitidos quando editando X:
    //   P é permitido sse P != X e X ∉ descendants(P) e P não está já na lista
    const allowedSubPreparosForEdit = useMemo(() => {
        if (!editingId) return [];
        return preparos.filter(p => {
            if (p.id === editingId) return false;
            if (descendantsMap[p.id]?.has(editingId)) return false;
            if (editSubItems.some(s => s.sub_recipe_id === p.id)) return false;
            return true;
        });
    }, [preparos, editingId, descendantsMap, editSubItems]);

    // No fluxo de criação, não há X ainda → qualquer preparo é permitido (exceto os já adicionados)
    const allowedSubPreparosForNew = useMemo(
        () => preparos.filter(p => !newSubItems.some(s => s.sub_recipe_id === p.id)),
        [preparos, newSubItems],
    );

    const handleCreate = async () => {
        if (!newName.trim() || !restauranteId) return;
        setSavingNew(true);

        const { data, error } = await supabase.from('recipes').insert([{
            restaurant_id: restauranteId,
            product_name: newName.trim(),
            tipo: 'preparo',
            category: 'Preparo',
            sale_price: 0,
            yield_quantity: Number(newYield) || 1,
            unit_type: newUnit,
        }]).select().single();

        if (!error && data) {
            const rows: any[] = [];
            newItems.forEach(i => rows.push({
                recipe_id: data.id,
                ingredient_id: i.ingredient_id,
                quantity_needed: i.quantity_needed,
            }));
            newSubItems.forEach(s => rows.push({
                recipe_id: data.id,
                sub_recipe_id: s.sub_recipe_id,
                quantity_needed: s.quantity_needed,
            }));
            if (rows.length > 0) {
                const { error: compErr } = await supabase.from('recipe_ingredients').insert(rows);
                if (compErr) {
                    toast.error('Erro ao salvar composição: ' + compErr.message);
                } else {
                    setCompositions(prev => ({
                        ...prev,
                        [data.id]: newItems.map(i => ({ ...i, recipe_id: data.id })),
                    }));
                    setSubCompositions(prev => ({
                        ...prev,
                        [data.id]: newSubItems.map(s => ({ ...s, recipe_id: data.id })),
                    }));
                }
            }
            setPreparos(prev => [...prev, data].sort((a, b) => a.product_name.localeCompare(b.product_name)));
            setShowNewModal(false);
            setNewName(''); setNewUnit('un'); setNewYield(1);
            setNewItems([]); setNewSubItems([]);
            setNewIngSearch(''); setNewSelIngId(''); setNewSelQty('');
            setNewSubSearch(''); setNewSelSubId(''); setNewSelSubQty('');
            toast.success('Preparo criado!');
        } else {
            toast.error('Erro ao criar: ' + error?.message);
        }
        setSavingNew(false);
    };

    const handleAddNewItem = () => {
        if (!newSelIngId || newSelQty === '' || Number(newSelQty) <= 0) return;
        const ing = ingredients.find(i => i.id === newSelIngId);
        if (!ing) return;
        const qty = ing.unit_type === 'kg' && newInputUnit === 'g'
            ? Number(newSelQty) / 1000
            : Number(newSelQty);
        setNewItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: '',
            ingredient_id: ing.id,
            quantity_needed: qty,
            ingredients: ing,
        }]);
        setNewSelIngId(''); setNewIngSearch(''); setNewSelQty('');
    };

    const handleAddNewSubItem = () => {
        if (!newSelSubId || newSelSubQty === '' || Number(newSelSubQty) <= 0) return;
        const sub = preparos.find(p => p.id === newSelSubId);
        if (!sub) return;
        setNewSubItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: '',
            sub_recipe_id: sub.id,
            quantity_needed: Number(newSelSubQty),
            sub_recipe: {
                id: sub.id,
                product_name: sub.product_name,
                unit_type: sub.unit_type ?? 'un',
                yield_quantity: sub.yield_quantity,
            },
        }]);
        setNewSelSubId(''); setNewSubSearch(''); setNewSelSubQty('');
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Excluir este preparo? Esta ação não pode ser desfeita.')) return;

        // Remove auto-referência antes do delete (evita FK RESTRICT no loop)
        await supabase
            .from('recipe_sub_recipes')
            .delete()
            .eq('recipe_id', id)
            .eq('sub_recipe_id', id);

        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (!error) {
            setPreparos(prev => prev.filter(p => p.id !== id));
            toast.success('Preparo excluído.');
            return;
        }
        if (error.code === '23503') {
            const deps = usedByMap[id] ?? [];
            const lista = deps.map(d => d.name).join(', ');
            toast.error(
                deps.length
                    ? `Esse preparo é usado em ${deps.length} receita(s): ${lista}. Remova a referência antes de excluir.`
                    : 'Esse preparo está sendo usado em outra receita. Remova a referência antes de excluir.',
                { duration: 7000 },
            );
            return;
        }
        toast.error('Erro ao excluir: ' + error.message);
    };

    const openEditModal = (preparo: Recipe) => {
        setEditingId(preparo.id);
        setEditItems(JSON.parse(JSON.stringify(compositions[preparo.id] ?? [])));
        setEditSubItems(JSON.parse(JSON.stringify(subCompositions[preparo.id] ?? [])));
        setEditItemUnits({});
        setEditPreparoName(preparo.product_name);
        setEditPreparoYield(preparo.yield_quantity);
        setEditPreparoUnit(preparo.unit_type ?? 'un');
        setIngSearch(''); setSelectedIngId(''); setSelectedQty('');
        setSubSearch(''); setSelectedSubId(''); setSelectedSubQty('');
    };

    const handleAddItem = () => {
        if (!selectedIngId || selectedQty === '' || Number(selectedQty) <= 0) return;
        const ing = ingredients.find(i => i.id === selectedIngId);
        if (!ing) return;
        const qty = ing.unit_type === 'kg' && editInputUnit === 'g'
            ? Number(selectedQty) / 1000
            : Number(selectedQty);
        setEditItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: editingId!,
            ingredient_id: ing.id,
            quantity_needed: qty,
            ingredients: ing,
        }]);
        setSelectedIngId(''); setIngSearch(''); setSelectedQty('');
    };

    const handleAddSubItem = () => {
        if (!selectedSubId || selectedSubQty === '' || Number(selectedSubQty) <= 0) return;
        const sub = preparos.find(p => p.id === selectedSubId);
        if (!sub) return;
        setEditSubItems(prev => [...prev, {
            id: Math.random().toString(),
            recipe_id: editingId!,
            sub_recipe_id: sub.id,
            quantity_needed: Number(selectedSubQty),
            sub_recipe: {
                id: sub.id,
                product_name: sub.product_name,
                unit_type: sub.unit_type ?? 'un',
                yield_quantity: sub.yield_quantity,
            },
        }]);
        setSelectedSubId(''); setSubSearch(''); setSelectedSubQty('');
    };

    const handleSaveComposition = async () => {
        if (!editingId) return;
        setSavingEdit(true);

        // Apaga TODA a composição (insumos + sub-preparos) e re-insere
        const { error: delError } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', editingId);
        if (delError) {
            toast.error('Erro ao salvar: ' + delError.message);
            setSavingEdit(false);
            return;
        }

        const rows: any[] = [];
        editItems.forEach(ei => rows.push({
            recipe_id: editingId,
            ingredient_id: ei.ingredient_id,
            quantity_needed: ei.quantity_needed,
        }));
        editSubItems.forEach(es => rows.push({
            recipe_id: editingId,
            sub_recipe_id: es.sub_recipe_id,
            quantity_needed: es.quantity_needed,
        }));

        if (rows.length > 0) {
            const { error: insError } = await supabase.from('recipe_ingredients').insert(rows);
            if (insError) {
                toast.error('Erro ao salvar composição: ' + insError.message);
                setSavingEdit(false);
                fetchData();
                return;
            }
        }

        // Salva metadados
        await supabase.from('recipes').update({
            product_name: editPreparoName.trim() || editingPreparo?.product_name,
            yield_quantity: Number(editPreparoYield) || 1,
            unit_type: editPreparoUnit,
        }).eq('id', editingId);

        setPreparos(prev => prev.map(p => p.id === editingId
            ? { ...p, product_name: editPreparoName.trim() || p.product_name, yield_quantity: Number(editPreparoYield) || 1, unit_type: editPreparoUnit }
            : p
        ));
        setCompositions(prev => ({ ...prev, [editingId]: editItems }));
        setSubCompositions(prev => ({ ...prev, [editingId]: editSubItems }));
        setEditingId(null);
        setSavingEdit(false);
        toast.success('Preparo salvo!');
    };

    const editingPreparo = preparos.find(p => p.id === editingId);

    // Custo durante edição — usa estado local (editItems + editSubItems) + custo resolvido dos OUTROS preparos
    const editCosts = useMemo(() => {
        const ingCost = editItems.reduce(
            (acc, i) => acc + ((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed), 0,
        );
        const subCost = editSubItems.reduce(
            (acc, s) => acc + (costMap[s.sub_recipe_id]?.perUnit ?? 0) * s.quantity_needed, 0,
        );
        const total = ingCost + subCost;
        const perUnit = total / (Number(editPreparoYield) || editingPreparo?.yield_quantity || 1);
        return { total, perUnit };
    }, [editItems, editSubItems, editPreparoYield, editingPreparo, costMap]);

    // Custo durante criação
    const newCosts = useMemo(() => {
        const ingCost = newItems.reduce(
            (acc, i) => acc + ((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed), 0,
        );
        const subCost = newSubItems.reduce(
            (acc, s) => acc + (costMap[s.sub_recipe_id]?.perUnit ?? 0) * s.quantity_needed, 0,
        );
        return (ingCost + subCost) / (Number(newYield) || 1);
    }, [newItems, newSubItems, newYield, costMap]);

    const filteredDropdown = ingredients
        .filter(i => !editItems.some(ei => ei.ingredient_id === i.id))
        .filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()));

    const filteredNewDropdown = ingredients
        .filter(i => !newItems.some(ni => ni.ingredient_id === i.id))
        .filter(i => i.name.toLowerCase().includes(newIngSearch.toLowerCase()));

    const filteredSubDropdown = allowedSubPreparosForEdit
        .filter(p => p.product_name.toLowerCase().includes(subSearch.toLowerCase()));

    const filteredNewSubDropdown = allowedSubPreparosForNew
        .filter(p => p.product_name.toLowerCase().includes(newSubSearch.toLowerCase()));

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-4">
                {[1, 2, 3].map(n => (
                    <div key={n} className="h-32 bg-white rounded-2xl border border-slate-200 animate-pulse" />
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
                        <ChefHat className="w-5 h-5 sm:w-6 sm:h-6 mr-2.5 text-amber-500" />
                        Preparos
                    </h1>
                    <p className="text-slate-500 mt-1 hidden sm:block">
                        Mini-receitas reutilizáveis. Podem usar outros preparos (molhos base, fundos, massas).
                    </p>
                </div>
                <button
                    onClick={() => setShowNewModal(true)}
                    className="mt-3 sm:mt-0 w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 transition-colors shadow-sm text-sm"
                >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Novo Preparo
                </button>
            </div>

            {/* Filtros: chips de categoria + busca */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                {categories.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${activeCategory === cat ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                ) : <div />}
                <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar preparos..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                    />
                </div>
            </div>

            {/* Lista */}
            {filteredPreparos.length === 0 ? (
                <div className="py-16 text-center text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">
                    <ChefHat className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">Nenhum preparo cadastrado.</p>
                    <p className="text-sm mt-1">Crie preparos como "Molho de Tomate Base", "Ragu", "Molho Rosé".</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filteredPreparos.map(preparo => {
                        const { total, perUnit } = costMap[preparo.id] ?? { total: 0, perUnit: 0 };
                        const items = compositions[preparo.id] ?? [];
                        const subItems = subCompositions[preparo.id] ?? [];
                        const usedBy = usedByMap[preparo.id] ?? [];

                        return (
                            <div key={preparo.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                {/* Card header */}
                                <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex justify-between items-start">
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-base">{preparo.product_name}</h3>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Rende: <strong>{preparo.yield_quantity} {preparo.unit_type}</strong>
                                        </p>
                                        {usedBy.length > 0 && (
                                            <span
                                                title={`Usado em: ${usedBy.map(d => d.name).join(', ')}`}
                                                className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-white text-amber-700 border border-amber-300"
                                            >
                                                <Link2 className="w-3 h-3" />
                                                Usado em {usedBy.length} receita{usedBy.length > 1 ? 's' : ''}
                                            </span>
                                        )}
                                        {subItems.length > 0 && (
                                            <span className="inline-flex items-center gap-1 mt-1.5 ml-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                <Layers className="w-3 h-3" />
                                                Composto ({subItems.length} sub-preparo{subItems.length > 1 ? 's' : ''})
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="text-right">
                                            <p className="text-xs text-slate-400">Custo / un</p>
                                            <p className="text-base font-bold text-amber-600">{fmtMoney(perUnit)}</p>
                                        </div>
                                        <button
                                            onClick={() => handleDelete(preparo.id)}
                                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Composição */}
                                <div className="px-5 py-4">
                                    {items.length === 0 && subItems.length === 0 ? (
                                        <p className="text-sm text-slate-400 italic">Sem composição. Clique em "Editar" para compor.</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {subItems.map(sub => {
                                                const subPerUnit = costMap[sub.sub_recipe_id]?.perUnit ?? 0;
                                                return (
                                                    <li key={sub.id} className="flex justify-between items-center text-sm bg-indigo-50/50 -mx-2 px-2 py-1 rounded">
                                                        <span className="text-slate-700 font-medium flex items-center gap-1.5">
                                                            <Layers className="w-3 h-3 text-indigo-500" />
                                                            {sub.sub_recipe.product_name}
                                                            <span className="text-xs text-indigo-600 font-normal">(preparo)</span>
                                                        </span>
                                                        <div className="flex items-center gap-3 text-slate-500">
                                                            <span>{sub.quantity_needed} {sub.sub_recipe.unit_type}</span>
                                                            <ArrowRight className="w-3 h-3 text-slate-300" />
                                                            <span className="font-semibold text-slate-700">
                                                                {fmtMoney(subPerUnit * sub.quantity_needed)}
                                                            </span>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                            {items.map(item => (
                                                <li key={item.id} className="flex justify-between items-center text-sm">
                                                    <span className="text-slate-700 font-medium">{item.ingredients.name}</span>
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <span>{fmtQty(item.quantity_needed, item.ingredients.unit_type)} {item.ingredients.unit_type}</span>
                                                        <ArrowRight className="w-3 h-3 text-slate-300" />
                                                        <span className="font-semibold text-slate-700">
                                                            {fmtMoney((item.ingredients.avg_cost_per_unit / (item.ingredients.aproveitamento || 1)) * item.quantity_needed)}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="px-5 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50">
                                    <span className="text-xs text-slate-500">
                                        Custo total: <strong className="text-slate-700">{fmtMoney(total)}</strong>
                                    </span>
                                    <button
                                        onClick={() => openEditModal(preparo)}
                                        className="flex items-center text-xs text-amber-600 font-medium hover:text-amber-800"
                                    >
                                        <Edit className="w-3.5 h-3.5 mr-1" />
                                        Editar composição
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal: Novo Preparo */}
            {showNewModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm overflow-y-auto z-50">
                    <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-6">
                        <div className="bg-white w-full sm:rounded-2xl sm:max-w-xl flex flex-col shadow-2xl">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                                <h2 className="text-lg font-bold text-slate-900">Novo Preparo</h2>
                                <button onClick={() => { setShowNewModal(false); setNewItems([]); setNewSubItems([]); }} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Campos básicos */}
                            <div className="p-6 space-y-4 border-b border-slate-100">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Preparo</label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={e => setNewName(e.target.value)}
                                        placeholder='Ex: Molho de Tomate Base, Ragu, Molho Rosé'
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm"
                                        autoFocus
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Unidade de saída</label>
                                        <select value={newUnit} onChange={e => setNewUnit(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white">
                                            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Rendimento</label>
                                        <input type="number" value={newYield} onChange={e => setNewYield(e.target.value === '' ? '' : Number(e.target.value))} placeholder='1' min={1} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" />
                                        <p className="text-xs text-slate-400 mt-1">Quantas unidades produz</p>
                                    </div>
                                </div>
                            </div>

                            {/* Sub-preparos */}
                            {preparos.length > 0 && (
                                <div className="px-6 py-4 space-y-2 border-b border-slate-100 bg-indigo-50/30">
                                    <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                        <Layers className="w-3.5 h-3.5" />
                                        Sub-preparos (opcional)
                                    </p>
                                    {newSubItems.length > 0 && newSubItems.map((item, idx) => (
                                        <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-indigo-200 group">
                                            <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                            <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.sub_recipe.product_name}</span>
                                            <input
                                                type="number"
                                                value={item.quantity_needed}
                                                min="0.001"
                                                onFocus={e => e.target.select()}
                                                onChange={e => {
                                                    const next = [...newSubItems];
                                                    next[idx] = { ...next[idx], quantity_needed: Number(e.target.value) || 0 };
                                                    setNewSubItems(next);
                                                }}
                                                className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
                                            />
                                            <span className="text-xs text-slate-400 w-8 font-medium">{item.sub_recipe.unit_type}</span>
                                            <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                                {fmtMoney((costMap[item.sub_recipe_id]?.perUnit ?? 0) * item.quantity_needed)}
                                            </span>
                                            <button onClick={() => setNewSubItems(newSubItems.filter((_, i) => i !== idx))} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {/* Picker sub-preparo */}
                                    <div className="flex flex-col gap-2">
                                        <div className="relative">
                                            <div className="flex items-center gap-2 px-3 py-2 border border-indigo-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-indigo-400">
                                                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                                <input
                                                    type="text"
                                                    placeholder={newSelSubId ? preparos.find(p => p.id === newSelSubId)?.product_name : 'Buscar preparo para usar como base...'}
                                                    value={newSelSubId ? (preparos.find(p => p.id === newSelSubId)?.product_name ?? '') : newSubSearch}
                                                    onChange={e => { setNewSubSearch(e.target.value); setNewSelSubId(''); setNewSubDropdown(true); }}
                                                    onFocus={() => setNewSubDropdown(true)}
                                                    onBlur={() => setTimeout(() => setNewSubDropdown(false), 150)}
                                                    className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                                />
                                                {newSelSubId && (
                                                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setNewSelSubId(''); setNewSubSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            {newSubDropdown && !newSelSubId && (
                                                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-indigo-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                    {filteredNewSubDropdown.length === 0
                                                        ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum preparo disponível.</p>
                                                        : filteredNewSubDropdown.map(p => (
                                                            <div key={p.id} onMouseDown={e => e.preventDefault()} onClick={() => { setNewSelSubId(p.id); setNewSubSearch(''); setNewSubDropdown(false); }} className="px-4 py-2.5 hover:bg-indigo-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0">
                                                                <span className="text-sm font-medium text-slate-700">{p.product_name}</span>
                                                                <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded">{p.unit_type}</span>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <input type="number" value={newSelSubQty} onChange={e => setNewSelSubQty(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Qtd" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-indigo-400 outline-none" />
                                            <button onClick={handleAddNewSubItem} disabled={!newSelSubId || newSelSubQty === '' || Number(newSelSubQty) <= 0} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors shrink-0">
                                                + Add sub-preparo
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Insumos */}
                            <div className="px-6 py-4 space-y-2">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Insumos</p>
                                {newItems.length === 0 ? (
                                    <div className="text-center py-6 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl text-sm">
                                        Nenhum insumo adicionado ainda.
                                    </div>
                                ) : newItems.map((item, idx) => (
                                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 group">
                                        <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.ingredients.name}</span>
                                        <input
                                            type="number"
                                            value={item.quantity_needed}
                                            min="0.001"
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                                const next = [...newItems];
                                                next[idx] = { ...next[idx], quantity_needed: Number(e.target.value) || 0 };
                                                setNewItems(next);
                                            }}
                                            className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        <span className="text-xs text-slate-400 w-6 font-medium">{item.ingredients.unit_type}</span>
                                        <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                            {fmtMoney((item.ingredients.avg_cost_per_unit / (item.ingredients.aproveitamento || 1)) * item.quantity_needed)}
                                        </span>
                                        <button onClick={() => setNewItems(newItems.filter((_, i) => i !== idx))} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Picker de insumo */}
                            <div className="px-6 py-4 border-t border-slate-100">
                                <div className="flex flex-col gap-2">
                                    <div className="relative">
                                        <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-amber-400">
                                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder={newSelIngId ? ingredients.find(i => i.id === newSelIngId)?.name : 'Buscar insumo...'}
                                                value={newSelIngId ? (ingredients.find(i => i.id === newSelIngId)?.name ?? '') : newIngSearch}
                                                onChange={e => { setNewIngSearch(e.target.value); setNewSelIngId(''); setNewDropdown(true); }}
                                                onFocus={() => setNewDropdown(true)}
                                                onBlur={() => setTimeout(() => setNewDropdown(false), 150)}
                                                className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                            />
                                            {newSelIngId && (
                                                <button onMouseDown={e => e.preventDefault()} onClick={() => { setNewSelIngId(''); setNewIngSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                        {newDropdown && !newSelIngId && (
                                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                {filteredNewDropdown.length === 0
                                                    ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum insumo encontrado.</p>
                                                    : filteredNewDropdown.map(ing => (
                                                        <div key={ing.id} onMouseDown={e => e.preventDefault()} onClick={() => { setNewSelIngId(ing.id); setNewIngSearch(''); setNewDropdown(false); }} className="px-4 py-2.5 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0">
                                                            <span className="text-sm font-medium text-slate-700">{ing.name}</span>
                                                            <span className="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded">{ing.unit_type}</span>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input type="number" value={newSelQty} onChange={e => setNewSelQty(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Qtd" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400 outline-none" />
                                        {ingredients.find(i => i.id === newSelIngId)?.unit_type === 'kg' && (
                                            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold shrink-0">
                                                <button onClick={() => setNewInputUnit('g')} className={`px-2 py-2 transition-colors ${newInputUnit === 'g' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>g</button>
                                                <button onClick={() => setNewInputUnit('kg')} className={`px-2 py-2 transition-colors ${newInputUnit === 'kg' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>kg</button>
                                            </div>
                                        )}
                                        <button onClick={handleAddNewItem} disabled={!newSelIngId || newSelQty === '' || Number(newSelQty) <= 0} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors shrink-0">
                                            + Add
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 sm:rounded-b-2xl flex justify-between items-center">
                                {(newItems.length > 0 || newSubItems.length > 0) && (
                                    <span className="text-sm text-slate-500">
                                        Custo: <strong className="text-amber-600">{fmtMoney(newCosts)}</strong> /un
                                    </span>
                                )}
                                <div className="flex gap-2 ml-auto">
                                    <button onClick={() => { setShowNewModal(false); setNewItems([]); setNewSubItems([]); }} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancelar</button>
                                    <button onClick={handleCreate} disabled={savingNew || !newName.trim()} className="px-5 py-2 bg-amber-500 text-white font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm shadow-sm">
                                        {savingNew ? 'Criando...' : 'Criar Preparo'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Editar Composição */}
            {editingId && editingPreparo && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm overflow-y-auto z-50"
                    onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}
                >
                    <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-6">
                        <div className="bg-white w-full sm:rounded-2xl sm:max-w-xl flex flex-col shadow-2xl">

                            {/* Header */}
                            <div className="px-6 py-4 border-b border-slate-100 shrink-0">
                                <div className="flex justify-between items-center mb-3">
                                    <h2 className="text-lg font-bold text-slate-900">Editar Preparo</h2>
                                    <button onClick={() => setEditingId(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={editPreparoName}
                                        onChange={e => setEditPreparoName(e.target.value)}
                                        className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-amber-400 outline-none"
                                        placeholder="Nome do preparo"
                                    />
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 whitespace-nowrap">Rende</span>
                                        <input
                                            type="number"
                                            value={editPreparoYield}
                                            min="1"
                                            onFocus={e => e.target.select()}
                                            onChange={e => setEditPreparoYield(e.target.value === '' ? '' : Number(e.target.value))}
                                            className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        <select
                                            value={editPreparoUnit}
                                            onChange={e => setEditPreparoUnit(e.target.value)}
                                            className="px-1.5 py-1 border border-slate-300 rounded-lg text-xs text-slate-600 bg-white focus:ring-2 focus:ring-amber-400 outline-none"
                                        >
                                            {['un', 'kg', 'g', 'l', 'ml', 'porção'].map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Sub-preparos (seção nova) */}
                            <div className="px-6 py-4 space-y-2 bg-indigo-50/30">
                                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1.5">
                                    <Layers className="w-3.5 h-3.5" />
                                    Sub-preparos
                                </p>
                                {editSubItems.length === 0 ? (
                                    <div className="text-center py-3 text-slate-400 text-xs">
                                        Nenhum sub-preparo. Adicione abaixo se este preparo usa outras receitas.
                                    </div>
                                ) : editSubItems.map((item, idx) => {
                                    const subPerUnit = costMap[item.sub_recipe_id]?.perUnit ?? 0;
                                    return (
                                        <div key={item.id} className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl border border-indigo-200 group">
                                            <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
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
                                                className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
                                            />
                                            <span className="text-xs text-slate-400 w-8 font-medium">{item.sub_recipe.unit_type}</span>
                                            <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                                {fmtMoney(subPerUnit * item.quantity_needed)}
                                            </span>
                                            <button
                                                onClick={() => setEditSubItems(editSubItems.filter((_, i) => i !== idx))}
                                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {/* Picker sub-preparo */}
                                <div className="flex flex-col gap-2 pt-2">
                                    <div className="relative">
                                        <div className="flex items-center gap-2 px-3 py-2 border border-indigo-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-indigo-400">
                                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder={selectedSubId ? preparos.find(p => p.id === selectedSubId)?.product_name : 'Buscar preparo...'}
                                                value={selectedSubId ? (preparos.find(p => p.id === selectedSubId)?.product_name ?? '') : subSearch}
                                                onChange={e => { setSubSearch(e.target.value); setSelectedSubId(''); setSubDropdownOpen(true); }}
                                                onFocus={() => setSubDropdownOpen(true)}
                                                onBlur={() => setTimeout(() => setSubDropdownOpen(false), 150)}
                                                className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                            />
                                            {selectedSubId && (
                                                <button onMouseDown={e => e.preventDefault()} onClick={() => { setSelectedSubId(''); setSubSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                        {subDropdownOpen && !selectedSubId && (
                                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-indigo-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                {filteredSubDropdown.length === 0
                                                    ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum preparo disponível (opções que criariam ciclo são ocultadas).</p>
                                                    : filteredSubDropdown.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onMouseDown={e => e.preventDefault()}
                                                            onClick={() => { setSelectedSubId(p.id); setSubSearch(''); setSubDropdownOpen(false); }}
                                                            className="px-4 py-2.5 hover:bg-indigo-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                                                        >
                                                            <span className="text-sm font-medium text-slate-700">{p.product_name}</span>
                                                            <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded">{p.unit_type}</span>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            value={selectedSubQty}
                                            onChange={e => setSelectedSubQty(e.target.value === '' ? '' : Number(e.target.value))}
                                            placeholder="Qtd"
                                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-indigo-400 outline-none"
                                        />
                                        <button
                                            onClick={handleAddSubItem}
                                            disabled={!selectedSubId || selectedSubQty === '' || Number(selectedSubQty) <= 0}
                                            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                                        >
                                            + Add sub-preparo
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Lista de insumos */}
                            <div className="px-6 py-4 space-y-2 border-t border-slate-100">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Insumos</p>
                                {editItems.length === 0 ? (
                                    <div className="text-center py-4 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl text-sm">
                                        Nenhum insumo. Adicione abaixo.
                                    </div>
                                ) : editItems.map((item, idx) => {
                                    const isKg = item.ingredients.unit_type === 'kg';
                                    const displayUnit = isKg ? (editItemUnits[idx] ?? 'kg') : item.ingredients.unit_type;
                                    const displayQty = isKg && displayUnit === 'g' ? item.quantity_needed * 1000 : item.quantity_needed;
                                    return (
                                    <div key={item.id} className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 group">
                                        <span className="flex-1 font-medium text-slate-800 text-sm truncate">{item.ingredients.name}</span>
                                        <input
                                            type="number"
                                            value={displayQty || ''}
                                            min="0.001"
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                                const v = Number(e.target.value) || 0;
                                                const stored = isKg && displayUnit === 'g' ? v / 1000 : v;
                                                const next = [...editItems];
                                                next[idx] = { ...next[idx], quantity_needed: stored };
                                                setEditItems(next);
                                            }}
                                            className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        {isKg ? (
                                            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold shrink-0">
                                                <button onClick={() => setEditItemUnits(u => ({ ...u, [idx]: 'g' }))} className={`px-1.5 py-1 transition-colors ${displayUnit === 'g' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>g</button>
                                                <button onClick={() => setEditItemUnits(u => ({ ...u, [idx]: 'kg' }))} className={`px-1.5 py-1 transition-colors ${displayUnit === 'kg' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>kg</button>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400 w-6 font-medium">{item.ingredients.unit_type}</span>
                                        )}
                                        <span className="text-sm font-semibold text-slate-600 w-20 text-right">
                                            {fmtMoney((item.ingredients.avg_cost_per_unit / (item.ingredients.aproveitamento || 1)) * item.quantity_needed)}
                                        </span>
                                        <button
                                            onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))}
                                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    );
                                })}
                            </div>

                            {/* Adicionar insumo */}
                            <div className="px-6 py-4 border-t border-slate-100 shrink-0">
                                <div className="flex flex-col gap-2">
                                    <div className="relative">
                                        <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-amber-400 focus-within:border-transparent">
                                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder={selectedIngId ? ingredients.find(i => i.id === selectedIngId)?.name : 'Buscar insumo base...'}
                                                value={selectedIngId ? (ingredients.find(i => i.id === selectedIngId)?.name ?? '') : ingSearch}
                                                onChange={e => { setIngSearch(e.target.value); setSelectedIngId(''); setDropdownOpen(true); }}
                                                onFocus={() => setDropdownOpen(true)}
                                                onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                                                className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0"
                                            />
                                            {selectedIngId && (
                                                <button onMouseDown={e => e.preventDefault()} onClick={() => { setSelectedIngId(''); setIngSearch(''); }} className="text-slate-400 hover:text-slate-600">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                        {dropdownOpen && !selectedIngId && (
                                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50">
                                                {filteredDropdown.length === 0
                                                    ? <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum insumo encontrado.</p>
                                                    : filteredDropdown.map(ing => (
                                                        <div
                                                            key={ing.id}
                                                            onMouseDown={e => e.preventDefault()}
                                                            onClick={() => { setSelectedIngId(ing.id); setIngSearch(''); setDropdownOpen(false); }}
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
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            value={selectedQty}
                                            onChange={e => setSelectedQty(e.target.value === '' ? '' : Number(e.target.value))}
                                            placeholder="Qtd"
                                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400 outline-none"
                                        />
                                        {ingredients.find(i => i.id === selectedIngId)?.unit_type === 'kg' && (
                                            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold shrink-0">
                                                <button onClick={() => setEditInputUnit('g')} className={`px-2 py-2 transition-colors ${editInputUnit === 'g' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>g</button>
                                                <button onClick={() => setEditInputUnit('kg')} className={`px-2 py-2 transition-colors ${editInputUnit === 'kg' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>kg</button>
                                            </div>
                                        )}
                                        <button
                                            onClick={handleAddItem}
                                            disabled={!selectedIngId || selectedQty === '' || Number(selectedQty) <= 0}
                                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 sm:rounded-b-2xl flex justify-between items-center shrink-0">
                                <div className="text-sm">
                                    <span className="text-slate-500">Custo total: </span>
                                    <strong className="text-slate-900">{fmtMoney(editCosts.total)}</strong>
                                    <span className="text-slate-400 mx-2">·</span>
                                    <span className="text-slate-500">Por unidade: </span>
                                    <strong className="text-amber-600">{fmtMoney(editCosts.perUnit)}</strong>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setEditingId(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancelar</button>
                                    <button
                                        onClick={handleSaveComposition}
                                        disabled={savingEdit}
                                        className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold shadow-sm disabled:opacity-50"
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
