import * as XLSX from 'xlsx';
import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SheetData {
    name: string;
    headers: string[];
    sample_rows: unknown[][];
    all_rows: unknown[][];
}

export interface ParsedIngredient {
    _source_sheet: string;
    _source_row: number;
    name: string;
    tipo: string;
    unit_type: string;
    avg_cost_per_unit: number;
    aproveitamento: number; // 0-1, default 1
    is_duplicate: boolean;
    duplicate_of?: string;
    _selected: boolean; // UI toggle
}

export interface ParsedRecipe {
    _source_sheet: string;
    _source_row: number;
    product_name: string;
    tipo: string;
    sale_price: number;
    category: string;
    yield_quantity: number;
    unit_type: string;
    is_duplicate: boolean;
    duplicate_of?: string;
    _selected: boolean;
}

export interface ParsedComposition {
    recipe_name: string;
    component_name: string;
    component_type: 'ingredient' | 'sub_recipe';
    quantity_needed: number;
    unit: string;
}

export interface InterpretationResult {
    ingredients: ParsedIngredient[];
    recipes: ParsedRecipe[];
    compositions: ParsedComposition[];
    warnings: string[];
    ai_confidence: number;
}

export interface InsertionResult {
    ingredientsInserted: number;
    recipesInserted: number;
    compositionsInserted: number;
    errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getEdgeFunctionUrl(name: string): string {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    return `${url}/functions/v1/${name}`;
}

async function getAuthToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Usuario nao autenticado');
    return session.access_token;
}

async function getRestauranteId(): Promise<string> {
    const { data, error } = await supabase.rpc('get_my_membership');
    if (error || !data || data.length === 0) throw new Error('Restaurante nao encontrado');
    return data[0].restaurante_id as string;
}

// ── Step 1: Parse Excel ───────────────────────────────────────────────────

// Stores recipe/preparo names found during preprocessing (used to filter out pseudo-insumos)
let _preprocessedRecipeNames: Set<string> = new Set();

export function getPreprocessedRecipeNames(): Set<string> {
    return _preprocessedRecipeNames;
}

export async function parseExcelSheets(file: File): Promise<SheetData[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const rawSheets: { name: string; aoa: unknown[][] }[] = workbook.SheetNames.map((name) => {
        const ws = workbook.Sheets[name];
        const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        return { name, aoa };
    });

    // Pre-process: detect and convert block-format sheets (fichas operacionais / montagem)
    const { sheets: processed, recipeNames } = preprocessBlockSheets(rawSheets);
    _preprocessedRecipeNames = recipeNames;

    return processed.map(({ name, aoa }) => {
        if (!aoa.length || !aoa[0]) {
            return { name, headers: [], sample_rows: [], all_rows: [] };
        }

        const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
        const dataRows = aoa.slice(1).filter((row) =>
            Array.isArray(row) && row.some((cell) => cell != null && String(cell).trim() !== '')
        );

        return {
            name,
            headers,
            sample_rows: dataRows.slice(0, 5),
            all_rows: dataRows,
        };
    }).filter((s) => s.all_rows.length > 0 && s.headers.some((h) => h.length > 0));
}

// ── Pre-processor: convert block-format sheets to tabular ────────────────

const SKIP_INGREDIENTS = new Set([
    'ingredientes', 'etiquetas', 'sem glúten', 'sem lactose', 'sem ovo',
    'fit', 'low carb', 'gourmet', 'kids', 'vegetariano', 'vegano',
    'shelflife / validade', 'armazenamento:', 'ficha técnica operacional',
    'ficha de montagem', '',
]);

interface ParsedBlock {
    name: string;
    code: string;
    category: string;
    ingredients: { name: string; qty: number; unit: string }[];
    yield_quantity: number;
    yield_unit: string;
}

type BlockSheetType = 'preparo' | 'montagem';

function detectSheetType(aoa: unknown[][]): BlockSheetType | null {
    // Scan first 10 rows for type marker, but also check deeper (some sheets have it at L32+)
    for (let i = 0; i < Math.min(40, aoa.length); i++) {
        const row = aoa[i];
        if (!row) continue;
        for (const cell of row) {
            const val = String(cell ?? '').trim();
            if (val === 'FICHA TÉCNICA OPERACIONAL') return 'preparo';
            if (val === 'FICHA DE MONTAGEM') return 'montagem';
        }
    }
    return null;
}

