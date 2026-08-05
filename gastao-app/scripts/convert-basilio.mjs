#!/usr/bin/env node
// Converte "Fichas Ingleses 2026.xlsx" (Basilio Steak House) para o modelo do Gastão.
//
// FORMATO DE ORIGEM: uma aba por categoria do cardápio. O nome do produto aparece
// só na PRIMEIRA linha do grupo; as linhas seguintes (coluna A vazia) são os
// ingredientes dele, com a quantidade embutida no texto — "300g Picanha",
// "1 Ling Provolone", "Salada Mista".
//
// COMO O CUSTO É DERIVADO: a planilha traz o custo já da porção usada
// ("300g Picanha" → R$ 31,35). O custo por unidade sai da divisão pela
// quantidade extraída do texto (31,35 / 300 = R$ 0,1045/g). Ingrediente sem
// quantidade explícita vira 1 un pelo valor cheio.
//
// PREÇO DE VENDA: coluna "Venda Salão" (decisão do Diego, 05/08/2026). A coluna
// de iFood existe na origem e fica de fora até termos como separar os dois canais.
//
// Uso:
//   node scripts/convert-basilio.mjs <arquivo.xlsx>            # dry-run (padrão)
//   node scripts/convert-basilio.mjs <arquivo.xlsx> --aplicar  # grava no banco

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const RESTAURANTE_ID = 'd242a37a-1dae-4d43-bb5a-de62293cc4e4'; // Basilio Steak House
const ARQ = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');

if (!ARQ || !fs.existsSync(ARQ)) {
    console.error('Uso: node scripts/convert-basilio.mjs <arquivo.xlsx> [--aplicar]');
    process.exit(2);
}

// ─── extração ────────────────────────────────────────────────────────────────
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A coluna B ("Porção") significa coisas DIFERENTES em cada aba. Um parser único
// gera lixo — o primeiro dry-run criou insumos chamados "300" e "600". Daí uma
// estratégia por aba:
//
//   ingredientes → a linha é um ingrediente: "300g Picanha" ou "Batata 360g"
//   variacoes    → a linha é outra porção do MESMO produto (Cortes: 300g/600g),
//                  vira ficha própria ("Entrecote 600g")
//   sabores      → a linha é um sabor (Bebidas: Sucos Naturais/Laranja),
//                  vira ficha própria ("Sucos Naturais Laranja")
//   simples      → só produto e preço (Cervejas), sem composição detalhada
const ESTRATEGIA = {
    'Entradas': 'ingredientes',
    'Churrasco Completo': 'ingredientes',
    'Acompanhamentos': 'ingredientes',
    'Cortes': 'variacoes',
    'Bebidas': 'sabores',
    'Cervejas': 'simples',
};

