import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Génère dist/sw.js : met en cache le "squelette" de l'appli (page + fichiers construits) pour qu'elle
 * s'ouvre sans Internet. L'API et le WebSocket ne passent jamais par le cache.
 */
function serviceWorker() {
  return {
    name: 'wifidrop-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).map((f) => `/${f}`);
      const shell = ['/', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...files];
      const version = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'wifidrop-${version}';
const SHELL = ${JSON.stringify(shell)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/healthz') return;

  if (request.mode === 'navigate') {
    // Page : le réseau d'abord (version à jour), le cache si on est hors-ligne.
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // Fichiers construits (noms avec empreinte) : le cache d'abord.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`,
      });
    },
  };
}

// En développement, le serveur Node (npm run dev:server) reste sur le port 3000.
export default defineConfig({
  plugins: [vue(), serviceWorker()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
