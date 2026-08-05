#!/usr/bin/env node
// Converte "Fichas Ingleses 2026.xlsx" (Basilio Steak House) para o modelo do Gastão.
//
// MODELO EM 3 CAMADAS — a planilha já separa isso, e a primeira versão deste
// script ignorou, jogando tudo como insumo e duplicando itens ("Batata Frita" e
// "Batata Frita (porção)"). O correto:
//
//   INSUMO  → o que se compra: cortes crus, pão, linguiça, batata, creme, bebida.
//   PREPARO → o que a cozinha produz: os 16 itens da aba Acompanhamentos.
//             Cada um tem rendimento (a porção) e composição própria.
//   FICHA   → o que se vende. Acompanhamento vendido avulso é ficha que consome
//             o PREPARO; churrasco é ficha que consome preparos + insumos.
//
// Assim "500g Maionese" dentro do churrasco aponta para o preparo Maionese de
// Batata (360g batata + 140g creme = 500g), em vez de virar um insumo paralelo.
//
// PREÇO DE VENDA: coluna "Venda Salão". A de iFood existe na origem e fica de
// fora até termos como separar os canais.
//
// Uso:
//   node scripts/convert-basilio.mjs <arquivo.xlsx>            # dry-run
//   node scripts/convert-basilio.mjs <arquivo.xlsx> --aplicar  # grava

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const RESTAURANTE_ID = 'd242a37a-1dae-4d43-bb5a-de62293cc4e4';
const ARQ = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');

