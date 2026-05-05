// Converte os 2 XLSX da BRUT pra UMA Planilha-Mãe v2 do Gastão
// (formato tabular de 6 abas que o ExcelImporter parseia direto, sem IA).
//
// ⚠ STATUS: WIP — última run produziu 0 preparos / 0 fichas food (só os 15
// coquetéis funcionaram). Coquetéis OK. Food parser tem 3 bugs conhecidos.
// Faltam ~1h de fix pra ficar pronto.
//
// BUGS CONHECIDOS no parseBlocos / parseEstoque:
//   1. Nome do preparo/ficha está em header[5], não header[4].
//      (convert-fichas.js original usa header[5] — copiei errado)
//   2. Header "INGREDIENTES" está em col 2, não col 1.
//      Ajustar a busca: c2 === 'INGREDIENTES' (não c1).
//   3. parseEstoque está extraindo "Nome da Receita" como insumo (centenas
//      de linhas). Adicionar à lista de skip:
//      if (nome.toLowerCase() === 'nome da receita') continue;
//
// Pra debugar, criar um peek script que imprime col-por-col (zero-indexed)
// das linhas L2 (nome) e L6-7 (header INGREDIENTES + primeira linha de
// ingrediente) das abas "Molhos e caldos" e "Entradas".
//
// Inputs (em gastao-app/fichas brut/, gitignored — copiar manual no outro PC):
//   - "fichas tecnicas atualizadas abril 2026_*.xlsx"  → food (Estoque + blocos)
//   - "PLANILHA DE CMV BRUT E ROSE 2026_*.xlsx"        → coquetéis
//
// Output:
//   - "Brut_Planilha_Mae.xlsx"  → pronto pra subir em /importar
//   - "Brut_Planilha_Mae_LOG.txt" → log do que foi convertido / pulado
//
// Decisões (confirmadas com Diego em 2026-05-04):
//   - Sale price das fichas food = 0 (CARDÁPIO original está vazio)
//   - Sale price dos coquetéis = 4× custo (CMV alvo 25%)
//   - Categoria default dos insumos do Estoque = "Geral"
//   - Categoria dos insumos dos coquetéis = "Bebidas"
//   - Rendimento default dos preparos = 1 porção (planilha original não tem)

import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', 'fichas brut');
const FILE_FOOD = 'fichas tecnicas atualizadas abril 2026_1776282649245.xlsx';
const FILE_DRINKS = 'PLANILHA DE CMV BRUT E ROSE 2026_1776283104217.xlsx';
const OUT_XLSX = path.join(DIR, 'Brut_Planilha_Mae.xlsx');
const OUT_LOG = path.join(DIR, 'Brut_Planilha_Mae_LOG.txt');

// ── classificação das abas do arq1 (já validado em convert-fichas.js) ─────
const ABAS_FOOD = {
    estoque: 'Estoque',
    preparos: [
        'Molhos e caldos', 'Molhos e caldos 2', 'Molhos e caldos 3', 'Molhos e caldos 4',
        'Molhos e caldos 2026', 'Bases 2026', 'Farofas e Temperos',
        'Bases de arroz e batata', 'Bases proteínas', 'Bruschettas', 'Croquetas',
        'Saladas', 'Sobremesas', 'Sobremesas2', 'Eventos',
    ],
    fichasFinais: [
        'Entradas', 'Pratos do mar', 'Pratos sem carne',
        'Pratos com carne e frango', 'Sobremesas final',
    ],
};

// ── mapeamento de aba → categoria (mantém poucas e legíveis) ──────────────
const CAT_PREPARO_POR_ABA = {
    'Molhos e caldos': 'Molhos & Caldos',
    'Molhos e caldos 2': 'Molhos & Caldos',
    'Molhos e caldos 3': 'Molhos & Caldos',
    'Molhos e caldos 4': 'Molhos & Caldos',
    'Molhos e caldos 2026': 'Molhos & Caldos',
    'Bases 2026': 'Bases',
    'Bases de arroz e batata': 'Bases',
    'Bases proteínas': 'Bases',
    'Farofas e Temperos': 'Farofas & Temperos',
    'Bruschettas': 'Bruschettas',
    'Croquetas': 'Croquetas',
    'Saladas': 'Saladas',
    'Sobremesas': 'Sobremesas',
    'Sobremesas2': 'Sobremesas',
    'Eventos': 'Eventos',
};

