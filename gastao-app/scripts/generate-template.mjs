// Gera public/Gastao_Planilha_Mae.xlsx com dropdowns + fórmulas.
//
// Rodado por npm run build:template (pre-build). Arquivo fica em public/
// e o Vite serve estático — o botão "Baixar template" no app apenas abre
// /Gastao_Planilha_Mae.xlsx.
//
// Usamos exceljs (não xlsx) porque o SheetJS CE não escreve data validations.

import ExcelJS from 'exceljs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'Gastao_Planilha_Mae.xlsx');

const MAX_ROWS = 500; // linhas com validação/fórmula aplicadas em cada aba de dados

const LEIAME = [
    'GASTÃO — PLANILHA-MÃE DE IMPORTAÇÃO',
    '',
    'Esta planilha cobre o modelo completo de fichas técnicas: Insumos → Preparos → Fichas.',
    'Funciona para qualquer segmento (hamburgueria, italiano, japonês, eventos, fine dining).',
    '',
    '═══ ORDEM DE PREENCHIMENTO ═══',
    '1) _Categorias — liste TODAS as categorias que vai usar (insumo, preparo, ficha)',
    '2) Insumos — ingredientes crus (inclui embalagens)',
    '3) Preparos — mini-receitas / bases (molhos, massas, fundos, etc)',
    '4) Fichas — produtos vendidos ao cliente',
    '5) Composicao_Preparos — o que vai dentro de cada preparo',
    '6) Composicao_Fichas — o que vai dentro de cada ficha',
    '',
    '═══ DROPDOWNS E FÓRMULAS (NOVO) ═══',
    '• Categoria (Insumos/Preparos/Fichas): dropdown puxa de _Categorias.',
    '  Se sua categoria não aparecer no dropdown, cadastre primeiro em _Categorias.',
    '• Nas abas de Composição:',
    '    - Coluna "Preparo"/"Ficha": dropdown puxa da aba Preparos/Fichas.',
    '    - Coluna "Item":',
    '         · Composicao_Preparos: insumos + preparos.',
    '         · Composicao_Fichas: insumos + preparos + FICHAS (combos).',
    '    - Coluna "Componente": PREENCHIDA AUTOMÁTICAMENTE a partir do Item.',
    '      (Insumos → "insumo"; Preparos → "preparo"; Fichas → "ficha")',
    '    - Coluna "Unidade": PREENCHIDA AUTOMÁTICAMENTE a partir do Item.',
    '      (usa a unidade do insumo, do rendimento do preparo, ou de venda da ficha)',
    '  Ou seja: escolhe Preparo/Ficha + Item + Quantidade — o resto vem sozinho.',
    '• Se um nome existir em mais de uma aba, prevalece insumo > preparo > ficha.',
    '  Evite repetir nomes entre as abas.',
    '',
    '═══ COMBOS (FICHA DENTRO DE FICHA) ═══',
    'Combos como "Combão" (lanche + porção + refri) podem reusar fichas existentes.',
    'Em Composicao_Fichas, escolha o Item entre as fichas já cadastradas — o Componente',
    'fica "ficha" automaticamente. O custo do combo soma o custo de cada ficha + extras.',
    'Não crie ciclo: se Combo A usa Ficha B, B não pode usar A.',
    '',
    '═══ REGRAS ESSENCIAIS ═══',
    '• Nome é a chave — não renomeie depois de importar',
    '• Categoria precisa estar cadastrada em _Categorias com o tipo correto',
    '• Preparos podem usar outros preparos sem limite de profundidade',
    '  Ex: Molho Rosé usa Ragu (que usa Molho de Tomate Base) + Molho Branco',
    '• NÃO crie ciclo: se A usa B, B não pode usar A',
    '',
    '═══ VALORES ACEITOS ═══',
    '• Unidade: kg, g, l, ml, un, porção',
    '• Tipo (Insumos): insumo_base, insumo_direto, embalagem',
    '    insumo_base   → usado em Preparos (ex: carne moída, farinha)',
    '    insumo_direto → vai direto em Fichas (ex: pão, bebida engarrafada)',
    '    embalagem     → caixas, sacolas, descartáveis',
    '• Componente (Composicao_Preparos): insumo | preparo',
    '• Componente (Composicao_Fichas): insumo | preparo | ficha',
    '• Aproveitamento: 1 a 100 (% aproveitado; abacaxi descascado ≈ 53)',
    '• Números: aceita formato BR (1.234,56) e EN (1234.56)',
    '',
    '═══ EXEMPLO CLÁSSICO: MOLHO ROSÉ (3 NÍVEIS) ═══',
    'Preparos:  Molho de Tomate Base, Molho Branco, Ragu, Molho Rosé',
    'Ragu usa: Molho de Tomate Base (preparo) + carne (insumo) + mirepoix (insumos)',
    'Molho Rosé usa: Ragu (preparo) + Molho Branco (preparo)',
    'Filé ao Molho Rosé (ficha) usa: Molho Rosé (preparo) + filé (insumo)',
    '→ o importador calcula tudo na ordem certa automaticamente',
];

