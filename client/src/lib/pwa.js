import { reactive } from 'vue';

export const pwa = reactive({
  canInstall: false, // le navigateur propose l'installation (Chrome, Edge, Android)
  installed: false,
  iosHint: false, // Safari sur iPhone : l'installation passe par le menu Partager
});

let deferredPrompt = null;

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function setupPwa() {
  pwa.installed = standalone();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    pwa.canInstall = true;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    pwa.canInstall = false;
    pwa.installed = true;
  });

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  pwa.iosHint = ios && !pwa.installed;

  // Le service worker n'existe que dans la version construite, sur une page sécurisée.
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  pwa.canInstall = false;
}
