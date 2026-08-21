/* ==========================================================================
   YATECH — démarrage
   --------------------------------------------------------------------------
   L'ordre compte : on ouvre le stockage, on relit l'état, on pose l'apparence,
   PUIS on peint. Peindre avant d'avoir les données, c'est un écran qui
   clignote et des chiffres qui sautent sous les yeux.

   Les écrans sont chargés à la demande : ouvrir l'outil pour regarder le
   planning ne doit pas télécharger l'éditeur de devis.
   ========================================================================== */

import { h, poser, q } from './core/dom.js';
import { icone } from './core/icones.js';
import { message, messageErreur } from './core/ui.js';
import * as routeur from './core/routeur.js';
import { S, charger, ecoute, annuler, refaire, peutAnnuler } from './core/store.js';
import * as base from './core/db.js';
import { neuf, normaliser } from './domain/schema.js';
import { equipeDepart, catalogueDepart } from './domain/demo.js';
import { devise } from './core/fmt.js';
import * as coque from './coque.js';
import { attend } from './core/util.js';

/* ==========================================================================
   LES ÉCRANS
   Chacun exporte `peindre(contexte)` et rend un nœud. Le contexte porte
   l'état, les paramètres d'adresse et de quoi repeindre.
   ========================================================================== */

const ECRANS = {
  connexion:    () => import('./views/connexion.js'),
  aujourdhui:   () => import('./views/aujourdhui.js'),
  atelier:      () => import('./views/atelier.js'),
  dossier:      () => import('./views/dossier.js'),
  planning:     () => import('./views/planning.js'),
  parc:         () => import('./views/parc.js'),
  clients:      () => import('./views/clients.js'),
  client:       () => import('./views/client.js'),
  vehicules:    () => import('./views/vehicules.js'),
  vehicule:     () => import('./views/vehicule.js'),
  devis:        () => import('./views/devis.js'),
  ficheDevis:   () => import('./views/devis-fiche.js'),
  factures:     () => import('./views/factures.js'),
  ficheFacture: () => import('./views/facture-fiche.js'),
  tarifs:       () => import('./views/tarifs.js'),
  stock:        () => import('./views/stock.js'),
  fichePiece:   () => import('./views/piece.js'),
  electronique: () => import('./views/electronique.js'),
  ebp:          () => import('./views/ebp.js'),
  reglages:     () => import('./views/reglages.js'),
  portail:      () => import('./views/portail.js')
};

const ROUTES = [
  { chemin: '/',              ecran: 'aujourdhui',   titre: "Aujourd'hui" },
  { chemin: '/connexion',     ecran: 'connexion',    titre: 'Connexion',    libre: true, nu: true },
  { chemin: '/atelier',       ecran: 'atelier',      titre: 'Atelier' },
  { chemin: '/dossier/:id',   ecran: 'dossier',      titre: 'Dossier' },
  { chemin: '/planning',      ecran: 'planning',     titre: 'Planning' },
  { chemin: '/parc',          ecran: 'parc',         titre: 'Parc' },
  { chemin: '/clients',       ecran: 'clients',      titre: 'Clients' },
  { chemin: '/client/:id',    ecran: 'client',       titre: 'Client' },
  { chemin: '/vehicules',     ecran: 'vehicules',    titre: 'Véhicules' },
  { chemin: '/vehicule/:id',  ecran: 'vehicule',     titre: 'Véhicule' },
  { chemin: '/devis',         ecran: 'devis',        titre: 'Devis' },
  { chemin: '/devis/:id',     ecran: 'ficheDevis',   titre: 'Devis' },
  { chemin: '/factures',      ecran: 'factures',     titre: 'Factures' },
  { chemin: '/facture/:id',   ecran: 'ficheFacture', titre: 'Facture' },
  { chemin: '/tarifs',        ecran: 'tarifs',       titre: 'Tarifs' },
  { chemin: '/stock',         ecran: 'stock',        titre: 'Stock' },
  { chemin: '/stock/:id',     ecran: 'fichePiece',   titre: 'Pièce' },
  { chemin: '/electronique',  ecran: 'electronique', titre: 'Électronique' },
  { chemin: '/ebp',           ecran: 'ebp',          titre: 'EBP' },
  { chemin: '/reglages',      ecran: 'reglages',     titre: 'Réglages' },
  { chemin: '/reglages/:onglet', ecran: 'reglages',  titre: 'Réglages' },
  /* Le portail confrère vit hors de l'outil : pas de menu, pas de session. */
  { chemin: '/pro/:jeton',    ecran: 'portail',      titre: 'Espace professionnel', libre: true, nu: true }
];

