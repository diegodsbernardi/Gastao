// Gera public/Gastao_Planilha_Mae_v3.xlsx — versão chef-friendly.
//
// MUDANÇAS DA V3 (relativo à v2):
//   1. Unidades padronizadas: massa → g, volume → ml, contagem → un.
//      Chef NUNCA pensa em preço/g — pensa em "embalagem" (1 kg, 750 ml).
//      Sistema converte automaticamente.
//   2. Aproveitamento UM campo só, com tabela de referência no _Leia-me.
//   3. Custo + CMV em tempo real via fórmula (chef vê o R$ subindo).
//   4. Aba Ver_Ficha — visualização bonita de ficha-por-ficha.
//   5. Aba _Validação — lista de erros pro chef arrumar antes de mandar.
//   6. Cores: amarelo = chef preenche, verde = sistema calcula, cinza = opcional.
//
// Rodar: node scripts/generate-template-v3.mjs
//        ou: npm run build:template-v3

import ExcelJS from 'exceljs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'Gastao_Planilha_Mae_v3.xlsx');

const MAX_ROWS = 500;

// ════════════════════════════════════════════════════════════════
// CORES (cell fills)
// ════════════════════════════════════════════════════════════════
const COR = {
    headerBg:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }, // cinza escuro
    headerFont: { bold: true, color: { argb: 'FFFFFFFF' } },
    input:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }, // amarelo claro — chef preenche
    auto:       { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }, // verde claro — fórmula
    opcional:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }, // cinza claro — opcional
    secao:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }, // azul claro — separador
    aviso:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }, // vermelho claro — erro
};

const BORDA_FINA = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const BORDA_CELULA = { top: BORDA_FINA, left: BORDA_FINA, bottom: BORDA_FINA, right: BORDA_FINA };

// ════════════════════════════════════════════════════════════════
// _LEIA-ME — instruções pro chef
// ════════════════════════════════════════════════════════════════
const LEIAME = [
    { tipo: 'titulo', texto: 'GASTÃO — PLANILHA-MÃE v3 — Ficha Técnica Padronizada' },
    { tipo: 'vazio' },
    { tipo: 'p', texto: 'Esta planilha foi feita pra você cadastrar seus insumos, preparos e fichas técnicas de um jeito padronizado, sem chance de dar errado no sistema.' },
    { tipo: 'p', texto: 'Funciona pra qualquer restaurante: hamburgueria, italiano, sushi, fine dining, eventos.' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '🎨 CORES — O QUE CADA UMA SIGNIFICA' },
    { tipo: 'p', texto: '🟡 AMARELO — você preenche aqui.' },
    { tipo: 'p', texto: '🟢 VERDE — o sistema calcula. Não mexa.' },
    { tipo: 'p', texto: '⚪ CINZA — opcional. Preenche se quiser.' },
    { tipo: 'p', texto: '🔴 VERMELHO — tem erro. Confira a aba _Validação.' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '📋 ORDEM DE PREENCHIMENTO' },
    { tipo: 'p', texto: '1️⃣  _Categorias — quais categorias você usa (Hortifruti, Carnes, Bebidas...)' },
    { tipo: 'p', texto: '2️⃣  Insumos — tudo que você compra (matéria-prima, item pronto, embalagem)' },
    { tipo: 'p', texto: '3️⃣  Preparos — mini-receitas que você faz na cozinha (molhos, bases, etc)' },
    { tipo: 'p', texto: '4️⃣  Fichas — pratos vendidos no cardápio' },
    { tipo: 'p', texto: '5️⃣  Composição_Preparos — o que vai dentro de cada preparo' },
    { tipo: 'p', texto: '6️⃣  Composição_Fichas — o que vai dentro de cada ficha' },
    { tipo: 'p', texto: '7️⃣  Ver_Ficha — escolha uma ficha pra ver tudo bonitinho' },
    { tipo: 'p', texto: '8️⃣  _Validação — confira se tem erros antes de enviar' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '⚖️  UNIDADES — REGRA DE OURO' },
    { tipo: 'p', texto: 'Peso/massa: sempre em GRAMAS (g)' },
    { tipo: 'p', texto: 'Volume: sempre em MILILITROS (ml)' },
    { tipo: 'p', texto: 'Contagem (unidades de produto): UN' },
    { tipo: 'vazio' },
    { tipo: 'p', texto: 'COMO PENSAR NO PREÇO:' },
    { tipo: 'p', texto: 'Você não precisa calcular preço/grama na mão. Cadastre como você COMPRA:' },
    { tipo: 'p', texto: '  • Bacon — embalagem 1 kg por R$ 43 → "Embalagem qtd: 1000, unidade: g, Preço: 43"' },
    { tipo: 'p', texto: '  • Azeite — garrafa 750 ml por R$ 30 → "Embalagem qtd: 750, unidade: ml, Preço: 30"' },
    { tipo: 'p', texto: '  • Pão — comprado por unidade R$ 1,80 → "Embalagem qtd: 1, unidade: un, Preço: 1,80"' },
    { tipo: 'p', texto: 'O sistema calcula o preço por grama / ml / unidade automaticamente.' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '📊 APROVEITAMENTO — TABELA DE REFERÊNCIA' },
    { tipo: 'p', texto: 'Aproveitamento = quanto sobra do peso/volume original depois de limpar, drenar e cozinhar.' },
    { tipo: 'p', texto: 'Se você compra 1 kg de bacon cru e depois de frito sobra 300 g, o aproveitamento é 30%.' },
    { tipo: 'p', texto: 'Se você compra lata de tomate 800 g e drenado sobra 480 g, o aproveitamento é 60%.' },
    { tipo: 'p', texto: 'Use a tabela abaixo como referência. Se não sabe, deixa 100%.' },
    { tipo: 'vazio' },
    { tipo: 'tabela', dados: [
        ['INGREDIENTE', 'APROVEITAMENTO TÍPICO'],
        ['Bacon cru → frito', '30%'],
        ['Camarão com casca → limpo', '60%'],
        ['Carne crua → assada/grelhada', '65-75%'],
        ['Cebola → descascada', '90%'],
        ['Tomate fresco → sem casca/semente', '80%'],
        ['Tomate pelado em lata (peso drenado)', '60%'],
        ['Filé peixe inteiro → limpo sem espinha', '50-60%'],
        ['Salmão fresco → limpo', '60%'],
        ['Abacaxi → descascado', '53%'],
        ['Manga → descascada/sem caroço', '65%'],
        ['Item pronto sem perda (ovo, refri, lata)', '100%'],
        ['Embalagem (caixa, sacola)', '100%'],
    ]},
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '🍳 INSUMO vs PREPARO vs FICHA' },
    { tipo: 'p', texto: 'INSUMO — algo que você COMPRA (matéria-prima ou produto pronto)' },
    { tipo: 'p', texto: '  Ex: tomate pelado em lata, queijo muçarela, pão de hambúrguer, refrigerante' },
    { tipo: 'p', texto: 'PREPARO — algo que você FAZ na cozinha, usando insumos (e/ou outros preparos)' },
    { tipo: 'p', texto: '  Ex: molho de tomate base, ragu, massa de lasanha, mix de queijos, hambúrguer moldado' },
    { tipo: 'p', texto: '  Preparos podem usar OUTROS preparos sem limite. Ex: Molho Rosé usa Ragu (que usa Molho Base).' },
    { tipo: 'p', texto: 'FICHA — um PRATO do cardápio que o cliente compra' },
    { tipo: 'p', texto: '  Ex: Lasanha à Bolonhesa, X-Burger, Hot Roll Salmão, Combo Família' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '🔁 PREPAROS DENTRO DE PREPAROS' },
    { tipo: 'p', texto: 'Exemplo: o Aligot (preparo) usa Mix de queijos (outro preparo).' },
    { tipo: 'p', texto: 'O Mix de queijos vai na aba Preparos normalmente. Na composição do Aligot, escolha Mix de queijos como item.' },
    { tipo: 'p', texto: 'O sistema calcula o custo em cascata automaticamente.' },
    { tipo: 'p', texto: 'NÃO CRIE CICLO: se o Aligot usa Mix de queijos, o Mix de queijos NÃO pode usar Aligot.' },
    { tipo: 'vazio' },

    { tipo: 'secao', texto: '⚠️  ANTES DE ENVIAR' },
    { tipo: 'p', texto: 'Vá na aba _Validação. Se aparecer 🔴 (linha vermelha), corrija ANTES de mandar.' },
    { tipo: 'p', texto: '🟡 Avisos podem ser ignorados, mas é bom revisar.' },
    { tipo: 'p', texto: 'Vá na aba Ver_Ficha pra conferir cada prato bonito e visualmente.' },
    { tipo: 'vazio' },

    { tipo: 'p', texto: 'Dúvidas? Fale com seu contato Gastão / BPO.' },
];

