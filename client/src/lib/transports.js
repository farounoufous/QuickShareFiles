/**
 * Deux façons de faire passer messages (texte JSON) et blocs (binaire) entre deux appareils.
 * Même interface : send(), whenOpen(), onmessage, onclose, detach(), close(), kind.
 */

/** Connexion directe WebRTC (DataChannel) : les données ne passent par aucun serveur. */
export class RtcTransport {
  kind = 'p2p';
  onmessage = null;
  onclose = null;

  constructor(channel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event) => this.onmessage?.(event.data);
    channel.onclose = () => this.onclose?.();
    channel.onerror = () => {};
  }

  whenOpen() {
    if (this.channel.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.channel.addEventListener('open', () => resolve(), { once: true });
      this.channel.addEventListener('close', () => reject(new Error('Canal fermé')), { once: true });
    });
  }

  send(data) {
    this.channel.send(data);
  }

  detach() {
    this.onmessage = null;
    this.onclose = null;
  }

  close() {
    this.detach();
    try {
      this.channel.close();
    } catch {
      /* déjà fermé */
    }
  }
}

/** Secours : les blocs transitent par le serveur (si l'hébergeur l'autorise). */
export class RelayTransport {
  kind = 'relais';
  onmessage = null;
  onclose = null;

  constructor(signaling, peerId, transferId) {
    this.signaling = signaling;
    this.peerId = peerId;
    this.transferId = transferId;
  }

  whenOpen() {
    return Promise.resolve();
  }

  send(data) {
    if (typeof data === 'string') {
      const ok = this.signaling.send({
        type: 'signal',
        to: this.peerId,
        data: { kind: 'relay', transferId: this.transferId, text: data },
      });
      if (!ok) throw new Error('Connexion au serveur perdue');
    } else {
      this.signaling.sendBinary(this.peerId, this.transferId, data);
    }
  }

  deliver(data) {
    this.onmessage?.(data);
  }

  detach() {
    this.onmessage = null;
    this.onclose = null;
  }

  close() {
    this.detach();
  }
}
