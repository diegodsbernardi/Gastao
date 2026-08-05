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
const HTML_IN = path.join(AQUI, 'guia', 'guia-gastao.html');
const FONT_DIR = path.join(AQUI, 'guia', 'fonts');
const PDF_OUT = path.resolve(process.argv[2] ?? path.join(AQUI, '..', 'public', 'Guia-Gastao.pdf'));

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

const html = fs.readFileSync(HTML_IN, 'utf8').replace('/*FONTS*/', faces);

// ─── renderiza ───────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready'); // sem isso o PDF sai com fallback

    fs.mkdirSync(path.dirname(PDF_OUT), { recursive: true });
    await page.pdf({
        path: PDF_OUT,
        format: 'A4',
        printBackground: true,   // a capa laranja e as caixas dependem disso
        preferCSSPageSize: true, // respeita o @page do documento
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
          <div style="width:100%;font-size:8px;color:#6B6B6B;padding:0 16mm;
                      font-family:sans-serif;display:flex;justify-content:space-between;">
            <span>Gastão · Guia de Uso</span>
            <span class="pageNumber"></span>
          </div>`,
        margin: { top: '18mm', bottom: '16mm', left: '0', right: '0' },
    });

    const kb = (fs.statSync(PDF_OUT).size / 1024).toFixed(0);
    console.log(`PDF gerado: ${PDF_OUT} (${kb} KB)`);
} finally {
    await browser.close();
}
