/* ==========================================================================
   YATECH — lectures
   --------------------------------------------------------------------------
   Les questions qu'on pose aux données, écrites une fois. « Quels dossiers
   sont ouverts ? », « Que doit ce client ? », « Quelles pièces manquent ? ».

   Aucune de ces fonctions ne modifie quoi que ce soit : on peut les appeler
   d'un rendu sans crainte. Elles prennent l'état en premier argument plutôt
   que d'aller le chercher — c'est ce qui les rend vérifiables.
   ========================================================================== */

import { nu, correspond, score, par, jour0, plusJours, lundi, JOUR, nombre } from '../core/util.js';
import { totaux, contexte } from './calculs.js';
import {
  ETAPES_OUVERTES, ETAPES_ATTENTE, CLES_ETAPES, NATURES, PRIORITES
} from './schema.js';

/* ==========================================================================
   RETROUVER
   ========================================================================== */

export const client = (e, id) => (e.clients || []).find(c => c.id === id) || null;
export const vehicule = (e, id) => (e.vehicules || []).find(v => v.id === id) || null;
export const dossier = (e, id) => (e.dossiers || []).find(d => d.id === id) || null;
export const devis = (e, id) => (e.devis || []).find(d => d.id === id) || null;
export const facture = (e, id) => (e.factures || []).find(f => f.id === id) || null;
export const piece = (e, id) => (e.pieces || []).find(p => p.id === id) || null;
export const fournisseur = (e, id) => (e.fournisseurs || []).find(f => f.id === id) || null;
export const utilisateur = (e, id) => (e.utilisateurs || []).find(u => u.id === id) || null;
export const prestation = (e, id) => (e.prestations || []).find(p => p.id === id) || null;
export const intervention = (e, id) => (e.interventions || []).find(i => i.id === id) || null;

/* ==========================================================================
   NOMMER
   Un nom bien formé, quel que soit ce qui manque dans la fiche. Un écran ne
   doit jamais afficher « undefined » parce qu'un prénom est vide.
   ========================================================================== */

export function nomClient(c) {
  if (!c) return 'Client inconnu';
  if (c.type === 'pro') return c.societe || c.nom || 'Professionnel';
  const n = [c.prenom, c.nom].filter(Boolean).join(' ').trim();
  return n || c.societe || 'Client sans nom';
}

/** Le nom trié à l'annuaire : nom d'abord, pour ranger la liste. */
export function nomClientTri(c) {
  if (!c) return '';
  if (c.type === 'pro') return nu(c.societe || c.nom);
  return nu([c.nom, c.prenom].filter(Boolean).join(' '));
}

export function nomVehicule(v) {
  if (!v) return 'Véhicule inconnu';
  const n = [v.marque, v.modele].filter(Boolean).join(' ').trim();
  return n || 'Véhicule';
}

/** « Peugeot 308 — 2.0 HDi 136 » */
export function nomVehiculeLong(v) {
  if (!v) return 'Véhicule inconnu';
  const base = nomVehicule(v);
  return v.motorisation ? base + ' — ' + v.motorisation : base;
}

export function nomUtilisateur(u) {
  if (!u) return 'Quelqu’un';
  return [u.prenom, u.nom].filter(Boolean).join(' ').trim() || 'Sans nom';
}

/** Le titre d'un dossier : le sien, ou à défaut de quoi il parle. */
export function titreDossier(e, d) {
  if (!d) return 'Dossier';
  if (String(d.titre || '').trim()) return d.titre;
  const v = vehicule(e, d.vehiculeId);
  if (v) return nomVehicule(v);
  return d.numero || 'Dossier';
}

/* ==========================================================================
   RATTACHEMENTS
   ========================================================================== */

export const vehiculesDe = (e, clientId) =>
  (e.vehicules || []).filter(v => v.clientId === clientId && !v.archive);

export const dossiersDe = (e, clientId) =>
  (e.dossiers || []).filter(d => d.clientId === clientId).sort(par('cree', 'desc'));

export const dossiersDuVehicule = (e, vehiculeId) =>
  (e.dossiers || []).filter(d => d.vehiculeId === vehiculeId).sort(par('cree', 'desc'));

export const devisDuDossier = (e, dossierId) =>
  (e.devis || []).filter(d => d.dossierId === dossierId).sort(par('cree', 'desc'));

