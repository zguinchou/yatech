/* ==========================================================================
   YATECH — le magasin
   --------------------------------------------------------------------------
   Un seul objet contient l'état du garage. Personne ne le modifie directement :
   tout passe par `maj()`, qui note ce qui a changé, enregistre, prévient les
   écrans et garde de quoi revenir en arrière.

   Ce passage obligé achète trois choses :
     • l'annulation — un geste de trop se rattrape ;
     • le journal   — « qui a supprimé ce dossier ? » a une réponse ;
     • la cohérence — deux onglets ouverts ne se marchent pas dessus.
   ========================================================================== */

import * as base from './db.js';
import { copie, id, attend } from './util.js';

export const S = {
  etat: null,        // le document complet
  moi: null,         // la personne connectée (objet utilisateur)
  pret: false,       // vrai une fois l'état chargé
  mode: 'base',      // 'base' ou 'secours'
  sale: false,       // des changements attendent d'être écrits
  derniereEcriture: 0
};

const auditeurs = new Set();
const pile = [];               // pour annuler
const pileRefaire = [];
const PILE_MAX = 30;

/* Chaque onglet a son nom : c'est ce qui permet d'ignorer ses propres échos. */
const MOI_ONGLET = id('tab');
let canal = null;

/* --------------------------------------------------------------------------
   Démarrage
   -------------------------------------------------------------------------- */

/**
 * Charge l'état, ou en fabrique un neuf.
 * @param {object} recettes { neuf(), normaliser(etat) } — fournies par le
 *        domaine, pour que le magasin ne sache rien du métier.
 */
export async function charger(recettes) {
  S.mode = await base.demarrer();

  let doc = null;
  try { doc = await base.lireEtat(); }
  catch (e) { doc = null; }

  if (!doc || typeof doc !== 'object') doc = recettes.neuf();
  S.etat = recettes.normaliser(doc);
  S.pret = true;

  brancherCanal(recettes);
  brancherFermeture();
  return S.etat;
}

/* --------------------------------------------------------------------------
   Modifier
   -------------------------------------------------------------------------- */

/**
 * Applique un changement.
 * @param {string}   quoi     ce qui s'est passé, en français, pour le journal
 * @param {function} faire    reçoit l'état, le modifie sur place
 * @param {object}   [opts]   { annulable, journal, cible, silencieux }
 */
export function maj(quoi, faire, opts) {
  if (!S.etat) return null;
  const o = opts || {};

  const avant = o.annulable === false ? null : JSON.stringify(S.etat);

  let retour;
  try {
    retour = faire(S.etat);
  } catch (e) {
    /* Une modification qui casse en plein milieu laisse l'état à moitié écrit.
       On le remet exactement comme il était : mieux vaut ne rien faire que
       laisser un dossier sans client. */
    if (avant) { try { S.etat = JSON.parse(avant); } catch (e2) {} }
    console.error('[yatech] changement abandonné :', quoi, e);
    throw e;
  }

  if (avant) {
    pile.push({ quoi, doc: avant });
    if (pile.length > PILE_MAX) pile.shift();
    pileRefaire.length = 0;    // on repart d'une nouvelle branche d'histoire
  }

  if (o.journal !== false && quoi) noter(quoi, o.cible);

  S.sale = true;
  planifierEcriture();
  if (!o.silencieux) prevenir({ quoi, cible: o.cible });
  return retour;
}

/** Une modification qui ne se journalise pas et ne s'annule pas : un filtre
 *  déplié, une colonne triée. Ça change l'état, pas le travail. */
export function majLegere(faire) {
  return maj(null, faire, { annulable: false, journal: false });
}

/** Revenir en arrière d'un cran. */
export function annuler() {
  const pas = pile.pop();
  if (!pas) return null;
  pileRefaire.push({ quoi: pas.quoi, doc: JSON.stringify(S.etat) });
  try { S.etat = JSON.parse(pas.doc); }
  catch (e) { return null; }
  S.sale = true;
  planifierEcriture();
  prevenir({ quoi: 'annulation' });
  return pas.quoi;
}

/** Refaire ce qu'on vient d'annuler. */
export function refaire() {
  const pas = pileRefaire.pop();
  if (!pas) return null;
  pile.push({ quoi: pas.quoi, doc: JSON.stringify(S.etat) });
  try { S.etat = JSON.parse(pas.doc); }
  catch (e) { return null; }
  S.sale = true;
  planifierEcriture();
  prevenir({ quoi: 'répétition' });
  return pas.quoi;
}

export const peutAnnuler = () => pile.length > 0;
export const peutRefaire = () => pileRefaire.length > 0;
export const dernierGeste = () => (pile.length ? pile[pile.length - 1].quoi : null);

/** Remplace tout l'état : restauration d'une sauvegarde, import. */
export function remplacer(doc, recettes) {
  pile.length = 0;
  pileRefaire.length = 0;
  S.etat = recettes.normaliser(doc);
  S.sale = true;
  planifierEcriture();
  prevenir({ quoi: 'restauration' });
}

/* --------------------------------------------------------------------------
   Le journal — qui a fait quoi, et quand
   -------------------------------------------------------------------------- */

const JOURNAL_MAX = 3000;

export function noter(quoi, cible) {
  if (!S.etat) return;
  if (!Array.isArray(S.etat.journal)) S.etat.journal = [];
  S.etat.journal.push({
    id: id('j'),
    quand: Date.now(),
    qui: S.moi ? S.moi.id : null,
    quoi: String(quoi),
    cible: cible || null
  });
  /* Le journal ne doit pas grossir sans fin : au-delà, les plus vieilles
     lignes n'apprennent plus rien à personne. */
  if (S.etat.journal.length > JOURNAL_MAX) {
    S.etat.journal.splice(0, S.etat.journal.length - JOURNAL_MAX);
  }
}

