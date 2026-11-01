// Genera le icone PNG della PWA a partire da public/icons/icon.svg.
// Uso: npm run icons  (richiede Playwright con Chromium installato)
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0, round: true },
  { name: 'icon-512.png', size: 512, pad: 0, round: true },
  { name: 'apple-touch-icon.png', size: 180, pad: 0, round: false },
  // maskable: contenuto nella "safe zone" (80%) su sfondo pieno
  { name: 'icon-maskable-512.png', size: 512, pad: 0.12, round: false }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const inner = t.size * (1 - t.pad * 2);
  const body = t.round ? svg : svg.replace('rx="112"', 'rx="0"');
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:${t.round ? "transparent" : "#1f5f8b"};display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
    <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: out(t.name), omitBackground: t.round });
  console.log('creata', t.name);
}
await browser.close();
