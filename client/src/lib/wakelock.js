import { watch } from 'vue';
import { isBusy, state } from './wifidrop.js';

/**
 * Garde l'écran allumé tant qu'un transfert est en cours : les navigateurs mobiles suspendent
 * les onglets dont l'écran s'éteint, ce qui coupe le transfert.
 */
let sentinel = null;

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const anyBusy = () => state.transfers.some(isBusy);

async function acquire() {
  if (!wakeLockSupported || sentinel || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    sentinel = lock;
    state.wakeLock = true;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
      state.wakeLock = false;
    });
  } catch {
    /* refusé (économie d'énergie, page en arrière-plan) : l'app affiche un conseil à la place */
  }
}

async function release() {
  const lock = sentinel;
  sentinel = null;
  state.wakeLock = false;
  try {
    await lock?.release();
  } catch {
    /* déjà libéré */
  }
}

export function startWakeLock() {
  watch(anyBusy, (busy) => (busy ? acquire() : release()), { immediate: true });
  // Le verrou est perdu quand on quitte l'onglet : on le reprend au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && anyBusy()) acquire();
  });
}
