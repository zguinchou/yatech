/* ==========================================================================
   YATECH — fichiers
   --------------------------------------------------------------------------
   Entrer, sortir. Les sauvegardes, les exports pour EBP, les photos prises au
   téléphone. Rien de tout ça ne passe par un serveur : le fichier va du
   navigateur au disque de la personne, et retour.
   ========================================================================== */

import { ardoise } from './util.js';

/* ==========================================================================
   CSV
   Point-virgule, guillemets doublés, fins de ligne CRLF, et un marqueur d'ordre
   des octets en tête : c'est ce qu'Excel français et EBP savent lire sans
   qu'on ait à cliquer sur trois écrans d'import. Un CSV en virgules s'ouvre en
   une seule colonne, et les accents se cassent sans le marqueur.
   ========================================================================== */

const BOM = '﻿';

export function versCsv(lignes, options) {
  const o = options || {};
  const sep = o.separateur || ';';
  const cellule = (v) => {
    if (v === null || v === undefined) return '';
    const t = String(v);
    /* Un texte qui commence par =, +, - ou @ est interprété comme une formule
       par les tableurs. On le neutralise : un client nommé « =DUPONT » ne doit
       pas déclencher un calcul chez le comptable. */
    const sur = /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
    return new RegExp('["\\r\\n' + sep + ']').test(sur) ? '"' + sur.replace(/"/g, '""') + '"' : sur;
  };
  return (o.sansBom ? '' : BOM)
    + lignes.map(l => l.map(cellule).join(sep)).join('\r\n') + '\r\n';
}

/** Lit un CSV : séparateur deviné, guillemets respectés, lignes vides ignorées. */
export function depuisCsv(texte) {
  const brut = String(texte || '').replace(/^﻿/, '');
  if (!brut.trim()) return [];

  /* Le séparateur se devine sur la première ligne : celui qui apparaît le plus
     souvent hors guillemets. Un point-virgule dans une adresse ne doit pas
     faire basculer tout le fichier. */
  const premiere = brut.split(/\r?\n/)[0] || '';
  const compte = (c) => (premiere.split(c).length - 1);
  const sep = [';', ',', '\t'].sort((a, b) => compte(b) - compte(a))[0];

  const lignes = [];
  let ligne = [], champ = '', guillemets = false;
  for (let i = 0; i < brut.length; i++) {
    const ch = brut[i];
    if (guillemets) {
      if (ch === '"' && brut[i + 1] === '"') { champ += '"'; i++; }
      else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) { ligne.push(champ); champ = ''; }
    else if (ch === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (ch !== '\r') champ += ch;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter(l => l.some(x => String(x).trim() !== ''));
}

/** Un CSV avec en-tête, rendu en objets : [{ 'Nom': 'Dupont', … }] */
export function csvEnObjets(texte) {
  const lignes = depuisCsv(texte);
  if (lignes.length < 2) return [];
  const entetes = lignes[0].map(x => String(x).trim());
  return lignes.slice(1).map(l => {
    const o = {};
    entetes.forEach((e, i) => { o[e] = l[i] === undefined ? '' : l[i]; });
    return o;
  });
}

/* ==========================================================================
   SORTIE
   ========================================================================== */

/*
 * Certains hôtes — une page publiée, une application embarquée — interceptent
 * les téléchargements : un lien `download` n'y fait rien du tout. Ils
 * ouvrent à la place une passerelle, qu'on demande une seule fois et dont on
 * garde la réponse. Absente, on retombe sur le lien, qui suffit partout
 * ailleurs.
 */
let passerelle;
function passerelleTelechargement() {
  if (passerelle === undefined) {
    const hote = typeof window === 'undefined' ? null : window.claude;
    passerelle = (hote && typeof hote.use === 'function')
      ? Promise.resolve(hote.use('downloads')).catch(() => null)
      : Promise.resolve(null);
  }
  return passerelle;
}
/* On la demande dès le chargement : au moment du clic, la réponse est déjà là
   et le navigateur voit encore un geste de la personne. */
if (typeof window !== 'undefined') passerelleTelechargement();

/** Le lien invisible : la méthode ordinaire, celle des navigateurs. */
function parLeLien(nom, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* On libère l'adresse plus tard : révoquée dans la seconde, un gros PDF
       voit son téléchargement s'interrompre en cours de route. */
    setTimeout(() => URL.revokeObjectURL(url), 40000);
    return true;
  } catch (e) {
    return false;
  }
}

/** Rend un fichier à la personne. Promesse vraie si le fichier est bien parti. */
export function telecharger(nom, contenu, type) {
  const typeFinal = type || 'text/csv;charset=utf-8';
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: typeFinal });

  return passerelleTelechargement().then((pont) => {
    if (pont && typeof pont.save === 'function') {
      return pont.save({ filename: nom, data: contenu })
        .then(() => true).catch(() => false);
    }
    return parLeLien(nom, blob);
  });
}

