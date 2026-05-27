// Converte o xlsx da CRIMINAL pra UMA Planilha-Mãe v2 do Gastão.
//
// Estrutura da planilha original (CRIMINAL — 1 cliente, 1 arquivo):
//   - 1 aba = 1 receita auto-contida (não tem aba central de Estoque)
//   - Layout fixo:
//       L1: "FICHA TÉCNICA DE RECEITA"
//       L2: "Nome de Venda do Prato:" | ... | col E (idx 4) = NOME
//       L3: "Classificação:" | ... | col E (idx 4) = CLASSE
//       L4: header da tabela de ingredientes
//       L5+: ingredientes
//         col B (idx 1) = nome
//         col E (idx 4) = unidade (Kg, Und, Ml, LT, etc — case-mixed)
//         col F (idx 5) = peso líquido (qty na unidade indicada)
//         col G (idx 6) = aproveitamento (1 = 100%)
//         col H (idx 7) = peso bruto (embalagem, opcional)
//         col I (idx 8) = preço unitário (R$ pela embalagem)
//         col J (idx 9) = custo da porção (auto)
//       (algum lugar) col M (idx 12) = "Preço de venda" + col N (idx 13) valor
//
// Classificação como ficha vs preparo:
//   - classe == 'PRODUÇÃO' → preparo
//   - preço de venda == 0  → preparo (heurística reforço)
//   - senão → ficha
//
// Sub-receitas: ingrediente cujo nome bate (case-insensitive) com nome de outra aba.
//
// Rodar: node scripts/convert-criminal.mjs

import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', 'fichas criminal');
const FILE_IN = 'criminal.xlsx';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_XLSX = path.join(DIR, `Criminal_Planilha_Mae_${ts}.xlsx`);
const OUT_LOG  = path.join(DIR, `Criminal_Planilha_Mae_${ts}_LOG.txt`);

const log = [];
const push = (s = '') => { log.push(s); console.log(s); };

// ── util ────────────────────────────────────────────────────────────
const toNum = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    let n;
    if (hasComma && hasDot) n = s.replace(/\./g, '').replace(',', '.');
    else if (hasComma) n = s.replace(',', '.');
    else n = s;
    const r = parseFloat(n);
    return isNaN(r) ? 0 : r;
};
const toStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const norm = (s) => toStr(s).toLowerCase();

/**
 * Normaliza unidade da planilha CRIMINAL pra unidade canônica do Gastão.
 * Retorna { canon: 'g'|'ml'|'un', factor: número }.
 * factor é o multiplicador pra passar do valor original pro canônico:
 *   - 1 kg → 1000 g (factor 1000)
 *   - 1 L  → 1000 ml (factor 1000)
 *   - 1 ml → 1 ml (factor 1)
 *   - 1 un → 1 un (factor 1)
 */
function unitToCanonical(raw) {
    const u = norm(raw);
    if (!u) return { canon: 'un', factor: 1, ok: false };
    if (u === 'kg')                       return { canon: 'g',  factor: 1000, ok: true };
    if (u === 'g')                        return { canon: 'g',  factor: 1,    ok: true };
    if (u === 'l' || u === 'lt')          return { canon: 'ml', factor: 1000, ok: true };
    if (u === 'ml')                       return { canon: 'ml', factor: 1,    ok: true };
    if (u === 'un' || u === 'und' || u === 'unidade' || u === 'unid'
        || u === 'pct' || u === 'pacote' || u === 'pç' || u === 'pc')
                                          return { canon: 'un', factor: 1,    ok: true };
    return { canon: 'un', factor: 1, ok: false };
}

// ── leitura do xlsx ─────────────────────────────────────────────────
const inputPath = path.join(DIR, FILE_IN);
if (!fs.existsSync(inputPath)) {
    console.error('Arquivo não encontrado:', inputPath);
    process.exit(1);
}
const wb = XLSX.readFile(inputPath);

push('══════════════════════════════════════════════════════════════════════');
push(`CRIMINAL → Planilha-Mãe v2`);
push(`Input:  ${FILE_IN}`);
push(`Output: ${path.basename(OUT_XLSX)}`);
push('══════════════════════════════════════════════════════════════════════\n');
push(`Abas no arquivo: ${wb.SheetNames.length}`);

// ── PASS 1: parse cada aba, extrai metadados + ingredientes ─────────
const recipes = [];     // { sheet, nome, classe, ingredientes[], precoVenda, ehPreparo, custoTotalOriginal }
const skipped = [];

