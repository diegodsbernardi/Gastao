// =============================================================
// Gastão — Tipos centralizados
// Reflete o modelo de 3 camadas das fichas técnicas:
//   Insumo Base → Preparo → Ficha Final
// =============================================================

// ── Insumos (tabela: ingredients) ────────────────────────────

export type IngredientTipo = 'insumo_base' | 'insumo_direto' | 'embalagem';

/**
 * insumo_base   → vem de NF-e, entra em Preparos (ex: Queijo KG, Carne Moída KG)
 * insumo_direto → vai direto na Ficha Final  (ex: Pão Brioche, Refrigerante)
 */
export interface Ingredient {
    id: string;
    restaurant_id: string;
    name: string;
    tipo: IngredientTipo;
    categoria?: string | null;
    unit_type: string;
    avg_cost_per_unit: number;
    stock_quantity: number;
    use_in_recipes: boolean;
}

// ── Receitas / Preparos / Fichas Finais (tabela: recipes) ─────

export type RecipeTipo = 'preparo' | 'ficha_final';

/**
 * preparo      → mini-receita que cria uma unidade padrão (ex: Smash 80g, Fatia de Queijo)
 *                yield_quantity define quantas unidades a receita produz
 *                custo_por_unidade = custo_total_insumos / yield_quantity
 *
 * ficha_final  → produto vendido ao cliente (ex: X-Tudo, Combo Simples)
 *                usa Preparos + Insumos Diretos na composição
 */
export interface Recipe {
    id: string;
    restaurant_id: string;
    product_name: string;
    sale_price: number;
    category: string;
    tipo: RecipeTipo;
    yield_quantity: number; // relevante apenas para preparos; default 1
    unit_type: string;      // unidade de saída do preparo (ex: 'g', 'un', 'porção')
}

// ── Composição: Ficha → Insumo Direto (tabela: recipe_ingredients) ──

export interface RecipeIngredient {
    id: string;
    recipe_id: string;
    ingredient_id: string;
    quantity_needed: number;
    ingredients: Pick<Ingredient, 'id' | 'name' | 'unit_type' | 'avg_cost_per_unit' | 'tipo'>;
}

// ── Composição: Ficha Final → Preparo (tabela: recipe_sub_recipes) ──

export interface RecipeSubRecipe {
    id: string;
    recipe_id: string;      // ficha_final que usa o preparo
    sub_recipe_id: string;  // id do preparo
    quantity_needed: number;
    sub_recipe: Pick<Recipe, 'id' | 'product_name' | 'tipo' | 'yield_quantity'> & {
        /** Custo por unidade calculado em runtime (não está no banco) */
        cost_per_unit?: number;
    };
}

// ── Cálculo de custo ─────────────────────────────────────────

export interface CostLineItem {
    label: string;
    unit: string;
    qty: number;
    unit_cost: number;
    line_cost: number;
}

export interface CostBreakdown {
    total_cost: number;
    items: CostLineItem[];
}

// ── Modos de visualização ─────────────────────────────────────

/**
 * gerencia  → dono / gerente: vê CMV, custos, edição, dashboard
 * operacao  → funcionário: vê fichas no estilo "livro de receitas", sem dados financeiros
 */
export type ViewMode = 'gerencia' | 'operacao';
