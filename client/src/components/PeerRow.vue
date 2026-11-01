<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { canReadClipboard, readClipboard } from '../lib/clipboard.js';
import { MAX_TEXT } from '../lib/protocol.js';

const props = defineProps({
  peer: { type: Object, required: true },
  selectable: Boolean,
  selected: Boolean,
});
const emit = defineEmits(['files', 'text', 'toggle']);

const input = ref(null);
const over = ref(false);
const composing = ref(false);
const draft = ref('');
const flash = ref('');
let flashTimer;

function pick(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) emit('files', files);
}

function dropped(event) {
  over.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) emit('files', files);
}

async function paste() {
  const text = await readClipboard();
  if (text) draft.value = (draft.value ? draft.value + '\n' : '') + text;
}

function sendText() {
  const text = draft.value.trim();
  if (!text) return;
  emit('text', text);
  draft.value = '';
  composing.value = false;
  flash.value = 'Texte envoyé';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = ''), 2500);
}

onBeforeUnmount(() => clearTimeout(flashTimer));
</script>

<template>
  <li
    class="peer"
    :class="{ over, selected }"
    @dragenter.prevent="over = true"
    @dragover.prevent="over = true"
    @dragleave.self="over = false"
    @drop.prevent="dropped"
  >
    <input
      v-if="selectable"
      class="check"
      type="checkbox"
      :checked="selected"
      :aria-label="`Sélectionner ${peer.name}`"
      @change="emit('toggle')"
    />
    <span class="avatar" aria-hidden="true">{{ peer.name.charAt(0).toUpperCase() }}</span>
    <div class="peer-text">
      <strong>{{ peer.name }}</strong>
      <span>{{ over ? 'Déposez les fichiers pour les envoyer' : flash || peer.device }}</span>
    </div>
    <div class="peer-actions">
      <button class="btn ghost" type="button" :aria-expanded="composing" :aria-label="`Envoyer du texte à ${peer.name}`" @click="composing = !composing">Texte</button>
      <button class="btn" type="button" :aria-label="`Envoyer des fichiers à ${peer.name}`" @click="input.click()">Envoyer des fichiers</button>
    </div>
    <input ref="input" type="file" multiple hidden @change="pick" />

    <form v-if="composing" class="composer" @submit.prevent="sendText">
      <textarea
        v-model="draft"
        rows="3"
        :maxlength="MAX_TEXT"
        placeholder="Saisissez ou collez un texte ou un lien"
        :aria-label="`Texte à envoyer à ${peer.name}`"
      />
      <div class="composer-actions">
        <button v-if="canReadClipboard()" class="btn ghost" type="button" @click="paste">Coller</button>
        <button class="btn" type="submit" :disabled="!draft.trim()">Envoyer le texte</button>
      </div>
    </form>
  </li>
</template>
