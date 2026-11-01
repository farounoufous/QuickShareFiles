import { reactive } from 'vue';
import { Signaling } from './signaling.js';
import { RelayTransport, RtcTransport } from './transports.js';
import { canSaveToDisk, createSaver, safeName } from './saver.js';
import { SpeedMeter } from './format.js';
import { getIdentity, saveName } from './device.js';
import {
  ACCEPT_TIMEOUT,
  ACK_EVERY,
  CHUNK,
  ID_PATTERN,
  MAX_RECONNECTS,
  MAX_TEXT,
  P2P_TIMEOUT,
  READ_BLOCK,
  READY_TIMEOUT,
  RESUME_TIMEOUT,
  WINDOW_P2P,
  WINDOW_RELAY,
  newTransferId,
} from './protocol.js';

/**
 * Cœur de l'application : salles, appareils à proximité, textes et transferts.
 *
 * Déroulé d'un envoi (A -> B) :
 *   A  --request {fichiers}-->  B        (métadonnées seulement, via le serveur ou le canal de contrôle)
 *   B  --accept-->  A                    (B a choisi où enregistrer : geste utilisateur)
 *   A  --offer / ice-->  B  --answer-->  connexion WebRTC directe
 *      (si elle n'est pas ouverte en 6 s : use-relay, les blocs passent par le serveur, si autorisé)
 *   B  --ready {fichier, décalage}-->  A    B dit où il en est : 0 au début, ailleurs après une coupure
 *   A  ==blocs 64 Ko==>  B               B confirme (ack) après écriture : c'est la fenêtre de contrôle de flux
 *   A  --done-->  B   B  --complete-->  A
 *
 * Coupure en cours de route : le transfert passe en « reconnecting », l'expéditeur rouvre un lien,
 * le récepteur répond « ready » avec ce qu'il a déjà écrit, et l'envoi repart de là.
 */

const FINAL = new Set(['done', 'error', 'declined', 'canceled']);
const BUSY = new Set(['waiting', 'connecting', 'transferring', 'reconnecting']);
const MAX_FILES = 500;
const MAX_TEXTS = 50;

export const isBusy = (transfer) => BUSY.has(transfer.status);

const read = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
};

export const normalizeRoom = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);

const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

export const state = reactive({
  mode: 'local', // 'local' : tous les appareils du réseau ; 'public' : salles à code
  relay: true, // le serveur accepte-t-il de relayer les blocs ?
  connected: false, // connecté au serveur (et, en mode public, dans une salle)
  serverDown: false, // le serveur est injoignable
  room: '',
  roomError: '',
  joining: false,
  me: { id: null, name: '', device: '' },
  peers: [], // { id, name, device, kind: 'server' | 'offline' }
  transfers: [],
  texts: [],
  wakeLock: false,
  info: { networks: [], httpsPort: 0 },
  secureContext: typeof window !== 'undefined' && window.isSecureContext,
  canSaveToDisk,
});

const readable = (error) =>
  error?.name === 'NotFoundError' || error?.name === 'NotReadableError'
    ? 'Fichier illisible : il a été déplacé ou supprimé.'
    : error?.name === 'QuotaExceededError'
      ? 'Espace de stockage insuffisant sur l’appareil récepteur.'
      : error?.message || 'Une erreur est survenue.';

/** Une erreur d'envoi qui vient du lien (et non du fichier ou du disque) se rattrape par une reprise. */
const isLinkError = (error) =>
  error?.name === 'InvalidStateError' || error?.name === 'NetworkError' || /Connexion au serveur perdue|Canal fermé/.test(error?.message ?? '');

class WifiDrop {
  #sig = null;
  #live = new Map(); // transferId -> données internes (non réactives)
  #links = new Map(); // peerId -> { kind: 'offline', pc, control } pour les appareils reliés sans serveur
  #ice = [];
  #want = null; // ce qu'on demande au serveur : { create: true } | { room } | {} (mode local)
  #infoLoaded = false;

  // ───────────────────────── Démarrage & salles ─────────────────────────

  async start() {
    const identity = getIdentity();
    state.me.name = identity.name;
    state.me.device = identity.device;

    await this.#loadInfo();
    this.#initWant();

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const sig = (this.#sig = new Signaling({
      url: `${scheme}://${location.host}/ws`,
      getHello: () => {
        if (!this.#infoLoaded) return null; // on ne sait pas encore si le serveur est en mode local ou public
        const me = { name: state.me.name, device: state.me.device };
        return this.#want ? { ...me, ...this.#want } : null;
      },
    }));

