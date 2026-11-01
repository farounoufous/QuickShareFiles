import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Petit serveur de fichiers statiques avec repli sur index.html. */
export function createStaticHandler(root) {
  const base = normalize(root);

  async function resolve(urlPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    const target = normalize(join(base, decoded));
    if (target !== base && !target.startsWith(base + sep)) return null; // anti « ../ »
    try {
      const info = await stat(target);
      if (info.isFile()) return { file: target, info };
      if (info.isDirectory()) {
        const index = join(target, 'index.html');
        return { file: index, info: await stat(index) };
      }
    } catch {
      /* introuvable */
    }
    return null;
  }

  return async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    let hit = await resolve(pathname);
    // Une URL sans extension est une route de l'app : on renvoie index.html.
    if (!hit && !extname(pathname)) hit = await resolve('/index.html');
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }

    const ext = extname(hit.file).toLowerCase();
    const hashed = pathname.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': hit.info.size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      // La caméra sert à scanner les QR codes du mode hors-ligne ; rien d'autre n'est demandé.
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      // Aucun script ni ressource venant d'ailleurs : l'app est entièrement servie par ce serveur.
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; " +
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(hit.file).pipe(res);
  };
}
