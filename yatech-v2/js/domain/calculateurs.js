/* ==========================================================================
   YATECH — la mémoire des calculateurs
   --------------------------------------------------------------------------
   Le temps perdu en électronique, ce n'est pas la lecture : c'est la demi-heure
   passée à chercher par où entrer. Un EDC17 qui se lit par la prise mais ne
   s'écrit qu'au bench, on ne le découvre qu'en essayant — une fois. La
   deuxième fois, l'atelier doit s'en souvenir à notre place.

   Ce module ne devine rien et ne contient aucune base de données : tout sort
   des interventions déjà enregistrées dans ce garage. Ce qu'on sait, on le
   sait parce qu'on l'a fait.

   Une voie, ici, c'est un couple opération + accès : « lecture par OBD »,
   « écriture au bench ». C'est ça qu'on retient, pas le calculateur tout seul :
   savoir qu'un EDC17C64 « se fait par OBD » ne sert à rien si c'est vrai en
   lecture et faux en écriture.
   ========================================================================== */

import { PROTOCOLES, OPERATIONS_ELECTRO, MODIFICATIONS_ELECTRO,
  CONTROLES_ELECTRO, OPERATIONS_QUI_ECRIVENT } from './schema.js';
import { nombre } from '../core/util.js';

/** La clé de regroupement : deux orthographes du même boîtier doivent tomber
 *  ensemble. « EDC17 C64 », « edc17-c64 » et « EDC17C64 » sont le même. */
