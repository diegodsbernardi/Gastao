import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PackageSearch, Plus, Filter, FileSpreadsheet, Trash2, X, Pencil, PlusCircle, Settings2 } from 'lucide-react';
import { ExcelImporter } from '../components/ExcelImporter';
import type { Ingredient, IngredientTipo } from '../lib/types';
import { fmtMoney, fmtQty } from '../lib/format';

const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct', 'fardo'];

const PREDEFINED_CATEGORIAS = ['Hortifruti', 'Proteínas', 'Queijos'];

const TIPO_OPTIONS: { value: IngredientTipo; label: string; desc: string }[] = [
    { value: 'insumo_base',   label: 'Insumo Base',   desc: 'Vem da NF-e, entra em Preparos' },
    { value: 'insumo_direto', label: 'Item Pronto', desc: 'Comprado pronto, vai direto na Ficha Final (pão, refrigerante, molho)' },
    { value: 'embalagem',     label: 'Embalagem',     desc: 'Embalagem do produto final (caixa, saco, etc.)' },
];

const TIPO_BADGE: Record<IngredientTipo, string> = {
    insumo_base:   'bg-slate-100 text-slate-600',
    insumo_direto: 'bg-amber-100 text-amber-700',
    embalagem:     'bg-purple-100 text-purple-700',
};

const CATEGORIA_BADGE: Record<string, string> = {
    'Hortifruti': 'bg-green-100 text-green-700',
    'Proteínas':  'bg-red-100 text-red-700',
    'Queijos':    'bg-yellow-100 text-yellow-700',
};