const CAT_FICHA_POR_ABA = {
    'Entradas': 'Entradas',
    'Pratos do mar': 'Pratos do mar',
    'Pratos sem carne': 'Pratos sem carne',
    'Pratos com carne e frango': 'Pratos com carne e frango',
    'Sobremesas final': 'Sobremesas',
};

const CAT_INSUMO_DEFAULT = 'Geral';
const CAT_INSUMO_BEBIDA = 'Bebidas';
const CAT_FICHA_COCKTAIL = 'Coquetéis';

// ── helpers ───────────────────────────────────────────────────────────────
const log = [];
const push = (m = '') => { log.push(m); console.log(m); };
const normKey = (s) => String(s ?? '').trim().toLowerCase();
const normalizarUnidade = (u) => {
    const s = String(u ?? '').trim().toLowerCase();
    if (s === 'und' || s === 'unidade' || s === 'unidades') return 'un';
    if (s === 'kg' || s === 'kilo' || s === 'quilo') return 'kg';
    if (s === 'g' || s === 'grama' || s === 'gramas') return 'g';
    if (s === 'l' || s === 'litro' || s === 'litros') return 'l';
    if (s === 'ml' || s === 'mililitro') return 'ml';
    if (s === 'porção' || s === 'porcao') return 'porção';
    return s || 'un';
};
const toNum = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(n)) {
        // tenta formato EN puro
        const n2 = parseFloat(String(v));
        return isNaN(n2) ? 0 : n2;
    }
    return n;
};
// As unidades do parser do app: kg, g, l, ml, un, porção
const UNIDADES_VALIDAS = new Set(['kg', 'g', 'l', 'ml', 'un', 'porção']);

// ──────────────────────────────────────────────────────────────────────────
// 1) ESTOQUE → insumos
// ──────────────────────────────────────────────────────────────────────────

function parseEstoque(wb) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[ABAS_FOOD.estoque], { header: 1, defval: null });
    const insumos = [];
    const vistos = new Set();
    let dupes = 0, semCusto = 0;

    // Header em L1; dados a partir de L3 (L2 é separador)
    for (let i = 2; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const nome = String(r[3] ?? '').trim();
        if (!nome || nome.toLowerCase() === 'nome do item' || nome === '-') continue;

        const precoCompra = toNum(r[8]);
        const qtdEmb      = toNum(r[9]) || 1;
        const und         = normalizarUnidade(r[10]);
        let aprov         = toNum(r[11]);
        if (aprov <= 0) aprov = 1;
        if (aprov > 1) aprov = aprov / 100; // aceita 0-100 e 0-1

        const custoUnit = qtdEmb > 0 ? precoCompra / qtdEmb : 0;
        if (!UNIDADES_VALIDAS.has(und)) {
            push(`  ⚠ insumo "${nome}" com unidade inválida "${und}" → usando "un"`);
        }
        const undFinal = UNIDADES_VALIDAS.has(und) ? und : 'un';

        const key = normKey(nome);
        if (vistos.has(key)) { dupes++; continue; }
        vistos.add(key);

        if (custoUnit <= 0) semCusto++;

        insumos.push({
            nome,
            categoria: CAT_INSUMO_DEFAULT,
            tipo: 'insumo_base',
            unidade: undFinal,
            preco: Number(custoUnit.toFixed(4)),
            aproveitamento: Math.round(aprov * 100), // % na planilha-mãe (parser converte)
            observacoes: '',
        });
    }
    return { insumos, dupes, semCusto };
}

// ──────────────────────────────────────────────────────────────────────────
// 2) BLOCOS de preparo / ficha
// ──────────────────────────────────────────────────────────────────────────

