import * as XLSX from 'xlsx';

/**
 * Gastão - Template de Importação Padrão
 * 
 * Estrutura das abas e colunas esperadas pelo sistema.
 * Só altere os DADOS, nunca renomeie as colunas ou abas.
 */
export const TEMPLATE_STRUCTURE = {
    Insumos: {
        table: 'ingredients' as const,
        typeValue: 'insumo',
        columns: ['Nome', 'Unidade', 'Custo Unitário'],
        example: [['Farinha de Trigo', 'kg', 3.50], ['Sal Refinado', 'kg', 1.20]],
    },
    Preparos: {
        table: 'ingredients' as const,
        typeValue: 'preparo',
        columns: ['Nome', 'Unidade'],
        example: [['Molho da Casa', 'l'], ['Maionese Temperada', 'kg']],
    },
    Bebidas: {
        table: 'ingredients' as const,
        typeValue: 'bebida',
        columns: ['Nome', 'Unidade', 'Preço de Compra', 'Preço de Venda'],
        example: [['Coca-Cola Lata', 'un', 2.50, 7.00], ['Suco de Laranja 500ml', 'un', 3.00, 9.00]],
    },
    Lanches: {
        table: 'recipes' as const,
        typeValue: 'lanche',
        columns: ['Nome', 'Preço de Venda'],
        example: [['X-Burguer Clássico', 28.90], ['X-Bacon Duplo', 35.90]],
    },
    Porções: {
        table: 'recipes' as const,
        typeValue: 'porcao',
        columns: ['Nome', 'Preço de Venda'],
        example: [['Batata Frita P', 14.90], ['Onion Rings', 19.90]],
    },
    Sobremesas: {
        table: 'recipes' as const,
        typeValue: 'sobremesa',
        columns: ['Nome', 'Preço de Venda'],
        example: [['Brownie com Sorvete', 18.90], ['Milkshake Chocolate', 22.90]],
    },
    Combos: {
        table: 'recipes' as const,
        typeValue: 'combo',
        columns: ['Nome', 'Preço de Venda'],
        example: [['Combo Clássico (X-Burguer + Batata + Bebida)', 45.90]],
    },
} as const;

export type SheetName = keyof typeof TEMPLATE_STRUCTURE;

/** Generates and triggers download of the blank Gastão template */
export const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    for (const [sheetName, config] of Object.entries(TEMPLATE_STRUCTURE)) {
        const data = [config.columns, ...config.example];
        const ws = XLSX.utils.aoa_to_sheet(data as unknown as any[][]);

        // Style header row width
        ws['!cols'] = config.columns.map(() => ({ wch: 28 }));

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    XLSX.writeFile(wb, 'Gastao_Template_Importacao.xlsx');
};

/** Parses a workbook using the strict Gastão template structure */
export const parseGastaoTemplate = (
    workbook: XLSX.WorkBook
): { sheet: SheetName; rows: Record<string, any>[] }[] => {
    const results: { sheet: SheetName; rows: Record<string, any>[] }[] = [];

    for (const sheetName of Object.keys(TEMPLATE_STRUCTURE) as SheetName[]) {
        if (!workbook.SheetNames.includes(sheetName)) continue;

        const config = TEMPLATE_STRUCTURE[sheetName];
        const ws = workbook.Sheets[sheetName];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        // First row must be the header
        const header: string[] = aoa[0]?.map((h: any) => String(h ?? '').trim()) ?? [];

        const rows: Record<string, any>[] = [];
        for (let i = 1; i < aoa.length; i++) {
            const row = aoa[i];
            if (!row || !row[0]) continue;
            const entry: Record<string, any> = {};
            config.columns.forEach((col, idx) => {
                entry[col] = row[idx] ?? null;
            });
            if (!entry['Nome'] || String(entry['Nome']).trim() === '') continue;
            rows.push(entry);
        }

        if (rows.length > 0) {
            results.push({ sheet: sheetName, rows });
        }
    }

    return results;
};
