// Verifica end-to-end del funzionamento offline della build.
// Uso: BASE_PATH=/consulta/ npm run build && npm run check:offline
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.env.BASE_PATH || '/';
const port = 4199;
const url = `http://localhost:${port}${base}`;

// Se la porta è occupata (es. un'anteprima rimasta aperta) il controllo verificherebbe la build sbagliata.
try {
  await fetch(`http://localhost:${port}/`);
  console.error(`✗ La porta ${port} è già in uso: chiudi l'altra anteprima e riprova.`);
  process.exit(1);
} catch { /* porta libera */ }

// Vite avviato direttamente (non tramite npx) così server.kill() chiude davvero il server.
const viteBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], {
  env: { ...process.env, BASE_PATH: base },
  stdio: 'ignore'
});
let exited = false;
server.on('exit', () => { exited = true; });
const fail = (msg) => { console.error('✗', msg); server.kill(); process.exit(1); };
const ok = (msg) => console.log('✓', msg);

try {
  for (let i = 0; i < 50; i++) {
    if (exited) fail('il server di anteprima non è partito (hai eseguito "npm run build"?)');
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

  // primo accesso (serve la rete): modalità demo
  await page.getByText('Benvenuti in').waitFor();
  ok('pagina di benvenuto');
  await page.getByRole('button', { name: 'Entra', exact: true }).click();
  await page.getByRole('button', { name: 'Prova la demo' }).click();
  await page.waitForSelector('.tabbar');
  ok('accesso demo con i contenuti pubblicati');

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.tabbar');
  ok('l\'app si ricarica senza rete');
  if ((await page.textContent('.badge')).trim() !== 'Offline') fail('indicatore non mostra Offline');
  ok('indicatore Offline visibile');

  for (const tab of ['Archivio', 'Impostazioni', 'Chiedi']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(100);
  }
  await page.goto(url + '#database');
  await page.waitForSelector('text=Versione contenuti');
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
