<script setup>
import { onMounted } from 'vue';
import '../landing.css';

const emit = defineEmits(['open']);

// Hébergé sur un poste local, WifiDrop n'a pas besoin de présentation : on ouvre l'application directement.
onMounted(async () => {
  try {
    const info = await fetch('/api/info', { cache: 'no-store' }).then((r) => r.json());
    if (info.mode === 'local') emit('open', { replace: true });
  } catch {
    /* hors-ligne : on reste sur la présentation */
  }
});

const steps = [
  {
    title: 'Ouvrez WifiDrop sur les deux appareils',
    text: 'Connectez-les au même réseau wifi, puis créez une salle sur le premier appareil. Sur le second, rejoignez-la avec le code, le lien ou le QR code.',
  },
  {
    title: 'Choisissez les fichiers',
    text: 'Sélectionnez-les ou glissez-les sur l’appareil de destination. Le destinataire doit accepter la demande avant le début du transfert.',
  },
  {
    title: 'Le fichier arrive directement',
    text: 'Il est transmis d’un navigateur à l’autre sur votre réseau local, sans passer par Internet et sans création de compte.',
  },
];

const features = [
  {
    title: 'Aucune donnée mobile consommée',
    text: 'Les fichiers circulent sur votre réseau local. Seule la page est chargée via Internet (environ 100 Ko). L’application peut ensuite être installée.',
  },
  {
    title: 'Transfert direct entre appareils',
    text: 'La connexion est établie entre les deux navigateurs. Le serveur sert uniquement à mettre les appareils en relation et ne reçoit jamais les fichiers.',
  },
  {
    title: 'Reprise après coupure',
    text: 'En cas de coupure du wifi, le transfert reprend là où il s’est arrêté, sans repartir de zéro.',
  },
  {
    title: 'Plusieurs fichiers, plusieurs destinataires',
    text: 'Envoyez plusieurs fichiers ou le même lot à plusieurs appareils en une seule opération.',
  },
  {
    title: 'Textes et liens',
    text: 'Un lien ou un texte saisi sur un appareil s’affiche sur l’autre, prêt à être copié ou ouvert.',
  },
  {
    title: 'Utilisable sans Internet',
    text: 'Deux appareils sur le même réseau peuvent se connecter en échangeant deux QR codes, sans aucun serveur.',
  },
];

const faq = [
  {
    q: 'Les deux appareils doivent-ils être sur le même réseau ?',
    a: 'Oui. Les deux appareils doivent être connectés au même réseau wifi ou au même point d’accès. Le partage de connexion d’un téléphone convient. Le transfert reste alors sur votre réseau local.',
  },
  {
    q: 'Le transfert consomme-t-il des données mobiles ?',
    a: 'Non. Seule la page est chargée via Internet (environ 100 Ko). Une fois l’application installée, elle peut s’ouvrir sans connexion.',
  },
  {
    q: 'Quelle vitesse puis-je attendre ?',
    a: 'Elle dépend de votre réseau. En wifi 5 GHz, comptez de l’ordre de 20 à 60 Mo/s, soit 1 Go en 20 à 50 secondes environ. Il s’agit d’une estimation.',
  },
  {
    q: 'Y a-t-il une limite de taille ?',
    a: 'WifiDrop n’en impose pas. Sur Chrome ou Edge pour ordinateur, en https, le fichier est écrit directement sur le disque. Sur les autres navigateurs, il est conservé en mémoire jusqu’à la fin du transfert, ce qui convient jusqu’à 1 ou 2 Go.',
  },
  {
    q: 'Mes fichiers sont-ils stockés quelque part ?',
    a: 'Non. Le serveur ne les enregistre pas et ne les lit pas. Chaque réception nécessite l’accord du destinataire.',
  },
];

const compare = [
  ['Vitesse en pratique', 'Souvent moins de 1 Mo/s', 'Plusieurs dizaines de Mo/s sur un bon réseau wifi'],
  ['iPhone vers Android', 'Généralement impossible', 'Fonctionne dans le navigateur'],
  ['Appairage', 'Requis pour chaque nouvel appareil', 'Un code ou un lien suffit'],
  ['Installation', 'Activation requise sur les deux appareils', 'Aucune installation ni compte'],
];
</script>

