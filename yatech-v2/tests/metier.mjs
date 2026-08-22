/* ==========================================================================
   YATECH — vérifications du métier
   --------------------------------------------------------------------------
   À lancer avec :   node tests/metier.mjs

   Les règles qui coûtent de l'argent quand elles cèdent : le stock qu'on sort
   deux fois, les crédits débités en double, la place de parc occupée par deux
   voitures, le devis accepté qui écrase le travail en cours.

   Ces règles vivent dans domain/actions.js. Elles ne demandent pas de
   navigateur : c'est du raisonnement sur l'état, et ça se vérifie ici.
   ========================================================================== */

import { S } from '../js/core/store.js';
import * as act from '../js/domain/actions.js';
import * as lit from '../js/domain/selecteurs.js';
import { totaux } from '../js/domain/calculs.js';
import { ficheCalculateur, calculateursConnus, conseilAcces, cleCalculateur,
  controlesManquants, ecritDansLeBoitier, programmesFrequents } from '../js/domain/calculateurs.js';
import { neuf, normaliser, nouveauClient, nouveauVehicule, nouvellePiece } from '../js/domain/schema.js';

let passes = 0, echecs = 0;
const groupes = [];
let g = null;

function groupe(nom, fn) {
  g = { nom, lignes: [] };
  groupes.push(g);
  /* Chaque groupe repart d'un garage neuf : un test ne doit jamais dépendre
     de ce que le précédent a laissé derrière lui. */
  S.etat = normaliser(neuf());
  S.moi = { id: 'usr_essai', nom: 'Essai', prenom: 'Jean' };
  fn(monter());
}

function verifie(quoi, obtenu, attendu) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (ok) { passes++; g.lignes.push('  ✓ ' + quoi); }
  else {
    echecs++;
    g.lignes.push('  ✗ ' + quoi + '\n      attendu : ' + JSON.stringify(attendu)
      + '\n      obtenu  : ' + JSON.stringify(obtenu));
  }
}
const vrai = (quoi, v) => verifie(quoi, !!v, true);
const faux = (quoi, v) => verifie(quoi, !!v, false);

/** Un garage minimal mais complet : un client, un véhicule, une pièce. */
function monter() {
  const client = nouveauClient({ nom: 'Dupuis', prenom: 'Jean', grille: 'part' });
  const vehicule = nouveauVehicule({ clientId: client.id, immat: 'EJ456QT', marque: 'Peugeot', modele: '308' });
  const piece = nouvellePiece({ ref: 'FIL-1', libelle: 'Filtre à huile', qte: 5, qteMin: 2,
    prixAchat: 4, prixVente: 12, emplacement: 'R1-A-01' });
  S.etat.clients.push(client);
  S.etat.vehicules.push(vehicule);
  S.etat.pieces.push(piece);
  S.etat.utilisateurs.push({ id: 'usr_essai', nom: 'Essai', prenom: 'Jean', role: 'patron', actif: true, preferences: {} });
  return { client, vehicule, piece };
}

/* ==========================================================================
   LE STOCK
   ========================================================================== */

groupe('Sortir les pièces d’un dossier', ({ client, vehicule, piece }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'Révision' });
  act.ajouterPieceAuDossier(d.id, piece.id, 2);

  const r1 = act.servirDossier(d.id);
  verifie('deux pièces sorties', r1.sorties.length, 1);
  verifie('le stock a baissé', lit.piece(S.etat, piece.id).qte, 3);
  verifie('un mouvement est écrit', S.etat.mouvements.length, 1);
  verifie('le mouvement dit d’où à où', [S.etat.mouvements[0].avant, S.etat.mouvements[0].apres], [5, 3]);

  /* Le geste le plus dangereux : appuyer deux fois sur « sortir les pièces ». */
  const r2 = act.servirDossier(d.id);
  verifie('rien ne sort la deuxième fois', r2.sorties.length, 0);
  verifie('le stock n’a pas rebaissé', lit.piece(S.etat, piece.id).qte, 3);

  /* Rendre au stock ce qui n'a pas été monté. */
  const ligne = lit.dossier(S.etat, d.id).lignes[0];
  act.rendreAuStock(d.id, ligne.id);
  verifie('la pièce revient', lit.piece(S.etat, piece.id).qte, 5);
  faux('la ligne n’est plus marquée servie', lit.dossier(S.etat, d.id).lignes[0].sortieFaite);

  /* Et on peut la ressortir. */
  act.servirDossier(d.id);
  verifie('on peut resservir après un retour', lit.piece(S.etat, piece.id).qte, 3);
});