// "300g Picanha" | "Batata 360g" | "2 un Linguiça" → {qtd, un, nome}
// Só quantidade ("200g", 350) → nome null: o ingrediente é o próprio produto.
function parseComponente(txt) {
    const s = String(txt).trim().replace(/\s+/g, ' ');
    const conv = (q, u) => {
        u = u.toLowerCase();
        if (u === 'kg') return { qtd: q * 1000, un: 'g' };
        if (u === 'l')  return { qtd: q * 1000, un: 'ml' };
        return { qtd: q, un: u.startsWith('un') ? 'un' : u };
    };
    const n = x => parseFloat(String(x).replace(/\./g, '').replace(',', '.'));

    if (/^[\d.,]+$/.test(s)) return { ...conv(n(s), 'g'), nome: null };      // 350
    let m = s.match(/^([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?$/i);         // "200g"
    if (m) return { ...conv(n(m[1]), m[2]), nome: null };

    m = s.match(/^([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?\s+(.+)$/i);      // "300g Picanha"
    if (m) return { ...conv(n(m[1]), m[2]), nome: m[3].trim() };

    m = s.match(/^(.+?)\s+([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?$/i);     // "Batata 360g"
    if (m) return { ...conv(n(m[2]), m[3]), nome: m[1].trim() };

    m = s.match(/^([\d.,]+)\s+(.+)$/);                                       // "1 Pão de alho"
    if (m && !/^[\d.,]+$/.test(m[2])) return { qtd: n(m[1]), un: 'un', nome: m[2].trim() };

    return { qtd: 1, un: 'un', nome: s };                                     // "Salada Mista"
}

const chave = n => n.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const wb = XLSX.readFile(ARQ);
const fichas = [];
const insumos = new Map();
const avisos = [];

function addInsumo(nome, un, custoUnit, categoria) {
    const base = chave(nome);
    if (!base) return null;
    // A chave inclui a unidade de propósito: a planilha usa o mesmo nome para a
    // matéria-prima (por grama) e para a porção pronta (por unidade). Misturar as
    // duas numa média só produziu CMV de 8000% no dry-run anterior.
    // O custo entra na chave: a planilha chama de "Linguiça" tanto a de pernil
    // (R$ 2,50/un) quanto a de provolone (R$ 17,50/un). Agrupar as duas pelo nome
    // e tirar média jogava o CMV da Linguiça Pernil de 26% pra 66%. Custos iguais
    // continuam agrupando normalmente.
    const selo = Number.isFinite(custoUnit) && custoUnit ? custoUnit.toPrecision(3) : '0';
    const k = `${base}|${un}|${selo}`;
    const nomeExib = un === 'un' && /^(farofa|vinagrete|arroz|batata|polenta|salada|maionese|aipim)/i.test(nome)
        ? `${nome} (porção)` : nome;
    if (!insumos.has(k)) insumos.set(k, { nome: nomeExib, un, custos: [], categoria });
    const ing = insumos.get(k);
    if (custoUnit && Number.isFinite(custoUnit)) ing.custos.push(custoUnit);
    return k;
}

for (const aba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, blankrows: false });
    if (rows.length < 2) continue;

    const modo = ESTRATEGIA[aba];
    if (!modo) { avisos.push(`Aba "${aba}" sem estratégia definida — ignorada.`); continue; }

    // Array.from, não .map: a linha de cabeçalho vem esparsa (colunas vazias no
    // meio) e .map preserva os buracos como undefined.
    const head = Array.from(rows[0], h => String(h ?? '').trim());
    const idx = (...nomes) => head.findIndex(h => nomes.some(n => h.toLowerCase() === n.toLowerCase()));
    const cVenda = idx('Venda Salão', 'Venda');
    const cCustoPorcao = idx('Custo Porção');
    const cCustoKg = idx('Custo KG');
    const cCusto = idx('Custo');

    if (cVenda < 0) { avisos.push(`Aba "${aba}": sem coluna de venda — ignorada.`); continue; }

    let produtoAtual = null;
    for (const r of rows.slice(1)) {
        const nomeProd = String(r[0] ?? '').trim();
        const bruto = r[1];
        const comp = bruto === null || bruto === undefined ? '' : String(bruto).trim();
        const venda = num(r[cVenda]);
        const custoPorcao = cCustoPorcao >= 0 ? num(r[cCustoPorcao]) : null;
        const custoKg = cCustoKg >= 0 ? num(r[cCustoKg]) : null;
        const custoSimples = cCusto >= 0 ? num(r[cCusto]) : null;

        if (nomeProd) produtoAtual = nomeProd;
        if (!produtoAtual) continue;

        // ── variações e sabores: cada linha é uma FICHA própria
        if (modo === 'variacoes' || modo === 'sabores') {
            if (!venda) continue;
            const sufixo = comp ? (modo === 'variacoes' ? `${comp}g` : comp) : '';
            const nomeFicha = sufixo && chave(sufixo) !== chave(produtoAtual)
                ? `${produtoAtual} ${sufixo}` : produtoAtual;

            const f = { categoria: aba, nome: nomeFicha, venda, itens: [] };
            fichas.push(f);

            if (modo === 'variacoes') {
                const qtd = parseFloat(comp) || 1;
                // custo/g vem do Custo KG do corte (só preenchido na 1ª linha do grupo)
                const cu = custoKg ? custoKg / 1000 : (custoPorcao && qtd ? custoPorcao / qtd : null);
                const k = addInsumo(produtoAtual, 'g', cu, aba);
                if (k) f.itens.push({ chave: k, qtd });
            } else {
                const cu = custoSimples ?? custoPorcao;
                const k = addInsumo(nomeFicha, 'un', cu, aba);
                if (k) f.itens.push({ chave: k, qtd: 1 });
            }
            continue;
        }

        // ── simples: produto + preço, sem detalhe de composição
        if (modo === 'simples') {
            if (!nomeProd || !venda) continue;
            const f = { categoria: aba, nome: produtoAtual, venda, itens: [] };
            fichas.push(f);
            const cu = custoSimples ?? num(r[1]);
            const k = addInsumo(produtoAtual, 'un', cu, aba);
            if (k) f.itens.push({ chave: k, qtd: 1 });
            continue;
        }

        // ── ingredientes: nova ficha quando o nome do produto aparece
        if (nomeProd) fichas.push({ categoria: aba, nome: nomeProd, venda: venda ?? 0, itens: [] });
        const f = fichas[fichas.length - 1];
        if (!comp || !f) continue;

        const { qtd, un, nome } = parseComponente(comp);
        // sem nome de ingrediente = a porção é do próprio produto
        const nomeIng = nome ?? produtoAtual;
        // "Custo Porção" manda sempre que existir: é o custo REAL daquela porção.
        // "Custo KG" só entra como último recurso, e só faz sentido em gramas —
        // usá-lo numa porção contada em unidades ("20un") multiplicava o preço do
        // quilo por 20 e produzia CMV de 1168%.
        const cu = (custoPorcao && qtd) ? custoPorcao / qtd
                 : (custoKg && un === 'g' ? custoKg / 1000 : null);
        const k = addInsumo(nomeIng, un, cu, aba);
        if (k) f.itens.push({ chave: k, qtd });
    }
}

// custo unitário final = média das ocorrências (a planilha repete o mesmo item
// em várias fichas, e às vezes com arredondamento diferente)
for (const ing of insumos.values()) {
    ing.custo = ing.custos.length
        ? ing.custos.reduce((a, b) => a + b, 0) / ing.custos.length
        : 0;
    const min = Math.min(...ing.custos), max = Math.max(...ing.custos);
    if (ing.custos.length > 1 && max > min * 1.5) {
        avisos.push(`"${ing.nome}": custo/un varia de ${min.toFixed(4)} a ${max.toFixed(4)} entre fichas; usei a média ${ing.custo.toFixed(4)}.`);
    }
}

// ─── relatório ───────────────────────────────────────────────────────────────
const semCusto = [...insumos.values()].filter(i => !i.custo);
const semComposicao = fichas.filter(f => !f.itens.length);
const semPreco = fichas.filter(f => !f.venda);

console.log(`\n═══ ${APLICAR ? 'IMPORTAÇÃO' : 'DRY-RUN'} — Basilio Steak House ═══\n`);
console.log(`Fichas:   ${fichas.length}`);
console.log(`Insumos:  ${insumos.size}`);
console.log(`Composição: ${fichas.reduce((s, f) => s + f.itens.length, 0)} linhas`);
console.log(`\nPor categoria:`);
const porCat = {};
fichas.forEach(f => (porCat[f.categoria] ??= []).push(f));
for (const [c, fs_] of Object.entries(porCat)) {
    console.log(`  ${c.padEnd(22)} ${String(fs_.length).padStart(2)} fichas`);
}

// CMV estimado — o teste de realidade antes de gravar
console.log(`\nCMV estimado (custo ÷ preço de venda):`);
const comCmv = fichas
    .filter(f => f.venda > 0)
    .map(f => {
        const custo = f.itens.reduce((s, i) => s + (insumos.get(i.chave)?.custo ?? 0) * i.qtd, 0);
        return { nome: f.nome, cmv: custo / f.venda * 100, custo, venda: f.venda };
    })
    .filter(f => f.custo > 0)
    .sort((a, b) => b.cmv - a.cmv);
const media = comCmv.reduce((s, f) => s + f.cmv, 0) / (comCmv.length || 1);
console.log(`  média ${media.toFixed(1)}% em ${comCmv.length} fichas`);
console.log(`  maiores: ${comCmv.slice(0, 3).map(f => `${f.nome} ${f.cmv.toFixed(0)}%`).join(' | ')}`);
console.log(`  menores: ${comCmv.slice(-3).map(f => `${f.nome} ${f.cmv.toFixed(0)}%`).join(' | ')}`);
const absurdos = comCmv.filter(f => f.cmv > 100);
if (absurdos.length) console.log(`  ⚠️  ${absurdos.length} ficha(s) com CMV acima de 100%: ${absurdos.map(f => f.nome).join(', ')}`);

if (semCusto.length)      console.log(`\n⚠️  ${semCusto.length} insumo(s) sem custo: ${semCusto.map(i => i.nome).slice(0, 10).join(', ')}`);
if (semComposicao.length) console.log(`⚠️  ${semComposicao.length} ficha(s) sem composição: ${semComposicao.map(f => f.nome).slice(0, 8).join(', ')}`);
if (semPreco.length)      console.log(`⚠️  ${semPreco.length} ficha(s) sem preço: ${semPreco.map(f => f.nome).join(', ')}`);
if (avisos.length) {
    console.log(`\nAvisos (${avisos.length}):`);
    [...new Set(avisos)].slice(0, 12).forEach(a => console.log(`  · ${a}`));
}

if (!APLICAR) {
    console.log(`\nNada foi gravado. Para importar de verdade: --aplicar\n`);
    process.exit(0);
}

// ─── gravação ────────────────────────────────────────────────────────────────
const ENV = path.join(os.homedir(), '.gastao-supabase.env');
const m = fs.readFileSync(ENV, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m);
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } });
await client.connect();

try {
    await client.query('BEGIN');

    // insumos
    const idInsumo = new Map();
    for (const [k, ing] of insumos) {
        const { rows } = await client.query(
            `INSERT INTO ingredients (restaurant_id, name, tipo, unit_type, cost_per_unit, avg_cost_per_unit, aproveitamento, categoria)
             VALUES ($1, $2, 'insumo_base', $3, $4, $4, 1, $5) RETURNING id`,
            [RESTAURANTE_ID, ing.nome, ing.un, Number(ing.custo.toFixed(6)), ing.categoria],
        );
        idInsumo.set(k, rows[0].id);
    }

    // fichas + composição
    for (const f of fichas) {
        const { rows } = await client.query(
            `INSERT INTO recipes (restaurant_id, product_name, tipo, sale_price, category, yield_quantity, unit_type)
             VALUES ($1, $2, 'ficha_final', $3, $4, 1, 'un') RETURNING id`,
            [RESTAURANTE_ID, f.nome, f.venda, f.categoria],
        );
        const recipeId = rows[0].id;
        for (const item of f.itens) {
            const ingId = idInsumo.get(item.chave);
            if (!ingId) continue;
            await client.query(
                `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_needed) VALUES ($1, $2, $3)`,
                [recipeId, ingId, item.qtd],
            );
        }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Importado: ${insumos.size} insumos, ${fichas.length} fichas.\n`);
} catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErro — nada foi gravado (rollback):', err.message);
    process.exitCode = 1;
} finally {
    await client.end();
}
