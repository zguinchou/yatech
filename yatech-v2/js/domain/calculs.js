/* ==========================================================================
   YATECH — les calculs
   --------------------------------------------------------------------------
   Un seul endroit calcule un prix. Le devis à l'écran, le PDF imprimé,
   l'export EBP et le chiffre d'affaires du tableau de bord passent tous par
   ici : c'est la seule façon d'être sûr qu'ils disent la même chose.

   COMMENT SE FORME UN PRIX — trois étages, et pas un de plus, pour qu'on
   puisse toujours expliquer un montant au client :

     1. le PRIX DE BASE vient du catalogue, à la grille du client
        (particulier ou confrère) ;
     2. la REMISE DE LIGNE, en pourcentage, se voit sur le document ;
     3. la REMISE GLOBALE, en pourcentage, s'applique au total hors taxes.

   La remise inscrite sur la fiche client sert de PROPOSITION quand on ajoute
   une ligne : elle pré-remplit l'étage 2. Elle ne s'applique jamais toute
   seule au total — une remise invisible est une remise qu'on oublie, et qu'on
   accorde deux fois.

   Tous les montants sont hors taxes tant qu'on n'écrit pas « TTC ».
   ========================================================================== */

import { cts, nombre } from '../core/util.js';

/* ==========================================================================
   LE CONTEXTE DE PRIX
   Ce qu'il faut savoir pour chiffrer : à qui on vend, et selon quels réglages.
   ========================================================================== */

/**
 * @param {object} reglages
 * @param {object} [client]
 * @returns {object} contexte utilisable par toutes les fonctions d'ici
 */
export function contexte(reglages, client) {
  const r = reglages || {};
  const pro = !!(client && (client.grille === 'pro' || (!client.grille && client.type === 'pro')));
  return {
    pro,
    grille: pro ? 'pro' : 'part',
    taux: pro ? nombre(r.tauxHorairePro, 52) : nombre(r.tauxHoraire, 65),
    remisePro: nombre(r.remiseProDefaut, 0),
    remiseClient: nombre(client && client.remise, 0),
    tva: r.tvaApplicable === false ? 0 : nombre(r.tauxTva, 20),
    tvaApplicable: r.tvaApplicable !== false,
    arrondiHeure: nombre(r.arrondiHeure, 0) || 0,
    margeDefaut: nombre(r.margeDefaut, 30)
  };
}

/* ==========================================================================
   PRIX D'UNE PRESTATION DU CATALOGUE
   ========================================================================== */

/**
 * Le prix hors taxes d'une prestation, pour ce client-là.
 * Un prix fixé dans le catalogue gagne toujours sur un calcul au temps :
 * un forfait révision reste un forfait, même si le taux horaire change.
 */
export function prixPrestation(prestation, ctx) {
  if (!prestation) return 0;
  const c = ctx || contexte({});

  if (c.pro) {
    if (nombre(prestation.prixPro) > 0) return cts(prestation.prixPro);
    /* Pas de prix confrère fixé : on part du prix public, moins la remise
       générale accordée aux professionnels. */
    if (nombre(prestation.prixHT) > 0) return cts(prestation.prixHT * (1 - c.remisePro / 100));
    return cts(nombre(prestation.temps) * c.taux);
  }
  if (nombre(prestation.prixHT) > 0) return cts(prestation.prixHT);
  return cts(nombre(prestation.temps) * c.taux);
}

/** Le prix de vente d'une pièce, selon la grille du client. */
export function prixPiece(piece, ctx) {
  if (!piece) return 0;
  const c = ctx || contexte({});
  if (c.pro) {
    if (nombre(piece.prixVentePro) > 0) return cts(piece.prixVentePro);
    if (nombre(piece.prixVente) > 0) return cts(piece.prixVente * (1 - c.remisePro / 100));
  } else if (nombre(piece.prixVente) > 0) {
    return cts(piece.prixVente);
  }
  /* Aucun prix de vente enregistré : on propose le prix d'achat majoré de la
     marge habituelle. C'est une proposition, pas une vérité — elle s'affiche
     dans un champ qu'on peut corriger. */
  const achat = nombre(piece.prixAchat);
  return achat > 0 ? cts(achat * (1 + c.margeDefaut / 100)) : 0;
}

/** Le prix de vente conseillé pour une pièce qu'on vient de rentrer. */
export function prixConseille(prixAchat, marge) {
  const a = nombre(prixAchat);
  if (a <= 0) return 0;
  return cts(a * (1 + nombre(marge, 30) / 100));
}

