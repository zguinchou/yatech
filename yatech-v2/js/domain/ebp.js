/* ==========================================================================
   YATECH — passerelle EBP
   --------------------------------------------------------------------------
   La facturation officielle reste dans EBP : c'est lui qui tient la
   comptabilité, les numéros légaux et l'export au comptable. Ici, on capte au
   téléphone, on chiffre, on suit l'atelier — puis on repasse à EBP ce qu'il
   lui faut, sans que personne ne ressaisisse une ligne.

   Le lien tient à UNE chose : le même code client des deux côtés. Tout le
   reste en découle.

   Le format est un CSV français : point-virgule, guillemets doublés, CRLF,
   marqueur d'ordre des octets en tête. C'est ce qu'EBP et Excel savent lire
   sans qu'on ait à régler quoi que ce soit.

   Les noms de colonnes se règlent dans l'écran EBP : d'une version d'EBP à
   l'autre ils changent, et il ne doit pas falloir toucher au code pour ça.
   ========================================================================== */

import { versCsv, csvEnObjets, telecharger, nomDate } from '../core/fichiers.js';
import { nu, nombre, plaqueJolie } from '../core/util.js';
import { totaux, contexte } from './calculs.js';
import * as lit from './selecteurs.js';

/* ==========================================================================
   LE CODE CLIENT
   ========================================================================== */

/** Le code proposé pour un client : lisible dans EBP, stable, sans accent. */
export function codeEbp(e, c) {
  if (!c) return '';
  if (String(c.codeEbp || '').trim()) return c.codeEbp.trim();
  const base = nu(c.type === 'pro' ? (c.societe || c.nom) : (c.nom || c.prenom || 'client'))
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) || 'CLIENT';
  /* Le rang de création rend le code unique sans dépendre d'un compteur qui
     pourrait diverger entre deux appareils. */
  const rang = (e.clients || []).filter(x => (x.cree || 0) <= (c.cree || 0)).length;
  return base + String(rang).padStart(3, '0');
}

/* ==========================================================================
   COLONNES
   Les intitulés par défaut correspondent à un import « Clients » et
   « Documents de vente » d'EBP Gestion Commerciale. Ils se réécrivent dans
   les réglages si votre version attend d'autres noms.
   ========================================================================== */

export const COLONNES_CLIENTS = [
  'Code', 'Civilite', 'Nom', 'Prenom', 'Adresse1', 'CodePostal', 'Ville', 'Pays',
  'Telephone', 'Portable', 'Email', 'Siret', 'NumeroTVA', 'TypeTiers', 'Remise', 'Commentaire'
];

export const COLONNES_DOCUMENTS = [
  'NumeroDocument', 'TypeDocument', 'DateDocument', 'CodeClient', 'NomClient',
  'Reference', 'Designation', 'Quantite', 'PrixUnitaireHT', 'RemisePourcent',
  'TauxTVA', 'MontantHT', 'MontantTVA', 'MontantTTC', 'Immatriculation', 'Vehicule', 'Kilometrage'
];

/* ==========================================================================
   SORTIES
   ========================================================================== */

/** Les clients, au format qu'EBP sait avaler. */
export function exportClients(e, options) {
  const o = options || {};
  const liste = (o.clients || e.clients || []).filter(c => !c.archive || o.archives);
  const lignes = [COLONNES_CLIENTS];

  for (const c of liste) {
    lignes.push([
      codeEbp(e, c),
      c.civilite || '',
      c.type === 'pro' ? (c.societe || c.nom) : c.nom,
      c.type === 'pro' ? '' : c.prenom,
      c.adresse || '',
      c.cp || '',
      c.ville || '',
      'FRANCE',
      c.tel || '',
      c.tel2 || '',
      c.email || '',
      c.siret || '',
      c.tvaIntra || '',
      c.type === 'pro' ? 'Professionnel' : 'Particulier',
      nombre(c.remise, 0),
      (c.notes || '').replace(/\s+/g, ' ').slice(0, 240)
    ]);
  }
  return versCsv(lignes);
}

/**
 * Les documents de vente, une ligne de fichier par ligne de document.
 * EBP recompose le document à partir du numéro : c'est ce format qui évite de
 * saisir deux fois un devis de quinze lignes.
 */
