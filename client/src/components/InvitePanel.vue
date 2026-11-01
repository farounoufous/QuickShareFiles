<script setup>
import { computed, ref, watchEffect } from 'vue';
import QRCode from 'qrcode';
import { state } from '../lib/wifidrop.js';
import { copyText } from '../lib/clipboard.js';

defineProps({ open: Boolean });

const svg = ref('');
const selected = ref(0);
const copied = ref(false);

const isPublic = computed(() => state.mode === 'public' && Boolean(state.room));
const networks = computed(() => state.info.networks);
const current = computed(() => networks.value[selected.value] ?? networks.value[0] ?? null);
const roomLink = computed(() => `${location.origin}/?salle=${state.room}`);
const target = computed(() => (isPublic.value ? roomLink.value : (current.value?.url ?? location.origin)));
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

watchEffect(async () => {
  try {
    svg.value = await QRCode.toString(target.value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  } catch {
    svg.value = '';
  }
});

async function copyLink() {
  copied.value = await copyText(roomLink.value);
  setTimeout(() => (copied.value = false), 1800);
}

function share() {
  navigator
    .share({ title: 'WifiDrop', text: `Rejoins ma salle WifiDrop : ${state.room}`, url: roomLink.value })
    .catch(() => {});
}
</script>

<template>
  <details class="invite" :open="open">
    <summary>Ajouter un appareil</summary>
    <div class="invite-body">
      <div v-if="svg" class="qr" role="img" :aria-label="`Code QR vers ${target}`" v-html="svg" />

      <div v-if="isPublic" class="invite-text">
        <p>Sur l’autre appareil, scannez le code, ouvrez le lien ou saisissez ce code de salle :</p>
        <p class="room-code" aria-label="Code de la salle">{{ state.room }}</p>
        <div class="composer-actions">
          <button class="btn" type="button" @click="copyLink">{{ copied ? 'Lien copié' : 'Copier le lien' }}</button>
          <button v-if="canShare" class="btn ghost" type="button" @click="share">Partager</button>
        </div>
        <p class="hint">La salle disparaît quand tout le monde l’a quittée. Les appareils doivent être sur le même wifi.</p>
      </div>

      <div v-else class="invite-text">
        <p>Sur l’autre appareil, scannez le code ou saisissez cette adresse dans le navigateur.</p>
        <code class="address">{{ target }}</code>

        <template v-if="networks.length > 1">
          <p class="hint">L’autre appareil est connecté à quel réseau ?</p>
          <div class="chips" role="group" aria-label="Réseau de l’autre appareil">
            <button
              v-for="(net, i) in networks"
              :key="net.url"
              type="button"
              class="chip"
              :aria-pressed="i === selected"
              @click="selected = i"
            >
              {{ net.label }}
            </button>
          </div>
        </template>

        <p v-if="current?.secureUrl" class="hint">
          Pour les très gros fichiers, sur Chrome ou Edge d’un ordinateur, ouvrez plutôt
          <code>{{ current.secureUrl }}</code> et acceptez le certificat.
        </p>
        <p v-if="!networks.length" class="note">
          Aucun réseau détecté sur l’ordinateur qui héberge WifiDrop : connectez-le à un wifi, activez un point d’accès ou branchez un câble.
        </p>
      </div>
    </div>
  </details>
</template>
