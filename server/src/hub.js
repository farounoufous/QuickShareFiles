import { randomBytes } from 'node:crypto';

/**
 * Hub : appareils connectés, salles et routage des messages.
 *
 * Deux modes :
 *  - local  : tous les appareils du réseau se voient (une seule salle implicite).
 *  - public : chaque appareil entre dans une salle à code (ex. K7Q2MX) et ne voit que sa salle.
 *
 * Protocole WebSocket (chemin /ws) :
 *
 *  client -> serveur
 *    { type: 'hello', name, device, room?, create?, id?, token? }
 *        premier message. `create` ouvre une salle (mode public), `room` en rejoint une,
 *        `id` + `token` reprennent l'identité après une coupure réseau.
 *        Renvoyé plus tard, il sert à changer de nom.
 *    { type: 'signal', to, data }
 *    <binaire> [8 o : id destinataire][8 o : id transfert][données]      (relais, si autorisé)
 *
 *  serveur -> client
 *    { type: 'welcome', id, token, room, mode, relay, peers: [{ id, name, device }] }
 *    { type: 'peer-joined' | 'peer-updated', peer }
 *    { type: 'peer-left', id }
 *    { type: 'signal', from, data }
 *    { type: 'error', code }   code : room-required | room-not-found | room-full | rate-limited
 *    <binaire> [8 o : id expéditeur][8 o : id transfert][données]
 *
 * Le serveur ne lit jamais le contenu des fichiers : en connexion directe il n'en voit pas
 * passer un octet, et en relais il recopie les blocs sans les lire ni les stocker.
 */

export const ID_LENGTH = 8;
const HEADER_LENGTH = ID_LENGTH * 2;
const MAX_PEERS = 2000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0, O, 1, I : faciles à confondre
const ROOM_LENGTH = 6;

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

export const normalizeRoom = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);

/** Compte les événements récents par clé (adresse IP) sur une fenêtre glissante. */
export class RateLimiter {
  #hits = new Map();
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Enregistre un événement. Renvoie false si la limite est dépassée. */
  hit(key, now = Date.now()) {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.#hits.set(key, recent);
    return recent.length <= this.limit;
  }

  prune(now = Date.now()) {
    for (const [key, list] of this.#hits) {
      if (!list.some((t) => now - t < this.windowMs)) this.#hits.delete(key);
    }
  }
}

export class Hub {
  #peers = new Map(); // id -> pair
  #conns = new Map(); // ws -> connexion
  #rooms = new Map(); // code -> Set d'ids
  #heartbeat = null;
  #connectLimiter;
  #joinLimiter;

  constructor({
    rooms = false,
    allowRelay = true,
    maxRoomPeers = 20,
    graceMs = 30_000,
    connectLimit = 90, // connexions par minute et par adresse IP
    joinLimit = 30, // tentatives d'entrer dans une salle par minute et par adresse IP
  } = {}) {
    this.rooms = rooms;
    this.allowRelay = allowRelay;
    this.maxRoomPeers = maxRoomPeers;
    this.graceMs = graceMs;
    this.#connectLimiter = new RateLimiter(connectLimit, 60_000);
    this.#joinLimiter = new RateLimiter(joinLimit, 60_000);
  }

  get size() {
    return this.#peers.size;
  }

  get roomCount() {
    return this.#rooms.size;
  }

