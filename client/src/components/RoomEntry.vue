<script setup>
import { computed, ref } from 'vue';
import { drop, normalizeRoom, state } from '../lib/wifidrop.js';

defineEmits(['offline']);

const code = ref('');

const messages = {
  'room-not-found': 'Cette salle n’existe pas ou elle est vide. Vérifiez le code.',
  'room-full': 'Cette salle est pleine.',
  'room-required': 'Saisissez le code de la salle.',
  'rate-limited': 'Trop d’essais. Réessayez dans une minute.',
};
const error = computed(() => messages[state.roomError] ?? '');
const ready = computed(() => normalizeRoom(code.value).length >= 4);

function join() {
  if (ready.value) drop.joinRoom(code.value);
}
</script>

<template>
  <section class="entry" aria-labelledby="h-entry">
    <h2 id="h-entry">Envoyez des fichiers à un appareil proche</h2>
    <p class="lead">
      Les deux appareils doivent être sur le même wifi. Le fichier passe directement de l’un à l’autre, sans consommer de données mobiles.
    </p>

    <p v-if="state.serverDown" class="note">
      Le serveur est injoignable. Vérifiez votre connexion Internet, ou
      <button class="link" type="button" @click="$emit('offline')">reliez deux appareils sans serveur</button>.
    </p>

    <div class="entry-actions">
      <button class="btn big" type="button" :disabled="state.joining || state.serverDown" @click="drop.createRoom()">
        Créer une salle
      </button>
    </div>

    <p class="or">ou rejoignez une salle existante</p>

    <form class="join" @submit.prevent="join">
      <label class="visually-hidden" for="room-code">Code de la salle</label>
      <input
        id="room-code"
        v-model="code"
        class="code-input"
        type="text"
        inputmode="text"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        maxlength="12"
        placeholder="K7Q2MX"
      />
      <button class="btn big" type="submit" :disabled="!ready || state.joining || state.serverDown">Rejoindre</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
