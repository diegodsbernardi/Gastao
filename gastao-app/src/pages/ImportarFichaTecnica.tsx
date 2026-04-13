import React, { useRef, useState, useCallback } from 'react';
import {
    UploadCloud, Loader2, CheckCircle2, AlertTriangle, ChevronDown,
    Package, UtensilsCrossed, Link2, FileSpreadsheet, Trash2,
    Info, Table2, ListChecks, Sparkles,
} from 'lucide-react';
import {
    parseExcelSheets, interpretarFichaTecnica, inserirFichaTecnica,
    SheetData, ParsedIngredient, ParsedRecipe, ParsedComposition,
    InterpretationResult, InsertionResult,
} from '../lib/fichaTecnica';

// ── Types ─────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'parsing' | 'interpreting' | 'previewing' | 'inserting' | 'done';
type PreviewTab = 'ingredients' | 'recipes' | 'compositions' | 'warnings';

// ── Main component ────────────────────────────────────────────────────────

export const ImportarFichaTecnica = () => {
    const [stage, setStage] = useState<Stage>('idle');
    const [activeTab, setActiveTab] = useState<PreviewTab>('ingredients');
    const [ingredients, setIngredients] = useState<ParsedIngredient[]>([]);
    const [recipes, setRecipes] = useState<ParsedRecipe[]>([]);
    const [compositions, setCompositions] = useState<ParsedComposition[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [confidence, setConfidence] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);
    const [result, setResult] = useState<InsertionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addLog = (msg: string) => setLogs((p) => [...p, msg]);

    // ── Upload + Interpret ────────────────────────────────────────────────

    const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setStage('parsing');
        addLog('Lendo planilha...');

        try {
            const sheets = await parseExcelSheets(file);
            addLog(`${sheets.length} aba(s) detectada(s): ${sheets.map((s) => s.name).join(', ')}`);

            setStage('interpreting');
            addLog('Enviando para analise com IA...');

            const data = await interpretarFichaTecnica(sheets);

            setIngredients(data.ingredients);
            setRecipes(data.recipes);
            setCompositions(data.compositions);
            setWarnings(data.warnings);
            setConfidence(data.ai_confidence);
            setStage('previewing');

            // Auto-select best tab
            if (data.ingredients.length > 0) setActiveTab('ingredients');
            else if (data.recipes.length > 0) setActiveTab('recipes');
            else if (data.compositions.length > 0) setActiveTab('compositions');
            else if (data.warnings.length > 0) setActiveTab('warnings');
        } catch (err: any) {
            setError(err.message || 'Erro ao processar planilha');
            setStage('idle');
        }
    }, []);

    // ── Confirm + Insert ──────────────────────────────────────────────────

    const handleConfirm = useCallback(async () => {
        setStage('inserting');
        setLogs([]);
        addLog('Iniciando importacao...');

        const selIngs = ingredients.filter((i) => i._selected);
        const selRecs = recipes.filter((r) => r._selected);
        addLog(`${selIngs.length} insumos, ${selRecs.length} receitas, ${compositions.length} composicoes`);

        try {
            const res = await inserirFichaTecnica(
                ingredients,
                recipes,
                compositions,
            );

            if (res.ingredientsInserted > 0) addLog(`+${res.ingredientsInserted} insumos inseridos`);
            if (res.recipesInserted > 0) addLog(`+${res.recipesInserted} receitas inseridas`);
            if (res.compositionsInserted > 0) addLog(`+${res.compositionsInserted} composicoes vinculadas`);
            for (const err of res.errors) addLog(`Aviso: ${err}`);

            addLog('Importacao concluida!');
            setResult(res);
            setStage('done');
        } catch (err: any) {
            addLog(`Erro: ${err.message}`);
            setError(err.message);
            setStage('done');
        }
    }, [ingredients, recipes, compositions]);

    // ── Reset ─────────────────────────────────────────────────────────────

    const reset = () => {
        setStage('idle');
        setIngredients([]);
        setRecipes([]);
        setCompositions([]);
        setWarnings([]);
        setLogs([]);
        setResult(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ── Counts ────────────────────────────────────────────────────────────

    const selectedIngCount = ingredients.filter((i) => i._selected).length;
    const selectedRecCount = recipes.filter((r) => r._selected).length;

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileSpreadsheet className="w-6 h-6 text-primary-500" />
                    Importar Ficha Tecnica
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Importe qualquer planilha Excel. Nossa IA interpreta o formato automaticamente.
                </p>
            </div>

            {/* ── IDLE: Tutorial + Upload zone ─────────────────────────────── */}
            {stage === 'idle' && (
                <div className="space-y-5">
                    {/* Guia rapido */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <Info className="w-4 h-4 text-primary-500" />
                            Como montar sua planilha
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <GuideCard
                                icon={<Package className="w-5 h-5 text-blue-500" />}
                                title="Aba de Insumos"
                                description="Liste suas materias-primas com nome, unidade e custo."
                                example={['Carne Moida | kg | 42,90', 'Queijo Cheddar | kg | 38,50', 'Pao Brioche | un | 1,80']}
                            />
                            <GuideCard
                                icon={<UtensilsCrossed className="w-5 h-5 text-orange-500" />}
                                title="Aba de Cardapio"
                                description="Liste os produtos vendidos com nome, categoria e preco."
                                example={['X-Burguer | Lanche | 28,90', 'Batata Frita P | Porcao | 14,90', 'Combo Classico | Combo | 45,90']}
                            />
                            <GuideCard
                                icon={<Link2 className="w-5 h-5 text-purple-500" />}
                                title="Aba de Composicao"
                                description="Vincule ingredientes a cada receita com quantidades."
                                example={['X-Burguer | Carne | 0,120 | kg', 'X-Burguer | Queijo | 0,040 | kg', 'X-Burguer | Pao | 1 | un']}
                                optional
                            />
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 pt-1">
                            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Nomes de colunas podem variar — a IA interpreta</span>
                            <span className="flex items-center gap-1"><Table2 className="w-3 h-3" /> Aceita .xlsx e .xls</span>
                            <span className="flex items-center gap-1"><ListChecks className="w-3 h-3" /> Voce revisa tudo antes de confirmar</span>
                        </div>
                    </div>

                    {/* Dropzone */}
                    <div
                        className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center hover:border-primary-400 hover:bg-primary-50/30 transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFile}
                        />
                        <UploadCloud className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                        <p className="text-base font-medium text-slate-700">
                            Arraste ou clique para enviar sua planilha
                        </p>
                        <p className="text-sm text-slate-400 mt-1">
                            Nao precisa seguir um modelo exato — nossa IA adapta
                        </p>
                        {error && (
                            <p className="text-sm text-red-500 mt-4 flex items-center justify-center gap-1">
                                <AlertTriangle className="w-4 h-4" /> {error}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ── PARSING / INTERPRETING: Loader ──────────────────────── */}
            {(stage === 'parsing' || stage === 'interpreting') && (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                    <Loader2 className="w-10 h-10 mx-auto text-primary-500 animate-spin mb-4" />
                    <p className="text-lg font-medium text-slate-700">
                        {stage === 'parsing' ? 'Lendo planilha...' : 'Analisando com IA...'}
                    </p>
                    <div className="mt-4 text-sm text-slate-500 space-y-1">
                        {logs.map((l, i) => <p key={i}>{l}</p>)}
                    </div>
                </div>
            )}

            {/* ── PREVIEWING: Editable preview ────────────────────────── */}
            {stage === 'previewing' && (
                <>
                    {/* Confidence badge */}
                    <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            confidence >= 0.8
                                ? 'bg-green-100 text-green-700'
                                : confidence >= 0.5
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-red-100 text-red-700'
                        }`}>
                            Confianca da IA: {Math.round(confidence * 100)}%
                        </span>
                        {warnings.length > 0 && (
                            <span className="text-xs text-amber-600 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {warnings.length} aviso(s)
                            </span>
                        )}
                    </div>

                    {/* Tabs */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="flex border-b border-slate-200">
                            <TabBtn
                                active={activeTab === 'ingredients'}
                                onClick={() => setActiveTab('ingredients')}
                                icon={<Package className="w-4 h-4" />}
                                label={`Insumos (${ingredients.length})`}
                            />
                            <TabBtn
                                active={activeTab === 'recipes'}
                                onClick={() => setActiveTab('recipes')}
                                icon={<UtensilsCrossed className="w-4 h-4" />}
                                label={`Receitas (${recipes.length})`}
                            />
                            <TabBtn
                                active={activeTab === 'compositions'}
                                onClick={() => setActiveTab('compositions')}
                                icon={<Link2 className="w-4 h-4" />}
                                label={`Composicao (${compositions.length})`}
                            />
                            {warnings.length > 0 && (
                                <TabBtn
                                    active={activeTab === 'warnings'}
                                    onClick={() => setActiveTab('warnings')}
                                    icon={<AlertTriangle className="w-4 h-4" />}
                                    label={`Avisos (${warnings.length})`}
                                />
                            )}
                        </div>

                        <div className="p-4 max-h-[60vh] overflow-y-auto">
                            {activeTab === 'ingredients' && (
                                <IngredientsTable items={ingredients} onChange={setIngredients} />
                            )}
                            {activeTab === 'recipes' && (
                                <RecipesTable items={recipes} onChange={setRecipes} />
                            )}
                            {activeTab === 'compositions' && (
                                <CompositionsView items={compositions} onChange={setCompositions} />
                            )}
                            {activeTab === 'warnings' && (
                                <WarningsList items={warnings} />
                            )}
                        </div>
                    </div>

                    {/* Bottom bar */}
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4">
                        <p className="text-sm text-slate-600">
                            <strong>{selectedIngCount}</strong> insumos,{' '}
                            <strong>{selectedRecCount}</strong> receitas,{' '}
                            <strong>{compositions.length}</strong> composicoes
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={reset}
                                className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={selectedIngCount + selectedRecCount === 0}
                                className="px-6 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Confirmar Importacao
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* ── INSERTING / DONE: Terminal log ──────────────────────── */}
            {(stage === 'inserting' || stage === 'done') && (
                <div className="space-y-4">
                    <div className="bg-slate-900 rounded-xl p-5 text-xs font-mono text-green-400 h-64 overflow-y-auto shadow-inner leading-relaxed">
                        {logs.map((l, i) => <div key={i}>{l}</div>)}
                        {stage === 'inserting' && (
                            <div className="flex items-center text-primary-400 mt-2">
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...
                            </div>
                        )}
                        {stage === 'done' && !error && (
                            <div className="flex items-center text-green-500 font-bold mt-2">
                                <CheckCircle2 className="w-5 h-5 mr-2" /> Concluido.
                            </div>
                        )}
                        {stage === 'done' && error && (
                            <div className="flex items-center text-red-500 font-bold mt-2">
                                <AlertTriangle className="w-5 h-5 mr-2" /> Erro: {error}
                            </div>
                        )}
                    </div>

                    {stage === 'done' && result && (
                        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-3">
                            <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
                            <p className="text-lg font-semibold text-slate-800">Importacao concluida</p>
                            <div className="flex justify-center gap-6 text-sm text-slate-600">
                                <span><strong>{result.ingredientsInserted}</strong> insumos</span>
                                <span><strong>{result.recipesInserted}</strong> receitas</span>
                                <span><strong>{result.compositionsInserted}</strong> composicoes</span>
                            </div>
                            {result.errors.length > 0 && (
                                <p className="text-xs text-amber-600">
                                    {result.errors.length} aviso(s) — veja o log acima
                                </p>
                            )}
                            <button
                                onClick={reset}
                                className="mt-4 px-6 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
                            >
                                Nova Importacao
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Sub-components ────────────────────────────────────────────────────────

const TabBtn = ({
    active, onClick, icon, label,
}: {
    active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            active
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
        }`}
    >
        {icon} {label}
    </button>
);

// ── Ingredients table ─────────────────────────────────────────────────────

const TIPO_OPTIONS = [
    { value: 'insumo_base', label: 'Insumo Base' },
    { value: 'insumo_direto', label: 'Insumo Direto' },
    { value: 'embalagem', label: 'Embalagem' },
];

const IngredientsTable = ({
    items, onChange,
}: {
    items: ParsedIngredient[]; onChange: (items: ParsedIngredient[]) => void;
}) => {
    const toggle = (idx: number) => {
        const next = [...items];
        next[idx] = { ...next[idx], _selected: !next[idx]._selected };
        onChange(next);
    };

    const updateField = (idx: number, field: keyof ParsedIngredient, value: any) => {
        const next = [...items];
        next[idx] = { ...next[idx], [field]: value };
        onChange(next);
    };

    if (items.length === 0) return <EmptyState text="Nenhum insumo detectado na planilha." />;

    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3 w-36">Tipo</th>
                    <th className="py-2 pr-3 w-20">Unid.</th>
                    <th className="py-2 pr-3 w-28 text-right">Custo</th>
                    <th className="py-2 w-28">Status</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${!item._selected ? 'opacity-40' : ''}`}>
                        <td className="py-2 pr-2">
                            <input
                                type="checkbox"
                                checked={item._selected}
                                onChange={() => toggle(i)}
                                className="rounded border-slate-300"
                            />
                        </td>
                        <td className="py-2 pr-3 font-medium text-slate-800">
                            <input
                                type="text"
                                value={item.name}
                                onChange={(e) => updateField(i, 'name', e.target.value)}
                                className="bg-transparent border-0 p-0 w-full focus:ring-0 focus:outline-none"
                            />
                        </td>
                        <td className="py-2 pr-3">
                            <select
                                value={item.tipo}
                                onChange={(e) => updateField(i, 'tipo', e.target.value)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full"
                            >
                                {TIPO_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </td>
                        <td className="py-2 pr-3">
                            <input
                                type="text"
                                value={item.unit_type}
                                onChange={(e) => updateField(i, 'unit_type', e.target.value)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full"
                            />
                        </td>
                        <td className="py-2 pr-3 text-right">
                            <input
                                type="number"
                                step="0.01"
                                value={item.avg_cost_per_unit || ''}
                                onChange={(e) => updateField(i, 'avg_cost_per_unit', parseFloat(e.target.value) || 0)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full text-right"
                            />
                        </td>
                        <td className="py-2">
                            {item.is_duplicate ? (
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                    Duplicado
                                </span>
                            ) : (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                    Novo
                                </span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

// ── Recipes table ─────────────────────────────────────────────────────────

const RECIPE_TIPO_OPTIONS = [
    { value: 'ficha_final', label: 'Ficha Final' },
    { value: 'preparo', label: 'Preparo' },
];

const CATEGORY_OPTIONS = ['Lanche', 'Porcao', 'Sobremesa', 'Combo', 'Bebida', 'Outro'];

const RecipesTable = ({
    items, onChange,
}: {
    items: ParsedRecipe[]; onChange: (items: ParsedRecipe[]) => void;
}) => {
    const toggle = (idx: number) => {
        const next = [...items];
        next[idx] = { ...next[idx], _selected: !next[idx]._selected };
        onChange(next);
    };

    const updateField = (idx: number, field: keyof ParsedRecipe, value: any) => {
        const next = [...items];
        next[idx] = { ...next[idx], [field]: value };
        onChange(next);
    };

    if (items.length === 0) return <EmptyState text="Nenhuma receita detectada na planilha." />;

    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3 w-28">Tipo</th>
                    <th className="py-2 pr-3 w-24">Categoria</th>
                    <th className="py-2 pr-3 w-24 text-right">Preco</th>
                    <th className="py-2 pr-3 w-20 text-right">Rend.</th>
                    <th className="py-2 w-28">Status</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${!item._selected ? 'opacity-40' : ''}`}>
                        <td className="py-2 pr-2">
                            <input
                                type="checkbox"
                                checked={item._selected}
                                onChange={() => toggle(i)}
                                className="rounded border-slate-300"
                            />
                        </td>
                        <td className="py-2 pr-3 font-medium text-slate-800">
                            <input
                                type="text"
                                value={item.product_name}
                                onChange={(e) => updateField(i, 'product_name', e.target.value)}
                                className="bg-transparent border-0 p-0 w-full focus:ring-0 focus:outline-none"
                            />
                        </td>
                        <td className="py-2 pr-3">
                            <select
                                value={item.tipo}
                                onChange={(e) => updateField(i, 'tipo', e.target.value)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full"
                            >
                                {RECIPE_TIPO_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </td>
                        <td className="py-2 pr-3">
                            <select
                                value={item.category}
                                onChange={(e) => updateField(i, 'category', e.target.value)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full"
                            >
                                {CATEGORY_OPTIONS.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </td>
                        <td className="py-2 pr-3 text-right">
                            <input
                                type="number"
                                step="0.01"
                                value={item.sale_price || ''}
                                onChange={(e) => updateField(i, 'sale_price', parseFloat(e.target.value) || 0)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full text-right"
                            />
                        </td>
                        <td className="py-2 pr-3 text-right">
                            <input
                                type="number"
                                step="1"
                                value={item.yield_quantity || 1}
                                onChange={(e) => updateField(i, 'yield_quantity', parseInt(e.target.value) || 1)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full text-right"
                            />
                        </td>
                        <td className="py-2">
                            {item.is_duplicate ? (
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                    Duplicado
                                </span>
                            ) : (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                    Novo
                                </span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

// ── Compositions view ─────────────────────────────────────────────────────

const CompositionsView = ({
    items, onChange,
}: {
    items: ParsedComposition[]; onChange: (items: ParsedComposition[]) => void;
}) => {
    if (items.length === 0) {
        return <EmptyState text="Nenhuma composicao detectada. Voce pode vincular insumos as receitas manualmente no app." />;
    }

    // Group by recipe
    const grouped = new Map<string, ParsedComposition[]>();
    for (const comp of items) {
        const list = grouped.get(comp.recipe_name) ?? [];
        list.push(comp);
        grouped.set(comp.recipe_name, list);
    }

    const removeComp = (recipeName: string, idx: number) => {
        let count = 0;
        onChange(items.filter((c) => {
            if (c.recipe_name === recipeName) {
                return count++ !== idx;
            }
            return true;
        }));
    };

    return (
        <div className="space-y-4">
            {Array.from(grouped.entries()).map(([recipeName, comps]) => (
                <div key={recipeName} className="border border-slate-100 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 font-medium text-sm text-slate-800 flex items-center gap-2">
                        <UtensilsCrossed className="w-4 h-4 text-primary-500" />
                        {recipeName}
                    </div>
                    <div className="divide-y divide-slate-50">
                        {comps.map((comp, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                                <div className="flex items-center gap-3">
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                        comp.component_type === 'sub_recipe'
                                            ? 'bg-purple-100 text-purple-700'
                                            : 'bg-blue-100 text-blue-700'
                                    }`}>
                                        {comp.component_type === 'sub_recipe' ? 'Preparo' : 'Insumo'}
                                    </span>
                                    <span className="text-slate-700">{comp.component_name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-slate-500 text-xs">
                                        {comp.quantity_needed} {comp.unit}
                                    </span>
                                    <button
                                        onClick={() => removeComp(recipeName, i)}
                                        className="text-slate-400 hover:text-red-500"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ── Warnings list ─────────────────────────────────────────────────────────

const WarningsList = ({ items }: { items: string[] }) => (
    <div className="space-y-2">
        {items.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{w}</span>
            </div>
        ))}
    </div>
);

// ── Guide card ────────────────────────────────────────────────────────────

const GuideCard = ({
    icon, title, description, example, optional,
}: {
    icon: React.ReactNode; title: string; description: string; example: string[]; optional?: boolean;
}) => (
    <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-700">
                {icon} {title}
            </div>
            {optional && (
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                    opcional
                </span>
            )}
        </div>
        <p className="text-xs text-slate-500">{description}</p>
        <div className="bg-white border border-slate-100 rounded p-2 font-mono text-[11px] text-slate-500 space-y-0.5">
            {example.map((line, i) => (
                <div key={i}>{line}</div>
            ))}
        </div>
    </div>
);

// ── Empty state ───────────────────────────────────────────────────────────

const EmptyState = ({ text }: { text: string }) => (
    <div className="text-center py-12 text-slate-400 text-sm">{text}</div>
);
