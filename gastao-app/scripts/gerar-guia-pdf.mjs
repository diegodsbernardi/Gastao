#!/usr/bin/env node
// Gera o Guia de Uso do Gastão em PDF a partir de scripts/guia/guia-gastao.html.
//
// As fontes Poppins (subset latin) vão embutidas em base64: o PDF precisa ficar
// idêntico em qualquer máquina, sem depender de rede nem de fonte instalada.
//
// Uso:  node scripts/gerar-guia-pdf.mjs [saida.pdf]
// Requer puppeteer (instalado fora do projeto, em ~/tools/pdfgen).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const AQUI = import.meta.dirname;
const FONT_DIR = path.join(AQUI, 'guia', 'fonts');

// Os dois guias compartilham o CSS (guia/base.css) e as fontes; só o conteúdo muda.
const GUIAS = {
    uso:      { html: 'guia-gastao.html',  pdf: 'Guia-Gastao.pdf' },
    planilha: { html: 'guia-planilha.html', pdf: 'Guia-Planilha-Mae.pdf' },
};

const alvo = process.argv[2] ?? 'todos';
const selecionados = alvo === 'todos' ? Object.keys(GUIAS) : [alvo];
for (const s of selecionados) {
    if (!GUIAS[s]) {
        console.error(`Guia desconhecido: "${s}". Use: ${Object.keys(GUIAS).join(' | ')} | todos`);
        process.exit(2);
    }
}

// puppeteer vive em ~/tools/pdfgen pra não entrar no package.json do app
// (Chromium são ~170 MB que nada têm a ver com o build do front).
const require = createRequire(path.join(process.env.HOME, 'tools', 'pdfgen', 'index.js'));
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch {
    console.error('puppeteer não encontrado. Instale com:');
    console.error('  mkdir -p ~/tools/pdfgen && cd ~/tools/pdfgen && npm init -y && npm i puppeteer');
    process.exit(2);
}

// ─── monta o CSS das fontes ──────────────────────────────────────────────────
const faces = [400, 600, 700].map(peso => {
    const arq = path.join(FONT_DIR, `poppins-${peso}.woff2`);
    if (!fs.existsSync(arq)) {
        console.error(`Fonte ausente: ${arq}`);
        process.exit(2);
    }
    const b64 = fs.readFileSync(arq).toString('base64');
    return `@font-face{font-family:'Poppins';font-style:normal;font-weight:${peso};font-display:block;` +
           `src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}).join('\n');

const baseCss = fs.readFileSync(path.join(AQUI, 'guia', 'base.css'), 'utf8');

// ─── renderiza ───────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
    for (const chave of selecionados) {
        const { html: arqHtml, pdf: arqPdf } = GUIAS[chave];
        const htmlIn = path.join(AQUI, 'guia', arqHtml);
        const pdfOut = path.join(AQUI, '..', 'public', arqPdf);

        const html = fs.readFileSync(htmlIn, 'utf8')
            .replace('/*FONTS*/', faces)
            .replace('/*BASE*/', baseCss);

        const titulo = (html.match(/<title>(.*?)<\/title>/) ?? [, 'Gastão'])[1];

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluateHandle('document.fonts.ready'); // sem isso o PDF sai com fallback

        fs.mkdirSync(path.dirname(pdfOut), { recursive: true });
        await page.pdf({
            path: pdfOut,
            format: 'A4',
            printBackground: true,   // a capa laranja e as caixas dependem disso
            preferCSSPageSize: true, // respeita o @page do documento
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: `
              <div style="width:100%;font-size:8px;color:#6B6B6B;padding:0 16mm;
                          font-family:sans-serif;display:flex;justify-content:space-between;">
                <span>${titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>
                <span class="pageNumber"></span>
              </div>`,
            margin: { top: '18mm', bottom: '16mm', left: '0', right: '0' },
        });
        await page.close();

        const kb = (fs.statSync(pdfOut).size / 1024).toFixed(0);
        console.log(`PDF gerado: ${path.relative(process.cwd(), pdfOut)} (${kb} KB)`);
    }
} finally {
    await browser.close();
}