function parseBlocks(aoa: unknown[][], type: BlockSheetType): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    let current: ParsedBlock | null = null;
    let collectingIngredients = false;

    // Column layout differs:
    // Preparo:  col2=name, col4=UND, col5=QTD
    // Montagem: col2=name, col4=QTD, col5=UND
    const qtyCol = type === 'montagem' ? 4 : 5;
    const undCol = type === 'montagem' ? 5 : 4;

    for (let i = 0; i < aoa.length; i++) {
        const row = aoa[i] as unknown[];
        if (!row) continue;

        const col3 = String(row[3] ?? '').trim();
        const col5 = String(row[5] ?? '').trim();

        // Detect block start: "Receita" or "Cód. :" in col 3
        if ((col3 === 'Receita' || col3 === 'Cód. :') && col5) {
            if (current && current.ingredients.length > 0) blocks.push(current);
            current = {
                name: col5,
                code: String(row[4] ?? '').trim(),
                category: '',
                ingredients: [],
                yield_quantity: 1,
                yield_unit: 'un',
            };
            collectingIngredients = false;
            continue;
        }

        // Detect category (montagem format): "CATEGORIA" in col 3
        if (current && col3 === 'CATEGORIA' && row[4]) {
            current.category = String(row[4]).trim();
            continue;
        }

        // Detect yield/rendimento row
        if (current && (col3 === 'Qntd Rendimento' || col3 === 'RENDIMENTO' || col3.toLowerCase().startsWith('qntd rendimento'))) {
            const yieldQty = parseFloat(String(row[4] ?? row[5] ?? '1').replace(',', '.'));
            if (yieldQty > 0) current.yield_quantity = yieldQty;
            const yieldUnit = String(row[5] ?? row[6] ?? '').trim();
            if (yieldUnit && !/^\d/.test(yieldUnit)) current.yield_unit = yieldUnit.toLowerCase();
            continue;
        }
        if (current && col3 === 'Und Rendimento') {
            const yUnit = String(row[4] ?? row[5] ?? '').trim();
            if (yUnit) current.yield_unit = yUnit.toLowerCase();
            continue;
        }

        // Detect ingredient header row: "INGREDIENTES" in col 2
        const col2 = String(row[2] ?? '').trim();
        if (col2 === 'INGREDIENTES') {
            collectingIngredients = true;
            continue;
        }

        // Detect block end markers
        if (col2.toLowerCase() === 'etiquetas' || col2 === 'FICHA TÉCNICA OPERACIONAL' || col2 === 'FICHA DE MONTAGEM') {
            collectingIngredients = false;
            continue;
        }

        // Collect ingredients
        if (current && collectingIngredients && col2 && !SKIP_INGREDIENTS.has(col2.toLowerCase())) {
            const unit = String(row[undCol] ?? '').trim();
            const qty = parseFloat(String(row[qtyCol] ?? '0').replace(',', '.'));

            if (qty > 0 && unit) {
                current.ingredients.push({ name: col2, qty, unit });
            }
        }
    }

    if (current && current.ingredients.length > 0) blocks.push(current);
    return blocks;
}