// ════════════════════════════════════════════════════════════════
// CATEGORIAS exemplo
// ════════════════════════════════════════════════════════════════
const EX_CATEGORIAS = [
    ['insumo', 'Hortifruti', 'Frutas, legumes e verduras'],
    ['insumo', 'Carnes', 'Bovinos, suínos, aves, peixes'],
    ['insumo', 'Laticínios', 'Queijos, leite, manteiga, creme'],
    ['insumo', 'Mercearia', 'Secos em geral, farinhas, açúcar'],
    ['insumo', 'Enlatados', 'Tomate pelado, atum, milho, etc'],
    ['insumo', 'Panificação', 'Pães, massas prontas'],
    ['insumo', 'Bebidas', 'Refrigerantes, sucos, cervejas, vinhos'],
    ['insumo', 'Descartáveis', 'Embalagens, guardanapos, talheres'],
    ['preparo', 'Molhos & Caldos', 'Bases reutilizáveis'],
    ['preparo', 'Bases', 'Massas, arroz, base de pratos'],
    ['preparo', 'Carnes Pré', 'Carnes pré-preparadas (hambúrguer moldado, etc)'],
    ['preparo', 'Sobremesas', 'Bases doces'],
    ['ficha', 'Entradas', 'Aperitivos / petiscos'],
    ['ficha', 'Pratos Principais', 'Pratos quentes'],
    ['ficha', 'Sobremesas', 'Doces e sobremesas'],
    ['ficha', 'Bebidas', 'Drinks, sucos, refrigerantes'],
    ['ficha', 'Combos', 'Combos / promoções'],
];

// ════════════════════════════════════════════════════════════════
// INSUMOS exemplo
// formato: [nome, categoria, tipo, embalagem_qtd, embalagem_un, preco_emb, aproveit, densidade, obs]
// ════════════════════════════════════════════════════════════════
const EX_INSUMOS = [
    ['Carne Moída 80/20',      'Carnes',       'insumo_base',   1000,  'g',  38.00, 95,  null, 'Perda mínima de gordura'],
    ['Tomate Pelado em Lata',  'Enlatados',    'insumo_base',   800,   'g',  14.80, 60,  null, 'Lata 800g, peso drenado 60%'],
    ['Cebola',                 'Hortifruti',   'insumo_base',   1000,  'g',  4.00,  90,  null, 'Perde 10% ao descascar'],
    ['Alho',                   'Hortifruti',   'insumo_base',   1000,  'g',  35.00, 80,  null, ''],
    ['Azeite Extra Virgem',    'Mercearia',    'insumo_base',   750,   'ml', 30.00, 100, 0.92, 'Garrafa 750ml'],
    ['Queijo Muçarela',        'Laticínios',   'insumo_base',   1000,  'g',  45.00, 100, null, ''],
    ['Queijo Parmesão',        'Laticínios',   'insumo_direto', 1000,  'g',  120.00,100, null, 'Ralado na hora direto na ficha'],
    ['Farinha Tipo 00',        'Mercearia',    'insumo_base',   1000,  'g',  8.00,  100, null, 'Massas italianas'],
    ['Ovo',                    'Mercearia',    'insumo_base',   1,     'un', 0.80,  100, null, '~50g por unidade'],
    ['Manteiga sem sal',       'Laticínios',   'insumo_base',   200,   'g',  11.00, 100, null, 'Tablete 200g'],
    ['Leite Integral',         'Laticínios',   'insumo_base',   1000,  'ml', 6.50,  100, 1.03, 'Caixa 1L'],
    ['Pão de Hambúrguer',      'Panificação',  'insumo_direto', 1,     'un', 1.80,  100, null, ''],
    ['Bacon Cru',              'Carnes',       'insumo_base',   1000,  'g',  43.00, 30,  null, 'Frito rende 30%'],
    ['Salmão Fresco',          'Carnes',       'insumo_base',   1000,  'g',  95.00, 60,  null, 'Limpo rende 60%'],
    ['Camarão Cru c/ casca',   'Carnes',       'insumo_base',   1000,  'g',  60.00, 60,  null, 'Limpo rende 60%'],
    ['Coca-Cola Lata 350ml',   'Bebidas',      'insumo_direto', 1,     'un', 2.80,  100, null, ''],
    ['Caixa Delivery',         'Descartáveis', 'embalagem',     1,     'un', 0.85,  100, null, ''],
];

