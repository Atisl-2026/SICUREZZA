import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Su GitHub Pages l'app vive in /<nome-repo>/: il workflow imposta BASE_PATH.
const base = process.env.BASE_PATH || '/';

/**
 * Pubblica i file di data/ (demo.json in chiaro, soci.json cifrato) all'indirizzo <base>data/…:
 * serviti dal dev server e copiati in dist/ alla build (fuori dal precache del service worker).
 */
const DATA_FILES = ['demo.json', 'soci.json'];
function dataFiles(): Plugin {
  const fileUrl = (name: string) => new URL(`./data/${name}`, import.meta.url);
  return {
    name: 'consulta-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = DATA_FILES.find((n) => req.url?.split('?')[0] === `${base}data/${n}`);
        if (!name || !existsSync(fileUrl(name))) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(fileUrl(name)));
      });
    },
    generateBundle() {
      for (const name of DATA_FILES) {
        if (existsSync(fileUrl(name))) this.emitFile({ type: 'asset', fileName: `data/${name}`, source: readFileSync(fileUrl(name)) });
        else this.warn(`data/${name} non trovato: l'app non avrà contenuti per questo accesso.`);
      }
    }
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    preact(),
    dataFiles(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'Consulta – Archivio con AI',
        short_name: 'Consulta',
        description: 'Consulta normativa, procedure, schede tecniche e FAQ anche offline, con risposte AI Gemini.',
        lang: 'it',
        dir: 'ltr',
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f7f5',
        theme_color: '#1f5f8b',
        categories: ['productivity', 'education', 'reference'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Tutto l'app shell è in precache: l'app si apre e funziona senza rete.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // I file dei dati NON vanno in precache: li gestisce l'app (versione + conferma).
        globIgnores: ['**/data/*.json'],
        runtimeCaching: []
      },
      devOptions: { enabled: false }
    })
  ],
  build: { target: 'es2020' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as any);