const EX_CATEGORIAS = [
    ['insumo', 'Hortifruti', 'Frutas, legumes e verduras'],
    ['insumo', 'Carnes', 'Bovinos, suínos, aves, peixes'],
    ['insumo', 'Laticínios', 'Queijos, leite, manteiga, creme'],
    ['insumo', 'Mercearia', 'Secos em geral, farinhas, ovos'],
    ['insumo', 'Enlatados', 'Tomate pelado, atum, milho, etc'],
    ['insumo', 'Panificação', 'Pães, massas prontas'],
    ['insumo', 'Bebidas', 'Refrigerantes, sucos, cervejas'],
    ['insumo', 'Descartáveis', 'Embalagens, guardanapos, talheres'],
    ['preparo', 'Molhos Base', 'Bases reutilizáveis: tomate, béchamel, fundo'],
    ['preparo', 'Molhos Finalizadores', 'Compostos derivados das bases'],
    ['preparo', 'Massas', 'Massas frescas e recheios'],
    ['preparo', 'Bases Sushi', 'Arroz shari, tempero, gengibre'],
    ['ficha', 'Lanches', 'Sanduíches / hambúrgueres'],
    ['ficha', 'Pizza', 'Pizzas individuais e família'],
    ['ficha', 'Massas', 'Pratos de massa'],
    ['ficha', 'Sushi', 'Peças, combinados, hot rolls'],
    ['ficha', 'Sobremesa', 'Doces e sobremesas da casa'],
];

const EX_INSUMOS = [
    ['Carne Moída 80/20', 'Carnes', 'insumo_base', 'kg', 38.00, 95, 'Perda mínima de gordura'],
    ['Tomate Pelado Lata', 'Enlatados', 'insumo_base', 'kg', 8.00, 100, 'Lata de 2,5kg'],
    ['Cebola', 'Hortifruti', 'insumo_base', 'kg', 4.00, 85, 'Descasca perde 15%'],
    ['Alho', 'Hortifruti', 'insumo_base', 'kg', 35.00, 80, ''],
    ['Azeite Extra Virgem', 'Mercearia', 'insumo_base', 'l', 40.00, 100, ''],
    ['Queijo Muçarela', 'Laticínios', 'insumo_base', 'kg', 45.00, 100, ''],
    ['Queijo Parmesão', 'Laticínios', 'insumo_direto', 'kg', 120.00, 100, 'Ralado na hora direto na ficha'],
    ['Farinha Tipo 00', 'Mercearia', 'insumo_base', 'kg', 8.00, 100, 'Massas italianas'],
    ['Ovo', 'Mercearia', 'insumo_base', 'un', 0.80, 100, ''],
    ['Manteiga sem sal', 'Laticínios', 'insumo_base', 'kg', 55.00, 100, ''],
    ['Leite Integral', 'Laticínios', 'insumo_base', 'l', 6.50, 100, ''],
    ['Pão de Hambúrguer', 'Panificação', 'insumo_direto', 'un', 1.80, 100, ''],
    ['Arroz para Sushi', 'Mercearia', 'insumo_base', 'kg', 18.00, 100, ''],
    ['Salmão Fresco', 'Carnes', 'insumo_base', 'kg', 95.00, 60, 'Rendimento limpo ~60%'],
    ['Folha de Nori', 'Mercearia', 'insumo_direto', 'un', 1.20, 100, ''],
    ['Chocolate 70%', 'Mercearia', 'insumo_base', 'kg', 65.00, 100, ''],
    ['Caixa Delivery', 'Descartáveis', 'embalagem', 'un', 0.85, 100, ''],
    ['Coca-Cola Lata 350ml', 'Bebidas', 'insumo_direto', 'un', 2.80, 100, ''],
];

