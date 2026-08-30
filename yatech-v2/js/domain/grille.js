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
import { emballer, deballer as deballerBrut } from '../core/codec.js';
import { nombre } from '../core/util.js';

export const VERSION_GRILLE = 2;

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

  /* Ce que le garage a décidé de montrer aux confrères. */
  const reg = r.espacePro || {};
  const montrees = Array.isArray(reg.familles) && reg.familles.length
    ? new Set(reg.familles) : null;

  /* Regroupé par famille et rangé, comme sur le papier qu'on lui aurait donné. */
  const familles = new Map();
  for (const p of (e.prestations || [])) {
    if (!p.actif) continue;
    const f = p.famille || 'Divers';
    if (montrees && !montrees.has(f)) continue;
    if (!familles.has(f)) familles.set(f, []);
    familles.get(f).push([
      p.code || '',
      p.libelle || '',
      prixPrestation(p, ctx),
      nombre(p.temps, 0),
      /* Modèle 2 : le confrère doit savoir ce qui n'est pas homologué route
         AVANT de le demander — c'est lui qui rendra la voiture à son client. */
      p.horsRoute ? 1 : 0
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
    /* L'identifiant du confrère revient dans sa demande : le garage sait de
       qui elle vient sans avoir à deviner d'après un nom mal orthographié. */
    ci: client ? client.id : '',
    /* Les jours ouvrés, pour que la page propose des dates qui existent. */
    jo: Array.isArray(r.joursOuvres) ? r.joursOuvres.slice() : [1, 2, 3, 4, 5],
    /* Ce que le garage a réglé pour ses confrères : le mot d'accueil, le
       délai annoncé, et s'il accepte les demandes de rendez-vous. */
    ac: String(reg.accueil || '').slice(0, 400),
    de: String(reg.delai || '').slice(0, 120),
    rd: reg.rdv === false ? 0 : 1,
    tp: reg.temps === false ? 0 : 1,
    th: ctx.taux,
    tva: ctx.tvaApplicable ? ctx.tva : 0,
    rem: nombre(client && client.remise, 0),
    f: Array.from(familles.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'))
      .map(([nom, lignes]) => [nom, lignes.sort((x, y) => String(x[1]).localeCompare(String(y[1]), 'fr'))])
  };
}

/* L'emballage vit dans `core/codec.js` : la grille et la demande de rendez-vous
   voyagent de la même façon, et une seule implémentation se relit. */
export { emballer };

/** Déballe une grille reçue dans une adresse. Rend null si ce n'en est pas une. */
export async function deballer(charge) {
  const g = await deballerBrut(charge);
  if (!g || typeof g !== 'object' || !Array.isArray(g.f)) return null;
  if (nombre(g.v, 0) > VERSION_GRILLE) return null;   // écrite par une version plus récente
  return g;
}

/** Le lien complet à envoyer au confrère. */
export async function lienGrille(e, client) {
  const charge = await emballer(preparerGrille(e, client));
  return location.origin + location.pathname + '#/grille/' + charge;
}

/** Le nombre de prestations d'une grille, sans la parcourir à la main. */
export const compteGrille = (g) =>
  (g && Array.isArray(g.f)) ? g.f.reduce((n, [, lignes]) => n + lignes.length, 0) : 0;
