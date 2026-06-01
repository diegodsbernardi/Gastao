// CLI utilitário pra rodar SQL no Supabase a partir do servidor.
// Lê SUPABASE_DB_URL de ~/.gastao-supabase.env (gitignored).
// Uso:
//   node scripts/sb-query.mjs "SELECT 1"
//   echo "SELECT * FROM ..." | node scripts/sb-query.mjs
//   node scripts/sb-query.mjs --file caminho/para.sql
//
// SEGURANÇA: nunca printa a connection string. Em caso de erro de auth,
// imprime só "auth failed" sem expor credencial.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Carrega env
const ENV_PATH = path.join(os.homedir(), '.gastao-supabase.env');
if (!fs.existsSync(ENV_PATH)) {
    console.error('Falta ~/.gastao-supabase.env. Configurar SUPABASE_DB_URL.');
    process.exit(2);
}
const envText = fs.readFileSync(ENV_PATH, 'utf8');
const m = envText.match(/^SUPABASE_DB_URL=(.+)$/m);
if (!m) {
    console.error('SUPABASE_DB_URL não encontrado em ~/.gastao-supabase.env');
    process.exit(2);
}
const connString = m[1].trim();

// Pega SQL — arg, --file ou stdin
let sql = '';
const args = process.argv.slice(2);
if (args[0] === '--file' && args[1]) {
    sql = fs.readFileSync(args[1], 'utf8');
} else if (args.length > 0 && !args[0].startsWith('--')) {
    sql = args.join(' ');
} else if (!process.stdin.isTTY) {
    sql = await new Promise(resolve => {
        let data = '';
        process.stdin.on('data', c => (data += c));
        process.stdin.on('end', () => resolve(data));
    });
}
if (!sql.trim()) {
    console.error('Sem SQL pra rodar. Use: node sb-query.mjs "SELECT ..." ou --file ou stdin.');
    process.exit(2);
}

// Conecta
const { default: pg } = await import('pg');
const client = new pg.Client({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
});

try {
    await client.connect();
} catch (err) {
    console.error('Erro de conexão:', err.code || err.message);
    process.exit(3);
}

try {
    const result = await client.query(sql);
    if (Array.isArray(result)) {
        // múltiplas queries no mesmo execute
        result.forEach((r, i) => {
            console.log(`-- Resultado ${i + 1} (${r.command} ${r.rowCount ?? ''}):`);
            if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2));
        });
    } else {
        console.log(`-- ${result.command} ${result.rowCount ?? ''} row(s)`);
        if (result.rows?.length) console.log(JSON.stringify(result.rows, null, 2));
    }
} catch (err) {
    console.error('SQL error:', err.message);
    process.exit(1);
} finally {
    await client.end();
}
