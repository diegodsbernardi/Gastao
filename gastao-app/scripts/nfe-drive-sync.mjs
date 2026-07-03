// Robô da ponte Google Drive → Gastão (NF-e).
//
// Para cada restaurante ativo em nfe_drive_sync, varre a pasta "NotasEntrada"
// no Drive, baixa XMLs novos (dedup por chave de acesso), parseia e faz match
// via edge functions existentes e grava a nota como 'pendente' (origem 'drive').
// A confirmação (estoque/custo) continua 100% humana, na UI.
//
// Uso:
//   node scripts/nfe-drive-sync.mjs                  # rodada normal (cron)
//   node scripts/nfe-drive-sync.mjs --dry-run        # não grava nada
//   node scripts/nfe-drive-sync.mjs --test-xml f.xml --restaurante <uuid>
//                                                    # testa o pipeline sem Drive
//
// Credenciais (nunca commitar):
//   ~/.gastao-supabase.env      → SUPABASE_DB_URL (já usada pelo sb-query)
//   ~/.gastao-google-sa.json    → chave da service account do Google
//                                 (Drive API, papel de leitor nas pastas)
//   gastao-app/.env.local       → VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
//                                 (edge functions aceitam a anon key)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // gastao-app/
const SA_KEY_FILE = path.join(os.homedir(), '.gastao-google-sa.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TEST_XML = args.includes('--test-xml') ? args[args.indexOf('--test-xml') + 1] : null;
const TEST_RESTAURANTE = args.includes('--restaurante') ? args[args.indexOf('--restaurante') + 1] : null;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Env ─────────────────────────────────────────────────────────────────────

function readEnvFile(file) {
    if (!fs.existsSync(file)) return {};
    const out = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

const homeEnv = readEnvFile(path.join(os.homedir(), '.gastao-supabase.env'));
const appEnv = readEnvFile(path.join(APP_DIR, '.env.local'));

const DB_URL = homeEnv.SUPABASE_DB_URL;
const SUPABASE_URL = homeEnv.SUPABASE_URL ?? appEnv.VITE_SUPABASE_URL;
const ANON_KEY = homeEnv.SUPABASE_ANON_KEY ?? appEnv.VITE_SUPABASE_ANON_KEY;

if (!DB_URL || !SUPABASE_URL || !ANON_KEY) {
    console.error('Faltam credenciais: SUPABASE_DB_URL (~/.gastao-supabase.env) e VITE_SUPABASE_URL/ANON_KEY (.env.local).');
    process.exit(2);
}

// ── Google (service account → access token, sem dependências) ───────────────

async function googleAccessToken() {
    if (!fs.existsSync(SA_KEY_FILE)) {
        log(`Google service account ainda não configurada (${SA_KEY_FILE} não existe). Nada a fazer.`);
        return null;
    }
    const sa = JSON.parse(fs.readFileSync(SA_KEY_FILE, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    })}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${signature}`,
        }),
    });
    if (!res.ok) throw new Error(`Google auth falhou (${res.status}): ${await res.text()}`);
    return (await res.json()).access_token;
}

async function driveList(token, folderId) {
    // Lista XMLs da pasta; desce 1 nível em subpastas (ex.: organização por mês).
    const files = [];
    const queue = [{ id: folderId, depth: 0 }];
    while (queue.length) {
        const { id, depth } = queue.shift();
        let pageToken = '';
        do {
            const params = new URLSearchParams({
                q: `'${id}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name, mimeType)',
                pageSize: '1000',
            });
            if (pageToken) params.set('pageToken', pageToken);
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`Drive list falhou (${res.status}): ${await res.text()}`);
            const data = await res.json();
            for (const f of data.files ?? []) {
                if (f.mimeType === 'application/vnd.google-apps.folder') {
                    if (depth < 2) queue.push({ id: f.id, depth: depth + 1 });
                } else if (/\.xml$/i.test(f.name)) {
                    files.push(f);
                }
            }
            pageToken = data.nextPageToken ?? '';
        } while (pageToken);
    }
    return files;
}

