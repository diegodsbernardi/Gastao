#!/usr/bin/env node
// Relatório quinzenal do Gastão — o que andou no produto e nos clientes.
//
// Existe porque "manter o projeto vivo" não pode depender de alguém lembrar de
// escrever. Roda de cron, lê o banco e o git, e cospe um resumo pronto pra colar
// no grupo dos sócios.
//
// Uso:
//   node scripts/relatorio-quinzenal.mjs                  # últimos 15 dias, texto
//   node scripts/relatorio-quinzenal.mjs --dias 30        # janela custom
//   node scripts/relatorio-quinzenal.mjs --html saida.html
//   node scripts/relatorio-quinzenal.mjs --salvar         # grava em ~/logs/
//
// Lê SUPABASE_DB_URL de ~/.gastao-supabase.env (mesmo arquivo do sb-query.mjs).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (nome, fallback) => {
    const i = args.indexOf(`--${nome}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const DIAS = Number(getArg('dias', 15));
const HTML_OUT = args.includes('--html') ? getArg('html', 'relatorio-gastao.html') : null;
const SALVAR = args.includes('--salvar');

if (!Number.isFinite(DIAS) || DIAS <= 0) {
    console.error('--dias precisa ser um número positivo.');
    process.exit(2);
}

// ─── conexão (mesmo padrão do sb-query.mjs) ──────────────────────────────────
const ENV_PATH = path.join(os.homedir(), '.gastao-supabase.env');
if (!fs.existsSync(ENV_PATH)) {
    console.error('Falta ~/.gastao-supabase.env. Configurar SUPABASE_DB_URL.');
    process.exit(2);
}
const m = fs.readFileSync(ENV_PATH, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m);
if (!m) {
    console.error('SUPABASE_DB_URL não encontrado em ~/.gastao-supabase.env');
    process.exit(2);
}

// Pool (não Client): as métricas rodam em paralelo, e um Client único
// reclama de query concorrente.
const { default: pg } = await import('pg');
const pool = new pg.Pool({
    connectionString: m[1].trim(),
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
    max: 5,
});

const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

try {
    await q('SELECT 1');
} catch (err) {
    console.error('Erro de conexão:', err.code || err.message);
    process.exit(3);
}

// ─── formatação ──────────────────────────────────────────────────────────────
const fmtMoney = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const n = v => Number(v) || 0;

const hoje = new Date();
const inicio = new Date(hoje.getTime() - DIAS * 24 * 60 * 60 * 1000);
const periodoLabel = `${fmtData(inicio)} a ${fmtData(hoje)}`;

// ─── coleta ──────────────────────────────────────────────────────────────────
// Uma query por métrica, agregando por restaurante. Preferi várias queries
// simples a um monstro com 8 LEFT JOINs: cada uma é legível e depurável isolada,
// e o volume é pequeno (dezenas de linhas).
const desde = inicio.toISOString();

const [restaurantes, notas, fichasNovas, insumosNovos, vendas, checklists, feedbacks, alertas, cmvAtual, custosAplicados, qualidadeCusto] =
    await Promise.all([
        q(`SELECT r.id, r.nome, r.plano, b.nome AS bpo
           FROM restaurantes r LEFT JOIN bpos b ON b.id = r.bpo_id
           ORDER BY r.nome`),

        q(`SELECT restaurante_id AS rid, COUNT(*)::int AS qtd, COALESCE(SUM(valor_total), 0) AS valor
           FROM notas_fiscais WHERE criado_em >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurant_id AS rid,
                  COUNT(*) FILTER (WHERE tipo = 'ficha_final')::int AS fichas,
                  COUNT(*) FILTER (WHERE tipo = 'preparo')::int     AS preparos
           FROM recipes WHERE created_at >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurant_id AS rid, COUNT(*)::int AS qtd
           FROM ingredients WHERE created_at >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurant_id AS rid, COUNT(*)::int AS qtd, COALESCE(SUM(total_value), 0) AS valor
           FROM sales WHERE sold_at >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurant_id AS rid, COUNT(*)::int AS qtd
           FROM checklist_runs WHERE concluido_em >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurant_id AS rid, COUNT(*)::int AS qtd
           FROM feedbacks WHERE criado_em >= $1 GROUP BY 1`, [desde]),

        q(`SELECT restaurante_id AS rid, COUNT(*)::int AS qtd,
                  COUNT(*) FILTER (WHERE status = 'pendente')::int AS pendentes
           FROM cmv_alertas WHERE criado_em >= $1 GROUP BY 1`, [desde]),

        // Insumos das receitas + sub-receitas: o CMV é calculado em JS logo abaixo,
        // porque precisa resolver a árvore Insumo → Preparo → Ficha. Somar só
        // recipe_ingredients daria um CMV falso pra baixo (ignora todo preparo).
        q(`SELECT r.id, r.restaurant_id AS rid, r.tipo, r.sale_price, r.yield_quantity
           FROM recipes r`),

        q(`SELECT restaurante_id AS rid, COUNT(*)::int AS qtd
           FROM nfe_itens WHERE custo_aplicado_em >= $1 GROUP BY 1`, [desde]),

        // Confiabilidade do CMV: insumo com custo zero entra na conta como grátis
        // e puxa o CMV pra baixo. Sem esse número, o CMV vira ficção com aparência
        // de precisão — o pior tipo de dado pra levar numa reunião.
        q(`SELECT restaurant_id AS rid, COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE COALESCE(avg_cost_per_unit, 0) = 0)::int AS sem_custo
           FROM ingredients GROUP BY 1`),
    ]);

// Dados de composição pro cálculo de CMV (fora do Promise.all: volume maior)
const [compIngs, compSubs, ultimaAtividade] = await Promise.all([
    q(`SELECT ri.recipe_id, ri.quantity_needed,
              i.avg_cost_per_unit, COALESCE(NULLIF(i.aproveitamento, 0), 1) AS aproveitamento
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id`),
    q(`SELECT recipe_id, sub_recipe_id, quantity_needed FROM recipe_sub_recipes
       UNION ALL
       SELECT recipe_id, sub_recipe_id, quantity_needed FROM recipe_ingredients
       WHERE sub_recipe_id IS NOT NULL`),
    // Sinal de vida por área — responde "o produto está sendo usado?"
    q(`SELECT 'Notas fiscais' AS area, MAX(criado_em)  AS ultima FROM notas_fiscais
       UNION ALL SELECT 'Fichas e preparos', MAX(created_at)   FROM recipes
       UNION ALL SELECT 'Insumos',           MAX(created_at)   FROM ingredients
       UNION ALL SELECT 'Vendas',            MAX(sold_at)      FROM sales
       UNION ALL SELECT 'Checklists',        MAX(concluido_em) FROM checklist_runs
       UNION ALL SELECT 'Feedbacks',         MAX(criado_em)    FROM feedbacks
       UNION ALL SELECT 'Custo via nota',    MAX(custo_aplicado_em) FROM nfe_itens`),
]);

await pool.end();

// ─── CMV por restaurante (mesma lógica da tela de Fichas) ────────────────────
// Custo de uma receita = insumos diretos + sub-receitas resolvidas.
// Múltiplas passadas resolvem dependências encadeadas (preparo dentro de preparo);
// 5 passadas com corte é o mesmo limite que o app usa.
const ingsPorReceita = {};
compIngs.forEach(r => (ingsPorReceita[r.recipe_id] ??= []).push(r));
const subsPorReceita = {};
compSubs.forEach(r => (subsPorReceita[r.recipe_id] ??= []).push(r));

const custoDe = {};
const rendimento = Object.fromEntries(cmvAtual.map(r => [r.id, n(r.yield_quantity) || 1]));
for (let passe = 0; passe < 5; passe++) {
    for (const rec of cmvAtual) {
        const ing = (ingsPorReceita[rec.id] ?? []).reduce(
            (a, i) => a + (n(i.avg_cost_per_unit) / n(i.aproveitamento)) * n(i.quantity_needed), 0);
        const sub = (subsPorReceita[rec.id] ?? []).reduce(
            (a, s) => a + (n(custoDe[s.sub_recipe_id]) / (rendimento[s.sub_recipe_id] || 1)) * n(s.quantity_needed), 0);
        custoDe[rec.id] = ing + sub;
    }
}

const cmvPorRestaurante = {};
for (const rec of cmvAtual) {
    if (rec.tipo !== 'ficha_final' || n(rec.sale_price) <= 0) continue;
    const custo = n(custoDe[rec.id]);
    if (custo <= 0) continue;
    (cmvPorRestaurante[rec.rid] ??= []).push(custo / n(rec.sale_price) * 100);
}
const iCmv = Object.fromEntries(Object.entries(cmvPorRestaurante).map(([rid, lista]) => [rid, {
    fichas_com_custo: lista.length,
    cmv_medio: (lista.reduce((a, b) => a + b, 0) / lista.length).toFixed(1),
}]));

// indexa por restaurante
const idx = (rows, campo = 'rid') => Object.fromEntries(rows.map(r => [r[campo], r]));
const iNotas = idx(notas), iFichas = idx(fichasNovas), iInsumos = idx(insumosNovos),
      iVendas = idx(vendas), iCheck = idx(checklists), iFeed = idx(feedbacks),
      iAlertas = idx(alertas), iCustos = idx(custosAplicados), iQual = idx(qualidadeCusto);

// ─── git: o que foi construído no período ────────────────────────────────────
let commits = [];
try {
    const raw = execSync(
        `git log --since="${DIAS} days ago" --no-merges --pretty=format:%s -- gastao-app/`,
        { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' }
    );
    commits = raw.split('\n').map(s => s.trim()).filter(Boolean);
} catch {
    commits = []; // sem git no ambiente do cron: segue sem essa seção
}

// Só o que interessa pro sócio: feature e fix. Refactor/chore não entram —
// ninguém que não escreve código quer saber de renomeação de variável.
const relevantes = commits.filter(c => /^(feat|fix)/i.test(c));
const featuresTxt = relevantes
    .map(c => c.replace(/^(feat|fix)(\([^)]*\))?:\s*/i, (mm, tipo) => (tipo.toLowerCase() === 'fix' ? '🔧 ' : '✨ ')))
    .map(c => c.charAt(0).toUpperCase() + c.slice(1));

// ─── monta o relatório ───────────────────────────────────────────────────────
const ativos = restaurantes.filter(r => {
    const id = r.id;
    return n(iNotas[id]?.qtd) + n(iFichas[id]?.fichas) + n(iFichas[id]?.preparos) +
           n(iInsumos[id]?.qtd) + n(iVendas[id]?.qtd) + n(iCheck[id]?.qtd) + n(iFeed[id]?.qtd) > 0;
});

const totalNotas = notas.reduce((a, r) => a + n(r.qtd), 0);
const totalValorNotas = notas.reduce((a, r) => a + n(r.valor), 0);
const totalFichas = fichasNovas.reduce((a, r) => a + n(r.fichas) + n(r.preparos), 0);
const totalCustos = custosAplicados.reduce((a, r) => a + n(r.qtd), 0);

const L = [];
L.push(`*GASTÃO — Relatório de ${DIAS} dias*`);
L.push(`_${periodoLabel}_`);
L.push('');
L.push(`*Resumo*`);
L.push(`• ${ativos.length} de ${restaurantes.length} restaurantes com movimento`);
L.push(`• ${totalNotas} notas fiscais importadas (${fmtMoney(totalValorNotas)} em compras)`);
L.push(`• ${totalCustos} custos de insumo atualizados via nota`);
L.push(`• ${totalFichas} fichas/preparos novos cadastrados`);
if (featuresTxt.length) L.push(`• ${featuresTxt.length} ${featuresTxt.length === 1 ? 'entrega' : 'entregas'} no produto`);
L.push('');

// ─── Sinal de vida: o produto está sendo usado? ──────────────────────────────
// Seção mais importante do relatório. Feature entregue e não usada é custo, não
// ativo — e sem isso o relatório mostra só o que NÓS fizemos, nunca o que eles fazem.
const diasDesde = d => (d ? Math.floor((hoje - new Date(d)) / 86400000) : null);
const usoLinhas = ultimaAtividade
    .map(a => ({ ...a, dias: diasDesde(a.ultima) }))
    .sort((a, b) => (a.dias ?? 9e9) - (b.dias ?? 9e9));

L.push(`*Uso do sistema*`);
for (const a of usoLinhas) {
    if (a.dias === null)      L.push(`  ⚫ ${a.area}: nunca usado`);
    else if (a.dias <= DIAS)  L.push(`  🟢 ${a.area}: há ${a.dias} dia(s)`);
    else                      L.push(`  🔴 ${a.area}: parado há ${a.dias} dias`);
}
L.push('');

L.push(`*Por restaurante*`);
for (const r of restaurantes) {
    const id = r.id;
    const partes = [];
    if (n(iNotas[id]?.qtd))    partes.push(`${iNotas[id].qtd} notas (${fmtMoney(iNotas[id].valor)})`);
    if (n(iCustos[id]?.qtd))   partes.push(`${iCustos[id].qtd} custos atualizados`);
    if (n(iFichas[id]?.fichas))   partes.push(`${iFichas[id].fichas} fichas novas`);
    if (n(iFichas[id]?.preparos)) partes.push(`${iFichas[id].preparos} preparos novos`);
    if (n(iInsumos[id]?.qtd))  partes.push(`${iInsumos[id].qtd} insumos novos`);
    if (n(iVendas[id]?.qtd))   partes.push(`${iVendas[id].qtd} vendas (${fmtMoney(iVendas[id].valor)})`);
    if (n(iCheck[id]?.qtd))    partes.push(`${iCheck[id].qtd} checklists`);
    if (n(iFeed[id]?.qtd))     partes.push(`${iFeed[id].qtd} feedbacks`);

    const cmv = iCmv[id];
    const qual = iQual[id];
    // CMV só é confiável se os insumos tiverem custo. Acima de 10% sem custo,
    // marca o número como subestimado em vez de deixar passar como verdade.
    const pctSemCusto = qual && n(qual.total) ? Math.round(100 * n(qual.sem_custo) / n(qual.total)) : 0;
    const ressalva = pctSemCusto > 10 ? ` (⚠️ subestimado: ${pctSemCusto}% dos insumos sem custo)` : '';
    const cmvTxt = cmv?.cmv_medio ? ` · CMV médio ${cmv.cmv_medio}% em ${cmv.fichas_com_custo} fichas${ressalva}` : '';
    const alerta = n(iAlertas[id]?.pendentes) ? ` · ⚠️ ${iAlertas[id].pendentes} alertas de CMV a revisar` : '';

    L.push(`*${r.nome}*${r.bpo ? ` (${r.bpo})` : ''}`);
    L.push(partes.length ? `  ${partes.join(' · ')}${cmvTxt}${alerta}` : `  sem movimento no período${cmvTxt}`);
}
L.push('');

if (featuresTxt.length) {
    L.push(`*O que foi entregue no produto*`);
    featuresTxt.slice(0, 20).forEach(c => L.push(`  ${c}`));
    if (featuresTxt.length > 20) L.push(`  _...e mais ${featuresTxt.length - 20}_`);
    L.push('');
}

// Pontos que pedem decisão — a seção que transforma relatório em pauta de reunião
const pendencias = [];
const alertasPendentes = alertas.reduce((a, r) => a + n(r.pendentes), 0);
if (alertasPendentes) pendencias.push(`${alertasPendentes} alertas de CMV aguardando revisão de alguém`);
const semMovimento = restaurantes.length - ativos.length;
if (semMovimento > 0) {
    const nomes = restaurantes.filter(r => !ativos.includes(r)).map(r => r.nome).join(', ');
    pendencias.push(`${semMovimento} restaurante(s) sem nenhum movimento: ${nomes}`);
}
const semCmv = restaurantes.filter(r => !iCmv[r.id]).map(r => r.nome);
if (semCmv.length) pendencias.push(`sem CMV calculável (falta preço de venda ou composição): ${semCmv.join(', ')}`);
const nuncaUsadas = usoLinhas.filter(a => a.dias === null).map(a => a.area);
if (nuncaUsadas.length) pendencias.push(`funcionalidades entregues e nunca usadas: ${nuncaUsadas.join(', ')}`);

if (pendencias.length) {
    L.push(`*Precisa de decisão*`);
    pendencias.forEach(p => L.push(`  • ${p}`));
    L.push('');
}

const texto = L.join('\n');
console.log(texto);

// ─── saídas opcionais ────────────────────────────────────────────────────────
if (SALVAR) {
    const dir = path.join(os.homedir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const arq = path.join(dir, `gastao-relatorio-${hoje.toISOString().slice(0, 10)}.txt`);
    fs.writeFileSync(arq, texto);
    console.error(`\n[salvo em ${arq}]`);
}

if (HTML_OUT) {
    // HTML na identidade da marca — pra imprimir/anexar quando o WhatsApp não serve
    const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const corpo = texto
        .split('\n')
        .map(linha => {
            if (!linha.trim()) return '';
            const bold = esc(linha).replace(/\*(.+?)\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>');
            if (linha.startsWith('*') && linha.endsWith('*')) return `<h2>${bold.replace(/<\/?strong>/g, '')}</h2>`;
            return `<p>${bold}</p>`;
        })
        .join('\n');
    const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Gastão — Relatório ${periodoLabel}</title>
<style>
  body { font-family: 'Poppins', system-ui, sans-serif; background: #FAF6EE; color: #2C2C2C;
         max-width: 70ch; margin: 0 auto; padding: 3rem 1.5rem; line-height: 1.6; }
  h1 { color: #FF6B35; font-size: 1.8rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; padding-bottom: .3rem;
       border-bottom: 2px solid #FFE2D1; color: #BF4A1A; }
  p { margin: .3rem 0; }
  .periodo { color: #6B6B6B; margin-bottom: 2rem; }
</style></head><body>
<h1>Gastão</h1><p class="periodo">Relatório de ${DIAS} dias · ${periodoLabel}</p>
${corpo}
</body></html>`;
    fs.writeFileSync(HTML_OUT, html);
    console.error(`\n[HTML em ${HTML_OUT}]`);
}
