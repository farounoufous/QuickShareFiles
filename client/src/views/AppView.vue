<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { drop, state } from '../lib/wifidrop.js';
import { installApp, pwa } from '../lib/pwa.js';
import { wakeLockSupported } from '../lib/wakelock.js';
import PeerRow from '../components/PeerRow.vue';
import TransferRow from '../components/TransferRow.vue';
import TextRow from '../components/TextRow.vue';
import InvitePanel from '../components/InvitePanel.vue';
import RoomEntry from '../components/RoomEntry.vue';
import OfflinePanel from '../components/OfflinePanel.vue';

const emit = defineEmits(['home']);
const editing = ref(false);
const draft = ref('');
const nameInput = ref(null);
const offlineOpen = ref(false);
const selected = ref([]); // ids des appareils cochés pour un envoi groupé
const groupInput = ref(null);
const roomInput = ref(null);
const sentNotice = ref('');
let noticeTimer;

const isPublic = computed(() => state.mode === 'public');
// En mode public, on n'affiche le salon qu'une fois dans une salle.
const hasOfflinePeer = computed(() => state.peers.some((p) => p.kind === 'offline'));
const inRoom = computed(() => !isPublic.value || (state.connected && Boolean(state.room)) || hasOfflinePeer.value);

const status = computed(() => {
  if (hasOfflinePeer.value && !state.connected) {
    const n = state.peers.length;
    return `Connexion sans serveur : ${n} appareil${n > 1 ? 's' : ''} relié${n > 1 ? 's' : ''}`;
  }
  if (state.serverDown) return 'Serveur injoignable';
  if (!state.connected) return isPublic.value ? 'Aucune salle ouverte' : 'Connexion au serveur…';
  const n = isPublic.value ? state.peers.filter((p) => p.kind === 'server').length : state.peers.length;
  const where = isPublic.value ? `dans la salle ${state.room}` : 'à proximité';
  return n === 0 ? 'Prêt : aucun autre appareil pour le moment' : `Prêt : ${n} appareil${n > 1 ? 's' : ''} ${where}`;
});

const hasFinished = computed(() => state.transfers.some((t) => ['done', 'error', 'declined', 'canceled'].includes(t.status)));

const secureLink = computed(() => {
  if (state.mode === 'public' || state.secureContext || !state.info.httpsPort) return '';
  return `https://${location.hostname}:${state.info.httpsPort}`;
});

const relayOff = computed(() => state.connected && !state.relay);
const keepAwakeTip = computed(() => state.transfers.some((t) => t.status === 'transferring') && wakeLockSupported && !state.wakeLock);

// Les cases à cocher n'ont de sens qu'à partir de deux appareils.
const multi = computed(() => state.peers.length > 1);
watch(
  () => state.peers.map((p) => p.id),
  (ids) => (selected.value = selected.value.filter((id) => ids.includes(id))),
);
const toggle = (id) => {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id];
};
const allSelected = computed(() => state.peers.length > 0 && selected.value.length === state.peers.length);
const toggleAll = () => (selected.value = allSelected.value ? [] : state.peers.map((p) => p.id));

function announce(count) {
  sentNotice.value = count
    ? `Demande envoyée à ${count} appareil${count > 1 ? 's' : ''}. Chaque destinataire doit l’accepter pour recevoir les fichiers.`
    : '';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (sentNotice.value = ''), 6000);
}

function groupPick(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length && selected.value.length) announce(drop.sendMany(selected.value, files));
}

function roomPick(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) announce(drop.sendToAll(files));
}

async function editName() {
  draft.value = state.me.name;
  editing.value = true;
  await nextTick();
  nameInput.value?.select();
}

function saveName() {
  if (editing.value) drop.rename(draft.value);
  editing.value = false;
}

const stop = (e) => e.preventDefault();
onMounted(() => {
  window.addEventListener('dragover', stop);
  window.addEventListener('drop', stop);
  drop.start();
});
onBeforeUnmount(() => {
  clearTimeout(noticeTimer);
  window.removeEventListener('dragover', stop);
  window.removeEventListener('drop', stop);
});
</script>

