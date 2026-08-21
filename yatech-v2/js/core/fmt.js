/* ==========================================================================
   YATECH — mise en forme
   Un seul endroit décide comment s'écrivent un montant, une date, une durée.
   Le jour où l'atelier passe en Suisse ou change de devise, c'est ici.
   ========================================================================== */

import { JOUR, jour0, ecartJours, cts } from './util.js';

const LANGUE = 'fr-FR';
let DEVISE = 'EUR';

/** Change la devise de tout l'outil (réglages). */
export function devise(code) {
  if (code) DEVISE = code;
  return DEVISE;
}

/* Les formateurs coûtent cher à construire : on les garde sous la main. */
const cache = new Map();
function fmt(cle, faire) {
  if (!cache.has(cle)) cache.set(cle, faire());
  return cache.get(cle);
}

/* --- argent --------------------------------------------------------------- */

/** « 1 234,50 € ». Le centime est toujours écrit : un devis à « 90 € » puis
 *  « 90,40 € » sur la facture, c'est une discussion au comptoir. */
export function euros(n, options) {
  const o = options || {};
  const v = Number(n) || 0;
  return fmt('e' + DEVISE + (o.sansCentimes ? '0' : '2'), () => new Intl.NumberFormat(LANGUE, {
    style: 'currency',
    currency: DEVISE,
    minimumFractionDigits: o.sansCentimes ? 0 : 2,
    maximumFractionDigits: o.sansCentimes ? 0 : 2
  })).format(o.sansCentimes ? Math.round(v) : cts(v));
}

/** Sans le symbole : pour les colonnes de tableau, où l'€ est en en-tête. */
export function montant(n, decimales) {
  const d = decimales === undefined ? 2 : decimales;
  return fmt('m' + d, () => new Intl.NumberFormat(LANGUE, {
    minimumFractionDigits: d, maximumFractionDigits: d
  })).format(Number(n) || 0);
}

/** Un nombre ordinaire, avec les séparateurs de milliers. */
export function nb(n, decimales) {
  const d = decimales === undefined ? 0 : decimales;
  return fmt('n' + d, () => new Intl.NumberFormat(LANGUE, {
    minimumFractionDigits: 0, maximumFractionDigits: d
  })).format(Number(n) || 0);
}

export function pourcent(n, decimales) {
  const d = decimales === undefined ? 0 : decimales;
  return fmt('p' + d, () => new Intl.NumberFormat(LANGUE, {
    style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: d
  })).format((Number(n) || 0) / 100);
}

/** Un kilométrage : « 148 500 km ». */
export const km = (n) => nb(Math.round(Number(n) || 0)) + ' km';

/* --- dates ---------------------------------------------------------------- */

export function date(t, style) {
  if (!t) return '—';
  const d = new Date(t);
  if (isNaN(d)) return '—';
  const styles = {
    court:  { day: '2-digit', month: '2-digit', year: '2-digit' },       // 12/03/25
    normal: { day: '2-digit', month: '2-digit', year: 'numeric' },       // 12/03/2025
    lettre: { day: 'numeric', month: 'long', year: 'numeric' },          // 12 mars 2025
    jourMois: { day: 'numeric', month: 'short' },                        // 12 mars
    complet: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  };
  const s = styles[style || 'normal'] || styles.normal;
  return fmt('d' + (style || 'normal'), () => new Intl.DateTimeFormat(LANGUE, s)).format(d);
}

export function heure(t) {
  if (!t) return '—';
  return fmt('h', () => new Intl.DateTimeFormat(LANGUE, { hour: '2-digit', minute: '2-digit' }))
    .format(new Date(t));
}

export function dateHeure(t, style) {
  if (!t) return '—';
  return date(t, style || 'court') + ' à ' + heure(t);
}

/** Le nom du jour : « lun. », « lundi ». */
export function nomJour(t, long) {
  return fmt('j' + (long ? 'l' : 'c'),
    () => new Intl.DateTimeFormat(LANGUE, { weekday: long ? 'long' : 'short' })).format(new Date(t));
}

export function nomMois(t, long) {
  return fmt('mo' + (long ? 'l' : 'c'),
    () => new Intl.DateTimeFormat(LANGUE, { month: long ? 'long' : 'short' })).format(new Date(t));
}

/** « aujourd'hui », « hier », « dans 3 jours », « il y a 2 semaines ».
 *  C'est ce qu'on lit le plus vite quand on survole une liste. */
export function quand(t, options) {
  if (!t) return '—';
  const o = options || {};
  const jours = ecartJours(Date.now(), t);

  if (jours === 0) {
    if (o.avecHeure === false) return "aujourd'hui";
    const minutes = Math.round((t - Date.now()) / 60000);
    if (Math.abs(minutes) < 1) return "à l'instant";
    if (minutes < 0 && minutes > -60) return 'il y a ' + Math.abs(minutes) + ' min';
    if (minutes > 0 && minutes < 60) return 'dans ' + minutes + ' min';
    return "aujourd'hui à " + heure(t);
  }
  if (jours === 1) return o.avecHeure === false ? 'demain' : 'demain à ' + heure(t);
  if (jours === -1) return o.avecHeure === false ? 'hier' : 'hier à ' + heure(t);
  if (jours > 1 && jours < 7) return 'dans ' + jours + ' jours';
  if (jours < -1 && jours > -7) return 'il y a ' + Math.abs(jours) + ' jours';
  if (jours >= 7 && jours < 31) return 'dans ' + Math.round(jours / 7) + ' sem.';
  if (jours <= -7 && jours > -31) return 'il y a ' + Math.round(Math.abs(jours) / 7) + ' sem.';
  return date(t, 'court');
}

/** Une durée d'immobilisation : « 3 j », « 5 h », « 40 min ». */
export function duree(ms) {
  const m = Math.abs(Math.round((Number(ms) || 0) / 60000));
  if (m < 60) return m + ' min';
  const h = m / 60;
  if (h < 24) return (h % 1 === 0 ? h : h.toFixed(1).replace('.', ',')) + ' h';
  const j = Math.round(h / 24);
  return j + ' j';
}

/** Un temps de main-d'œuvre, en heures décimales : « 1 h 30 ». */
export function heuresMO(h) {
  const n = Number(h) || 0;
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  if (mm === 0) return hh + ' h';
  if (hh === 0) return mm + ' min';
  return hh + ' h ' + String(mm).padStart(2, '0');
}

/** Le nombre de jours depuis une date, pour les compteurs d'immobilisation. */
export function joursDepuis(t) {
  return Math.max(0, Math.round((jour0() - jour0(t)) / JOUR));
}

/** Une taille de fichier, pour les photos et les sauvegardes. */
export function octets(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' o';
  if (v < 1048576) return (v / 1024).toFixed(0) + ' Ko';
  if (v < 1073741824) return (v / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  return (v / 1073741824).toFixed(2).replace('.', ',') + ' Go';
}