const EX_PREPAROS = [
    ['Molho de Tomate Base', 'Molhos Base', 2, 'kg', 'Base para ragu, pizza, arrabiata'],
    ['Molho Branco (Béchamel)', 'Molhos Base', 1, 'kg', 'Manteiga + farinha + leite'],
    ['Ragu', 'Molhos Finalizadores', 3, 'kg', 'Usa Molho de Tomate Base'],
    ['Molho Rosé', 'Molhos Finalizadores', 1, 'kg', 'Ragu + Molho Branco, 60/40'],
    ['Massa de Lasanha', 'Massas', 1, 'kg', 'Massa fresca ao ovo'],
    ['Arroz Shari', 'Bases Sushi', 5, 'kg', 'Arroz temperado pronto para sushi'],
    ['Smash 80g', 'Molhos Base', 10, 'un', 'Bolinho 80g prensado'],
];

const EX_FICHAS = [
    ['X-Burger Duplo', 'Lanches', 32.00, 'un', ''],
    ['Lasanha à Bolonhesa', 'Massas', 68.00, 'un', 'Porção 350g'],
    ['Pizza Margherita', 'Pizza', 54.00, 'un', 'Brotinho'],
    ['Filé ao Molho Rosé', 'Massas', 89.00, 'un', ''],
    ['Hot Roll Salmão', 'Sushi', 38.00, 'un', '8 peças'],
    ['Brigadeiro da Casa', 'Sobremesa', 12.00, 'un', ''],
    ['Combo X-Burger', 'Lanches', 38.00, 'un', 'X-Burger Duplo + Coca'],
];

const EX_COMP_PREP = [
    ['Molho de Tomate Base', 'insumo', 'Tomate Pelado Lata', 2, 'kg'],
    ['Molho de Tomate Base', 'insumo', 'Cebola', 0.3, 'kg'],
    ['Molho de Tomate Base', 'insumo', 'Alho', 0.05, 'kg'],
    ['Molho de Tomate Base', 'insumo', 'Azeite Extra Virgem', 0.1, 'l'],
    ['Molho Branco (Béchamel)', 'insumo', 'Manteiga sem sal', 0.08, 'kg'],
    ['Molho Branco (Béchamel)', 'insumo', 'Farinha Tipo 00', 0.08, 'kg'],
    ['Molho Branco (Béchamel)', 'insumo', 'Leite Integral', 1, 'l'],
    ['Massa de Lasanha', 'insumo', 'Farinha Tipo 00', 0.7, 'kg'],
    ['Massa de Lasanha', 'insumo', 'Ovo', 7, 'un'],
    ['Ragu', 'preparo', 'Molho de Tomate Base', 1.5, ''],
    ['Ragu', 'insumo', 'Carne Moída 80/20', 1, 'kg'],
    ['Ragu', 'insumo', 'Cebola', 0.2, 'kg'],
    ['Molho Rosé', 'preparo', 'Ragu', 0.6, ''],
    ['Molho Rosé', 'preparo', 'Molho Branco (Béchamel)', 0.4, ''],
    ['Arroz Shari', 'insumo', 'Arroz para Sushi', 5, 'kg'],
    ['Smash 80g', 'insumo', 'Carne Moída 80/20', 0.8, 'kg'],
];