for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const ref = ws['!ref'];
    if (!ref) { skipped.push({ sheet, motivo: 'sem !ref' }); continue; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    if (aoa.length < 4) { skipped.push({ sheet, motivo: `só ${aoa.length} linhas` }); continue; }

    // Verifica header "FICHA TÉCNICA DE RECEITA" em A1
    const a1 = toStr(aoa[0]?.[0]).toUpperCase();
    if (!a1.includes('FICHA TÉCNICA')) {
        skipped.push({ sheet, motivo: 'sem header FICHA TÉCNICA' });
        continue;
    }

    // Nome canônico = nome da aba (mais previsível, menos códigos POS).
    // Nome interno (B2:E2) entra como ALIAS pra sub-recipe detection.
    const nomeAba = sheet.trim();
    const nomeInterno = toStr(aoa[1]?.[4]);
    const nome = nomeAba;
    const classe = toStr(aoa[2]?.[4]) || '(sem classificação)';

    // Ingredientes: do row 4 (idx 4 = L5) até encontrar "Modo de preparo" ou "Unidade:" em col A
    const ingredientes = [];
    let stopRow = aoa.length;
    for (let i = 4; i < aoa.length; i++) {
        const a = toStr(aoa[i]?.[0]).toLowerCase();
        if (a.startsWith('unidade:') || a.startsWith('modo de preparo')) {
            stopRow = i;
            break;
        }
    }
    for (let i = 4; i < stopRow; i++) {
        const r = aoa[i] || [];
        const nomeIng = toStr(r[1]);
        if (!nomeIng) continue;
        // Linha de ingrediente válida precisa ter qty > 0 ou preço > 0
        const qtdRaw = toNum(r[5]);
        const aprov  = toNum(r[6]) || 1;
        const pesoBruto = toNum(r[7]) || 1;
        const precoEmb  = toNum(r[8]);
        if (qtdRaw <= 0 && precoEmb <= 0) continue;
        const unidRaw = toStr(r[4]);
        ingredientes.push({
            nome: nomeIng,
            unidadeOriginal: unidRaw,
            qtdNaUnidadeOriginal: qtdRaw,
            aproveitamento: aprov,
            pesoBruto,
            precoEmbalagem: precoEmb,
        });
    }

    // Preço de venda: procura label "Preço de venda" em col M (idx 12) ou col L (idx 11)
    let precoVenda = 0;
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
        const r = aoa[i] || [];
        for (let j = 10; j <= 13; j++) {
            const lbl = toStr(r[j]).toLowerCase();
            if (lbl.includes('preço de venda') || lbl.includes('preco de venda')) {
                // valor pode estar na próxima coluna
                precoVenda = toNum(r[j + 1]) || toNum(r[j + 2]) || 0;
                break;
            }
        }
        if (precoVenda > 0) break;
    }

    // Custo total registrado (pra validação)
    let custoOriginal = 0;
    for (let i = 0; i < aoa.length; i++) {
        const r = aoa[i] || [];
        for (let j = 0; j < (r.length || 0); j++) {
            const lbl = toStr(r[j]).toLowerCase();
            if (lbl === 'custo total:' || lbl === 'custo total') {
                custoOriginal = toNum(r[j + 1]) || 0;
                break;
            }
        }
        if (custoOriginal > 0) break;
    }

    // Classifica ficha vs preparo APENAS pela classificação textual.
    // (Heurística "sem preço de venda = preparo" foi descartada porque
    // muitas fichas reais não têm o campo preenchido na origem.)
    const classeUpper = classe.toUpperCase();
    const ehPreparo = classeUpper === 'PRODUÇÃO' || classeUpper === 'PRODUCAO';

    recipes.push({
        sheet: nomeAba,
        nome,                // canônico (= nome da aba)
        nomeInterno,         // alias pra sub-recipe match
        classe,
        classeUpper,
        ehPreparo,
        precoVenda,
        custoOriginal,
        ingredientes,
    });
}

push(`Receitas válidas: ${recipes.length}`);
push(`Abas puladas: ${skipped.length}`);
skipped.forEach(s => push(`   · ${s.sheet}: ${s.motivo}`));

// ── PASS 2: detectar sub-receitas ───────────────────────────────────
// Index aceita match por nome de aba OU nome interno (ambos normalizados).
// Valor = { canonName: nome canônico (aba), tipoSub: 'preparo'|'ficha' }.
const recipeAliasIndex = new Map();
for (const r of recipes) {
    const entry = { canonName: r.nome, tipoSub: r.ehPreparo ? 'preparo' : 'ficha' };
    recipeAliasIndex.set(norm(r.nome), entry);
    if (r.nomeInterno && norm(r.nomeInterno) !== norm(r.nome)) {
        recipeAliasIndex.set(norm(r.nomeInterno), entry);
        // Variação sem sufixo de código POS (ex: "Burrata 113026" → "Burrata")
        const stripped = r.nomeInterno.replace(/\s+\d{5,}\s*$/, '').trim();
        if (stripped && norm(stripped) !== norm(r.nome)) {
            recipeAliasIndex.set(norm(stripped), entry);
        }
    }
}

