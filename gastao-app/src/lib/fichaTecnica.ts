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

export async function parseExcelSheets(file: File): Promise<SheetData[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    return workbook.SheetNames.map((name) => {
        const ws = workbook.Sheets[name];
        const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

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
    }).filter((s) => s.all_rows.length > 0);
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

    // Add _selected flag (deselect duplicates by default)
    return {
        ...data,
        ingredients: data.ingredients.map((ing) => ({
            ...ing,
            _selected: !ing.is_duplicate,
        })),
        recipes: data.recipes.map((rec) => ({
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