groupe('Le stock ne descend pas sous zéro', ({ piece }) => {
  const m = act.mouvementStock({ pieceId: piece.id, sens: 'sortie', qte: 99 });
  verifie('une sortie plus grande que le stock est refusée', m, null);
  verifie('le stock n’a pas bougé', lit.piece(S.etat, piece.id).qte, 5);

  act.mouvementStock({ pieceId: piece.id, sens: 'sortie', qte: 5 });
  verifie('on peut vider exactement', lit.piece(S.etat, piece.id).qte, 0);

  const inv = act.mouvementStock({ pieceId: piece.id, sens: 'inventaire', qte: 3 });
  verifie('l’inventaire pose la vérité', lit.piece(S.etat, piece.id).qte, 3);
  verifie('l’écart est enregistré', inv.qte, 3);
});

groupe('Servir un dossier quand le stock ne suffit pas', ({ client, vehicule, piece }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterPieceAuDossier(d.id, piece.id, 99);
  const r = act.servirDossier(d.id);
  verifie('rien n’est sorti', r.sorties.length, 0);
  verifie('le manque est signalé', r.manques.length, 1);
  verifie('avec le compte exact', [r.manques[0].demande, r.manques[0].dispo], [99, 5]);
  verifie('le stock est intact', lit.piece(S.etat, piece.id).qte, 5);
});

groupe('Ce qui est réservé mais pas encore sorti', ({ client, vehicule, piece }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterPieceAuDossier(d.id, piece.id, 2);
  verifie('deux pièces réservées', lit.reservations(S.etat).get(piece.id), 2);
  act.servirDossier(d.id);
  verifie('plus rien de réservé une fois sorti', lit.reservations(S.etat).get(piece.id), undefined);

  /* Un dossier rendu ne réserve plus rien, même si la sortie n'a pas été faite. */
  const d2 = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterPieceAuDossier(d2.id, piece.id, 1);
  verifie('un dossier ouvert réserve', lit.reservations(S.etat).get(piece.id), 1);
  act.changerEtape(d2.id, 'livre');
  verifie('un dossier rendu ne réserve plus', lit.reservations(S.etat).get(piece.id), undefined);
});

/* ==========================================================================
   LE PARC
   ========================================================================== */

groupe('Deux voitures ne tiennent pas sur une place', ({ client, vehicule }) => {
  const a = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'A' });
  const b = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'B' });

  vrai('la première se gare', act.garer(a.id, 'A1'));
  faux('la seconde est refusée', act.garer(b.id, 'A1'));
  verifie('elle n’a pas de place', lit.dossier(S.etat, b.id).place, null);
  verifie('le plan reste cohérent', lit.conflitsParc(S.etat).length, 0);

  /* Une fois la première partie, la place se libère. */
  act.changerEtape(a.id, 'livre');
  verifie('un véhicule rendu libère sa place', lit.dossier(S.etat, a.id).place, null);
  vrai('la seconde peut s’y garer', act.garer(b.id, 'A1'));
});

groupe('Le motif de parc suit l’étape', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.garer(d.id, 'B2');
  act.changerEtape(d.id, 'piece');
  verifie('attente de pièce', lit.dossier(S.etat, d.id).motifParc, 'piece');
  act.changerEtape(d.id, 'atelier');
  verifie('travaux en cours', lit.dossier(S.etat, d.id).motifParc, 'travaux');
  act.changerEtape(d.id, 'pret');
  verifie('prêt à rendre', lit.dossier(S.etat, d.id).motifParc, 'pret');
});

/* ==========================================================================
   LES DEVIS
   ========================================================================== */

