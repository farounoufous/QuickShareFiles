/**
 * Connexion directe entre deux appareils SANS serveur : ils échangent deux codes (QR ou texte).
 *
 *   A : createOffer()        -> code A (QR)
 *   B : acceptOffer(code A)  -> code B (QR)
 *   A : acceptAnswer(code B) -> les deux appareils sont reliés en WebRTC, sur le réseau local.
 *
 * Aucun serveur de signalisation, aucun serveur STUN : seuls les appareils du même réseau
 * (wifi sans Internet, point d'accès d'un téléphone, câble) peuvent se joindre.
 */

const PREFIX = 'WD1';
const GATHER_TIMEOUT = 4000;

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Code court : JSON compressé (deflate) puis base64url, avec un préfixe de version. */
export async function encodeCode(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'undefined') return `${PREFIX}r${toBase64Url(raw)}`;
  return `${PREFIX}z${toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`;
}

export async function decodeCode(code) {
  const text = String(code ?? '').replace(/\s+/g, '');
  if (!text.startsWith(PREFIX) || text.length < PREFIX.length + 2) throw new Error('Ce code n’est pas valide.');
  const mode = text[PREFIX.length];
  let bytes;
  try {
    bytes = fromBase64Url(text.slice(PREFIX.length + 1));
    if (mode === 'z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('unsupported');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (mode !== 'r') {
      throw new Error('mode');
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof payload?.sdp !== 'string' || !['offer', 'answer'].includes(payload.t)) throw new Error('forme');
    return payload;
  } catch {
    throw new Error('Ce code n’est pas valide ou a été copié de façon incomplète.');
  }
}

/**
 * Allège le SDP pour que le QR code reste lisible : on garde les candidats réseau UDP en IPv4
 * (ou nom .local), on retire IPv6, TCP et les adresses de rebouclage.
 */
export function compactSdp(sdp) {
  return sdp
    .split(/\r?\n/)
    .filter((line) => {
      if (!line.startsWith('a=candidate:')) return line.length > 0;
      const parts = line.split(' ');
      const protocol = parts[2]?.toLowerCase();
      const address = parts[4] ?? '';
      if (protocol !== 'udp') return false;
      if (address.includes(':')) return false; // IPv6
      if (address.startsWith('127.') || address.startsWith('169.254.')) return false;
      return true;
    })
    .join('\r\n')
    .concat('\r\n');
}

function gathered(pc, timeoutMs = GATHER_TIMEOUT) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve();
    };
    const onState = () => pc.iceGatheringState === 'complete' && done();
    const onCandidate = (event) => !event.candidate && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

export class OfflineSession {
  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    // Canal de contrôle négocié d'avance : demandes, acceptations, textes.
    this.control = this.pc.createDataChannel('control', { negotiated: true, id: 0 });
  }

  async createOffer() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return encodeCode({ t: 'offer', sdp: compactSdp(this.pc.localDescription.sdp) });
  }

  async acceptOffer(code) {
    const payload = await decodeCode(code);
    if (payload.t !== 'offer') throw new Error('Ce code est un code de réponse. Scannez le code affiché par le premier appareil.');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return encodeCode({ t: 'answer', sdp: compactSdp(this.pc.localDescription.sdp) });
  }

  async acceptAnswer(code) {
    const payload = await decodeCode(code);
    if (payload.t !== 'answer') throw new Error('Ce code est un code de départ. Scannez le code de réponse affiché par l’autre appareil.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
  }

  close() {
    try {
      this.control.close();
      this.pc.close();
    } catch {
      /* déjà fermé */
    }
  }
}