// ════════════════════════════════════════════════════════════════
// PREPAROS exemplo
// formato: [nome, categoria, rendimento_qtd_canonica, rendimento_un, procedimento]
// ════════════════════════════════════════════════════════════════
const EX_PREPAROS = [
    ['Molho de Tomate Base',  'Molhos & Caldos', 2400, 'g',  'Refogar tomate com cebola e alho, cozinhar 40min'],
    ['Ragu',                  'Molhos & Caldos', 3500, 'g',  'Carne moída + Molho de Tomate Base'],
    ['Hambúrguer Moldado 80g','Carnes Pré',      1,    'un', 'Bolinho 80g prensado, 1 unidade'],
    ['Massa de Lasanha',      'Bases',           1000, 'g',  'Massa fresca ao ovo'],
];

// ════════════════════════════════════════════════════════════════
// FICHAS exemplo
// formato: [nome, categoria, preco_venda, observacoes]
// ════════════════════════════════════════════════════════════════
const EX_FICHAS = [
    ['X-Burger Duplo',          'Pratos Principais', 32.00, ''],
    ['Lasanha à Bolonhesa',     'Pratos Principais', 68.00, 'Porção 350g'],
    ['Salmão Grelhado',         'Pratos Principais', 89.00, ''],
];

// ════════════════════════════════════════════════════════════════
// COMPOSIÇÃO DE PREPAROS exemplo
// formato: [preparo, item, quantidade_canonica]
// ════════════════════════════════════════════════════════════════
const EX_COMP_PREP = [
    ['Molho de Tomate Base', 'Tomate Pelado em Lata',   2000],
    ['Molho de Tomate Base', 'Cebola',                  300],
    ['Molho de Tomate Base', 'Alho',                    50],
    ['Molho de Tomate Base', 'Azeite Extra Virgem',     100],
    ['Ragu',                 'Molho de Tomate Base',    1500],
    ['Ragu',                 'Carne Moída 80/20',       1000],
    ['Ragu',                 'Cebola',                  200],
    ['Hambúrguer Moldado 80g', 'Carne Moída 80/20',     80],
    ['Massa de Lasanha',     'Farinha Tipo 00',         700],
    ['Massa de Lasanha',     'Ovo',                     7],
];

// ════════════════════════════════════════════════════════════════
// COMPOSIÇÃO DE FICHAS exemplo
// formato: [ficha, item, quantidade_canonica]
// ════════════════════════════════════════════════════════════════
const EX_COMP_FICHA = [
    ['X-Burger Duplo',      'Hambúrguer Moldado 80g', 2],
    ['X-Burger Duplo',      'Pão de Hambúrguer',      1],
    ['X-Burger Duplo',      'Queijo Muçarela',        50],
    ['X-Burger Duplo',      'Caixa Delivery',         1],
    ['Lasanha à Bolonhesa', 'Ragu',                   400],
    ['Lasanha à Bolonhesa', 'Massa de Lasanha',       200],
    ['Lasanha à Bolonhesa', 'Queijo Muçarela',        150],
    ['Lasanha à Bolonhesa', 'Queijo Parmesão',        30],
    ['Salmão Grelhado',     'Salmão Fresco',          200],
    ['Salmão Grelhado',     'Azeite Extra Virgem',    20],
];

// ════════════════════════════════════════════════════════════════
// WORKBOOK SETUP
// ════════════════════════════════════════════════════════════════
const wb = new ExcelJS.Workbook();
wb.creator = 'Gastão';
wb.created = new Date();
wb.calcProperties.fullCalcOnLoad = true;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
const styleHeader = (ws, n) => {
    for (let i = 1; i <= n; i++) {
        const c = ws.getRow(1).getCell(i);
        c.fill = COR.headerBg;
        c.font = COR.headerFont;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = BORDA_CELULA;
    }
    ws.getRow(1).height = 32;
    ws.views = [{ state: 'frozen', ySplit: 1 }]; // congela primeira linha
};

// Pinta uma coluna inteira (depois do header) com uma cor
const fillCol = (ws, colLetter, fill, fromRow = 2, toRow = MAX_ROWS) => {
    for (let r = fromRow; r <= toRow; r++) {
        ws.getCell(`${colLetter}${r}`).fill = fill;
        ws.getCell(`${colLetter}${r}`).border = BORDA_CELULA;
    }
};