groupe('Le cycle d’un devis', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'Freins' });
  act.ajouterLigne(d.id, { type: 'mo', libelle: 'Plaquettes avant', qte: 1, prixHT: 65 });

  const dv = act.creerDevis(d.id);
  verifie('le devis part en brouillon', dv.statut, 'brouillon');
  verifie('il porte une copie des lignes', dv.lignes.length, 1);
  verifie('c’est la version 1', dv.version, 1);

  /* La copie doit être franche : modifier le dossier ne doit pas réécrire un
     devis déjà établi. */
  act.ajouterLigne(d.id, { type: 'piece', libelle: 'Plaquettes', qte: 1, prixHT: 62 });
  verifie('le devis ne suit pas le dossier', lit.devis(S.etat, dv.id).lignes.length, 1);
  verifie('le dossier a bien deux lignes', lit.dossier(S.etat, d.id).lignes.length, 2);

  act.envoyerDevis(dv.id);
  verifie('envoyé', lit.devis(S.etat, dv.id).statut, 'envoye');
  verifie('le dossier passe en attente d’accord', lit.dossier(S.etat, d.id).etape, 'accord');

  act.accepterDevis(dv.id, { nom: 'Jean Dupuis' });
  verifie('accepté', lit.devis(S.etat, dv.id).statut, 'accepte');
  verifie('la signature est gardée', lit.devis(S.etat, dv.id).signature.nom, 'Jean Dupuis');
  verifie('le dossier reprend les lignes acceptées', lit.dossier(S.etat, d.id).lignes.length, 1);
  verifie('et passe en atelier', lit.dossier(S.etat, d.id).etape, 'atelier');
});

groupe('Une deuxième version de devis', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterLigne(d.id, { type: 'mo', libelle: 'Diagnostic', qte: 1, prixHT: 75 });
  const v1 = act.creerDevis(d.id);
  act.envoyerDevis(v1.id);
  act.refuserDevis(v1.id, 'Trop cher');
  verifie('refusé', lit.devis(S.etat, v1.id).statut, 'refuse');

  act.ajouterLigne(d.id, { type: 'mo', libelle: 'Remise commerciale', qte: 1, prixHT: -15 });
  const v2 = act.creerDevis(d.id);
  verifie('la version s’incrémente', v2.version, 2);
  verifie('les deux devis coexistent', lit.devisDuDossier(S.etat, d.id).length, 2);
  verifie('les numéros diffèrent', v1.numero !== v2.numero, true);
});

/* ==========================================================================
   LES FACTURES
   ========================================================================== */

groupe('Une facture ne se crée qu’une fois', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterLigne(d.id, { type: 'forfait', libelle: 'Révision', qte: 1, prixHT: 100 });

  const f1 = act.creerFacture(d.id);
  const f2 = act.creerFacture(d.id);
  verifie('la deuxième demande rend la même facture', f1.id, f2.id);
  verifie('une seule facture existe', S.etat.factures.length, 1);

  /* La facture est figée elle aussi. */
  act.ajouterLigne(d.id, { type: 'piece', libelle: 'Filtre', qte: 1, prixHT: 12 });
  verifie('la facture ne suit pas le dossier', lit.facture(S.etat, f1.id).lignes.length, 1);
});

groupe('Encaisser', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterLigne(d.id, { type: 'forfait', libelle: 'Révision', qte: 1, prixHT: 100 });
  const f = act.creerFacture(d.id);
  act.emettreFacture(f.id);
  const t0 = totaux(lit.facture(S.etat, f.id), lit.prixDe(S.etat, client.id));
  verifie('120 € TTC', t0.ttc, 120);

  act.encaisser(f.id, 50, 'cb');
  verifie('acompte', lit.facture(S.etat, f.id).statut, 'partiel');
  verifie('reste 70 €', totaux(lit.facture(S.etat, f.id), lit.prixDe(S.etat, client.id)).reste, 70);

  act.encaisser(f.id, 70, 'especes');
  verifie('soldée', lit.facture(S.etat, f.id).statut, 'reglee');
  verifie('reste 0', totaux(lit.facture(S.etat, f.id), lit.prixDe(S.etat, client.id)).reste, 0);

  /* Un remboursement : un règlement négatif rouvre la facture. */
  act.encaisser(f.id, -20, 'especes', 'Geste commercial');
  verifie('un avoir rouvre la facture', lit.facture(S.etat, f.id).statut, 'partiel');
  verifie('reste 20 €', totaux(lit.facture(S.etat, f.id), lit.prixDe(S.etat, client.id)).reste, 20);

  verifie('un règlement à zéro est ignoré', act.encaisser(f.id, 0, 'cb'), null);
});

groupe('Ce qu’un client doit', ({ client, vehicule }) => {
  const d = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id });
  act.ajouterLigne(d.id, { type: 'forfait', libelle: 'Révision', qte: 1, prixHT: 100 });
  const f = act.creerFacture(d.id);
  verifie('une facture non émise ne compte pas comme due',
    lit.duPar(S.etat, client.id).total, 0);
  act.emettreFacture(f.id);
  verifie('une fois émise, elle compte', lit.duPar(S.etat, client.id).total, 120);
  act.encaisser(f.id, 120, 'cb');
  verifie('soldée, elle ne compte plus', lit.duPar(S.etat, client.id).total, 0);
});