async function driveDownload(token, fileId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive download falhou (${res.status})`);
    return res.text();
}

// ── Pipeline NF-e (mesmos passos do upload manual em src/lib/nfe.ts) ────────

const chaveFrom = (s) => s?.match(/NFe(\d{44})/)?.[1] ?? null;
const onlyDigits = (s) => (s ?? '').replace(/\D/g, '');

async function parseNfe(xml) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-nfe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/xml' },
        body: xml,
    });
    if (!res.ok) throw new Error(`parse-nfe ${res.status}: ${(await res.json().catch(() => ({}))).error ?? 'erro'}`);
    return res.json(); // { nota, itens }
}

// Match local por similaridade de palavras (a edge function match-nfe-items usa
// o JWT do chamador pra ler ingredients via RLS — com anon key vem vazio, então
// aqui o robô lê os insumos direto do Postgres e sugere por overlap de tokens).
// É sugestão conservadora; quem bate o martelo é o humano na UI, como sempre.

const normalize = (s) => s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')     // sem acento
    .replace(/[^a-z0-9 ]/g, ' ');

const STOPWORDS = new Set(['de', 'da', 'do', 'para', 'com', 'sem', 'em', 'e',
    'kg', 'g', 'gr', 'l', 'lt', 'ml', 'un', 'und', 'cx', 'pct', 'fardo', 'x']);

const tokens = (s) => new Set(
    normalize(s).split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)),
);

async function matchItens(pg, itens, restauranteId) {
    const { rows: ingredients } = await pg.query(
        'SELECT id, name FROM ingredients WHERE restaurant_id = $1',
        [restauranteId],
    );
    if (ingredients.length === 0) return [];

    const ings = ingredients.map((ing) => ({ id: ing.id, toks: tokens(ing.name) }));

    return itens.map((item, i) => {
        const itemToks = tokens(item.descricao);
        let best = null;
        for (const ing of ings) {
            if (ing.toks.size === 0) continue;
            // Fração dos tokens do INSUMO presentes na descrição do item
            // (palavra inteira — "sal" não casa "salmão").
            let hit = 0;
            for (const t of ing.toks) if (itemToks.has(t)) hit++;
            const cobertura = hit / ing.toks.size;
            const confianca = cobertura === 1 ? (ing.toks.size > 1 ? 0.8 : 0.6)
                : cobertura >= 0.6 ? 0.5
                : 0;
            if (confianca > 0 && (!best || confianca > best.confianca)) {
                best = { insumo_id: ing.id, confianca };
            }
        }
        return { item_index: i, insumo_id: best?.insumo_id ?? null, confianca: best?.confianca ?? 0 };
    });
}

async function inserirNota(pg, restauranteId, chave, fileId, nota, itens, matches) {
    await pg.query('BEGIN');
    try {
        const notaRes = await pg.query(
            `INSERT INTO notas_fiscais
                (restaurante_id, numero_nota, fornecedor_nome, fornecedor_cnpj,
                 data_emissao, valor_total, xml_url, status, chave_acesso, origem)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',$8,'drive')
             ON CONFLICT (restaurante_id, chave_acesso) WHERE chave_acesso IS NOT NULL
             DO NOTHING
             RETURNING id`,
            [restauranteId, nota.numero || null, nota.fornecedor_nome || null,
             nota.fornecedor_cnpj || null, nota.data_emissao || null,
             nota.valor_total ?? null, `drive:${fileId}`, chave],
        );
        if (notaRes.rows.length === 0) { // corrida: outra rodada inseriu antes
            await pg.query('ROLLBACK');
            return null;
        }
        const notaId = notaRes.rows[0].id;
        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];
            const match = matches.find((m) => m.item_index === i);
            const temMatch = match && match.insumo_id && match.confianca >= 0.5;
            await pg.query(
                `INSERT INTO nfe_itens
                    (nota_fiscal_id, restaurante_id, codigo_produto, descricao_xml,
                     quantidade, unidade, valor_unitario, valor_total,
                     quantidade_tributavel, unidade_tributavel, valor_unitario_tributavel,
                     insumo_sugerido_id, confianca_match, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pendente')`,
                [notaId, restauranteId, item.codigo_produto || null, item.descricao,
                 item.quantidade, item.unidade, item.valor_unitario, item.valor_total,
                 item.quantidade_tributavel ?? null, item.unidade_tributavel ?? null,
                 item.valor_unitario_tributavel ?? null,
                 temMatch ? match.insumo_id : null, match ? match.confianca : null],
            );
        }
        await pg.query('COMMIT');
        return notaId;
    } catch (err) {
        await pg.query('ROLLBACK');
        throw err;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { default: pgLib } = await import('pg');
const pg = new pgLib.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();

try {
    if (TEST_XML) {
        // Modo teste: pipeline completo a partir de um XML local, sem Drive.
        if (!TEST_RESTAURANTE) throw new Error('--test-xml exige --restaurante <uuid>');
        const xml = fs.readFileSync(TEST_XML, 'utf8');
        const chave = chaveFrom(xml);
        log(`TESTE: chave ${chave}`);
        const { nota, itens } = await parseNfe(xml);
        log(`TESTE: parse ok — ${nota.fornecedor_nome} R$${nota.valor_total} (${itens.length} itens)`);
        const matches = await matchItens(pg, itens, TEST_RESTAURANTE);
        log(`TESTE: match ok — ${matches.filter((m) => m.insumo_id).length}/${itens.length} sugestões`);
        if (DRY_RUN) {
            log('TESTE: dry-run, nada gravado.');
        } else {
            const id = await inserirNota(pg, TEST_RESTAURANTE, chave, 'test-local', nota, itens, matches);
            log(id ? `TESTE: nota gravada (${id})` : 'TESTE: já existia (dedup)');
        }
        process.exit(0);
    }

    const token = await googleAccessToken();
    if (!token) process.exit(0); // SA não configurada ainda — sai em silêncio (cron)

    const { rows: syncs } = await pg.query(
        `SELECT s.restaurante_id, s.drive_folder_id, r.nome, r.cnpj
         FROM nfe_drive_sync s JOIN restaurantes r ON r.id = s.restaurante_id
         WHERE s.ativo`,
    );
    log(`${syncs.length} restaurante(s) com sync ativo${DRY_RUN ? ' [DRY-RUN]' : ''}`);

    for (const sync of syncs) {
        const resumo = { novas: 0, jaImportadas: 0, ignoradas: 0, erros: 0 };
        try {
            const files = await driveList(token, sync.drive_folder_id);
            const { rows: chavesRows } = await pg.query(
                'SELECT chave_acesso FROM notas_fiscais WHERE restaurante_id = $1 AND chave_acesso IS NOT NULL',
                [sync.restaurante_id],
            );
            const conhecidas = new Set(chavesRows.map((r) => r.chave_acesso));

            for (const file of files) {
                try {
                    // Dedup barato: chave no nome do arquivo evita até o download.
                    let chave = chaveFrom(file.name);
                    if (chave && conhecidas.has(chave)) { resumo.jaImportadas++; continue; }

                    const xml = await driveDownload(token, file.id);
                    chave = chave ?? chaveFrom(xml);
                    if (!chave) { log(`  ⚠ ${file.name}: sem chave de acesso, ignorando`); resumo.ignoradas++; continue; }
                    if (conhecidas.has(chave)) { resumo.jaImportadas++; continue; }

                    // Roteamento certo: destinatário do XML tem que ser o CNPJ do restaurante.
                    const destCnpj = onlyDigits(xml.match(/<dest>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/)?.[1]);
                    if (sync.cnpj && destCnpj && onlyDigits(sync.cnpj) !== destCnpj) {
                        log(`  ⚠ ${file.name}: destinatário ${destCnpj} ≠ CNPJ do ${sync.nome}, ignorando`);
                        resumo.ignoradas++;
                        continue;
                    }

                    const { nota, itens } = await parseNfe(xml);
                    if (DRY_RUN) {
                        log(`  [dry-run] importaria ${file.name} — ${nota.fornecedor_nome} R$${nota.valor_total} (${itens.length} itens)`);
                        resumo.novas++;
                        conhecidas.add(chave);
                        continue;
                    }
                    const matches = await matchItens(pg, itens, sync.restaurante_id);
                    const notaId = await inserirNota(pg, sync.restaurante_id, chave, file.id, nota, itens, matches);
                    if (notaId) {
                        resumo.novas++;
                        conhecidas.add(chave);
                        log(`  + ${sync.nome}: ${nota.fornecedor_nome} R$${nota.valor_total} (${itens.length} itens)`);
                    } else {
                        resumo.jaImportadas++;
                    }
                } catch (err) {
                    resumo.erros++;
                    log(`  ✗ ${file.name}: ${err.message}`);
                }
            }
        } catch (err) {
            resumo.erros++;
            log(`✗ ${sync.nome}: ${err.message}`);
        }

        const resultado = `${resumo.novas} novas, ${resumo.jaImportadas} já importadas, ${resumo.ignoradas} ignoradas, ${resumo.erros} erros`;
        log(`${sync.nome}: ${resultado}`);
        if (!DRY_RUN) {
            await pg.query(
                'UPDATE nfe_drive_sync SET last_sync_at = now(), last_result = $2 WHERE restaurante_id = $1',
                [sync.restaurante_id, resultado],
            );
        }
    }
} finally {
    await pg.end();
}