    // Page ouverte hors-ligne (depuis le cache), serveur de retour plus tard : on récupère alors sa configuration.
    sig.on('open', () => {
      if (this.#infoLoaded) return;
      this.#loadInfo().then((ok) => {
        if (!ok) return;
        this.#initWant();
        sig.hello();
      });
    });

    sig.on('welcome', ({ id, room, peers, identityChanged }) => {
      state.me.id = id;
      state.connected = true;
      state.serverDown = false;
      state.joining = false;
      state.roomError = '';
      state.room = room ?? '';
      state.peers = [
        ...state.peers.filter((p) => p.kind === 'offline'),
        ...peers.filter((p) => p.id !== id).map((p) => ({ ...p, kind: 'server' })),
      ];
      if (state.mode === 'public' && room) {
        this.#want = { room };
        write('wifidrop:room', room);
      }
      if (identityChanged) {
        // Le serveur nous a oublié : les autres appareils ne savent plus nous joindre.
        for (const live of [...this.#live.values()]) {
          if (this.#links.get(live.peerId)?.kind !== 'offline') this.#fail(live, 'Reconnexion impossible : session perdue');
        }
      } else {
        this.#resumeAll();
      }
    });

    sig.on('error', ({ code }) => {
      state.roomError = code;
      state.joining = false;
      if (code === 'room-not-found' || code === 'room-required') {
        this.#want = null;
        write('wifidrop:room', null);
      }
    });

    sig.on('close', () => {
      state.connected = false;
      state.serverDown = true;
      state.peers = state.peers.filter((p) => p.kind === 'offline');
      for (const live of [...this.#live.values()]) {
        // Les transferts directs continuent sans serveur ; ceux qui passent par le relais reprendront.
        if (live.transport && live.transport === live.relayTransport) this.#linkLost(live);
      }
    });

    sig.on('peer-joined', ({ peer }) => {
      if (peer.id !== state.me.id && !state.peers.some((p) => p.id === peer.id)) state.peers.push({ ...peer, kind: 'server' });
    });
    sig.on('peer-updated', ({ peer }) => {
      const i = state.peers.findIndex((p) => p.id === peer.id);
      if (i >= 0) state.peers[i] = { ...peer, kind: 'server' };
    });
    sig.on('peer-left', ({ id }) => this.#removePeer(id));
    sig.on('signal', ({ from, data }) => this.#onSignal(from, data));
    sig.on('binary', ({ from, transferId, payload }) => {
      const live = this.#live.get(transferId);
      if (live && live.peerId === from) live.relayTransport?.deliver(payload);
    });

    sig.connect();
  }

  async #loadInfo() {
    try {
      const response = await fetch('/api/info', { cache: 'no-store' });
      const info = await response.json();
      Object.assign(state.info, info);
      state.mode = info.mode === 'public' ? 'public' : 'local';
      state.relay = info.relay !== false;
      this.#ice = info.iceServers ?? [];
      this.#infoLoaded = true;
      state.serverDown = false;
    } catch {
      state.serverDown = true; // le mode hors-ligne par QR code reste disponible
    }
    return this.#infoLoaded;
  }

  /** Ce qu'on demande au serveur à la connexion : tout le réseau (local) ou une salle (public). */
  #initWant() {
    if (state.mode === 'public') {
      const fromLink = normalizeRoom(new URLSearchParams(location.search).get('salle'));
      const room = fromLink || normalizeRoom(read('wifidrop:room'));
      this.#want = room ? { room } : null;
      state.joining = Boolean(room);
      if (fromLink) history.replaceState(null, '', location.pathname);
    } else {
      this.#want = {};
    }
  }

  createRoom() {
    state.roomError = '';
    state.joining = true;
    this.#want = { create: true };
    this.#sig?.hello();
  }

  joinRoom(code) {
    const room = normalizeRoom(code);
    if (!room) return;
    state.roomError = '';
    state.joining = true;
    this.#want = { room };
    this.#sig?.hello();
  }

  leaveRoom() {
    if (state.mode !== 'public') return;
    for (const live of [...this.#live.values()]) {
      if (this.#links.get(live.peerId)?.kind !== 'offline') this.#end(live, 'canceled');
    }
    this.#want = null;
    write('wifidrop:room', null);
    state.room = '';
    state.roomError = '';
    state.connected = false;
    state.peers = state.peers.filter((p) => p.kind === 'offline');
    this.#sig?.reset();
  }

  rename(name) {
    const clean = cleanText(name, 40);
    if (!clean || clean === state.me.name) return;
    state.me.name = clean;
    saveName(clean);
    this.#sig?.hello();
    for (const link of this.#links.values()) {
      if (link.control.readyState === 'open') {
        link.control.send(JSON.stringify({ s: { kind: 'hello', name: clean, device: state.me.device } }));
      }
    }
  }

  #removePeer(id) {
    state.peers = state.peers.filter((p) => p.id !== id);
    const link = this.#links.get(id);
    if (link) {
      this.#links.delete(id);
      link.control.onmessage = link.control.onclose = null;
      link.pc.onconnectionstatechange = link.pc.ondatachannel = null;
      link.pc.close();
    }
    for (const live of [...this.#live.values()]) {
      if (live.peerId === id) this.#fail(live, `${live.state.peerName} n’est plus connecté.`);
    }
  }

  // ───────────────────────── Appareils reliés sans serveur (QR) ─────────────────────────

  /** Branche une session établie par échange de codes ; résout quand l'autre appareil s'est annoncé. */
  attachOffline(session) {
    return new Promise((resolve) => {
      const { pc, control } = session;
      const peerId = `off-${newTransferId()}`;
      const link = { kind: 'offline', pc, control, peerId };
      let announced = false;

      const hello = () =>
        control.send(JSON.stringify({ s: { kind: 'hello', name: state.me.name, device: state.me.device } }));
      control.onopen = hello;
      if (control.readyState === 'open') hello();

      control.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data).s;
        } catch {
          return;
        }
        if (!data) return;
        if (data.kind === 'hello') {
          const peer = { id: peerId, name: cleanText(data.name, 40) || 'Appareil', device: cleanText(data.device, 60), kind: 'offline' };
          if (!announced) {
            announced = true;
            this.#links.set(peerId, link);
            state.peers.push(peer);
            resolve(peer);
          } else {
            const i = state.peers.findIndex((p) => p.id === peerId);
            if (i >= 0) state.peers[i] = peer;
          }
          return;
        }
        if (announced) this.#onSignal(peerId, data);
      };

      // Côté récepteur d'un transfert, le canal arrive ici (l'expéditeur l'ouvre sur la connexion existante).
      pc.ondatachannel = ({ channel }) => {
        if (!channel.label.startsWith('t:')) return;
        const live = this.#live.get(channel.label.slice(2));
        if (!live || live.peerId !== peerId || live.role !== 'receive' || live.state.status !== 'connecting') {
          channel.close();
          return;
        }
        clearTimeout(live.waitTimer);
        const transport = new RtcTransport(channel);
        transport.onclose = () => this.#onTransportClosed(live, transport);
        this.#attachReceiver(live, transport);
      };

      let lostTimer;
      pc.onconnectionstatechange = () => {
        clearTimeout(lostTimer);
        const s = pc.connectionState;
        if (s === 'failed' || s === 'closed') this.#removePeer(peerId);
        else if (s === 'disconnected') lostTimer = setTimeout(() => pc.connectionState === 'disconnected' && this.#removePeer(peerId), 5000);
      };
    });
  }

  // ───────────────────────── Textes ─────────────────────────

  sendText(peerId, text) {
    const peer = state.peers.find((p) => p.id === peerId);
    const body = String(text ?? '').slice(0, MAX_TEXT);
    if (!peer || !body.trim()) return false;
    const ok = this.#signal(peerId, { kind: 'text', id: newTransferId(), text: body });
    this.#pushText({ direction: 'send', peerName: peer.name, text: body, failed: !ok });
    return ok;
  }

  dismissText(id) {
    state.texts = state.texts.filter((t) => t.id !== id);
  }

  #onText(from, data) {
    const peer = state.peers.find((p) => p.id === from);
    const text = typeof data.text === 'string' ? data.text.slice(0, MAX_TEXT) : '';
    if (!peer || !text.trim()) return;
    this.#pushText({ direction: 'receive', peerName: peer.name, text });
  }

  #pushText(item) {
    state.texts.unshift({ id: newTransferId(), createdAt: Date.now(), failed: false, ...item });
    if (state.texts.length > MAX_TEXTS) state.texts.length = MAX_TEXTS;
  }

  // ───────────────────────── Envoi ─────────────────────────

  send(peerId, fileList) {
    const files = [...fileList].slice(0, MAX_FILES);
    const peer = state.peers.find((p) => p.id === peerId);
    if (!files.length || !peer || peer.id === state.me.id) return; // on ne s'envoie jamais un fichier à soi-même

    const id = newTransferId();
    const st = this.#newState(id, 'send', peer, files);
    const live = { id, role: 'send', peerId, state: st, files, acked: 0, progress: 0, runId: 0 };
    this.#live.set(id, live);

    const sent = this.#signal(peerId, {
      kind: 'request',
      transferId: id,
      files: files.map((f) => ({ name: f.name, size: f.size })),
    });
    if (!sent) this.#fail(live, 'Appareil injoignable');
  }

  /** Envoie les mêmes fichiers à plusieurs appareils : un transfert indépendant par destinataire. */
  sendMany(peerIds, fileList) {
    const files = [...fileList];
    const targets = [...new Set(peerIds)].filter((id) => id !== state.me.id && state.peers.some((p) => p.id === id));
    for (const id of targets) this.send(id, files);
    return targets.length;
  }

  /** Envoie les mêmes fichiers à tous les autres occupants de la salle ; chacun accepte ou refuse pour lui. */
  sendToAll(fileList) {
    return this.sendMany(
      state.peers.map((p) => p.id),
      fileList,
    );
  }

  #startP2P(live) {
    const st = live.state;
    st.status = 'connecting';
    live.settled = false;
    live.pendingIce = [];

    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: this.#ice });
    } catch {
      return this.#p2pFailed(live);
    }
    live.pc = pc;

    const channel = pc.createDataChannel('wifidrop', { ordered: true });
    live.p2pTimer = setTimeout(() => this.#p2pFailed(live), P2P_TIMEOUT);

    channel.onopen = () => {
      if (live.settled || live.aborted || live.pc !== pc) return;
      live.settled = true;
      clearTimeout(live.p2pTimer);
      const transport = new RtcTransport(channel);
      transport.onclose = () => this.#onTransportClosed(live, transport);
      this.#armSender(live, transport);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.#signal(live.peerId, { kind: 'ice', transferId: live.id, candidate: e.candidate.toJSON() });
    };
    this.#watchConnection(live, pc);

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() =>
        this.#signal(live.peerId, {
          kind: 'offer',
          transferId: live.id,
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        }),
      )
      .catch(() => this.#p2pFailed(live));
  }

  /** Appareil relié sans serveur : le transfert ouvre un canal de plus sur la connexion existante. */
  #startOffline(live) {
    const link = this.#links.get(live.peerId);
    if (!link) return this.#fail(live, 'L’appareil n’est plus connecté.');
    live.state.status = 'connecting';
    live.settled = false;

    let channel;
    try {
      channel = link.pc.createDataChannel(`t:${live.id}`, { ordered: true });
    } catch {
      return this.#fail(live, 'L’appareil n’est plus connecté.');
    }
    live.p2pTimer = setTimeout(() => this.#fail(live, 'Connexion impossible. Reconnectez les deux appareils, puis réessayez.', true), P2P_TIMEOUT * 2);
    channel.onopen = () => {
      if (live.settled || live.aborted) return;
      live.settled = true;
      clearTimeout(live.p2pTimer);
      const transport = new RtcTransport(channel);
      transport.onclose = () => this.#onTransportClosed(live, transport);
      this.#armSender(live, transport);
    };
  }

  /** La connexion directe n'a pas abouti : relais du serveur si autorisé, sinon explication claire. */
  #p2pFailed(live) {
    if (live.settled || live.aborted) return;
    clearTimeout(live.p2pTimer);
    if (state.relay && this.#sig?.ready) return this.#useRelay(live);

    live.pc?.close();
    live.pc = null;
    if (live.state.reconnects && live.state.reconnects < MAX_RECONNECTS) {
      live.settled = true;
      return this.#linkLost(live, true);
    }
    this.#fail(
      live,
      state.relay
        ? 'Connexion au serveur perdue'
        : 'Connexion directe impossible. Vérifiez que les deux appareils sont sur le même réseau wifi ou le même point d’accès, puis réessayez.',
      true,
    );
  }

  #useRelay(live) {
    if (live.settled || live.aborted) return;
    live.settled = true;
    clearTimeout(live.p2pTimer);
    const pc = live.pc;
    live.pc = null;
    pc?.close();
    this.#signal(live.peerId, { kind: 'use-relay', transferId: live.id });
    const transport = (live.relayTransport = new RelayTransport(this.#sig, live.peerId, live.id));
    this.#armSender(live, transport);
  }

  /** Le lien est prêt : on attend que le récepteur dise où il en est (« ready »). */
  #armSender(live, transport) {
    if (live.aborted) return;
    live.transport = transport;
    live.state.transport = transport.kind;
    clearTimeout(live.resumeTimer);
    clearTimeout(live.readyTimer);
    live.readyTimer = setTimeout(() => this.#linkLost(live), READY_TIMEOUT);
    transport.onmessage = (data) => this.#onSenderMessage(live, transport, data);
  }

  #onSenderMessage(live, transport, data) {
    if (live.aborted || live.transport !== transport || typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'ready':
        clearTimeout(live.readyTimer);
        this.#pump(live, transport, msg);
        break;
      case 'ack':
        live.acked = live.progress = Math.max(live.acked, Math.min(Number(msg.bytes) || 0, live.state.totalBytes));
        live.wake?.();
        break;
      case 'complete':
        live.progress = live.state.totalBytes;
        this.#finish(live);
        break;
      case 'cancel':
        this.#end(live, 'canceled');
        break;
      case 'error':
        this.#fail(live, msg.message || 'Erreur signalée par le récepteur.');
        break;
    }
  }

  /** Envoie les fichiers à partir de l'endroit indiqué par le récepteur (le début, ou le point de reprise). */
  async #pump(live, transport, ready) {
    const st = live.state;
    const { files } = live;
    const fileIndex = Number(ready.fileIndex);
    const offset = Number(ready.offset);
    const received = Number(ready.received);

    const before = files.slice(0, Math.max(0, fileIndex)).reduce((sum, f) => sum + f.size, 0);
    const valid =
      Number.isInteger(fileIndex) && fileIndex >= 0 && fileIndex <= files.length &&
      Number.isFinite(offset) && offset >= 0 &&
      (fileIndex === files.length ? offset === 0 : offset <= files[fileIndex].size) &&
      received === before + offset;
    if (!valid) return this.#fail(live, 'Reprise impossible : les deux appareils ne sont pas synchronisés.', true);

    const run = ++live.runId;
    const alive = () => !live.aborted && live.runId === run && live.transport === transport;
    const window = transport.kind === 'p2p' ? WINDOW_P2P : WINDOW_RELAY;

    st.status = 'transferring';
    st.startedAt ??= Date.now();
    if (!live.meter) this.#startMeter(live);
    live.acked = live.progress = received;
    let sent = received;

    try {
      for (let index = fileIndex; index < files.length; index++) {
        const file = files[index];
        const from = index === fileIndex ? offset : 0;
        st.current = file.name;
        transport.send(JSON.stringify({ t: 'file', index, name: file.name, size: file.size, offset: from }));

        const readBlock = (position) => {
          const promise = file.slice(position, Math.min(position + READ_BLOCK, file.size)).arrayBuffer();
          promise.catch(() => {}); // l'erreur sera levée à l'await ; évite un avertissement si on abandonne
          return promise;
        };
        let pending = from < file.size ? readBlock(from) : null;

        for (let position = from; position < file.size; position += READ_BLOCK) {
          let buffer;
          try {
            buffer = await pending;
          } catch (error) {
            throw Object.assign(new Error(readable(error)), { fatal: true });
          }
          if (!alive()) return;
          const next = position + READ_BLOCK;
          pending = next < file.size ? readBlock(next) : null; // lit la tranche suivante pendant l'envoi

          for (let p = 0; p < buffer.byteLength; p += CHUNK) {
            while (alive() && sent - live.acked >= window) {
              await new Promise((resolve) => (live.wake = resolve));
            }
            if (!alive()) return;
            const piece = new Uint8Array(buffer, p, Math.min(CHUNK, buffer.byteLength - p));
            transport.send(piece);
            sent += piece.byteLength;
          }
        }
        if (!alive()) return;
        transport.send(JSON.stringify({ t: 'file-end' }));
      }
      if (alive()) transport.send(JSON.stringify({ t: 'done' }));
    } catch (error) {
      if (!alive()) return;
      if (error.fatal || !isLinkError(error)) this.#fail(live, readable(error), true);
      else this.#linkLost(live);
    }
  }

  // ───────────────────────── Réception ─────────────────────────

  #onRequest(from, data) {
    const id = data.transferId;
    if (!ID_PATTERN.test(String(id)) || this.#live.has(id) || !Array.isArray(data.files)) return;

    const files = data.files
      .slice(0, MAX_FILES)
      .map((f) => ({ name: safeName(f?.name), size: Number(f?.size) }))
      .filter((f) => Number.isFinite(f.size) && f.size >= 0);
    const peer = state.peers.find((p) => p.id === from);
    if (!files.length || !peer) return;

    const st = this.#newState(id, 'receive', peer, files);
    st.status = 'pending';
    this.#live.set(id, {
      id, role: 'receive', peerId: from, state: st, files,
      received: 0, lastAck: 0, progress: 0, filesDone: 0, fileIndex: -1, fileGot: 0, fileSize: 0, runId: 0,
    });
  }

  /** À appeler depuis le clic « Accepter » : le sélecteur de fichier exige un geste de l'utilisateur. */
  async accept(id) {
    const live = this.#live.get(id);
    if (!live || live.state.status !== 'pending') return;

    let saver;
    try {
      saver = await createSaver(live.files);
    } catch (error) {
      if (error?.name === 'AbortError') return; // sélecteur fermé : la demande reste en attente
      return this.#fail(live, readable(error));
    }
    if (live.state.status !== 'pending') return; // annulée pendant le choix

    live.saver = saver;
    live.state.status = 'connecting';
    live.state.saveMode = saver.mode;
    this.#signal(live.peerId, { kind: 'accept', transferId: id });
    live.waitTimer = setTimeout(() => this.#fail(live, 'L’expéditeur ne répond pas.'), ACCEPT_TIMEOUT);
  }

  decline(id) {
    const live = this.#live.get(id);
    if (!live || live.state.status !== 'pending') return;
    this.#signal(live.peerId, { kind: 'decline', transferId: id });
    this.#end(live, 'declined');
  }

  async #onOffer(live, data) {
    if (live.role !== 'receive' || !['connecting', 'reconnecting', 'transferring'].includes(live.state.status)) return;
    // Une nouvelle offre alors qu'un lien existe : l'expéditeur a perdu le lien, on repart de zéro côté lien.
    if (live.pc || live.transport) this.#dropLink(live);
    clearTimeout(live.waitTimer);
    clearTimeout(live.resumeTimer);
    live.state.status = live.state.startedAt ? 'reconnecting' : 'connecting';
    live.pendingIce = [];

    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: this.#ice });
    } catch {
      return this.#fail(live, 'Ce navigateur ne prend pas en charge WebRTC.', true);
    }
    live.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.#signal(live.peerId, { kind: 'ice', transferId: live.id, candidate: e.candidate.toJSON() });
    };
    pc.ondatachannel = ({ channel }) => {
      if (live.pc !== pc || live.aborted) return;
      const transport = new RtcTransport(channel);
      transport.onclose = () => this.#onTransportClosed(live, transport);
      this.#attachReceiver(live, transport);
    };
    this.#watchConnection(live, pc);
    live.resumeTimer = setTimeout(() => this.#fail(live, 'Connexion perdue : reprise impossible'), RESUME_TIMEOUT);

    try {
      await pc.setRemoteDescription(data.sdp);
      for (const candidate of live.pendingIce.splice(0)) pc.addIceCandidate(candidate).catch(() => {});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.#signal(live.peerId, {
        kind: 'answer',
        transferId: live.id,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
    } catch {
      // L'expéditeur basculera sur le relais, ou réessaiera, après le délai.
    }
  }

  #attachReceiver(live, transport) {
    if (live.aborted) return;
    live.transport?.detach?.();
    live.transport = transport;
    clearTimeout(live.resumeTimer);
    live.state.transport = transport.kind;
    live.state.status = 'transferring';
    live.state.startedAt ??= Date.now();
    if (!live.meter) this.#startMeter(live);
    live.queue ??= Promise.resolve();

    // Les messages sont traités un par un, dans l'ordre : l'écriture disque est asynchrone.
    transport.onmessage = (data) => {
      live.queue = live.queue
        .then(() => this.#onReceiverMessage(live, transport, data))
        .catch((error) => this.#onTransportError(live, error));
    };
    // Dès que le lien est ouvert, on dit à l'expéditeur où on en est (0 au début, ailleurs après une coupure).
    live.queue = live.queue
      .then(() => transport.whenOpen())
      .then(() => {
        if (live.aborted || live.transport !== transport) return;
        const position = live.writer
          ? { fileIndex: live.fileIndex, offset: live.fileGot }
          : { fileIndex: live.filesDone, offset: 0 };
        live.lastAck = live.received;
        transport.send(JSON.stringify({ t: 'ready', ...position, received: live.received }));
      })
      .catch((error) => this.#onTransportError(live, error));
  }

  async #onReceiverMessage(live, transport, data) {
    if (live.aborted || live.transport !== transport) return;

    if (typeof data !== 'string') {
      if (!live.writer || live.fileGot + data.byteLength > live.fileSize) throw new Error('Données inattendues');
      await live.writer.write(data);
      live.fileGot += data.byteLength;
      live.received += data.byteLength;
      live.progress = live.received;
      if (live.received - live.lastAck >= ACK_EVERY) this.#ack(live, transport);
      return;
    }

    const msg = JSON.parse(data);
    switch (msg.t) {
      case 'file': {
        const meta = live.files[msg.index];
        if (!meta || meta.size !== Number(msg.size)) throw new Error('Fichier non annoncé');
        if (live.writer) {
          // Reprise après coupure : le fichier est déjà ouvert, l'expéditeur doit repartir de là où on s'est arrêté.
          if (live.fileIndex !== msg.index || live.fileGot !== Number(msg.offset)) throw new Error('Reprise incohérente');
        } else {
          if (msg.index !== live.filesDone || Number(msg.offset) !== 0) throw new Error('Fichier hors séquence');
          live.writer = await live.saver.open(meta);
          live.fileIndex = msg.index;
          live.fileSize = meta.size;
          live.fileGot = 0;
        }
        live.state.current = meta.name;
        break;
      }
      case 'file-end': {
        if (!live.writer) throw new Error('Fin de fichier inattendue');
        await live.writer.close();
        live.writer = null;
        if (live.fileGot !== live.fileSize) throw new Error('Fichier incomplet');
        live.filesDone = live.fileIndex + 1;
        this.#ack(live, transport);
        break;
      }
      case 'done': {
        if (live.received !== live.state.totalBytes) throw new Error('Transfert incomplet');
        transport.send(JSON.stringify({ t: 'complete', bytes: live.received }));
        this.#finish(live, 1500); // laisse le temps au message de partir avant de fermer la liaison
        break;
      }
      case 'cancel':
        this.#end(live, 'canceled');
        break;
      case 'error':
        this.#fail(live, msg.message || 'Erreur signalée par l’expéditeur.');
        break;
    }
  }

  #ack(live, transport) {
    live.lastAck = live.received;
    transport.send(JSON.stringify({ t: 'ack', bytes: live.received }));
  }

  #onTransportError(live, error) {
    if (live.aborted) return;
    if (isLinkError(error)) this.#linkLost(live);
    else this.#fail(live, readable(error), true);
  }

  // ───────────────────────── Coupures et reprises ─────────────────────────

  /** Surveille la connexion WebRTC : une coupure en cours de transfert déclenche une reprise. */
  #watchConnection(live, pc) {
    let timer;
    pc.onconnectionstatechange = () => {
      clearTimeout(timer);
      const s = pc.connectionState;
      if (live.pc !== pc || live.aborted) return;
      if (s === 'failed' || s === 'closed') {
        if (live.transport) this.#linkLost(live);
        else if (live.role === 'send' && s === 'failed') this.#p2pFailed(live);
      } else if (s === 'disconnected') {
        // Souvent passager (changement de point d'accès) : on laisse 4 s au réseau pour revenir.
        timer = setTimeout(() => {
          if (live.pc === pc && pc.connectionState === 'disconnected' && live.transport) this.#linkLost(live);
        }, 4000);
      }
    };
  }

  #onTransportClosed(live, transport) {
    // Court délai : lors d'une bascule vers le relais ou d'une fin normale, la fermeture est attendue.
    setTimeout(() => {
      if (live.transport === transport && !live.aborted) this.#linkLost(live);
    }, 600);
  }

  #dropLink(live) {
    live.runId++;
    clearTimeout(live.readyTimer);
    clearTimeout(live.p2pTimer);
    live.wake?.();
    const { transport, pc } = live;
    live.transport = null;
    live.pc = null;
    live.relayTransport = null;
    live.settled = false;
    transport?.close();
    pc?.close();
  }

  /** Le lien est perdu en cours de route : on garde tout ce qui est écrit et on tente de reprendre. */
  #linkLost(live, keepLink = false) {
    const st = live.state;
    if (live.aborted || FINAL.has(st.status) || st.status === 'reconnecting') return;
    if (!live.transport && !keepLink) return; // pas encore de lien établi : les délais de connexion s'en chargent
    if (this.#links.get(live.peerId)?.kind === 'offline') {
      return this.#fail(live, 'Connexion interrompue. La reprise n’est pas possible sans serveur.', true);
    }

    this.#dropLink(live);
    st.reconnects = (st.reconnects ?? 0) + 1;
    if (st.reconnects > MAX_RECONNECTS) return this.#fail(live, 'Connexion perdue');
    st.status = 'reconnecting';
    st.speed = 0;
    clearTimeout(live.resumeTimer);
    live.resumeTimer = setTimeout(() => this.#fail(live, 'Connexion perdue : reprise impossible'), RESUME_TIMEOUT);
    // L'expéditeur rouvre le lien ; le récepteur attend sa nouvelle offre.
    if (live.role === 'send') setTimeout(() => this.#tryResume(live), Math.min(8000, 700 * st.reconnects));
  }

  #tryResume(live) {
    if (live.aborted || live.role !== 'send' || live.state.status !== 'reconnecting') return;
    if (!this.#sig?.ready) return; // reprendra dès le retour du serveur (voir #resumeAll)
    this.#startP2P(live);
  }

  #resumeAll() {
    for (const live of this.#live.values()) {
      if (live.role === 'send' && live.state.status === 'reconnecting') setTimeout(() => this.#tryResume(live), 300);
    }
  }

  // ───────────────────────── Annulation & états ─────────────────────────

  cancel(id) {
    const live = this.#live.get(id);
    if (!live || FINAL.has(live.state.status)) return;
    if (live.state.status === 'pending') return this.decline(id);
    try {
      if (live.transport) live.transport.send(JSON.stringify({ t: 'cancel' }));
      else this.#signal(live.peerId, { kind: 'cancel', transferId: id });
    } catch {
      this.#signal(live.peerId, { kind: 'cancel', transferId: id });
    }
    this.#end(live, 'canceled', 400);
  }

  clearFinished() {
    state.transfers = state.transfers.filter((t) => !FINAL.has(t.status));
  }

  #fail(live, message, notify = false) {
    if (FINAL.has(live.state.status)) return;
    if (notify && live.transport) {
      try {
        live.transport.send(JSON.stringify({ t: 'error', message }));
      } catch {
        /* lien coupé */
      }
    }
    live.state.error = message;
    this.#end(live, 'error', notify ? 400 : 0);
  }

  #finish(live, closeDelay = 0) {
    if (FINAL.has(live.state.status)) return;
    const st = live.state;
    this.#flush(live);
    st.doneBytes = st.totalBytes;
    st.endedAt = Date.now();
    st.avgSpeed = st.totalBytes / Math.max(0.001, (st.endedAt - (st.startedAt ?? st.endedAt)) / 1000);
    this.#end(live, 'done', closeDelay);
  }

  #end(live, status, closeDelay = 0) {
    const st = live.state;
    if (FINAL.has(st.status)) return;
    this.#flush(live);
    st.status = status;
    st.speed = 0;
    st.endedAt ??= Date.now();
    live.aborted = true;
    live.runId++;
    clearInterval(live.timer);
    for (const name of ['p2pTimer', 'waitTimer', 'readyTimer', 'resumeTimer']) clearTimeout(live[name]);
    live.wake?.();
    if (status !== 'done') live.writer?.abort?.();
    this.#live.delete(live.id);
    setTimeout(() => {
      live.transport?.close();
      live.pc?.close();
    }, closeDelay);
  }

  // ───────────────────────── Signalisation ─────────────────────────

  #signal(to, data) {
    const link = this.#links.get(to);
    if (link) {
      try {
        if (link.control.readyState !== 'open') return false;
        link.control.send(JSON.stringify({ s: data }));
        return true;
      } catch {
        return false;
      }
    }
    return this.#sig?.send({ type: 'signal', to, data }) ?? false;
  }

  #onSignal(from, data) {
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'request') return this.#onRequest(from, data);
    if (data.kind === 'text') return this.#onText(from, data);

    const live = this.#live.get(data.transferId);
    if (!live || live.peerId !== from) return; // inconnu, ou envoyé par un autre appareil

    switch (data.kind) {
      case 'accept':
        if (live.role === 'send' && live.state.status === 'waiting') {
          this.#links.get(from)?.kind === 'offline' ? this.#startOffline(live) : this.#startP2P(live);
        }
        break;
      case 'decline':
        this.#end(live, 'declined');
        break;
      case 'cancel':
        this.#end(live, 'canceled');
        break;
      case 'offer':
        this.#onOffer(live, data);
        break;
      case 'answer':
        if (live.role === 'send' && live.pc && !live.pc.remoteDescription) {
          const pc = live.pc;
          pc.setRemoteDescription(data.sdp)
            .then(() => {
              for (const c of live.pendingIce.splice(0)) pc.addIceCandidate(c).catch(() => {});
            })
            .catch(() => {});
        }
        break;
      case 'ice':
        if (live.pc?.remoteDescription) live.pc.addIceCandidate(data.candidate).catch(() => {});
        else live.pendingIce?.push(data.candidate);
        break;
      case 'use-relay':
        if (live.role === 'receive' && state.relay && live.state.status !== 'pending') {
          if (live.pc || live.transport) this.#dropLink(live);
          clearTimeout(live.waitTimer);
          clearTimeout(live.resumeTimer);
          live.relayTransport = new RelayTransport(this.#sig, live.peerId, live.id);
          this.#attachReceiver(live, live.relayTransport);
        }
        break;
      case 'relay':
        if (typeof data.text === 'string') live.relayTransport?.deliver(data.text);
        break;
    }
  }

  // ───────────────────────── Utilitaires ─────────────────────────

  #newState(id, direction, peer, files) {
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const st = reactive({
      id,
      direction,
      peerId: peer.id,
      peerName: peer.name,
      files: files.map((f) => ({ name: f.name, size: f.size })),
      title: files.length === 1 ? files[0].name : `${files.length} fichiers`,
      totalBytes,
      doneBytes: 0,
      speed: 0,
      avgSpeed: 0,
      current: '',
      status: direction === 'send' ? 'waiting' : 'pending',
      transport: null,
      saveMode: null,
      reconnects: 0,
      error: '',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    });
    state.transfers.unshift(st);
    return st;
  }

  /** Met à jour l'affichage 6 fois par seconde, sans ralentir le transfert. */
  #startMeter(live) {
    live.meter = new SpeedMeter();
    live.timer = setInterval(() => this.#flush(live), 160);
  }

  #flush(live) {
    if (!live.meter) return;
    live.state.doneBytes = live.progress;
    live.state.speed = live.state.status === 'transferring' ? live.meter.update(live.progress) : 0;
  }
}

export const drop = new WifiDrop();
