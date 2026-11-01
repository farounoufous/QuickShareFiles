<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { asLink, copyText } from '../lib/clipboard.js';

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(['dismiss']);

const copied = ref(false);
let timer;
const link = computed(() => (props.item.direction === 'receive' ? asLink(props.item.text) : ''));

async function copy() {
  copied.value = await copyText(props.item.text);
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 1800);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <li class="transfer text-card" :class="{ 'is-pending': item.direction === 'receive' }">
    <div class="transfer-main">
      <p class="transfer-title">
        {{ item.direction === 'receive' ? `${item.peerName} vous a envoyé du texte` : `Texte envoyé à ${item.peerName}` }}
      </p>
      <pre class="text-body">{{ item.text }}</pre>
      <p v-if="item.failed" class="transfer-sub bad">L’envoi a échoué : l’appareil est injoignable.</p>
    </div>
    <div class="transfer-actions">
      <button class="btn" type="button" @click="copy">{{ copied ? 'Copié' : 'Copier' }}</button>
      <a v-if="link" class="btn ghost" :href="link" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a>
      <button class="btn ghost" type="button" @click="$emit('dismiss')">Fermer</button>
    </div>
  </li>
</template>