const EX_COMP_FICHA = [
    ['X-Burger Duplo', 'preparo', 'Smash 80g', 2, ''],
    ['X-Burger Duplo', 'insumo', 'Pão de Hambúrguer', 1, 'un'],
    ['X-Burger Duplo', 'insumo', 'Queijo Muçarela', 0.05, 'kg'],
    ['X-Burger Duplo', 'insumo', 'Caixa Delivery', 1, 'un'],
    ['Lasanha à Bolonhesa', 'preparo', 'Ragu', 0.4, ''],
    ['Lasanha à Bolonhesa', 'preparo', 'Massa de Lasanha', 0.2, ''],
    ['Lasanha à Bolonhesa', 'insumo', 'Queijo Muçarela', 0.15, 'kg'],
    ['Lasanha à Bolonhesa', 'insumo', 'Queijo Parmesão', 0.03, 'kg'],
    ['Filé ao Molho Rosé', 'preparo', 'Molho Rosé', 0.15, ''],
    ['Hot Roll Salmão', 'preparo', 'Arroz Shari', 0.18, ''],
    ['Hot Roll Salmão', 'insumo', 'Salmão Fresco', 0.08, 'kg'],
    ['Hot Roll Salmão', 'insumo', 'Folha de Nori', 1, 'un'],
    ['Brigadeiro da Casa', 'insumo', 'Chocolate 70%', 0.04, 'kg'],
    // Exemplo de combo: ficha-em-ficha
    ['Combo X-Burger', 'ficha', 'X-Burger Duplo', 1, 'un'],
    ['Combo X-Burger', 'insumo', 'Coca-Cola Lata 350ml', 1, 'un'],
];

// ────────────────────────────────────────────────────────────────

const wb = new ExcelJS.Workbook();
wb.creator = 'Gastão';
wb.created = new Date();
// Força Excel/LibreOffice a recalcular TODAS as fórmulas ao abrir o arquivo.
// Sem isso, as fórmulas de Componente/Unidade só populam depois de uma edição manual.
wb.calcProperties.fullCalcOnLoad = true;

// Lookup maps pra pre-computar resultados das fórmulas (cache) nos exemplos —
// assim o Excel mostra os valores imediatamente mesmo se o recálculo não rodar.
const insumoUnitByName = new Map(EX_INSUMOS.map(i => [i[0], i[3]]));
const preparoUnitByName = new Map(EX_PREPAROS.map(p => [p[0], p[3]]));
const fichaUnitByName = new Map(EX_FICHAS.map(f => [f[0], f[3]]));
// Composicao_Preparos: aceita só insumo|preparo
const componenteFor = (item) => {
    if (insumoUnitByName.has(item)) return 'insumo';
    if (preparoUnitByName.has(item)) return 'preparo';
    return '';
};
const unidadeFor = (item) =>
    insumoUnitByName.get(item) ?? preparoUnitByName.get(item) ?? '';
// Composicao_Fichas: aceita os 3 (combos)
const componenteForFicha = (item) => {
    if (insumoUnitByName.has(item)) return 'insumo';
    if (preparoUnitByName.has(item)) return 'preparo';
    if (fichaUnitByName.has(item)) return 'ficha';
    return '';
};
const unidadeForFicha = (item) =>
    insumoUnitByName.get(item) ?? preparoUnitByName.get(item) ?? fichaUnitByName.get(item) ?? '';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const styleHeader = (ws, cols) => {
    cols.forEach((_, i) => {
        const cell = ws.getRow(1).getCell(i + 1);
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
    });
    ws.getRow(1).height = 22;
};

// ── _Leia-me ──────────────────────────────────────────────────
{
    const ws = wb.addWorksheet('_Leia-me');
    ws.getColumn(1).width = 96;
    LEIAME.forEach((l, i) => {
        const cell = ws.getCell(`A${i + 1}`);
        cell.value = l;
        if (l.startsWith('═══') || l === LEIAME[0]) {
            cell.font = { bold: true, color: { argb: 'FF1F2937' } };
        }
    });
}

// ── _Categorias ───────────────────────────────────────────────
{
    const ws = wb.addWorksheet('_Categorias');
    ws.columns = [
        { header: 'Tipo de Item', key: 'tipo', width: 18 },
        { header: 'Categoria', key: 'categoria', width: 28 },
        { header: 'Descrição', key: 'desc', width: 44 },
    ];
    EX_CATEGORIAS.forEach(r => ws.addRow(r));
    styleHeader(ws, ws.columns);
    // Dropdown de Tipo de Item
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true, showErrorMessage: true,
            errorTitle: 'Tipo inválido',
            error: 'Use: insumo, preparo, ficha',
            formulae: ['"insumo,preparo,ficha"'],
        };
    }
}

// Os named ranges e a aba helper _ref_itens são criados DEPOIS das abas
// Insumos e Preparos, mais abaixo.