/* ==========================================================================
   LES CRÉDITS AUTOTUNER
   ========================================================================== */

groupe('Les crédits ne se débitent qu’une fois', ({ client, vehicule }) => {
  act.rechargerCredits(25, 750, 'Recharge');
  verifie('solde après recharge', lit.soldeCredits(S.etat), 25);
  verifie('le prix du crédit se déduit', S.etat.reglages.prixCredit, 30);

  const i = act.enregistrerIntervention({
    vehiculeId: vehicule.id, clientId: client.id,
    operation: 'ecriture', protocole: 'bench', credits: 2, etat: 'prevu'
  });
  verifie('une intervention prévue ne débite rien', lit.soldeCredits(S.etat), 25);

  act.terminerIntervention(i.id, 'ok');
  verifie('réussie, elle débite', lit.soldeCredits(S.etat), 23);

  /* Rouvrir puis refermer ne doit pas manger deux fois les crédits. */
  act.terminerIntervention(i.id, 'encours');
  act.terminerIntervention(i.id, 'ok');
  verifie('rouvrir puis refermer ne redébite pas', lit.soldeCredits(S.etat), 23);

  /* Une intervention enregistrée directement en « réussie » débite tout de suite. */
  act.enregistrerIntervention({ vehiculeId: vehicule.id, credits: 1, etat: 'ok' });
  verifie('une réussite immédiate débite', lit.soldeCredits(S.etat), 22);

  /* Corriger le nombre de crédits d'une intervention déjà réussie doit
     ajuster le solde de la différence, pas ne rien faire. */
  act.modifierIntervention(i.id, { credits: 3 });
  verifie('un crédit de plus est retiré', lit.soldeCredits(S.etat), 21);
  act.modifierIntervention(i.id, { credits: 1 });
  verifie('un crédit de moins est rendu', lit.soldeCredits(S.etat), 23);

  /* Une intervention qu'on requalifie en échec rend ses crédits : c'est
     l'enregistrement qui était faux. L'appareil, lui, garde le dernier mot
     par « Corriger le solde ». */
  act.terminerIntervention(i.id, 'echec');
  verifie('requalifiée en échec, elle rend ses crédits', lit.soldeCredits(S.etat), 24);
  act.terminerIntervention(i.id, 'ok');
  verifie('et les reprend si on la remet en réussite', lit.soldeCredits(S.etat), 23);

  act.ajusterCredits(19, 'Relevé sur l’appareil');
  verifie('la correction fait foi', lit.soldeCredits(S.etat), 19);
  verifie('et laisse une trace', S.etat.credits.historique.slice(-1)[0].sens, 'ajustement');
});

groupe('Un atelier qui ne compte pas ses crédits', ({ client, vehicule }) => {
  act.rechargerCredits(10, 300, 'Recharge');
  S.etat.reglages.suiviCredits = false;

  const i = act.enregistrerIntervention({
    vehiculeId: vehicule.id, clientId: client.id,
    operation: 'ecriture', protocole: 'bench', credits: 2, etat: 'ok'
  });
  verifie('le solde ne bouge plus', lit.soldeCredits(S.etat), 10);
  verifie('mais le nombre reste noté sur l’intervention', i.credits, 2);
  verifie('et l’alerte de solde bas se tait',
    lit.alertes(S.etat).filter(a => a.cle === 'credits').length, 0);

  /* Rallumé, le compteur reprend la main sans avoir rien perdu. */
  S.etat.reglages.suiviCredits = true;
  act.modifierIntervention(i.id, { credits: 2 });
  verifie('rallumé, il rattrape le retard', lit.soldeCredits(S.etat), 8);
});

/* ==========================================================================
   LA MÉMOIRE DES CALCULATEURS
   ========================================================================== */

