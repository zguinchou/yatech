/* ==========================================================================
   YATECH — outils de base
   Des fonctions sans état, sans dépendance, qui servent partout : chaînes,
   dates, tris, identifiants. Tout ce qui n'a pas sa place ailleurs.
   ========================================================================== */

/* --- identifiants --------------------------------------------------------
   Un identifiant doit tenir même si deux personnes créent une fiche à la même
   seconde sur deux appareils. Horodatage + hasard : trié dans le temps, et
   sans collision réaliste. */
export function id(prefixe) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  const r2 = Math.random().toString(36).slice(2, 6);
  return (prefixe ? prefixe + '_' : '') + t + r + r2;
}

/** Une copie franche, sans lien avec l'original. */
export function copie(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) { /* objets non clonables : on retombe plus bas */ }
  }
  return JSON.parse(JSON.stringify(v));
}

/* --- chaînes -------------------------------------------------------------- */

/** Sans accent, sans casse : la forme sur laquelle on compare et on cherche. */
export function nu(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Réduit à ce qui peut servir d'identifiant lisible ou de nom de fichier. */
export function ardoise(s) {
  return nu(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Les initiales d'une personne : deux lettres, pas plus. */
export function initiales(nom, prenom) {
  const a = String(prenom || '').trim();
  const b = String(nom || '').trim();
  if (a && b) return (a[0] + b[0]).toUpperCase();
  const mots = (b || a).split(/[\s-]+/).filter(Boolean);
  if (!mots.length) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}

/** Majuscule à la première lettre, le reste intact. */
export const cap = (s) => { const t = String(s || ''); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

/* Les petits mots qui ne s'accordent pas : sans cette liste, « place de
   parking » deviendrait « places des parkings ». */
const MOTS_LIENS = new Set(['de', 'du', 'des', 'd', 'a', 'au', 'aux', 'en', 'et', 'sur',
  'par', 'pour', 'le', 'la', 'les', 'un', 'une', 'sans', 'avec', 'chez', 'ou']);

/**
 * Accord du pluriel : `pluriel(3, 'pièce')` -> « 3 pièces ».
 *
 * Le groupe entier s'accorde, pas seulement le premier mot :
 * `pluriel(34, 'prestation active')` rend « 34 prestations actives », et non
 * « 34 prestation actives ». C'est la faute qu'on ne voit plus au bout de
 * trois relectures et que le garagiste verra du premier coup d'œil.
 *
 * Les pluriels irréguliers se passent en troisième argument :
 * `pluriel(n, 'travail en cours', 'travaux en cours')`.
 */
export function pluriel(n, singulier, plurielMot) {
  if (n <= 1) return n + ' ' + singulier;
  if (plurielMot) return n + ' ' + plurielMot;

  /* On accorde jusqu'au premier petit mot, et on s'arrête là : ce qui suit
     une préposition est un complément, et il reste au singulier.
     « place de parking » -> « places de parking », pas « des parkings ». */
  let stop = false;
  const accorde = String(singulier).split(' ').map(mot => {
    if (stop) return mot;
    const nu_ = nu(mot).replace(/[’']/g, '');
    if (MOTS_LIENS.has(nu_)) { stop = true; return mot; }
    if (/[sxz]$/i.test(mot)) return mot;          // devis, prix, nez : déjà pluriels
    if (/(au|eu)$/i.test(mot)) return mot + 'x';  // créneau -> créneaux
    if (/al$/i.test(mot)) return mot.slice(0, -2) + 'aux';   // journal -> journaux
    return mot + 's';
  }).join(' ');
  return n + ' ' + accorde;
}

/** Coupe un texte trop long en gardant une fin lisible. */
export function tronque(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/* --- immatriculations -----------------------------------------------------
   Deux formats coexistent sur les routes françaises : le SIV depuis 2009
   (AB-123-CD) et l'ancien FNI (123-ABC-45). On range toujours la plaque sous sa
   forme nue — sans tiret ni espace — pour que la recherche marche quel que soit
   ce que la personne a tapé, et on l'affiche avec ses tirets. */
export function plaqueNue(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function plaqueJolie(s) {
  const p = plaqueNue(s);
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p)) return p.slice(0, 2) + '-' + p.slice(2, 5) + '-' + p.slice(5);
  if (/^\d{1,4}[A-Z]{2,3}\d{2,3}$/.test(p)) {
    const m = p.match(/^(\d{1,4})([A-Z]{2,3})(\d{2,3})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
  }
  return p;
}

export function plaqueValide(s) {
  const p = plaqueNue(s);
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p) || /^\d{1,4}[A-Z]{2,3}\d{2,3}$/.test(p);
}

/** Le VIN fait 17 caractères et n'utilise ni I, ni O, ni Q. */
export function vinValide(s) {
  const v = String(s || '').toUpperCase().replace(/\s/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
}

/* --- téléphone et e-mail -------------------------------------------------- */

/** Range un numéro français sous sa forme internationale, pour les liens. */
export function telNu(s) {
  let t = String(s || '').replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^0\d{9}$/.test(t)) t = '+33' + t.slice(1);
  return t;
}

/** Affiche un numéro par paires : 06 12 34 56 78. */
export function telJoli(s) {
  const brut = String(s || '').replace(/[^\d+]/g, '');
  const fr = brut.replace(/^\+33/, '0');
  if (/^0\d{9}$/.test(fr)) return fr.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  return String(s || '');
}

export const emailValide = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || '').trim());

/* --- dates ----------------------------------------------------------------
   Toutes les dates de l'outil sont des nombres (millisecondes). Rien d'autre :
   une chaîne « 12/03 » ne se compare pas, ne se trie pas, et se lit
   différemment d'un pays à l'autre. */
export const JOUR = 86400000;
export const HEURE = 3600000;
export const MINUTE = 60000;

/** Minuit, le jour de la date donnée, à l'heure locale. */
export function jour0(t) {
  const d = new Date(t === undefined ? Date.now() : t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Le lundi de la semaine où tombe la date. */
export function lundi(t) {
  const d = new Date(jour0(t));
  const j = d.getDay();               // 0 = dimanche
  d.setDate(d.getDate() - (j === 0 ? 6 : j - 1));
  return d.getTime();
}

/** Ajoute des jours en respectant les changements d'heure : passer par
 *  `setDate` plutôt qu'additionner 86 400 000, sinon le 31 mars saute. */
export function plusJours(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function plusMois(t, n) {
  const d = new Date(t);
  const jourVoulu = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  /* 31 janvier + 1 mois : février n'a pas de 31. On se cale sur le dernier
     jour du mois d'arrivée plutôt que de déborder sur mars. */
  const dernier = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(jourVoulu, dernier));
  return d.getTime();
}

/** Nombre de jours pleins entre deux dates, bornes ramenées à minuit. */
export function ecartJours(a, b) {
  return Math.round((jour0(b) - jour0(a)) / JOUR);
}

export const estAujourdhui = (t) => jour0(t) === jour0();
export const estPasse = (t) => t < Date.now();

/** « 08:30 » -> minutes depuis minuit. Rend null si ce n'est pas une heure. */
export function heureEnMinutes(s) {
  const m = String(s || '').match(/^(\d{1,2})[:hH.]?(\d{2})?$/);
  if (!m) return null;
  const hh = +m[1], mm = m[2] ? +m[2] : 0;
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** L'inverse : 510 -> « 08:30 ». */
export function minutesEnHeure(min) {
  const m = Math.max(0, Math.round(min));
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** La date du jour au format d'un champ `<input type="date">`. */
export function isoJour(t) {
  const d = new Date(t === undefined ? Date.now() : t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
       + '-' + String(d.getDate()).padStart(2, '0');
}

/** Lit ce que rend un `<input type="date">`, à midi pour ne pas glisser d'un
 *  jour selon le fuseau. */
export function depuisIsoJour(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0).getTime();
}

/** Assemble une date et une heure venues de deux champs séparés. */
export function isoDateHeure(t) {
  return isoJour(t) + 'T' + minutesEnHeure(new Date(t).getHours() * 60 + new Date(t).getMinutes());
}

export function depuisIsoDateHeure(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

/* --- tris et regroupements ------------------------------------------------ */

/** Compare deux textes comme le ferait un annuaire français. */
const collateur = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export const compareTexte = (a, b) => collateur.compare(String(a || ''), String(b || ''));

/** Trieur par clé, croissant ou décroissant. */
export function par(cle, sens) {
  const lire = typeof cle === 'function' ? cle : (o) => o[cle];
  const s = sens === 'desc' ? -1 : 1;
  return (a, b) => {
    const va = lire(a), vb = lire(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;      // les vides toujours en bas
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * s;
    return compareTexte(va, vb) * s;
  };
}

/** Range une liste par valeur de clé. Rend une Map, l'ordre d'insertion étant
 *  conservé — un objet ordinaire réordonnerait les clés numériques. */
export function grouper(liste, cle) {
  const lire = typeof cle === 'function' ? cle : (o) => o[cle];
  const m = new Map();
  for (const x of liste) {
    const k = lire(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Range une liste par identifiant, pour retrouver en temps constant. */
export function parId(liste, cle) {
  const m = new Map();
  for (const x of liste || []) m.set(x[cle || 'id'], x);
  return m;
}

export const somme = (liste, lire) => (liste || []).reduce((t, x) => t + (Number(lire ? lire(x) : x) || 0), 0);
export const unique = (liste) => Array.from(new Set(liste));

/* --- nombres -------------------------------------------------------------- */

/** Lit un nombre tapé à la main : virgule française, espaces, symbole €. */
export function nombre(v, defaut) {
  if (typeof v === 'number') return isFinite(v) ? v : (defaut || 0);
  const t = String(v === null || v === undefined ? '' : v)
    .replace(/ |\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(t);
  return isFinite(n) ? n : (defaut === undefined ? 0 : defaut);
}

/** Arrondi au centime. Le calcul en virgule flottante fait dériver les
 *  centimes : sans cet arrondi, un total de devis finit à 0,01 € près. */
export const cts = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const borne = (n, mini, maxi) => Math.min(maxi, Math.max(mini, n));

/* --- rythme --------------------------------------------------------------- */

/** N'appelle la fonction qu'une fois le calme revenu (frappe au clavier). */
export function attend(fn, ms) {
  let t = null;
  const f = function (...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms === undefined ? 220 : ms);
  };
  f.annule = () => clearTimeout(t);
  return f;
}

/** Laisse passer au plus un appel par tranche de temps (défilement, glisser). */
export function bride(fn, ms) {
  let dernier = 0, t = null, dernA = null;
  return function (...a) {
    const maintenant = Date.now();
    dernA = a;
    if (maintenant - dernier >= (ms || 60)) { dernier = maintenant; fn.apply(this, a); }
    else if (!t) {
      t = setTimeout(() => { t = null; dernier = Date.now(); fn.apply(this, dernA); },
        (ms || 60) - (maintenant - dernier));
    }
  };
}

/* --- recherche floue ------------------------------------------------------
   On ne cherche pas « exactement » : la secrétaire tape « peugot » ou les trois
   derniers chiffres d'une plaque. Chaque mot de la requête doit se retrouver
   quelque part dans le texte ; l'ordre n'a pas d'importance. */
export function correspond(texte, requete) {
  const t = nu(texte);
  const mots = nu(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  return mots.every(m => t.includes(m));
}

/** Note un résultat pour trier : un début de mot vaut mieux qu'un milieu. */
export function score(texte, requete) {
  const t = nu(texte);
  const mots = nu(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return 0;
  let n = 0;
  for (const m of mots) {
    const i = t.indexOf(m);
    if (i < 0) return -1;
    n += i === 0 ? 100 : (/[\s\-/]/.test(t[i - 1] || '') ? 60 : 20);
    n += Math.max(0, 20 - i / 4);
  }
  return n;
}

/** Entoure de <mark> les morceaux trouvés. Le texte est échappé au passage :
 *  ce qui sort d'ici peut être posé en `html` sans risque. */
export function surligne(texte, requete) {
  const brut = String(texte === null || texte === undefined ? '' : texte);
  const echap = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mots = nu(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return echap(brut);

  const plat = nu(brut);
  /* La normalisation peut changer la longueur (æ, ligatures) : dans ce cas on
     renonce au surlignage plutôt que de découper au mauvais endroit. */
  if (plat.length !== brut.length) return echap(brut);

  const marques = new Array(brut.length).fill(false);
  for (const m of mots) {
    let i = plat.indexOf(m);
    while (i >= 0) {
      for (let k = i; k < i + m.length; k++) marques[k] = true;
      i = plat.indexOf(m, i + m.length);
    }
  }
  let sortie = '', dedans = false;
  for (let i = 0; i < brut.length; i++) {
    if (marques[i] && !dedans) { sortie += '<mark>'; dedans = true; }
    else if (!marques[i] && dedans) { sortie += '</mark>'; dedans = false; }
    sortie += echap(brut[i]);
  }
  if (dedans) sortie += '</mark>';
  return sortie;
}
