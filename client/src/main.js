import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { setupPwa } from './lib/pwa.js';
import { startWakeLock } from './lib/wakelock.js';

createApp(App).mount('#app');
setupPwa();
startWakeLock();