/* ==========================================================================
   AMORÇAGE
   ========================================================================== */

let dernierEcran = null;
let peintureEnCours = false;

async function demarrer() {
  try {
    await charger({ neuf: etatDeDepart, normaliser });
  } catch (e) {
    console.error('[yatech] chargement impossible', e);
    ecranDeSecours(e);
    return;
  }

  devise(S.etat.reglages.devise || 'EUR');
  coque.appliquerApparence(S.etat.reglages);

  /* On demande au navigateur de ne pas jeter nos données sous la pression.
     Sans ça, un téléphone à court de place peut vider la base sans prévenir. */
  base.rendrePersistant();

  reprendreSession();

  routeur.definir(ROUTES.map(r => ({ chemin: r.chemin, vue: r })));
  routeur.garde(garder);
  routeur.demarrer(peindre);

  coque.surveillerReseau();
  brancherRaccourcis();
  brancherVerrou();
  brancherServiceWorker();
  surveillerEcritures();

  const amorce = document.getElementById('amorce');
  if (amorce) {
    amorce.classList.add('amorce--partie');
    setTimeout(() => amorce.remove(), 260);
  }
}

/** Un garage neuf : l'équipe et le catalogue, rien d'autre. Pas une voiture
 *  sur le parc, pas un client inventé. */
function etatDeDepart() {
  const e = neuf();
  e.utilisateurs = equipeDepart();
  e.prestations = catalogueDepart();
  return e;
}

/* ==========================================================================
   LA SESSION
   Qui est connecté tient dans le stockage local de l'appareil : c'est propre à
   ce téléphone, ça ne voyage pas avec les données.
   ========================================================================== */

const CLE_SESSION = 'yatech.session';

function reprendreSession() {
  if (S.etat.reglages.demanderCode === false) {
    S.moi = S.etat.utilisateurs.find(u => u.actif) || S.etat.utilisateurs[0] || null;
    return;
  }
  try {
    const brut = localStorage.getItem(CLE_SESSION);
    if (!brut) return;
    const s = JSON.parse(brut);
    if (!s || !s.userId) return;
    /* Une session ouverte il y a trois semaines n'a plus de sens : on demande
       le code. Douze heures couvre une journée de travail et une nuit. */
    if (s.quand && Date.now() - s.quand > 12 * 3600000) { localStorage.removeItem(CLE_SESSION); return; }
    const u = S.etat.utilisateurs.find(x => x.id === s.userId && x.actif);
    if (u) S.moi = u;
  } catch (e) { /* session illisible : on redemandera le code */ }
}

export function ouvrirSession(utilisateur) {
  S.moi = utilisateur;
  try { localStorage.setItem(CLE_SESSION, JSON.stringify({ userId: utilisateur.id, quand: Date.now() })); }
  catch (e) { /* pas de mémoire de session : il faudra retaper le code */ }
  /* Les préférences de la personne l'emportent sur celles du garage. */
  const p = utilisateur.preferences || {};
  coque.appliquerApparence(Object.assign({}, S.etat.reglages, {
    theme: p.theme || S.etat.reglages.theme,
    densite: p.densite || S.etat.reglages.densite
  }));
}

export function fermerSession() {
  S.moi = null;
  try { localStorage.removeItem(CLE_SESSION); } catch (e) {}
  routeur.aller('/connexion');
}

/* ==========================================================================
   LA GARDE
   ========================================================================== */

function garder(destination) {
  const route = ROUTES.find(r => correspondChemin(r.chemin, destination.chemin));
  if (route && route.libre) return true;
  if (!S.moi) return '/connexion';
  return true;
}

function correspondChemin(motif, chemin) {
  const a = motif.split('/').filter(Boolean);
  const b = chemin.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((m, i) => m[0] === ':' || m === b[i]);
}

/* ==========================================================================
   PEINDRE UN ÉCRAN
   ========================================================================== */