let totalSubRefs = 0;
let totalRefsBrokenUnit = 0;
let totalAutoRefs = 0;
for (const rec of recipes) {
    for (const ing of rec.ingredientes) {
        // Auto-referência: ingrediente com mesmo nome da própria receita
        // (ex: PICANHA crua → ficha PICANHA, PIMENTA JALAPEÑO in natura →
        // preparo PIMENTA JALAPEÑO curtida). Força como insumo cru e
        // renomeia pra evitar colisão de nomes no banco.
        if (norm(ing.nome) === norm(rec.nome)) {
            ing.nome = `${ing.nome} (in natura)`;
            ing.ehSubReceita = false;
            ing.nomeCanonicoSub = ing.nome;
            ing.tipoSub = 'insumo';
            totalAutoRefs++;
        } else {
            const match = recipeAliasIndex.get(norm(ing.nome));
            ing.ehSubReceita = !!match;
            ing.nomeCanonicoSub = match ? match.canonName : ing.nome;
            ing.tipoSub = match ? match.tipoSub : 'insumo';
            if (ing.ehSubReceita) totalSubRefs++;
        }
        const u = unitToCanonical(ing.unidadeOriginal);
        ing.unidadeCanonica = u.canon;
        ing.fatorCanon = u.factor;
        ing.qtdCanonica = ing.qtdNaUnidadeOriginal * u.factor;
        if (!u.ok) totalRefsBrokenUnit++;
    }
}
push(`\nReferências sub-receita detectadas: ${totalSubRefs}`);
if (totalAutoRefs > 0) push(`Auto-referências renomeadas pra "(in natura)": ${totalAutoRefs}`);
if (totalRefsBrokenUnit > 0) push(`⚠ Linhas com unidade não reconhecida (caem em 'un'): ${totalRefsBrokenUnit}`);

// ── PASS 2.5: decidir unidade canônica POR insumo (família majoritária) ──
// Cada insumo pode aparecer em receitas com unidades diferentes (ex: ÁGUA
// como "Und" em MAIONESE BRANCA mas "Lt" em MOLHO POMODORO). Padroniza:
// conta família de cada ocorrência, vencedora vira a canônica do insumo.
// Desempate: mass > volume > un.
const familyOfCanon = (c) => c === 'g' ? 'mass' : c === 'ml' ? 'volume' : 'un';
const canonOfFamily = (f) => f === 'mass' ? 'g' : f === 'volume' ? 'ml' : 'un';

const familyCounts = new Map();  // normNome → { mass, volume, un }
for (const rec of recipes) {
    for (const ing of rec.ingredientes) {
        if (ing.ehSubReceita) continue;
        const k = norm(ing.nome);
        if (!familyCounts.has(k)) familyCounts.set(k, { mass: 0, volume: 0, un: 0 });
        familyCounts.get(k)[familyOfCanon(ing.unidadeCanonica)]++;
    }
}
const ingredientFinalCanon = new Map(); // normNome → unidade canônica decidida
for (const [k, counts] of familyCounts) {
    let best = 'mass';
    for (const f of ['volume', 'un']) {
        if (counts[f] > counts[best]) best = f;
    }
    ingredientFinalCanon.set(k, canonOfFamily(best));
}

// Conversão entre unidades canônicas dentro do conversor.
// mass↔volume com densidade 1; un nunca converte automático.
function convCanonToCanon(qty, from, to) {
    if (from === to) return qty;
    if ((from === 'g' && to === 'ml') || (from === 'ml' && to === 'g')) return qty;
    return null;
}

// ── PASS 3: agregar INSUMOS únicos (ingredientes que NÃO são sub-receita) ─
// Pra cada nome único: pega último preço encontrado (preferindo > 0).
// Unidade canônica é a decidida no pass 2.5.
const insumoMap = new Map(); // key normNome → { nome, unidadeCanonica, precoCanonico, aprov, categoria }
const insumoCategoriaPorReceita = new Map(); // normNome → Set<classe>