export function exportDocuments(e, documents, type) {
  const lignes = [COLONNES_DOCUMENTS];

  for (const doc of documents) {
    const c = lit.client(e, doc.clientId);
    const v = lit.vehicule(e, doc.vehiculeId);
    const ctx = contexte(e.reglages, c);
    const t = totaux(doc, ctx);
    const dossier = doc.dossierId ? lit.dossier(e, doc.dossierId) : null;
    const quand = doc.emiseLe || doc.envoyeLe || doc.emisLe || doc.cree;

    for (const l of doc.lignes || []) {
      if (!l || l.type === 'titre') continue;
      const x = chiffrerLigne(l, ctx);
      lignes.push([
        doc.numero || '',
        type === 'devis' ? 'Devis' : 'Facture',
        dateFr(quand),
        codeEbp(e, c),
        lit.nomClient(c),
        l.ref || '',
        l.libelle || '',
        virgule(l.qte),
        virgule(l.prixHT),
        virgule(l.remise),
        virgule(x.tauxTva),
        virgule(x.ht),
        virgule(x.tva),
        virgule(x.ttc),
        v ? plaqueJolie(v.immat) : '',
        v ? lit.nomVehiculeLong(v) : '',
        dossier ? (dossier.kmSortie || dossier.kmEntree || '') : ''
      ]);
    }

    /* La remise globale part comme une ligne à part : sinon elle disparaît, et
       le total du fichier ne colle plus avec celui du document. */
    if (t.remiseGlobale > 0) {
      lignes.push([
        doc.numero || '', type === 'devis' ? 'Devis' : 'Facture', dateFr(quand),
        codeEbp(e, c), lit.nomClient(c), 'REMISE',
        'Remise globale ' + nombre(doc.remiseGlobale) + ' %',
        '1', virgule(-t.remiseGlobale), '0', virgule(ctx.tva),
        virgule(-t.remiseGlobale), virgule(-(t.remiseGlobale * ctx.tva / 100)),
        virgule(-(t.remiseGlobale * (1 + ctx.tva / 100))), '', '', ''
      ]);
    }
  }
  return versCsv(lignes);
}

function chiffrerLigne(l, ctx) {
  const brut = nombre(l.qte) * nombre(l.prixHT);
  const ht = brut * (1 - nombre(l.remise) / 100);
  const tauxTva = !ctx.tvaApplicable ? 0
    : (l.tva === null || l.tva === undefined ? ctx.tva : nombre(l.tva, ctx.tva));
  const tva = ht * tauxTva / 100;
  return {
    ht: arrondi(ht), tva: arrondi(tva), ttc: arrondi(ht + tva), tauxTva
  };
}

const arrondi = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** EBP attend la virgule décimale, comme tout logiciel français. */
function virgule(n) {
  if (n === '' || n === null || n === undefined) return '';
  return String(arrondi(n)).replace('.', ',');
}

