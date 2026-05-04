// Converter planilha legada do cliente para formato importável pelo Gastão.
// Mantém formato-bloco (FICHA TÉCNICA OPERACIONAL / FICHA DE MONTAGEM),
// adiciona aba tabular "Estoque" (insumos) e "_Precos_Cardapio" (opção C).

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const INPUT = path.resolve(__dirname, '..', 'fichas tecnicas atualizadas abril 2026_1776282649245.xlsx');
const OUTPUT = path.resolve(__dirname, '..', 'gastao_import_abril_2026.xlsx');
const LOG = path.resolve(__dirname, '..', 'gastao_import_abril_2026_LOG.txt');

const wb = XLSX.readFile(INPUT);
const log = [];
const push = (m) => { log.push(m); console.log(m); };

push('='.repeat(70));
push('CONVERSOR DE FICHAS — Gastão | abril 2026');
push('='.repeat(70));
push('Origem: ' + path.basename(INPUT));
push('Abas originais: ' + wb.SheetNames.length);
push('');

// ─────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO DAS ABAS
// ─────────────────────────────────────────────────────────────

const ABAS = {
  estoque: ['Estoque'],
  cardapio: ['CARDÁPIO'],
  // FP05 (2,3,4) são templates vazios — descartar
  preparos: [
    'Molhos e caldos', 'Molhos e caldos 2', 'Molhos e caldos 3', 'Molhos e caldos 4',
    'Molhos e caldos 2026', 'Bases 2026', 'Farofas e Temperos',
    'Bases de arroz e batata', 'Bases proteínas', 'Bruschettas', 'Croquetas',
    'Saladas', 'Sobremesas', 'Sobremesas2', 'Eventos',
  ],
  // FF07-10 são templates vazios — descartar
  fichasFinais: [
    'Entradas', 'Pratos do mar', 'Pratos sem carne',
    'Pratos com carne e frango', 'Sobremesas final',
  ],
  descartar: [
    'FP05 (4)', 'FP05 (3)', 'FP05 (2)',
    'FF07', 'FF08', 'FF09', 'FF10',
    'Tx.Ap', 'PCP_PREP', 'Preparos', 'NUTRI', 'LISTAS',
  ],
};

// ─────────────────────────────────────────────────────────────
// NORMALIZAÇÃO DE UNIDADES
// ─────────────────────────────────────────────────────────────

function normalizarUnidade(u) {
  const s = String(u ?? '').trim().toLowerCase();
  if (s === 'und' || s === 'unidade' || s === 'unidades') return 'un';
  if (s === 'kg' || s === 'kilo') return 'kg';
  if (s === 'g' || s === 'grama' || s === 'gramas') return 'g';
  if (s === 'l' || s === 'litro' || s === 'litros') return 'l';
  if (s === 'ml' || s === 'mililitro') return 'ml';
  if (s === 'maço') return 'maço';
  return s || 'un';
}

// ─────────────────────────────────────────────────────────────
// 1. ESTOQUE — construir aba tabular de insumos
// ─────────────────────────────────────────────────────────────

push('─'.repeat(70));
push('1) INSUMOS (aba Estoque)');
push('─'.repeat(70));

const estoqueAoa = XLSX.utils.sheet_to_json(wb.Sheets['Estoque'], { header: 1, defval: null });
const insumosRows = [['Nome', 'Unidade', 'Custo Unitário', 'Aproveitamento (0-1)']];
const insumosVistos = new Set();
let insumosOk = 0;
let insumosDupes = 0;
let insumosSemCusto = 0;

for (let i = 2; i < estoqueAoa.length; i++) {
  const r = estoqueAoa[i] || [];
  const nome = String(r[3] ?? '').trim();
  if (!nome || nome.toLowerCase() === 'nome do item' || nome === '-') continue;

  const precoCompra = parseFloat(String(r[8] ?? '').replace(',', '.')) || 0;
  const qtdEmb = parseFloat(String(r[9] ?? '').replace(',', '.')) || 1;
  const und = normalizarUnidade(r[10]);
  const aprov = parseFloat(String(r[11] ?? '').replace(',', '.')) || 1;

  const custoUnit = qtdEmb > 0 ? (precoCompra / qtdEmb) : 0;

  const key = nome.toLowerCase();
  if (insumosVistos.has(key)) { insumosDupes++; continue; }
  insumosVistos.add(key);

  if (custoUnit <= 0) insumosSemCusto++;

  insumosRows.push([nome, und, Number(custoUnit.toFixed(4)), Number(aprov.toFixed(4))]);
  insumosOk++;
}