export const facturesDe = (e, clientId) =>
  (e.factures || []).filter(f => f.clientId === clientId).sort(par('cree', 'desc'));

export const interventionsDuVehicule = (e, vehiculeId) =>
  (e.interventions || []).filter(i => i.vehiculeId === vehiculeId).sort(par('quand', 'desc'));

export const creneauxDuDossier = (e, dossierId) =>
  (e.creneaux || []).filter(c => c.dossierId === dossierId).sort(par('debut'));

export const mouvementsDePiece = (e, pieceId) =>
  (e.mouvements || []).filter(m => m.pieceId === pieceId).sort(par('quand', 'desc'));

/** Le propriétaire d'un véhicule, et le véhicule d'un dossier : deux sauts
 *  qu'on fait tout le temps. */
export function contexteDossier(e, d) {
  if (!d) return { dossier: null, client: null, vehicule: null };
  const v = vehicule(e, d.vehiculeId);
  return {
    dossier: d,
    vehicule: v,
    client: client(e, d.clientId || (v ? v.clientId : null))
  };
}

/** Le contexte de prix d'un dossier : la grille du client s'applique. */
export function prixDe(e, clientId) {
  return contexte(e.reglages, client(e, clientId));
}

/** Les totaux d'un dossier, calculés avec la bonne grille. */
export function totauxDossier(e, d) {
  if (!d) return totaux({ lignes: [] }, contexte(e.reglages));
  return totaux(d, prixDe(e, d.clientId));
}

/* ==========================================================================
   L'ATELIER
   ========================================================================== */

export const dossiersOuverts = (e) =>
  (e.dossiers || []).filter(d => !d.archive && ETAPES_OUVERTES.includes(d.etape));

export const dossiersParEtape = (e, etape) =>
  (e.dossiers || []).filter(d => !d.archive && d.etape === etape).sort(triDossiers);

/** L'ordre dans une colonne : l'urgent d'abord, puis le plus ancien. */
export function triDossiers(a, b) {
  const pa = PRIORITES[a.priorite] ? PRIORITES[a.priorite].rang : 1;
  const pb = PRIORITES[b.priorite] ? PRIORITES[b.priorite].rang : 1;
  if (pa !== pb) return pb - pa;
  return (a.entree || a.cree || 0) - (b.entree || b.cree || 0);
}

/** Les dossiers d'une personne : ce qu'elle a sur les bras aujourd'hui. */
export const dossiersDe_personne = (e, userId) =>
  dossiersOuverts(e).filter(d => (d.assignes || []).includes(userId)).sort(triDossiers);

/** Le compte par colonne, pour les pastilles du tableau. */
export function compteParEtape(e) {
  const c = {};
  for (const k of CLES_ETAPES) c[k] = 0;
  for (const d of e.dossiers || []) if (!d.archive && c[d.etape] !== undefined) c[d.etape]++;
  return c;
}

/** Depuis combien de jours ce dossier est-il chez nous ? */
export const joursDansAtelier = (d) =>
  d ? Math.max(0, Math.round((jour0() - jour0(d.entree || d.cree)) / JOUR)) : 0;

/* ==========================================================================
   LE PARC
   ========================================================================== */

/** La liste des places, telle que les réglages la décrivent. */
export function places(e) {
  const r = e.reglages || {};
  const colonnes = Math.max(1, Math.min(20, nombre(r.parcColonnes, 6)));
  const rangees = Math.max(1, Math.min(20, nombre(r.parcRangees, 3)));
  const lettres = 'ABCDEFGHIJKLMNOPQRST';
  const sortie = [];
  for (let li = 0; li < rangees; li++) {
    for (let co = 1; co <= colonnes; co++) {
      const code = lettres[li] + co;
      sortie.push({
        code,
        rangee: lettres[li],
        colonne: co,
        nomRangee: r.nomsRangees[lettres[li]] || null,
        type: r.typesPlaces[code] || 'normale'
      });
    }
  }
  return sortie;
}

