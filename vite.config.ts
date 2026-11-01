import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Su GitHub Pages l'app vive in /<nome-repo>/: il workflow imposta BASE_PATH.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    preact(),
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
        // Il db.json remoto NON va in precache: lo gestisce l'app (versione + conferma).
        globIgnores: ['**/db.json'],
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