function preprocessBlockSheets(
    sheets: { name: string; aoa: unknown[][] }[]
): { sheets: { name: string; aoa: unknown[][] }[]; recipeNames: Set<string> } {
    const result: { name: string; aoa: unknown[][] }[] = [];
    const preparoBlocks: ParsedBlock[] = [];
    const montagemBlocks: ParsedBlock[] = [];
    const recipeNames = new Set<string>();

    for (const sheet of sheets) {
        const type = detectSheetType(sheet.aoa);

        if (type === 'preparo') {
            const blocks = parseBlocks(sheet.aoa, type);
            preparoBlocks.push(...blocks);
            blocks.forEach((b) => recipeNames.add(b.name.toLowerCase().trim()));
        } else if (type === 'montagem') {
            const blocks = parseBlocks(sheet.aoa, type);
            montagemBlocks.push(...blocks);
            blocks.forEach((b) => recipeNames.add(b.name.toLowerCase().trim()));
        } else {
            result.push(sheet);
        }
    }

    // Convert preparo blocks to TWO virtual sheets:
    // 1. Recipes sheet (preparos with yield)
    // 2. Compositions sheet (linking preparos to ingredients)
    if (preparoBlocks.length > 0) {
        // Recipes virtual sheet for preparos
        const recHeaders = ['Produto', 'Tipo', 'Rendimento', 'Und Rendimento'];
        const recRows: unknown[][] = [];
        for (const block of preparoBlocks) {
            recRows.push([block.name, 'preparo', block.yield_quantity, block.yield_unit]);
        }
        result.push({ name: '_Preparos Receitas (auto)', aoa: [recHeaders, ...recRows] });

        // Compositions virtual sheet
        const compHeaders = ['Preparo', 'Ingrediente', 'Qtd', 'Und'];
        const compRows: unknown[][] = [];
        for (const block of preparoBlocks) {
            for (const ing of block.ingredients) {
                compRows.push([block.name, ing.name, ing.qty, ing.unit]);
            }
        }
        result.push({ name: '_Preparos Composicoes (auto)', aoa: [compHeaders, ...compRows] });
    }

    // Convert montagem blocks to TWO virtual sheets:
    // 1. Recipes sheet (fichas finais with category)
    // 2. Compositions sheet (linking recipes to ingredients)
    if (montagemBlocks.length > 0) {
        // Recipes virtual sheet
        const recHeaders = ['Produto', 'Tipo', 'Categoria', 'Rendimento', 'Und Rendimento'];
        const recRows: unknown[][] = [];
        for (const block of montagemBlocks) {
            recRows.push([block.name, 'ficha_final', block.category || 'Outro', block.yield_quantity, block.yield_unit]);
        }
        result.push({ name: '_Fichas Montagem Receitas (auto)', aoa: [recHeaders, ...recRows] });

        // Compositions virtual sheet
        const compHeaders = ['Prato', 'Ingrediente', 'Qtd', 'Und'];
        const compRows: unknown[][] = [];
        for (const block of montagemBlocks) {
            for (const ing of block.ingredients) {
                compRows.push([block.name, ing.name, ing.qty, ing.unit]);
            }
        }
        result.push({ name: '_Fichas Montagem Composicoes (auto)', aoa: [compHeaders, ...compRows] });
    }

    return { sheets: result, recipeNames };
}

// ── Step 2: Interpret with AI ─────────────────────────────────────────────

export async function interpretarFichaTecnica(
    sheets: SheetData[],
): Promise<InterpretationResult> {
    let restauranteId: string;
    try {
        restauranteId = await getRestauranteId();
    } catch (err: any) {
        throw new Error(`Falha ao buscar restaurante: ${err.message}. Verifique se voce esta logado.`);
    }

    // Fetch existing names for dedup
    const [{ data: existingIngs }, { data: existingRecs }] = await Promise.all([
        supabase.from('ingredients').select('name').eq('restaurant_id', restauranteId),
        supabase.from('recipes').select('product_name').eq('restaurant_id', restauranteId),
    ]);

    const existingIngNames = (existingIngs || []).map((i) => i.name);
    const existingRecNames = (existingRecs || []).map((r) => r.product_name);

    const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'interpret-ficha-tecnica',
        {
            body: {
                restaurant_id: restauranteId,
                sheets,
                existing_ingredient_names: existingIngNames,
                existing_recipe_names: existingRecNames,
            },
        },
    );

    if (fnError) {
        // Try to extract the actual error message from the response
        let detail = fnError.message;
        if (fnError.context && typeof fnError.context === 'object') {
            try {
                const body = await (fnError.context as Response).json();
                detail = body.error || JSON.stringify(body);
            } catch { /* ignore */ }
        }
        throw new Error(`Erro ao interpretar: ${detail}`);
    }

    if (!fnData) {
        throw new Error('Erro ao interpretar: resposta vazia da edge function');
    }

    const data = fnData as Omit<InterpretationResult, '_selected'>;

    // Build set of all recipe/preparo names (from Claude + from preprocessor)
    const recipeNameSet = new Set<string>();
    for (const rec of data.recipes) {
        recipeNameSet.add(rec.product_name.toLowerCase().trim());
    }
    // Also include names from block-format preprocessing (more reliable)
    const preprocessedNames = getPreprocessedRecipeNames();
    for (const name of preprocessedNames) {
        recipeNameSet.add(name);
    }

    // Deduplicate ingredients by name AND remove ingredients that are actually preparos/recipes
    const seenIngNames = new Set<string>();
    const dedupedIngs = data.ingredients.filter((ing) => {
        const key = ing.name.toLowerCase().trim();
        if (seenIngNames.has(key)) return false;
        seenIngNames.add(key);
        // If this "ingredient" is actually a recipe/preparo, skip it from ingredients
        if (recipeNameSet.has(key)) return false;
        return true;
    });

    const seenRecNames = new Set<string>();
    const dedupedRecs = data.recipes.filter((rec) => {
        const key = rec.product_name.toLowerCase().trim();
        if (seenRecNames.has(key)) return false;
        seenRecNames.add(key);
        return true;
    });

    // Add _selected flag (deselect duplicates by default)
    return {
        ...data,
        ingredients: dedupedIngs.map((ing) => ({
            ...ing,
            _selected: !ing.is_duplicate,
        })),
        recipes: dedupedRecs.map((rec) => ({
            ...rec,
            _selected: !rec.is_duplicate,
        })),
    };
}