<template>
  <div class="landing">
    <header class="l-nav">
      <a class="brand" href="/" aria-label="WifiDrop">
        <span class="mark" aria-hidden="true"><i /><i /><i /></span>
        WifiDrop
      </a>
      <nav class="l-links" aria-label="Sections">
        <a href="#fonctionnement">Fonctionnement</a>
        <a href="#fonctionnalites">Fonctionnalités</a>
        <a href="#questions">Questions</a>
      </nav>
      <button class="btn small" type="button" @click="emit('open')">Ouvrir l’application</button>
    </header>

    <main>
      <section class="hero">
        <div class="hero-copy">
          <h1>Envoyez un fichier volumineux à un appareil proche, sans consommer vos données mobiles.</h1>
          <p class="hero-lead">
            WifiDrop transfère vos fichiers directement d’un appareil à l’autre par le wifi. Aucune installation, aucun câble, aucune donnée mobile utilisée.
          </p>
          <div class="hero-actions">
            <button class="btn big" type="button" @click="emit('open')">Envoyer un fichier</button>
            <a class="btn big quiet" href="#fonctionnement">Découvrir le fonctionnement</a>
          </div>
          <p class="hero-note">Fonctionne dans le navigateur, sans création de compte.</p>
        </div>

        <figure class="stage" aria-label="Illustration : un fichier en cours d’envoi d’un ordinateur vers un téléphone">
          <div class="laptop" aria-hidden="true">
            <div class="laptop-bar"><i /><i /><i /></div>
            <div class="laptop-body">
              <div class="m-peer">
                <span class="m-avatar">A</span>
                <div>
                  <strong>Téléphone d’Awa</strong>
                  <span>Prêt à recevoir</span>
                </div>
              </div>
              <div class="m-transfer">
                <div class="m-line">
                  <strong>Mariage-video.mp4</strong>
                  <span class="m-speed">38 <small>Mo/s</small></span>
                </div>
                <div class="m-track"><div class="m-fill" /></div>
                <span class="m-sub">Connexion directe, sans passer par Internet</span>
              </div>
            </div>
          </div>
          <div class="phone" aria-hidden="true">
            <div class="phone-notch" />
            <div class="phone-body">
              <span class="m-sub">Demande reçue</span>
              <strong>Mariage-video.mp4</strong>
              <span class="m-sub">1,4 Go, de l’ordinateur de Koffi</span>
              <span class="m-btn">Accepter</span>
            </div>
          </div>
          <figcaption>Illustration</figcaption>
        </figure>
      </section>

      <section id="fonctionnement" class="block">
        <h2>Trois étapes, aucune configuration</h2>
        <ol class="steps-row">
          <li v-for="(step, i) in steps" :key="step.title">
            <span class="step-n">{{ i + 1 }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.text }}</p>
          </li>
        </ol>
      </section>

      <section id="fonctionnalites" class="block tint">
        <div class="block-in">
          <h2>Conçu pour les fichiers volumineux</h2>
          <ul class="feature-list">
            <li v-for="f in features" :key="f.title">
              <h3>{{ f.title }}</h3>
              <p>{{ f.text }}</p>
            </li>
          </ul>
        </div>
      </section>

      <section class="block">
        <h2>WifiDrop et Bluetooth</h2>
        <p class="block-lead">Le Bluetooth convient pour une photo. Pour une vidéo ou un dossier volumineux, l’écart de vitesse devient important.</p>
        <div class="table-wrap">
          <table class="compare">
            <thead>
              <tr>
                <th scope="col"><span class="visually-hidden">Critère</span></th>
                <th scope="col">Bluetooth</th>
                <th scope="col" class="us">WifiDrop</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in compare" :key="row[0]">
                <th scope="row">{{ row[0] }}</th>
                <td>{{ row[1] }}</td>
                <td class="us">{{ row[2] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="fine">Ordres de grandeur. Les débits réels varient selon les appareils et le réseau.</p>
      </section>

      <section id="questions" class="block tint">
        <div class="block-in narrow">
          <h2>Questions fréquentes</h2>
          <div class="faq">
            <details v-for="item in faq" :key="item.q">
              <summary>{{ item.q }}</summary>
              <p>{{ item.a }}</p>
            </details>
          </div>
        </div>
      </section>

      <section class="cta-band">
        <h2>Prêt à envoyer un fichier ?</h2>
        <p>Ouvrez WifiDrop sur les deux appareils pour commencer.</p>
        <button class="btn big" type="button" @click="emit('open')">Ouvrir WifiDrop</button>
      </section>
    </main>

    <footer class="l-foot">
      <a class="brand" href="/" aria-label="WifiDrop">
        <span class="mark" aria-hidden="true"><i /><i /><i /></span>
        WifiDrop
      </a>
      <p>Un projet conçu au Bénin.</p>
    </footer>
  </div>
</template>
