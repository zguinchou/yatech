/* ==========================================================================
   YATECH — la veille
   --------------------------------------------------------------------------
   Ce qui tire la manche quand personne ne regarde l'écran.

   Ce qu'elle fait, très exactement : elle surveille la liste d'alertes que
   `selecteurs.alertes()` calcule à partir de l'état, et quand une NOUVELLE
   alerte y apparaît, elle envoie un avertissement du navigateur — celui qui
   s'affiche par-dessus les autres fenêtres, même sur un autre onglet.

   Ce qu'elle ne fait pas, et il faut le dire franchement :

   • elle ne réveille personne la nuit et n'envoie ni SMS ni e-mail. Une page
     hébergée n'expédie rien toute seule ; pour joindre quelqu'un qui n'est pas
     devant l'écran, il y a « Prévenir » — le message est préparé, la personne
     l'envoie d'un geste ;
   • elle ne fonctionne QUE si l'outil est ouvert quelque part. Tous les
     onglets fermés, plus de veille. C'est la limite d'un outil sans serveur,
     et l'écran de réglage le dit en toutes lettres.

   Une alerte n'est pas stockée : elle existe tant que sa cause existe. La
   veille se souvient seulement de ce qu'elle a DÉJÀ annoncé, sur cet appareil,
   pour ne pas le redire à chaque battement.
   ========================================================================== */

import { S, ecoute } from './store.js';
import { attend } from './util.js';
import { alertes } from '../domain/selecteurs.js';
import { FAMILLES_ALERTE } from '../domain/schema.js';

const CLE_VUES = 'yatech.veille-vues';
/* Une minute : les alertes dépendent aussi de l'heure — un devis devient
   « sans réponse » au passage de minuit, une pièce « en retard » le jour de
   sa date annoncée. Sans battement, on l'apprendrait au prochain clic. */
const BATTEMENT = 60000;
/* On ne fait pas apparaître huit bulles d'un coup au premier chargement. */
const MAX_D_UN_COUP = 3;

let minuteur = null;
let branchee = false;

/* ==========================================================================
   CE QUI SE RÈGLE
   ========================================================================== */

/**
 * Les réglages qui s'appliquent à cette personne : ceux du garage, corrigés
 * des siens. Champ par champ — quelqu'un peut vouloir le son sans toucher au
 * reste, ou la paix le soir alors que l'atelier n'en demande pas.
 */
export function reglagesDe(reglages, moi) {
  const garage = (reglages && reglages.notifs) || {};
  const perso = (moi && moi.preferences && moi.preferences.notifs) || null;
  const fusion = Object.assign({}, garage, perso || {});
  fusion.quoi = Object.assign({}, garage.quoi || {}, (perso && perso.quoi) || {});
  return fusion;
}

/** Est-on dans les heures où l'on ne dérange pas ? */
export function silencieux(r, quand) {
  if (!r || !r.silenceActif) return false;
  const d = new Date(quand === undefined ? Date.now() : quand);
  const m = d.getHours() * 60 + d.getMinutes();
  const de = Number(r.silenceDe) || 0;
  const a = Number(r.silenceA) || 0;
  if (de === a) return false;
  /* La plage traverse minuit une fois sur deux : 19 h → 7 h 30. */
  return de < a ? (m >= de && m < a) : (m >= de || m < a);
}

/** Le poids d'une alerte : combien de choses elle recouvre. */
const combien = (a) => Math.max(1, Number(a && a.nb) || 1);

/**
 * Ce qu'il faut annoncer, maintenant. Fonction pure : c'est elle qu'on éprouve.
 *
 * La règle n'est pas « je ne l'ai pas encore vue » mais « ça a empiré ».
 * « Deux personnes à rappeler » ne doit sonner qu'une fois ; quand un
 * troisième appelle, c'est un fait nouveau et ça sonne. Quand on en traite
 * un et qu'il n'en reste qu'un, ça ne sonne pas : on est en train de le
 * régler, on n'a pas besoin qu'on nous le rappelle.
 *
 * @param {object[]} liste  les alertes du moment
 * @param {object} vues     ce qui a déjà été annoncé : { clé: combien }
 * @param {object} r        les réglages de la personne
 * @param {number} [quand]
 */
export function aAnnoncer(liste, vues, r, quand) {
  if (!r || !r.actives) return [];
  if (silencieux(r, quand)) return [];
  const deja = (vues && typeof vues === 'object' && !Array.isArray(vues)) ? vues : {};
  const quoi = r.quoi || {};
  return (liste || [])
    .filter(a => a && a.cle)
    .filter(a => deja[a.cle] === undefined || combien(a) > deja[a.cle])
    /* Une famille inconnue — une alerte ajoutée par une mise à jour — passe :
       mieux vaut un avertissement de trop qu'un impayé qu'on n'apprend pas. */
    .filter(a => !FAMILLES_ALERTE[a.famille] || quoi[a.famille] !== false)
    .slice(0, MAX_D_UN_COUP);
}

/**
 * Ce qu'il faut retenir après ce tour : chaque alerte encore vivante avec son
 * poids du moment. Ce qui a disparu est oublié — si ça revient, c'est un fait
 * nouveau et ça sonnera.
 */
export function vuesSuivantes(liste) {
  const garde = {};
  for (const a of liste || []) if (a && a.cle) garde[a.cle] = combien(a);
  return garde;
}

/* ==========================================================================
   LE NAVIGATEUR
   ========================================================================== */