// ── Fuzzy matching helpers ───────────────────────────────────────────────

/** Remove accents/diacritics for comparison */
function removeAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Normalize name for matching: lowercase, trim, remove accents */
function normalizeForMatch(s: string): string {
    return removeAccents(s.toLowerCase().trim());
}

/** Known synonyms for ingredient matching */
const SYNONYMS: [string, string][] = [
    ['raspa', 'casca'],
    ['file', 'filé'],
    ['acucar', 'açucar'],
];

/**
 * Fuzzy match a component name against a map of known names.
 * Tries in order: exact → accent-insensitive → partial/substring → synonym swap
 * Returns the matched key (lowercase) or null.
 */
function fuzzyMatchName(name: string, knownNames: Map<string, string>): string | null {
    const key = name.toLowerCase().trim();

    // 1. Exact match
    if (knownNames.has(key)) return key;

    // 2. Accent-insensitive match
    const normName = normalizeForMatch(name);
    for (const known of knownNames.keys()) {
        if (normalizeForMatch(known) === normName) return known;
    }

    // 3. Partial match: "camarao" matches "camarao G", "pomodoro" matches "Molho pomodoro"
    //    Prefer shorter known names (more specific match)
    let bestPartial: string | null = null;
    let bestLen = Infinity;
    for (const known of knownNames.keys()) {
        const normKnown = normalizeForMatch(known);
        // Component name is a substring of known name, or vice-versa
        if (normKnown.includes(normName) || normName.includes(normKnown)) {
            if (known.length < bestLen) {
                bestPartial = known;
                bestLen = known.length;
            }
        }
    }
    if (bestPartial) return bestPartial;

    // 4. Synonym swap: try replacing known synonyms and re-matching
    for (const [a, b] of SYNONYMS) {
        const swapped1 = normName.replace(a, b);
        const swapped2 = normName.replace(b, a);
        for (const known of knownNames.keys()) {
            const normKnown = normalizeForMatch(known);
            if (normKnown === swapped1 || normKnown === swapped2) return known;
        }
    }

    // 5. Match ignoring prepositions (de, do, da, dos, das)
    const stripPreps = (s: string) => s.replace(/\b(de|do|da|dos|das)\b/g, '').replace(/\s+/g, ' ').trim();
    const strippedName = stripPreps(normName);
    for (const known of knownNames.keys()) {
        if (stripPreps(normalizeForMatch(known)) === strippedName) return known;
    }

    return null;
}

// ── Unit conversion helpers ──────────────────────────────────────────────

/** Convert quantity to base unit (g→kg, ml→l) */
function normalizeQuantityToBaseUnit(qty: number, unit: string): number {
    const u = unit.toLowerCase().trim();
    if (u === 'g' || u === 'grama' || u === 'gramas') return qty / 1000;
    if (u === 'ml' || u === 'mililitro' || u === 'mililitros') return qty / 1000;
    return qty;
}

