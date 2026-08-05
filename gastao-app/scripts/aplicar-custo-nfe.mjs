#!/usr/bin/env node
// Aplica o custo de itens de NF-e nos insumos, convertendo caixa → unidade.
//
// O PROBLEMA: distribuidora de bebida vende em CX e a NF-e traz o valor da
// caixa. Aplicar direto põe a Coca-Cola a R$ 32,89 a lata (CMV de 400%). O
// fardo está escrito na descrição — "COCA COLA LT12", "SPRITE ... C/24",
// "RED BULL ... FOUR PACK" — e é de lá que sai o divisor.
//
// TRAVAS (nesta ordem, e nenhuma é opcional):
//   1. só aplica quando o fardo é explícito na descrição;
//   2. o custo unitário resultante precisa ficar ABAIXO do preço de venda da
//      ficha que usa o insumo — custo maior que preço é erro de leitura, não
//      margem negativa real;
//   3. usa sempre a nota MAIS RECENTE de cada insumo.
//
// Uso:
//   node scripts/aplicar-custo-nfe.mjs <restaurante_id> [--tipo insumo_direto]
//   node scripts/aplicar-custo-nfe.mjs <restaurante_id> --aplicar

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RESTAURANTE_ID = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');
const iTipo = process.argv.indexOf('--tipo');
const TIPO = iTipo >= 0 ? process.argv[iTipo + 1] : 'insumo_direto';

if (!RESTAURANTE_ID) {
    console.error('Uso: node scripts/aplicar-custo-nfe.mjs <restaurante_id> [--tipo X] [--aplicar]');
    process.exit(2);
}

// Extrai quantas unidades vêm na embalagem, a partir da descrição da NF-e.
// Retorna null quando não dá pra afirmar — e aí o item não é aplicado.
function unidadesPorEmbalagem(desc) {
    const d = String(desc).toUpperCase();
    let m;
    if ((m = d.match(/C\/\s*(\d{1,3})\b/)))        return { fator: +m[1], via: `C/${m[1]}` };
    if ((m = d.match(/\bLT\s*(\d{1,3})\b/)))       return { fator: +m[1], via: `LT${m[1]}` };
    if ((m = d.match(/\b(\d{1,3})\s*U\b/)))        return { fator: +m[1], via: `${m[1]}U` };
    if ((m = d.match(/\b(\d{1,3})\s*PACK\b/)))     return { fator: +m[1], via: `${m[1]} PACK` };
    if (/\bFOUR\s*PACK\b/.test(d))                 return { fator: 4, via: 'FOUR PACK' };
    if (/\bSIX\s*PACK\b/.test(d))                  return { fator: 6, via: 'SIX PACK' };
    if (/\bFARDO\b/.test(d) && (m = d.match(/\b(\d{1,3})\b/))) return { fator: +m[1], via: `FARDO ${m[1]}` };
    return null;
}

const ENV = path.join(os.homedir(), '.gastao-supabase.env');
const m = fs.readFileSync(ENV, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m);
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } });
await client.connect();

try {
    // nota mais recente por insumo sugerido
    const { rows } = await client.query(`
        SELECT DISTINCT ON (i.id)
               i.id, i.name, i.unit_type, i.avg_cost_per_unit AS custo_atual,
               ni.id AS item_id, ni.descricao_xml, ni.unidade, ni.quantidade, ni.valor_unitario,
               nf.data_emissao, nf.fornecedor_nome,
               (SELECT MIN(r.sale_price) FROM recipes r
                  JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                 WHERE ri.ingredient_id = i.id AND r.sale_price > 0) AS menor_venda
          FROM nfe_itens ni
          JOIN ingredients i ON i.id = ni.insumo_sugerido_id
          JOIN notas_fiscais nf ON nf.id = ni.nota_fiscal_id
         WHERE ni.restaurante_id = $1 AND i.tipo = $2 AND ni.valor_unitario > 0
         ORDER BY i.id, nf.data_emissao DESC NULLS LAST`,
        [RESTAURANTE_ID, TIPO]);

    const aplicar = [], pulados = [];
    for (const r of rows) {
        const emb = unidadesPorEmbalagem(r.descricao_xml);
        const un = String(r.unidade ?? '').toUpperCase();
        const ehCaixa = /^(CX|FD|FARDO|PCT|PACK)/.test(un);

        if (ehCaixa && !emb) {
            pulados.push({ ...r, motivo: `comprado em ${un} mas a descrição não diz quantas unidades` });
            continue;
        }
        const fator = emb?.fator ?? 1;
        const custoUnit = Number(r.valor_unitario) / fator;
        const venda = r.menor_venda ? Number(r.menor_venda) : null;

        if (venda && custoUnit >= venda) {
            pulados.push({ ...r, motivo: `custo R$ ${custoUnit.toFixed(2)} ficaria acima do preço de venda R$ ${venda.toFixed(2)}` });
            continue;
        }
        aplicar.push({ ...r, fator, via: emb?.via ?? 'unidade', custoUnit, venda });
    }

    console.log(`\n═══ ${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — custo de NF-e (tipo: ${TIPO}) ═══\n`);
    console.log(`Insumo                 de        para      fardo        CMV depois`);
    for (const a of aplicar) {
        const cmv = a.venda ? `${(a.custoUnit / a.venda * 100).toFixed(0)}%` : '—';
        console.log(`  ${a.name.padEnd(20)} R$ ${String(Number(a.custo_atual).toFixed(2)).padStart(6)}  ` +
                    `R$ ${a.custoUnit.toFixed(2).padStart(6)}  ${a.via.padEnd(10)} ${cmv.padStart(5)}`);
    }
    if (pulados.length) {
        console.log(`\nNão aplicados (${pulados.length}):`);
        pulados.forEach(p => console.log(`  ${p.name.padEnd(20)} ${p.motivo}\n    origem: ${String(p.descricao_xml).slice(0, 60)}`));
    }

    if (!APLICAR) {
        console.log(`\nNada gravado. Para aplicar: --aplicar\n`);
        process.exit(0);
    }

    await client.query('BEGIN');
    for (const a of aplicar) {
        await client.query(
            `UPDATE ingredients SET cost_per_unit = $1, avg_cost_per_unit = $1 WHERE id = $2`,
            [Number(a.custoUnit.toFixed(6)), a.id]);
        await client.query(
            `UPDATE nfe_itens SET insumo_confirmado_id = $1, custo_aplicado_em = now(), status = 'confirmado'
             WHERE id = $2`,
            [a.id, a.item_id]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${aplicar.length} insumos atualizados a partir da nota mais recente.\n`);
} catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro:', err.message);
    process.exitCode = 1;
} finally {
    await client.end();
}