// ════════════════════════════════════════════════════════════════
// 1. _Leia-me
// ════════════════════════════════════════════════════════════════
{
    const ws = wb.addWorksheet('_Leia-me');
    ws.getColumn(1).width = 8;
    ws.getColumn(2).width = 64;
    ws.getColumn(3).width = 24;

    let r = 1;
    for (const linha of LEIAME) {
        if (linha.tipo === 'titulo') {
            ws.mergeCells(`B${r}:C${r}`);
            const c = ws.getCell(`B${r}`);
            c.value = linha.texto;
            c.font = { bold: true, size: 18, color: { argb: 'FF1F2937' } };
            ws.getRow(r).height = 30;
        } else if (linha.tipo === 'secao') {
            ws.mergeCells(`B${r}:C${r}`);
            const c = ws.getCell(`B${r}`);
            c.value = linha.texto;
            c.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
            c.fill = COR.secao;
            ws.getRow(r).height = 22;
        } else if (linha.tipo === 'p') {
            ws.mergeCells(`B${r}:C${r}`);
            const c = ws.getCell(`B${r}`);
            c.value = linha.texto;
            c.alignment = { wrapText: true, vertical: 'middle' };
            c.font = { size: 11 };
        } else if (linha.tipo === 'tabela') {
            for (const row of linha.dados) {
                ws.getCell(`B${r}`).value = row[0];
                ws.getCell(`C${r}`).value = row[1];
                if (row === linha.dados[0]) {
                    ws.getCell(`B${r}`).font = { bold: true };
                    ws.getCell(`C${r}`).font = { bold: true };
                    ws.getCell(`B${r}`).fill = COR.secao;
                    ws.getCell(`C${r}`).fill = COR.secao;
                } else {
                    ws.getCell(`B${r}`).fill = COR.opcional;
                    ws.getCell(`C${r}`).fill = COR.opcional;
                }
                ws.getCell(`B${r}`).border = BORDA_CELULA;
                ws.getCell(`C${r}`).border = BORDA_CELULA;
                r++;
            }
            r--;
        }
        r++;
    }
}

// ════════════════════════════════════════════════════════════════
// 2. _Categorias
// ════════════════════════════════════════════════════════════════
{
    const ws = wb.addWorksheet('_Categorias');
    ws.columns = [
        { header: 'Tipo de Item', key: 'tipo', width: 18 },
        { header: 'Categoria',    key: 'cat',  width: 28 },
        { header: 'Descrição',    key: 'desc', width: 50 },
    ];
    EX_CATEGORIAS.forEach(r => ws.addRow(r));
    styleHeader(ws, 3);

    // Validação na coluna A: tipo
    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true, showErrorMessage: true,
            errorTitle: 'Tipo inválido',
            error: 'Use: insumo, preparo ou ficha',
            formulae: ['"insumo,preparo,ficha"'],
        };
    }
    fillCol(ws, 'A', COR.input);
    fillCol(ws, 'B', COR.input);
    fillCol(ws, 'C', COR.opcional);
}

// ════════════════════════════════════════════════════════════════
// 3. Insumos — schema NOVO com Embalagem + Densidade
// ════════════════════════════════════════════════════════════════
// Colunas (A-K):
//   A: Nome*
//   B: Categoria* (dropdown _Categorias)
//   C: Tipo* (insumo_base | insumo_direto | embalagem)
//   D: Embalagem - Quantidade* (números, ex: 1000)
//   E: Embalagem - Unidade* (dropdown: kg, g, l, ml, un)
//   F: Preço da Embalagem (R$)*
//   G: Aproveitamento (%)*
//   H: Densidade (g/ml) — opcional
//   I: Unidade Canônica (auto) — g/ml/un
//   J: Custo / Unidade Canônica (auto) — R$ por g/ml/un
//   K: Observações
{
    const ws = wb.addWorksheet('Insumos');
    ws.columns = [
        { header: 'Nome',                    width: 32 },
        { header: 'Categoria',               width: 22 },
        { header: 'Tipo',                    width: 16 },
        { header: 'Embalagem (qtd)',         width: 16 },
        { header: 'Embalagem (unidade)',     width: 16 },
        { header: 'Preço Embalagem (R$)',    width: 18 },
        { header: 'Aproveitamento (%)',      width: 18 },
        { header: 'Densidade (g/ml)',        width: 14 },
        { header: 'Unidade Canônica (auto)', width: 18 },
        { header: 'Custo / un (auto)',       width: 16 },
        { header: 'Observações',             width: 30 },
    ];

    // Preenche exemplos
    EX_INSUMOS.forEach(r => ws.addRow([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], null, null, r[8]]));
    styleHeader(ws, 11);

    // Linhas com fórmulas + validações + cores
    for (let r = 2; r <= MAX_ROWS; r++) {
        // Categoria dropdown
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        // Tipo dropdown
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"insumo_base,insumo_direto,embalagem"'],
        };
        // Embalagem unidade dropdown (chef pensa em kg/L)
        ws.getCell(`E${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"kg,g,l,ml,un"'],
        };

        // Coluna I: Unidade Canônica (auto)
        //   kg/g → g | l/ml → ml | un → un
        const fmUndCanon = `IF(E${r}="","",IF(OR(E${r}="kg",E${r}="g"),"g",IF(OR(E${r}="l",E${r}="ml"),"ml",IF(E${r}="un","un",""))))`;
        ws.getCell(`I${r}`).value = { formula: fmUndCanon };

        // Coluna J: Custo / Unidade Canônica
        //   Se kg ou l → divide por (qtd × 1000)
        //   Senão → divide por qtd
        const fmCusto = `IFERROR(F${r}/IF(OR(E${r}="kg",E${r}="l"),D${r}*1000,D${r}),"")`;
        ws.getCell(`J${r}`).value = { formula: fmCusto };
        ws.getCell(`J${r}`).numFmt = 'R$ #,##0.0000';

        // Pre-computa cache pros exemplos
        const exIdx = r - 2;
        if (exIdx >= 0 && exIdx < EX_INSUMOS.length) {
            const ex = EX_INSUMOS[exIdx];
            // ex: [nome, cat, tipo, qtd, und, preco, aprov, dens, obs]
            const embUnd = ex[4];
            const undCanon = (embUnd === 'kg' || embUnd === 'g') ? 'g'
                : (embUnd === 'l' || embUnd === 'ml') ? 'ml'
                : (embUnd === 'un') ? 'un' : '';
            const factor = (embUnd === 'kg' || embUnd === 'l') ? ex[3] * 1000 : ex[3];
            const custoUn = factor > 0 ? ex[5] / factor : 0;
            ws.getCell(`I${r}`).value = { formula: fmUndCanon, result: undCanon };
            ws.getCell(`J${r}`).value = { formula: fmCusto, result: custoUn };
        }
    }

    // Cores — amarelo nos inputs, verde nos autos, cinza no opcional
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(c => fillCol(ws, c, COR.input));
    fillCol(ws, 'H', COR.opcional);
    fillCol(ws, 'I', COR.auto);
    fillCol(ws, 'J', COR.auto);
    fillCol(ws, 'K', COR.opcional);

    // Conditional formatting: preço 0 ou vazio fica vermelho
    ws.addConditionalFormatting({
        ref: `F2:F${MAX_ROWS}`,
        rules: [{
            type: 'cellIs', operator: 'lessThanOrEqual', formulae: [0], priority: 1,
            style: { fill: COR.aviso },
        }],
    });
}

// ════════════════════════════════════════════════════════════════
// 4. Preparos — com Custo Total e Custo/un calculados
// ════════════════════════════════════════════════════════════════
// Colunas:
//   A: Nome*
//   B: Categoria*
//   C: Rendimento (qtd)*  — número na unidade canônica
//   D: Rendimento (unidade)*  — g | ml | un
//   E: Custo Total (auto) — soma da Composição
//   F: Custo / Unidade (auto) — E/C
//   G: Procedimento (opcional)
{
    const ws = wb.addWorksheet('Preparos');
    ws.columns = [
        { header: 'Nome',                    width: 32 },
        { header: 'Categoria',               width: 22 },
        { header: 'Rendimento (qtd)',        width: 16 },
        { header: 'Rendimento (unidade)',    width: 18 },
        { header: 'Custo Total (auto)',      width: 18 },
        { header: 'Custo / un (auto)',       width: 16 },
        { header: 'Procedimento',            width: 50 },
    ];
    EX_PREPAROS.forEach(r => ws.addRow([r[0], r[1], r[2], r[3], null, null, r[4]]));
    styleHeader(ws, 7);

    for (let r = 2; r <= MAX_ROWS; r++) {
        // Categoria dropdown
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        // Rendimento unidade dropdown — só canônica
        ws.getCell(`D${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"g,ml,un"'],
        };
        // Custo Total — soma da Composição (será preenchido após criar Comp_Preparos)
        // Custo Unitário = Total / Rendimento
        const fmCustoTotal = `IFERROR(SUMIFS(Composicao_Preparos!H:H,Composicao_Preparos!A:A,A${r}),0)`;
        const fmCustoUn = `IF(C${r}>0,IFERROR(E${r}/C${r},""),"")`;
        ws.getCell(`E${r}`).value = { formula: fmCustoTotal };
        ws.getCell(`F${r}`).value = { formula: fmCustoUn };
        ws.getCell(`E${r}`).numFmt = 'R$ #,##0.00';
        ws.getCell(`F${r}`).numFmt = 'R$ #,##0.0000';
    }

    ['A', 'B', 'C', 'D'].forEach(c => fillCol(ws, c, COR.input));
    fillCol(ws, 'E', COR.auto);
    fillCol(ws, 'F', COR.auto);
    fillCol(ws, 'G', COR.opcional);
}