push('  Insumos únicos exportados: ' + insumosOk);
push('  Duplicatas ignoradas: ' + insumosDupes);
push('  Sem preço (custo 0): ' + insumosSemCusto);
push('');

// ─────────────────────────────────────────────────────────────
// 2. PREPAROS + FICHAS FINAIS — filtrar blocos vazios
// ─────────────────────────────────────────────────────────────

function temIngredientes(aoa, startIdx, endIdx) {
  // Procurar pelo menos uma linha com col2 (nome ingrediente) válida
  // e col4 ou col5 numérica (qtd) entre startIdx e endIdx.
  for (let i = startIdx; i < endIdx; i++) {
    const row = aoa[i] || [];
    const col2 = String(row[2] ?? '').trim();
    const col4 = parseFloat(String(row[4] ?? '').replace(',', '.'));
    const col5 = parseFloat(String(row[5] ?? '').replace(',', '.'));
    if (col2 && col2.toLowerCase() !== 'ingredientes' &&
        col2.toLowerCase() !== 'etiquetas' &&
        col2 !== 'FICHA TÉCNICA OPERACIONAL' &&
        col2 !== 'FICHA DE MONTAGEM' &&
        (col4 > 0 || col5 > 0)) return true;
  }
  return false;
}

function limparAba(nomeAba, tipo /* 'preparo' | 'montagem' */, aba) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null });

  // Achar início e fim de cada bloco via linhas 'Receita' / 'Cód. :'
  const marcas = [];
  for (let i = 0; i < aoa.length; i++) {
    const c3 = String(aoa[i]?.[3] ?? '').trim();
    if (c3 === 'Receita' || c3 === 'Cód. :') marcas.push(i);
  }
  marcas.push(aoa.length);

  const novosBlocos = [];
  const descartados = [];

  for (let b = 0; b < marcas.length - 1; b++) {
    const ini = marcas[b];
    const fim = marcas[b + 1];
    const header = aoa[ini] || [];
    const nomeBloco = String(header[5] ?? '').trim();

    const nomeLower = nomeBloco.toLowerCase();
    const placeholder = nomeLower === 'nome da receita' || nomeLower === 'nome do prato' || nomeLower === '';

    if (placeholder || !temIngredientes(aoa, ini, fim)) {
      descartados.push({ idx: b + 1, nome: nomeBloco || '(vazio)' });
      continue;
    }

    // Copiar as linhas do bloco; injetar categoria = nome da aba se faltante
    const blocoRows = [];
    let temCategoria = false;
    for (let i = ini; i < fim; i++) {
      const r = [...(aoa[i] || [])];
      if (tipo === 'montagem' && String(r[3] ?? '').trim() === 'CATEGORIA') {
        if (!String(r[4] ?? '').trim()) r[4] = nomeAba;
        temCategoria = true;
      }
      blocoRows.push(r);
    }
    // Se é montagem e não tinha CATEGORIA, injetar logo após linha VERSÃO
    if (tipo === 'montagem' && !temCategoria) {
      // inserir após 2ª linha do bloco (geralmente VERSÃO)
      const catRow = [];
      catRow[3] = 'CATEGORIA';
      catRow[4] = nomeAba;
      blocoRows.splice(2, 0, catRow);
    }
    novosBlocos.push({ nome: nomeBloco, rows: blocoRows });
  }

  return { novosBlocos, descartados };
}

push('─'.repeat(70));
push('2) PREPAROS (FICHA TÉCNICA OPERACIONAL)');
push('─'.repeat(70));

const abasPreparo = [];
let totalPreparosOk = 0, totalPreparosDesc = 0;
for (const nome of ABAS.preparos) {
  const { novosBlocos, descartados } = limparAba(nome, 'preparo');
  totalPreparosOk += novosBlocos.length;
  totalPreparosDesc += descartados.length;
  push(`  [${nome}] ${novosBlocos.length} mantidos, ${descartados.length} descartados`);
  if (descartados.length) {
    const nomesDesc = descartados.map(d => d.nome).filter(n => n !== '(vazio)' && n !== 'Nome da Receita').slice(0, 3);
    if (nomesDesc.length) push('      descartes nomeados: ' + nomesDesc.join(', '));
  }
  if (novosBlocos.length > 0) abasPreparo.push({ nome, blocos: novosBlocos });
}
push(`  TOTAL preparos: ${totalPreparosOk} mantidos, ${totalPreparosDesc} descartados`);
push('');

push('─'.repeat(70));
push('3) FICHAS FINAIS (FICHA DE MONTAGEM)');
push('─'.repeat(70));