async function peindre(ctx) {
  const route = ctx.route ? ctx.route.vue : null;

  /* Le portail confrère et l'écran de connexion vivent hors de la coque :
     ni menu, ni barre, ni onglets. */
  if (route && route.nu) {
    const racine = document.getElementById('app');
    racine.className = '';
    racine.hidden = false;
    await montrer(route, ctx, racine);
    return;
  }

  coque.peindreCoque();
  const zone = coque.contenu();
  if (!zone) return;

  if (!route) {
    poser(zone, ecranIntrouvable(ctx.chemin));
    coque.titreEcran('Introuvable');
    return;
  }

  coque.titreEcran(route.titre);
  await montrer(route, ctx, zone);
}

async function montrer(route, ctx, zone) {
  if (peintureEnCours) return;
  peintureEnCours = true;

  /* Sur un chargement lent, on montre qu'il se passe quelque chose — mais
     seulement au-delà de 180 ms, sinon l'écran clignote pour rien. */
  const minuteur = setTimeout(() => poser(zone, squelette()), 180);

  try {
    const module = await ECRANS[route.ecran]();
    clearTimeout(minuteur);
    if (routeur.actuelle().chemin !== ctx.chemin) { peintureEnCours = false; return; }

    const noeud = module.peindre({
      etat: S.etat,
      moi: S.moi,
      params: ctx.params,
      query: ctx.query,
      aller: routeur.aller,
      repeindre: () => routeur.repeindre()
    });
    poser(zone, noeud);
    dernierEcran = route.ecran;
  } catch (e) {
    clearTimeout(minuteur);
    console.error('[yatech] écran « ' + route.ecran + ' » en panne', e);
    poser(zone, ecranEnPanne(route, e));
  } finally {
    peintureEnCours = false;
  }
}

function squelette() {
  return h('div.pile', [
    h('div.squelette', { style: { width: '220px', height: '28px' } }),
    h('div.grille-indics', [1, 2, 3, 4].map(() =>
      h('div.squelette', { style: { height: '84px' } }))),
    h('div.squelette', { style: { height: '200px' } })
  ]);
}

function ecranIntrouvable(chemin) {
  return h('div.vide', [
    icone('question', { taille: 40 }),
    h('h3', 'Cet écran n’existe pas'),
    h('p', chemin),
    h('a.bt.bt--fort', { href: '#/' }, 'Revenir à l’accueil')
  ]);
}

function ecranEnPanne(route, erreur) {
  return h('div.vide', [
    icone('alerte', { taille: 40 }),
    h('h3', 'Cet écran n’a pas pu s’ouvrir'),
    h('p', 'Vos données sont intactes : le problème est à l’affichage.'),
    h('pre.petit.faible', {
      style: {
        maxWidth: '100%', overflow: 'auto', textAlign: 'left',
        background: 'var(--plan-2)', padding: 'var(--e-3)', borderRadius: 'var(--r-m)'
      }
    }, String(erreur && erreur.message ? erreur.message : erreur)),
    h('div.rang', [
      h('button.bt.bt--fort', { type: 'button', onclick: () => routeur.repeindre() }, 'Réessayer'),
      h('a.bt.bt--contour', { href: '#/' }, 'Accueil')
    ])
  ]);
}

/* ==========================================================================
   ÉCRAN DE SECOURS — quand même le chargement échoue
   ========================================================================== */

function ecranDeSecours(erreur) {
  const amorce = document.getElementById('amorce');
  if (amorce) amorce.remove();
  const racine = document.getElementById('app');
  racine.hidden = false;
  racine.className = '';
  poser(racine, h('div.connexion', h('div.connexion__boite', [
    h('div.connexion__marque', [
      h('img', { src: 'assets/icone.svg', alt: '', width: 52, height: 52 }),
      h('strong', 'Yatech')
    ]),
    h('div.bandeau.bandeau--danger', [
      icone('alerte'),
      h('div', [
        h('b', 'L’outil n’a pas pu s’ouvrir.'),
        h('div.petit', String(erreur && erreur.message ? erreur.message : erreur))
      ])
    ]),
    h('p.petit.faible', 'Cela arrive en navigation privée, ou quand le navigateur '
      + 'refuse d’enregistrer des données. Essayez une fenêtre normale, ou un autre navigateur.'),
    h('button.bt.bt--fort.bt--plein', {
      type: 'button', onclick: () => location.reload()
    }, 'Réessayer')
  ])));
}