// ════════════════════════════════════════════════════════════════
// 5. Fichas — com Custo Total e CMV calculados
// ════════════════════════════════════════════════════════════════
// Colunas:
//   A: Nome*
//   B: Categoria*
//   C: Preço de Venda (R$)*
//   D: Custo Total (auto)
//   E: CMV % (auto) — com cores 🟢/🟡/🔴
//   F: Observações
{
    const ws = wb.addWorksheet('Fichas');
    ws.columns = [
        { header: 'Nome',                 width: 32 },
        { header: 'Categoria',            width: 22 },
        { header: 'Preço de Venda (R$)', width: 18 },
        { header: 'Custo Total (auto)',   width: 18 },
        { header: 'CMV % (auto)',         width: 14 },
        { header: 'Observações',          width: 40 },
    ];
    EX_FICHAS.forEach(r => ws.addRow([r[0], r[1], r[2], null, null, r[3]]));
    styleHeader(ws, 6);

    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`B${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=_Categorias!$B$2:$B$${MAX_ROWS}`],
        };
        // Custo Total — soma da Composicao_Fichas (col H)
        const fmCustoTotal = `IFERROR(SUMIFS(Composicao_Fichas!H:H,Composicao_Fichas!A:A,A${r}),0)`;
        const fmCMV = `IF(C${r}>0,IFERROR(D${r}/C${r},""),"")`;
        ws.getCell(`D${r}`).value = { formula: fmCustoTotal };
        ws.getCell(`E${r}`).value = { formula: fmCMV };
        ws.getCell(`D${r}`).numFmt = 'R$ #,##0.00';
        ws.getCell(`E${r}`).numFmt = '0.0%';
    }

    ['A', 'B', 'C'].forEach(c => fillCol(ws, c, COR.input));
    fillCol(ws, 'D', COR.auto);
    fillCol(ws, 'E', COR.auto);
    fillCol(ws, 'F', COR.opcional);

    // Conditional formatting CMV: verde < 25%, amarelo 25-35%, vermelho > 35%
    ws.addConditionalFormatting({
        ref: `E2:E${MAX_ROWS}`,
        rules: [
            { type: 'cellIs', operator: 'lessThan',     formulae: [0.25], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } } } },
            { type: 'cellIs', operator: 'between',      formulae: [0.25, 0.35], priority: 2, style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } } } },
            { type: 'cellIs', operator: 'greaterThan',  formulae: [0.35], priority: 3, style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } } } },
        ],
    });
}

// ════════════════════════════════════════════════════════════════
// 6. _ref_itens (helper hidden) — pros dropdowns de Item
// ════════════════════════════════════════════════════════════════
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
wb.definedNames.add(`_ref_itens!$A$2:$A$${2 * MAX_ROWS - 1}`, 'itens_todos');
wb.definedNames.add(`_ref_itens!$A$2:$A$${3 * MAX_ROWS - 2}`, 'itens_combo');