/** Qui occupe quoi. Rend une Map code de place -> dossier. */
export function occupation(e) {
  const m = new Map();
  for (const d of e.dossiers || []) {
    if (d.archive || !d.place) continue;
    if (!ETAPES_OUVERTES.includes(d.etape)) continue;
    /* Deux dossiers sur la même place : ça ne devrait pas arriver, mais si
       ça arrive on garde le plus récent et on le signale plus bas. */
    const deja = m.get(d.place);
    if (!deja || (d.entree || 0) > (deja.entree || 0)) m.set(d.place, d);
  }
  return m;
}

export function placesLibres(e) {
  const prises = occupation(e);
  return places(e).filter(p => p.type !== 'hs' && !prises.has(p.code));
}

/** Les conflits de place : deux véhicules annoncés au même endroit. */
export function conflitsParc(e) {
  const vus = new Map();
  const conflits = [];
  for (const d of e.dossiers || []) {
    if (d.archive || !d.place || !ETAPES_OUVERTES.includes(d.etape)) continue;
    if (vus.has(d.place)) conflits.push({ place: d.place, dossiers: [vus.get(d.place), d] });
    else vus.set(d.place, d);
  }
  return conflits;
}

/* ==========================================================================
   LE STOCK
   ========================================================================== */

/** Le seuil bas d'une pièce : le sien, sinon celui du garage. */
export const seuilBas = (e, p) =>
  (p && p.qteMin !== null && p.qteMin !== undefined) ? p.qteMin : nombre(e.reglages.stockAlerteDefaut, 1);

export const piecesEnAlerte = (e) =>
  (e.pieces || []).filter(p => !p.archive && p.qte <= seuilBas(e, p));

export const piecesEpuisees = (e) =>
  (e.pieces || []).filter(p => !p.archive && p.qte <= 0);

/** La valeur du stock, au prix d'achat : ce que l'argent immobilisé représente. */
export function valeurStock(e) {
  let achat = 0, vente = 0, lignes = 0, articles = 0;
  for (const p of e.pieces || []) {
    if (p.archive || p.qte <= 0) continue;
    achat += nombre(p.prixAchat) * p.qte;
    vente += nombre(p.prixVente) * p.qte;
    lignes++;
    articles += p.qte;
  }
  return { achat: Math.round(achat * 100) / 100, vente: Math.round(vente * 100) / 100, lignes, articles };
}

/** Les emplacements utilisés, rangés par rayon puis travée. */
export function emplacements(e) {
  const m = new Map();
  for (const p of e.pieces || []) {
    if (p.archive) continue;
    const code = String(p.emplacement || '').trim().toUpperCase();
    if (!code) continue;
    if (!m.has(code)) m.set(code, []);
    m.get(code).push(p);
  }
  return m;
}

/** Découpe un code d'emplacement « R2-B-04 » en ses trois niveaux. */
export function lireEmplacement(code) {
  const parts = String(code || '').toUpperCase().split(/[-_/. ]+/).filter(Boolean);
  return {
    rayon: parts[0] || '',
    travee: parts[1] || '',
    bac: parts[2] || '',
    code: parts.join('-')
  };
}

/** Les pièces réservées par les dossiers en cours mais pas encore sorties.
 *  C'est ce qui explique un écart entre « il en reste 3 » et « il en reste 0 ». */
export function reservations(e) {
  const m = new Map();
  for (const d of e.dossiers || []) {
    if (d.archive || !ETAPES_OUVERTES.includes(d.etape)) continue;
    for (const l of d.lignes || []) {
      if (l.type !== 'piece' || !l.pieceId || l.sortieFaite) continue;
      m.set(l.pieceId, (m.get(l.pieceId) || 0) + nombre(l.qte, 0));
    }
  }
  return m;
}

/* ==========================================================================
   L'ARGENT
   ========================================================================== */

/** Ce qu'un client doit : factures émises, non soldées. */
export function duPar(e, clientId) {
  let total = 0;
  const liste = [];
  for (const f of e.factures || []) {
    if (f.clientId !== clientId) continue;
    if (f.statut === 'reglee' || f.statut === 'attente') continue;
    const t = totaux(f, prixDe(e, clientId));
    if (t.reste > 0.005) { total += t.reste; liste.push({ facture: f, reste: t.reste }); }
  }
  return { total: Math.round(total * 100) / 100, factures: liste };
}

