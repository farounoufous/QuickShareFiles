import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Hub, RateLimiter, normalizeRoom } from '../src/hub.js';
import { attachWebSocket, createRequestHandler } from '../src/app.js';

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wifidrop-'));
  await writeFile(join(dir, 'index.html'), '<h1>ok</h1>');
});

async function startServer(hubOptions = {}, wsOptions = {}) {
  const hub = new Hub(hubOptions);
  const server = http.createServer(createRequestHandler({ staticDir: dir, getInfo: () => ({ app: 'wifidrop' }) }));
  attachWebSocket(server, hub, wsOptions);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { hub, port: server.address().port, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

/** Client de test : file d'attente de messages JSON + binaires. */
async function connect(port, hello, { origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { headers: { Origin: origin } } : undefined);
  const queue = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    const item = isBinary ? { binary: data } : JSON.parse(data.toString());
    const w = waiters.shift();
    w ? w(item) : queue.push(item);
  });
  const next = (ms = 1500) =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const timer = setTimeout(() => reject(new Error('aucun message reçu')), ms);
      waiters.push((item) => (clearTimeout(timer), resolve(item)));
    });
  const nothing = (ms = 150) => new Promise((r) => setTimeout(() => r(queue.length === 0), ms));
  await new Promise((r) => ws.once('open', r));
  const client = { ws, next, nothing, id: null, token: null, welcome: null, send: (m) => ws.send(JSON.stringify(m)) };
  if (hello) {
    client.send({ type: 'hello', device: 'Test', ...hello });
    const reply = await next();
    if (reply.type === 'welcome') Object.assign(client, { welcome: reply, id: reply.id, token: reply.token });
    else client.error = reply;
  }
  return client;
}

describe('mode local', () => {
  let srv;
  before(async () => (srv = await startServer()));
  after(() => srv.close());

  test('annonce les appareils entre eux et à leur départ', async () => {
    const a = await connect(srv.port, { name: 'Alice' });
    const b = await connect(srv.port, { name: 'Bob' });

    assert.equal(a.welcome.mode, 'local');
    assert.deepEqual(await a.next(), { type: 'peer-joined', peer: { id: b.id, name: 'Bob', device: 'Test' } });
    assert.deepEqual(b.welcome.peers.map((p) => p.name), ['Alice']);

    b.send({ type: 'hello', name: 'Bobby', device: 'Test' });
    assert.equal((await a.next()).type, 'peer-updated');

    b.ws.close();
    const left = await a.next();
    assert.deepEqual(left, { type: 'peer-left', id: b.id });
    a.ws.close();
  });

  test('un appareil non annoncé ne peut pas signaler', async () => {
    const a = await connect(srv.port, { name: 'Alice2' });
    const ghost = await connect(srv.port, null);
    ghost.send({ type: 'signal', to: a.id, data: { x: 1 } });
    assert.ok(await a.nothing());
    a.ws.close();
    ghost.ws.close();
  });

  test('route la signalisation avec l’identité réelle de l’expéditeur', async () => {
    const a = await connect(srv.port, { name: 'Alice' });
    const b = await connect(srv.port, { name: 'Bob' });
    await a.next();
    a.send({ type: 'signal', to: b.id, from: 'usurpe', data: { kind: 'request' } });
    assert.deepEqual(await b.next(), { type: 'signal', from: a.id, data: { kind: 'request' } });
    a.ws.close();
    b.ws.close();
  });

  test('relaie les trames binaires en remplaçant le destinataire par l’expéditeur', async () => {
    const a = await connect(srv.port, { name: 'Alice' });
    const b = await connect(srv.port, { name: 'Bob' });
    await a.next();
    const frame = Buffer.concat([Buffer.from(b.id, 'latin1'), Buffer.from('deadbeef', 'latin1'), Buffer.from('contenu')]);
    a.ws.send(frame);
    const { binary } = await b.next();
    assert.equal(binary.toString('latin1', 0, 8), a.id);
    assert.equal(binary.toString('latin1', 8, 16), 'deadbeef');
    assert.equal(binary.subarray(16).toString(), 'contenu');
    a.ws.close();
    b.ws.close();
  });

  test('ignore les trames pour un destinataire inconnu ou trop courtes', async () => {
    const a = await connect(srv.port, { name: 'Alice' });
    const b = await connect(srv.port, { name: 'Bob' });
    await a.next();
    a.ws.send(Buffer.from('zzzzzzzz' + 'deadbeef' + 'x', 'latin1'));
    a.ws.send(Buffer.from('court'));
    a.send({ type: 'signal', to: b.id, data: 'marqueur' });
    assert.equal((await b.next()).data, 'marqueur');
    a.ws.close();
    b.ws.close();
  });

  test('refuse une connexion WebSocket venant d’un autre site', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { Origin: 'https://pirate.example' } });
    const code = await new Promise((r) => ws.once('unexpected-response', (_req, res) => r(res.statusCode)));
    assert.equal(code, 401);
  });

  test('sert l’interface, /api/info, /healthz, et bloque la traversée de dossiers', async () => {
    const get = (path) =>
      new Promise((resolve) =>
        http.get({ host: '127.0.0.1', port: srv.port, path }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        }),
      );
    const home = await get('/');
    assert.equal(home.body, '<h1>ok</h1>');
    assert.match(home.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(home.headers['x-frame-options'], 'DENY');
    assert.equal((await get('/une/route')).body, '<h1>ok</h1>'); // repli SPA
    assert.equal((await get('/api/info')).body, '{"app":"wifidrop"}');
    assert.equal((await get('/healthz')).body, 'ok');
    assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd')).body, '<h1>ok</h1>'); // jamais le vrai fichier
    assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd.txt')).status, 404);
    assert.equal((await get('/absent.js')).status, 404);
  });
});