function dateFr(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

/* ==========================================================================
   CE QUI RESTE À PASSER
   La liste de ce qui attend un report dans EBP. C'est elle qui alimente le
   compteur du tableau de bord : une fiche créée le matin ne doit pas dormir
   jusqu'au soir.
   ========================================================================== */

export function enAttenteDeReport(e) {
  return {
    clients: (e.clients || []).filter(c => !c.archive && !c.ebp),
    factures: (e.factures || []).filter(f => f.statut !== 'attente' && !f.ebp),
    devis: (e.devis || []).filter(d => d.statut === 'accepte' && !d.ebp)
  };
}

export function compteEnAttente(e) {
  const a = enAttenteDeReport(e);
  return a.clients.length + a.factures.length + a.devis.length;
}

/* ==========================================================================
   ENTRÉES
   Reprendre un fichier client sorti d'EBP, pour démarrer sans tout retaper.
   ========================================================================== */

/** Devine à quoi correspond chaque colonne d'un fichier inconnu. */
export function devinerColonnes(entetes) {
  const carte = {};
  const cherche = (cibles) => entetes.find(h => {
    const n = nu(h);
    return cibles.some(c => n === c || n.includes(c));
  }) || null;

  carte.code    = cherche(['code client', 'codeclient', 'code']);
  carte.nom     = cherche(['raison sociale', 'nom', 'libelle']);
  carte.prenom  = cherche(['prenom']);
  carte.civilite= cherche(['civilite']);
  carte.adresse = cherche(['adresse1', 'adresse']);
  carte.cp      = cherche(['code postal', 'codepostal', 'cp']);
  carte.ville   = cherche(['ville']);
  carte.tel     = cherche(['telephone', 'tel fixe', 'tel']);
  carte.tel2    = cherche(['portable', 'mobile']);
  carte.email   = cherche(['email', 'e-mail', 'mail']);
  carte.siret   = cherche(['siret']);
  carte.tva     = cherche(['numero tva', 'numerotva', 'tva intra']);
  carte.type    = cherche(['type tiers', 'typetiers', 'type']);
  carte.notes   = cherche(['commentaire', 'note', 'observation']);
  return carte;
}

/**
 * Lit un fichier de clients et rend ce qu'on y a trouvé, SANS rien écrire.
 * L'écran montre le résultat, la personne confirme, et seulement ensuite on
 * enregistre : un import qui s'exécute avant qu'on ait vu ce qu'il fait est
 * un import qu'on regrette.
 */
export function lireFichierClients(texte, carteColonnes) {
  const objets = csvEnObjets(texte);
  if (!objets.length) return { lignes: [], carte: {}, entetes: [] };

  const entetes = Object.keys(objets[0]);
  const carte = carteColonnes || devinerColonnes(entetes);
  const val = (o, cle) => (carte[cle] && o[carte[cle]] !== undefined ? String(o[carte[cle]]).trim() : '');

  const lignes = objets.map((o, i) => {
    const nomBrut = val(o, 'nom');
    const type = /pro|societ|entrepr/i.test(val(o, 'type')) || !!val(o, 'siret') ? 'pro' : 'part';
    return {
      rang: i + 2,                      // ligne dans le fichier, en-tête comprise
      codeEbp: val(o, 'code'),
      type,
      civilite: val(o, 'civilite'),
      nom: type === 'pro' ? '' : nomBrut,
      societe: type === 'pro' ? nomBrut : '',
      prenom: val(o, 'prenom'),
      adresse: val(o, 'adresse'),
      cp: val(o, 'cp'),
      ville: val(o, 'ville'),
      tel: val(o, 'tel'),
      tel2: val(o, 'tel2'),
      email: val(o, 'email'),
      siret: val(o, 'siret'),
      tvaIntra: val(o, 'tva'),
      notes: val(o, 'notes'),
      grille: type === 'pro' ? 'pro' : 'part',
      valide: !!nomBrut
    };
  });

  return { lignes, carte, entetes };
}

/** Repère les doublons avant d'importer : même code EBP, ou même nom+ville. */
export function repererDoublons(e, lignes) {
  const parCode = new Map();
  const parNom = new Map();
  for (const c of e.clients || []) {
    const code = nu(c.codeEbp);
    if (code) parCode.set(code, c);
    parNom.set(nu(lit.nomClient(c)) + '|' + nu(c.ville), c);
  }
  return lignes.map(l => {
    const nom = l.type === 'pro' ? l.societe : [l.prenom, l.nom].filter(Boolean).join(' ');
    const existant = (l.codeEbp && parCode.get(nu(l.codeEbp)))
      || parNom.get(nu(nom) + '|' + nu(l.ville))
      || null;
    return Object.assign({}, l, { existant: existant ? existant.id : null });
  });
}

/* ==========================================================================
   TÉLÉCHARGEMENTS TOUT PRÊTS
   ========================================================================== */

export function telechargerClients(e, clients) {
  return telecharger(nomDate('ebp-clients', 'csv'), exportClients(e, { clients }));
}

export function telechargerFactures(e, factures) {
  return telecharger(nomDate('ebp-factures', 'csv'), exportDocuments(e, factures, 'facture'));
}

export function telechargerDevis(e, devis) {
  return telecharger(nomDate('ebp-devis', 'csv'), exportDocuments(e, devis, 'devis'));
}

/** Le résumé d'un document, à recopier à la main dans EBP quand on préfère.
 *  Sur téléphone, c'est souvent plus rapide qu'un fichier. */
export function ficheASaisir(e, doc) {
  const c = lit.client(e, doc.clientId);
  const v = lit.vehicule(e, doc.vehiculeId);
  const ctx = contexte(e.reglages, c);
  const t = totaux(doc, ctx);
  const l = [];

  l.push('Client : ' + lit.nomClient(c) + '  (code ' + codeEbp(e, c) + ')');
  if (v) l.push('Véhicule : ' + lit.nomVehiculeLong(v) + '  ' + plaqueJolie(v.immat));
  l.push('Document : ' + (doc.numero || ''));
  l.push('');
  for (const li of doc.lignes || []) {
    if (!li || li.type === 'titre') { l.push('— ' + (li.libelle || '')); continue; }
    const x = chiffrerLigne(li, ctx);
    l.push([
      (li.ref ? li.ref + '  ' : '') + li.libelle,
      nombre(li.qte) + ' x ' + virgule(li.prixHT) + ' €',
      (nombre(li.remise) ? '-' + nombre(li.remise) + '%  ' : '') + virgule(x.ht) + ' € HT'
    ].join('  |  '));
  }
  l.push('');
  l.push('Total HT  : ' + virgule(t.ht) + ' €');
  for (const d of t.detailTva) l.push('TVA ' + d.taux + '%  : ' + virgule(d.tva) + ' €');
  l.push('Total TTC : ' + virgule(t.ttc) + ' €');
  return l.join('\n');
}
