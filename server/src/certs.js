import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import selfsigned from 'selfsigned';

/**
 * Certificat auto-signé pour servir l'app en HTTPS sur le réseau local.
 * Le HTTPS est nécessaire pour que le navigateur autorise l'écriture directe
 * sur le disque (File System Access API) sur une adresse du type 192.168.x.x.
 * Le certificat est conservé sur disque et régénéré si les adresses IP changent.
 */
const VERSION = 2; // incrémenter pour forcer la régénération des certificats déjà créés

export async function loadOrCreateCert(dir, ips) {
  const wanted = [...ips].sort().join(',');
  const files = { key: join(dir, 'key.pem'), cert: join(dir, 'cert.pem'), meta: join(dir, 'meta.json') };

  try {
    const meta = JSON.parse(await readFile(files.meta, 'utf8'));
    if (meta.version === VERSION && meta.hosts === wanted && meta.expires > Date.now() + 7 * 864e5) {
      return { key: await readFile(files.key, 'utf8'), cert: await readFile(files.cert, 'utf8') };
    }
  } catch {
    /* pas de certificat valide : on en crée un */
  }

  const days = 365; // les navigateurs récents refusent les certificats valables plus de ~13 mois
  const notBeforeDate = new Date(Date.now() - 864e5);
  const notAfterDate = new Date(Date.now() + days * 864e5);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'wifidrop.local' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(files.key, pems.private, { mode: 0o600 });
    await writeFile(files.cert, pems.cert);
    await writeFile(files.meta, JSON.stringify({ version: VERSION, hosts: wanted, expires: notAfterDate.getTime() }));
  } catch {
    /* disque en lecture seule : le certificat reste valable pour cette session */
  }
  return { key: pems.private, cert: pems.cert };
}