const abasFicha = [];
let totalFichasOk = 0, totalFichasDesc = 0;
for (const nome of ABAS.fichasFinais) {
  const { novosBlocos, descartados } = limparAba(nome, 'montagem');
  totalFichasOk += novosBlocos.length;
  totalFichasDesc += descartados.length;
  push(`  [${nome}] ${novosBlocos.length} mantidas, ${descartados.length} descartadas`);
  if (novosBlocos.length > 0) abasFicha.push({ nome, blocos: novosBlocos });
}
push(`  TOTAL fichas: ${totalFichasOk} mantidas, ${totalFichasDesc} descartadas`);
push('');

// ─────────────────────────────────────────────────────────────
// 4. PREÇOS DE VENDA (aba separada)
// ─────────────────────────────────────────────────────────────

push('─'.repeat(70));
push('4) PREÇOS DE VENDA (CARDÁPIO → _Precos_Cardapio)');
push('─'.repeat(70));

const cardAoa = XLSX.utils.sheet_to_json(wb.Sheets['CARDÁPIO'], { header: 1, defval: null });
const precosRows = [['Código', 'Nome', 'Preço de Venda']];
let precosOk = 0;
for (let i = 1; i < cardAoa.length; i++) {
  const r = cardAoa[i] || [];
  const cod = String(r[2] ?? '').trim();
  const nome = String(r[5] ?? '').trim();
  const preco = parseFloat(String(r[24] ?? '').replace(',', '.'));
  if (!nome || nome === 'Nome do Prato') continue;
  if (isNaN(preco) || preco <= 0) continue;
  precosRows.push([cod, nome, preco]);
  precosOk++;
}
push('  Preços exportados: ' + precosOk);
push('');

// ─────────────────────────────────────────────────────────────
// 5. ABAS DESCARTADAS
// ─────────────────────────────────────────────────────────────

push('─'.repeat(70));
push('5) ABAS DESCARTADAS INTEIRAS');
push('─'.repeat(70));
for (const n of ABAS.descartar) push('  [REMOVIDA] ' + n + ' — template vazio / dados não importáveis');
push('');

// ─────────────────────────────────────────────────────────────
// MONTAR WORKBOOK FINAL
// ─────────────────────────────────────────────────────────────

const out = XLSX.utils.book_new();

// Insumos
const wsEstoque = XLSX.utils.aoa_to_sheet(insumosRows);
wsEstoque['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 14 }, { wch: 18 }];
XLSX.utils.book_append_sheet(out, wsEstoque, 'Estoque');

// Marcador que o parser do app busca nas primeiras 40 linhas.
// Posição col[2] bate com o uso histórico da planilha original.
const marcadorPreparo = [[null, null, 'FICHA TÉCNICA OPERACIONAL']];
const marcadorMontagem = [[null, null, 'FICHA DE MONTAGEM']];

// Preparos (formato-bloco preservado)
for (const { nome, blocos } of abasPreparo) {
  const rows = [...marcadorPreparo, []];
  for (const b of blocos) rows.push(...b.rows, []);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(out, ws, nome.slice(0, 31));
}

// Fichas finais (formato-bloco preservado)
for (const { nome, blocos } of abasFicha) {
  const rows = [...marcadorMontagem, []];
  for (const b of blocos) rows.push(...b.rows, []);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(out, ws, nome.slice(0, 31));
}

// Preços
const wsPrec = XLSX.utils.aoa_to_sheet(precosRows);
wsPrec['!cols'] = [{ wch: 10 }, { wch: 36 }, { wch: 14 }];
XLSX.utils.book_append_sheet(out, wsPrec, '_Precos_Cardapio');

XLSX.writeFile(out, OUTPUT);

push('─'.repeat(70));
push('RESUMO FINAL');
push('─'.repeat(70));
push('  Arquivo gerado: ' + path.basename(OUTPUT));
push('  Abas na saída: ' + out.SheetNames.length);
push('  - Estoque: ' + insumosOk + ' insumos');
push('  - Preparos: ' + totalPreparosOk + ' receitas em ' + abasPreparo.length + ' abas');
push('  - Fichas finais: ' + totalFichasOk + ' pratos em ' + abasFicha.length + ' abas');
push('  - _Precos_Cardapio: ' + precosOk + ' preços');
push('');
push('Total descartado: ' + (totalPreparosDesc + totalFichasDesc) + ' blocos vazios + ' + ABAS.descartar.length + ' abas lixo');

fs.writeFileSync(LOG, log.join('\n'), 'utf-8');
console.log('\nLog salvo em: ' + path.basename(LOG));