for (const rec of recipes) {
    for (const ing of rec.ingredientes) {
        if (ing.ehSubReceita) continue;
        const k = norm(ing.nome);
        if (!insumoCategoriaPorReceita.has(k)) insumoCategoriaPorReceita.set(k, new Set());
        insumoCategoriaPorReceita.get(k).add(rec.classe);

        const unidadeFinal = ingredientFinalCanon.get(k);

        // Custo unitário canônico DA UNIDADE FINAL DO INSUMO.
        // Se a ocorrência original já estava na família final, calcula direto.
        // Se está em outra família compatível (mass↔volume com d=1), preço por unidade equivale.
        // Se incompatível (ex: ocorrência un, final ml), ignora pra preço.
        let precoCanon = 0;
        if (ing.pesoBruto > 0 && ing.precoEmbalagem > 0 && ing.fatorCanon > 0) {
            const precoNaUnidadeDaOcorrencia = (ing.precoEmbalagem / ing.pesoBruto) / ing.fatorCanon;
            const conv = convCanonToCanon(1, ing.unidadeCanonica, unidadeFinal);
            if (conv !== null) precoCanon = precoNaUnidadeDaOcorrencia;
        }

        const prev = insumoMap.get(k);
        if (!prev) {
            insumoMap.set(k, {
                nome: ing.nome,
                unidadeCanonica: unidadeFinal,
                precoCanonico: precoCanon,
                aproveitamento: ing.aproveitamento,
            });
        } else {
            if (precoCanon > 0) prev.precoCanonico = precoCanon;
        }
    }
}

push(`\nInsumos únicos agregados: ${insumoMap.size}`);
let semPreco = 0;
for (const i of insumoMap.values()) if (i.precoCanonico <= 0) semPreco++;
push(`   sem preço (R$ 0): ${semPreco}`);

// ── PASS 4: computar rendimento dos preparos ────────────────────────
// Heurística (mesmo workaround usado no convert-brut.mjs):
//   rendimento = soma da massa total em g, assumindo densidade 1 pra
//   misturar volume e massa. Pra "un" trata como 1g (aproximação).
// Isso garante que composições de ficha em g/ml batam com unidade
// canônica do preparo no costCalculator do app.
for (const rec of recipes) {
    if (!rec.ehPreparo) continue;
    const sum = rec.ingredientes.reduce((s, i) => s + (i.qtdCanonica || 0), 0);
    if (sum > 0) {
        rec.rendimentoQtd = sum;
        rec.rendimentoUnidade = 'g';
    } else {
        rec.rendimentoQtd = 1;
        rec.rendimentoUnidade = 'porção';
    }
}

// ── PASS 5: categorias ──────────────────────────────────────────────
// Categorias de insumo: derivadas da classe da PRIMEIRA receita que usa cada insumo.
// Vou usar uma categoria padrão "Geral" se múltiplas — chef ajusta depois.
const catsInsumo = new Set();
for (const [k, classes] of insumoCategoriaPorReceita.entries()) {
    const i = insumoMap.get(k);
    if (!i) continue;
    // pega a categoria mais comum / primeira ordenada
    const arr = [...classes];
    i.categoria = arr.length === 1 ? arr[0] : 'Geral';
    catsInsumo.add(i.categoria);
}

const catsPreparo = new Set();
const catsFicha = new Set();
for (const rec of recipes) {
    if (rec.ehPreparo) catsPreparo.add(rec.classe || 'Geral');
    else catsFicha.add(rec.classe || 'Geral');
}

push(`\nCategorias:`);
push(`   insumo:  ${catsInsumo.size}`);
push(`   preparo: ${catsPreparo.size}`);
push(`   ficha:   ${catsFicha.size}`);

// ── EMITIR PLANILHA-MÃE v2 ──────────────────────────────────────────
const out = XLSX.utils.book_new();

// _Leia-me (curto)
const leiame = [
    ['Planilha-Mãe v2 — CRIMINAL'],
    [`Gerada em ${new Date().toLocaleString('pt-BR')} a partir de ${FILE_IN}`],
    [''],
    ['Importação:'],
    ['  1. App /importar → upload deste xlsx no tenant CRIMINAL'],
    ['  2. Acompanhar o log do importador'],
    [''],
    ['Notas:'],
    [`  - Rendimento dos preparos = soma da massa em unidade canônica (ou 1 porção se misto)`],
    [`  - ${semPreco} insumos vieram sem preço (R$ 0) — ajustar no app depois`],
    [`  - Custos calculados a partir de "preço embalagem ÷ peso bruto"`],
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
for (const i of insumoMap.values()) {
    insRows.push([
        i.nome,
        i.categoria || 'Geral',
        'insumo_base',
        i.unidadeCanonica,
        i.precoCanonico,
        100,
        '',
    ]);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(insRows), 'Insumos');

// Preparos
const prepRows = [['Nome', 'Categoria', 'Rendimento (qtd)', 'Rendimento (unidade)', 'Observações']];
for (const rec of recipes) {
    if (!rec.ehPreparo) continue;
    prepRows.push([rec.nome, rec.classe || 'Geral', rec.rendimentoQtd, rec.rendimentoUnidade, '']);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(prepRows), 'Preparos');

// Fichas
const ficRows = [['Nome', 'Categoria', 'Preço de Venda', 'Unidade de Venda', 'Observações']];
for (const rec of recipes) {
    if (rec.ehPreparo) continue;
    ficRows.push([rec.nome, rec.classe || 'Geral', rec.precoVenda, 'un', '']);
}
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(ficRows), 'Fichas');

