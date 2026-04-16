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
            };
            collectingIngredients = false;
            continue;
        }

        // Detect category (montagem format): "CATEGORIA" in col 3
        if (current && col3 === 'CATEGORIA' && row[4]) {
            current.category = String(row[4]).trim();
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

    // Convert preparo blocks to a virtual tabular sheet: compositions format
    if (preparoBlocks.length > 0) {
        const headers = ['Preparo', 'Ingrediente', 'Qtd', 'Und'];
        const rows: unknown[][] = [];
        for (const block of preparoBlocks) {
            for (const ing of block.ingredients) {
                rows.push([block.name, ing.name, ing.qty, ing.unit]);
            }
        }
        result.push({ name: '_Preparos (auto)', aoa: [headers, ...rows] });
    }

    // Convert montagem blocks to a virtual tabular sheet: fichas finais + compositions
    if (montagemBlocks.length > 0) {
        const headers = ['Prato', 'Categoria', 'Ingrediente', 'Qtd', 'Und'];
        const rows: unknown[][] = [];
        for (const block of montagemBlocks) {
            for (const ing of block.ingredients) {
                rows.push([block.name, block.category, ing.name, ing.qty, ing.unit]);
            }
        }
        result.push({ name: '_Fichas Montagem (auto)', aoa: [headers, ...rows] });
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

// ── Step 3: Insert confirmed data ─────────────────────────────────────────

export async function inserirFichaTecnica(
    ingredients: ParsedIngredient[],
    recipes: ParsedRecipe[],
    compositions: ParsedComposition[],
): Promise<InsertionResult> {
    const restauranteId = await getRestauranteId();
    const errors: string[] = [];
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

    // 3. Insert compositions
    if (compositions.length > 0) {
        const recipeIngredients: { recipe_id: string; ingredient_id: string; sub_recipe_id: null; quantity_needed: number }[] = [];
        const recipeSubRecipes: { recipe_id: string; sub_recipe_id: string; quantity_needed: number }[] = [];

        for (const comp of compositions) {
            const recipeId = recNameToId.get(comp.recipe_name.toLowerCase().trim());
            if (!recipeId) {
                errors.push(`Composicao ignorada: receita "${comp.recipe_name}" nao encontrada`);
                continue;
            }

            if (comp.component_type === 'sub_recipe') {
                const subId = recNameToId.get(comp.component_name.toLowerCase().trim());
                if (subId) {
                    recipeSubRecipes.push({
                        recipe_id: recipeId,
                        sub_recipe_id: subId,
                        quantity_needed: comp.quantity_needed,
                    });
                } else {
                    errors.push(`Composicao ignorada: preparo "${comp.component_name}" nao encontrado`);
                }
            } else {
                const ingId = ingNameToId.get(comp.component_name.toLowerCase().trim());
                if (ingId) {
                    recipeIngredients.push({
                        recipe_id: recipeId,
                        ingredient_id: ingId,
                        sub_recipe_id: null,
                        quantity_needed: comp.quantity_needed,
                    });
                } else {
                    errors.push(`Composicao ignorada: insumo "${comp.component_name}" nao encontrado`);
                }
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

    return { ingredientsInserted, recipesInserted, compositionsInserted, errors };
}
