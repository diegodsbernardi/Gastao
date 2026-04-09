// =============================================================
// TOCS CRM — Cálculo de custo centralizado
// Lógica da hierarquia 3 camadas:
//   Insumo Base → Preparo → Ficha Final
// =============================================================

/**
 * Calcula o custo por unidade de um Preparo.
 * custo/un = soma(qty * avg_cost) / yield_quantity
 */
export function calcPreparoCostPerUnit(
    items: { avg_cost_per_unit: number; quantity_needed: number }[],
    yieldQuantity: number
): number {
    if (yieldQuantity <= 0) return 0;
    const total = items.reduce((acc, i) => acc + i.avg_cost_per_unit * i.quantity_needed, 0);
    return total / yieldQuantity;
}

/**
 * Constrói o mapa { preparo_id → custo_por_unidade } para todos os preparos.
 *
 * @param preparos          Lista de receitas com tipo='preparo' (precisa de id, yield_quantity)
 * @param preparoIngsMap    recipe_ingredients agrupados por recipe_id (só para preparos)
 */
export function buildPreparoCostMap(
    preparos: { id: string; yield_quantity: number }[],
    preparoIngsMap: Record<string, { avg_cost_per_unit: number; quantity_needed: number }[]>
): Record<string, number> {
    const map: Record<string, number> = {};
    for (const p of preparos) {
        map[p.id] = calcPreparoCostPerUnit(preparoIngsMap[p.id] ?? [], p.yield_quantity);
    }
    return map;
}

/**
 * Calcula o custo total de uma Ficha Final.
 * Soma duas fontes:
 *   1. Insumos Diretos (recipe_ingredients)
 *   2. Preparos usados (recipe_sub_recipes), com custo/un do preparoCostMap
 */
export function calcFichaFinalCost(
    ingItems: { avg_cost_per_unit: number; quantity_needed: number }[],
    subItems: { sub_recipe_id: string; quantity_needed: number }[],
    preparoCostMap: Record<string, number>
): number {
    const ingCost = ingItems.reduce((acc, i) => acc + i.avg_cost_per_unit * i.quantity_needed, 0);
    const subCost = subItems.reduce((acc, s) => acc + (preparoCostMap[s.sub_recipe_id] ?? 0) * s.quantity_needed, 0);
    return ingCost + subCost;
}

/**
 * Calcula o CMV percentual.
 * Retorna 0 se sale_price for zero (evita divisão por zero).
 */
export function calcCMV(cost: number, salePrice: number): number {
    if (salePrice <= 0) return 0;
    return (cost / salePrice) * 100;
}