/** Tout ce qui reste à encaisser, tous clients confondus. */
export function encours(e) {
  let total = 0, retard = 0;
  const maintenant = Date.now();
  for (const f of e.factures || []) {
    if (f.statut === 'reglee' || f.statut === 'attente') continue;
    const t = totaux(f, prixDe(e, f.clientId));
    if (t.reste <= 0.005) continue;
    total += t.reste;
    if (f.echeanceLe && f.echeanceLe < maintenant) retard += t.reste;
  }
  return {
    total: Math.round(total * 100) / 100,
    retard: Math.round(retard * 100) / 100
  };
}

/** Le chiffre d'affaires facturé sur une période. */
export function chiffreAffaires(e, depuis, jusqua) {
  const a = depuis || 0, b = jusqua === undefined ? Date.now() : jusqua;
  let ht = 0, ttc = 0, nb = 0;
  for (const f of e.factures || []) {
    const quand = f.emiseLe || f.cree;
    if (!quand || quand < a || quand > b) continue;
    if (f.statut === 'attente') continue;      // pas encore une facture
    const t = totaux(f, prixDe(e, f.clientId));
    ht += t.ht; ttc += t.ttc; nb++;
  }
  return { ht: Math.round(ht * 100) / 100, ttc: Math.round(ttc * 100) / 100, nb };
}

/** Ce qui est prêt à partir en facturation : dossiers rendus, non facturés. */
export const aFacturer = (e) =>
  (e.dossiers || []).filter(d => !d.archive && d.etape === 'livre' && !d.factureId);

/* ==========================================================================
   LE PLANNING
   ========================================================================== */

export function creneauxDuJour(e, quand, userId) {
  const debut = jour0(quand);
  const fin = debut + JOUR;
  return (e.creneaux || [])
    .filter(c => c.debut < fin && c.fin > debut && (!userId || c.userId === userId))
    .sort(par('debut'));
}

export function creneauxDeLaSemaine(e, quand) {
  const debut = lundi(quand);
  const fin = plusJours(debut, 7);
  return (e.creneaux || []).filter(c => c.debut < fin && c.fin > debut).sort(par('debut'));
}

/** Les demandes de créneau venues du portail confrère, pas encore acceptées. */
export const demandesEnAttente = (e) => (e.creneaux || []).filter(c => c.demande && !c.fait);

/** Deux créneaux qui se chevauchent pour la même personne. */
export function chevauchements(e, creneau) {
  if (!creneau || !creneau.userId) return [];
  return (e.creneaux || []).filter(c =>
    c.id !== creneau.id
    && c.userId === creneau.userId
    && c.type !== 'absence'
    && c.debut < creneau.fin
    && c.fin > creneau.debut);
}

/** La charge d'une personne sur une journée, en minutes occupées. */
export function chargeDuJour(e, userId, quand) {
  return creneauxDuJour(e, quand, userId)
    .filter(c => c.type !== 'absence')
    .reduce((t, c) => t + Math.max(0, c.fin - c.debut) / 60000, 0);
}

/* ==========================================================================
   L'ÉLECTRONIQUE
   ========================================================================== */

export const soldeCredits = (e) => nombre(e.credits && e.credits.solde, 0);

export function creditsConsommes(e, depuis) {
  const a = depuis || 0;
  return (e.interventions || [])
    .filter(i => i.quand >= a && i.etat === 'ok')
    .reduce((t, i) => t + nombre(i.credits), 0);
}

export const interventionsRecentes = (e, n) =>
  (e.interventions || []).slice().sort(par('quand', 'desc')).slice(0, n || 20);

/* ==========================================================================
   CE QUI DEMANDE UNE ACTION
   Le tableau de bord ne montre pas des chiffres : il montre ce qu'il faut
   faire. Chaque alerte porte de quoi y aller directement.
   ========================================================================== */

