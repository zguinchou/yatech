/* ==========================================================================
   YATECH — routeur
   --------------------------------------------------------------------------
   L'adresse suit ce qu'on regarde : #/dossier/abc, #/clients?q=dupont. Trois
   raisons, toutes concrètes :
     • le bouton « retour » du téléphone fait ce qu'on attend ;
     • une fiche s'envoie par message, le lien rouvre au bon endroit ;
     • recharger la page ne renvoie pas à l'accueil.

   On reste sur le dièse plutôt que sur l'API d'historique : l'outil doit aussi
   tourner déposé sur une clé USB ou derrière un hébergeur qui ne réécrit rien.
   ========================================================================== */

const routes = [];
let rendu = null;             // fonction appelée pour peindre
let courante = { chemin: '/', params: {}, query: {}, brut: '#/' };
let avant = null;             // garde : peut refuser ou détourner
let dernierRendu = 0;

/* On se souvient de la hauteur de défilement de chaque écran : revenir d'une
   fiche vers une longue liste doit retomber là où on l'avait laissée. */
const defilements = new Map();

/**
 * Déclare les routes.
 * @param {Array} liste  [{ chemin:'/dossier/:id', vue: fn, titre: '…' }]
 */
export function definir(liste) {
  routes.length = 0;
  for (const r of liste) routes.push(compiler(r));
}

function compiler(r) {
  const morceaux = r.chemin.split('/').filter(Boolean);
  const noms = [];
  const motif = '^/' + morceaux.map(m => {
    if (m[0] === ':') { noms.push(m.slice(1)); return '([^/]+)'; }
    if (m === '*') { noms.push('reste'); return '(.*)'; }
    return m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/') + '/?$';
  return Object.assign({}, r, { regex: new RegExp(motif), noms });
}

/** Lit l'adresse actuelle et en tire chemin, paramètres et question. */
function lireAdresse() {
  let brut = location.hash || '#/';
  if (brut[0] === '#') brut = brut.slice(1);
  if (!brut.startsWith('/')) brut = '/' + brut;

  const coupe = brut.indexOf('?');
  const chemin = coupe >= 0 ? brut.slice(0, coupe) : brut;
  const query = {};
  if (coupe >= 0) {
    const p = new URLSearchParams(brut.slice(coupe + 1));
    for (const [k, v] of p) query[k] = v;
  }
  return { chemin: decodeURI(chemin), query, brut };
}

function apparier(chemin) {
  for (const r of routes) {
    const m = r.regex.exec(chemin);
    if (!m) continue;
    const params = {};
    r.noms.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1] || ''); });
    return { route: r, params };
  }
  return null;
}

/** Se rendre quelque part. `remplace` : sans laisser de trace dans l'historique. */
export function aller(chemin, options) {
  const o = options || {};
  const cible = chemin.startsWith('#') ? chemin : '#' + (chemin.startsWith('/') ? chemin : '/' + chemin);
  if (location.hash === cible) { peindre(); return; }
  /* On note où on en était AVANT de partir, sinon la position est déjà perdue. */
  defilements.set(courante.chemin, fenetreDefilement());
  if (o.remplace) location.replace(cible);
  else location.hash = cible;
}

/** Revenir en arrière, ou à l'accueil s'il n'y a pas d'arrière. */
export function retour(secours) {
  if (history.length > 1) history.back();
  else aller(secours || '/');
}

/** Change un paramètre de question sans quitter l'écran (filtre, tri). */
export function question(cles, options) {
  const q = Object.assign({}, courante.query, cles);
  for (const k in q) if (q[k] === null || q[k] === undefined || q[k] === '') delete q[k];
  const s = new URLSearchParams(q).toString();
  /* Par défaut on REMPLACE : sans ça, chaque filtre coché ajoute une étape
     dans l'historique et le bouton retour du téléphone en fait le tour. */
  aller(courante.chemin + (s ? '?' + s : ''), { remplace: !options || options.remplace !== false });
}

export const actuelle = () => courante;

/** Pose une garde : reçoit la destination, rend false pour bloquer, ou une
 *  autre adresse pour détourner (page de connexion, par exemple). */
export function garde(fn) { avant = fn; }

/** Branche le routeur sur une fonction de rendu. */
export function demarrer(fn) {
  rendu = fn;
  window.addEventListener('hashchange', peindre);
  peindre();
}

/** Repeint l'écran courant sans changer d'adresse. */
export function repeindre() { peindre(true); }

function peindre(force) {
  if (!rendu) return;
  const { chemin, query, brut } = lireAdresse();

  if (avant) {
    const verdict = avant({ chemin, query });
    if (verdict === false) return;
    if (typeof verdict === 'string' && verdict !== chemin) {
      location.replace('#' + verdict);
      return;
    }
  }

  const trouve = apparier(chemin);
  const change = chemin !== courante.chemin || JSON.stringify(query) !== JSON.stringify(courante.query);
  courante = { chemin, params: trouve ? trouve.params : {}, query, brut };
  dernierRendu = Date.now();

  rendu({
    route: trouve ? trouve.route : null,
    chemin,
    params: courante.params,
    query,
    change: change || !!force
  });

  /* Un nouvel écran commence en haut ; un retour retrouve sa place. */
  if (change) {
    const memoire = defilements.get(chemin);
    if (memoire !== undefined) requestAnimationFrame(() => allerA(memoire));
    else allerA(0);
  }
}

function fenetreDefilement() {
  return window.scrollY || document.documentElement.scrollTop || 0;
}
function allerA(y) {
  window.scrollTo({ top: y, behavior: 'auto' });
}

/** Construit un lien complet, pour le partager ou le copier. */
export function adresseComplete(chemin) {
  return location.origin + location.pathname + '#' + (chemin.startsWith('/') ? chemin : '/' + chemin);
}