<template>
  <main class="shell">
    <header class="top">
      <a class="brand" href="/" aria-label="WifiDrop, retour à la présentation" @click.prevent="emit('home')">
        <span class="mark" aria-hidden="true"><i /><i /><i /></span>
        WifiDrop
      </a>
      <div class="me">
        <span class="me-label">Cet appareil</span>
        <form v-if="editing" class="me-edit" @submit.prevent="saveName">
          <input ref="nameInput" v-model="draft" maxlength="40" aria-label="Nom de cet appareil" @blur="saveName" @keydown.esc="editing = false" />
        </form>
        <button v-else class="me-name" type="button" title="Modifier le nom" @click="editName">{{ state.me.name || '…' }}</button>
      </div>
    </header>

    <p class="status" :class="{ off: !state.connected }" role="status">
      {{ status }}
      <button v-if="isPublic && state.room" class="link" type="button" @click="drop.leaveRoom()">Quitter la salle</button>
    </p>

    <p v-if="secureLink" class="note">
      Cette page n’est pas sécurisée (http) : les fichiers reçus sont conservés en mémoire avant d’être téléchargés.
      Pour les enregistrer directement sur le disque, ouvrez
      <a :href="secureLink">{{ secureLink }}</a>
      et acceptez le certificat.
    </p>
    <p v-if="relayOff" class="note">
      Les fichiers sont transmis directement entre les appareils et ne transitent jamais par le serveur. Les deux appareils doivent être connectés au même réseau.
    </p>
    <p v-if="keepAwakeTip" class="note">
      Maintenez l’écran allumé pendant le transfert : certains téléphones interrompent la connexion en veille.
    </p>

    <RoomEntry v-if="!inRoom" @offline="offlineOpen = true" />

    <section v-if="inRoom" aria-labelledby="h-peers">
      <div class="section-head">
        <h2 id="h-peers">{{ isPublic ? 'Appareils dans la salle' : 'Appareils à proximité' }}</h2>
      </div>

      <div v-if="multi" class="group-bar">
        <button class="link" type="button" @click="toggleAll">{{ allSelected ? 'Tout désélectionner' : 'Tout sélectionner' }}</button>
        <div class="group-actions">
          <button class="btn ghost" type="button" :disabled="!selected.length" @click="groupInput.click()">
            {{ selected.length ? `Envoyer à ${selected.length} appareil${selected.length > 1 ? 's' : ''}` : 'Envoyer à la sélection' }}
          </button>
          <button class="btn" type="button" @click="roomInput.click()">
            Envoyer à toute la salle ({{ state.peers.length }})
          </button>
        </div>
        <input ref="groupInput" type="file" multiple hidden @change="groupPick" />
        <input ref="roomInput" type="file" multiple hidden @change="roomPick" />
      </div>
      <p v-if="sentNotice" class="note" role="status">{{ sentNotice }}</p>

      <ul v-if="state.peers.length" class="peers">
        <PeerRow
          v-for="peer in state.peers"
          :key="peer.id"
          :peer="peer"
          :selectable="multi"
          :selected="selected.includes(peer.id)"
          @toggle="toggle(peer.id)"
          @files="(files) => drop.send(peer.id, files)"
          @text="(text) => drop.sendText(peer.id, text)"
        />
      </ul>
      <p v-else-if="state.connected" class="empty">
        {{
          isPublic
            ? 'Partagez le code ou le lien de la salle pour inviter un autre appareil.'
            : 'Ouvrez WifiDrop sur un autre appareil connecté au même réseau pour l’ajouter.'
        }}
      </p>
      <InvitePanel v-if="state.connected && !(isPublic && !state.room)" :open="!state.peers.length" />
    </section>

    <section v-if="state.texts.length" aria-labelledby="h-texts">
      <h2 id="h-texts">Textes et liens</h2>
      <ul class="transfers">
        <TextRow v-for="item in state.texts" :key="item.id" :item="item" @dismiss="drop.dismissText(item.id)" />
      </ul>
    </section>

    <section aria-labelledby="h-transfers">
      <div class="section-head">
        <h2 id="h-transfers">Transferts</h2>
        <button v-if="hasFinished" class="link" type="button" @click="drop.clearFinished()">Effacer les terminés</button>
      </div>
      <ul v-if="state.transfers.length" class="transfers">
        <TransferRow
          v-for="t in state.transfers"
          :key="t.id"
          :t="t"
          @accept="drop.accept(t.id)"
          @decline="drop.decline(t.id)"
          @cancel="drop.cancel(t.id)"
        />
      </ul>
      <p v-else class="empty">Aucun transfert pour le moment. Les fichiers envoyés et reçus apparaîtront ici.</p>
    </section>

    <footer class="foot">
      <button class="link" type="button" @click="offlineOpen = true">Connexion sans serveur par codes QR</button>
      <button v-if="pwa.canInstall" class="link" type="button" @click="installApp()">Installer l’application</button>
      <span v-else-if="pwa.iosHint" class="hint">Pour installer l’application : bouton Partager, puis « Sur l’écran d’accueil ».</span>
    </footer>

    <OfflinePanel :open="offlineOpen" @close="offlineOpen = false" />
  </main>
</template>