// Detecta o tipo da aba olhando as primeiras 40 linhas.
function detectTipoAba(wb, sheetName) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    for (let i = 0; i < Math.min(40, aoa.length); i++) {
        const row = aoa[i] || [];
        for (const cell of row) {
            const v = String(cell ?? '').trim();
            if (v === 'FICHA TÉCNICA OPERACIONAL') return { tipo: 'preparo', aoa };
            if (v === 'FICHA DE MONTAGEM') return { tipo: 'montagem', aoa };
        }
    }
    return { tipo: null, aoa };
}

const SKIP_INGREDIENTE = new Set([
    '', 'ingredientes', 'etiquetas', 'sem glúten', 'sem lactose', 'sem ovo',
    'fit', 'low carb', 'gourmet', 'kids', 'vegetariano', 'vegano',
    'shelflife / validade', 'armazenamento:', 'ficha técnica operacional',
    'ficha de montagem', 'procedimentos', 'montagem',
]);

// Extrai blocos de receita de uma aba (operacional ou montagem).
// Cada bloco começa em linha onde col[3] == 'Receita' ou 'Cód. :'.
function parseBlocos(aoa, tipo) {
    // tipo='preparo': col 4=und, col 5=qty.  tipo='montagem': col 4=qty, col 5=und.
    const qtyCol = tipo === 'montagem' ? 4 : 5;
    const undCol = tipo === 'montagem' ? 5 : 4;

    const inicios = [];
    for (let i = 0; i < aoa.length; i++) {
        const c3 = String(aoa[i]?.[3] ?? '').trim();
        if (c3 === 'Receita' || c3 === 'Cód. :') inicios.push(i);
    }
    inicios.push(aoa.length);

    const blocos = [];
    let descartados = 0;

    for (let b = 0; b < inicios.length - 1; b++) {
        const ini = inicios[b];
        const fim = inicios[b + 1];
        const header = aoa[ini] || [];
        const nome = String(header[4] ?? '').trim();    // L2 col 4 = nome
        const codigo = String(header[3] ?? '').trim();  // L2 col 3 = código (ex: "1.1")

        // descarta bloco placeholder/vazio
        const nl = nome.toLowerCase();
        if (!nome || nl === 'nome da receita' || nl === 'nome do prato') {
            descartados++;
            continue;
        }

        // procura header de INGREDIENTES dentro do bloco
        let ingHeaderIdx = -1;
        for (let i = ini; i < fim; i++) {
            const c1 = String(aoa[i]?.[1] ?? '').trim();
            if (c1 === 'INGREDIENTES') { ingHeaderIdx = i; break; }
        }
        if (ingHeaderIdx < 0) { descartados++; continue; }

        // ingredientes a partir da próxima linha
        const ingredientes = [];
        for (let i = ingHeaderIdx + 1; i < fim; i++) {
            const r = aoa[i] || [];
            const ingNome = String(r[2] ?? '').trim();
            if (!ingNome) continue;
            if (SKIP_INGREDIENTE.has(ingNome.toLowerCase())) continue;
            // se col 1 vira "ETIQUETAS" ou similar, para
            const c1 = String(r[1] ?? '').trim().toLowerCase();
            if (c1 === 'etiquetas') break;

            const qtd = toNum(r[qtyCol]);
            const und = normalizarUnidade(r[undCol]);
            if (qtd <= 0) continue;

            ingredientes.push({ nome: ingNome, qtd, und });
        }

        if (ingredientes.length === 0) { descartados++; continue; }

        blocos.push({ nome, codigo, ingredientes });
    }

    return { blocos, descartados };
}

// ──────────────────────────────────────────────────────────────────────────
// 3) Coquetéis (arq2)
// ──────────────────────────────────────────────────────────────────────────

