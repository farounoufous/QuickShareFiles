<script setup>
import { computed } from 'vue';
import { formatBytes, formatDuration, splitBytes } from '../lib/format.js';
import { canSaveToDisk } from '../lib/saver.js';
import { isBusy, state } from '../lib/wifidrop.js';

const props = defineProps({ t: { type: Object, required: true } });
defineEmits(['accept', 'decline', 'cancel']);

const sending = computed(() => props.t.direction === 'send');
const active = computed(() => props.t.status === 'transferring');
const busy = computed(() => isBusy(props.t));
const percent = computed(() => (props.t.totalBytes ? Math.min(100, (props.t.doneBytes / props.t.totalBytes) * 100) : 100));
const speed = computed(() => splitBytes(props.t.speed));
const route = computed(() => {
  if (props.t.transport === 'p2p') return 'Connexion directe';
  return state.mode === 'public' ? 'Via le serveur' : 'Via le serveur local';
});
const memoryWarning = computed(
  () => props.t.status === 'pending' && !canSaveToDisk && props.t.totalBytes > 1.5 * 1024 ** 3,
);

const headline = computed(() => {
  const { peerName, title, status } = props.t;
  if (status === 'pending') return `${peerName} souhaite vous envoyer ${title}`;
  return sending.value ? `Envoi de ${title} à ${peerName}` : `Réception de ${title} de ${peerName}`;
});

const summary = computed(() => {
  const t = props.t;
  switch (t.status) {
    case 'pending':
      return formatBytes(t.totalBytes);
    case 'waiting':
      return `En attente de la réponse de ${t.peerName}…`;
    case 'connecting':
      return 'Connexion en cours…';
    case 'reconnecting':
      return `Connexion interrompue. Reprise à ${formatBytes(t.doneBytes)} sur ${formatBytes(t.totalBytes)}…`;
    case 'transferring':
      return `${formatBytes(t.doneBytes)} sur ${formatBytes(t.totalBytes)}`;
    case 'done': {
      const took = formatDuration((t.endedAt ?? 0) - (t.startedAt ?? t.endedAt ?? 0));
      const resumed = t.reconnects ? ` Transfert repris ${t.reconnects} fois.` : '';
      return `Terminé en ${took} : ${formatBytes(t.totalBytes)} à ${formatBytes(t.avgSpeed)}/s en moyenne.${resumed}`;
    }
    case 'declined':
      return `Refusé par ${t.peerName}`;
    case 'canceled':
      return 'Transfert annulé';
    default:
      return t.error || 'Le transfert a échoué.';
  }
});
</script>

<template>
  <li class="transfer" :class="[`is-${t.status}`]">
    <div class="transfer-main">
      <p class="transfer-title">{{ headline }}</p>
      <p class="transfer-sub" :class="{ bad: t.status === 'error' }">
        {{ summary }}
        <template v-if="active && t.transport"> · {{ route }}</template>
      </p>
      <p v-if="active && t.files.length > 1 && t.current" class="transfer-sub">Fichier en cours : {{ t.current }}</p>
      <p v-if="memoryWarning" class="transfer-warn">
        Ce navigateur conserve le fichier en mémoire jusqu’à la fin du transfert. Pour un fichier de cette taille, utilisez Chrome ou Edge sur ordinateur, sur une page sécurisée (https).
      </p>
    </div>

    <div v-if="active" class="speed" aria-live="off">
      <strong>{{ speed.value }}</strong><span>{{ speed.unit }}/s</span>
    </div>

    <div class="transfer-actions">
      <template v-if="t.status === 'pending'">
        <button class="btn" type="button" @click="$emit('accept')">Accepter</button>
        <button class="btn ghost" type="button" @click="$emit('decline')">Refuser</button>
      </template>
      <button v-else-if="busy" class="btn ghost" type="button" @click="$emit('cancel')">Annuler</button>
    </div>

    <div
      v-if="busy"
      class="track"
      :class="{ paused: t.status === 'reconnecting' }"
      role="progressbar"
      :aria-valuenow="Math.round(percent)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Progression : ${t.title}`"
    >
      <div class="fill" :style="{ width: percent + '%' }" />
    </div>
  </li>
</template>