export function alertes(e) {
  const r = e.reglages || {};
  const maintenant = Date.now();
  const sortie = [];

  /* --- devis sans réponse ------------------------------------------------ */
  const delai = nombre(r.relanceDevis, 4);
  for (const d of e.devis || []) {
    if (d.statut !== 'envoye' || !d.envoyeLe) continue;
    const jours = Math.round((maintenant - d.envoyeLe) / JOUR);
    if (jours >= delai) {
      sortie.push({
        cle: 'devis-' + d.id, ton: 'alerte', icone: 'devis',
        titre: 'Devis ' + d.numero + ' sans réponse',
        detail: 'Envoyé il y a ' + jours + ' jours',
        vers: '/devis/' + d.id, poids: 40 + jours
      });
    }
  }

  /* --- devis périmés ------------------------------------------------------ */
  for (const d of e.devis || []) {
    if (d.statut !== 'expire') continue;
    sortie.push({
      cle: 'perime-' + d.id, ton: 'neutre', icone: 'sablier',
      titre: 'Devis ' + d.numero + ' périmé',
      detail: 'Validité dépassée',
      vers: '/devis/' + d.id, poids: 20
    });
  }

  /* --- véhicules ventouses ------------------------------------------------ */
  const seuil = nombre(r.parcAlerteGrave, 21);
  for (const d of dossiersOuverts(e)) {
    if (!d.place) continue;
    const jours = joursDansAtelier(d);
    if (jours >= seuil) {
      const v = vehicule(e, d.vehiculeId);
      sortie.push({
        cle: 'parc-' + d.id, ton: 'danger', icone: 'parc',
        titre: (v ? nomVehicule(v) : 'Un véhicule') + ' immobilisé depuis ' + jours + ' jours',
        detail: 'Place ' + d.place,
        vers: '/dossier/' + d.id, poids: 60 + jours
      });
    }
  }

  /* --- impayés ------------------------------------------------------------- */
  for (const f of e.factures || []) {
    if (f.statut === 'reglee' || f.statut === 'attente') continue;
    if (!f.echeanceLe || f.echeanceLe > maintenant) continue;
    const t = totaux(f, prixDe(e, f.clientId));
    if (t.reste <= 0.005) continue;
    const jours = Math.round((maintenant - f.echeanceLe) / JOUR);
    sortie.push({
      cle: 'impaye-' + f.id, ton: 'danger', icone: 'euro',
      titre: 'Facture ' + f.numero + ' impayée',
      detail: jours + ' jours de retard',
      vers: '/facture/' + f.id, poids: 70 + Math.min(jours, 60)
    });
  }

  /* --- pièces manquantes ---------------------------------------------------- */
  const manque = piecesEnAlerte(e);
  if (manque.length) {
    sortie.push({
      cle: 'stock', ton: 'alerte', icone: 'stock',
      titre: manque.length === 1 ? 'Une pièce sous le seuil' : manque.length + ' pièces sous le seuil',
      detail: manque.slice(0, 3).map(p => p.libelle).join(', '),
      vers: '/stock?filtre=alerte', poids: 35
    });
  }

  /* --- crédits Autotuner ---------------------------------------------------- */
  const solde = soldeCredits(e);
  const seuilCredits = nombre(r.creditsAlerte, 5);
  if (solde <= seuilCredits) {
    sortie.push({
      cle: 'credits', ton: solde <= 0 ? 'danger' : 'alerte', icone: 'puce',
      titre: solde <= 0 ? 'Plus de crédits Autotuner' : 'Il reste ' + solde + ' crédits',
      detail: 'Pensez à recharger avant la prochaine reprogrammation',
      vers: '/electronique', poids: solde <= 0 ? 65 : 30
    });
  }

  /* --- demandes de confrères ------------------------------------------------ */
  const demandes = demandesEnAttente(e);
  if (demandes.length) {
    sortie.push({
      cle: 'demandes', ton: 'info', icone: 'pro',
      titre: demandes.length + (demandes.length > 1 ? ' demandes de créneau' : ' demande de créneau'),
      detail: 'Venues du portail professionnel',
      vers: '/planning?demandes=1', poids: 55
    });
  }

  /* --- appels à rappeler ----------------------------------------------------- */
  const rappels = (e.appels || []).filter(a => a.aRappeler && !a.traite);
  if (rappels.length) {
    sortie.push({
      cle: 'appels', ton: 'alerte', icone: 'telephone',
      titre: rappels.length + (rappels.length > 1 ? ' personnes à rappeler' : ' personne à rappeler'),
      detail: rappels.slice(0, 2).map(a => a.nom || a.tel).join(', '),
      vers: '/?appels=1', poids: 58
    });
  }

  /* --- à facturer -------------------------------------------------------------- */
  const facturable = aFacturer(e);
  if (facturable.length) {
    sortie.push({
      cle: 'afacturer', ton: 'accent', icone: 'facture',
      titre: facturable.length + (facturable.length > 1 ? ' dossiers à facturer' : ' dossier à facturer'),
      detail: 'Véhicules rendus, facture non établie',
      vers: '/factures?filtre=attente', poids: 50
    });
  }

  /* --- conflits de place ---------------------------------------------------------- */
  for (const c of conflitsParc(e)) {
    sortie.push({
      cle: 'conflit-' + c.place, ton: 'danger', icone: 'alerte',
      titre: 'Deux véhicules sur la place ' + c.place,
      detail: 'À corriger : le plan du parc est faux',
      vers: '/parc', poids: 75
    });
  }

  return sortie.sort((a, b) => b.poids - a.poids);
}

