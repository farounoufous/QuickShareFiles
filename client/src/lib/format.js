const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];

/** 1536 -> { value: '1,5', unit: 'Ko' } (séparateur décimal français). */
export function splitBytes(bytes) {
  let n = Math.max(0, Number(bytes) || 0);
  let i = 0;
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = i === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return { value: n.toFixed(digits).replace('.', ','), unit: UNITS[i] };
}

export function formatBytes(bytes) {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Vitesse glissante sur ~2,5 s : stable à l'affichage, réactive aux ralentissements. */
export class SpeedMeter {
  #samples = [];

  update(bytes, now = performance.now()) {
    this.#samples.push([now, bytes]);
    while (this.#samples.length > 2 && now - this.#samples[0][0] > 2500) this.#samples.shift();
    const [t0, b0] = this.#samples[0];
    const dt = (now - t0) / 1000;
    return dt > 0.2 ? Math.max(0, (bytes - b0) / dt) : 0;
  }
}