groupe('Par où passe ce calculateur', ({ client, vehicule }) => {
  const poser = (o) => act.enregistrerIntervention(Object.assign({
    vehiculeId: vehicule.id, clientId: client.id,
    ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '', sw: '' }
  }, o));

  /* Le vécu de l'atelier : la lecture passe par la prise, l'écriture non. */
  poser({ operation: 'lecture',  protocole: 'obd',   etat: 'ok',    dureeMin: 20 });
  poser({ operation: 'lecture',  protocole: 'obd',   etat: 'ok',    dureeMin: 30 });
  poser({ operation: 'ecriture', protocole: 'obd',   etat: 'echec' });
  poser({ operation: 'ecriture', protocole: 'obd',   etat: 'echec' });
  poser({ operation: 'ecriture', protocole: 'bench', etat: 'ok',    dureeMin: 45, credits: 2,
    notes: 'Alim 12 V stable, sinon il décroche' });
  /* Une intervention seulement prévue n'apprend rien : elle n'a pas eu lieu. */
  poser({ operation: 'ecriture', protocole: 'boot',  etat: 'prevu' });

  const f = ficheCalculateur(S.etat, 'edc17-c64');
  vrai('l’orthographe n’empêche pas de retrouver le boîtier', !!f);
  verifie('les tentatives comptent, pas les intentions', f.nb, 5);
  verifie('la marque est retenue', f.marque, 'Bosch');

  const lecture = conseilAcces(f, 'lecture');
  verifie('la lecture passe par l’OBD', lecture.sure.protocole, 'obd');
  verifie('deux fois sur deux', lecture.sure.ok, 2);
  verifie('en 25 min environ', lecture.sure.minutesTypiques, 25);
  verifie('rien à éviter en lecture', lecture.echouees.length, 0);

  const ecriture = conseilAcces(f, 'ecriture');
  verifie('l’écriture passe par le bench', ecriture.sure.protocole, 'bench');
  verifie('pour deux crédits', ecriture.sure.creditsTypiques, 2);
  verifie('avec l’astuce de la dernière fois', ecriture.sure.astuce,
    'Alim 12 V stable, sinon il décroche');
  verifie('et l’OBD est à éviter', ecriture.echouees.map(v => v.protocole), ['obd']);
  verifie('il a coûté deux essais', ecriture.echouees[0].ko, 2);
  /* Le boot n'a jamais été tenté : on ne le déconseille pas, on se tait. */
  verifie('le boot jamais tenté n’apparaît pas', ecriture.voies.length, 2);

  verifie('rien à dire d’une opération jamais faite', conseilAcces(f, 'cle'), null);
  verifie('ni d’un boîtier jamais ouvert', ficheCalculateur(S.etat, 'MED17'), null);
  verifie('ni d’un type vide', ficheCalculateur(S.etat, '  '), null);

  /* Une intervention ouverte en modification ne doit pas se compter elle-même :
     sinon elle cite son propre accès comme s'il avait fait ses preuves. */
  const laBench = S.etat.interventions.find(x => x.protocole === 'bench' && x.etat === 'ok');
  const sansElle = ficheCalculateur(S.etat, 'EDC17C64', laBench.id);
  verifie('exclue, elle ne compte plus', sansElle.nb, f.nb - 1);
  verifie('et son accès n’est plus une preuve',
    (conseilAcces(sansElle, 'ecriture').sure || {}).protocole, undefined);
  verifie('les autres opérations ne bougent pas',
    conseilAcces(sansElle, 'lecture').sure.ok, 2);

  const connus = calculateursConnus(S.etat);
  verifie('un seul boîtier connu', connus.length, 1);
  verifie('les deux orthographes ne font qu’un', cleCalculateur('EDC17 C64'), 'EDC17C64');
});

groupe('Le déroulé qu’on ne saute pas', () => {
  verifie('une écriture écrit', ecritDansLeBoitier('ecriture'), true);
  verifie('un codage aussi', ecritDansLeBoitier('codage'), true);
  verifie('une lecture, non', ecritDansLeBoitier('lecture'), false);
  verifie('un diagnostic non plus', ecritDansLeBoitier('diagnostic'), false);

  /* Relever des défauts ne brique rien : on ne demande rien. */
  verifie('rien à cocher pour une lecture',
    controlesManquants({ operation: 'lecture', etat: 'ok', controles: {} }).length, 0);

  /* Une écriture réussie sans original sauvegardé : c'est LA chose à
     rattraper avant que la voiture reparte. */
  const nus = controlesManquants({ operation: 'ecriture', etat: 'ok', controles: {} });
  verifie('deux points clés manquent', nus.map(c => c.cle), ['origine', 'charge']);

  verifie('cochés, plus rien ne manque',
    controlesManquants({ operation: 'ecriture', etat: 'ok',
      controles: { origine: true, charge: true } }).length, 0);

  /* Un échec, on ne le sermonne pas : justement, ça n'a pas marché. */
  verifie('un échec ne réclame rien',
    controlesManquants({ operation: 'ecriture', etat: 'echec', controles: {} }).length, 0);

  /* Les cases secondaires ne bloquent pas : elles renseignent. */
  verifie('le checksum ne bloque pas',
    controlesManquants({ operation: 'ecriture', etat: 'ok',
      controles: { origine: true, charge: true } }).map(c => c.cle), []);
});

