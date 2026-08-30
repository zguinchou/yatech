/* ==========================================================================
   YATECH — la demande d'un confrère, qui fait l'aller-retour
   --------------------------------------------------------------------------
   LE PROBLÈME, encore une fois dit franchement.

   Les données vivent dans le navigateur du garage. Un confrère qui remplit un
   formulaire sur SON téléphone ne peut rien écrire dans notre base : il n'y a
   pas de serveur entre les deux. Un bouton « Envoyer » qui n'envoie nulle part
   serait un mensonge.

   LA RÉPONSE : le message fait le trajet.

   La page du confrère fabrique un message lisible — véhicule, plaque, jour
   souhaité, prestations choisies avec leur prix — et y accroche un CODE. Le
   confrère l'envoie par WhatsApp, SMS ou e-mail, d'un geste. Au garage, on
   colle le code et la demande entre dans le planning sans rien retaper.

   Le message reste lisible même sans le code : si quelqu'un préfère lire et
   saisir à la main, il le peut. Le code n'est qu'un raccourci.
   ========================================================================== */

import { emballer, deballer } from '../core/codec.js';
import { nombre, plaqueNue } from '../core/util.js';

export const VERSION_DEMANDE = 1;

/* Ce qui annonce un code de demande dans un message. Court, reconnaissable,
   et sans espace : les messageries coupent les lignes n'importe où. */
export const MARQUE = 'YATECH-RDV:';

/**
 * Range une demande avant de l'emballer.
 * @param {object} d { clientId, confrere, vehicule, immat, jour, heure,
 *                     prestations:[{code,libelle,prix}], texte, tel }
 */
export function preparerDemande(d) {
  const o = d || {};
  return {
    v: VERSION_DEMANDE,
    q: Date.now(),
    ci: String(o.clientId || ''),
    cn: String(o.confrere || '').slice(0, 80),
    ve: String(o.vehicule || '').slice(0, 80),
    im: plaqueNue(o.immat || ''),
    j: nombre(o.jour, 0) || 0,
    h: nombre(o.heure, 0) || 0,
    t: String(o.texte || '').slice(0, 600),
    te: String(o.tel || '').slice(0, 25),
    /* Les prestations en clair : le garage doit pouvoir lire la demande même
       si son catalogue a changé de codes depuis l'envoi du lien. */
    p: (o.prestations || []).slice(0, 20).map(x => [
      String(x.code || '').slice(0, 12),
      String(x.libelle || '').slice(0, 70),
      nombre(x.prix, 0)
    ])
  };
}

/** Le code à coller dans le message. */
export async function emballerDemande(d) {
  return MARQUE + await emballer(preparerDemande(d));
}

/**
 * Retrouve une demande dans un texte collé — le code seul, ou le message
 * entier avec le code dedans. On ratisse large : personne ne va sélectionner
 * proprement soixante caractères sur un téléphone.
 */
export async function deballerDemande(texte) {
  const t = String(texte || '');
  const i = t.indexOf(MARQUE);
  if (i < 0) return null;
  /* Le code s'arrête au premier caractère qui ne peut pas en faire partie :
     un espace, un retour à la ligne, un guillemet de messagerie. */
  const reste = t.slice(i + MARQUE.length);
  const m = /^[A-Za-z0-9_-]+/.exec(reste);
  if (!m) return null;
  const d = await deballer(m[0]);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (nombre(d.v, 0) > VERSION_DEMANDE) return null;
  if (!Array.isArray(d.p)) d.p = [];
  return d;
}

/** Le message lisible, celui que le confrère envoie vraiment. */
export function messageDemande(d, code) {
  const o = d || {};
  const lignes = ['Demande de rendez-vous'];
  if (o.confrere) lignes.push('De : ' + o.confrere);
  if (o.vehicule || o.immat) {
    lignes.push('Véhicule : ' + [o.vehicule, o.immat].filter(Boolean).join(' — '));
  }
  if (o.jourTexte) lignes.push('Souhaité : ' + o.jourTexte);
  if ((o.prestations || []).length) {
    lignes.push('Prestations :');
    for (const p of o.prestations) {
      lignes.push('  • ' + p.libelle + (p.prix ? ' — ' + p.prix : ''));
    }
    if (o.total) lignes.push('  Total indicatif : ' + o.total);
  }
  if (o.texte) lignes.push('', o.texte);
  if (o.tel) lignes.push('', 'Me joindre : ' + o.tel);
  if (code) {
    lignes.push('', '— code à coller dans Yatech —', code);
  }
  return lignes.join('\n');
}
