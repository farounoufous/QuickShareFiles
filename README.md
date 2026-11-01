# WifiDrop

Envoie des fichiers lourds d'un appareil à un autre par le wifi, sans consommer de données mobiles.
Aucune application à installer sur les appareils : un navigateur suffit.

## Comment ça marche

Un petit serveur Node tourne sur **un** ordinateur du réseau (le « poste hôte »). Les autres appareils ouvrent son adresse dans leur navigateur et se voient entre eux.

1. L'expéditeur choisit des fichiers (ou les glisse sur un appareil de la liste).
2. Le récepteur voit la demande et clique sur **Accepter** (il choisit où enregistrer).
3. Les deux navigateurs ouvrent une **connexion WebRTC directe** : les données ne passent par aucun serveur, ni par Internet.
4. Si la connexion directe est impossible (certains routeurs ou points d'accès bloquent la découverte), WifiDrop bascule seul, au bout de 6 secondes, sur le **relais du serveur local**. C'est plus lent à haut débit mais ça marche toujours, toujours sans Internet.

Seule la page web est chargée depuis le serveur local : aucun mégas n'est consommé.

## Deux façons de l'utiliser

| | Mode **local** (défaut) | Mode **public** (hébergé) |
| --- | --- | --- |
| Où tourne le serveur | Sur un ordinateur de ton réseau | Chez un hébergeur (Render, Fly.io, VPS…) |
| Comment les appareils se trouvent | Tous ceux du réseau se voient | Une **salle** avec un code à 6 caractères, un lien ou un QR code |
| Fonctionne sans Internet | Oui | Non (il faut joindre le serveur, une fois) |
| Relais par le serveur | Oui (repli, reste en local) | **Non** par défaut : il ferait transiter les fichiers par Internet, donc par les données mobiles |

Dans les deux modes, une fois la connexion directe établie, **les fichiers ne passent jamais par le serveur**.

## Pages

- `/` : page de présentation (en mode public). En mode local, elle redirige directement vers l'application.
- `/app` : l'application. Un lien de salle (`/?salle=CODE`) ou l'application installée ouvrent aussi l'application directement.

## Fonctionnalités

- **Envoi de fichiers et de dossiers**, plusieurs fichiers à la fois.
- **Envoi à plusieurs appareils** : coche les destinataires, choisis les fichiers.
- **Texte, liens, presse-papiers** : bouton « Texte » sur chaque appareil. Un lien reçu s'ouvre d'un clic.
- **Reprise après interruption** : si le wifi saute ou que la connexion directe tombe, le transfert reprend là où il s'était arrêté (vérifié sur un fichier de 100 Mo, contenu identique).
- **Écran gardé allumé** pendant un transfert (API Wake Lock, sur les navigateurs qui la proposent).
- **Application installable (PWA)** : s'ouvre sans taper l'adresse, et la page se charge même sans connexion. Nécessite une page **https** (fournie par l'hébergeur, ou `localhost`).
- **Mode sans serveur** : « Connecter deux appareils par codes QR ». Les deux appareils échangent deux QR codes (ou deux textes copiés-collés) et se connectent directement. Il faut qu'ils soient sur le même réseau, mais ni serveur ni Internet.

## Démarrage local

Prérequis : Node.js 18 ou plus, sur le poste hôte.

```bash
npm install     # installe tout et construit l'interface
npm start
```

Le terminal affiche l'adresse à ouvrir sur les autres appareils, avec un QR code :

```
Sur les autres appareils (même réseau que ce PC, Wi-Fi) :
  http://192.168.1.12:3000
  https://192.168.1.12:3443   pour les très gros fichiers (certificat à accepter)
```

WifiDrop ignore les cartes réseau virtuelles (WSL, Hyper-V, VM, Docker) et met le wifi ou le câble en premier. Si ton PC héberge un point d'accès, il apparaît comme second réseau : dans l'interface, un bouton te laisse choisir celui où se trouve l'autre appareil.

Il faut que les appareils soient sur le même réseau local. Trois montages possibles :

| Montage | Comment | Débit typique |
| --- | --- | --- |
| Même routeur wifi | Rien à configurer (sauf si le routeur a l'« isolation des clients » activée) | 20 à 60 Mo/s en 5 GHz |
| Point d'accès | Le poste hôte ou un téléphone active son point d'accès, les autres s'y connectent. Pas besoin d'Internet. | 10 à 40 Mo/s |
| Câble Ethernet direct entre deux PC | Les cartes réseau récentes se configurent seules | jusqu'à ~100 Mo/s |

Astuce : dans les réglages d'un point d'accès Android, choisis la bande **5 GHz** quand c'est possible, c'est souvent deux fois plus rapide que 2,4 GHz.

## Gros fichiers : utiliser la page https

Sur une adresse `http://192.168…`, les navigateurs interdisent l'écriture directe sur le disque. Le fichier est alors gardé en mémoire (en blocs que le navigateur peut déporter sur disque) puis téléchargé à la fin. C'est correct jusqu'à 1 ou 2 Go.

Pour les très gros fichiers, ouvre plutôt la page **https** affichée au démarrage (port 3443), sur **Chrome ou Edge, sur ordinateur** :

- le navigateur affiche un avertissement (certificat auto-signé généré sur ton poste) : choisis « Avancé », puis « Continuer » ;
- le fichier est alors écrit en flux directement sur le disque, sans limite de taille.

Firefox et Safari ne proposent pas cette API, et Chrome sur téléphone non plus : ils utilisent le mode mémoire.

## Si une page ne s'ouvre pas

Essaie dans cet ordre, sur l'appareil qui n'y arrive pas :

1. **Ouvre d'abord la version http** (`http://…:3000`). Si elle marche, WifiDrop fonctionne : seule la version https pose problème (étape 4).
2. **Le serveur tourne-t-il ?** Le terminal du poste hôte doit afficher « WifiDrop est prêt ». S'il affiche « HTTPS indisponible », seule la version http est disponible.
3. **Pare-feu Windows** (erreur « délai d'attente dépassé » depuis un autre appareil) : au premier lancement, Windows demande d'autoriser Node.js. Coche **réseaux privés et publics**. Sinon : Paramètres Windows, Pare-feu, « Autoriser une application », Node.js. Vérifie aussi que le wifi est classé « réseau privé ».
4. **Avertissement « Votre connexion n'est pas privée »** (version https) : c'est normal, le certificat est créé par ton propre PC. Choisis « Paramètres avancés », puis « Continuer vers … ». Si Chrome n'affiche aucun bouton, clique sur la page et tape `thisisunsafe`.
5. **Les appareils ne se voient pas** alors que la page s'ouvre : ton routeur ou point d'accès a l'« isolation des clients » activée (souvent sur les wifi publics ou invités). Utilise un autre réseau ou le point d'accès d'un téléphone.

## Limites à connaître

- **Pas de « quelques secondes » magiques** : la vitesse dépend du réseau. 1 Go prend environ 20 à 50 s en wifi 5 GHz, environ 10 s en câble Gigabit.
- Le débit d'un DataChannel WebRTC plafonne autour de quelques dizaines de Mo/s selon le processeur, même sur un très bon réseau.
- Garde l'onglet au premier plan : les navigateurs mobiles suspendent les onglets en arrière-plan (WifiDrop garde l'écran allumé quand le navigateur le permet).
- Le serveur voit les appareils connectés (nom et type d'appareil) mais jamais le contenu des fichiers en mode direct. En mode relais, il recopie les blocs sans les lire ni les stocker.
- Tous les appareils qui ouvrent l'adresse se voient. Ne l'ouvre que sur un réseau de confiance : chaque réception demande de toute façon une acceptation.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `MODE` | `local` | `local` ou `public` |
| `PORT` | `3000` | Port HTTP (les hébergeurs le fournissent) |
| `HTTPS_PORT` | `3443` en local, `0` en public | Port HTTPS auto-signé (`0` pour désactiver) |
| `HOST` | `0.0.0.0` | Interface d'écoute |
| `ALLOW_RELAY` | `oui` en local, `non` en public | Le serveur relaie les blocs si la connexion directe échoue |
| `TRUST_PROXY` | `non` en local, `oui` en public | Lire l'IP réelle dans `X-Forwarded-For` (derrière le proxy de l'hébergeur) |
| `ALLOWED_ORIGINS` | vide | Domaines autorisés à ouvrir le WebSocket en plus de celui qui sert la page |
| `MAX_ROOM_PEERS` | `20` | Appareils maximum par salle |
| `STUN_URLS` | vide | Serveurs STUN séparés par des virgules (voir ci-dessous) |
| `CERT_DIR` | `server/.certs` | Dossier du certificat auto-signé (mode local) |

Exemple : `PORT=8080 npm start`

## Héberger WifiDrop sur Internet

Le projet contient un `Dockerfile`, un `render.yaml` et un `fly.toml`. L'application tourne en une seule instance, sur un seul port, avec une route de santé `/healthz` et un arrêt propre sur SIGTERM.

### Render (le plus simple, plan gratuit possible)

1. Mets le projet sur GitHub.
2. Sur render.com : **New**, **Blueprint**, choisis le dépôt. `render.yaml` fait le reste.
3. Au bout de quelques minutes tu obtiens une adresse `https://wifidrop-xxxx.onrender.com`.

Le plan gratuit met le service en veille après quelques minutes sans visite : le premier chargement peut prendre environ une minute.

### Fly.io

```bash
fly launch --copy-config --no-deploy   # change le nom de l'app dans fly.toml si besoin
fly deploy
```

`fly.toml` choisit Paris (`cdg`), la région la plus proche de l'Afrique de l'Ouest.

### VPS ou autre machine (Docker)

```bash
docker build -t wifidrop .
docker run -d --restart unless-stopped -p 3000:3000 wifidrop
```

Place devant un proxy HTTPS (Caddy, Nginx, Cloudflare) : sans https, ni l'installation PWA ni l'écriture directe sur disque ne fonctionnent. Le proxy doit laisser passer les WebSocket sur `/ws`.

Sans Docker : `npm ci && npm run build && MODE=public npm start`.

### À savoir avant de publier

- **Une seule instance.** Les salles vivent en mémoire : deux instances ne se verraient pas. N'active pas l'autoscaling.
- **Les deux appareils doivent être sur le même wifi** pour la connexion directe. Le serveur sert seulement à les présenter l'un à l'autre. Sans serveur STUN, WebRTC ne trouve que les adresses locales : c'est voulu (pas de TURN payant, pas de fichier qui passe par Internet).
- **Entre deux réseaux différents** (ex. un ami sur un autre wifi), il faudrait un serveur TURN : le fichier passerait par Internet, donc par des données mobiles. WifiDrop ne le propose pas.
- Le relais par le serveur est **désactivé** en mode public. Active-le avec `ALLOW_RELAY=oui` si tu acceptes qu'un transfert qui échoue en direct passe par ton serveur (ça consomme sa bande passante et les données des appareils).
- Un STUN (`STUN_URLS=stun:stun.l.google.com:19302`) n'aide que pour les appareils derrière des réseaux complexes ; il envoie l'adresse publique des appareils à ce service.
- Protections intégrées : salles éphémères et étanches, limites de fréquence par IP, taille des messages limitée, en-têtes de sécurité et CSP.

## Développement

```bash
npm run dev:server   # serveur avec rechargement, port 3000
npm run dev:client   # interface Vite avec rechargement, port 5173 (proxy vers le serveur)
npm test             # tests du serveur
```

## Structure

```
server/
  src/index.js     démarrage (http + https, QR code dans le terminal)
  src/config.js    lecture des variables d'environnement
  src/hub.js       appareils, salles, signalisation, relais binaire, limites
  src/static.js    fichiers de l'interface, en-têtes de sécurité
  src/app.js       /api/info, fichiers statiques, WebSocket
  src/certs.js     certificat HTTPS auto-signé
  test/            tests d'intégration
client/
  src/lib/wifidrop.js    moteur : demandes, WebRTC, repli relais, blocs, confirmations
  src/lib/saver.js       écriture sur disque en flux ou en mémoire
  src/lib/signaling.js   connexion WebSocket
  src/lib/offline.js     connexion par codes QR, sans serveur
  src/lib/wakelock.js    écran allumé    src/lib/pwa.js   installation
  src/lib/transports.js  WebRTC et relais derrière la même interface
  src/App.vue            choix présentation / application
  src/views/Landing.vue  page de présentation (styles : src/landing.css)
  src/views/AppView.vue  application
  src/components/        lignes d'appareils, transferts, salles, mode sans serveur
```

### Protocole de transfert

Les blocs font 64 Ko. L'expéditeur n'a jamais plus de 4 Mo (2 Mo en relais) non confirmés : le récepteur confirme après avoir **écrit** les données, donc la vitesse suit celle du disque et la mémoire reste stable, même pour des fichiers de plusieurs Go.

## Ce qui n'est pas fait, et pourquoi

- **Plusieurs connexions en parallèle pour aller plus vite** : testé, aucun gain mesurable. Le plafond observé vient du traitement WebRTC d'un navigateur, pas du nombre de canaux. Je ne l'ai donc pas ajouté.
- **Mesures de vitesse sur du vrai wifi** : les débits annoncés (20 à 60 Mo/s en 5 GHz, jusqu'à ~100 Mo/s en câble) sont des ordres de grandeur, pas des mesures. L'environnement de test était une seule machine.
- **Scanner de QR code à la caméra** : le code est généré et décodé correctement par la bibliothèque en test, mais la lecture par une vraie caméra de téléphone n'a pas pu être essayée. Le collage du code à la main marche toujours.

## Pistes d'amélioration

- Serveur TURN optionnel pour relier deux réseaux différents.
- Durée de vie réglable des salles.
