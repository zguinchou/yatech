/* ==========================================================================
   YATECH — les gestes du métier
   --------------------------------------------------------------------------
   Tout ce qui change quelque chose passe par ici. Les écrans ne touchent
   jamais l'état directement : ils appellent un geste, qui connaît les règles.

   Exemple : sortir une pièce du stock, ce n'est pas « qte moins un ». C'est
   décrémenter, écrire un mouvement daté et signé, marquer la ligne du dossier
   comme servie, et refuser si la quantité n'y est pas. Écrit une fois ici,
   c'est juste partout ; recopié dans trois écrans, c'est faux dans deux.
   ========================================================================== */

import { S, maj, noter } from '../core/store.js';
import { id, nombre, cts, plusJours, plaqueNue, JOUR } from '../core/util.js';
import {
  nouveauDossier, nouveauDevis, nouvelleFacture, nouveauMouvement, nouvelleLigne,
  nouvelleIntervention, prochainNumero, ETAPES_OUVERTES, CLES_ETAPES
} from './schema.js';
import { totaux, contexte, figerLignes, prixPiece, prixPrestation } from './calculs.js';
import * as lit from './selecteurs.js';

const qui = () => (S.moi ? S.moi.id : null);

/* ==========================================================================
   DOSSIERS
   ========================================================================== */

/** Ouvre un dossier et lui donne son numéro. */
export function ouvrirDossier(champs) {
  return maj('Dossier ouvert', (e) => {
    const d = nouveauDossier(Object.assign({ numero: prochainNumero(e, 'dossier') }, champs));
    if (!d.clientId && d.vehiculeId) {
      const v = lit.vehicule(e, d.vehiculeId);
      if (v) d.clientId = v.clientId;
    }
    e.dossiers.push(d);
    return d;
  });
}

/**
 * Fait avancer un dossier d'une étape à l'autre, avec ce que cela entraîne.
 * C'est la fonction la plus importante de l'outil : c'est elle qui garde le
 * parc, le planning et la facturation d'accord entre eux.
 */