/* ==========================================================================
   RECHERCHE GÉNÉRALE
   Un seul champ, tout l'atelier dedans. On tape trois chiffres d'une plaque,
   un bout de nom, une référence de pièce — et on tombe dessus.
   ========================================================================== */

export function chercher(e, requete, options) {
  const o = options || {};
  const q = String(requete || '').trim();
  if (q.length < 1) return [];
  const limite = o.limite || 24;
  const resultats = [];

  const ajoute = (type, objet, texte, sous, vers, icone, bonus) => {
    const n = score(texte, q);
    if (n < 0) return;
    resultats.push({ type, objet, texte, sous, vers, icone, note: n + (bonus || 0) });
  };

  for (const c of e.clients || []) {
    if (c.archive && !o.archives) continue;
    const nom = nomClient(c);
    ajoute('client', c,
      [nom, c.tel, c.tel2, c.email, c.ville, c.societe].filter(Boolean).join(' '),
      c.type === 'pro' ? 'Professionnel' : [c.tel, c.ville].filter(Boolean).join(' · '),
      '/client/' + c.id, 'clients', 12);
  }

  for (const v of e.vehicules || []) {
    if (v.archive && !o.archives) continue;
    const prop = client(e, v.clientId);
    ajoute('vehicule', v,
      [v.immat, v.marque, v.modele, v.motorisation, v.vin, prop ? nomClient(prop) : ''].filter(Boolean).join(' '),
      [v.immat, prop ? nomClient(prop) : ''].filter(Boolean).join(' · '),
      '/vehicule/' + v.id, 'vehicule', 15);
  }

  for (const d of e.dossiers || []) {
    if (d.archive && !o.archives) continue;
    const v = vehicule(e, d.vehiculeId);
    ajoute('dossier', d,
      [d.numero, d.titre, d.demande, v ? v.immat : '', v ? nomVehicule(v) : ''].filter(Boolean).join(' '),
      [d.numero, v ? v.immat : ''].filter(Boolean).join(' · '),
      '/dossier/' + d.id, 'dossier', 10);
  }

  for (const p of e.pieces || []) {
    if (p.archive && !o.archives) continue;
    ajoute('piece', p,
      [p.ref, p.refFabricant, p.libelle, p.marque, p.emplacement, p.compatible, p.ean].filter(Boolean).join(' '),
      [p.emplacement, p.qte + ' en stock'].filter(Boolean).join(' · '),
      '/stock/' + p.id, 'stock', 8);
  }

  for (const d of e.devis || []) {
    ajoute('devis', d, [d.numero, d.objet].filter(Boolean).join(' '),
      'Devis', '/devis/' + d.id, 'devis', 6);
  }

  for (const f of e.factures || []) {
    ajoute('facture', f, [f.numero, f.numeroEbp].filter(Boolean).join(' '),
      'Facture', '/facture/' + f.id, 'facture', 6);
  }

  for (const p of e.prestations || []) {
    if (!p.actif) continue;
    ajoute('prestation', p, [p.code, p.libelle, p.famille].filter(Boolean).join(' '),
      'Tarif', '/tarifs?q=' + encodeURIComponent(p.libelle), 'tarifs', 2);
  }

  return resultats.sort((a, b) => b.note - a.note).slice(0, limite);
}

/** Filtre une liste sur une requête, sans classement : pour les écrans-listes. */
export function filtrer(liste, requete, champs) {
  const q = String(requete || '').trim();
  if (!q) return liste;
  return liste.filter(x => correspond(champs.map(c =>
    typeof c === 'function' ? c(x) : x[c]).filter(Boolean).join(' '), q));
}