/** La marge réalisée sur une pièce, en euros et en pourcentage du prix de vente. */
export function marge(prixVente, prixAchat) {
  const v = nombre(prixVente), a = nombre(prixAchat);
  const euros = cts(v - a);
  return { euros, taux: v > 0 ? cts((euros / v) * 100) : 0 };
}

/** Arrondit un temps de main-d'œuvre au pas de facturation du garage. */
export function arrondirTemps(heures, pas) {
  const p = nombre(pas, 0);
  const h = nombre(heures);
  if (p <= 0) return h;
  return Math.round(h / p) * p;
}

/* ==========================================================================
   UNE LIGNE
   ========================================================================== */

/**
 * Chiffre une ligne.
 * @returns {object} { brut, remise, ht, tauxTva, tva, ttc }
 */
export function ligneChiffree(ligne, ctx) {
  const c = ctx || contexte({});
  if (!ligne || ligne.type === 'titre') {
    return { brut: 0, remise: 0, ht: 0, tauxTva: 0, tva: 0, ttc: 0 };
  }

  const qte = nombre(ligne.qte, 0);
  const pu = nombre(ligne.prixHT, 0);
  const brut = cts(qte * pu);

  const tauxRemise = Math.min(100, Math.max(-100, nombre(ligne.remise, 0)));
  const remise = cts(brut * (tauxRemise / 100));
  const ht = cts(brut - remise);

  /* Une ligne peut porter son propre taux (pièce à 5,5 % — rare, mais ça
     existe). Sinon elle suit le taux du garage. En franchise de TVA, tout est
     à zéro, quel que soit ce qui est écrit sur la ligne. */
  const tauxTva = !c.tvaApplicable ? 0
    : (ligne.tva === null || ligne.tva === undefined ? c.tva : nombre(ligne.tva, c.tva));
  const tva = cts(ht * (tauxTva / 100));

  return { brut, remise, ht, tauxTva, tva, ttc: cts(ht + tva) };
}

/* ==========================================================================
   UN DOCUMENT ENTIER
   ========================================================================== */

/**
 * Additionne un document (dossier, devis ou facture).
 * @param {object} doc  porte `lignes`, `remiseGlobale`, éventuellement `acompte`
 * @param {object} ctx
 * @returns {object} le détail complet, prêt à afficher ou à imprimer
 */
export function totaux(doc, ctx) {
  const c = ctx || contexte({});
  const lignes = (doc && Array.isArray(doc.lignes)) ? doc.lignes : [];

  let brut = 0, remiseLignes = 0;
  /* La TVA se calcule par taux, pas sur le total : mélanger 20 % et 5,5 %
     puis appliquer une moyenne donne un centime de travers, et un centime de
     travers sur une facture, c'est un appel du comptable. */
  const parTaux = new Map();

  for (const l of lignes) {
    if (!l || l.type === 'titre') continue;
    const x = ligneChiffree(l, c);
    brut += x.brut;
    remiseLignes += x.remise;
    const t = parTaux.get(x.tauxTva) || { taux: x.tauxTva, base: 0, tva: 0 };
    t.base += x.ht;
    parTaux.set(x.tauxTva, t);
  }
  brut = cts(brut);
  remiseLignes = cts(remiseLignes);

  const htAvantGlobale = cts(brut - remiseLignes);
  const tauxGlobal = Math.min(100, Math.max(0, nombre(doc && doc.remiseGlobale, 0)));
  const remiseGlobale = cts(htAvantGlobale * (tauxGlobal / 100));
  const ht = cts(htAvantGlobale - remiseGlobale);

  /* La remise globale se répartit sur chaque base de TVA, au prorata : sinon
     elle s'imputerait arbitrairement sur un taux plutôt qu'un autre. */
  const facteur = htAvantGlobale > 0 ? ht / htAvantGlobale : 1;
  const detailTva = [];
  let tva = 0;
  for (const t of parTaux.values()) {
    const base = cts(t.base * facteur);
    const montant = cts(base * (t.taux / 100));
    tva += montant;
    if (base !== 0 || montant !== 0) detailTva.push({ taux: t.taux, base, tva: montant });
  }
  tva = cts(tva);
  detailTva.sort((a, b) => b.taux - a.taux);

  const ttc = cts(ht + tva);
  const acompte = cts(nombre(doc && doc.acompte, 0));

  /* Ce qui a déjà été encaissé, quand le document est une facture. */
  const regle = cts((doc && Array.isArray(doc.reglements) ? doc.reglements : [])
    .reduce((s, r) => s + nombre(r.montant), 0));

  return {
    brut,
    remiseLignes,
    remiseGlobale,
    remiseTotale: cts(remiseLignes + remiseGlobale),
    ht,
    detailTva,
    tva,
    ttc,
    acompte,
    regle,
    reste: cts(ttc - acompte - regle),
    nbLignes: lignes.filter(l => l && l.type !== 'titre').length
  };
}

