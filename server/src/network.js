import os from 'node:os';

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

// Cartes réseau qui ne relient pas à d'autres appareils : WSL, Hyper-V, VM, Docker, Bluetooth…
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|vmnet|docker|veth|virbr|br-|bridge|loopback|bluetooth|utun|awdl|llw/i;

// Adresse que Windows donne à son « point d'accès sans fil mobile ».
const WINDOWS_HOTSPOT = /^192\.168\.137\./;

/**
 * Adresses IPv4 des cartes réseau, classées de la plus utile à la moins utile :
 *   'lan'     wifi ou câble classique
 *   'hotspot' point d'accès créé par ce PC
 *   'virtual' carte virtuelle (jamais proposée à l'utilisateur sauf s'il n'y a rien d'autre)
 * Le paramètre permet de tester avec de fausses interfaces.
 */
export function classify(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const kind = VIRTUAL.test(name) ? 'virtual' : WINDOWS_HOTSPOT.test(item.address) ? 'hotspot' : 'lan';
      found.push({ name, address: item.address, kind, private: PRIVATE.some((re) => re.test(item.address)) });
    }
  }
  const rank = (n) => (n.kind === 'virtual' ? 3 : !n.private ? 2 : n.kind === 'hotspot' ? 1 : 0);
  return found.sort((a, b) => rank(a) - rank(b));
}

/** Les réseaux à proposer : sans les cartes virtuelles, sauf si c'est tout ce qu'il y a. */
export function lanAddresses(interfaces) {
  const all = classify(interfaces);
  const usable = all.filter((n) => n.kind !== 'virtual');
  return usable.length ? usable : all;
}

export function networkLabel({ kind, name }) {
  return kind === 'hotspot' ? 'Point d’accès de ce PC' : name;
}