describe('mode public (salles)', () => {
  let srv;
  before(async () => (srv = await startServer({ rooms: true, allowRelay: false, maxRoomPeers: 3, graceMs: 300 })));
  after(() => srv.close());

  test('crée une salle à code, qu’on rejoint sans tenir compte de la casse ni des espaces', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    assert.equal(a.welcome.mode, 'public');
    assert.match(a.welcome.room, /^[A-HJ-NP-Z2-9]{6}$/);

    const b = await connect(srv.port, { name: 'Bob', room: ` ${a.welcome.room.toLowerCase().slice(0, 3)}-${a.welcome.room.slice(3)} ` });
    assert.equal(b.welcome.room, a.welcome.room);
    assert.deepEqual(b.welcome.peers.map((p) => p.name), ['Alice']);
    assert.equal((await a.next()).peer.name, 'Bob');
    a.ws.close();
    b.ws.close();
  });

  test('les salles sont étanches : on ne voit ni ne contacte les autres salles', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    const x = await connect(srv.port, { name: 'Xavier', create: true });
    assert.notEqual(a.welcome.room, x.welcome.room);
    assert.deepEqual(x.welcome.peers, []);
    a.send({ type: 'signal', to: x.id, data: 'intrus' });
    assert.ok(await x.nothing());
    a.ws.close();
    x.ws.close();
  });

  test('refuse une salle inconnue, absente ou pleine', async () => {
    const none = await connect(srv.port, { name: 'A', room: 'ZZZZZZ' });
    assert.deepEqual(none.error, { type: 'error', code: 'room-not-found' });
    const empty = await connect(srv.port, { name: 'A' });
    assert.deepEqual(empty.error, { type: 'error', code: 'room-required' });

    const host = await connect(srv.port, { name: 'H', create: true });
    const room = host.welcome.room;
    const p2 = await connect(srv.port, { name: 'P2', room });
    const p3 = await connect(srv.port, { name: 'P3', room });
    const p4 = await connect(srv.port, { name: 'P4', room });
    assert.deepEqual(p4.error, { type: 'error', code: 'room-full' });
    for (const c of [none, empty, host, p2, p3, p4]) c.ws.close();
  });

  test('le relais est désactivé (blocs binaires et signaux de relais), pas le reste', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    const b = await connect(srv.port, { name: 'Bob', room: a.welcome.room });
    await a.next();
    a.ws.send(Buffer.concat([Buffer.from(b.id, 'latin1'), Buffer.from('deadbeef', 'latin1'), Buffer.from('x')]));
    a.send({ type: 'signal', to: b.id, data: { kind: 'relay', text: 'x' } });
    a.send({ type: 'signal', to: b.id, data: { kind: 'offer' } });
    assert.equal((await b.next()).data.kind, 'offer'); // les deux premiers ont été ignorés
    a.ws.close();
    b.ws.close();
  });

  test('reprend l’identité après une coupure sans que les autres le voient partir', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    const b = await connect(srv.port, { name: 'Bob', room: a.welcome.room });
    await a.next();

    b.ws.terminate(); // coupure brutale
    await new Promise((r) => setTimeout(r, 80));
    const b2 = await connect(srv.port, { name: 'Bob', id: b.id, token: b.token });
    assert.equal(b2.welcome.id, b.id);
    assert.equal(b2.welcome.room, a.welcome.room);
    assert.deepEqual(b2.welcome.peers.map((p) => p.name), ['Alice']);
    assert.ok(await a.nothing(600), 'Alice ne doit recevoir aucun « peer-left »');

    // Les messages arrivent bien sur la nouvelle connexion.
    a.send({ type: 'signal', to: b.id, data: 'toujours là' });
    assert.equal((await b2.next()).data, 'toujours là');
    a.ws.close();
    b2.ws.close();
  });

  test('annonce le départ une fois le délai de grâce écoulé', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    const b = await connect(srv.port, { name: 'Bob', room: a.welcome.room });
    await a.next();
    b.ws.terminate();
    assert.deepEqual(await a.next(2000), { type: 'peer-left', id: b.id });
    // L'ancien jeton ne permet plus rien : la salle de Bob est introuvable sans code.
    const late = await connect(srv.port, { name: 'Bob', id: b.id, token: b.token });
    assert.equal(late.error.code, 'room-required');
    a.ws.close();
    late.ws.close();
  });

  test('un mauvais jeton ne permet pas de prendre la place de quelqu’un', async () => {
    const a = await connect(srv.port, { name: 'Alice', create: true });
    const thief = await connect(srv.port, { name: 'Voleur', id: a.id, token: 'faux' });
    assert.equal(thief.error.code, 'room-required');
    a.send({ type: 'signal', to: a.id, data: 'moi' });
    assert.ok(await a.nothing());
    a.ws.close();
    thief.ws.close();
  });
});