// ════════════════════════════════════════════════════════════════
// 7. Composição_Preparos — com Custo da Linha
// ════════════════════════════════════════════════════════════════
// Colunas:
//   A: Preparo* (dropdown da aba Preparos)
//   B: Componente (auto) — insumo|preparo
//   C: Item* (dropdown unificado insumos + preparos)
//   D: Quantidade* (na unidade canônica do item)
//   E: Unidade (auto) — vem do item
//   F: Aproveitamento (auto) — vem do insumo (% — 100 se preparo)
//   G: Custo / un do Item (auto) — vem do insumo OU do preparo
//   H: Custo da Linha (auto) — D / (F/100) × G
//   I: Notas
{
    const ws = wb.addWorksheet('Composicao_Preparos');
    ws.columns = [
        { header: 'Preparo',           width: 28 },
        { header: 'Componente (auto)', width: 16 },
        { header: 'Item',              width: 32 },
        { header: 'Quantidade',        width: 14 },
        { header: 'Unidade (auto)',    width: 14 },
        { header: 'Aprov% (auto)',     width: 12 },
        { header: 'Custo/un (auto)',   width: 16 },
        { header: 'Custo Linha (auto)',width: 16 },
        { header: 'Notas',             width: 24 },
    ];
    EX_COMP_PREP.forEach(r => ws.addRow([r[0], null, r[1], r[2], null, null, null, null, null]));
    styleHeader(ws, 9);

    for (let r = 2; r <= MAX_ROWS; r++) {
        // Preparo dropdown
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=Preparos!$A$2:$A$${MAX_ROWS}`],
        };
        // Item dropdown
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['=itens_todos'],
        };

        // B: Componente — insumo | preparo
        const fmComp = `IF(C${r}="","",IF(ISNUMBER(MATCH(C${r},Insumos!$A:$A,0)),"insumo",IF(ISNUMBER(MATCH(C${r},Preparos!$A:$A,0)),"preparo","")))`;
        // E: Unidade — pega de Insumos.I (col 9) ou Preparos.D (col 4)
        const fmUnd = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$I,9,FALSE),IFERROR(VLOOKUP(C${r},Preparos!$A:$D,4,FALSE),"")))`;
        // F: Aprov% — Insumos.G (col 7); preparos sempre 100%
        const fmAprov = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$G,7,FALSE),100))`;
        // G: Custo/un do item — Insumos.J (col 10) ou Preparos.F (col 6)
        const fmCustoUn = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$J,10,FALSE),IFERROR(VLOOKUP(C${r},Preparos!$A:$F,6,FALSE),0)))`;
        // H: Custo da Linha — quantidade × custo / (aprov/100)
        //    Aproveitamento divide o custo total: bacon 30% → custo real 3,33× preço bruto
        const fmCustoLinha = `IF(OR(D${r}="",G${r}="",F${r}=0),"",D${r}*G${r}*(100/F${r}))`;

        ws.getCell(`B${r}`).value = { formula: fmComp };
        ws.getCell(`E${r}`).value = { formula: fmUnd };
        ws.getCell(`F${r}`).value = { formula: fmAprov };
        ws.getCell(`G${r}`).value = { formula: fmCustoUn };
        ws.getCell(`G${r}`).numFmt = 'R$ #,##0.0000';
        ws.getCell(`H${r}`).value = { formula: fmCustoLinha };
        ws.getCell(`H${r}`).numFmt = 'R$ #,##0.00';
    }

    ['A', 'C', 'D'].forEach(c => fillCol(ws, c, COR.input));
    ['B', 'E', 'F', 'G', 'H'].forEach(c => fillCol(ws, c, COR.auto));
    fillCol(ws, 'I', COR.opcional);
}