groupe('Ce que l’atelier programme', ({ client, vehicule }) => {
  const poser = (o) => act.enregistrerIntervention(Object.assign({
    vehiculeId: vehicule.id, clientId: client.id,
    ecu: { marque: 'Bosch', type: 'EDC17C64' }, operation: 'ecriture', protocole: 'bench'
  }, o));

  poser({ etat: 'ok', dureeMin: 50, modifications: ['stage1', 'egr'] });
  poser({ etat: 'ok', dureeMin: 60, modifications: ['stage1', 'fap'] });
  poser({ etat: 'ok', dureeMin: 40, modifications: ['stage1'] });
  /* Une tentative ratée ne compte pas comme un programme vendu. */
  poser({ etat: 'echec', dureeMin: 30, modifications: ['stage1', 'adblue'] });

  const top = programmesFrequents(S.etat);
  verifie('le Stage 1 arrive en tête', top[0].cle, 'stage1');
  verifie('trois fois, pas quatre', top[0].nb, 3);
  verifie('en cinquante minutes', top[0].minutesTypiques, 50);
  verifie('l’AdBlue raté n’est pas compté',
    top.filter(m => m.cle === 'adblue').length, 0);
  verifie('le retrait de FAP est marqué hors route',
    top.find(m => m.cle === 'fap').route, false);
  verifie('le Stage 1, non', top.find(m => m.cle === 'stage1').route, undefined);

  /* La fiche du boîtier retient aussi ce qu'on y a programmé. */
  const f = ficheCalculateur(S.etat, 'EDC17C64');
  verifie('le boîtier sait ce qu’on lui fait', f.modifications[0].cle, 'stage1');
  verifie('trois fois là aussi', f.modifications[0].nb, 3);

  /* Une clé inconnue ne doit pas polluer : le schéma la jette. */
  const sale = act.enregistrerIntervention({
    vehiculeId: vehicule.id, operation: 'ecriture', etat: 'ok',
    modifications: ['stage1', 'nawak', 'stage1']
  });
  const propre = normaliser(JSON.parse(JSON.stringify(S.etat)))
    .interventions.find(x => x.id === sale.id);
  verifie('les clés inventées sautent, les doublons aussi',
    propre.modifications, ['stage1']);
});

/* ==========================================================================
   LE MÉNAGE
   ========================================================================== */

groupe('Le ménage n’emporte pas le travail en cours', ({ client, vehicule }) => {
  const JOUR = 86400000;
  const enCours = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'En cours' });
  const vieux = act.ouvrirDossier({ clientId: client.id, vehiculeId: vehicule.id, titre: 'Vieux' });
  act.changerEtape(vieux.id, 'livre');
  /* On le vieillit de six mois. */
  vieux.sortie = Date.now() - 180 * JOUR;
  vieux.maj = vieux.sortie;

  act.poserCreneau({ userId: 'usr_essai', titre: 'Ancien', debut: Date.now() - 200 * JOUR,
    fin: Date.now() - 200 * JOUR + 3600000 });
  act.poserCreneau({ userId: 'usr_essai', titre: 'Demain', debut: Date.now() + JOUR,
    fin: Date.now() + JOUR + 3600000 });

  const bilan = act.menage({ jours: 90, dossiers: true });
  verifie('le créneau ancien est effacé', bilan.creneaux, 1);
  verifie('le créneau à venir reste', S.etat.creneaux.length, 1);
  verifie('le vieux dossier rendu est archivé', bilan.dossiers, 1);
  faux('le dossier en cours n’est pas archivé', lit.dossier(S.etat, enCours.id).archive);
  vrai('le vieux, si', lit.dossier(S.etat, vieux.id).archive);
});

/* ==========================================================================
   BILAN
   ========================================================================== */

for (const gr of groupes) {
  console.log('\n' + gr.nom);
  for (const l of gr.lignes) console.log(l);
}
console.log('\n' + '─'.repeat(56));
console.log(passes + ' vérifications passées, ' + echecs + ' en échec.');
process.exit(echecs ? 1 : 0);