/* --------------------------------------------------------------------------
   Écouter
   -------------------------------------------------------------------------- */

/** S'abonne aux changements. Rend la fonction qui désabonne. */
export function ecoute(fn) {
  auditeurs.add(fn);
  return () => auditeurs.delete(fn);
}

function prevenir(detail) {
  for (const fn of Array.from(auditeurs)) {
    try { fn(detail || {}); }
    catch (e) { console.error('[yatech] un écran a mal réagi au changement', e); }
  }
}

/* --------------------------------------------------------------------------
   Écriture
   On n'écrit pas à chaque frappe : on attend le calme. Mais on n'attend jamais
   quand l'onglet se ferme ou passe en arrière-plan — c'est là qu'on perd tout.
   -------------------------------------------------------------------------- */

let ecritureEnCours = null;
let echecSignale = false;

const planifierEcriture = attend(() => { ecrire(); }, 400);

export async function ecrire() {
  if (!S.etat || !S.sale) return true;
  if (ecritureEnCours) return ecritureEnCours;

  const doc = S.etat;
  S.sale = false;
  ecritureEnCours = base.ecrireEtat(doc)
    .then((ok) => {
      if (ok) {
        S.derniereEcriture = Date.now();
        echecSignale = false;
        diffuser();
      } else if (!echecSignale) {
        echecSignale = true;
        /* Plus de place : il faut le dire, et fort. Continuer en silence, c'est
           laisser quelqu'un travailler une journée pour rien. */
        prevenir({ quoi: 'écriture impossible', grave: true });
      }
      return ok;
    })
    .catch(() => { S.sale = true; return false; })
    .finally(() => { ecritureEnCours = null; });

  return ecritureEnCours;
}

/** Force l'écriture immédiate et attend qu'elle soit finie. */
export async function ecrireMaintenant() {
  planifierEcriture.annule();
  S.sale = true;
  return ecrire();
}

function brancherFermeture() {
  /* `pagehide` et `visibilitychange` sont les seuls signaux fiables sur
     téléphone : `beforeunload` ne se déclenche pas quand on balaie l'appli
     hors de l'écran. */
  const vite = () => { if (S.sale) { planifierEcriture.annule(); ecrire(); } };
  window.addEventListener('pagehide', vite);
  window.addEventListener('beforeunload', vite);
  document.addEventListener('visibilitychange', () => { if (document.hidden) vite(); });
}

/* --------------------------------------------------------------------------
   Plusieurs onglets ouverts
   La secrétaire garde le planning d'un côté et une fiche client de l'autre. Un
   changement d'un côté doit se voir de l'autre, sans recharger la page.
   -------------------------------------------------------------------------- */

function brancherCanal(recettes) {
  if (typeof BroadcastChannel === 'undefined') return;
  try { canal = new BroadcastChannel('yatech'); }
  catch (e) { return; }

  canal.onmessage = async (e) => {
    const m = e.data;
    if (!m || m.onglet === MOI_ONGLET) return;
    if (m.type !== 'ecrit') return;
    /* Un autre onglet a enregistré : on relit plutôt que de deviner. On ne
       recharge pas si on a soi-même des changements en attente — ce serait les
       écraser ; ils partiront d'abord, et l'autre onglet relira à son tour. */
    if (S.sale || ecritureEnCours) return;
    try {
      const doc = await base.lireEtat();
      if (doc) {
        S.etat = recettes.normaliser(doc);
        pile.length = 0;          // l'histoire locale ne colle plus
        pileRefaire.length = 0;
        prevenir({ quoi: 'ailleurs' });
      }
    } catch (err) { /* on garde ce qu'on a */ }
  };
}

function diffuser() {
  if (!canal) return;
  try { canal.postMessage({ type: 'ecrit', onglet: MOI_ONGLET, quand: Date.now() }); }
  catch (e) { /* canal fermé : sans importance */ }
}

/* --------------------------------------------------------------------------
   Raccourcis de lecture
   -------------------------------------------------------------------------- */

/** Une collection, toujours un tableau même si l'état est incomplet. */
export function liste(nom) {
  const v = S.etat ? S.etat[nom] : null;
  return Array.isArray(v) ? v : [];
}

/** Un élément par son identifiant. */
export function trouve(nom, identifiant) {
  if (!identifiant) return null;
  return liste(nom).find(x => x.id === identifiant) || null;
}

/** Ajoute un élément à une collection et rend l'élément posé. */
export function ajoute(nom, objet, quoi) {
  return maj(quoi || 'ajout', (e) => {
    if (!Array.isArray(e[nom])) e[nom] = [];
    e[nom].push(objet);
    return objet;
  }, { cible: { type: nom, id: objet.id } });
}

/** Modifie un élément : `change('clients', id, {tel: '06…'})`. */
export function change(nom, identifiant, champs, quoi) {
  return maj(quoi || 'modification', (e) => {
    const x = (e[nom] || []).find(o => o.id === identifiant);
    if (!x) return null;
    Object.assign(x, typeof champs === 'function' ? champs(x) : champs);
    x.maj = Date.now();
    return x;
  }, { cible: { type: nom, id: identifiant } });
}

/** Retire un élément. */
export function retire(nom, identifiant, quoi) {
  return maj(quoi || 'suppression', (e) => {
    const i = (e[nom] || []).findIndex(o => o.id === identifiant);
    if (i < 0) return false;
    e[nom].splice(i, 1);
    return true;
  }, { cible: { type: nom, id: identifiant } });
}

/** Une copie franche de l'état, pour l'exporter sans risquer de le modifier. */
export const instantane = () => copie(S.etat);