/* ==========================================================================
   RACCOURCIS CLAVIER — pour qui travaille au comptoir, sur un vrai clavier
   ========================================================================== */

function brancherRaccourcis() {
  document.addEventListener('keydown', (ev) => {
    const dansUnChamp = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)
      || ev.target.isContentEditable;

    /* Recherche : « / » comme partout, et Ctrl/Cmd+K pour les habitués. */
    if ((ev.key === '/' && !dansUnChamp) || ((ev.ctrlKey || ev.metaKey) && ev.key === 'k')) {
      ev.preventDefault();
      coque.ouvrirPalette();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
      if (dansUnChamp) return;      // dans un champ, c'est le navigateur qui annule
      ev.preventDefault();
      const quoi = annuler();
      message(quoi ? 'Annulé : ' + quoi : 'Rien à annuler');
      routeur.repeindre();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y'
        || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) {
      if (dansUnChamp) return;
      ev.preventDefault();
      const quoi = refaire();
      if (quoi) { message('Refait : ' + quoi); routeur.repeindre(); }
      return;
    }
    if (dansUnChamp) return;

    /* Les chiffres mènent aux écrans principaux. */
    const raccourcis = { 1: '/', 2: '/atelier', 3: '/planning', 4: '/parc', 5: '/stock' };
    if (raccourcis[ev.key] && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      routeur.aller(raccourcis[ev.key]);
    }
  });
}

/* ==========================================================================
   VERROUILLAGE AUTOMATIQUE
   L'outil reste ouvert sur le comptoir toute la journée. Au bout d'un moment
   sans rien faire, il se referme — si le garage l'a demandé.
   ========================================================================== */

function brancherVerrou() {
  let minuteur = null;
  const relancer = () => {
    clearTimeout(minuteur);
    const minutes = Number(S.etat.reglages.verrouAuto) || 0;
    if (!minutes || !S.moi) return;
    minuteur = setTimeout(() => {
      if (!S.moi) return;
      fermerSession();
      message('Verrouillé après inactivité');
    }, minutes * 60000);
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(t =>
    document.addEventListener(t, attend(relancer, 900), { passive: true }));
  relancer();
}

/* ==========================================================================
   L'ÉCRITURE A ÉCHOUÉ
   Un disque plein, c'est une journée de travail perdue en silence. On le dit,
   et on le redit tant que ce n'est pas réglé.
   ========================================================================== */

function surveillerEcritures() {
  ecoute((detail) => {
    if (detail && detail.grave) {
      messageErreur('Impossible d’enregistrer : la mémoire de l’appareil est pleine. '
        + 'Faites une sauvegarde, puis libérez de la place.', {
        duree: 0,
        action: { texte: 'Sauvegarder', faire: () => coque.ouvrirTiroir() }
      });
    }
    /* Un autre onglet a modifié les données : on repeint pour ne pas afficher
       des chiffres périmés. */
    if (detail && detail.quoi === 'ailleurs') routeur.repeindre();
  });
}

/* ==========================================================================
   MISE À JOUR DE L'APPLICATION
   ========================================================================== */

function brancherServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;      // inutile hors serveur
  navigator.serviceWorker.register('sw.js').then((inscription) => {
    inscription.addEventListener('updatefound', () => {
      /* Surtout pas nommé `neuf` : ce nom est déjà celui de la fabrique
         d'état importée plus haut, et le masquer ici brouille la lecture. */
      const arrivant = inscription.installing;
      if (!arrivant) return;
      arrivant.addEventListener('statechange', () => {
        if (arrivant.state === 'installed' && navigator.serviceWorker.controller) {
          message('Une nouvelle version est prête', {
            duree: 0,
            action: {
              texte: 'Recharger',
              faire: () => { arrivant.postMessage('maintenant'); location.reload(); }
            }
          });
        }
      });
    });
  }).catch(() => { /* pas de service worker : l'outil marche quand même */ });
}

/* --- on y va -------------------------------------------------------------- */
demarrer();

/* Une erreur qui remonte jusqu'ici ne doit pas laisser un écran blanc muet. */
window.addEventListener('error', (ev) => {
  console.error('[yatech]', ev.error || ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[yatech] promesse rejetée', ev.reason);
});