  attach(ws, ip = '') {
    if (!this.#connectLimiter.hit(ip) || this.#conns.size >= MAX_PEERS) {
      ws.close(1013, 'Trop de connexions');
      return;
    }
    const conn = { ws, ip, peer: null, alive: true };
    this.#conns.set(ws, conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => this.#onMessage(conn, data, isBinary));
    ws.on('close', (code) => this.#onClose(conn, code));
    ws.on('error', () => {});
  }

  /** Ferme les connexions mortes (appareil parti sans prévenir). */
  startHeartbeat(intervalMs = 20_000) {
    this.stopHeartbeat();
    this.#heartbeat = setInterval(() => {
      for (const conn of this.#conns.values()) {
        if (!conn.alive) {
          conn.ws.terminate();
          continue;
        }
        conn.alive = false;
        try {
          conn.ws.ping();
        } catch {
          /* la fermeture sera traitée par l'événement close */
        }
      }
      this.#connectLimiter.prune();
      this.#joinLimiter.prune();
    }, intervalMs);
    this.#heartbeat.unref?.();
  }

  stopHeartbeat() {
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  // ───────────────────────── messages ─────────────────────────

  #onMessage(conn, data, isBinary) {
    if (isBinary) return this.#relay(conn, data);

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg?.type) {
      case 'hello':
        return this.#hello(conn, msg);
      case 'signal': {
        const peer = conn.peer;
        if (!peer) return;
        if (msg.data?.kind === 'relay' && !this.allowRelay) return;
        const target = this.#peers.get(String(msg.to));
        if (target && target !== peer && target.room === peer.room) {
          this.#send(target, { type: 'signal', from: peer.id, data: msg.data });
        }
        return;
      }
    }
  }

  #hello(conn, msg) {
    const name = clean(msg.name, 40) || 'Appareil';
    const device = clean(msg.device, 60);

    // Déjà connecté : simple changement de nom.
    if (conn.peer) return this.#rename(conn.peer, name, device);

    // Reprise d'identité après une coupure réseau.
    if (typeof msg.id === 'string' && typeof msg.token === 'string') {
      const previous = this.#peers.get(msg.id);
      if (previous && previous.token === msg.token) return this.#takeover(conn, previous, name, device);
    }

    let room = '*';
    if (this.rooms) {
      if (!this.#joinLimiter.hit(conn.ip)) {
        this.#sendRaw(conn.ws, { type: 'error', code: 'rate-limited' });
        return conn.ws.close(1013, 'Trop de tentatives');
      }
      if (msg.create) {
        room = this.#newRoomCode();
      } else {
        room = normalizeRoom(msg.room);
        if (!room) return this.#sendRaw(conn.ws, { type: 'error', code: 'room-required' });
        const members = this.#rooms.get(room);
        if (!members) return this.#sendRaw(conn.ws, { type: 'error', code: 'room-not-found' });
        if (members.size >= this.maxRoomPeers) return this.#sendRaw(conn.ws, { type: 'error', code: 'room-full' });
      }
    }

    const peer = {
      id: this.#newId(),
      token: randomBytes(16).toString('hex'),
      ws: conn.ws,
      room,
      name,
      device,
      graceTimer: null,
    };
    this.#peers.set(peer.id, peer);
    if (!this.#rooms.has(room)) this.#rooms.set(room, new Set());
    this.#rooms.get(room).add(peer.id);
    conn.peer = peer;

    this.#welcome(peer);
    this.#broadcast(peer, { type: 'peer-joined', peer: this.#info(peer) });
  }

  #takeover(conn, peer, name, device) {
    clearTimeout(peer.graceTimer);
    peer.graceTimer = null;
    const previousWs = peer.ws;
    if (previousWs && previousWs !== conn.ws) {
      const previousConn = this.#conns.get(previousWs);
      if (previousConn) previousConn.peer = null; // sa fermeture ne doit plus toucher à ce pair
      previousWs.terminate();
    }
    peer.ws = conn.ws;
    conn.peer = peer;
    const changed = peer.name !== name || peer.device !== device;
    peer.name = name;
    peer.device = device;
    this.#welcome(peer);
    if (changed) this.#broadcast(peer, { type: 'peer-updated', peer: this.#info(peer) });
  }

  #rename(peer, name, device) {
    if (peer.name === name && peer.device === device) return;
    peer.name = name;
    peer.device = device;
    this.#broadcast(peer, { type: 'peer-updated', peer: this.#info(peer) });
  }

  #relay(conn, buffer) {
    const peer = conn.peer;
    if (!this.allowRelay || !peer || buffer.length < HEADER_LENGTH) return;
    const target = this.#peers.get(buffer.toString('latin1', 0, ID_LENGTH));
    if (!target || target === peer || target.room !== peer.room || target.ws?.readyState !== 1) return;
    // On remplace l'id du destinataire par celui de l'expéditeur, sans copier la trame.
    buffer.write(peer.id, 0, ID_LENGTH, 'latin1');
    target.ws.send(buffer, { binary: true });
  }

  // ───────────────────────── cycle de vie ─────────────────────────

  #onClose(conn, code) {
    this.#conns.delete(conn.ws);
    const peer = conn.peer;
    if (!peer || peer.ws !== conn.ws) return; // déjà repris par une nouvelle connexion
    peer.ws = null;
    // Fermeture voulue (onglet fermé, « quitter ») : l'appareil part tout de suite.
    // Coupure brutale (code 1006 : wifi perdu, appareil en veille) : délai de grâce pour qu'il
    // puisse revenir sans perdre ses transferts en cours.
    if (code !== 1006 || this.graceMs <= 0) return this.#drop(peer);
    peer.graceTimer = setTimeout(() => this.#drop(peer), this.graceMs);
    peer.graceTimer.unref?.();
  }

  #drop(peer) {
    if (!this.#peers.delete(peer.id)) return;
    clearTimeout(peer.graceTimer);
    const members = this.#rooms.get(peer.room);
    members?.delete(peer.id);
    if (members && members.size === 0) this.#rooms.delete(peer.room);
    this.#broadcast(peer, { type: 'peer-left', id: peer.id });
  }

  // ───────────────────────── utilitaires ─────────────────────────

  #welcome(peer) {
    const peers = [...(this.#rooms.get(peer.room) ?? [])]
      .filter((id) => id !== peer.id)
      .map((id) => this.#info(this.#peers.get(id)));
    this.#send(peer, {
      type: 'welcome',
      id: peer.id,
      token: peer.token,
      room: this.rooms ? peer.room : '',
      mode: this.rooms ? 'public' : 'local',
      relay: this.allowRelay,
      peers,
    });
  }

  #info({ id, name, device }) {
    return { id, name, device };
  }

  #newId() {
    let id;
    do id = randomBytes(ID_LENGTH / 2).toString('hex');
    while (this.#peers.has(id));
    return id;
  }

  #newRoomCode() {
    let code;
    do {
      const bytes = randomBytes(ROOM_LENGTH);
      code = Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
    } while (this.#rooms.has(code));
    return code;
  }

  #sendRaw(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  #send(peer, message) {
    if (peer.ws) this.#sendRaw(peer.ws, message);
  }

  #broadcast(from, message) {
    for (const id of this.#rooms.get(from.room) ?? []) {
      if (id !== from.id) this.#send(this.#peers.get(id), message);
    }
  }
}