export function cleCalculateur(type) {
  return String(type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Le type saisi sur une intervention, tel quel. */
export function typeCalculateur(i) {
  return String((i && i.ecu && i.ecu.type) || '').trim();
}

/** La médiane, pas la moyenne : une intervention qui a traîné trois heures
 *  parce que le client parlait ne doit pas fausser l'estimation. */
function mediane(liste) {
  const l = liste.filter(n => n > 0).sort((a, b) => a - b);
  if (!l.length) return 0;
  const m = Math.floor(l.length / 2);
  return l.length % 2 ? l[m] : Math.round((l[m - 1] + l[m]) / 2);
}

function voieNeuve(operation, protocole) {
  return {
    operation, protocole,
    ok: 0, ko: 0, dernier: 0,
    minutes: [], credits: [],
    /* Ce que l'intervention réussie la plus récente a laissé comme note :
       c'est souvent là qu'est le piège de branchement. */
    astuce: ''
  };
}

/**
 * Tout ce que le garage sait d'un type de calculateur.
 * @param {object} etat   l'état complet
 * @param {string} type   le type cherché ; la casse et les tirets sont ignorés
 * @param {string} [sauf] identifiant d'une intervention à ne PAS compter.
 *        Une fiche ouverte en modification s'apprendrait sinon à elle-même :
 *        elle citerait son propre accès comme s'il avait fait ses preuves, et
 *        annoncerait un boîtier « déjà ouvert 3 fois » alors qu'on est en
 *        train d'écrire la troisième.
 * @returns {object|null} null si on ne l'a jamais ouvert
 */
export function ficheCalculateur(etat, type, sauf) {
  const cle = cleCalculateur(type);
  if (!cle) return null;

  const fiche = {
    type: String(type || '').trim(), marque: '', nb: 0, reussies: 0, dernier: 0,
    vehicules: [], voies: [], operations: [], modifications: []
  };
  const voies = new Map();
  const vus = new Set();
  const modifs = new Map();

  for (const i of etat.interventions || []) {
    if (sauf && i.id === sauf) continue;
    if (cleCalculateur(typeCalculateur(i)) !== cle) continue;
    /* Une intervention prévue ou annulée n'apprend rien : elle n'a pas eu
       lieu. On ne retient que ce qui a été tenté pour de bon. */
    if (i.etat !== 'ok' && i.etat !== 'echec') continue;

    fiche.nb++;
    if (i.etat === 'ok') fiche.reussies++;
    if (i.vehiculeId && !vus.has(i.vehiculeId)) { vus.add(i.vehiculeId); fiche.vehicules.push(i.vehiculeId); }
    if (i.quand > fiche.dernier) {
      fiche.dernier = i.quand;
      fiche.type = typeCalculateur(i) || fiche.type;
      if (i.ecu && i.ecu.marque) fiche.marque = i.ecu.marque;
    }

    /* Ce qu'on a déjà fait sur ce boîtier : au troisième Stage 1 sur le même
       calculateur, on sait ce qu'on vend et combien de temps ça prend. */
    if (i.etat === 'ok') {
      for (const m of i.modifications || []) {
        if (!MODIFICATIONS_ELECTRO[m]) continue;
        modifs.set(m, (modifs.get(m) || 0) + 1);
      }
    }

    const k = i.operation + '|' + i.protocole;
    let v = voies.get(k);
    if (!v) { v = voieNeuve(i.operation, i.protocole); voies.set(k, v); }
    if (i.etat === 'ok') {
      v.ok++;
      if (nombre(i.dureeMin, 0) > 0) v.minutes.push(nombre(i.dureeMin, 0));
      if (nombre(i.credits, 0) > 0) v.credits.push(nombre(i.credits, 0));
      if (i.quand >= v.dernier && (i.notes || '').trim()) v.astuce = String(i.notes).trim();
    } else {
      v.ko++;
    }
    if (i.quand > v.dernier) v.dernier = i.quand;
  }

  if (!fiche.nb) return null;

  fiche.voies = Array.from(voies.values()).map(v => Object.assign(v, {
    minutesTypiques: mediane(v.minutes),
    creditsTypiques: mediane(v.credits),
    nomOperation: (OPERATIONS_ELECTRO[v.operation] || {}).nom || v.operation,
    nomProtocole: (PROTOCOLES[v.protocole] || {}).nom || v.protocole
  }));

  /* Regroupé par opération, parce que c'est la question qu'on se pose devant
     la voiture : « pour l'écrire, je passe par où ? » */
  const parOp = new Map();
  for (const v of fiche.voies) {
    if (!parOp.has(v.operation)) {
      parOp.set(v.operation, {
        operation: v.operation, nom: v.nomOperation, voies: [],
        sure: null, echouees: []
      });
    }
    parOp.get(v.operation).voies.push(v);
  }

  for (const op of parOp.values()) {
    /* La voie à conseiller : celle qui a le plus de réussites. À égalité, la
       plus récente — un boîtier peut avoir changé de firmware entre-temps. */
    op.voies.sort((a, b) => (b.ok - a.ok) || (b.dernier - a.dernier));
    op.sure = op.voies.find(v => v.ok > 0) || null;
    /* Un accès qui n'a jamais rien donné et qui a déjà échoué : c'est le
       quart d'heure qu'on ne repassera pas dessus. */
    op.echouees = op.voies.filter(v => v.ok === 0 && v.ko > 0);
  }

  fiche.modifications = Array.from(modifs.entries())
    .map(([cle, nb]) => Object.assign({ cle, nb }, MODIFICATIONS_ELECTRO[cle]))
    .sort((a, b) => b.nb - a.nb);

  const ordre = Object.keys(OPERATIONS_ELECTRO);
  fiche.operations = Array.from(parOp.values())
    .sort((a, b) => ordre.indexOf(a.operation) - ordre.indexOf(b.operation));

  return fiche;
}

/**
 * Tous les calculateurs déjà ouverts, du plus récent au plus ancien.
 * @param {object} etat
 * @returns {object[]} des fiches, comme ficheCalculateur()
 */
export function calculateursConnus(etat) {
  const cles = new Map();
  for (const i of etat.interventions || []) {
    const t = typeCalculateur(i);
    const c = cleCalculateur(t);
    if (!c || cles.has(c)) continue;
    cles.set(c, t);
  }
  return Array.from(cles.values())
    .map(t => ficheCalculateur(etat, t))
    .filter(Boolean)
    .sort((a, b) => b.dernier - a.dernier);
}

/**
 * La phrase à lire devant la voiture, pour une opération donnée.
 * Rend null quand le garage n'a rien à en dire — on préfère se taire plutôt
 * que d'affirmer à partir d'une seule tentative douteuse.
 */
export function conseilAcces(fiche, operation) {
  if (!fiche) return null;
  const op = fiche.operations.find(o => o.operation === operation);
  if (!op) return null;
  return {
    operation: op.operation, nom: op.nom,
    sure: op.sure, echouees: op.echouees,
    voies: op.voies
  };
}


/* ==========================================================================
   LE DÉROULÉ QU'ON NE SAUTE PAS
   ========================================================================== */

/** L'opération écrit-elle dans le calculateur ? */
export function ecritDansLeBoitier(operation) {
  return OPERATIONS_QUI_ECRIVENT.indexOf(operation) >= 0;
}

/**
 * Les contrôles bloquants qui n'ont pas été cochés, pour une intervention
 * qu'on s'apprête à déclarer réussie. Vide quand tout va bien — et vide aussi
 * quand l'opération n'écrit rien : relever des défauts ne brique personne.
 */
export function controlesManquants(intervention) {
  const i = intervention || {};
  if (!ecritDansLeBoitier(i.operation)) return [];
  if (i.etat && i.etat !== 'ok') return [];
  const coches = i.controles || {};
  return Object.keys(CONTROLES_ELECTRO)
    .filter(k => CONTROLES_ELECTRO[k].bloquant && !coches[k])
    .map(k => Object.assign({ cle: k }, CONTROLES_ELECTRO[k]));
}

/* ==========================================================================
   CE QUE L'ATELIER PROGRAMME LE PLUS
   ========================================================================== */

/**
 * Les modifications les plus faites, sur une période.
 * @param {object} etat
 * @param {number} [depuis]  début de période en millisecondes ; tout si absent
 * @returns {object[]} [{ cle, nom, famille, route, nb, minutes }]
 */
export function programmesFrequents(etat, depuis) {
  const par = new Map();
  for (const i of etat.interventions || []) {
    if (i.etat !== 'ok') continue;
    if (depuis && i.quand < depuis) continue;
    for (const m of i.modifications || []) {
      const def = MODIFICATIONS_ELECTRO[m];
      if (!def) continue;
      let x = par.get(m);
      if (!x) { x = Object.assign({ cle: m, nb: 0, minutes: [] }, def); par.set(m, x); }
      x.nb++;
      if (nombre(i.dureeMin, 0) > 0) x.minutes.push(nombre(i.dureeMin, 0));
    }
  }
  return Array.from(par.values())
    .map(x => Object.assign(x, { minutesTypiques: mediane(x.minutes) }))
    .sort((a, b) => b.nb - a.nb);
}
