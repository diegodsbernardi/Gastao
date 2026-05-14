/** Formata valor monetário no padrão brasileiro: R$ 1.234,56
 *  Pra valores pequenos (< R$ 0,01) usa 4 decimais pra não arredondar pra zero
 *  (caso comum: custo de insumo por grama/ml).
 */
export const fmtMoney = (v: number): string => {
    const abs = Math.abs(v);
    if (abs > 0 && abs < 0.01) {
        return v.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
        });
    }
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

/** Formata valor monetário sem símbolo: 1.234,56 */
export const fmtMoneyRaw = (v: number): string =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formata quantidade conforme unidade:
 *  kg, g, l, ml → 3 casas
 *  un, cx, pct, fardo, porção → sem decimais desnecessários (max 2)
 */
export const fmtQty = (v: number, unit: string): string => {
    const u = unit.toLowerCase();
    if (['kg', 'g', 'l', 'ml'].includes(u)) {
        return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
    return Number.isInteger(v)
        ? v.toLocaleString('pt-BR')
        : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Formata número para CSV no padrão BR (vírgula decimal, ponto milhar) */
export const fmtCsvNumber = (v: number, decimals = 2): string =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
