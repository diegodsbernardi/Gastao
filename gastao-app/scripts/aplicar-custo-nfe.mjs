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
    // "10X1KG" = 10 pacotes de 1 kg. Devolve o fator em quilos, e a conversão
    // kg→g cuida do resto. Padrão inequívoco em arroz, feijão e açúcar.
    if ((m = d.match(/\b(\d{1,3})\s*X\s*([\d.,]+)\s*KG\b/)))
        return { fator: +m[1] * parseFloat(m[2].replace(',', '.')), via: `${m[1]}x${m[2]}kg`, unidade: 'kg' };
    if ((m = d.match(/C\/\s*(\d{1,3})\b/)))        return { fator: +m[1], via: `C/${m[1]}` };
    if ((m = d.match(/\bLT\s*(\d{1,3})\b/)))       return { fator: +m[1], via: `LT${m[1]}` };
    if ((m = d.match(/\b(\d{1,3})\s*U\b/)))        return { fator: +m[1], via: `${m[1]}U` };
    if ((m = d.match(/\b(\d{1,3})\s*PACK\b/)))     return { fator: +m[1], via: `${m[1]} PACK` };
    if (/\bFOUR\s*PACK\b/.test(d))                 return { fator: 4, via: 'FOUR PACK' };
    if (/\bSIX\s*PACK\b/.test(d))                  return { fator: 6, via: 'SIX PACK' };
    if (/\bFARDO\b/.test(d) && (m = d.match(/\b(\d{1,3})\b/))) return { fator: +m[1], via: `FARDO ${m[1]}` };
    return null;
}

