// Paramètres du protocole de transfert (identiques des deux côtés).

export const CHUNK = 64 * 1024; // taille d'un bloc : la plus rapide mesurée, et sûre entre tous les navigateurs
export const READ_BLOCK = 4 * 1024 * 1024; // lecture du fichier par tranches de 4 Mo
export const ACK_EVERY = 256 * 1024; // le récepteur confirme tous les 256 Ko écrits
export const WINDOW_P2P = 4 * 1024 * 1024; // octets envoyés mais pas encore confirmés (P2P)
export const WINDOW_RELAY = 2 * 1024 * 1024; // idem via le serveur
export const P2P_TIMEOUT = 6000; // au-delà, on bascule sur le relais (s'il est autorisé)
export const ACCEPT_TIMEOUT = 20_000; // le récepteur attend l'offre de l'expéditeur
export const READY_TIMEOUT = 15_000; // l'expéditeur attend le « prêt » du récepteur
export const RESUME_TIMEOUT = 90_000; // durée maximale d'une coupure avant d'abandonner
export const MAX_RECONNECTS = 6; // reprises automatiques maximum par transfert
export const SINK_BATCH = 1024 * 1024; // écriture disque par paquets de 1 Mo
export const MAX_TEXT = 20_000; // caractères maximum d'un texte envoyé

export const ID_PATTERN = /^[0-9a-f]{8}$/;

export function newTransferId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
