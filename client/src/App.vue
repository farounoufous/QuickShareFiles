<script setup>
import { ref } from 'vue';
import Landing from './views/Landing.vue';
import AppView from './views/AppView.vue';

// Deux écrans, sans routeur : la présentation sur « / », l'application sur « /app ».
// Un lien de salle (?salle=CODE) ou l'application installée ouvrent directement l'application.
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const wantsApp = () => location.pathname.startsWith('/app') || new URLSearchParams(location.search).has('salle') || standalone();

const view = ref(wantsApp() ? 'app' : 'landing');

function go(next, { replace = false } = {}) {
  if (view.value === next) return;
  const url = next === 'app' ? '/app' : '/';
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  view.value = next;
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => (view.value = wantsApp() ? 'app' : 'landing'));
</script>

<template>
  <Landing v-if="view === 'landing'" @open="(opts) => go('app', opts)" />
  <AppView v-else @home="go('landing')" />
</template>
