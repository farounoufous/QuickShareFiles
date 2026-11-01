<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({ stream: { type: Object, default: null } });
const emit = defineEmits(['code']);

const video = ref(null);
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
let decode = null;
let timer = 0;
let lastCode = '';
let lastAt = 0;

function attach() {
  if (video.value && props.stream) {
    video.value.srcObject = props.stream;
    video.value.play?.().catch(() => {});
  }
}

function scan() {
  const el = video.value;
  if (decode && el && el.readyState >= 2 && el.videoWidth) {
    // Une image assez grande pour des QR codes denses, sans saturer le processeur d'un téléphone.
    const scale = Math.min(1, 960 / el.videoWidth);
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);
    context.drawImage(el, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = decode(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    const now = Date.now();
    if (result?.data && (result.data !== lastCode || now - lastAt > 3000)) {
      lastCode = result.data;
      lastAt = now;
      emit('code', result.data);
    }
  }
  timer = window.setTimeout(scan, 160);
}

onMounted(async () => {
  attach();
  decode = (await import('jsqr')).default; // chargé seulement quand on scanne
  scan();
});
watch(() => props.stream, attach);
onBeforeUnmount(() => {
  clearTimeout(timer);
  if (video.value) video.value.srcObject = null;
});
</script>

<template>
  <div class="scanner">
    <video ref="video" playsinline muted autoplay aria-label="Image de la caméra pour scanner le code" />
    <div class="scanner-frame" aria-hidden="true" />
  </div>
</template>
