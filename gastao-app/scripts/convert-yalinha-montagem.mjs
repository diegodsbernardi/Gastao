// Conversor das fichas de MONTAGEM do Yalinha. NÃO substitui nada — adiciona
// as fichas de montagem (produtos do cardápio) por cima dos preparos de
// produção já existentes. Uso:
//   node convert-yalinha-montagem.mjs --parsed <json> [--apply]
// Sem --apply = DRY-RUN. Unidades base do Yalinha: kg / l / un.

import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const REST = '990f40bf-c588-41c1-9d00-d449d55a2599';
const args = process.argv.slice(2);
const PARSED = args[args.indexOf('--parsed')+1];
const APPLY = args.includes('--apply');
const fichas = JSON.parse(fs.readFileSync(PARSED,'utf8'));
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

// Medida da planilha → { unit (kg/l/un), val(qtd) } na unidade base do Yalinha
function conv(qtd, med){
  const q = parseFloat(String(qtd).replace(',','.')) || 0;
  const m = norm(med);
  const semPeso = ['fatias','fatia','folhas','folha',''].includes(m);
  if(['gramas','grama'].includes(m)) return {unit:'kg', val:q/1000, semPeso};
  if(['kilo','kilos','kg'].includes(m)) return {unit:'kg', val:q, semPeso};
  if(['mililitros','ml'].includes(m)) return {unit:'l', val:q/1000, semPeso};
  if(['litros','litro'].includes(m)) return {unit:'l', val:q, semPeso};
  return {unit:'un', val:q, semPeso}; // unidade/fatias/folhas/vazio → un
}

const DB_URL = fs.readFileSync(path.join(os.homedir(),'.gastao-supabase.env'),'utf8').match(/^SUPABASE_DB_URL=(.+)$/m)[1].trim();
const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: DB_URL, ssl:{ rejectUnauthorized:false } });
await c.connect();

const ings = (await c.query('SELECT id, name, unit_type FROM ingredients WHERE restaurant_id=$1',[REST])).rows;
const recs = (await c.query('SELECT id, product_name, tipo FROM recipes WHERE restaurant_id=$1',[REST])).rows;
const ingByName = new Map(ings.map(r=>[norm(r.name), r]));
const recByName = new Map(recs.map(r=>[norm(r.product_name), r]));
const novos = new Map(); // norm → {nome, unit}

// planeja insumos novos (unidade = a mais comum entre as medidas dele nas fichas)
for(const f of fichas){
  for(const ing of f.ings){
    const ni = norm(ing.nome);
    if(recByName.has(ni) || ingByName.has(ni)) continue;
    const u = conv(ing.qtd, ing.med).unit;
    if(!novos.has(ni)) novos.set(ni, {nome:ing.nome.trim(), unit:u});
  }
}

const stats = { fichas:0, pulou:0, novos:novos.size, vPrep:0, vIns:0, vNovo:0, semPeso:0, conflitoUnid:0 };

async function run(){
  if(APPLY) await c.query('BEGIN');
  // 1. cria insumos novos
  const novoId = new Map();
  for(const [ni, info] of novos){
    if(APPLY){
      const r = await c.query(
        "INSERT INTO ingredients (restaurant_id, name, tipo, unit_type, use_in_recipes) VALUES ($1,$2,'insumo_base',$3,true) RETURNING id",
        [REST, info.nome, info.unit]);
      novoId.set(ni, r.rows[0].id);
    }
  }
  // 2. cria fichas + vínculos
  for(const f of fichas){
    const nf = norm(f.aba);
    const ja = recByName.get(nf);
    if(ja && ja.tipo==='ficha_final'){ stats.pulou++; continue; }
    stats.fichas++;
    let fichaId = null;
    if(APPLY){
      const r = await c.query(
        "INSERT INTO recipes (restaurant_id, product_name, tipo, yield_quantity, category) VALUES ($1,$2,'ficha_final',1,'Montagem') RETURNING id",
        [REST, f.aba.trim()]);
      fichaId = r.rows[0].id;
    }
    for(const ing of f.ings){
      const ni = norm(ing.nome);
      const cv = conv(ing.qtd, ing.med);
      if(cv.semPeso) stats.semPeso++;
      const prep = recByName.get(ni);
      const insu = ingByName.get(ni);
      if(prep){
        stats.vPrep++;
        if(APPLY) await c.query('INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity_needed) VALUES ($1,$2,$3)',[fichaId, prep.id, cv.val]);
      } else {
        const target = insu || {id: novoId.get(ni), unit_type: novos.get(ni)?.unit};
        if(insu) stats.vIns++; else stats.vNovo++;
        // se a unidade do insumo existente difere da derivada, converte simples ou flaga
        let qty = cv.val;
        if(insu && insu.unit_type !== cv.unit) { stats.conflitoUnid++; } // mantém val; unidade a revisar
        if(APPLY) await c.query('INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_needed) VALUES ($1,$2,$3)',[fichaId, target.id, qty]);
      }
    }
  }
  if(APPLY) await c.query('COMMIT');
}

try { await run(); }
catch(e){ if(APPLY) await c.query('ROLLBACK'); console.error('ERRO (rollback):', e.message); await c.end(); process.exit(1); }

console.log((APPLY?'✅ APLICADO':'DRY-RUN')+':');
console.log('  fichas de montagem criadas:', stats.fichas, '| puladas (já existem):', stats.pulou);
console.log('  insumos novos criados:', stats.novos);
console.log('  vínculos → preparo:', stats.vPrep, '| insumo existente:', stats.vIns, '| insumo novo:', stats.vNovo);
console.log('  ⚠ linhas sem peso (fatia/folha):', stats.semPeso, '| unidade a revisar:', stats.conflitoUnid);
await c.end();