function parseCocktail(wb, sheetName) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    // L1 col 0 = nome do drink; L2 = header; L3+ = insumos até linha "Gelo e Guarnições"
    const nomeDrink = String(aoa[0]?.[0] ?? '').trim();
    if (!nomeDrink) return null;

    const insumos = [];
    let custoFixo = 0;
    let custoCalc = 0;

    for (let i = 2; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const nome = String(r[0] ?? '').trim();
        if (!nome) continue;

        // "Gelo e Guarnições" — linha de custo flat (R$ fixo na col 1)
        if (nome.toLowerCase().startsWith('gelo')) {
            custoFixo = toNum(r[1]);
            break; // depois vem total + tabela de markup
        }
        // Para se chegou nas linhas de markup
        if (nome.toLowerCase().startsWith('porcentagem')) break;

        const valor   = toNum(r[1]); // R$ por embalagem
        const volume  = toNum(r[2]); // ml/un por embalagem
        const receita = toNum(r[3]); // ml usados na receita
        if (valor <= 0 || volume <= 0 || receita <= 0) continue;

        const precoPorMl = valor / volume;
        custoCalc += precoPorMl * receita;

        insumos.push({
            nome,
            precoPorEmbalagem: valor,
            volumeEmbalagem: volume,
            // Pra Planilha-Mãe: cadastrar como ml com preço/ml.
            // Composição usa ml também.
            unidade: 'ml',
            preco: Number(precoPorMl.toFixed(6)), // R$/ml
            qtdNaReceita: receita,
        });
    }

    const custoTotal = custoCalc + custoFixo;
    return { nomeDrink, insumos, custoFixo, custoTotal };
}

// ──────────────────────────────────────────────────────────────────────────
// PIPELINE
// ──────────────────────────────────────────────────────────────────────────

push('═'.repeat(70));
push('CONVERSOR BRUT → Gastão Planilha-Mãe v2');
push('═'.repeat(70));

const wbFood = XLSX.read(fs.readFileSync(path.join(DIR, FILE_FOOD)), { type: 'buffer' });
const wbDrinks = XLSX.read(fs.readFileSync(path.join(DIR, FILE_DRINKS)), { type: 'buffer' });

push('\n── 1) ESTOQUE ──');
const { insumos: insumosEstoque, dupes, semCusto } = parseEstoque(wbFood);
push(`  ${insumosEstoque.length} insumos únicos, ${dupes} duplicatas ignoradas, ${semCusto} sem preço (custo 0)`);

push('\n── 2) PREPAROS ──');
const preparosMap = new Map(); // nome → { categoria, ingredientes }
let totalPrep = 0, descPrep = 0;
for (const aba of ABAS_FOOD.preparos) {
    if (!wbFood.SheetNames.includes(aba)) { push(`  ⚠ aba "${aba}" não existe`); continue; }
    const { tipo, aoa } = detectTipoAba(wbFood, aba);
    if (tipo !== 'preparo') { push(`  ⚠ aba "${aba}" não é tipo preparo (${tipo}) — pulada`); continue; }
    const { blocos, descartados } = parseBlocos(aoa, 'preparo');
    const cat = CAT_PREPARO_POR_ABA[aba] ?? aba;
    let novos = 0, dupesAba = 0;
    for (const b of blocos) {
        const key = normKey(b.nome);
        if (preparosMap.has(key)) { dupesAba++; continue; }
        preparosMap.set(key, { nome: b.nome, categoria: cat, ingredientes: b.ingredientes });
        novos++;
    }
    push(`  [${aba}] +${novos} preparos (${descartados} vazios descartados, ${dupesAba} dupes)`);
    totalPrep += novos;
    descPrep += descartados;
}
push(`  TOTAL: ${totalPrep} preparos`);

push('\n── 3) FICHAS (food) ──');
const fichasMap = new Map(); // nome → { categoria, ingredientes }
let totalFicha = 0, descFicha = 0;
for (const aba of ABAS_FOOD.fichasFinais) {
    if (!wbFood.SheetNames.includes(aba)) { push(`  ⚠ aba "${aba}" não existe`); continue; }
    const { tipo, aoa } = detectTipoAba(wbFood, aba);
    if (tipo !== 'montagem') { push(`  ⚠ aba "${aba}" não é tipo montagem (${tipo}) — pulada`); continue; }
    const { blocos, descartados } = parseBlocos(aoa, 'montagem');
    const cat = CAT_FICHA_POR_ABA[aba] ?? aba;
    let novos = 0, dupesAba = 0;
    for (const b of blocos) {
        const key = normKey(b.nome);
        if (fichasMap.has(key)) { dupesAba++; continue; }
        fichasMap.set(key, { nome: b.nome, categoria: cat, salePrice: 0, unidadeVenda: 'un', ingredientes: b.ingredientes });
        novos++;
    }
    push(`  [${aba}] +${novos} fichas (${descartados} vazias descartadas, ${dupesAba} dupes)`);
    totalFicha += novos;
    descFicha += descartados;
}
push(`  TOTAL: ${totalFicha} fichas food`);