// ════════════════════════════════════════════════════════════════
// 8. Composição_Fichas — igual mas Item pode ser ficha (combo)
// ════════════════════════════════════════════════════════════════
{
    const ws = wb.addWorksheet('Composicao_Fichas');
    ws.columns = [
        { header: 'Ficha',             width: 28 },
        { header: 'Componente (auto)', width: 16 },
        { header: 'Item',              width: 32 },
        { header: 'Quantidade',        width: 14 },
        { header: 'Unidade (auto)',    width: 14 },
        { header: 'Aprov% (auto)',     width: 12 },
        { header: 'Custo/un (auto)',   width: 16 },
        { header: 'Custo Linha (auto)',width: 16 },
        { header: 'Notas',             width: 24 },
    ];
    EX_COMP_FICHA.forEach(r => ws.addRow([r[0], null, r[1], r[2], null, null, null, null, null]));
    styleHeader(ws, 9);

    for (let r = 2; r <= MAX_ROWS; r++) {
        ws.getCell(`A${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`=Fichas!$A$2:$A$${MAX_ROWS}`],
        };
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['=itens_combo'],
        };

        // Componente: insumo | preparo | ficha
        const fmComp = `IF(C${r}="","",IF(ISNUMBER(MATCH(C${r},Insumos!$A:$A,0)),"insumo",IF(ISNUMBER(MATCH(C${r},Preparos!$A:$A,0)),"preparo",IF(ISNUMBER(MATCH(C${r},Fichas!$A:$A,0)),"ficha",""))))`;
        // Unidade: Insumos.I | Preparos.D | "un" pra ficha
        const fmUnd = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$I,9,FALSE),IFERROR(VLOOKUP(C${r},Preparos!$A:$D,4,FALSE),IFERROR(IF(ISNUMBER(MATCH(C${r},Fichas!$A:$A,0)),"un",""),""))))`;
        // Aprov%: Insumos.G | 100
        const fmAprov = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$G,7,FALSE),100))`;
        // Custo/un: Insumos.J | Preparos.F | Fichas.D (custo total da ficha, pra combos)
        const fmCustoUn = `IF(C${r}="","",IFERROR(VLOOKUP(C${r},Insumos!$A:$J,10,FALSE),IFERROR(VLOOKUP(C${r},Preparos!$A:$F,6,FALSE),IFERROR(VLOOKUP(C${r},Fichas!$A:$D,4,FALSE),0))))`;
        const fmCustoLinha = `IF(OR(D${r}="",G${r}="",F${r}=0),"",D${r}*G${r}*(100/F${r}))`;

        ws.getCell(`B${r}`).value = { formula: fmComp };
        ws.getCell(`E${r}`).value = { formula: fmUnd };
        ws.getCell(`F${r}`).value = { formula: fmAprov };
        ws.getCell(`G${r}`).value = { formula: fmCustoUn };
        ws.getCell(`G${r}`).numFmt = 'R$ #,##0.0000';
        ws.getCell(`H${r}`).value = { formula: fmCustoLinha };
        ws.getCell(`H${r}`).numFmt = 'R$ #,##0.00';
    }

    ['A', 'C', 'D'].forEach(c => fillCol(ws, c, COR.input));
    ['B', 'E', 'F', 'G', 'H'].forEach(c => fillCol(ws, c, COR.auto));
    fillCol(ws, 'I', COR.opcional);
}

// ════════════════════════════════════════════════════════════════
// 9. Ver_Ficha — Visualização bonita
// ════════════════════════════════════════════════════════════════
{
    const ws = wb.addWorksheet('Ver_Ficha');
    ws.getColumn(1).width = 2;
    ws.getColumn(2).width = 22;
    ws.getColumn(3).width = 36;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 16;
    ws.getColumn(6).width = 2;

    // Cabeçalho com dropdown
    ws.mergeCells('B2:E2');
    ws.getCell('B2').value = '👁  FICHA TÉCNICA';
    ws.getCell('B2').font = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
    ws.getCell('B2').fill = COR.secao;
    ws.getCell('B2').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 30;

    ws.getCell('B4').value = 'Escolha:';
    ws.getCell('B4').font = { bold: true };
    ws.getCell('C4').dataValidation = {
        type: 'list', allowBlank: true,
        formulae: [`=Fichas!$A$2:$A$${MAX_ROWS}`],
    };
    ws.getCell('C4').value = EX_FICHAS[0]?.[0] ?? '';
    ws.getCell('C4').fill = COR.input;
    ws.getCell('C4').font = { bold: true, size: 12 };
    ws.getCell('C4').border = BORDA_CELULA;
    ws.getRow(4).height = 22;

    // Linha 6-9: info da ficha
    ws.getCell('B6').value = 'Categoria:';
    ws.getCell('B6').font = { bold: true };
    ws.getCell('C6').value = { formula: `IFERROR(VLOOKUP($C$4,Fichas!$A:$F,2,FALSE),"")` };
    ws.getCell('C6').fill = COR.auto;

    ws.getCell('B7').value = 'Preço de Venda:';
    ws.getCell('B7').font = { bold: true };
    ws.getCell('C7').value = { formula: `IFERROR(VLOOKUP($C$4,Fichas!$A:$F,3,FALSE),"")` };
    ws.getCell('C7').numFmt = 'R$ #,##0.00';
    ws.getCell('C7').fill = COR.auto;

    ws.getCell('B8').value = 'Custo Total:';
    ws.getCell('B8').font = { bold: true };
    ws.getCell('C8').value = { formula: `IFERROR(VLOOKUP($C$4,Fichas!$A:$F,4,FALSE),"")` };
    ws.getCell('C8').numFmt = 'R$ #,##0.00';
    ws.getCell('C8').fill = COR.auto;
    ws.getCell('C8').font = { bold: true, color: { argb: 'FFDC2626' } };

    ws.getCell('B9').value = 'CMV:';
    ws.getCell('B9').font = { bold: true };
    ws.getCell('C9').value = { formula: `IFERROR(VLOOKUP($C$4,Fichas!$A:$F,5,FALSE),"")` };
    ws.getCell('C9').numFmt = '0.0%';
    ws.getCell('C9').fill = COR.auto;
    ws.getCell('C9').font = { bold: true, size: 14 };

    // Linha 11: header da tabela de composição
    ws.getCell('B11').value = 'INGREDIENTES';
    ws.getCell('B11').font = { bold: true };
    ws.getCell('B11').fill = COR.secao;
    ws.mergeCells('B11:C11');
    ws.getCell('D11').value = 'QTD';
    ws.getCell('D11').font = { bold: true };
    ws.getCell('D11').fill = COR.secao;
    ws.getCell('D11').alignment = { horizontal: 'center' };
    ws.getCell('E11').value = 'R$';
    ws.getCell('E11').font = { bold: true };
    ws.getCell('E11').fill = COR.secao;
    ws.getCell('E11').alignment = { horizontal: 'right' };

    // Linhas 12-31: até 20 itens
    // Usa INDEX + SMALL + ROW pattern pra filtrar Composicao_Fichas pela ficha escolhida
    // Fórmula array-friendly que mostra o N-ésimo item da ficha selecionada.
    for (let i = 0; i < 20; i++) {
        const r = 12 + i;
        const n = i + 1; // n-ésima ocorrência
        // Item
        ws.mergeCells(`B${r}:C${r}`);
        ws.getCell(`B${r}`).value = {
            formula: `IFERROR(INDEX(Composicao_Fichas!$C:$C,SMALL(IF(Composicao_Fichas!$A$2:$A$${MAX_ROWS}=$C$4,ROW(Composicao_Fichas!$A$2:$A$${MAX_ROWS})),${n})),"")`,
        };
        ws.getCell(`B${r}`).fill = COR.auto;
        ws.getCell(`B${r}`).border = BORDA_CELULA;
        // Qtd + unidade
        ws.getCell(`D${r}`).value = {
            formula: `IF($B${r}="","",IFERROR(INDEX(Composicao_Fichas!$D:$D,SMALL(IF(Composicao_Fichas!$A$2:$A$${MAX_ROWS}=$C$4,ROW(Composicao_Fichas!$A$2:$A$${MAX_ROWS})),${n}))&" "&INDEX(Composicao_Fichas!$E:$E,SMALL(IF(Composicao_Fichas!$A$2:$A$${MAX_ROWS}=$C$4,ROW(Composicao_Fichas!$A$2:$A$${MAX_ROWS})),${n})),""))`,
        };
        ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
        ws.getCell(`D${r}`).fill = COR.auto;
        ws.getCell(`D${r}`).border = BORDA_CELULA;
        // Custo
        ws.getCell(`E${r}`).value = {
            formula: `IFERROR(INDEX(Composicao_Fichas!$H:$H,SMALL(IF(Composicao_Fichas!$A$2:$A$${MAX_ROWS}=$C$4,ROW(Composicao_Fichas!$A$2:$A$${MAX_ROWS})),${n})),"")`,
        };
        ws.getCell(`E${r}`).numFmt = 'R$ #,##0.00';
        ws.getCell(`E${r}`).fill = COR.auto;
        ws.getCell(`E${r}`).border = BORDA_CELULA;
    }
}

// ════════════════════════════════════════════════════════════════
// 10. _Validação — lista de erros
// ════════════════════════════════════════════════════════════════
{
    const ws = wb.addWorksheet('_Validação');
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 24;
    ws.getColumn(3).width = 60;

    ws.mergeCells('A1:C1');
    ws.getCell('A1').value = '⚠️  VALIDAÇÃO — verifique antes de enviar';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').fill = COR.secao;
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.getRow(1).height = 28;

    // Header da tabela
    ws.getCell('A3').value = 'Status';
    ws.getCell('B3').value = 'Tipo';
    ws.getCell('C3').value = 'Mensagem';
    ['A3', 'B3', 'C3'].forEach(c => {
        ws.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getCell(c).fill = COR.headerBg;
        ws.getCell(c).alignment = { horizontal: 'center' };
        ws.getCell(c).border = BORDA_CELULA;
    });

    // Cada linha é um teste — fórmula que retorna mensagem se OK não, e vazio se OK.
    // Pra simplificar nas v1 da v3: vamos colocar tipos de erro como contadores resumidos.
    const validacoes = [
        // [icone, tipo, formula]
        ['🔴', 'Erro',  `"Insumos sem preço: "&COUNTIFS(Insumos!F:F,"<=0",Insumos!A:A,"<>")&" (corrija na aba Insumos)"`, `COUNTIFS(Insumos!F:F,"<=0",Insumos!A:A,"<>")>0`],
        ['🔴', 'Erro',  `"Preparos sem rendimento: "&COUNTIFS(Preparos!C:C,"<=0",Preparos!A:A,"<>")&" (corrija na aba Preparos)"`, `COUNTIFS(Preparos!C:C,"<=0",Preparos!A:A,"<>")>0`],
        ['🔴', 'Erro',  `"Fichas sem preço de venda: "&COUNTIFS(Fichas!C:C,"<=0",Fichas!A:A,"<>")&" (corrija na aba Fichas)"`, `COUNTIFS(Fichas!C:C,"<=0",Fichas!A:A,"<>")>0`],
        ['🔴', 'Erro',  `"Comp_Preparos com Item não encontrado: "&SUMPRODUCT((Composicao_Preparos!C2:C${MAX_ROWS}<>"")*(Composicao_Preparos!B2:B${MAX_ROWS}=""))`, `SUMPRODUCT((Composicao_Preparos!C2:C${MAX_ROWS}<>"")*(Composicao_Preparos!B2:B${MAX_ROWS}=""))>0`],
        ['🔴', 'Erro',  `"Comp_Fichas com Item não encontrado: "&SUMPRODUCT((Composicao_Fichas!C2:C${MAX_ROWS}<>"")*(Composicao_Fichas!B2:B${MAX_ROWS}=""))`, `SUMPRODUCT((Composicao_Fichas!C2:C${MAX_ROWS}<>"")*(Composicao_Fichas!B2:B${MAX_ROWS}=""))>0`],
        ['🟡', 'Aviso', `"Fichas com CMV impossível (<5% ou >70%): "&SUMPRODUCT((Fichas!E2:E${MAX_ROWS}<>"")*((Fichas!E2:E${MAX_ROWS}<0.05)+(Fichas!E2:E${MAX_ROWS}>0.7)))`, `SUMPRODUCT((Fichas!E2:E${MAX_ROWS}<>"")*((Fichas!E2:E${MAX_ROWS}<0.05)+(Fichas!E2:E${MAX_ROWS}>0.7)))>0`],
        ['🟡', 'Aviso', `"Preparos sem composição: "&SUMPRODUCT((Preparos!A2:A${MAX_ROWS}<>"")*(COUNTIF(Composicao_Preparos!A:A,Preparos!A2:A${MAX_ROWS})=0))`, `SUMPRODUCT((Preparos!A2:A${MAX_ROWS}<>"")*(COUNTIF(Composicao_Preparos!A:A,Preparos!A2:A${MAX_ROWS})=0))>0`],
        ['🟡', 'Aviso', `"Fichas sem composição: "&SUMPRODUCT((Fichas!A2:A${MAX_ROWS}<>"")*(COUNTIF(Composicao_Fichas!A:A,Fichas!A2:A${MAX_ROWS})=0))`, `SUMPRODUCT((Fichas!A2:A${MAX_ROWS}<>"")*(COUNTIF(Composicao_Fichas!A:A,Fichas!A2:A${MAX_ROWS})=0))>0`],
    ];

    validacoes.forEach((v, i) => {
        const r = 4 + i;
        // Status só aparece se o teste falhar; senão vira ✓
        ws.getCell(`A${r}`).value = { formula: `IF(${v[3]},"${v[0]}","✅")` };
        ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
        ws.getCell(`B${r}`).value = v[1];
        ws.getCell(`B${r}`).alignment = { horizontal: 'center' };
        ws.getCell(`C${r}`).value = { formula: v[2] };
        ws.getCell(`C${r}`).alignment = { wrapText: true };
        [`A${r}`, `B${r}`, `C${r}`].forEach(c => ws.getCell(c).border = BORDA_CELULA);
    });

    // Conditional formatting nas linhas de erro
    ws.addConditionalFormatting({
        ref: `A4:C${4 + validacoes.length - 1}`,
        rules: [
            { type: 'expression', formulae: [`$A4="🔴"`], priority: 1, style: { fill: COR.aviso } },
            { type: 'expression', formulae: [`$A4="🟡"`], priority: 2, style: { fill: COR.input } },
            { type: 'expression', formulae: [`$A4="✅"`], priority: 3, style: { fill: COR.auto } },
        ],
    });

    // Resumo no final
    const lastRow = 4 + validacoes.length + 2;
    ws.mergeCells(`A${lastRow}:C${lastRow}`);
    ws.getCell(`A${lastRow}`).value = { formula: `"Total: "&COUNTA(Insumos!A2:A${MAX_ROWS})&" insumos, "&COUNTA(Preparos!A2:A${MAX_ROWS})&" preparos, "&COUNTA(Fichas!A2:A${MAX_ROWS})&" fichas"` };
    ws.getCell(`A${lastRow}`).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.getCell(`A${lastRow}`).alignment = { horizontal: 'center' };
}

// ════════════════════════════════════════════════════════════════
// SAVE
// ════════════════════════════════════════════════════════════════
await wb.xlsx.writeFile(OUT);
console.log('OK →', OUT);
