import { join } from 'node:path';

const truthy = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'non', 'no', 'off'].includes(String(value).toLowerCase());
};

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Lit la configuration depuis les variables d'environnement.
 *
 *  MODE            local (défaut) : tous les appareils du réseau se voient, HTTPS auto-signé.
 *                  public         : hébergé sur Internet, salles à code, HTTPS fourni par l'hébergeur.
 *  PORT            port HTTP (les hébergeurs le fournissent), 3000 par défaut
 *  HOST            interface d'écoute, 0.0.0.0 par défaut
 *  HTTPS_PORT      port HTTPS auto-signé : 3443 en local, 0 (désactivé) en public
 *  ALLOW_RELAY     relais des blocs par le serveur : oui en local, non en public (consommerait de la data)
 *  TRUST_PROXY     lire l'IP réelle dans X-Forwarded-For : non en local, oui en public (derrière un proxy)
 *  ALLOWED_ORIGINS domaines autorisés à ouvrir le WebSocket en plus du domaine servi (séparés par des virgules)
 *  MAX_ROOM_PEERS  appareils maximum par salle (mode public), 20 par défaut
 *  STATIC_DIR      dossier de l'interface construite
 *  CERT_DIR        dossier du certificat auto-signé (mode local)
 */
export function loadConfig(env = process.env, { clientDist } = {}) {
  const mode = env.MODE === 'public' ? 'public' : 'local';
  const isPublic = mode === 'public';
  const number = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };

  return {
    mode,
    host: env.HOST || '0.0.0.0',
    httpPort: number(env.PORT, 3000),
    httpsPort: number(env.HTTPS_PORT, isPublic ? 0 : 3443),
    allowRelay: truthy(env.ALLOW_RELAY, !isPublic),
    trustProxy: truthy(env.TRUST_PROXY, isPublic),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    maxRoomPeers: Math.max(2, number(env.MAX_ROOM_PEERS, 20)),
    staticDir: env.STATIC_DIR || clientDist,
    certDir: env.CERT_DIR || undefined,
  };
}

export const defaultClientDist = (here) => join(here, '../../client/dist');
