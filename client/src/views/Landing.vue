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
    text: 'Connectez-les au même wifi, puis créez une salle sur le premier et rejoignez-la avec le code, le lien ou le QR code sur le second.',
  },
  {
    title: 'Choisissez les fichiers',
    text: 'Glissez-les sur l’appareil de destination ou sélectionnez-les. Son propriétaire accepte la demande avant que le transfert ne commence.',
  },
  {
    title: 'Le fichier arrive directement',
    text: 'Il passe d’un navigateur à l’autre sur votre réseau local, sans détour par Internet et sans compte à créer.',
  },
];

const features = [
  {
    title: 'Aucune donnée mobile consommée',
    text: 'Les fichiers circulent sur votre réseau local. Seule la page s’ouvre via Internet, pour environ 100 Ko, et elle peut ensuite être installée.',
  },
  {
    title: 'Pas de serveur au milieu',
    text: 'La connexion est directe entre les deux navigateurs. Le serveur se contente de présenter les appareils l’un à l’autre.',
  },
  {
    title: 'Reprise après coupure',
    text: 'Si le wifi saute pendant un gros transfert, il reprend là où il s’est arrêté, sans repartir de zéro.',
  },
  {
    title: 'Plusieurs fichiers, plusieurs destinataires',
    text: 'Envoyez des dossiers entiers, ou le même lot à plusieurs appareils d’un seul geste.',
  },
  {
    title: 'Textes et liens',
    text: 'Collez un lien ou un texte et il arrive sur l’autre appareil, prêt à être copié ou ouvert.',
  },
  {
    title: 'Fonctionne sans Internet',
    text: 'Deux appareils sur le même réseau peuvent se relier en échangeant deux QR codes, sans aucun serveur.',
  },
];

const faq = [
  {
    q: 'Les deux appareils doivent-ils être sur le même wifi ?',
    a: 'Ce n’est pas obligatoire, mais c’est ce qui marche le mieux : sur le même wifi (ou le même point d’accès, le partage de connexion d’un téléphone convient très bien), le transfert reste sur votre réseau et ne coûte aucune donnée. Entre deux réseaux différents, WifiDrop tente une connexion directe via Internet, qui consomme des données et que certains réseaux mobiles bloquent.',
  },
  {
    q: 'Est-ce que cela consomme mes données mobiles ?',
    a: 'Pas pour un transfert entre deux appareils du même wifi : seule la page s’ouvre via Internet, pour environ 100 Ko. Entre deux réseaux différents, le fichier passe par Internet et consomme des données.',
  },
  {
    q: 'Quelle vitesse puis-je attendre ?',
    a: 'Elle dépend de votre réseau. En wifi 5 GHz, comptez de l’ordre de 20 à 60 Mo/s, soit 1 Go en 20 à 50 secondes. Il s’agit d’une estimation, pas d’une garantie.',
  },
  {
    q: 'Y a-t-il une limite de taille ?',
    a: 'WifiDrop n’en impose pas. Sur Chrome ou Edge d’un ordinateur, en https, le fichier est écrit directement sur le disque. Sur les autres navigateurs il est gardé en mémoire jusqu’à la fin, ce qui convient jusqu’à 1 ou 2 Go.',
  },
  {
    q: 'Mes fichiers sont-ils stockés quelque part ?',
    a: 'Non. Ils ne sont ni enregistrés ni lus par le serveur, et chaque réception demande l’accord du destinataire.',
  },
];

const compare = [
  ['Vitesse en pratique', 'Souvent moins de 1 Mo/s', 'Plusieurs dizaines de Mo/s sur un bon wifi'],
  ['iPhone vers Android', 'Impossible en général', 'Fonctionne dans le navigateur'],
  ['Appairage', 'Nécessaire à chaque nouvel appareil', 'Un code ou un lien suffit'],
  ['Installation', 'Réglages à activer des deux côtés', 'Aucune, ni compte ni application'],
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
          <h1>Envoyez un fichier lourd à l’appareil d’à côté, sans entamer votre forfait.</h1>
          <p class="hero-lead">
            WifiDrop transfère vos fichiers directement d’un appareil à l’autre par le wifi. Rien à installer, aucun câble, aucune donnée mobile consommée.
          </p>
          <div class="hero-actions">
            <button class="btn big" type="button" @click="emit('open')">Envoyer un fichier</button>
            <a class="btn big quiet" href="#fonctionnement">Voir comment ça marche</a>
          </div>
          <p class="hero-note">Fonctionne dans le navigateur, sans compte.</p>
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
          <h2>Pensé pour les gros fichiers</h2>
          <ul class="feature-list">
            <li v-for="f in features" :key="f.title">
              <h3>{{ f.title }}</h3>
              <p>{{ f.text }}</p>
            </li>
          </ul>
        </div>
      </section>

      <section class="block">
        <h2>Pourquoi pas le Bluetooth ?</h2>
        <p class="block-lead">Le Bluetooth fait le travail pour une photo. Pour une vidéo ou un dossier, la différence se compte en minutes.</p>
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
        <h2>Un fichier à envoyer ?</h2>
        <p>Ouvrez WifiDrop sur les deux appareils et commencez en quelques secondes.</p>
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
