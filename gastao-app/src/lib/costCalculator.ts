// =============================================================
// Gastão — Cálculo de custo centralizado
// Modelo 3 camadas com profundidade arbitrária em preparos:
//   Insumo Base → Preparo → (Preparo)* → Ficha Final
// =============================================================

/** CMV percentual. 0 se sale_price <= 0. */
export function calcCMV(cost: number, salePrice: number): number {
    if (salePrice <= 0) return 0;
    return (cost / salePrice) * 100;
}

// ─────────────────────────────────────────────────────────────
// Profundidade arbitrária (Planilha-Mãe v2)
// ─────────────────────────────────────────────────────────────

export interface PreparoNode {
    id: string;
    yield_quantity: number;
    /** Insumos diretos do preparo. avg_cost é o custo BRUTO (o aproveitamento é aplicado pelo caller). */
    ingredients: { avg_cost_per_unit: number; quantity_needed: number }[];
    /** Sub-preparos usados. Cada um aponta pra outro preparo pelo id. */
    subRecipes: { sub_recipe_id: string; quantity_needed: number }[];
}

export interface RecursiveCostResult {
    /** Map id → custo por unidade de cada preparo, resolvido recursivamente. */
    costPerUnit: Record<string, number>;
    /** Ciclos detectados (se houver). Cada ciclo é a lista de ids no caminho. */
    cycles: string[][];
}

/**
 * Calcula custo/un de todos os preparos recursivamente.
 *
 * - Memoiza resultados (cada preparo é resolvido 1x).
 * - Detecta ciclos via DFS com pilha de visita; preparos em ciclo ficam com custo 0 e são reportados.
 * - Preparos referenciando ids ausentes do map contribuem 0 (silenciosamente — a validação de existência
 *   é responsabilidade do importador, não do calculador).
 */
export function buildPreparoCostMapRecursive(
    preparos: PreparoNode[]
): RecursiveCostResult {
    const byId: Record<string, PreparoNode> = {};
    preparos.forEach(p => { byId[p.id] = p; });

    const memo: Record<string, number> = {};
    const cycles: string[][] = [];
    const VISITING = Symbol('visiting');
    const state: Record<string, typeof VISITING | 'done'> = {};

    const resolve = (id: string, path: string[]): number => {
        if (state[id] === 'done') return memo[id];
        if (state[id] === VISITING) {
            // Ciclo — fecha a partir de onde reentrou
            const i = path.indexOf(id);
            cycles.push([...path.slice(i), id]);
            return 0;
        }
        const node = byId[id];
        if (!node) return 0;
        state[id] = VISITING;
        path.push(id);

        const ingCost = node.ingredients.reduce(
            (acc, ing) => acc + ing.avg_cost_per_unit * ing.quantity_needed, 0,
        );
        const subCost = node.subRecipes.reduce(
            (acc, s) => acc + resolve(s.sub_recipe_id, path) * s.quantity_needed, 0,
        );
        const total = ingCost + subCost;
        const perUnit = node.yield_quantity > 0 ? total / node.yield_quantity : 0;

        path.pop();
        state[id] = 'done';
        memo[id] = perUnit;
        return perUnit;
    };

    for (const p of preparos) {
        if (state[p.id] !== 'done') resolve(p.id, []);
    }

    return { costPerUnit: memo, cycles };
}
