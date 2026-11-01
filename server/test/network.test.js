import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, lanAddresses, networkLabel } from '../src/network.js';

const v4 = (address, internal = false) => [{ family: 'IPv4', address, internal }];

// Le cas réel d'un PC Windows : wifi, point d'accès mobile, carte WSL.
const windows = {
  'vEthernet (WSL (Hyper-V firewall))': v4('172.27.16.1'),
  'Connexion au réseau local* 10': v4('192.168.137.1'),
  'Wi-Fi': v4('192.168.6.55'),
  'Loopback Pseudo-Interface 1': v4('127.0.0.1', true),
};

test('ne propose pas les cartes virtuelles et met le wifi en premier', () => {
  const nets = lanAddresses(windows);
  assert.deepEqual(nets.map((n) => n.address), ['192.168.6.55', '192.168.137.1']);
  assert.equal(nets[0].kind, 'lan');
  assert.equal(nets[1].kind, 'hotspot');
});

test('nomme le point d’accès de façon compréhensible', () => {
  const [wifi, hotspot] = lanAddresses(windows);
  assert.equal(networkLabel(wifi), 'Wi-Fi');
  assert.equal(networkLabel(hotspot), 'Point d’accès de ce PC');
});

test('garde les cartes virtuelles si c’est tout ce qui existe', () => {
  const nets = lanAddresses({ 'vEthernet (Default Switch)': v4('172.20.0.1') });
  assert.deepEqual(nets.map((n) => n.address), ['172.20.0.1']);
});

test('un câble direct sans DHCP (169.254.x.x) reste proposé, après les réseaux privés', () => {
  const nets = classify({ Ethernet: v4('169.254.10.2'), 'Wi-Fi': v4('10.0.0.8') });
  assert.deepEqual(nets.map((n) => n.address), ['10.0.0.8', '169.254.10.2']);
});
