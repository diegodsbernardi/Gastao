#!/usr/bin/env node
// Deploy de produção do Gastão: publica E aponta o domínio oficial.
//
// POR QUE ESTE SCRIPT EXISTE
// `gastao.vercel.app` não é o subdomínio nativo deste projeto (nasceu no projeto
// hoje chamado `gastao-legacy`, e a Vercel não transfere subdomínio .vercel.app
// em rename). Ele só chega no deploy novo via `vercel alias set`.
//
// Rodar `vercel --prod` sozinho publica sem erro nenhum e deixa o domínio
// oficial servindo a versão ANTERIOR — falha silenciosa, do tipo que ninguém
// percebe até um cliente reclamar. Este script faz as duas etapas sempre juntas
// e confere o resultado.
//
// Uso: npm run deploy

import { execSync } from 'node:child_process';

const DOMINIO = 'gastao.vercel.app';
// A CLI da Vercel escreve quase tudo em stderr (o `inspect`, inclusive), então
// capturar só stdout devolve string vazia. `2>&1` junta os dois.
const sh = (cmd) => execSync(`${cmd} 2>&1`, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });

console.log('→ publicando...');
const saida = sh('npx vercel --prod --yes');
const url = saida.match(/https:\/\/gastao-[a-z0-9]+-[a-z0-9-]+\.vercel\.app/)?.[0];

if (!url) {
    console.error('Não consegui identificar a URL do deploy. Saída:\n' + saida);
    process.exit(1);
}
console.log(`  deploy: ${url}`);

console.log(`→ apontando ${DOMINIO}...`);
sh(`npx vercel alias set ${url} ${DOMINIO}`);

// Confere de verdade: alias pode dar "Success" e o CDN ainda servir o anterior.
console.log('→ conferindo...');
const inspect = sh(`npx vercel inspect ${DOMINIO}`);
// Ancora na linha "url" do inspect: a lista de Aliases logo abaixo também casa
// com o padrão de URL e daria um falso positivo.
const servido = inspect.match(/^\s*url\s+(https:\/\/\S+)/m)?.[1];

if (servido !== url) {
    console.error(`\nATENÇÃO: ${DOMINIO} está servindo ${servido}, não ${url}.`);
    console.error('Rode manualmente: npx vercel alias set ' + url + ' ' + DOMINIO);
    process.exit(1);
}

const status = sh(`curl -s -o /dev/null -w "%{http_code}" https://${DOMINIO}/`).trim();
console.log(`\n✓ https://${DOMINIO} → ${url} (HTTP ${status})`);