/** 'granted' | 'denied' | 'default' | 'impossible' */
export function etatPermission() {
  if (typeof Notification === 'undefined') return 'impossible';
  return Notification.permission;
}

/** Se demande depuis un geste de la personne, jamais toute seule. */
export function demanderPermission() {
  if (typeof Notification === 'undefined') return Promise.resolve('impossible');
  try {
    const r = Notification.requestPermission();
    return (r && typeof r.then === 'function') ? r : Promise.resolve(Notification.permission);
  } catch (e) {
    return Promise.resolve(Notification.permission);
  }
}

/** Une bulle. Rend vrai si elle est partie. */
export function annoncer(titre, corps, etiquette) {
  if (etatPermission() !== 'granted') return false;
  try {
    /* `tag` : deux alertes de la même famille se remplacent au lieu de
       s'empiler. On revient de déjeuner, on a une bulle par famille, pas
       quarante. */
    new Notification(titre, { body: corps, tag: etiquette || 'yatech', icon: 'assets/icone.svg' });
    return true;
  } catch (e) { return false; }
}

/* Un son court, fabriqué sur place : aucun fichier à charger, et rien qui
   parte de l'appareil si le navigateur refuse. */
export function sonner() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.26);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
    setTimeout(() => { try { ctx.close(); } catch (err) {} }, 600);
  } catch (e) { /* le navigateur refuse le son : ce n'est pas grave */ }
}

/** Un essai, depuis l'écran de réglage : on veut voir à quoi ça ressemble. */
export function essai(r) {
  const ok = annoncer('Yatech', 'Voilà à quoi ressemble un avertissement.', 'yatech-essai');
  if (ok && r && r.son) sonner();
  return ok;
}

/* ==========================================================================
   LE SUIVI, SUR CET APPAREIL
   Ce qui a déjà été annoncé ne voyage pas avec les données : c'est propre à
   ce téléphone. Le même impayé doit pouvoir sonner une fois chez chacun.
   ========================================================================== */

/** A-t-on déjà pris le pouls de cet appareil ? */
function amorcee() {
  try {
    const brut = localStorage.getItem(CLE_VUES);
    if (brut === null) return false;
    const o = JSON.parse(brut);
    return !!(o && typeof o === 'object' && !Array.isArray(o));
  } catch (e) { return false; }
}

function lireVues() {
  try {
    const brut = localStorage.getItem(CLE_VUES);
    const o = brut ? JSON.parse(brut) : null;
    /* Un format d'avant — une simple liste de clés — ne se convertit pas :
       on repart du pouls, ce qui coûte un tour de silence et rien d'autre. */
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

function ecrireVues(vues) {
  try { localStorage.setItem(CLE_VUES, JSON.stringify(vues)); }
  catch (e) { /* pas de mémoire : on redira une fois, ce n'est pas grave */ }
}

/** Repart de zéro : après un changement de personne, par exemple. */
export function oublier() {
  try { localStorage.removeItem(CLE_VUES); } catch (e) {}
}

/* ==========================================================================
   LE BATTEMENT
   ========================================================================== */

function battre() {
  if (!S.etat || !S.moi) return;
  const r = reglagesDe(S.etat.reglages, S.moi);
  const liste = alertes(S.etat);

  majTitre(liste.length);

  /* Le premier tour sur cet appareil ne dit rien : il prend le pouls.
     Autrement, la personne qui vient d'allumer les avertissements reçoit
     l'arriéré de la semaine en pleine figure, et les éteint aussitôt. On ne
     signale que ce qui apparaît APRÈS. */
  const premier = !amorcee();

  if (premier || !r.actives || etatPermission() !== 'granted') {
    ecrireVues(vuesSuivantes(liste));
    return;
  }

  const aDire = aAnnoncer(liste, lireVues(), r);
  for (const a of aDire) {
    annoncer(a.titre, a.detail || '', 'yatech-' + (a.famille || 'divers'));
  }
  if (aDire.length && r.son) sonner();
  /* Tout ce qui existe est retenu, pas seulement ce qu'on vient de dire : le
     reste d'une salve ne doit pas ressortir au tour suivant, en gouttes. */
  ecrireVues(vuesSuivantes(liste));
}

/* Le titre de l'onglet porte le compte : dans une rangée d'onglets, c'est ce
   qu'on voit sans rien ouvrir. */
let titreDeBase = null;
function majTitre(n) {
  if (titreDeBase === null) titreDeBase = document.title.replace(/^\(\d+\)\s*/, '');
  const propre = document.title.replace(/^\(\d+\)\s*/, '');
  document.title = n > 0 ? '(' + n + ') ' + propre : propre;
}

/** Branche la veille. Appelée une fois, au démarrage. */
export function demarrer() {
  if (branchee) return;
  branchee = true;
  /* Un premier tour à retardement : au chargement, l'écran s'installe et on
     ne veut pas trois bulles par-dessus. */
  setTimeout(battre, 4000);
  minuteur = setInterval(battre, BATTEMENT);
  /* Toute modification de l'état peut faire naître une alerte : on ne se
     contente pas du battement, sinon on apprend une demande de créneau avec
     une minute de retard. Mais on regroupe : enregistrer un devis, c'est
     plusieurs modifications à la suite, et ça ne fait pas plusieurs bulles. */
  const bientot = attend(battre, 1200);
  ecoute(bientot);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) battre();
  });
}

export function arreter() {
  if (minuteur) clearInterval(minuteur);
  minuteur = null;
  branchee = false;
}