if (!ARQ || !fs.existsSync(ARQ)) {
    console.error('Uso: node scripts/convert-basilio.mjs <arquivo.xlsx> [--aplicar]');
    process.exit(2);
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const chave = n => String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// "300g Picanha" | "Batata 360g" | "20un" | "2 Farofa" | "Salada Mista"
function parsePorcao(txt) {
    const s = String(txt ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return null;
    const n = x => parseFloat(String(x).replace(',', '.'));
    const conv = (q, u) => {
        u = (u || '').toLowerCase();
        if (u === 'kg') return { qtd: q * 1000, un: 'g' };
        if (u === 'l') return { qtd: q * 1000, un: 'ml' };
        return { qtd: q, un: u.startsWith('un') ? 'un' : (u || null) };
    };
    let m;
    if ((m = s.match(/^([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?$/i)))
        return { ...conv(n(m[1]), m[2]), nome: null };                            // "350g", "20un"
    if ((m = s.match(/^([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?\s+(.+)$/i)))
        return { ...conv(n(m[1]), m[2]), nome: m[3].trim() };                     // "300g Picanha"
    if ((m = s.match(/^(.+?)\s+([\d.,]+)\s*(kg|g|ml|l|un|und|unid)\b\.?$/i)))
        return { ...conv(n(m[2]), m[3]), nome: m[1].trim() };                     // "Batata 360g"
    if ((m = s.match(/^([\d.,]+)\s+(.+)$/)) && !/^[\d.,]+$/.test(m[2]))
        return { qtd: n(m[1]), un: null, nome: m[2].trim() };                     // "2 Farofa"
    if (/^[\d.,]+$/.test(s)) return { qtd: n(s), un: 'g', nome: null };           // 300
    return { qtd: null, un: null, nome: s };                                      // "Salada Mista"
}

const wb = XLSX.readFile(ARQ);
const aba = n => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n] ?? {}, { header: 1, blankrows: false });
    if (!rows.length) return { rows: [], col: () => -1 };
    // Array.from, não .map: a linha de cabeçalho vem esparsa e .map preserva buracos.
    const head = Array.from(rows[0], h => String(h ?? '').trim());
    return {
        rows: rows.slice(1),
        col: (...nomes) => head.findIndex(h => nomes.some(x => h.toLowerCase() === x.toLowerCase())),
    };
};

const insumos = new Map();
const preparos = new Map();
const fichas = [];

function addInsumo(nome, un, custo, tipo = 'insumo_base') {
    const k = chave(nome);
    if (!k) return null;
    if (!insumos.has(k)) insumos.set(k, { nome, un: un ?? 'un', custo: custo ?? 0, tipo });
    else if (!insumos.get(k).custo && custo) insumos.get(k).custo = custo;
    return k;
}

// ─── 1. PREPAROS (aba Acompanhamentos) ───────────────────────────────────────
{
    const { rows, col } = aba('Acompanhamentos');
    const cCustoKg = col('Custo KG'), cCustoPorcao = col('Custo Porção'),
          cTotal = col('Custo Total'), cVenda = col('Venda Salão', 'Venda');
    let atual = null;
    for (const r of rows) {
        const nome = String(r[0] ?? '').trim();
        const p = parsePorcao(r[1]);
        const custoPorcao = num(r[cCustoPorcao]);

        if (nome) {
            atual = { nome, rendQtd: 0, rendUn: null, itens: [], venda: num(r[cVenda]) ?? 0,
                      custoRef: num(r[cTotal]) ?? custoPorcao ?? 0 };
            preparos.set(chave(nome), atual);
        }
        if (!atual || !p) continue;

        // "350g" sozinho, ou rótulo genérico como "Porção p2", significam o próprio
        // produto. Sem esta regra, Mista e Palmito compartilhavam um insumo chamado
        // "Porção p2" e herdavam o custo um do outro (R$ 1,35 em vez de R$ 14,00).
        const generico = p.nome && /^por(ç|c)(ã|a)o\b/i.test(p.nome);
        const nomeIng = (!p.nome || generico) ? atual.nome : p.nome;
        const un = p.un ?? 'un';
        const qtd = p.qtd ?? 1;
        // Componente nomeado ("Batata 360g") usa o Custo Porção dele. O componente
        // que É o próprio produto usa o Custo Total, que é o custo da porção
        // completa: na "Mista" a planilha traz porção 1,35 e total 3,50, porque a
        // salada leva itens que o autor não detalhou em linha separada.
        const custoBase = (!p.nome || generico) ? (num(r[cTotal]) ?? custoPorcao) : custoPorcao;
        const custoUnit = custoBase && qtd ? custoBase / qtd
                        : (num(r[cCustoKg]) && un === 'g' ? num(r[cCustoKg]) / 1000 : 0);
        const k = addInsumo(nomeIng, un, custoUnit);
        if (!k) continue;
        atual.itens.push({ k, qtd });
        if (!atual.rendUn) atual.rendUn = un;
        if (atual.rendUn === un) atual.rendQtd += qtd;   // rendimento = soma dos componentes
    }
    for (const p of preparos.values()) if (!p.rendQtd) { p.rendQtd = 1; p.rendUn = 'un'; }
}

// Resolve um componente: aponta pro preparo quando existir, senão vira insumo.
function resolveComponente(texto, custoPorcao) {
    const p = parsePorcao(texto);
    if (!p) return null;
    const nomeBase = p.nome ?? texto;

    const alvo = chave(nomeBase)
        .replace(/^salada /, '')     // "Salada Mista" → preparo "Mista"
        .replace(/ p \d+$/, '');     // "Polenta p 2"  → "Polenta"
    let kPrep = [...preparos.keys()].find(k => k === alvo || k === chave(nomeBase));
    if (!kPrep) kPrep = [...preparos.keys()].find(k => k.startsWith(alvo) || alvo.startsWith(k));

    if (kPrep) {
        const prep = preparos.get(kPrep);
        // "500g Maionese" usa a unidade do preparo; "2 Farofa" são 2 porções
        const qtd = (p.un && p.un === prep.rendUn && p.qtd) ? p.qtd : (p.qtd ?? 1) * prep.rendQtd;
        return { tipo: 'preparo', k: kPrep, qtd };
    }

    const un = p.un ?? 'un';
    const qtd = p.qtd ?? 1;
    const k = addInsumo(nomeBase, un, custoPorcao && qtd ? custoPorcao / qtd : 0);
    return k ? { tipo: 'insumo', k, qtd } : null;
}

// ─── 2. FICHAS ───────────────────────────────────────────────────────────────
// 2a. Acompanhamento vendido avulso → ficha que consome uma porção do preparo
for (const [k, p] of preparos) {
    if (!p.venda) continue;
    fichas.push({ nome: p.nome, categoria: 'Acompanhamentos', venda: p.venda,
                  itens: [{ tipo: 'preparo', k, qtd: p.rendQtd }] });
}

// 2b. Entradas e Churrasco Completo → composição mista
for (const nomeAba of ['Entradas', 'Churrasco Completo']) {
    const { rows, col } = aba(nomeAba);
    const cCustoPorcao = col('Custo Porção'), cCustoKg = col('Custo KG'),
          cVenda = col('Venda Salão', 'Venda');
    let f = null;
    for (const r of rows) {
        const nome = String(r[0] ?? '').trim();
        const comp = String(r[1] ?? '').trim();
        if (nome) {
            f = { nome, categoria: nomeAba, venda: num(r[cVenda]) ?? 0, itens: [] };
            fichas.push(f);
        }
        if (!f || !comp) continue;

        const p = parsePorcao(comp);
        let custoPorcao = num(r[cCustoPorcao]);
        // "200g" sozinho: a porção é do próprio produto; custo vem do Custo KG
        if (!p.nome && num(r[cCustoKg]) && p.un === 'g') custoPorcao = num(r[cCustoKg]) * p.qtd / 1000;

        const item = resolveComponente(p.nome ? comp : `${p.qtd}${p.un ?? ''} ${f.nome}`, custoPorcao);
        if (item) f.itens.push(item);
    }
}

// 2c. Cortes → insumo por grama, uma ficha por tamanho (300g / 600g)
{
    const { rows, col } = aba('Cortes');
    const cCustoKg = col('Custo KG'), cCustoPorcao = col('Custo Porção'),
          cVenda = col('Venda Salão', 'Venda');
    let corte = null;
    for (const r of rows) {
        const nome = String(r[0] ?? '').trim();
        const gramas = num(r[1]);
        const venda = num(r[cVenda]);
        if (nome) {
            corte = nome;
            const custoG = num(r[cCustoKg]) ? num(r[cCustoKg]) / 1000
                         : (num(r[cCustoPorcao]) && gramas ? num(r[cCustoPorcao]) / gramas : 0);
            addInsumo(corte, 'g', custoG);
        }
        if (!corte || !venda || !gramas) continue;
        fichas.push({ nome: `${corte} ${gramas}g`, categoria: 'Cortes', venda,
                      itens: [{ tipo: 'insumo', k: chave(corte), qtd: gramas }] });
    }
}

// 2d. Bebidas e Cervejas → revenda: insumo_direto + ficha
for (const nomeAba of ['Bebidas', 'Cervejas']) {
    const { rows, col } = aba(nomeAba);
    const cCusto = col('Custo'), cCustoPorcao = col('Custo Porção'),
          cVenda = col('Venda Salão', 'Venda');
    let produto = null;
    for (const r of rows) {
        const nome = String(r[0] ?? '').trim();
        const sabor = String(r[1] ?? '').trim();
        const venda = num(r[cVenda]);
        if (nome) produto = nome;
        if (!produto || !venda) continue;

        const nomeFicha = sabor && chave(sabor) !== chave(produto) && !/^[\d.,]+$/.test(sabor)
            ? `${produto} ${sabor}` : produto;
        const custo = num(r[cCusto]) ?? num(r[cCustoPorcao]) ?? 0;
        const k = addInsumo(nomeFicha, 'un', custo, 'insumo_direto');
        fichas.push({ nome: nomeFicha, categoria: nomeAba, venda,
                      itens: k ? [{ tipo: 'insumo', k, qtd: 1 }] : [] });
    }
}

// ─── custos e relatório ──────────────────────────────────────────────────────
const custoPreparo = k => {
    const p = preparos.get(k);
    return p ? p.itens.reduce((s, i) => s + (insumos.get(i.k)?.custo ?? 0) * i.qtd, 0) : 0;
};
const custoPreparoUn = k => {
    const p = preparos.get(k);
    return p && p.rendQtd ? custoPreparo(k) / p.rendQtd : 0;
};
const custoFicha = f => f.itens.reduce((s, i) =>
    s + (i.tipo === 'preparo' ? custoPreparoUn(i.k) : (insumos.get(i.k)?.custo ?? 0)) * i.qtd, 0);

console.log(`\n═══ ${APLICAR ? 'IMPORTAÇÃO' : 'DRY-RUN'} — Basilio Steak House ═══\n`);
console.log(`Insumos:  ${insumos.size}`);
console.log(`Preparos: ${preparos.size}`);
console.log(`Fichas:   ${fichas.length}`);

const comCmv = fichas.filter(f => f.venda > 0)
    .map(f => ({ nome: f.nome, custo: custoFicha(f), venda: f.venda }))
    .filter(f => f.custo > 0)
    .map(f => ({ ...f, cmv: f.custo / f.venda * 100 }))
    .sort((a, b) => b.cmv - a.cmv);
const media = comCmv.reduce((s, f) => s + f.cmv, 0) / (comCmv.length || 1);
console.log(`\nCMV: média ${media.toFixed(1)}% em ${comCmv.length} fichas`);
console.log(`  maiores: ${comCmv.slice(0, 3).map(f => `${f.nome} ${f.cmv.toFixed(0)}%`).join(' | ')}`);
console.log(`  menores: ${comCmv.slice(-3).map(f => `${f.nome} ${f.cmv.toFixed(0)}%`).join(' | ')}`);
const absurdos = comCmv.filter(f => f.cmv > 100);
if (absurdos.length) console.log(`  ⚠️  acima de 100%: ${absurdos.map(f => `${f.nome} ${f.cmv.toFixed(0)}%`).join(', ')}`);

console.log(`\nPreparos (rendimento → custo calculado vs planilha):`);
for (const [k, p] of preparos)
    console.log(`  ${p.nome.padEnd(20)} ${String(p.rendQtd).padStart(5)} ${String(p.rendUn).padEnd(3)} → R$ ${custoPreparo(k).toFixed(2)}   planilha R$ ${p.custoRef.toFixed(2)}`);

const uso = new Map();
fichas.forEach(f => f.itens.filter(i => i.tipo === 'preparo')
    .forEach(i => uso.set(i.k, (uso.get(i.k) ?? 0) + 1)));
const reaproveitados = [...uso.entries()].filter(([, n]) => n > 1);
if (reaproveitados.length) {
    console.log(`\nPreparos reaproveitados (o ganho de separar as camadas):`);
    reaproveitados.forEach(([k, n]) => console.log(`  ${preparos.get(k).nome} → ${n} fichas`));
}

const semCusto = [...insumos.values()].filter(i => !i.custo);
if (semCusto.length) console.log(`\n⚠️  ${semCusto.length} insumo(s) sem custo: ${semCusto.map(i => i.nome).slice(0, 12).join(', ')}`);

if (!APLICAR) {
    console.log(`\nNada foi gravado. Para importar: --aplicar\n`);
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

    const idIns = new Map();
    for (const [k, i] of insumos) {
        const { rows } = await client.query(
            `INSERT INTO ingredients (restaurant_id, name, tipo, unit_type, cost_per_unit, avg_cost_per_unit, aproveitamento)
             VALUES ($1,$2,$3,$4,$5,$5,1) RETURNING id`,
            [RESTAURANTE_ID, i.nome, i.tipo, i.un, Number(i.custo.toFixed(6))]);
        idIns.set(k, rows[0].id);
    }

    const idPrep = new Map();
    for (const [k, p] of preparos) {
        const { rows } = await client.query(
            `INSERT INTO recipes (restaurant_id, product_name, tipo, yield_quantity, unit_type, category)
             VALUES ($1,$2,'preparo',$3,$4,'Acompanhamentos') RETURNING id`,
            [RESTAURANTE_ID, p.nome, p.rendQtd, p.rendUn]);
        idPrep.set(k, rows[0].id);
        for (const it of p.itens) {
            if (!idIns.has(it.k)) continue;
            await client.query(
                `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_needed) VALUES ($1,$2,$3)`,
                [rows[0].id, idIns.get(it.k), it.qtd]);
        }
    }

    for (const f of fichas) {
        const { rows } = await client.query(
            `INSERT INTO recipes (restaurant_id, product_name, tipo, sale_price, category, yield_quantity, unit_type)
             VALUES ($1,$2,'ficha_final',$3,$4,1,'un') RETURNING id`,
            [RESTAURANTE_ID, f.nome, f.venda, f.categoria]);
        for (const it of f.itens) {
            if (it.tipo === 'preparo' && idPrep.has(it.k)) {
                await client.query(
                    `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity_needed) VALUES ($1,$2,$3)`,
                    [rows[0].id, idPrep.get(it.k), it.qtd]);
            } else if (idIns.has(it.k)) {
                await client.query(
                    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_needed) VALUES ($1,$2,$3)`,
                    [rows[0].id, idIns.get(it.k), it.qtd]);
            }
        }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Importado: ${insumos.size} insumos, ${preparos.size} preparos, ${fichas.length} fichas.\n`);
} catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErro — nada gravado (rollback):', err.message);
    process.exitCode = 1;
} finally {
    await client.end();
}