// ── Insumos ───────────────────────────────────────────────────
{
    const ws = wb.addWorksheet('Insumos');
    ws.columns = [
        { header: 'Nome', width: 32 },
        { header: 'Categoria', width: 22 },
        { header: 'Tipo', width: 16 },
        { header: 'Unidade', width: 12 },
        { header: 'Preço de Compra', width: 18 },
        { header: 'Aproveitamento (%)', width: 20 },
        { header: 'Observações', width: 34 },
    ];
    EX_INSUMOS.forEach(r => ws.addRow(r));
    styleHeader(ws, ws.columns);
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"insumo_base,insumo_direto,embalagem"'],
        };
        ws.getCell(`D${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"kg,g,l,ml,un,porção"'],
        };
    }
}

// ── Preparos ──────────────────────────────────────────────────
{
    const ws = wb.addWorksheet('Preparos');
    ws.columns = [
        { header: 'Nome', width: 32 },
        { header: 'Categoria', width: 24 },
        { header: 'Rendimento (qtd)', width: 18 },
        { header: 'Rendimento (unidade)', width: 22 },
        { header: 'Observações', width: 42 },
    ];
    EX_PREPAROS.forEach(r => ws.addRow(r));
    styleHeader(ws, ws.columns);
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        ws.getCell(`D${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"kg,g,l,ml,un,porção"'],
        };
    }
}

// ── Fichas ────────────────────────────────────────────────────
{
    const ws = wb.addWorksheet('Fichas');
    ws.columns = [
        { header: 'Nome', width: 32 },
        { header: 'Categoria', width: 22 },
        { header: 'Preço de Venda', width: 18 },
        { header: 'Unidade de Venda', width: 20 },
        { header: 'Observações', width: 34 },
    ];
    EX_FICHAS.forEach(r => ws.addRow(r));
    styleHeader(ws, ws.columns);
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        ws.getCell(`D${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"kg,g,l,ml,un,porção"'],
        };
    }
}

// ── _ref_itens (aba oculta, helper pros dropdowns de Item) ──
// Cobre os 3 catálogos empilhados:
//   linhas 2..MAX_ROWS               → Insumos!A
//   linhas MAX_ROWS+1..2*MAX_ROWS-1  → Preparos!A
//   linhas 2*MAX_ROWS..3*MAX_ROWS-2  → Fichas!A   (usado só por Composicao_Fichas, p/ combos)
{
    const ws = wb.addWorksheet('_ref_itens', { state: 'hidden' });
    ws.columns = [{ header: 'item', width: 32 }];
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).value = { formula: `IFERROR(Insumos!A${r},"")` };
    }
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${MAX_ROWS + r - 1}`).value = { formula: `IFERROR(Preparos!A${r},"")` };
    }
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${2 * MAX_ROWS + r - 2}`).value = { formula: `IFERROR(Fichas!A${r},"")` };
    }
}

// Named ranges pros dropdowns de Item.
// itens_todos    = insumos + preparos        → Composicao_Preparos
// itens_combo    = insumos + preparos + fichas → Composicao_Fichas (combos)
wb.definedNames.add(`_ref_itens!$A$2:$A$${2 * MAX_ROWS - 1}`, 'itens_todos');
wb.definedNames.add(`_ref_itens!$A$2:$A$${3 * MAX_ROWS - 2}`, 'itens_combo');

// Fórmulas — Composicao_Preparos (só insumo|preparo)
const fmComponente = (row) =>
    `IF(C${row}="","",IF(ISNUMBER(MATCH(C${row},Insumos!$A:$A,0)),"insumo",IF(ISNUMBER(MATCH(C${row},Preparos!$A:$A,0)),"preparo","")))`;
const fmUnidade = (row) =>
    `IF(C${row}="","",IFERROR(VLOOKUP(C${row},Insumos!$A:$D,4,FALSE),IFERROR(VLOOKUP(C${row},Preparos!$A:$D,4,FALSE),"")))`;

// Fórmulas — Composicao_Fichas (insumo|preparo|ficha)
const fmComponenteFicha = (row) =>
    `IF(C${row}="","",IF(ISNUMBER(MATCH(C${row},Insumos!$A:$A,0)),"insumo",IF(ISNUMBER(MATCH(C${row},Preparos!$A:$A,0)),"preparo",IF(ISNUMBER(MATCH(C${row},Fichas!$A:$A,0)),"ficha",""))))`;
const fmUnidadeFicha = (row) =>
    `IF(C${row}="","",IFERROR(VLOOKUP(C${row},Insumos!$A:$D,4,FALSE),IFERROR(VLOOKUP(C${row},Preparos!$A:$D,4,FALSE),IFERROR(VLOOKUP(C${row},Fichas!$A:$D,4,FALSE),""))))`;

// Protect options comuns para as duas abas de composição:
// trava B e E (fórmulas); libera A, C, D pro usuário; mantém dropdowns, sort, inserir/deletar linhas.
const COMP_PROTECT_OPTS = {
    selectLockedCells: true,
    selectUnlockedCells: true,
    insertRows: true,
    deleteRows: true,
    insertColumns: false,
    deleteColumns: false,
    sort: true,
    autoFilter: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
};

// ── Composicao_Preparos ───────────────────────────────────────
{
    const ws = wb.addWorksheet('Composicao_Preparos');
    ws.columns = [
        { header: 'Preparo', width: 30 },
        { header: 'Componente (auto)', width: 18 },
        { header: 'Item', width: 32 },
        { header: 'Quantidade', width: 14 },
        { header: 'Unidade (auto)', width: 16 },
    ];
    // Exemplos: só Preparo, Item, Quantidade. Componente e Unidade são fórmulas.
    EX_COMP_PREP.forEach(r => ws.addRow([r[0], null, r[2], r[3], null]));
    styleHeader(ws, ws.columns);
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=Preparos!$A$2:$A$${MAX_ROWS}`],
        };
        // Item: dropdown unificado via named range (insumos + preparos)
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['=itens_todos'],
        };
        // Pre-computa resultado em cache pros exemplos (Excel mostra já na abertura).
        const exIdx = r - 2;
        const exItem = exIdx >= 0 && exIdx < EX_COMP_PREP.length ? EX_COMP_PREP[exIdx][2] : null;
        const cachedB = exItem ? componenteFor(exItem) : '';
        const cachedE = exItem ? unidadeFor(exItem) : '';
        ws.getCell(`B${r}`).value = { formula: fmComponente(r), result: cachedB };
        ws.getCell(`E${r}`).value = { formula: fmUnidade(r), result: cachedE };
        // Trava fórmulas; libera colunas de input.
        ws.getCell(`A${r}`).protection = { locked: false };
        ws.getCell(`C${r}`).protection = { locked: false };
        ws.getCell(`D${r}`).protection = { locked: false };
        ws.getCell(`B${r}`).protection = { locked: true };
        ws.getCell(`E${r}`).protection = { locked: true };
    }
    await ws.protect('', COMP_PROTECT_OPTS);
}

