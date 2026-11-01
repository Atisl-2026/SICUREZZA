// Verifica end-to-end del funzionamento offline della build.
// Uso: BASE_PATH=/consulta/ npm run build && npm run check:offline
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.env.BASE_PATH || '/';
const port = 4199;
const url = `http://localhost:${port}${base}`;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
  env: { ...process.env, BASE_PATH: base },
  stdio: 'ignore'
});
const fail = (msg) => { console.error('✗', msg); server.kill(); process.exit(1); };
const ok = (msg) => console.log('✓', msg);

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(url);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  if (!manifest) fail('manifest non trovato');
  if (manifest.start_url !== base) fail(`start_url errato: ${manifest.start_url}`);
  ok(`manifest valido (${manifest.name}, ${manifest.icons.length} icone)`);

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 })
    .catch(() => page.reload().then(() => page.waitForFunction(() => !!navigator.serviceWorker.controller)));
  ok('service worker attivo e in controllo della pagina');

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.tabbar');
  ok('l\'app si ricarica senza rete');
  if ((await page.textContent('.badge')).trim() !== 'Offline') fail('indicatore non mostra Offline');
  ok('indicatore Offline visibile');

  for (const tab of ['Database', 'Impostazioni', 'Chiedi']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(100);
  }
  await page.goto(url + '#database');
  await page.waitForSelector('text=Versione database');
  ok('navigazione tra le schede e deep link offline funzionanti');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('.badge')?.textContent?.trim() === 'Online');
  ok('ritorno Online rilevato');

  if (process.env.SCREENSHOTS) {
    await page.goto(url + '#chiedi');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/chiedi-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/chiedi-dark.png` });
  }
  await browser.close();
  server.kill();
  console.log('\nTutti i controlli offline superati.');
} catch (e) {
  fail(e.message);
}
