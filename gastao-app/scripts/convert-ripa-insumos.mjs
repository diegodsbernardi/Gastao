#!/usr/bin/env node
// Cadastra os insumos da Ripa na Xulipa a partir de "CONTAGEM ESTOQUE - RIPA".
//
// A planilha é a contagem de estoque: traz o produto, a unidade em que a casa
// COMPRA/CONTA, a categoria e os níveis de mínimo/máximo. Duas decisões:
//
// 1. UNIDADE — o Gastão precisa da unidade canônica (kg, g, l, un) pra usar em
//    preparo e ficha. "KG"→kg, "GR"→g, "L"/"LT"/"GL"/"BARRIL"→l, e tudo que é
//    contado por peça ("UND", "PCT", "CX", "MÇ", "ROLO", "pares") → un.
//    A unidade de compra fica registrada em `unit`, que é justamente o campo
//    que ajuda a casar a descrição da nota fiscal depois.
//
// 2. O QUE É COMIDA — 55 dos 202 itens são descartável ou limpeza. Descartável
//    entra como `embalagem` (compõe custo de delivery). Limpeza entra com
//    use_in_recipes = false: aparece no estoque, mas não polui o seletor de
//    ingredientes de quem monta ficha técnica.
//
// Sem custo: a planilha não traz preço. O custo vem das notas fiscais.
//
// Uso:
//   node scripts/convert-ripa-insumos.mjs <arquivo.xlsx>            # dry-run
//   node scripts/convert-ripa-insumos.mjs <arquivo.xlsx> --aplicar

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const RESTAURANTE_ID = '62059273-3156-4f92-9fdf-6c0eb4985232'; // Ripa na Xulipa
const ARQ = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');

if (!ARQ || !fs.existsSync(ARQ)) {
    console.error('Uso: node scripts/convert-ripa-insumos.mjs <arquivo.xlsx> [--aplicar]');
    process.exit(2);
}

// unidade de compra → unidade canônica do Gastão
const UNIDADE = {
    KG: 'kg', GR: 'g', G: 'g', L: 'l', LT: 'l', ML: 'ml',
    GL: 'l',        // galão de 5 l (limpeza)
    BARRIL: 'l',    // chope
    UND: 'un', UN: 'un', PCT: 'un', CX: 'un', 'MÇ': 'un',
    ROLO: 'un', PARES: 'un',
};

const TIPO_POR_CATEGORIA = {
    'DESCARTÁVEIS': 'embalagem',
};
const NAO_ENTRA_EM_FICHA = ['LIMPEZA'];

const wb = XLSX.readFile(ARQ);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['CONTAGEM BASE'], { header: 1, blankrows: false });

// A contagem mais recente (aba com data no nome) tem as quantidades em estoque.
const abasData = wb.SheetNames
    .filter(n => /^\d{2}-\d{2}-\d{4}$/.test(n))
    .sort((a, b) => {
        const d = s => s.split('-').reverse().join('');
        return d(a) < d(b) ? 1 : -1;
    });
const abaRecente = abasData[0];
const estoque = new Map();
if (abaRecente) {
    XLSX.utils.sheet_to_json(wb.Sheets[abaRecente], { header: 1, blankrows: false })
        .slice(2)
        .forEach(r => {
            const nome = String(r[0] ?? '').trim();
            const qtd = typeof r[1] === 'number' ? r[1] : null;
            if (nome && qtd != null) estoque.set(nome.toLowerCase(), qtd);
        });
}

const insumos = [];
const avisos = [];
const vistos = new Set();

for (const r of rows.slice(2)) {
    const nome = String(r[0] ?? '').trim();
    if (!nome) continue;

    const unCompra = String(r[2] ?? '').trim();
    const categoria = String(r[3] ?? '').trim() || null;
    const unidade = UNIDADE[unCompra.toUpperCase()];

    if (!unidade) {
        avisos.push(`"${nome}": unidade "${unCompra}" desconhecida — não cadastrado.`);
        continue;
    }
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) { avisos.push(`"${nome}": duplicado na planilha, mantido o primeiro.`); continue; }
    vistos.add(chave);

    insumos.push({
        nome,
        unidade,
        unCompra,
        categoria,
        tipo: TIPO_POR_CATEGORIA[categoria] ?? 'insumo_base',
        usaEmReceita: !NAO_ENTRA_EM_FICHA.includes(categoria),
        estoque: estoque.get(chave) ?? 0,
    });
}

// ─── relatório ───────────────────────────────────────────────────────────────
const porUnidade = {}, porTipo = {}, porCategoria = {};
insumos.forEach(i => {
    porUnidade[i.unidade] = (porUnidade[i.unidade] ?? 0) + 1;
    const t = i.tipo === 'embalagem' ? 'embalagem' : (i.usaEmReceita ? 'insumo (ficha)' : 'insumo (fora da ficha)');
    porTipo[t] = (porTipo[t] ?? 0) + 1;
    if (i.categoria) porCategoria[i.categoria] = (porCategoria[i.categoria] ?? 0) + 1;
});

console.log(`\n═══ ${APLICAR ? 'CADASTRO' : 'DRY-RUN'} — Ripa na Xulipa ═══\n`);
console.log(`Insumos a cadastrar: ${insumos.length}`);
console.log(`Contagem usada pro estoque: ${abaRecente ?? '(nenhuma)'} — ${[...estoque.values()].filter(Boolean).length} itens com quantidade`);
console.log(`\nPor unidade canônica:`);
Object.entries(porUnidade).sort((a, b) => b[1] - a[1]).forEach(([u, n]) => console.log(`  ${String(n).padStart(3)} ${u}`));
console.log(`\nPor uso:`);
Object.entries(porTipo).forEach(([t, n]) => console.log(`  ${String(n).padStart(3)} ${t}`));
console.log(`\nExemplos de conversão de unidade:`);
[...new Set(insumos.map(i => `${i.unCompra} → ${i.unidade}`))].forEach(x => {
    const ex = insumos.find(i => `${i.unCompra} → ${i.unidade}` === x);
    console.log(`  ${x.padEnd(14)} ex: ${ex.nome}`);
});
if (avisos.length) { console.log(`\nAvisos (${avisos.length}):`); avisos.slice(0, 10).forEach(a => console.log(`  · ${a}`)); }

if (!APLICAR) {
    console.log(`\nNada gravado. Para cadastrar: --aplicar\n`);
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
    for (const i of insumos) {
        await client.query(
            `INSERT INTO ingredients
               (restaurant_id, name, tipo, unit_type, unit, categoria, cost_per_unit,
                avg_cost_per_unit, aproveitamento, stock_quantity, use_in_recipes)
             VALUES ($1,$2,$3,$4,$5,$6,0,0,1,$7,$8)`,
            [RESTAURANTE_ID, i.nome, i.tipo, i.unidade, i.unCompra, i.categoria, i.estoque, i.usaEmReceita]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${insumos.length} insumos cadastrados. Custo virá das notas fiscais.\n`);
} catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErro — nada gravado (rollback):', err.message);
    process.exitCode = 1;
} finally {
    await client.end();
}