/** Le total en une seule valeur, quand on n'a besoin que de ça (listes). */
export function totalTtc(doc, ctx) { return totaux(doc, ctx).ttc; }
export function totalHt(doc, ctx) { return totaux(doc, ctx).ht; }

/* ==========================================================================
   MARGE D'UN DOCUMENT
   Ce que le travail rapporte vraiment : le prix de vente moins ce que les
   pièces ont coûté. La main-d'œuvre est comptée comme entièrement marge —
   c'est du temps, pas un achat.
   ========================================================================== */

export function margeDocument(doc, ctx, pieces) {
  const c = ctx || contexte({});
  const index = new Map((pieces || []).map(p => [p.id, p]));
  let vente = 0, cout = 0, inconnu = 0;

  for (const l of (doc && doc.lignes) || []) {
    if (!l || l.type === 'titre') continue;
    const x = ligneChiffree(l, c);
    vente += x.ht;
    if (l.type === 'piece' || l.type === 'sous') {
      const p = l.pieceId ? index.get(l.pieceId) : null;
      if (p && nombre(p.prixAchat) > 0) cout += cts(nombre(p.prixAchat) * nombre(l.qte));
      else if (nombre(l.prixAchat) > 0) cout += cts(nombre(l.prixAchat) * nombre(l.qte));
      else inconnu += x.ht;      // pièce sans prix d'achat : on ne peut rien dire
    }
  }
  vente = cts(vente);
  cout = cts(cout);
  return {
    vente,
    cout,
    marge: cts(vente - cout),
    taux: vente > 0 ? cts(((vente - cout) / vente) * 100) : 0,
    inconnu: cts(inconnu)        // part du chiffre dont la marge est inconnue
  };
}

/* ==========================================================================
   CONVERSIONS
   ========================================================================== */

/** Copie les lignes d'un dossier vers un devis ou une facture. La copie est
 *  franche : modifier le dossier ensuite ne doit pas réécrire un devis déjà
 *  envoyé au client. */
export function figerLignes(lignes) {
  return (lignes || []).map(l => Object.assign({}, l, {
    /* On garde le lien vers la pièce et la prestation : c'est ce qui permet
       de retrouver l'origine d'une ligne dans six mois. */
    fait: false,
    sortieFaite: false
  }));
}

/** Le montant TTC d'un acompte demandé, en pourcentage du total. */
export function acompteSur(doc, ctx, pourcentage) {
  return cts(totaux(doc, ctx).ttc * (nombre(pourcentage, 0) / 100));
}

/* ==========================================================================
   VÉRIFICATIONS AVANT ENVOI
   Ce qui empêche un devis de partir bancal. On ne bloque presque rien — on
   prévient, et la personne décide.
   ========================================================================== */

export function verifierDocument(doc, ctx, options) {
  const o = options || {};
  const soucis = [];
  const t = totaux(doc, ctx);

  if (!t.nbLignes) soucis.push({ gravite: 'bloquant', texte: 'Aucune ligne : il n’y a rien à chiffrer.' });

  for (const l of (doc.lignes || [])) {
    if (!l || l.type === 'titre') continue;
    if (!String(l.libelle || '').trim()) {
      soucis.push({ gravite: 'bloquant', texte: 'Une ligne n’a pas de désignation.', ligneId: l.id });
    }
    if (nombre(l.prixHT) === 0 && !o.gratuitAutorise) {
      soucis.push({ gravite: 'avertissement', texte: '« ' + (l.libelle || 'Une ligne') + ' » est à 0 €.', ligneId: l.id });
    }
    if (nombre(l.qte) <= 0) {
      soucis.push({ gravite: 'avertissement', texte: '« ' + (l.libelle || 'Une ligne') + ' » a une quantité nulle.', ligneId: l.id });
    }
  }

  if (t.ttc < 0) soucis.push({ gravite: 'bloquant', texte: 'Le total est négatif.' });
  if (nombre(doc.remiseGlobale) >= 50) {
    soucis.push({ gravite: 'avertissement', texte: 'La remise globale dépasse 50 %.' });
  }
  return {
    soucis,
    bloquant: soucis.some(s => s.gravite === 'bloquant'),
    total: t
  };
}
