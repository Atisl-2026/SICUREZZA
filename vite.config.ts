import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Il lettore PDF ha nomi fissi (per versione della libreria): una versione dell'app già installata
// lo trova anche dopo che il sito è stato aggiornato (con i nomi «-[hash]» spariva a ogni pubblicazione).
const UNPDF_VERSION = (JSON.parse(readFileSync(new URL('./node_modules/unpdf/package.json', import.meta.url), 'utf8')) as { version: string }).version;
const PDF_DIR = `assets/pdf-${UNPDF_VERSION}`;

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
      includeAssets: ['icons/*.png', 'brand/*.png'],
      manifest: {
        name: 'ATISL Security',
        short_name: 'ATISL',
        description: 'ATISL – Associazione Tecnici e Ispettori per la Sicurezza sul Lavoro: normativa, procedure e schede tecniche anche offline, con risposte AI.',
        lang: 'it',
        dir: 'ltr',
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#1e5c86',
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
        // l'APK si scarica dal server, non dalla cache dell'app
        navigateFallbackDenylist: [/\/download\//],
        cleanupOutdatedCaches: true,
        // I file dei dati NON vanno in precache: li gestisce l'app (versione + conferma).
        // il lettore PDF (~1,7 MB) serve solo al programmatore: fuori dall'installazione,
        // messo in cache al primo uso
        globIgnores: ['**/data/*.json', '**/assets/pdf-*/**', '**/download/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/pdf-'),
            handler: 'CacheFirst',
            options: { cacheName: 'lettore-pdf', expiration: { maxEntries: 20 } }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // l'aiutante di Vite per i caricamenti differiti in un file a parte con nome fisso: così il lettore
        // PDF non dipende dal file principale dell'app (che cambia nome a ogni versione)
        manualChunks: (id: string) => (id.includes('vite/preload-helper') ? 'preload-helper' : undefined),
        chunkFileNames: (chunk: { name: string; moduleIds: string[] }) =>
          chunk.name === 'preload-helper'
            ? 'assets/preload-helper.js'
            : chunk.moduleIds.some((id: string) => id.includes('/node_modules/unpdf/')) ? `${PDF_DIR}/[name].js` : 'assets/[name]-[hash].js'
      }
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as any);
