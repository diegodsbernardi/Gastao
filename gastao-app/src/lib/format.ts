/** Formata valor monetário no padrão brasileiro: R$ 1.234,56
 *  Pra valores pequenos (< R$ 0,01) usa 4 decimais pra não arredondar pra zero
 *  (caso comum: custo de insumo por grama/ml).
 */
export const fmtMoney = (v: number | null | undefined): string => {
    // Null-safe: dado ausente rende R$ 0,00 em vez de derrubar a página inteira
    // (tela branca de jul/2026: fichas importadas com sale_price NULL).
    if (v == null || Number.isNaN(v)) v = 0;
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

/** Custo por unidade, legível. Custo por grama/ml vira número minúsculo e
 *  ilegível (R$ 0,0042); convertemos pra kg/L pra virar R$ 4,20/kg.
 *  /un e valores já legíveis ficam como estão. */
export const fmtCustoUnitario = (custo: number | null | undefined, unit: string | null | undefined): string => {
    if (custo == null || Number.isNaN(custo)) custo = 0;
    const u = (unit ?? '').toLowerCase();
    const escala: Record<string, string> = { g: 'kg', ml: 'L' };
    if (escala[u] && custo > 0 && custo < 0.1) {
        return `${fmtMoney(custo * 1000)}/${escala[u]}`;
    }
    return `${fmtMoney(custo)}/${u || 'un'}`;
};

/** Formata quantidade conforme unidade:
 *  kg, g, l, ml → 3 casas
 *  un, cx, pct, fardo, porção → sem decimais desnecessários (max 2)
 */
export const fmtQty = (v: number | null | undefined, unit: string | null | undefined): string => {
    if (v == null || Number.isNaN(v)) v = 0;
    const u = (unit ?? '').toLowerCase();
    if (['kg', 'g', 'l', 'ml'].includes(u)) {
        return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
    return Number.isInteger(v)
        ? v.toLocaleString('pt-BR')
        : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
