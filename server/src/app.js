import { WebSocketServer } from 'ws';
import { createStaticHandler } from './static.js';

const firstForwarded = (value) => String(value ?? '').split(',')[0].trim();

/** Adresse IP du client, en tenant compte d'un proxy d'hébergeur si on lui fait confiance. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = firstForwarded(req.headers['x-forwarded-for']);
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? '';
}

/**
 * Gestionnaire HTTP : /healthz, /api/info + fichiers statiques.
 * `getInfo()` est appelé à chaque requête pour refléter l'état courant des serveurs.
 */
export function createRequestHandler({ staticDir, getInfo }) {
  const serveStatic = createStaticHandler(staticDir);
  return (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : 'ok');
      return;
    }
    if (pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getInfo()));
      return;
    }
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
}

/** Branche le WebSocket (/ws) sur un serveur HTTP ou HTTPS, au profit du hub partagé. */
export function attachWebSocket(server, hub, { trustProxy = false, allowedOrigins = [] } = {}) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1 << 20, // 1 Mo : les blocs de relais font ~64 Ko
    perMessageDeflate: false, // les fichiers sont déjà compressés, inutile de perdre du CPU
    verifyClient: ({ origin, req }) => {
      // Refuse les pages d'autres sites qui tenteraient de se connecter à l'insu de l'utilisateur.
      if (!origin) return true;
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        return false;
      }
      if (allowedOrigins.includes(host) || allowedOrigins.includes(origin)) return true;
      if (host === req.headers.host) return true;
      return trustProxy && host === firstForwarded(req.headers['x-forwarded-host']);
    },
  });
  wss.on('connection', (ws, req) => hub.attach(ws, clientIp(req, trustProxy)));
  return wss;
}
