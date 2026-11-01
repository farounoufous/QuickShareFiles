<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import QRCode from 'qrcode';
import QrScanner from './QrScanner.vue';
import { OfflineSession } from '../lib/offline.js';
import { drop } from '../lib/wifidrop.js';
import { copyText } from '../lib/clipboard.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['close']);

const dialog = ref(null);
const role = ref(null); // 'host' : affiche le premier code ; 'guest' : scanne d'abord
const step = ref('choose'); // choose | show-offer | scan-offer | show-answer | connecting | done
const code = ref('');
const qr = ref('');
const manual = ref('');
const error = ref('');
const busy = ref(false);
const stream = ref(null);
const cameraDenied = ref(false);
const copied = ref(false);
const peerName = ref('');

let session = null;
let timeout = 0;
let connected = false;

async function qrSvg(text) {
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
}

/**
 * La caméra sert à scanner, mais aussi à obtenir les vraies adresses réseau :
 * sans autorisation de caméra, Chrome les masque derrière des noms que l'autre appareil ne sait pas toujours résoudre.
 */
async function askCamera() {
  cameraDenied.value = false;
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    cameraDenied.value = true;
    return;
  }
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    cameraDenied.value = true;
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach((track) => track.stop());
  stream.value = null;
}

function armTimeout() {
  clearTimeout(timeout);
  timeout = window.setTimeout(() => {
    if (connected) return;
    error.value = 'La connexion a échoué. Vérifiez que les deux appareils sont sur le même réseau, puis recommencez.';
    reset(false);
  }, 30_000);
}

function onConnected(peer) {
  connected = true;
  clearTimeout(timeout);
  peerName.value = peer.name;
  step.value = 'done';
  stopCamera();
  setTimeout(() => emit('close'), 1600);
}

function newSession() {
  session = new OfflineSession();
  drop.attachOffline(session).then(onConnected);
}

async function startHost() {
  role.value = 'host';
  error.value = '';
  busy.value = true;
  await askCamera();
  try {
    newSession();
    code.value = await session.createOffer();
    qr.value = await qrSvg(code.value);
    step.value = 'show-offer';
  } catch (e) {
    error.value = e.message || 'Le code n’a pas pu être créé.';
    reset(false);
  }
  busy.value = false;
}

async function startGuest() {
  role.value = 'guest';
  error.value = '';
  busy.value = true;
  await askCamera();
  step.value = 'scan-offer';
  busy.value = false;
}

async function receive(text) {
  if (busy.value || connected) return;
  error.value = '';
  const value = String(text ?? '').trim();
  if (!value) return;
  busy.value = true;
  try {
    if (role.value === 'host' && step.value === 'show-offer') {
      await session.acceptAnswer(value);
      step.value = 'connecting';
      armTimeout();
    } else if (role.value === 'guest' && step.value === 'scan-offer') {
      newSession();
      code.value = await session.acceptOffer(value);
      qr.value = await qrSvg(code.value);
      step.value = 'show-answer';
      armTimeout();
    }
    manual.value = '';
  } catch (e) {
    error.value = e.message || 'Code non reconnu.';
    if (role.value === 'guest' && step.value === 'scan-offer') {
      session?.close();
      session = null;
    }
  }
  busy.value = false;
}

async function copy() {
  copied.value = await copyText(code.value);
  setTimeout(() => (copied.value = false), 1800);
}

function reset(keepError = true) {
  clearTimeout(timeout);
  if (!connected) session?.close();
  session = null;
  stopCamera();
  role.value = null;
  step.value = 'choose';
  code.value = '';
  qr.value = '';
  manual.value = '';
  busy.value = false;
  if (!keepError) return;
  error.value = '';
}

function close() {
  emit('close');
}

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open) {
      connected = false;
      reset();
      dialog.value?.showModal();
    } else {
      reset();
      dialog.value?.open && dialog.value.close();
    }
  },
);

onBeforeUnmount(() => reset());
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="h-offline" @close="close" @cancel="close">
    <header class="sheet-head">
      <h2 id="h-offline">Connexion sans serveur</h2>
      <button class="btn ghost" type="button" @click="close">Fermer</button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div v-if="step === 'choose'" class="sheet-body">
      <p class="lead">
        Cette méthode ne nécessite aucun accès à Internet. Les deux appareils doivent être sur le même réseau wifi, le même point d’accès ou le même câble. Ils échangent deux codes, puis se connectent directement.
      </p>
      <div class="choices">
        <button class="btn big" type="button" :disabled="busy" @click="startHost">Afficher le code</button>
        <button class="btn big ghost" type="button" :disabled="busy" @click="startGuest">Scanner un code</button>
      </div>
      <p class="hint">Sur le premier appareil, choisissez « Afficher le code ». Sur le second, choisissez « Scanner un code ».</p>
    </div>

    <div v-else-if="step === 'done'" class="sheet-body">
      <p class="done">Connexion établie avec <strong>{{ peerName }}</strong>. Vous pouvez envoyer des fichiers.</p>
    </div>

    <div v-else-if="step === 'connecting'" class="sheet-body">
      <p class="lead" role="status">Connexion en cours…</p>
    </div>

    <div v-else class="sheet-body">
      <ol class="steps">
        <li v-if="step === 'show-offer'">
          <strong>Présentez ce code à l’autre appareil</strong>, qui doit choisir « Scanner un code ».
          <div v-if="qr" class="qr big" role="img" aria-label="Code à scanner" v-html="qr" />
          <div class="composer-actions">
            <button class="btn ghost" type="button" @click="copy">{{ copied ? 'Code copié' : 'Copier le code' }}</button>
          </div>
        </li>
        <li v-if="step === 'show-offer'">
          <strong>Scannez le code de réponse</strong> affiché sur l’autre appareil.
          <QrScanner v-if="stream" :stream="stream" @code="receive" />
        </li>

        <li v-if="step === 'scan-offer'">
          <strong>Scannez le code</strong> affiché par l’autre appareil, qui doit choisir « Afficher le code ».
          <QrScanner v-if="stream" :stream="stream" @code="receive" />
        </li>
        <li v-if="step === 'show-answer'">
          <strong>Présentez ce code de réponse</strong> à l’autre appareil, qui doit le scanner.
          <div v-if="qr" class="qr big" role="img" aria-label="Code de réponse à scanner" v-html="qr" />
          <div class="composer-actions">
            <button class="btn ghost" type="button" @click="copy">{{ copied ? 'Code copié' : 'Copier le code' }}</button>
          </div>
        </li>
      </ol>

      <p v-if="cameraDenied" class="note">
        La caméra n’est pas disponible. Copiez le code, transmettez-le à l’autre appareil par message, puis collez le code reçu ci-dessous.
        Sans accès à la caméra, la connexion peut échouer sur certains réseaux.
      </p>

      <details v-if="step === 'show-offer' || step === 'scan-offer'" class="manual" :open="cameraDenied">
        <summary>Saisir un code manuellement</summary>
        <form @submit.prevent="receive(manual)">
          <textarea v-model="manual" rows="3" placeholder="WD1…" aria-label="Code reçu de l’autre appareil" spellcheck="false" />
          <button class="btn" type="submit" :disabled="!manual.trim() || busy">Valider</button>
        </form>
      </details>
    </div>
  </dialog>
</template>