push('\n── 4) COQUETÉIS ──');
const cocktailsParsed = []; // { nomeDrink, insumos, custoTotal }
for (const aba of wbDrinks.SheetNames) {
    const c = parseCocktail(wbDrinks, aba);
    if (c) cocktailsParsed.push(c);
}
push(`  ${cocktailsParsed.length} coquetéis parseados`);

// Insumos dos coquetéis: dedup por nome, preço/ml mediano se aparecer múltiplas vezes
const insumosCocktailMap = new Map(); // nome → { unidade, preco, count, somaPrec }
let usedGelo = false;
for (const c of cocktailsParsed) {
    for (const i of c.insumos) {
        const key = normKey(i.nome);
        const ent = insumosCocktailMap.get(key);
        if (ent) {
            ent.count += 1;
            ent.somaPrec += i.preco;
        } else {
            insumosCocktailMap.set(key, { nome: i.nome, unidade: 'ml', somaPrec: i.preco, count: 1 });
        }
    }
    if (c.custoFixo > 0) usedGelo = true;
}
const insumosCocktail = [...insumosCocktailMap.values()].map(e => ({
    nome: e.nome,
    categoria: CAT_INSUMO_BEBIDA,
    tipo: 'insumo_base',
    unidade: e.unidade,
    preco: Number((e.somaPrec / e.count).toFixed(6)),
    aproveitamento: 100,
    observacoes: '',
}));
if (usedGelo) {
    insumosCocktail.push({
        nome: 'Gelo e Guarnições',
        categoria: CAT_INSUMO_BEBIDA,
        tipo: 'insumo_base',
        unidade: 'un',
        preco: 1.5,
        aproveitamento: 100,
        observacoes: 'Custo flat por drink (vem da planilha CMV)',
    });
}
push(`  ${insumosCocktail.length} insumos únicos extraídos dos coquetéis (incluindo "Gelo e Guarnições" se aplicável)`);

// ──────────────────────────────────────────────────────────────────────────
// MERGE FINAL — produzir as 6 abas tabulares
// ──────────────────────────────────────────────────────────────────────────

push('\n── 5) MERGE & validação ──');

// Insumos consolidados (food + bebidas) — dedup por nome (food prevalece)
const insumoFinalMap = new Map();
for (const i of insumosEstoque) insumoFinalMap.set(normKey(i.nome), i);
let insumosBebidaNovos = 0, insumosBebidaConflito = 0;
for (const i of insumosCocktail) {
    const key = normKey(i.nome);
    if (insumoFinalMap.has(key)) { insumosBebidaConflito++; continue; }
    insumoFinalMap.set(key, i);
    insumosBebidaNovos++;
}
push(`  insumos: ${insumoFinalMap.size} totais (${insumosEstoque.length} food + ${insumosBebidaNovos} bebidas; ${insumosBebidaConflito} colisões resolvidas pra food)`);

// Auto-criar insumos referenciados em preparos/fichas mas ausentes no Estoque
let autoInsumos = 0;
const autoInsumoNames = [];
const garantirInsumo = (nome, undGuess) => {
    const key = normKey(nome);
    if (insumoFinalMap.has(key)) return insumoFinalMap.get(key);
    const undFinal = UNIDADES_VALIDAS.has(normalizarUnidade(undGuess)) ? normalizarUnidade(undGuess) : 'un';
    const novo = {
        nome,
        categoria: CAT_INSUMO_DEFAULT,
        tipo: 'insumo_base',
        unidade: undFinal,
        preco: 0,
        aproveitamento: 100,
        observacoes: 'AUTO-CRIADO (não estava no Estoque)',
    };
    insumoFinalMap.set(key, novo);
    autoInsumos++;
    autoInsumoNames.push(nome);
    return novo;
};

