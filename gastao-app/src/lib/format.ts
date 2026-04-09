/** Formata valor monetário: sempre 2 casas decimais */
export const fmtMoney = (v: number): string => v.toFixed(2);

/** Formata quantidade conforme unidade:
 *  kg, g, l, ml → 3 casas
 *  un, cx, pct, fardo, porção → sem decimais desnecessários (max 2)
 */
export const fmtQty = (v: number, unit: string): string => {
    const u = unit.toLowerCase();
    if (['kg', 'g', 'l', 'ml'].includes(u)) return v.toFixed(3);
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
};
