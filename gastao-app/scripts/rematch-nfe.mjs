#!/usr/bin/env node
// Refaz a sugestão de insumo dos itens de NF-e já importados.
//
// O robô do Drive sugere no momento da importação. Quando o cadastro de insumos
// muda depois (reimportação de cardápio, renomeação em massa), as notas antigas
// ficam sem sugestão e o cliente vê 1.000 itens em branco para vincular na mão.
// Este script reaplica o MESMO algoritmo do robô sobre o que já está no banco.
//
// Sugestão nunca vira confirmação: quem bate o martelo é o humano na UI.
//
// Uso:
//   node scripts/rematch-nfe.mjs <restaurante_id>            # dry-run
//   node scripts/rematch-nfe.mjs <restaurante_id> --aplicar

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RESTAURANTE_ID = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');
if (!RESTAURANTE_ID) {
    console.error('Uso: node scripts/rematch-nfe.mjs <restaurante_id> [--aplicar]');
    process.exit(2);
}

// ── mesmo algoritmo do nfe-drive-sync.mjs ────────────────────────────────────
const normalize = s => String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ');

const STOPWORDS = new Set(['de', 'da', 'do', 'para', 'com', 'sem', 'em', 'e',
    'kg', 'g', 'gr', 'l', 'lt', 'ml', 'un', 'und', 'cx', 'pct', 'fardo', 'x']);

const tokens = s => new Set(
    normalize(s).split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)));

const ENV = path.join(os.homedir(), '.gastao-supabase.env');
const m = fs.readFileSync(ENV, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m);
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } });
await client.connect();

try {
    const { rows: ingredients } = await client.query(
        'SELECT id, name FROM ingredients WHERE restaurant_id = $1', [RESTAURANTE_ID]);
    const { rows: itens } = await client.query(
        `SELECT id, descricao_xml FROM nfe_itens
         WHERE restaurante_id = $1 AND insumo_confirmado_id IS NULL`, [RESTAURANTE_ID]);

    console.log(`Insumos cadastrados: ${ingredients.length}`);
    console.log(`Itens de nota a casar: ${itens.length}\n`);
    if (!ingredients.length || !itens.length) process.exit(0);

    const ings = ingredients.map(i => ({ id: i.id, nome: i.name, toks: tokens(i.name) }));
    const achados = [];

    for (const item of itens) {
        const itemToks = tokens(item.descricao_xml ?? '');
        let best = null;
        for (const ing of ings) {
            if (!ing.toks.size) continue;
            let hit = 0;
            for (const t of ing.toks) if (itemToks.has(t)) hit++;
            const cobertura = hit / ing.toks.size;
            const confianca = cobertura === 1 ? (ing.toks.size > 1 ? 0.8 : 0.6)
                            : cobertura >= 0.6 ? 0.5 : 0;
            if (confianca > 0 && (!best || confianca > best.confianca))
                best = { id: ing.id, nome: ing.nome, confianca };
        }
        if (best) achados.push({ itemId: item.id, desc: item.descricao_xml, ...best });
    }

    const porConfianca = achados.reduce((a, x) => (a[x.confianca] = (a[x.confianca] ?? 0) + 1, a), {});
    console.log(`Casados: ${achados.length} de ${itens.length} (${(achados.length / itens.length * 100).toFixed(0)}%)`);
    Object.entries(porConfianca).sort((a, b) => b[0] - a[0])
        .forEach(([c, n]) => console.log(`  confiança ${c}: ${n} itens`));

    console.log(`\nAmostra:`);
    achados.slice(0, 10).forEach(a =>
        console.log(`  ${String(a.desc).slice(0, 42).padEnd(44)} → ${a.nome} (${a.confianca})`));

    if (!APLICAR) {
        console.log(`\nNada gravado. Para aplicar as sugestões: --aplicar\n`);
        process.exit(0);
    }

    await client.query('BEGIN');
    for (const a of achados) {
        await client.query(
            `UPDATE nfe_itens SET insumo_sugerido_id = $1, confianca_match = $2 WHERE id = $3`,
            [a.id, a.confianca, a.itemId]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${achados.length} sugestões gravadas. A confirmação segue sendo humana, na tela de Notas Fiscais.\n`);
} catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro:', err.message);
    process.exitCode = 1;
} finally {
    await client.end();
}