// Composição dos preparos
const compPreparos = []; // { preparo, componente, item, quantidade, unidade }
for (const p of preparosMap.values()) {
    for (const ing of p.ingredientes) {
        // Se o ingrediente bate com o nome de outro preparo, é componente=preparo
        const isPreparo = preparosMap.has(normKey(ing.nome));
        if (isPreparo) {
            compPreparos.push({
                preparo: p.nome,
                componente: 'preparo',
                item: preparosMap.get(normKey(ing.nome)).nome, // nome canônico
                quantidade: ing.qtd,
                unidade: '', // parser default puxa de Preparos.rendimentoUnidade
            });
        } else {
            const ins = garantirInsumo(ing.nome, ing.und);
            compPreparos.push({
                preparo: p.nome,
                componente: 'insumo',
                item: ins.nome,
                quantidade: ing.qtd,
                unidade: UNIDADES_VALIDAS.has(ing.und) ? ing.und : ins.unidade,
            });
        }
    }
}

// Composição das fichas food
const compFichas = [];
for (const f of fichasMap.values()) {
    for (const ing of f.ingredientes) {
        const isPreparo = preparosMap.has(normKey(ing.nome));
        if (isPreparo) {
            compFichas.push({
                ficha: f.nome,
                componente: 'preparo',
                item: preparosMap.get(normKey(ing.nome)).nome,
                quantidade: ing.qtd,
                unidade: '',
            });
        } else {
            const ins = garantirInsumo(ing.nome, ing.und);
            compFichas.push({
                ficha: f.nome,
                componente: 'insumo',
                item: ins.nome,
                quantidade: ing.qtd,
                unidade: UNIDADES_VALIDAS.has(ing.und) ? ing.und : ins.unidade,
            });
        }
    }
}

// Coquetéis viram fichas + composição
const fichasCocktail = [];
for (const c of cocktailsParsed) {
    const sale = Number((c.custoTotal * 4).toFixed(2)); // CMV alvo 25%
    fichasCocktail.push({
        nome: c.nomeDrink,
        categoria: CAT_FICHA_COCKTAIL,
        salePrice: sale,
        unidadeVenda: 'un',
        observacoes: `custo R$${c.custoTotal.toFixed(2)} → preço sugerido (CMV 25%) R$${sale}`,
    });
    for (const i of c.insumos) {
        compFichas.push({
            ficha: c.nomeDrink,
            componente: 'insumo',
            item: i.nome,
            quantidade: i.qtdNaReceita,
            unidade: 'ml',
        });
    }
    if (c.custoFixo > 0) {
        compFichas.push({
            ficha: c.nomeDrink,
            componente: 'insumo',
            item: 'Gelo e Guarnições',
            quantidade: 1,
            unidade: 'un',
        });
    }
}
push(`  ${compPreparos.length} linhas Composicao_Preparos`);
push(`  ${compFichas.length} linhas Composicao_Fichas (food + coquetéis)`);
if (autoInsumos > 0) {
    push(`  ⚠ ${autoInsumos} insumos AUTO-CRIADOS (referenciados em receitas mas ausentes do Estoque) — preço 0, precisam ser preenchidos`);
    autoInsumoNames.slice(0, 25).forEach(n => push(`     · ${n}`));
    if (autoInsumoNames.length > 25) push(`     ... e mais ${autoInsumoNames.length - 25}`);
}

// Categorias finais (necessárias pra _Categorias)
const catsInsumo = new Set([CAT_INSUMO_DEFAULT, CAT_INSUMO_BEBIDA]);
const catsPreparo = new Set();
const catsFicha = new Set([CAT_FICHA_COCKTAIL]);
for (const p of preparosMap.values()) catsPreparo.add(p.categoria);
for (const f of fichasMap.values()) catsFicha.add(f.categoria);

// ──────────────────────────────────────────────────────────────────────────
// ESCREVE XLSX no formato Planilha-Mãe v2 (6 abas tabulares + _Leia-me)
// ──────────────────────────────────────────────────────────────────────────

push('\n── 6) Escrevendo XLSX final ──');

const out = XLSX.utils.book_new();