// Helper: pra cada ocorrência de insumo na composição, converte qty pra
// unidade canônica decidida do insumo. Retorna { qty, unidade } ou null
// se incompatível (não vai pra composição).
function resolveQtyParaInsumo(ing) {
    if (ing.ehSubReceita) return { qty: ing.qtdCanonica, unidade: ing.unidadeCanonica };
    const k = norm(ing.nome);
    const insumoCanon = ingredientFinalCanon.get(k) || ing.unidadeCanonica;
    const qty = convCanonToCanon(ing.qtdCanonica, ing.unidadeCanonica, insumoCanon);
    if (qty === null) return null;
    return { qty, unidade: insumoCanon };
}

// Composicao_Preparos (somente preparos)
// Schema do parser: TIPOS_COMPONENTE = ['insumo', 'preparo']. Preparo NÃO
// pode referenciar ficha. Caso ocorra, skipa com warning.
const cpRows = [['Preparo', 'Componente', 'Item', 'Quantidade', 'Unidade']];
let skippedCpFichaRef = 0;
let skippedCpIncompat = 0;
for (const rec of recipes) {
    if (!rec.ehPreparo) continue;
    for (const ing of rec.ingredientes) {
        const componente = ing.ehSubReceita ? ing.tipoSub : 'insumo';
        if (componente === 'ficha') { skippedCpFichaRef++; continue; }
        const resolved = resolveQtyParaInsumo(ing);
        if (!resolved) { skippedCpIncompat++; continue; }
        cpRows.push([
            rec.nome,
            componente,
            ing.ehSubReceita ? ing.nomeCanonicoSub : ing.nome,
            resolved.qty,
            resolved.unidade,
        ]);
    }
}
if (skippedCpFichaRef > 0) push(`⚠ ${skippedCpFichaRef} linhas Composicao_Preparos puladas (preparo→ficha não permitido)`);
if (skippedCpIncompat > 0) push(`⚠ ${skippedCpIncompat} linhas Composicao_Preparos puladas (unidade incompatível insumo↔composição)`);
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(cpRows), 'Composicao_Preparos');

// Composicao_Fichas (somente fichas) — aceita insumo|preparo|ficha
const cfRows = [['Ficha', 'Componente', 'Item', 'Quantidade', 'Unidade']];
let skippedCfIncompat = 0;
for (const rec of recipes) {
    if (rec.ehPreparo) continue;
    for (const ing of rec.ingredientes) {
        const componente = ing.ehSubReceita ? ing.tipoSub : 'insumo';
        const resolved = resolveQtyParaInsumo(ing);
        if (!resolved) { skippedCfIncompat++; continue; }
        cfRows.push([
            rec.nome,
            componente,
            ing.ehSubReceita ? ing.nomeCanonicoSub : ing.nome,
            resolved.qty,
            resolved.unidade,
        ]);
    }
}
if (skippedCfIncompat > 0) push(`⚠ ${skippedCfIncompat} linhas Composicao_Fichas puladas (unidade incompatível)`);
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(cfRows), 'Composicao_Fichas');

XLSX.writeFile(out, OUT_XLSX);

push('\n══════════════════════════════════════════════════════════════════════');
push('RESUMO');
push('══════════════════════════════════════════════════════════════════════');
push(`  Insumos únicos:    ${insumoMap.size}   (${semPreco} sem preço)`);
push(`  Preparos:          ${recipes.filter(r => r.ehPreparo).length}`);
push(`  Fichas:            ${recipes.filter(r => !r.ehPreparo).length}`);
push(`  Linhas Comp.Prep:  ${cpRows.length - 1}`);
push(`  Linhas Comp.Fic:   ${cfRows.length - 1}`);
push('');
push(`  ✅ Output: ${path.basename(OUT_XLSX)}`);

fs.writeFileSync(OUT_LOG, log.join('\n'), 'utf-8');