// ── Composicao_Fichas ─────────────────────────────────────────
// Aceita Item entre insumos + preparos + fichas (combos).
{
    const ws = wb.addWorksheet('Composicao_Fichas');
    ws.columns = [
        { header: 'Ficha', width: 30 },
        { header: 'Componente (auto)', width: 18 },
        { header: 'Item', width: 32 },
        { header: 'Quantidade', width: 14 },
        { header: 'Unidade (auto)', width: 16 },
    ];
    EX_COMP_FICHA.forEach(r => ws.addRow([r[0], null, r[2], r[3], null]));
    styleHeader(ws, ws.columns);
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=Fichas!$A$2:$A$${MAX_ROWS}`],
        };
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['=itens_combo'],
        };
        const exIdx = r - 2;
        const exItem = exIdx >= 0 && exIdx < EX_COMP_FICHA.length ? EX_COMP_FICHA[exIdx][2] : null;
        const cachedB = exItem ? componenteForFicha(exItem) : '';
        const cachedE = exItem ? unidadeForFicha(exItem) : '';
        ws.getCell(`B${r}`).value = { formula: fmComponenteFicha(r), result: cachedB };
        ws.getCell(`E${r}`).value = { formula: fmUnidadeFicha(r), result: cachedE };
        ws.getCell(`A${r}`).protection = { locked: false };
        ws.getCell(`C${r}`).protection = { locked: false };
        ws.getCell(`D${r}`).protection = { locked: false };
        ws.getCell(`B${r}`).protection = { locked: true };
        ws.getCell(`E${r}`).protection = { locked: true };
    }
    await ws.protect('', COMP_PROTECT_OPTS);
}

await wb.xlsx.writeFile(OUT);
console.log('OK →', OUT);