/** Get the base unit for a given unit */
function getBaseUnit(unit: string): string {
    const u = unit.toLowerCase().trim();
    if (u === 'g' || u === 'grama' || u === 'gramas') return 'kg';
    if (u === 'ml' || u === 'mililitro' || u === 'mililitros') return 'l';
    return u;
}

/** Convert quantity from source unit to target unit */
function convertToTargetUnit(qty: number, fromUnit: string, toUnit: string): number {
    const from = fromUnit.toLowerCase().trim();
    const to = toUnit.toLowerCase().trim();
    if (from === to) return qty;

    // g → kg
    if ((from === 'g' || from === 'grama' || from === 'gramas') && to === 'kg') return qty / 1000;
    // kg → g
    if (from === 'kg' && (to === 'g' || to === 'grama' || to === 'gramas')) return qty * 1000;
    // ml → l
    if ((from === 'ml' || from === 'mililitro' || from === 'mililitros') && to === 'l') return qty / 1000;
    // l → ml
    if (from === 'l' && (to === 'ml' || to === 'mililitro' || to === 'mililitros')) return qty * 1000;

    return qty; // incompatible units, return as-is
}

// ── Step 3: Insert confirmed data ─────────────────────────────────────────

export async function inserirFichaTecnica(
    ingredients: ParsedIngredient[],
    recipes: ParsedRecipe[],
    compositions: ParsedComposition[],
): Promise<InsertionResult> {
    const restauranteId = await getRestauranteId();
    const errors: string[] = [];
    const warnings: string[] = [];
    let ingredientsInserted = 0;
    let recipesInserted = 0;
    let compositionsInserted = 0;

    // Name → ID maps (includes both new and existing items)
    const ingNameToId = new Map<string, string>();
    const recNameToId = new Map<string, string>();

    // Load existing items into maps
    const [{ data: allIngs }, { data: allRecs }] = await Promise.all([
        supabase.from('ingredients').select('id, name').eq('restaurant_id', restauranteId),
        supabase.from('recipes').select('id, product_name').eq('restaurant_id', restauranteId),
    ]);
    for (const ing of allIngs || []) {
        ingNameToId.set(ing.name.toLowerCase().trim(), ing.id);
    }
    for (const rec of allRecs || []) {
        recNameToId.set(rec.product_name.toLowerCase().trim(), rec.id);
    }

    // 0. Determine which ingredients are used directly in fichas finais
    //    Those must be 'insumo_direto', not 'insumo_base'
    const fichaFinalNames = new Set(
        recipes.filter((r) => r._selected && r.tipo === 'ficha_final')
            .map((r) => r.product_name.toLowerCase().trim())
    );
    const ingredientsUsedInFichas = new Set<string>();
    for (const comp of compositions) {
        if (comp.component_type === 'ingredient' &&
            fichaFinalNames.has(comp.recipe_name.toLowerCase().trim())) {
            ingredientsUsedInFichas.add(comp.component_name.toLowerCase().trim());
        }
    }

    // 1. Insert ingredients
    const selectedIngs = ingredients.filter((i) => i._selected);
    if (selectedIngs.length > 0) {
        const payload = selectedIngs.map((i) => {
            // If this ingredient is used directly in a ficha_final, make it insumo_direto
            const usedInFicha = ingredientsUsedInFichas.has(i.name.toLowerCase().trim());
            let tipo = i.tipo;
            if (usedInFicha && tipo === 'insumo_base') {
                tipo = 'insumo_direto';
            }
            if (tipo !== 'insumo_base' && tipo !== 'insumo_direto') {
                tipo = 'insumo_base';
            }
            return {
                restaurant_id: restauranteId,
                name: i.name,
                tipo,
                unit_type: i.unit_type,
                avg_cost_per_unit: i.avg_cost_per_unit,
                aproveitamento: i.aproveitamento || 1,
                stock_quantity: 0,
            };
        });

        const { data: inserted, error } = await supabase
            .from('ingredients')
            .insert(payload)
            .select('id, name');

        if (error) {
            errors.push(`Erro ao inserir insumos: ${error.message}`);
        } else {
            ingredientsInserted = inserted?.length ?? 0;
            for (const ing of inserted || []) {
                ingNameToId.set(ing.name.toLowerCase().trim(), ing.id);
            }
        }
    }

    // 2. Insert recipes
    const selectedRecs = recipes.filter((r) => r._selected);
    if (selectedRecs.length > 0) {
        const payload = selectedRecs.map((r) => ({
            restaurant_id: restauranteId,
            product_name: r.product_name,
            tipo: r.tipo === 'preparo' || r.tipo === 'ficha_final' ? r.tipo : 'ficha_final',
            sale_price: r.sale_price,
            category: r.category || 'Outro',
            yield_quantity: r.yield_quantity || 1,
            unit_type: r.unit_type || 'un',
        }));

        const { data: inserted, error } = await supabase
            .from('recipes')
            .insert(payload)
            .select('id, product_name');

        if (error) {
            errors.push(`Erro ao inserir receitas: ${error.message}`);
        } else {
            recipesInserted = inserted?.length ?? 0;
            for (const rec of inserted || []) {
                recNameToId.set(rec.product_name.toLowerCase().trim(), rec.id);
            }
        }
    }

    // Build ingredient unit map for unit normalization
    const ingUnitMap = new Map<string, string>();
    for (const ing of selectedIngs) {
        ingUnitMap.set(ing.name.toLowerCase().trim(), ing.unit_type);
    }
    // Also include existing ingredients' units
    const { data: existingIngUnits } = await supabase
        .from('ingredients')
        .select('name, unit_type')
        .eq('restaurant_id', restauranteId);
    for (const ing of existingIngUnits || []) {
        ingUnitMap.set(ing.name.toLowerCase().trim(), ing.unit_type);
    }

    // 3. Insert compositions (with dedup + unit normalization)
    if (compositions.length > 0) {
        // Bug 4 fix: deduplicate compositions by (recipe, component), summing quantities
        const compKey = (c: ParsedComposition) =>
            `${c.recipe_name.toLowerCase().trim()}::${c.component_name.toLowerCase().trim()}`;
        const dedupMap = new Map<string, ParsedComposition>();
        for (const comp of compositions) {
            const key = compKey(comp);
            const existing = dedupMap.get(key);
            if (existing) {
                // Same unit: sum quantities. Different units: convert then sum.
                const normalizedQty = normalizeQuantityToBaseUnit(comp.quantity_needed, comp.unit);
                const existingQty = normalizeQuantityToBaseUnit(existing.quantity_needed, existing.unit);
                existing.quantity_needed = existingQty + normalizedQty;
                existing.unit = getBaseUnit(existing.unit);
            } else {
                dedupMap.set(key, { ...comp });
            }
        }
        const dedupedComps = Array.from(dedupMap.values());

        const recipeIngredients: { recipe_id: string; ingredient_id: string; sub_recipe_id: null; quantity_needed: number }[] = [];
        const recipeSubRecipes: { recipe_id: string; sub_recipe_id: string; quantity_needed: number }[] = [];
        const missingIngredients: { comp: ParsedComposition; recipeId: string; qty: number }[] = [];

        for (const comp of dedupedComps) {
            // Fuzzy match recipe name
            const recipeKey = fuzzyMatchName(comp.recipe_name, recNameToId);
            const recipeId = recipeKey ? recNameToId.get(recipeKey) : undefined;
            if (!recipeId) {
                errors.push(`Composicao ignorada: receita "${comp.recipe_name}" nao encontrada`);
                continue;
            }

            // Bug 2 fix: normalize quantity to match ingredient's base unit
            let qty = comp.quantity_needed;
            const compUnit = comp.unit.toLowerCase().trim();
            const ingMatchKey = fuzzyMatchName(comp.component_name, ingUnitMap);
            const ingUnit = ingMatchKey ? ingUnitMap.get(ingMatchKey) : undefined;
            if (ingUnit) {
                qty = convertToTargetUnit(qty, compUnit, ingUnit);
            }

            if (comp.component_type === 'sub_recipe') {
                const subKey = fuzzyMatchName(comp.component_name, recNameToId);
                const subId = subKey ? recNameToId.get(subKey) : undefined;
                if (subId) {
                    recipeSubRecipes.push({
                        recipe_id: recipeId,
                        sub_recipe_id: subId,
                        quantity_needed: qty,
                    });
                } else {
                    errors.push(`Composicao ignorada: preparo "${comp.component_name}" nao encontrado`);
                }
            } else {
                // Try ingredient first, then fallback to recipe (it might be a sub_recipe)
                const ingKey = fuzzyMatchName(comp.component_name, ingNameToId);
                const ingId = ingKey ? ingNameToId.get(ingKey) : undefined;
                if (ingId) {
                    recipeIngredients.push({
                        recipe_id: recipeId,
                        ingredient_id: ingId,
                        sub_recipe_id: null,
                        quantity_needed: qty,
                    });
                } else {
                    // Fallback: check if it's a recipe/preparo (e.g. "pomodoro" → "Molho pomodoro")
                    const subKey = fuzzyMatchName(comp.component_name, recNameToId);
                    const subId = subKey ? recNameToId.get(subKey) : undefined;
                    if (subId) {
                        recipeSubRecipes.push({
                            recipe_id: recipeId,
                            sub_recipe_id: subId,
                            quantity_needed: qty,
                        });
                    } else {
                        // Auto-create missing ingredient and link it
                        missingIngredients.push({ comp, recipeId, qty });
                    }
                }
            }
        }

        // Auto-create ingredients that appear in compositions but don't exist
        if (missingIngredients.length > 0) {
            // Deduplicate by name
            const uniqueMissing = new Map<string, { comp: ParsedComposition; recipeId: string; qty: number }[]>();
            for (const m of missingIngredients) {
                const key = m.comp.component_name.toLowerCase().trim();
                if (!uniqueMissing.has(key)) uniqueMissing.set(key, []);
                uniqueMissing.get(key)!.push(m);
            }

            const autoPayload = Array.from(uniqueMissing.keys()).map((name) => ({
                restaurant_id: restauranteId,
                name,
                tipo: 'insumo_base' as const,
                unit_type: 'un',
                avg_cost_per_unit: 0,
                aproveitamento: 1,
                stock_quantity: 0,
            }));

            const { data: autoInserted, error: autoErr } = await supabase
                .from('ingredients')
                .insert(autoPayload)
                .select('id, name');

            if (autoErr) {
                errors.push(`Erro ao auto-criar insumos faltantes: ${autoErr.message}`);
            } else {
                for (const ing of autoInserted || []) {
                    ingNameToId.set(ing.name.toLowerCase().trim(), ing.id);
                }
                ingredientsInserted += autoInserted?.length ?? 0;

                // Now link them
                for (const [name, entries] of uniqueMissing) {
                    const newIngId = ingNameToId.get(name);
                    if (!newIngId) continue;
                    for (const { recipeId, qty } of entries) {
                        recipeIngredients.push({
                            recipe_id: recipeId,
                            ingredient_id: newIngId,
                            sub_recipe_id: null,
                            quantity_needed: qty,
                        });
                    }
                }

                warnings.push(`${autoInserted?.length ?? 0} insumo(s) criado(s) automaticamente: ${Array.from(uniqueMissing.keys()).join(', ')}`);
            }
        }

        if (recipeIngredients.length > 0) {
            const { data: riData, error } = await supabase
                .from('recipe_ingredients')
                .insert(recipeIngredients)
                .select('id');
            if (error) {
                errors.push(`Erro ao inserir composicoes (insumos): ${error.message}`);
            } else if (!riData || riData.length === 0) {
                errors.push(`Composicoes (insumos): insert retornou vazio — possivel problema de RLS. Tentados: ${recipeIngredients.length}`);
            } else {
                compositionsInserted += riData.length;
            }
        }

        if (recipeSubRecipes.length > 0) {
            const { data: rsData, error } = await supabase
                .from('recipe_sub_recipes')
                .insert(recipeSubRecipes)
                .select('id');
            if (error) {
                errors.push(`Erro ao inserir composicoes (preparos): ${error.message}`);
            } else if (!rsData || rsData.length === 0) {
                errors.push(`Composicoes (preparos): insert retornou vazio — possivel problema de RLS. Tentados: ${recipeSubRecipes.length}`);
            } else {
                compositionsInserted += rsData.length;
            }
        }
    }

    return { ingredientsInserted, recipesInserted, compositionsInserted, errors: [...errors, ...warnings] };
}
