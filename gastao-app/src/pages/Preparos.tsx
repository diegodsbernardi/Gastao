import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ChefHat, Plus, Trash2, Edit, Search, X, ArrowRight } from 'lucide-react';
import type { Ingredient, Recipe, RecipeIngredient } from '../lib/types';
import { fmtMoney, fmtQty } from '../lib/format';

const UNIT_OPTIONS = ['un', 'porção', 'g', 'ml', 'kg', 'l'];

export const Preparos = () => {
    const { user, restauranteId } = useAuth();

    const [preparos, setPreparos] = useState<Recipe[]>([]);
    const [ingredients, setIngredients] = useState<Ingredient[]>([]);
    const [compositions, setCompositions] = useState<Record<string, RecipeIngredient[]>>({});
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    // Modal: novo preparo
    const [showNewModal, setShowNewModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newUnit, setNewUnit] = useState('un');
    const [newYield, setNewYield] = useState<number | ''>(1);
    const [savingNew, setSavingNew] = useState(false);
    const [newItems, setNewItems] = useState<RecipeIngredient[]>([]);
    const [newIngSearch, setNewIngSearch] = useState('');
    const [newSelIngId, setNewSelIngId] = useState('');
    const [newSelQty, setNewSelQty] = useState<number | ''>('');
    const [newDropdown, setNewDropdown] = useState(false);
    const [newInputUnit, setNewInputUnit] = useState<'kg' | 'g'>('kg');

    // Modal: editar composição + info básica
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editItems, setEditItems] = useState<RecipeIngredient[]>([]);
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

    useEffect(() => {
        if (user) fetchData();
    }, [user]);

    const fetchData = async () => {
        setLoading(true);

        // Parallel fetch: preparos + insumos base + composições — sem waterfall
        const [preparosRes, ingredientsRes, compositionsRes] = await Promise.all([
            supabase.from('recipes').select('*').eq('tipo', 'preparo').order('product_name'),
            supabase.from('ingredients').select('*').eq('tipo', 'insumo_base').order('name'),
            supabase.from('recipe_ingredients').select(`
                id, recipe_id, ingredient_id, quantity_needed,
                ingredients ( id, name, unit_type, avg_cost_per_unit, aproveitamento )
            `),
        ]);

        if (preparosRes.data) setPreparos(preparosRes.data);
        if (ingredientsRes.data) setIngredients(ingredientsRes.data);

        if (compositionsRes.data) {
            const grouped: Record<string, RecipeIngredient[]> = {};
            compositionsRes.data.forEach((item: any) => {
                if (!grouped[item.recipe_id]) grouped[item.recipe_id] = [];
                grouped[item.recipe_id].push(item);
            });
            setCompositions(grouped);
        }

        setLoading(false);
    };

    // Calcula custo total e por unidade para cada preparo
    const costMap = useMemo(() => {
        const map: Record<string, { total: number; perUnit: number }> = {};
        preparos.forEach(p => {
            const items = compositions[p.id] ?? [];
            const total = items.reduce(
                (acc, i) => acc + ((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed),
                0
            );
            map[p.id] = { total, perUnit: total / (p.yield_quantity || 1) };
        });
        return map;
    }, [preparos, compositions]);

    const filteredPreparos = useMemo(
        () => preparos.filter(p => p.product_name.toLowerCase().includes(searchQuery.toLowerCase())),
        [preparos, searchQuery]
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
            if (newItems.length > 0) {
                await supabase.from('recipe_ingredients').insert(
                    newItems.map(i => ({
                        recipe_id: data.id,
                        ingredient_id: i.ingredient_id,
                        quantity_needed: i.quantity_needed,
                    }))
                );
                setCompositions(prev => ({ ...prev, [data.id]: newItems.map(i => ({ ...i, recipe_id: data.id })) }));
            }
            setPreparos(prev => [...prev, data].sort((a, b) => a.product_name.localeCompare(b.product_name)));
            setShowNewModal(false);
            setNewName(''); setNewUnit('un'); setNewYield(1); setNewItems([]);
            setNewIngSearch(''); setNewSelIngId(''); setNewSelQty('');
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

    const handleDelete = async (id: string) => {
        if (!confirm('Excluir este preparo? Esta ação não pode ser desfeita.')) return;
        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (!error) {
            setPreparos(prev => prev.filter(p => p.id !== id));
            toast.success('Preparo excluído.');
        } else if (error.code === '23503') {
            toast.error('Este preparo está sendo usado em fichas finais e não pode ser excluído.');
        } else {
            toast.error('Erro ao excluir: ' + error.message);
        }
    };

    const openEditModal = (preparo: Recipe) => {
        setEditingId(preparo.id);
        setEditItems(JSON.parse(JSON.stringify(compositions[preparo.id] ?? [])));
        setEditItemUnits({});
        setEditPreparoName(preparo.product_name);
        setEditPreparoYield(preparo.yield_quantity);
        setEditPreparoUnit(preparo.unit_type ?? 'un');
        setIngSearch(''); setSelectedIngId(''); setSelectedQty('');
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

    const handleSaveComposition = async () => {
        if (!editingId) return;
        setSavingEdit(true);

        const { error: delError } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', editingId);
        if (delError) {
            toast.error('Erro ao salvar: ' + delError.message);
            setSavingEdit(false);
            return;
        }

        if (editItems.length > 0) {
            const { error: insError } = await supabase.from('recipe_ingredients').insert(
                editItems.map(ei => ({
                    recipe_id: editingId,
                    ingredient_id: ei.ingredient_id,
                    quantity_needed: ei.quantity_needed,
                }))
            );
            if (insError) {
                toast.error('Erro ao salvar composição: ' + insError.message);
                setSavingEdit(false);
                fetchData(); // restaura estado do banco
                return;
            }
        }

        // Salva nome e rendimento
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
        setEditingId(null);
        setSavingEdit(false);
        toast.success('Preparo salvo!');
    };

    const editingPreparo = preparos.find(p => p.id === editingId);
    const editTotalCost = editItems.reduce(
        (acc, i) => acc + ((i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed), 0
    );
    const editCostPerUnit = editTotalCost / (editingPreparo?.yield_quantity || 1);

    const filteredDropdown = ingredients
        .filter(i => !editItems.some(ei => ei.ingredient_id === i.id))
        .filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()));

    const filteredNewDropdown = ingredients
        .filter(i => !newItems.some(ni => ni.ingredient_id === i.id))
        .filter(i => i.name.toLowerCase().includes(newIngSearch.toLowerCase()));

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
                        Mini-receitas de porções padrão. Definem o custo por unidade usada nas fichas finais.
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

            {/* Busca */}
            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                    type="text"
                    placeholder="Buscar preparos..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-400 outline-none shadow-sm"
                />
            </div>

            {/* Lista */}
            {filteredPreparos.length === 0 ? (
                <div className="py-16 text-center text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">
                    <ChefHat className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">Nenhum preparo cadastrado.</p>
                    <p className="text-sm mt-1">Crie preparos como "Smash 80g", "Fatia de Queijo", "Molho Especial".</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filteredPreparos.map(preparo => {
                        const { total, perUnit } = costMap[preparo.id] ?? { total: 0, perUnit: 0 };
                        const items = compositions[preparo.id] ?? [];

                        return (
                            <div key={preparo.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                {/* Card header */}
                                <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex justify-between items-start">
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-base">{preparo.product_name}</h3>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Rende: <strong>{preparo.yield_quantity} {preparo.unit_type}</strong>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* Custo por unidade — métrica principal */}
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
                                    {items.length === 0 ? (
                                        <p className="text-sm text-slate-400 italic">Sem insumos. Clique em "Editar" para compor.</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {items.map(item => (
                                                <li key={item.id} className="flex justify-between items-center text-sm">
                                                    <span className="text-slate-700 font-medium">{item.ingredients.name}</span>
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <span>{fmtQty(item.quantity_needed, item.ingredients.unit_type)} {item.ingredients.unit_type}</span>
                                                        <ArrowRight className="w-3 h-3 text-slate-300" />
                                                        <span className="font-semibold text-slate-700">
                                                            {fmtMoney(item.ingredients.avg_cost_per_unit * item.quantity_needed)}
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
                                <button onClick={() => { setShowNewModal(false); setNewItems([]); }} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg">
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
                                        placeholder='Ex: Smash 80g, Fatia de Queijo'
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

                            {/* Insumos já na criação */}
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
                                            {fmtMoney(item.ingredients.avg_cost_per_unit * item.quantity_needed)}
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
                                {newItems.length > 0 && (
                                    <span className="text-sm text-slate-500">
                                        Custo: <strong className="text-amber-600">
                                            {fmtMoney(newItems.reduce((a, i) => a + (i.ingredients.avg_cost_per_unit / (i.ingredients.aproveitamento || 1)) * i.quantity_needed, 0) / (Number(newYield) || 1))}
                                        </strong> /un
                                    </span>
                                )}
                                <div className="flex gap-2 ml-auto">
                                    <button onClick={() => { setShowNewModal(false); setNewItems([]); }} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancelar</button>
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

                            {/* Lista de insumos */}
                            <div className="px-6 py-4 space-y-2">
                                {editItems.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl text-sm">
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
                                            {fmtMoney(item.ingredients.avg_cost_per_unit * item.quantity_needed)}
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
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Adicionar insumo base</p>
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
                                    <strong className="text-slate-900">{fmtMoney(editTotalCost)}</strong>
                                    <span className="text-slate-400 mx-2">·</span>
                                    <span className="text-slate-500">Por unidade: </span>
                                    <strong className="text-amber-600">{fmtMoney(editCostPerUnit)}</strong>
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
