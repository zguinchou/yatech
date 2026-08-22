/* ==========================================================================
   YATECH — la grille tarifaire qui voyage
   --------------------------------------------------------------------------
   LE PROBLÈME, dit franchement.

   Toutes les données de l'outil vivent dans le navigateur du garage. C'est ce
   qui lui permet de tourner sans serveur, sans abonnement et sans réseau —
   mais cela veut dire qu'un confrère qui ouvre un lien depuis SON téléphone
   n'a rien à lire : sa base à lui est vide. L'espace professionnel en ligne
   (#/pro/…) ne fonctionne donc que sur un appareil qui possède déjà les
   données du garage. Tant qu'il n'y a pas de base partagée, c'est ainsi, et
   il vaut mieux le dire que le laisser découvrir.

   LA RÉPONSE : mettre la grille DANS le lien.

   Le lien transporte lui-même la liste des prestations et le prix appliqué au
   confrère. Il s'ouvre sur n'importe quel téléphone, sans réseau, et rien ne
   part sur un serveur puisqu'un fragment d'adresse (ce qui suit le #) n'est
   jamais envoyé à l'hébergeur.

   Ce que ça coûte : c'est un ARRÊTÉ, pas un direct. La grille porte sa date,
   et changer un tarif demande de renvoyer le lien. C'est écrit noir sur blanc
   sur la page que reçoit le confrère.
   ========================================================================== */

import { prixPrestation, contexte } from './calculs.js';
import { nombre } from '../core/util.js';

export const VERSION_GRILLE = 1;

/* ==========================================================================
   FABRIQUER
   ========================================================================== */

/**
 * Rassemble ce qu'un confrère doit voir. Rien d'autre : pas de marge, pas de
 * prix d'achat, pas de note interne, pas un mot sur les autres clients.
 */
export function preparerGrille(e, client) {
  const r = e.reglages || {};
  const ctx = contexte(r, client);

  /* Regroupé par famille et rangé, comme sur le papier qu'on lui aurait donné. */
  const familles = new Map();
  for (const p of (e.prestations || [])) {
    if (!p.actif) continue;
    const f = p.famille || 'Divers';
    if (!familles.has(f)) familles.set(f, []);
    familles.get(f).push([
      p.code || '',
      p.libelle || '',
      prixPrestation(p, ctx),
      nombre(p.temps, 0)
    ]);
  }

  return {
    v: VERSION_GRILLE,
    d: Date.now(),
    g: {
      n: r.raisonSociale || r.nomOutil || 'Garage',
      t: r.tel || '',
      a: r.adresse || '',
      c: r.cp || '',
      vi: r.ville || '',
      e: r.email || ''
    },
    c: client ? (client.societe || [client.prenom, client.nom].filter(Boolean).join(' ')) : '',
    th: ctx.taux,
    tva: ctx.tvaApplicable ? ctx.tva : 0,
    rem: nombre(client && client.remise, 0),
    f: Array.from(familles.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'))
      .map(([nom, lignes]) => [nom, lignes.sort((x, y) => String(x[1]).localeCompare(String(y[1]), 'fr'))])
  };
}

/* ==========================================================================
   EMBALLER ET DÉBALLER
   Base64 « sûr pour une adresse » : ni +, ni /, ni =. Compressé quand le
   navigateur sait le faire — la grille passe alors de deux kilo-octets à
   sept cents, ce qui garde le lien collable dans un SMS.
   ========================================================================== */

const enB64url = (octets) => {
  let s = '';
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const deB64url = (texte) => {
  const t = String(texte).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(t + '==='.slice((t.length + 3) % 4));
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
};

async function comprimer(octets) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const flux = new Blob([octets]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  } catch (e) { return null; }
}

async function decomprimer(octets) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  } catch (e) { return null; }
}

/** Emballe la grille pour la mettre dans une adresse. */
export async function emballer(grille) {
  const brut = new TextEncoder().encode(JSON.stringify(grille));
  const serre = await comprimer(brut);
  /* La lettre de tête dit comment déballer : « z » compressé, « p » tel quel.
     Sans elle, un navigateur qui ne sait pas compresser produirait un lien
     qu'un autre ne saurait pas relire. */
  return serre && serre.length < brut.length
    ? 'z' + enB64url(serre)
    : 'p' + enB64url(brut);
}

/** Déballe une grille reçue dans une adresse. Rend null si ce n'en est pas une. */
export async function deballer(charge) {
  const t = String(charge || '').trim();
  if (t.length < 2) return null;
  try {
    const octets = deB64url(t.slice(1));
    const brut = t[0] === 'z' ? await decomprimer(octets) : octets;
    if (!brut) return null;
    const g = JSON.parse(new TextDecoder().decode(brut));
    if (!g || typeof g !== 'object' || !Array.isArray(g.f)) return null;
    if (nombre(g.v, 0) > VERSION_GRILLE) return null;   // écrite par une version plus récente
    return g;
  } catch (e) { return null; }
}

/** Le lien complet à envoyer au confrère. */
export async function lienGrille(e, client) {
  const charge = await emballer(preparerGrille(e, client));
  return location.origin + location.pathname + '#/grille/' + charge;
}

/** Le nombre de prestations d'une grille, sans la parcourir à la main. */
export const compteGrille = (g) =>
  (g && Array.isArray(g.f)) ? g.f.reduce((n, [, lignes]) => n + lignes.length, 0) : 0;