/** Un nom de fichier daté, sans accent ni espace. */
export function nomDate(base, extension) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const horodatage = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
    + '-' + p(d.getHours()) + p(d.getMinutes());
  return ardoise(base) + '-' + horodatage + '.' + (extension || 'csv');
}

/** Copie dans le presse-papier, avec un repli quand l'API est refusée. */
export async function copier(texte) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch (e) { /* refusé : on tente à l'ancienne */ }
  try {
    const z = document.createElement('textarea');
    z.value = texte;
    z.setAttribute('readonly', '');
    z.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(z);
    z.select();
    const ok = document.execCommand('copy');
    z.remove();
    return ok;
  } catch (e) { return false; }
}

/* ==========================================================================
   ENTRÉE
   ========================================================================== */

/**
 * Ouvre le sélecteur de fichiers.
 * Pas de filtre d'extension par défaut : sur téléphone, un `accept` trop
 * précis grise tous les fichiers et on ne peut plus rien choisir.
 * @returns {Promise<File[]>}
 */
export function choisirFichier(options) {
  const o = options || {};
  return new Promise((resoudre) => {
    const champ = document.createElement('input');
    champ.type = 'file';
    if (o.accepte) champ.accept = o.accepte;
    if (o.plusieurs) champ.multiple = true;
    if (o.appareilPhoto) champ.capture = 'environment';
    champ.style.cssText = 'position:fixed;top:-1000px;opacity:0';

    let repondu = false;
    const repondre = (v) => { if (!repondu) { repondu = true; champ.remove(); resoudre(v); } };

    champ.onchange = () => repondre(Array.from(champ.files || []));
    /* Annuler la fenêtre système ne déclenche rien sur la plupart des
       navigateurs : on retombe sur le retour de focus pour ne pas laisser une
       promesse en suspens pour toujours. */
    window.addEventListener('focus', () => setTimeout(() => repondre([]), 900), { once: true });

    document.body.appendChild(champ);
    champ.click();
  });
}

export function lireTexte(fichier) {
  return new Promise((ok, non) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result || ''));
    l.onerror = () => non(l.error || new Error('lecture impossible'));
    l.readAsText(fichier, 'utf-8');
  });
}

export function lireDataUrl(fichier) {
  return new Promise((ok, non) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result || ''));
    l.onerror = () => non(l.error || new Error('lecture impossible'));
    l.readAsDataURL(fichier);
  });
}

/* ==========================================================================
   PHOTOS
   Une photo de téléphone pèse 4 Mo. Cinquante photos de véhicules et la base
   déborde. On les réduit avant de les ranger : 1400 pixels de large suffisent
   largement pour lire une plaque, un numéro de calculateur ou une rayure.
   ========================================================================== */

export async function reduireImage(fichier, options) {
  const o = options || {};
  const maxi = o.maxi || 1400;
  const qualite = o.qualite || 0.78;

  const source = await lireDataUrl(fichier);
  const img = await new Promise((ok, non) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => non(new Error('image illisible'));
    i.src = source;
  });

  let { width: l, height: hh } = img;
  if (l > maxi || hh > maxi) {
    const facteur = maxi / Math.max(l, hh);
    l = Math.round(l * facteur);
    hh = Math.round(hh * facteur);
  }

  const toile = document.createElement('canvas');
  toile.width = l;
  toile.height = hh;
  const ctx = toile.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, l, hh);

  /* WebP quand le navigateur sait : deux fois plus léger que le JPEG à qualité
     égale. On vérifie le résultat, certains Safari anciens rendent du PNG. */
  let sortie = toile.toDataURL('image/webp', qualite);
  if (!sortie.startsWith('data:image/webp')) sortie = toile.toDataURL('image/jpeg', qualite);
  return { donnee: sortie, largeur: l, hauteur: hh, poids: Math.round(sortie.length * 0.75) };
}