// Converte a unidade da NOTA para a unidade do INSUMO. Fornecedor fatura em kg
// e a ficha usa grama: sem isso a picanha entra a R$ 77,90 POR GRAMA. Retorna
// null quando a conversão não é segura (ex.: nota em "un", insumo em "g" — não
// dá pra saber quanto pesa a unidade).
function fatorUnidade(unNota, unInsumo) {
    const a = String(unNota ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const b = String(unInsumo ?? '').toLowerCase();
    const peso = { kg: 1000, g: 1, kilo: 1000, quilo: 1000 };
    const vol  = { l: 1000, lt: 1000, litro: 1000, ml: 1 };
    if (peso[a] && peso[b]) return peso[a] / peso[b];
    if (vol[a] && vol[b])   return vol[a] / vol[b];
    const cont = ['un', 'und', 'unid', 'pc', 'pct', 'cx', 'fd', 'fardo', 'pack', 'dz'];
    if (cont.includes(a) && (b === 'un' || cont.includes(b))) return 1;
    return null;   // incompatível: não aplica
}

// Quanto a embalagem FATURADA contém, na unidade do insumo.
//
// As descrições de NF-e seguem "peso unitário (embalagem coletiva)":
//   "REQUEIJAO ... 1,5 KG (CX 12 BIS)"   faturado em BIS  → 1,5 kg
//   "FARINHA ... 5 KG (FDO 25 KG)"       faturado em FD   → 25 kg
//   "LEITE ... 1 L (CX 12 UN)"           faturado em CX   → 12 L
//   "PAO ... 42G CX 48 UNID"             faturado em CX, insumo em un → 48 un
//
// A unidade da nota decide qual das duas vale: BIS/PC/PCT/UN/GL são a
// embalagem individual; CX/FD/FDO são a coletiva. Sem peso declarado
// (hortifruti tipo "COUVE MANTEIGA" em maço) devolve null e o item é recusado —
// não dá pra adivinhar quanto pesa um maço.
function conteudoDaEmbalagem(desc, unNota, unInsumo) {
    const d = String(desc).toUpperCase().replace(',', '.').replace(/(\d),(\d)/g, '$1.$2');
    const un = String(unNota ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const alvo = String(unInsumo ?? '').toLowerCase();

    // massa/volume declarados no texto → converte pra unidade do insumo
    const pesoEm = (txt) => {
        const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(KG|G|ML|L)\b/);
        if (!m) return null;
        const v = parseFloat(m[1].replace(',', '.'));
        const u = m[2];
        const emKg = u === 'KG' ? v : u === 'G' ? v / 1000 : null;
        const emL  = u === 'L'  ? v : u === 'ML' ? v / 1000 : null;
        if (['kg', 'g'].includes(alvo) && emKg != null) return alvo === 'kg' ? emKg : emKg * 1000;
        if (['l', 'ml'].includes(alvo) && emL  != null) return alvo === 'l'  ? emL  : emL * 1000;
        return null;
    };

    const abre = d.indexOf('(');
    const fora = abre >= 0 ? d.slice(0, abre) : d;
    const dentro = abre >= 0 ? d.slice(abre) : '';

    const individual = ['BIS', 'PC', 'PCT', 'UN', 'UND', 'UNID', 'GL', 'BLD', 'FR', 'PT'];
    const coletiva = ['CX', 'FD', 'FDO', 'CAIXA', 'FARDO'];

    // insumo contado por unidade: o que importa é quantas peças vêm na caixa.
    // Nota faturada em PESO/VOLUME não serve aqui: não dá pra saber quantas
    // unidades tem 1 kg sem conhecer o peso da peça.
    if (alvo === 'un') {
        if (['KG', 'G', 'L', 'ML'].includes(un)) return null;
        if (coletiva.includes(un)) {
            const m = d.match(/(?:CX|FDO?|C\/)\s*(\d{1,3})\s*(?:UN|UNID|UNIDADES?|PCT|PC)?\b/);
            return m ? +m[1] : null;
        }
        return 1;
    }

    const pesoUnit = pesoEm(fora) ?? pesoEm(d);
    if (individual.includes(un)) return pesoUnit;

    if (coletiva.includes(un)) {
        // o parêntese pode trazer o peso do fardo inteiro ("FDO 25 KG")
        const pesoColetivo = dentro ? pesoEm(dentro) : null;
        if (pesoColetivo && (!pesoUnit || pesoColetivo > pesoUnit)) return pesoColetivo;
        // ou a contagem de peças ("CX 12 UN")
        const m = dentro.match(/(\d{1,3})\s*(?:UN|UNID|PCT|PC|BIS|GL|FR)\b/) || dentro.match(/C\/\s*(\d{1,3})/);
        if (m && pesoUnit) return pesoUnit * +m[1];
        return pesoUnit;
    }
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
               (SELECT r.sale_price FROM recipes r
                  JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                 WHERE ri.ingredient_id = i.id AND r.sale_price > 0
                 ORDER BY r.sale_price LIMIT 1) AS menor_venda,
               (SELECT ri.quantity_needed FROM recipes r
                  JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                 WHERE ri.ingredient_id = i.id AND r.sale_price > 0
                 ORDER BY r.sale_price LIMIT 1) AS qtd_na_ficha
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
        // Quando o fardo já é expresso em quilos ("10X1KG"), o divisor entrega
        // quilos — a unidade que vale para a conversão é kg, não o "FD" da nota.
        let custoUnit = null, viaConteudo = null;
        const fUn = fatorUnidade(emb?.unidade ?? r.unidade, r.unit_type);
        if (fUn !== null) {
            custoUnit = Number(r.valor_unitario) / fator / fUn;
        } else {
            // Unidade da nota é embalagem (BIS, CX, FD...): tenta descobrir o
            // conteúdo pela descrição antes de desistir.
            const conteudo = conteudoDaEmbalagem(r.descricao_xml, r.unidade, r.unit_type);
            if (!conteudo || conteudo <= 0) {
                pulados.push({ ...r, motivo: `nota em "${r.unidade}" e insumo em "${r.unit_type}", e a descrição não declara o conteúdo` });
                continue;
            }
            custoUnit = Number(r.valor_unitario) / conteudo;
            viaConteudo = `${r.unidade}=${conteudo}${r.unit_type}`;
        }
        const venda = r.menor_venda ? Number(r.menor_venda) : null;
        const qtdFicha = r.qtd_na_ficha ? Number(r.qtd_na_ficha) : 1;
        const custoAtual = Number(r.custo_atual) || 0;

        // O custo NA FICHA é o que importa: comparar o preço de 1 grama com o
        // preço do prato não pega erro de unidade nenhum.
        if (venda && custoUnit * qtdFicha >= venda) {
            pulados.push({ ...r, motivo: `${qtdFicha} ${r.unit_type} custariam R$ ${(custoUnit * qtdFicha).toFixed(2)} num prato de R$ ${venda.toFixed(2)}` });
            continue;
        }
        // Salto grande contra o custo da planilha do cliente é erro de leitura,
        // não variação de mercado.
        if (custoAtual > 0) {
            const salto = custoUnit > custoAtual ? custoUnit / custoAtual : custoAtual / custoUnit;
            if (salto > 5) {
                pulados.push({ ...r, motivo: `custo saltaria ${salto.toFixed(0)}x (R$ ${custoAtual.toFixed(4)} → R$ ${custoUnit.toFixed(4)})` });
                continue;
            }
        }
        aplicar.push({ ...r, fator, via: viaConteudo ?? emb?.via ?? (fUn !== 1 ? `${r.unidade}→${r.unit_type}` : 'unidade'), custoUnit, venda, qtdFicha });
    }

    console.log(`\n═══ ${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — custo de NF-e (tipo: ${TIPO}) ═══\n`);
    console.log(`Insumo                 de        para      fardo        CMV depois`);
    for (const a of aplicar) {
        const cmv = a.venda ? `${(a.custoUnit * a.qtdFicha / a.venda * 100).toFixed(0)}%` : '—';
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
