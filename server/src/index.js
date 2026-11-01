import http from 'node:http';
import https from 'node:https';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import qrcode from 'qrcode-terminal';
import { Hub } from './hub.js';
import { attachWebSocket, createRequestHandler } from './app.js';
import { lanAddresses, networkLabel } from './network.js';
import { loadOrCreateCert } from './certs.js';
import { defaultClientDist, loadConfig } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(process.env, { clientDist: defaultClientDist(here) });
const isPublic = config.mode === 'public';

if (!existsSync(join(config.staticDir, 'index.html'))) {
  console.error(`\n  L'interface n'est pas construite (${config.staticDir}).\n  Lance d'abord : npm run build\n`);
  process.exit(1);
}

// En mode public, les adresses du serveur n'ont aucun intérêt pour l'utilisateur.
const lan = isPublic ? [] : lanAddresses();
let httpsActive = false;

const hub = new Hub({
  rooms: isPublic,
  allowRelay: config.allowRelay,
  maxRoomPeers: config.maxRoomPeers,
});
hub.startHeartbeat();

const handler = createRequestHandler({
  staticDir: config.staticDir,
  getInfo: () => ({
    app: 'wifidrop',
    mode: config.mode,
    relay: config.allowRelay,
    httpsPort: httpsActive ? config.httpsPort : 0,
    networks: lan.map((n) => ({
      label: networkLabel(n),
      kind: n.kind,
      url: `http://${n.address}:${config.httpPort}`,
      secureUrl: httpsActive ? `https://${n.address}:${config.httpsPort}` : '',
    })),
    iceServers: [],
  }),
});

const servers = [];

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => resolve());
  });
}

function track(server) {
  const sockets = attachWebSocket(server, hub, {
    trustProxy: config.trustProxy,
    allowedOrigins: config.allowedOrigins,
  });
  servers.push({ server, sockets });
}

const httpServer = http.createServer(handler);
track(httpServer);

try {
  await listen(httpServer, config.httpPort);
} catch (error) {
  console.error(
    error.code === 'EADDRINUSE'
      ? `\n  Le port ${config.httpPort} est déjà utilisé. Essaie : PORT=3001 npm start\n`
      : `\n  Impossible de démarrer le serveur : ${error.message}\n`,
  );
  process.exit(1);
}

if (config.httpsPort > 0) {
  try {
    const certDir = config.certDir ?? join(here, '../.certs');
    const { key, cert } = await loadOrCreateCert(certDir, lan.map((a) => a.address));
    const httpsServer = https.createServer({ key, cert }, handler);
    track(httpsServer);
    await listen(httpsServer, config.httpsPort);
    httpsActive = true;
  } catch (error) {
    console.warn(`  HTTPS indisponible (${error.code ?? error.message}) : le serveur continue en HTTP seul.`);
  }
}

const line = '  ' + '─'.repeat(54);
if (isPublic) {
  console.log(`WifiDrop (mode public) écoute sur ${config.host}:${config.httpPort}`);
  console.log(`  relais: ${config.allowRelay ? 'oui' : 'non'}, proxy de confiance: ${config.trustProxy ? 'oui' : 'non'}, appareils max par salle: ${config.maxRoomPeers}`);
} else {
  console.log(`\n  WifiDrop est prêt.\n${line}`);
  console.log(`  Sur cet ordinateur : http://localhost:${config.httpPort}`);
  if (lan.length) {
    const [main, ...others] = lan;
    console.log(`\n  Sur les autres appareils (même réseau que ce PC, ${networkLabel(main)}) :`);
    console.log(`    http://${main.address}:${config.httpPort}`);
    if (httpsActive) console.log(`    https://${main.address}:${config.httpsPort}   pour les très gros fichiers (certificat à accepter)`);
    console.log('');
    qrcode.generate(`http://${main.address}:${config.httpPort}`, { small: true }, (code) =>
      console.log(code.replace(/^/gm, '    ')),
    );
    if (others.length) {
      console.log("  Si l'autre appareil est sur un autre réseau de ce PC :");
      for (const n of others) console.log(`    http://${n.address}:${config.httpPort}   ${networkLabel(n)}`);
    }
  } else {
    console.log("\n  Aucun réseau détecté : connecte-toi à un wifi, active un point d'accès ou branche un câble.");
  }
  console.log(`${line}\n  Ctrl+C pour arrêter.\n`);
}

// Arrêt propre : les hébergeurs envoient SIGTERM avant de remplacer ou d'arrêter le conteneur.
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  hub.stopHeartbeat();
  for (const { server, sockets } of servers) {
    for (const client of sockets.clients) client.close(1001, 'Serveur en cours de redémarrage');
    server.close();
  }
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
