const ANIMALS = [
  'Panthère', 'Lamantin', 'Caméléon', 'Pélican', 'Gazelle', 'Hippopotame', 'Flamant', 'Antilope',
  'Tortue', 'Buffle', 'Éléphant', 'Crocodile', 'Perroquet', 'Girafe', 'Colibri', 'Zèbre',
];

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le nom changera au prochain chargement */
  }
}

function detectDevice() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'macOS'
          : /Linux|X11/i.test(ua)
            ? 'Linux'
            : 'Appareil';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari/.test(ua)
            ? 'Safari'
            : 'Navigateur';
  return `${os}, ${browser}`;
}

export function getIdentity() {
  let name = read('wifidrop:name');
  if (!name) {
    name = `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]} ${Math.floor(10 + Math.random() * 90)}`;
    write('wifidrop:name', name);
  }
  return { name, device: detectDevice() };
}

export function saveName(name) {
  write('wifidrop:name', name);
}
