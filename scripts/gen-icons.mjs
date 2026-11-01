// Rigenera le icone della PWA a partire dal logo public/brand/logo-atisl.png
// (triangolo ATISL su sfondo trasparente). Uso: npm run icons  (richiede Playwright con Chromium).
// Per cambiare logo: sostituisci logo-atisl.png e logo-completo.png in public/brand/ ed esegui lo script.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const logo = (await readFile(new URL('../public/brand/logo-atisl.png', import.meta.url))).toString('base64');
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

// pad = margine per lato; le icone "maskable" (Android) devono stare nell'80% centrale
const targets = [
  { name: 'icon-192.png', size: 192, pad: 0.06 },
  { name: 'icon-512.png', size: 512, pad: 0.06 },
  { name: 'apple-touch-icon.png', size: 180, pad: 0.07 },
  { name: 'icon-maskable-512.png', size: 512, pad: 0.16 },
  { name: 'favicon-64.png', size: 64, pad: 0.04 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;width:${t.size}px;height:${t.size}px;background:#fff;display:grid;place-items:center">
    <img src="data:image/png;base64,${logo}" style="max-width:${inner}px;max-height:${inner}px;transform:translateY(${Math.round(t.size * 0.02)}px)"></body></html>`);
  await page.screenshot({ path: out(t.name) });
  console.log('creata', t.name);
}
await browser.close();