export function changerEtape(dossierId, etape) {
  if (!CLES_ETAPES.includes(etape)) return null;
  return maj('Dossier déplacé en « ' + etape + ' »', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d || d.etape === etape) return d;
    const avant = d.etape;
    d.etape = etape;
    d.maj = Date.now();

    /* Le véhicule est rendu : il ne prend plus de place, et la date de sortie
       s'inscrit toute seule. Personne ne pense à libérer une place à la main. */
    if (etape === 'livre') {
      d.place = null;
      if (!d.sortie) d.sortie = Date.now();
    } else if (avant === 'livre') {
      d.sortie = null;         // retour en arrière : le véhicule est de nouveau là
    }

    /* Le motif d'occupation du parc suit l'étape : c'est ce qui colore le plan
       sans qu'on ait à le tenir à jour deux fois. */
    if (d.place) {
      if (etape === 'piece') d.motifParc = 'piece';
      else if (etape === 'atelier' || etape === 'controle') d.motifParc = 'travaux';
      else if (etape === 'pret') d.motifParc = 'pret';
      else if (etape === 'accord' || etape === 'devis' || etape === 'accueil') d.motifParc = 'attente';
    }
    return d;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

export function assigner(dossierId, userId) {
  return maj('Dossier assigné', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    const i = d.assignes.indexOf(userId);
    if (i >= 0) d.assignes.splice(i, 1);
    else d.assignes.push(userId);
    d.maj = Date.now();
    return d;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

export function noterDansDossier(dossierId, texte) {
  const t = String(texte || '').trim();
  if (!t) return null;
  return maj('Note ajoutée au dossier', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    d.notes.push({ id: id('not'), quand: Date.now(), qui: qui(), texte: t });
    d.maj = Date.now();
    return d;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** Archive un dossier : il sort des écrans courants sans être détruit. */
export function archiverDossier(dossierId, oui) {
  return maj(oui === false ? 'Dossier ressorti des archives' : 'Dossier archivé', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    d.archive = oui !== false;
    if (d.archive) d.place = null;
    d.maj = Date.now();
    return d;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/* ==========================================================================
   LIGNES DE TRAVAUX
   Elles vivent dans le dossier. Le devis et la facture en prennent une copie
   figée au moment où on les édite.
   ========================================================================== */

export function ajouterLigne(dossierId, champs) {
  return maj('Ligne ajoutée', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    const l = nouvelleLigne(champs);
    d.lignes.push(l);
    d.maj = Date.now();
    return l;
  }, { cible: { type: 'dossiers', id: dossierId }, journal: false });
}

/** Ajoute une ligne depuis le catalogue, au bon prix pour ce client. */
export function ajouterPrestation(dossierId, prestationId, qte) {
  return maj('Prestation ajoutée', (e) => {
    const d = lit.dossier(e, dossierId);
    const p = lit.prestation(e, prestationId);
    if (!d || !p) return null;
    const ctx = lit.prixDe(e, d.clientId);
    const cli = lit.client(e, d.clientId);

    const l = nouvelleLigne({
      type: p.type === 'piece' ? 'piece' : (p.type === 'electro' ? 'electro' : (p.type === 'forfait' ? 'forfait' : 'mo')),
      ref: p.code,
      libelle: p.libelle,
      detail: p.detail || '',
      qte: nombre(qte, 1) || 1,
      unite: p.type === 'mo' ? 'h' : 'u',
      prixHT: prixPrestation(p, ctx),
      /* La remise de la fiche client pré-remplit la ligne : elle se voit, et
         on peut la retirer d'un geste si elle ne s'applique pas ici. */
      remise: nombre(cli && cli.remise, 0),
      prestationId: p.id
    });
    /* Une prestation de main-d'œuvre se facture au temps : la quantité, c'est
       le nombre d'heures, et le prix unitaire, le taux horaire. Sauf si le
       catalogue fixe un prix : alors c'est un forfait déguisé, quantité 1. */
    if (p.type === 'mo' && nombre(p.prixHT) === 0 && nombre(p.temps) > 0) {
      l.qte = nombre(qte, p.temps) || p.temps;
      l.prixHT = ctx.taux;
    }
    d.lignes.push(l);
    d.maj = Date.now();
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** Ajoute une pièce du stock à un dossier. Ne décompte rien : la sortie
 *  physique se fait au moment où on la prend sur l'étagère. */
export function ajouterPieceAuDossier(dossierId, pieceId, qte) {
  return maj('Pièce ajoutée au dossier', (e) => {
    const d = lit.dossier(e, dossierId);
    const p = lit.piece(e, pieceId);
    if (!d || !p) return null;
    const ctx = lit.prixDe(e, d.clientId);
    const l = nouvelleLigne({
      type: 'piece',
      ref: p.ref || p.refFabricant,
      libelle: p.libelle,
      qte: nombre(qte, 1) || 1,
      unite: p.unite || 'u',
      prixHT: prixPiece(p, ctx),
      pieceId: p.id,
      sortieFaite: false
    });
    d.lignes.push(l);
    d.maj = Date.now();
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

export function modifierLigne(dossierId, ligneId, champs) {
  return maj(null, (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    const l = d.lignes.find(x => x.id === ligneId);
    if (!l) return null;
    Object.assign(l, champs);
    d.maj = Date.now();
    return l;
  }, { journal: false });
}

export function supprimerLigne(dossierId, ligneId) {
  return maj('Ligne supprimée', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return false;
    const i = d.lignes.findIndex(x => x.id === ligneId);
    if (i < 0) return false;
    d.lignes.splice(i, 1);
    d.maj = Date.now();
    return true;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** Déplace une ligne dans l'ordre du devis. */
export function deplacerLigne(dossierId, ligneId, versIndex) {
  return maj(null, (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return false;
    const i = d.lignes.findIndex(x => x.id === ligneId);
    if (i < 0) return false;
    const cible = Math.max(0, Math.min(d.lignes.length - 1, versIndex));
    const [l] = d.lignes.splice(i, 1);
    d.lignes.splice(cible, 0, l);
    d.maj = Date.now();
    return true;
  }, { journal: false });
}

/* ==========================================================================
   LE STOCK
   ========================================================================== */

/**
 * Écrit un mouvement et met la quantité à jour. C'est le SEUL chemin par
 * lequel une quantité de stock a le droit de changer.
 * @returns {object|null} le mouvement, ou null si le stock ne suit pas
 */
export function mouvementStock(champs, options) {
  const o = options || {};
  return maj('Mouvement de stock', (e) => {
    const p = lit.piece(e, champs.pieceId);
    if (!p) return null;

    const signe = champs.sens === 'entree' || champs.sens === 'retour' ? 1
      : (champs.sens === 'inventaire' ? 0 : -1);
    const q = Math.abs(nombre(champs.qte, 0));
    if (!q && champs.sens !== 'inventaire') return null;

    const avant = nombre(p.qte, 0);
    let apres;
    if (champs.sens === 'inventaire') {
      apres = nombre(champs.qte, avant);       // l'inventaire pose la vérité
      p.inventorieLe = Date.now();
    } else {
      apres = avant + signe * q;
    }

    /* On refuse de descendre sous zéro : un stock négatif ne veut rien dire,
       et il masque l'erreur de saisie qui l'a créé. Sauf si l'appelant assume
       (régularisation d'inventaire). */
    if (apres < 0 && !o.autoriseNegatif) return null;

    p.qte = apres;
    p.maj = Date.now();

    const m = nouveauMouvement(Object.assign({}, champs, {
      avant, apres, qte: champs.sens === 'inventaire' ? apres - avant : q, qui: qui(), quand: Date.now()
    }));
    e.mouvements.push(m);
    return m;
  }, { cible: { type: 'pieces', id: champs.pieceId } });
}

/* ==========================================================================
   LES PIÈCES QU'ON COMMANDE
   --------------------------------------------------------------------------
   Une pièce qu'on n'a pas dans le rayon se commande. Trois états, et c'est
   tout : à commander, commandée, reçue. Le reste — chez qui, pour quand — se
   note à la commande, parce que c'est à ce moment-là qu'on l'a sous les yeux.
   ========================================================================== */

/** Met une ligne de dossier en suivi de commande, ou la retire du suivi. */
export function suivreCommande(dossierId, ligneId, suivre) {
  return maj(suivre ? 'Pièce à commander' : 'Pièce retirée des commandes', (e) => {
    const l = ligneDe(e, dossierId, ligneId);
    if (!l) return null;
    if (!suivre) {
      l.commande = null;
      l.fournisseurId = null; l.attendueLe = null; l.commandeLe = null; l.recueLe = null;
    } else if (!l.commande) {
      /* On ne commande pas une heure de main-d'œuvre. Le schéma le corrige
         déjà au chargement suivant, mais laisser passer ici ferait apparaître
         une pastille absurde jusqu'au prochain rechargement. */
      if (l.type !== 'piece') return null;
      l.commande = 'a_commander';
    }
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/**
 * Passe la commande d'une pièce.
 * @param {object} infos  { fournisseurId, attendueLe }
 */
export function commanderPiece(dossierId, ligneId, infos) {
  const o = infos || {};
  return maj('Pièce commandée', (e) => {
    const l = ligneDe(e, dossierId, ligneId);
    if (!l) return null;
    l.commande = 'commandee';
    l.fournisseurId = o.fournisseurId || null;
    l.attendueLe = o.attendueLe || null;
    l.commandeLe = Date.now();
    l.recueLe = null;
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** La pièce est arrivée. */
export function recevoirPiece(dossierId, ligneId) {
  return maj('Pièce reçue', (e) => {
    const l = ligneDe(e, dossierId, ligneId);
    if (!l) return null;
    l.commande = 'recue';
    l.recueLe = Date.now();
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** Revenir en arrière : la pièce n'était finalement pas là, ou pas la bonne. */
export function annulerReception(dossierId, ligneId) {
  return maj('Réception annulée', (e) => {
    const l = ligneDe(e, dossierId, ligneId);
    if (!l) return null;
    l.commande = l.commandeLe ? 'commandee' : 'a_commander';
    l.recueLe = null;
    return l;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/** Toutes les pièces d'un dossier passent d'un coup en commandé. */
export function commanderToutLeDossier(dossierId, infos) {
  const o = infos || {};
  let n = 0;
  maj('Commande passée', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    for (const l of d.lignes || []) {
      if (l.commande !== 'a_commander') continue;
      l.commande = 'commandee';
      l.fournisseurId = o.fournisseurId || l.fournisseurId || null;
      l.attendueLe = o.attendueLe || l.attendueLe || null;
      l.commandeLe = Date.now();
      n++;
    }
    return d;
  }, { cible: { type: 'dossiers', id: dossierId } });
  return n;
}

function ligneDe(e, dossierId, ligneId) {
  const d = lit.dossier(e, dossierId);
  if (!d) return null;
  return (d.lignes || []).find(l => l.id === ligneId) || null;
}

/** Sort les pièces d'un dossier du stock, d'un seul geste. Rend le compte de
 *  ce qui est sorti et de ce qui manquait. */
export function servirDossier(dossierId) {
  const sorties = [];
  const manques = [];
  maj('Pièces sorties du stock', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return;
    for (const l of d.lignes) {
      if (l.type !== 'piece' || !l.pieceId || l.sortieFaite) continue;
      const p = lit.piece(e, l.pieceId);
      if (!p) continue;
      const q = nombre(l.qte, 0);
      if (q <= 0) continue;
      if (p.qte < q) { manques.push({ piece: p, demande: q, dispo: p.qte }); continue; }

      const avant = p.qte;
      p.qte = cts(avant - q);
      p.maj = Date.now();
      e.mouvements.push(nouveauMouvement({
        pieceId: p.id, sens: 'sortie', qte: q, avant, apres: p.qte,
        prixUnit: nombre(p.prixAchat), dossierId: d.id,
        motif: 'Dossier ' + (d.numero || ''), qui: qui()
      }));
      l.sortieFaite = true;
      sorties.push({ piece: p, qte: q });
    }
    d.maj = Date.now();
  }, { cible: { type: 'dossiers', id: dossierId } });
  return { sorties, manques };
}

/** Rend au stock ce qu'un dossier avait pris : annulation, pièce non montée. */
export function rendreAuStock(dossierId, ligneId) {
  return maj('Pièce rendue au stock', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    const l = d.lignes.find(x => x.id === ligneId);
    if (!l || !l.pieceId || !l.sortieFaite) return null;
    const p = lit.piece(e, l.pieceId);
    if (!p) return null;
    const q = nombre(l.qte, 0);
    const avant = p.qte;
    p.qte = cts(avant + q);
    p.maj = Date.now();
    e.mouvements.push(nouveauMouvement({
      pieceId: p.id, sens: 'retour', qte: q, avant, apres: p.qte,
      dossierId: d.id, motif: 'Retour dossier ' + (d.numero || ''), qui: qui()
    }));
    l.sortieFaite = false;
    return p;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

/* ==========================================================================
   DEVIS
   ========================================================================== */

/** Fige l'état du dossier dans un devis numéroté. */
export function creerDevis(dossierId, champs) {
  return maj('Devis créé', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    const r = e.reglages;
    const anciens = (e.devis || []).filter(x => x.dossierId === dossierId);

    const dv = nouveauDevis(Object.assign({
      numero: prochainNumero(e, 'devis'),
      dossierId: d.id,
      clientId: d.clientId,
      vehiculeId: d.vehiculeId,
      version: anciens.length + 1,
      lignes: figerLignes(d.lignes),
      remiseGlobale: d.remiseGlobale,
      objet: d.titre || '',
      valableJusquau: plusJours(Date.now(), nombre(r.validiteDevis, 30))
    }, champs));

    e.devis.push(dv);
    if (!Array.isArray(d.devisIds)) d.devisIds = [];
    d.devisIds.push(dv.id);
    d.maj = Date.now();
    return dv;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

export function envoyerDevis(devisId) {
  return maj('Devis envoyé', (e) => {
    const dv = lit.devis(e, devisId);
    if (!dv) return null;
    dv.statut = 'envoye';
    dv.envoyeLe = Date.now();
    dv.maj = Date.now();
    /* Le dossier passe en attente de réponse : c'est l'état réel, et le
       tableau de l'atelier doit le montrer sans qu'on y pense. */
    const d = lit.dossier(e, dv.dossierId);
    if (d && (d.etape === 'devis' || d.etape === 'diag' || d.etape === 'accueil')) d.etape = 'accord';
    return dv;
  }, { cible: { type: 'devis', id: devisId } });
}

/** Le client dit oui. Les travaux peuvent commencer. */
export function accepterDevis(devisId, signature) {
  return maj('Devis accepté', (e) => {
    const dv = lit.devis(e, devisId);
    if (!dv) return null;
    dv.statut = 'accepte';
    dv.repondeLe = Date.now();
    if (signature) dv.signature = Object.assign({ quand: Date.now() }, signature);
    dv.maj = Date.now();

    const d = lit.dossier(e, dv.dossierId);
    if (d) {
      /* Les lignes acceptées redeviennent celles du dossier : c'est ce que
         l'atelier va faire, et c'est ce qui partira en facture. */
      d.lignes = figerLignes(dv.lignes);
      d.remiseGlobale = dv.remiseGlobale;
      if (d.etape === 'accord' || d.etape === 'devis') d.etape = 'atelier';
      d.maj = Date.now();
    }
    return dv;
  }, { cible: { type: 'devis', id: devisId } });
}

export function refuserDevis(devisId, motif) {
  return maj('Devis refusé', (e) => {
    const dv = lit.devis(e, devisId);
    if (!dv) return null;
    dv.statut = 'refuse';
    dv.repondeLe = Date.now();
    if (motif) dv.motDuJour = motif;
    dv.maj = Date.now();
    return dv;
  }, { cible: { type: 'devis', id: devisId } });
}

/* ==========================================================================
   FACTURES
   EBP tient la facturation officielle. Ici on prépare, on suit, on encaisse —
   et on reporte le numéro qu'EBP a donné.
   ========================================================================== */

export function creerFacture(dossierId, champs) {
  return maj('Facture préparée', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) return null;
    if (d.factureId) return lit.facture(e, d.factureId);   // jamais deux fois

    const r = e.reglages;
    const f = nouvelleFacture(Object.assign({
      numero: prochainNumero(e, 'facture'),
      dossierId: d.id,
      clientId: d.clientId,
      vehiculeId: d.vehiculeId,
      lignes: figerLignes(d.lignes),
      remiseGlobale: d.remiseGlobale,
      statut: 'attente',
      echeanceLe: plusJours(Date.now(), nombre(r.delaiPaiement, 30))
    }, champs));

    /* Le dernier devis accepté sert de référence : c'est ce que le client a
       signé, et c'est ce qu'on doit pouvoir lui remontrer. */
    const accepte = (e.devis || []).filter(x => x.dossierId === d.id && x.statut === 'accepte')
      .sort((a, b) => (b.repondeLe || 0) - (a.repondeLe || 0))[0];
    if (accepte) f.devisId = accepte.id;

    e.factures.push(f);
    d.factureId = f.id;
    d.maj = Date.now();
    return f;
  }, { cible: { type: 'dossiers', id: dossierId } });
}

export function emettreFacture(factureId) {
  return maj('Facture émise', (e) => {
    const f = lit.facture(e, factureId);
    if (!f) return null;
    f.statut = 'emise';
    f.emiseLe = Date.now();
    if (!f.echeanceLe) f.echeanceLe = plusJours(Date.now(), nombre(e.reglages.delaiPaiement, 30));
    f.maj = Date.now();
    return f;
  }, { cible: { type: 'factures', id: factureId } });
}

/** Enregistre un encaissement et met le statut d'accord avec le reste dû. */
export function encaisser(factureId, montant, mode, note) {
  return maj('Règlement enregistré', (e) => {
    const f = lit.facture(e, factureId);
    if (!f) return null;
    const m = cts(nombre(montant, 0));
    if (m === 0) return null;

    f.reglements.push({ id: id('reg'), quand: Date.now(), montant: m, mode: mode || 'cb', note: note || '', qui: qui() });
    if (!f.emiseLe) { f.emiseLe = Date.now(); }

    const t = totaux(f, lit.prixDe(e, f.clientId));
    f.statut = t.reste <= 0.005 ? 'reglee' : (t.regle > 0 ? 'partiel' : 'emise');
    f.maj = Date.now();
    return f;
  }, { cible: { type: 'factures', id: factureId } });
}

/** Marque une facture comme reportée dans EBP, avec son numéro là-bas. */
export function reporterDansEbp(quoi, identifiant, numeroEbp) {
  return maj('Reporté dans EBP', (e) => {
    const liste = quoi === 'client' ? e.clients : (quoi === 'devis' ? e.devis : e.factures);
    const x = (liste || []).find(o => o.id === identifiant);
    if (!x) return null;
    x.ebp = Date.now();
    if (numeroEbp) x.numeroEbp = numeroEbp;
    x.maj = Date.now();
    return x;
  });
}

/* ==========================================================================
   LE PARC
   ========================================================================== */

/** Pose un véhicule sur une place. Rend false si la place est déjà prise. */
export function garer(dossierId, place, motif) {
  let ok = true;
  maj('Véhicule garé', (e) => {
    const d = lit.dossier(e, dossierId);
    if (!d) { ok = false; return; }
    if (place) {
      const occupant = (e.dossiers || []).find(x =>
        x.id !== dossierId && !x.archive && x.place === place && ETAPES_OUVERTES.includes(x.etape));
      if (occupant) { ok = false; return; }
    }
    d.place = place || null;
    if (motif) d.motifParc = motif;
    if (place && !d.entree) d.entree = Date.now();
    d.maj = Date.now();
  }, { cible: { type: 'dossiers', id: dossierId } });
  return ok;
}

export const degarer = (dossierId) => garer(dossierId, null);

/* ==========================================================================
   LE PLANNING
   ========================================================================== */

export function poserCreneau(champs) {
  return maj('Créneau posé', (e) => {
    const c = Object.assign({ id: id('cre'), cree: Date.now() }, champs);
    if (typeof c.fin !== 'number' || c.fin <= c.debut) c.fin = c.debut + 30 * 60000;
    e.creneaux.push(c);
    return c;
  });
}

export function deplacerCreneau(creneauId, debut, userId) {
  return maj('Créneau déplacé', (e) => {
    const c = (e.creneaux || []).find(x => x.id === creneauId);
    if (!c) return null;
    const duree = c.fin - c.debut;
    c.debut = debut;
    c.fin = debut + duree;
    if (userId !== undefined && userId !== null) c.userId = userId;
    return c;
  }, { journal: false });
}

/** Accepte une demande venue du portail confrère : elle devient un vrai créneau. */
export function accepterDemande(creneauId, userId) {
  return maj('Demande de créneau acceptée', (e) => {
    const c = (e.creneaux || []).find(x => x.id === creneauId);
    if (!c) return null;
    c.demande = false;
    if (userId) c.userId = userId;
    return c;
  });
}

/* ==========================================================================
   ÉLECTRONIQUE — Autotuner
   ========================================================================== */

export function enregistrerIntervention(champs) {
  return maj('Intervention électronique enregistrée', (e) => {
    const i = nouvelleIntervention(Object.assign({ par: qui() }, champs));
    e.interventions.push(i);
    reconcilierCredits(e, i);
    return i;
  });
}

export function terminerIntervention(interventionId, etat, resultat) {
  return maj('Intervention terminée', (e) => {
    const i = lit.intervention(e, interventionId);
    if (!i) return null;
    i.etat = etat || 'ok';
    if (resultat !== undefined) i.resultat = resultat;
    reconcilierCredits(e, i);
    return i;
  }, { cible: { type: 'interventions', id: interventionId } });
}

/** Modifie une intervention et remet le solde de crédits d'accord avec elle. */
export function modifierIntervention(interventionId, champs) {
  return maj('Intervention modifiée', (e) => {
    const i = lit.intervention(e, interventionId);
    if (!i) return null;
    Object.assign(i, champs);
    reconcilierCredits(e, i);
    return i;
  }, { cible: { type: 'interventions', id: interventionId } });
}

/**
 * Remet le solde d'accord avec CETTE intervention.
 *
 * Le solde de l'outil vaut ce qu'il vaut : la somme des interventions réussies
 * depuis la dernière mise à niveau sur l'appareil. Chaque intervention se
 * souvient donc de ce qu'elle a déjà fait retirer (`creditsDebites`), et on ne
 * bouge que l'écart.
 *
 * Trois cas, et c'est tout :
 *   • elle devient réussie      → on retire ce qui manque ;
 *   • on corrige son nombre de crédits → on ajuste de la différence ;
 *   • elle cesse d'être réussie → on rend ce qu'on avait retiré, parce que
 *     c'est l'enregistrement qui était faux, pas l'appareil. Si les crédits ont
 *     réellement été consommés, « Corriger le solde » a le dernier mot — c'est
 *     l'appareil qui fait foi, jamais nous.
 *
 * Sans cette réconciliation, rouvrir puis refermer une intervention mangeait
 * les crédits une deuxième fois, et changer son nombre de crédits après coup ne
 * changeait rien du tout.
 */
function reconcilierCredits(e, i) {
  /* Compteur éteint : on n'entretient pas un solde que personne ne regarde.
     Les crédits notés sur les interventions restent, ils ne bougent plus. */
  if (e.reglages.suiviCredits === false) return;
  if (!e.credits) e.credits = { solde: 0, historique: [] };
  const du = i.etat === 'ok' ? nombre(i.credits, 0) : 0;
  const deja = nombre(i.creditsDebites, 0);
  const ecart = cts(du - deja);
  if (ecart === 0) return;

  e.credits.solde = cts(nombre(e.credits.solde) - ecart);
  i.creditsDebites = du;
  e.credits.historique.push({
    id: id('cre'),
    quand: Date.now(),
    sens: ecart > 0 ? 'sortie' : 'retour',
    n: Math.abs(ecart),
    solde: e.credits.solde,
    qui: qui(),
    motif: (i.ecu && i.ecu.type) ? i.ecu.type : 'Intervention',
    interventionId: i.id
  });
}

/** Recharge de crédits Autotuner. */
export function rechargerCredits(n, cout, note) {
  return maj('Crédits Autotuner rechargés', (e) => {
    if (!e.credits) e.credits = { solde: 0, historique: [] };
    const q = nombre(n, 0);
    e.credits.solde = cts(nombre(e.credits.solde) + q);
    e.credits.historique.push({
      id: id('cre'), quand: Date.now(), sens: 'entree', n: q,
      solde: e.credits.solde, cout: nombre(cout, 0), motif: note || 'Recharge', qui: qui()
    });
    if (nombre(cout) > 0 && q > 0) e.reglages.prixCredit = cts(nombre(cout) / q);
    return e.credits.solde;
  });
}

/** Corrige le solde à la main, quand l'appareil et l'outil ne disent pas la
 *  même chose. C'est l'appareil qui a raison. */
export function ajusterCredits(solde, note) {
  return maj('Solde de crédits corrigé', (e) => {
    if (!e.credits) e.credits = { solde: 0, historique: [] };
    const avant = nombre(e.credits.solde);
    e.credits.solde = nombre(solde, 0);
    e.credits.historique.push({
      id: id('cre'), quand: Date.now(), sens: 'ajustement',
      n: cts(e.credits.solde - avant), solde: e.credits.solde,
      motif: note || 'Mise à niveau sur l’appareil', qui: qui()
    });
    return e.credits.solde;
  });
}

/* ==========================================================================
   PENSE-BÊTES ET APPELS
   ========================================================================== */

export function poserTache(champs) {
  return maj('Pense-bête posé', (e) => {
    const t = Object.assign({ id: id('tac'), par: qui(), cree: Date.now(), faite: false }, champs);
    e.taches.push(t);
    return t;
  });
}

export function cocherTache(tacheId, faite) {
  return maj(null, (e) => {
    const t = (e.taches || []).find(x => x.id === tacheId);
    if (!t) return null;
    t.faite = faite === undefined ? !t.faite : !!faite;
    t.faiteLe = t.faite ? Date.now() : null;
    return t;
  }, { journal: false });
}

export function enregistrerAppel(champs) {
  return maj('Appel enregistré', (e) => {
    const a = Object.assign({ id: id('app'), quand: Date.now(), par: qui() }, champs);
    e.appels.push(a);
    return a;
  });
}

/* ==========================================================================
   MÉNAGE
   Un outil qui ne jette rien finit par ne plus rien montrer. Ce ménage est
   toujours volontaire : jamais déclenché tout seul, jamais sans compte rendu.
   ========================================================================== */

export function menage(options) {
  const o = options || {};
  const bilan = { creneaux: 0, dossiers: 0, journal: 0, appels: 0 };
  maj('Ménage effectué', (e) => {
    const limite = Date.now() - nombre(o.jours, 90) * JOUR;

    if (o.creneaux !== false) {
      const avant = e.creneaux.length;
      e.creneaux = e.creneaux.filter(c => c.fin >= limite || c.demande);
      bilan.creneaux = avant - e.creneaux.length;
    }
    if (o.dossiers) {
      for (const d of e.dossiers) {
        if (!d.archive && d.etape === 'livre' && (d.sortie || d.maj || 0) < limite) {
          d.archive = true; bilan.dossiers++;
        }
      }
    }
    if (o.appels !== false) {
      const avant = e.appels.length;
      e.appels = e.appels.filter(a => !a.traite || a.quand >= limite);
      bilan.appels = avant - e.appels.length;
    }
    if (o.journal) {
      const avant = e.journal.length;
      e.journal = e.journal.filter(j => j.quand >= limite);
      bilan.journal = avant - e.journal.length;
    }
  });
  return bilan;
}
