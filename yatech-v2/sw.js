/* ==========================================================================
   Yatech — service worker
   --------------------------------------------------------------------------
   Un atelier n'a pas toujours du réseau : sous un pont, au fond du hangar, la
   4G tombe. L'outil doit s'ouvrir quand même. On garde donc une copie locale
   de la coquille (page, styles, modules) et on la sert si le réseau manque.

   Règle : le réseau gagne toujours quand il répond. Le cache n'est qu'un filet.
   Sans ça, une correction publiée mettrait des jours à arriver sur les
   téléphones — et deux personnes travailleraient sur deux versions différentes.

   Les DONNÉES ne passent jamais par ici : elles vivent dans IndexedDB.
   ========================================================================== */

const VERSION = 'yatech-v2-8';           // à incrémenter à chaque mise en ligne
const CACHE = 'coque-' + VERSION;

/* La liste est volontairement courte : tout ce qu'il faut pour peindre l'écran
   de démarrage. Le reste des modules se met en cache au premier passage. */
const COQUE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/jetons.css',
  './css/base.css',
  './css/composants.css',
  './css/coque.css',
  './css/ecrans.css',
  './css/utilitaires.css',
  './css/impression.css',
  './js/main.js',
  './assets/icone.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      /* addAll échoue en bloc si un seul fichier manque : on tolère les ratés
         plutôt que de laisser l'installation par terre. */
      .then((c) => Promise.all(COQUE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'maintenant') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // rien d'extérieur ne nous concerne

  /* Navigation : on tente le réseau, et si rien ne vient on rouvre la page
     gardée en cache. L'application se recharge alors avec ses données locales. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copie)).catch(() => {});
          return rep;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  /* Fichiers : on répond du cache tout de suite s'il l'a, et on rafraîchit en
     arrière-plan. La version suivante sera servie au prochain chargement. */
  e.respondWith(
    caches.match(req).then((cache) => {
      const reseau = fetch(req).then((rep) => {
        if (rep && rep.status === 200 && rep.type === 'basic') {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {});
        }
        return rep;
      }).catch(() => cache || Response.error());
      return cache || reseau;
    })
  );
});
