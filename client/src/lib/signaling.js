import { ID_PATTERN } from './protocol.js';

const ID_LENGTH = 8;
const HEADER = ID_LENGTH * 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder('latin1');

/**
 * Connexion WebSocket au serveur : liste des appareils, signalisation WebRTC et relais binaire.
 * Se reconnecte seule et reprend son identité (id + jeton) pour ne pas perdre les transferts en cours.
 *
 * Événements : open, close, welcome, error, peer-joined, peer-updated, peer-left, signal, binary
 */
export class Signaling {
  #ws = null;
  #handlers = new Map();
  #retry = 0;
  #closed = false;
  #timer = null;

  /** getHello() renvoie le contenu du message d'accueil, ou null s'il ne faut pas encore s'annoncer. */
  constructor({ url, getHello }) {
    this.url = url;
    this.getHello = getHello;
    this.id = null;
    this.token = null;
  }

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event).delete(fn);
  }

  #emit(event, payload) {
    for (const fn of this.#handlers.get(event) ?? []) fn(payload);
  }

  connect() {
    this.#closed = false;
    clearTimeout(this.#timer);
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;

    ws.onopen = () => {
      this.#retry = 0;
      this.#emit('open');
      this.hello();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          const previous = this.id;
          this.id = msg.id;
          this.token = msg.token;
          msg.identityChanged = previous !== null && previous !== msg.id;
        }
        this.#emit(msg.type, msg);
      } else if (event.data.byteLength >= HEADER) {
        const head = decoder.decode(new Uint8Array(event.data, 0, HEADER));
        this.#emit('binary', {
          from: head.slice(0, ID_LENGTH),
          transferId: head.slice(ID_LENGTH),
          payload: new Uint8Array(event.data, HEADER),
        });
      }
    };

    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#emit('close');
      if (this.#closed) return;
      const delay = Math.min(5000, 400 * 2 ** this.#retry++);
      this.#timer = setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => {};
  }

  /** Se (ré)annonce au serveur, avec l'identité précédente si on en a une. */
  hello() {
    const hello = this.getHello();
    if (!hello) return false;
    const identity = this.id && this.token ? { id: this.id, token: this.token } : {};
    return this.send({ type: 'hello', ...hello, ...identity });
  }

  /** Quitte proprement (le serveur nous retire tout de suite) puis repart avec une identité neuve. */
  reset() {
    this.id = null;
    this.token = null;
    clearTimeout(this.#timer);
    const ws = this.#ws;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.onclose = null;
      ws.close(1000, 'quitte la salle');
    }
    this.#timer = setTimeout(() => this.connect(), 100);
  }

  get ready() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  send(message) {
    if (!this.ready) return false;
    this.#ws.send(JSON.stringify(message));
    return true;
  }

  /** Trame de relais : [id destinataire][id transfert][données]. */
  sendBinary(peerId, transferId, payload) {
    if (!this.ready || !ID_PATTERN.test(peerId) || !ID_PATTERN.test(transferId)) {
      throw new Error('Connexion au serveur perdue');
    }
    const frame = new Uint8Array(HEADER + payload.byteLength);
    frame.set(encoder.encode(peerId), 0);
    frame.set(encoder.encode(transferId), ID_LENGTH);
    frame.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), HEADER);
    this.#ws.send(frame);
  }
}