export const Ingredients = () => {
    const { user, restauranteId } = useAuth();
    const [ingredients, setIngredients] = useState<Ingredient[]>([]);
    const [loading, setLoading] = useState(true);
    const [showImporter, setShowImporter] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState('Todos');
    const [searchQuery, setSearchQuery] = useState('');

    // Categorias customizadas (separadas por tipo)
    const [customCatsBase, setCustomCatsBase] = useState<string[]>([]);
    const [customCatsDireto, setCustomCatsDireto] = useState<string[]>([]);
    const [showCatManager, setShowCatManager] = useState(false);
    const [newCatNameBase, setNewCatNameBase] = useState('');
    const [newCatNameDireto, setNewCatNameDireto] = useState('');
    const [savingCat, setSavingCat] = useState(false);

    // New ingredient modal
    const [showNewModal, setShowNewModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newUnit, setNewUnit] = useState('kg');
    const [newTipo, setNewTipo] = useState<IngredientTipo>('insumo_base');
    const [newCategoria, setNewCategoria] = useState('');
    const [newCost, setNewCost] = useState<number | ''>('');
    const [newStock, setNewStock] = useState<number | ''>(0);
    const [newAproveitamento, setNewAproveitamento] = useState<number | ''>(100);
    const [savingNew, setSavingNew] = useState(false);

    // Edit modal
    const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
    const [editName, setEditName] = useState('');
    const [editUnit, setEditUnit] = useState('kg');
    const [editTipo, setEditTipo] = useState<IngredientTipo>('insumo_base');
    const [editCategoria, setEditCategoria] = useState('');
    const [editCost, setEditCost] = useState<number | ''>('');
    const [editStock, setEditStock] = useState<number | ''>('');
    const [editAproveitamento, setEditAproveitamento] = useState<number | ''>(100);
    const [savingEdit, setSavingEdit] = useState(false);

    // Stock entry modal
    const [stockEntryIngredient, setStockEntryIngredient] = useState<Ingredient | null>(null);
    const [stockEntryQty, setStockEntryQty] = useState<number | ''>('');
    const [stockEntryCost, setStockEntryCost] = useState<number | ''>('');
    const [savingStockEntry, setSavingStockEntry] = useState(false);

    useEffect(() => {
        if (user) {
            fetchIngredients();
            fetchCategories();
        }
    }, [user]);

    const fetchIngredients = async () => {
        setLoading(true);
        const { data } = await supabase.from('ingredients').select('*').order('name');
        if (data) setIngredients(data);
        setLoading(false);
    };

    const fetchCategories = async () => {
        const { data } = await supabase.from('ingredient_categories').select('name, ingredient_tipo').order('name');
        if (data) {
            setCustomCatsBase(data.filter((c: any) => c.ingredient_tipo === 'insumo_base').map((c: any) => c.name));
            setCustomCatsDireto(data.filter((c: any) => c.ingredient_tipo === 'insumo_direto').map((c: any) => c.name));
        }
    };

    const handleCreateCategory = async (tipo: 'insumo_base' | 'insumo_direto') => {
        const name = (tipo === 'insumo_base' ? newCatNameBase : newCatNameDireto).trim();
        if (!name || !restauranteId) return;
        const predefined = tipo === 'insumo_base' ? PREDEFINED_CATEGORIAS : [];
        if (predefined.includes(name)) { toast.error('Esta categoria já existe.'); return; }
        setSavingCat(true);
        const { error } = await supabase.from('ingredient_categories').insert({ restaurant_id: restauranteId, name, ingredient_tipo: tipo });
        if (!error) {
            if (tipo === 'insumo_base') { setCustomCatsBase([...customCatsBase, name].sort()); setNewCatNameBase(''); }
            else { setCustomCatsDireto([...customCatsDireto, name].sort()); setNewCatNameDireto(''); }
            toast.success('Categoria criada!');
        } else if (error.code === '23505') {
            toast.error('Categoria já existe.');
        } else {
            toast.error('Erro: ' + error.message);
        }
        setSavingCat(false);
    };

    const handleDeleteCategory = async (name: string, tipo: 'insumo_base' | 'insumo_direto') => {
        if (!confirm(`Excluir categoria "${name}"? Os insumos com esta categoria ficarão sem categoria.`)) return;
        const { error } = await supabase.from('ingredient_categories').delete().eq('name', name).eq('ingredient_tipo', tipo);
        if (!error) {
            if (tipo === 'insumo_base') setCustomCatsBase(customCatsBase.filter(c => c !== name));
            else setCustomCatsDireto(customCatsDireto.filter(c => c !== name));
            if (activeTab === name) setActiveTab('Todos');
            toast.success('Categoria removida.');
        }
    };

    const handleCreateIngredient = async () => {
        if (!newName.trim() || !restauranteId) return;
        setSavingNew(true);

        const { data, error } = await supabase.from('ingredients').insert([{
            restaurant_id: restauranteId,
            name: newName.trim(),
            unit_type: newUnit,
            tipo: newTipo,
            categoria: newTipo !== 'embalagem' ? (newCategoria || null) : null,
            avg_cost_per_unit: Number(newCost) || 0,
            stock_quantity: Number(newStock) || 0,
            aproveitamento: (Number(newAproveitamento) || 100) / 100,
            use_in_recipes: newTipo === 'insumo_base',
        }]).select().single();

        if (!error && data) {
            setIngredients([...ingredients, data].sort((a, b) => a.name.localeCompare(b.name)));
            setShowNewModal(false);
            setNewName(''); setNewUnit('kg'); setNewTipo('insumo_base'); setNewCategoria(''); setNewCost(''); setNewStock(0); setNewAproveitamento(100);
            toast.success('Insumo criado com sucesso!');
        } else {
            toast.error('Erro ao criar insumo: ' + error?.message);
        }
        setSavingNew(false);
    };

    const handleEditIngredient = async () => {
        if (!editingIngredient || !editName.trim()) return;
        setSavingEdit(true);
        const { error } = await supabase.from('ingredients').update({
            name: editName.trim(),
            unit_type: editUnit,
            tipo: editTipo,
            categoria: editTipo !== 'embalagem' ? (editCategoria || null) : null,
            avg_cost_per_unit: Number(editCost) || 0,
            stock_quantity: Number(editStock) || 0,
            aproveitamento: (Number(editAproveitamento) || 100) / 100,
            use_in_recipes: editTipo === 'insumo_base',
        }).eq('id', editingIngredient.id);

        if (!error) {
            setIngredients(ingredients.map(i =>
                i.id === editingIngredient.id
                    ? { ...i, name: editName.trim(), unit_type: editUnit, tipo: editTipo, categoria: editTipo !== 'embalagem' ? (editCategoria || null) : null, avg_cost_per_unit: Number(editCost) || 0, stock_quantity: Number(editStock) || 0, aproveitamento: (Number(editAproveitamento) || 100) / 100 }
                    : i
            ));
            setEditingIngredient(null);
            toast.success('Insumo atualizado com sucesso!');
        } else {
            toast.error('Erro ao editar: ' + error.message);
        }
        setSavingEdit(false);
    };

    const handleStockEntry = async () => {
        if (!stockEntryIngredient || stockEntryQty === '' || Number(stockEntryQty) <= 0) return;
        setSavingStockEntry(true);

        const currentQty = stockEntryIngredient.stock_quantity;
        const currentCost = stockEntryIngredient.avg_cost_per_unit;
        const addedQty = Number(stockEntryQty);
        const newQty = currentQty + addedQty;

        // Custo médio ponderado: só recalcula se preço de compra foi informado
        const updates: { stock_quantity: number; avg_cost_per_unit?: number } = { stock_quantity: newQty };
        let newAvgCost = currentCost;
        if (stockEntryCost !== '' && Number(stockEntryCost) > 0) {
            newAvgCost = ((currentQty * currentCost) + (addedQty * Number(stockEntryCost))) / newQty;
            updates.avg_cost_per_unit = newAvgCost;
        }

        const { error } = await supabase.from('ingredients').update(updates).eq('id', stockEntryIngredient.id);

        if (!error) {
            setIngredients(ingredients.map(i =>
                i.id === stockEntryIngredient.id
                    ? { ...i, stock_quantity: newQty, avg_cost_per_unit: newAvgCost }
                    : i
            ));
            setStockEntryIngredient(null);
            setStockEntryQty('');
            setStockEntryCost('');
            toast.success('Entrada de estoque registrada!');
        } else {
            toast.error('Erro ao registrar entrada: ' + error.message);
        }
        setSavingStockEntry(false);
    };

    const handleDeleteIngredient = async (id: string) => {
        if (!confirm('Deseja realmente excluir este insumo?')) return;
        const { error } = await supabase.from('ingredients').delete().eq('id', id);
        if (!error) {
            setIngredients(ingredients.filter(i => i.id !== id));
            setSelectedIds(selectedIds.filter(selId => selId !== id));
            toast.success('Insumo excluído.');
        } else if (error.code === '23503') {
            toast.error('Este insumo está sendo usado em receitas e não pode ser excluído.');
        } else {
            toast.error('Erro ao excluir: ' + error.message);
        }
    };

    const handleBulkDelete = async () => {
        if (!confirm(`Deseja realmente excluir ${selectedIds.length} insumo(s)?`)) return;
        setLoading(true);
        const { error } = await supabase.from('ingredients').delete().in('id', selectedIds);
        if (!error) {
            setIngredients(ingredients.filter(i => !selectedIds.includes(i.id)));
            setSelectedIds([]);
            toast.success(`${selectedIds.length} insumo(s) excluído(s).`);
        } else if (error.code === '23503') {
            toast.error('Um ou mais insumos estão sendo usados em receitas e não podem ser excluídos.');
        } else {
            toast.error('Erro ao excluir: ' + error.message);
        }
        setLoading(false);
    };

    const allCategoriesBase = [...PREDEFINED_CATEGORIAS, ...customCatsBase];
    const allCategoriesDireto = [...customCatsDireto];
    const allCategoryTabs = [...allCategoriesBase, ...allCategoriesDireto];

    const filteredIngredients = ingredients.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesTab = activeTab === 'Todos' ||
            (activeTab === 'Embalagem' && item.tipo === 'embalagem') ||
            (allCategoryTabs.includes(activeTab) && item.categoria === activeTab);
        return matchesSearch && matchesTab;
    });

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center">
                        <PackageSearch className="w-5 h-5 sm:w-6 sm:h-6 mr-2.5 text-primary-500" />
                        Insumos e Embalagens
                    </h1>
                    <p className="text-slate-500 mt-1 hidden sm:block">Gerencie a matéria-prima do seu restaurante e acompanhe o Custo Médio.</p>
                </div>
                <div className="mt-3 sm:mt-0 flex flex-wrap gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => setShowImporter(!showImporter)}
                        className="flex-1 sm:flex-none flex items-center justify-center px-3 py-2 text-sm bg-green-50 text-green-700 font-medium rounded-lg hover:bg-green-100 transition-colors border border-green-200"
                    >
                        <FileSpreadsheet className="w-4 h-4 mr-1.5 shrink-0" />
                        {showImporter ? 'Ocultar' : 'Excel'}
                    </button>
                    {selectedIds.length > 0 && (
                        <button
                            onClick={handleBulkDelete}
                            className="w-full sm:w-auto flex items-center justify-center px-3 py-2 text-sm bg-red-50 text-red-600 font-medium rounded-lg hover:bg-red-100 transition-colors border border-red-200"
                        >
                            <Trash2 className="w-4 h-4 mr-1.5 shrink-0" />
                            Excluir ({selectedIds.length})
                        </button>
                    )}
                    <button
                        onClick={() => setShowCatManager(!showCatManager)}
                        className="flex-1 sm:flex-none flex items-center justify-center px-3 py-2 text-sm bg-slate-100 text-slate-600 font-medium rounded-lg hover:bg-slate-200 transition-colors border border-slate-200"
                    >
                        <Settings2 className="w-4 h-4 mr-1.5 shrink-0" />
                        Categorias
                    </button>
                    <button onClick={() => setShowNewModal(true)} className="w-full sm:w-auto flex items-center justify-center px-4 py-2 text-sm bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors shadow-sm">
                        <Plus className="w-4 h-4 mr-1.5 shrink-0" />
                        Novo Insumo
                    </button>
                </div>
            </div>

            {showImporter && (
                <ExcelImporter onComplete={() => {
                    fetchIngredients();
                }} />
            )}

            {showCatManager && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 grid sm:grid-cols-2 gap-6">
                    {/* Categorias Insumo Base */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <Settings2 className="w-4 h-4 text-slate-400" /> Categorias de Insumo Base
                        </h3>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {PREDEFINED_CATEGORIAS.map(cat => (
                                <span key={cat} className={`px-3 py-1 text-xs font-semibold rounded-full ${CATEGORIA_BADGE[cat] ?? 'bg-teal-100 text-teal-700'}`}>
                                    {cat} <span className="opacity-40">padrão</span>
                                </span>
                            ))}
                            {customCatsBase.map(cat => (
                                <span key={cat} className="flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-700">
                                    {cat}
                                    <button onClick={() => handleDeleteCategory(cat, 'insumo_base')} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input type="text" value={newCatNameBase} onChange={e => setNewCatNameBase(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCategory('insumo_base')} placeholder="Ex: Frios, Temperos..." className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
                            <button onClick={() => handleCreateCategory('insumo_base')} disabled={savingCat || !newCatNameBase.trim()} className="px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">+ Add</button>
                        </div>
                    </div>
                    {/* Categorias Item Pronto */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <Settings2 className="w-4 h-4 text-slate-400" /> Categorias de Item Pronto
                        </h3>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {customCatsDireto.length === 0 && <span className="text-xs text-slate-400">Nenhuma categoria criada ainda.</span>}
                            {customCatsDireto.map(cat => (
                                <span key={cat} className="flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">
                                    {cat}
                                    <button onClick={() => handleDeleteCategory(cat, 'insumo_direto')} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input type="text" value={newCatNameDireto} onChange={e => setNewCatNameDireto(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCategory('insumo_direto')} placeholder="Ex: Pães, Bebidas, Molhos..." className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
                            <button onClick={() => handleCreateCategory('insumo_direto')} disabled={savingCat || !newCatNameDireto.trim()} className="px-3 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50">+ Add</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex gap-1 p-1 bg-slate-200/50 rounded-xl overflow-x-auto">
                            {['Todos', ...allCategoryTabs, 'Embalagem'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap flex-shrink-0 ${activeTab === tab
                                            ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center space-x-4 w-full sm:w-auto">
                            <div className="relative w-full sm:w-72">
                                <Filter className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar insumos..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none transition-shadow"
                                />
                            </div>
                            <span className="text-sm font-medium text-slate-500 whitespace-nowrap">
                                {filteredIngredients.length} Itens
                            </span>
                        </div>
                    </div>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-slate-100">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500 animate-pulse">Carregando estoque...</div>
                    ) : filteredIngredients.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            <PackageSearch className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            Nenhum insumo encontrado.
                        </div>
                    ) : filteredIngredients.map(item => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-slate-900 text-sm">{item.name}</span>
                                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${TIPO_BADGE[item.tipo] ?? 'bg-slate-100 text-slate-500'}`}>
                                        {TIPO_OPTIONS.find(t => t.value === item.tipo)?.label ?? item.tipo}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                                    <span className="px-1.5 py-0.5 bg-slate-100 rounded font-bold border border-slate-200 text-slate-600">
                                        {item.unit_type.toUpperCase()}
                                    </span>
                                    <span className={item.stock_quantity <= 0 ? 'text-red-600 font-semibold' : ''}>
                                        {fmtQty(item.stock_quantity, item.unit_type)}
                                    </span>
                                    <span className="text-slate-200">·</span>
                                    <span className="font-semibold text-slate-700">R$ {fmtMoney(item.avg_cost_per_unit)}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                    onClick={() => {
                                        setEditingIngredient(item);
                                        setEditName(item.name);
                                        setEditUnit(item.unit_type);
                                        setEditTipo(item.tipo ?? 'insumo_base');
                                        setEditCost(item.avg_cost_per_unit);
                                        setEditStock(item.stock_quantity);
                                        setEditAproveitamento(Math.round((item.aproveitamento ?? 1) * 100));
                                    }}
                                    className="p-2.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                >
                                    <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => { setStockEntryIngredient(item); setStockEntryQty(''); setStockEntryCost(''); }}
                                    className="p-2.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                >
                                    <PlusCircle className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDeleteIngredient(item.id)}
                                    className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                                <th className="p-4 w-12 text-center">
                                    <input
                                        type="checkbox"
                                        checked={ingredients.length > 0 && selectedIds.length === ingredients.length}
                                        onChange={(e) => setSelectedIds(e.target.checked ? ingredients.map(i => i.id) : [])}
                                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                    />
                                </th>
                                <th className="p-4 font-bold">Nome do Insumo</th>
                                <th className="p-4 font-bold">Categoria</th>
                                <th className="p-4 font-bold">Unidade (Medida)</th>
                                <th className="p-4 font-bold text-right">Quantidade em Estoque</th>
                                <th className="p-4 font-bold text-right">Custo Médio Unitário</th>
                                <th className="p-4 font-bold text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-slate-500 animate-pulse">
                                        Carregando estoque...
                                    </td>
                                </tr>
                            ) : filteredIngredients.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-slate-500">
                                        <PackageSearch className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                        Nenhum insumo encontrado.
                                    </td>
                                </tr>
                            ) : (
                                filteredIngredients.map((item) => (
                                    <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.includes(item.id) ? 'bg-primary-50/50' : ''}`}>
                                        <td className="p-4 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(item.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedIds([...selectedIds, item.id]);
                                                    else setSelectedIds(selectedIds.filter(id => id !== item.id));
                                                }}
                                                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                            />
                                        </td>
                                        <td className="p-4">
                                            <span className="font-medium text-slate-900">{item.name}</span>
                                        </td>
                                        <td className="p-4">
                                            {item.categoria
                                                ? <span className={`px-2 py-1 text-xs font-semibold rounded-full ${item.tipo === 'insumo_base' ? (CATEGORIA_BADGE[item.categoria] ?? 'bg-teal-100 text-teal-700') : 'bg-amber-100 text-amber-700'}`}>{item.categoria}</span>
                                                : <span className={`px-2 py-1 text-xs font-semibold rounded-full ${TIPO_BADGE[item.tipo] ?? 'bg-slate-100 text-slate-500'}`}>{TIPO_OPTIONS.find(t => t.value === item.tipo)?.label ?? item.tipo}</span>
                                            }
                                        </td>
                                        <td className="p-4 text-slate-600">
                                            <span className="px-2 py-1 bg-slate-100 rounded text-xs font-bold border border-slate-200">
                                                {item.unit_type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className={`font-medium ${item.stock_quantity <= 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                                {fmtQty(item.stock_quantity, item.unit_type)}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right font-semibold text-slate-900">
                                            R$ {fmtMoney(item.avg_cost_per_unit)}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => {
                                                        setEditingIngredient(item);
                                                        setEditName(item.name);
                                                        setEditUnit(item.unit_type);
                                                        setEditTipo(item.tipo ?? 'insumo_base');
                                                        setEditCategoria(item.categoria ?? '');
                                                        setEditCost(item.avg_cost_per_unit);
                                                        setEditStock(item.stock_quantity);
                                                    }}
                                                    className="text-slate-400 hover:text-primary-600 hover:bg-primary-50 p-2 rounded-lg transition-colors"
                                                    title="Editar Insumo"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => { setStockEntryIngredient(item); setStockEntryQty(''); setStockEntryCost(''); }}
                                                    className="text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 p-2 rounded-lg transition-colors"
                                                    title="Entrada de Estoque"
                                                >
                                                    <PlusCircle className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteIngredient(item.id)}
                                                    className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                                    title="Excluir Insumo"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal: Novo Insumo */}
            {showNewModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-slate-900">Novo Insumo</h2>
                            <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="Ex: Farinha de Trigo"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                                    <select value={newTipo} onChange={e => { setNewTipo(e.target.value as IngredientTipo); setNewCategoria(''); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        {TIPO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Unidade</label>
                                    <select value={newUnit} onChange={e => setNewUnit(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            </div>
                            {newTipo !== 'embalagem' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                                    <select value={newCategoria} onChange={e => setNewCategoria(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        <option value="">Sem categoria</option>
                                        {(newTipo === 'insumo_base' ? allCategoriesBase : allCategoriesDireto).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Custo Médio (R$)</label>
                                    <input
                                        type="number"
                                        value={newCost}
                                        onChange={e => setNewCost(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="0.00"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Aproveitamento (%)</label>
                                    <input
                                        type="number"
                                        min="1" max="100" step="1"
                                        value={newAproveitamento}
                                        onChange={e => setNewAproveitamento(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="100"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Estoque Inicial</label>
                                    <input
                                        type="number"
                                        value={newStock}
                                        onChange={e => setNewStock(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="0"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                            </div>
                            {Number(newAproveitamento) < 100 && Number(newAproveitamento) > 0 && (
                                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                                    Custo líquido: R$ {((Number(newCost) || 0) / ((Number(newAproveitamento) || 100) / 100)).toFixed(2)}/{newUnit}
                                    <span className="text-slate-400 ml-1">(usado nas receitas)</span>
                                </p>
                            )}
                            <p className="text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                                {TIPO_OPTIONS.find(t => t.value === newTipo)?.desc}
                            </p>
                        </div>
                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowNewModal(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm">Cancelar</button>
                            <button
                                onClick={handleCreateIngredient}
                                disabled={savingNew || !newName.trim()}
                                className="px-5 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm shadow-sm"
                            >
                                {savingNew ? 'Salvando...' : 'Salvar Insumo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Editar Insumo */}
            {editingIngredient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-slate-900">Editar Insumo</h2>
                            <button onClick={() => setEditingIngredient(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                                    <select value={editTipo} onChange={e => { setEditTipo(e.target.value as IngredientTipo); setEditCategoria(''); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        {TIPO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Unidade</label>
                                    <select value={editUnit} onChange={e => setEditUnit(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            </div>
                            {editTipo !== 'embalagem' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                                    <select value={editCategoria} onChange={e => setEditCategoria(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm bg-white">
                                        <option value="">Sem categoria</option>
                                        {(editTipo === 'insumo_base' ? allCategoriesBase : allCategoriesDireto).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Custo Médio (R$)</label>
                                    <input
                                        type="number"
                                        value={editCost}
                                        onChange={e => setEditCost(e.target.value === '' ? '' : Number(e.target.value))}
                                        onFocus={e => e.target.select()}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Aproveitamento (%)</label>
                                    <input
                                        type="number"
                                        min="1" max="100" step="1"
                                        value={editAproveitamento}
                                        onChange={e => setEditAproveitamento(e.target.value === '' ? '' : Number(e.target.value))}
                                        onFocus={e => e.target.select()}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Estoque Atual</label>
                                    <input
                                        type="number"
                                        value={editStock}
                                        onChange={e => setEditStock(e.target.value === '' ? '' : Number(e.target.value))}
                                        onFocus={e => e.target.select()}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                                    />
                                </div>
                            </div>
                            {Number(editAproveitamento) < 100 && Number(editAproveitamento) > 0 && (
                                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                                    Custo líquido: R$ {((Number(editCost) || 0) / ((Number(editAproveitamento) || 100) / 100)).toFixed(2)}/{editUnit}
                                    <span className="text-slate-400 ml-1">(usado nas receitas)</span>
                                </p>
                            )}
                            <p className="text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                                {TIPO_OPTIONS.find(t => t.value === editTipo)?.desc}
                            </p>
                        </div>
                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setEditingIngredient(null)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm">Cancelar</button>
                            <button
                                onClick={handleEditIngredient}
                                disabled={savingEdit || !editName.trim()}
                                className="px-5 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm shadow-sm"
                            >
                                {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Entrada de Estoque */}
            {stockEntryIngredient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Entrada de Estoque</h2>
                                <p className="text-sm text-slate-500 mt-0.5">{stockEntryIngredient.name}</p>
                            </div>
                            <button onClick={() => setStockEntryIngredient(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-600">
                                Estoque atual: <strong className="text-slate-900">{fmtQty(stockEntryIngredient.stock_quantity, stockEntryIngredient.unit_type)} {stockEntryIngredient.unit_type}</strong>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Quantidade a Adicionar</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={stockEntryQty}
                                        onChange={e => setStockEntryQty(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="0"
                                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                                        autoFocus
                                    />
                                    <span className="text-sm font-bold text-slate-500 px-2 py-2 bg-slate-100 rounded-lg border border-slate-200">
                                        {stockEntryIngredient.unit_type}
                                    </span>
                                </div>
                                {stockEntryQty !== '' && Number(stockEntryQty) > 0 && (
                                    <p className="mt-2 text-xs text-emerald-600">
                                        Novo estoque: <strong>{fmtQty(stockEntryIngredient.stock_quantity + Number(stockEntryQty), stockEntryIngredient.unit_type)} {stockEntryIngredient.unit_type}</strong>
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Custo desta compra (R$/{stockEntryIngredient.unit_type}){' '}
                                    <span className="text-slate-400 font-normal">(opcional)</span>
                                </label>
                                <input
                                    type="number"
                                    value={stockEntryCost}
                                    onChange={e => setStockEntryCost(e.target.value === '' ? '' : Number(e.target.value))}
                                    placeholder={stockEntryIngredient.avg_cost_per_unit.toFixed(2)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                                />
                                {stockEntryCost !== '' && Number(stockEntryCost) > 0 && stockEntryQty !== '' && Number(stockEntryQty) > 0 && (() => {
                                    const currentQty = stockEntryIngredient.stock_quantity;
                                    const addedQty = Number(stockEntryQty);
                                    const newAvg = ((currentQty * stockEntryIngredient.avg_cost_per_unit) + (addedQty * Number(stockEntryCost))) / (currentQty + addedQty);
                                    return (
                                        <p className="mt-2 text-xs text-primary-600">
                                            Novo custo médio: <strong>R$ {fmtMoney(newAvg)}</strong>
                                            <span className="text-slate-400 ml-1">(era R$ {fmtMoney(stockEntryIngredient.avg_cost_per_unit)})</span>
                                        </p>
                                    );
                                })()}
                                {stockEntryCost === '' && (
                                    <p className="mt-1 text-xs text-slate-400">Se não informado, o custo médio atual é mantido.</p>
                                )}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => { setStockEntryIngredient(null); setStockEntryCost(''); }} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm">Cancelar</button>
                            <button
                                onClick={handleStockEntry}
                                disabled={savingStockEntry || stockEntryQty === '' || Number(stockEntryQty) <= 0}
                                className="px-5 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm shadow-sm"
                            >
                                {savingStockEntry ? 'Registrando...' : 'Confirmar Entrada'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