describe('limites', () => {
  test('limite les tentatives d’entrée dans une salle par adresse IP', async () => {
    const srv = await startServer({ rooms: true, joinLimit: 3 });
    const answers = [];
    for (let i = 0; i < 5; i++) {
      const c = await connect(srv.port, { name: 'T', room: 'ZZZZZZ' });
      answers.push(c.error?.code);
      c.ws.close();
    }
    assert.deepEqual(answers, ['room-not-found', 'room-not-found', 'room-not-found', 'rate-limited', 'rate-limited']);
    await srv.close();
  });

  test('limite les connexions par adresse IP', async () => {
    const srv = await startServer({ connectLimit: 2 });
    const ok1 = await connect(srv.port, { name: 'A' });
    const ok2 = await connect(srv.port, { name: 'B' });
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const code = await new Promise((r) => ws.once('close', (c) => r(c)));
    assert.equal(code, 1013);
    ok1.ws.close();
    ok2.ws.close();
    await srv.close();
  });

  test('RateLimiter : fenêtre glissante', () => {
    const limiter = new RateLimiter(2, 1000);
    assert.equal(limiter.hit('ip', 0), true);
    assert.equal(limiter.hit('ip', 100), true);
    assert.equal(limiter.hit('ip', 200), false);
    assert.equal(limiter.hit('ip', 1500), true); // les anciens événements sont sortis de la fenêtre
    assert.equal(limiter.hit('autre', 200), true);
  });

  test('normalizeRoom', () => {
    assert.equal(normalizeRoom(' k7q-2mx '), 'K7Q2MX');
    assert.equal(normalizeRoom(null), '');
  });
});