// _Leia-me
const leiame = [
    ['Planilha-Mãe Gastão — exportada da BRUT em ' + new Date().toISOString().slice(0, 10)],
    [''],
    ['Origem:'],
    ['  · ' + FILE_FOOD],
    ['  · ' + FILE_DRINKS],
    [''],
    ['ATENÇÃO antes de importar:'],
    ['  1) Preços de venda das fichas food estão zerados (CARDÁPIO original vazio).'],
    ['  2) Preços de venda dos coquetéis foram calculados com CMV alvo de 25%.'],
    ['     Veja a coluna "Observações" da aba Fichas para o custo original.'],
    ['  3) Insumos AUTO-CRIADOS (referenciados em receitas mas ausentes do Estoque)'],
    ['     ficam com preço R$ 0 e categoria "Geral" — revise antes da apresentação.'],
    ['  4) Rendimento dos preparos foi setado em 1 porção (planilha original'],
    ['     não tinha esse dado). Ajuste os preparos mais usados pra custo correto.'],
];
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(leiame), '_Leia-me');

// _Categorias
const catRows = [['Tipo de Item', 'Categoria', 'Descrição']];
[...catsInsumo].sort().forEach(c => catRows.push(['insumo', c, '']));
[...catsPreparo].sort().forEach(c => catRows.push(['preparo', c, '']));
[...catsFicha].sort().forEach(c => catRows.push(['ficha', c, '']));
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(catRows), '_Categorias');

// Insumos
const insRows = [['Nome', 'Categoria', 'Tipo', 'Unidade', 'Preço de Compra', 'Aproveitamento (%)', 'Observações']];
for (const i of insumoFinalMap.values()) {
    insRows.push([i.nome, i.categoria, i.tipo, i.unidade, i.preco, i.aproveitamento, i.observacoes]);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(insRows), 'Insumos');

// Preparos
const prepRows = [['Nome', 'Categoria', 'Rendimento (qtd)', 'Rendimento (unidade)', 'Observações']];
for (const p of preparosMap.values()) {
    prepRows.push([p.nome, p.categoria, 1, 'porção', '']);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(prepRows), 'Preparos');

// Fichas (food + coquetéis)
const ficRows = [['Nome', 'Categoria', 'Preço de Venda', 'Unidade de Venda', 'Observações']];
for (const f of fichasMap.values()) {
    ficRows.push([f.nome, f.categoria, f.salePrice, f.unidadeVenda, '']);
}
for (const c of fichasCocktail) {
    ficRows.push([c.nome, c.categoria, c.salePrice, c.unidadeVenda, c.observacoes]);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(ficRows), 'Fichas');

// Composicao_Preparos
const cpRows = [['Preparo', 'Componente', 'Item', 'Quantidade', 'Unidade']];
for (const r of compPreparos) cpRows.push([r.preparo, r.componente, r.item, r.quantidade, r.unidade]);
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(cpRows), 'Composicao_Preparos');

// Composicao_Fichas
const cfRows = [['Ficha', 'Componente', 'Item', 'Quantidade', 'Unidade']];
for (const r of compFichas) cfRows.push([r.ficha, r.componente, r.item, r.quantidade, r.unidade]);
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(cfRows), 'Composicao_Fichas');

XLSX.writeFile(out, OUT_XLSX);

push('\n══════════════════════════════════════════════════════════════════════');
push('RESUMO');
push('══════════════════════════════════════════════════════════════════════');
push(`  Categorias:        ${catsInsumo.size} insumo + ${catsPreparo.size} preparo + ${catsFicha.size} ficha`);
push(`  Insumos:           ${insumoFinalMap.size}  (${autoInsumos} auto-criados sem preço)`);
push(`  Preparos:          ${preparosMap.size}`);
push(`  Fichas (food):     ${fichasMap.size}  (todas com sale_price=0)`);
push(`  Fichas (coquetel): ${fichasCocktail.length}  (sale_price calculado p/ CMV 25%)`);
push(`  Comp. Preparos:    ${compPreparos.length} linhas`);
push(`  Comp. Fichas:      ${compFichas.length} linhas`);
push('');
push(`  ✅ Output: ${path.basename(OUT_XLSX)}`);

fs.writeFileSync(OUT_LOG, log.join('\n'), 'utf-8');
console.log('\nLog completo: ' + path.basename(OUT_LOG));
