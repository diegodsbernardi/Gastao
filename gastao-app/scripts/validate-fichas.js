// Valida a planilha de saída contra o parser real do app.
// Replica detectSheetType + parseBlocks + header de Estoque pra garantir
// que o importador vai ler tudo corretamente.

const XLSX = require('xlsx');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'gastao_import_abril_2026.xlsx');
const wb = XLSX.readFile(FILE);

function detectSheetType(aoa) {
  for (let i = 0; i < Math.min(40, aoa.length); i++) {
    const row = aoa[i];
    if (!row) continue;
    for (const cell of row) {
      const v = String(cell ?? '').trim();
      if (v === 'FICHA TÉCNICA OPERACIONAL') return 'preparo';
      if (v === 'FICHA DE MONTAGEM') return 'montagem';
    }
  }
  return null;
}

const SKIP = new Set([
  'ingredientes', 'etiquetas', 'sem glúten', 'sem lactose', 'sem ovo',
  'fit', 'low carb', 'gourmet', 'kids', 'vegetariano', 'vegano',
  'shelflife / validade', 'armazenamento:', 'ficha técnica operacional',
  'ficha de montagem', '',
]);

function parseBlocks(aoa, type) {
  const blocks = [];
  let current = null;
  let collecting = false;
  const qtyCol = type === 'montagem' ? 4 : 5;
  const undCol = type === 'montagem' ? 5 : 4;
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const col2 = String(row[2] ?? '').trim();
    const col3 = String(row[3] ?? '').trim();
    const col5 = String(row[5] ?? '').trim();
    if ((col3 === 'Receita' || col3 === 'Cód. :') && col5) {
      if (current && current.ing.length > 0) blocks.push(current);
      current = { name: col5, cat: '', yield_qty: 1, yield_unit: 'un', ing: [] };
      collecting = false;
      continue;
    }
    if (current && col3 === 'CATEGORIA' && row[4]) current.cat = String(row[4]).trim();
    if (current && col3.toLowerCase().startsWith('qntd rendimento')) {
      const y = parseFloat(String(row[4] ?? row[5] ?? '1').replace(',', '.'));
      if (y > 0) current.yield_qty = y;
    }
    if (current && col3 === 'Und Rendimento') {
      const u = String(row[4] ?? row[5] ?? '').trim();
      if (u) current.yield_unit = u.toLowerCase();
    }
    if (col2 === 'INGREDIENTES') { collecting = true; continue; }
    if (col2.toLowerCase() === 'etiquetas') { collecting = false; continue; }
    if (current && collecting && col2 && !SKIP.has(col2.toLowerCase())) {
      const unit = String(row[undCol] ?? '').trim();
      const qty = parseFloat(String(row[qtyCol] ?? '0').replace(',', '.'));
      if (qty > 0 && unit) current.ing.push({ name: col2, qty, unit });
    }
  }
  if (current && current.ing.length > 0) blocks.push(current);
  return blocks;
}

console.log('VALIDAÇÃO — parser do Gastão vs planilha gerada\n');

let totPreparoBlocos = 0, totPreparoIng = 0;
let totFichaBlocos = 0, totFichaIng = 0;
let semCategoria = 0, semIngredientes = 0;

for (const nome of wb.SheetNames) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null });
  if (nome === 'Estoque' || nome === '_Precos_Cardapio') {
    const rows = aoa.length - 1;
    console.log(`[TABULAR] ${nome}: ${rows} linhas`);
    // Sanidade de headers
    console.log('   headers:', (aoa[0] || []).filter(Boolean).join(' | '));
    continue;
  }
  const type = detectSheetType(aoa);
  if (!type) { console.log(`⚠️  ${nome}: tipo não detectado`); continue; }
  const blocks = parseBlocks(aoa, type);
  const totIng = blocks.reduce((a, b) => a + b.ing.length, 0);
  if (type === 'preparo') { totPreparoBlocos += blocks.length; totPreparoIng += totIng; }
  else { totFichaBlocos += blocks.length; totFichaIng += totIng; }

  const semCat = blocks.filter(b => type === 'montagem' && !b.cat).length;
  const semIng = blocks.filter(b => b.ing.length === 0).length;
  semCategoria += semCat;
  semIngredientes += semIng;

  const tag = type === 'preparo' ? '[PREPARO]' : '[FICHA]  ';
  console.log(`${tag} ${nome.padEnd(32)} blocos=${String(blocks.length).padEnd(3)} ing=${totIng}${semCat ? '  ⚠️ sem cat: ' + semCat : ''}${semIng ? '  ⚠️ sem ing: ' + semIng : ''}`);
}

console.log('\n' + '─'.repeat(60));
console.log('RESUMO DO QUE O PARSER VAI IMPORTAR');
console.log('─'.repeat(60));
console.log('Preparos: ' + totPreparoBlocos + ' blocos / ' + totPreparoIng + ' linhas de composição');
console.log('Fichas:   ' + totFichaBlocos + ' blocos / ' + totFichaIng + ' linhas de composição');
console.log('Fichas sem categoria: ' + semCategoria);
console.log('Blocos sem ingredientes válidos: ' + semIngredientes);

// Amostra: primeira ficha de montagem com ingredientes
const amostra = wb.SheetNames.find(n => n === 'Entradas');
if (amostra) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[amostra], { header: 1, defval: null });
  const blocks = parseBlocks(aoa, 'montagem');
  if (blocks[0]) {
    console.log('\nAmostra ficha [Entradas/' + blocks[0].name + ']');
    console.log('  categoria: ' + blocks[0].cat);
    console.log('  ingredientes (' + blocks[0].ing.length + '):');
    blocks[0].ing.slice(0, 5).forEach(i => console.log('    - ' + i.name + ': ' + i.qty + ' ' + i.unit));
  }
}
