/* ==========================================================================
   YATECH — vérifications
   --------------------------------------------------------------------------
   À lancer avec :   node tests/verifs.mjs

   On ne vérifie pas l'affichage — ça se regarde. On vérifie ce qui coûte cher
   quand c'est faux : les montants, la TVA, les stocks, les dates. Un centime
   de travers sur une facture, c'est un appel du comptable ; un stock qui passe
   sous zéro, c'est une pièce qu'on croit avoir et qu'on n'a pas.
   ========================================================================== */

import * as calc from '../js/domain/calculs.js';
import * as util from '../js/core/util.js';
import { quand as fmtQuand } from '../js/core/fmt.js';
import { sha256, verrou, verifier } from '../js/core/crypto.js';
import { versCsv, depuisCsv, csvEnObjets } from '../js/core/fichiers.js';
import { normaliser, neuf, nouvelleLigne, prochainNumero } from '../js/domain/schema.js';
import { S, maj, annuler, refaire, peutAnnuler } from '../js/core/store.js';

let passes = 0, echecs = 0;
const groupes = [];
let groupeCourant = null;

function groupe(nom, fn) {
  groupeCourant = { nom, lignes: [] };
  groupes.push(groupeCourant);
  fn();
}

function verifie(quoi, obtenu, attendu) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (ok) { passes++; groupeCourant.lignes.push('  ✓ ' + quoi); }
  else {
    echecs++;
    groupeCourant.lignes.push('  ✗ ' + quoi + '\n      attendu : ' + JSON.stringify(attendu)
      + '\n      obtenu  : ' + JSON.stringify(obtenu));
  }
}

function vrai(quoi, valeur) { verifie(quoi, !!valeur, true); }

/* ==========================================================================
   LES NOMBRES ET LES DATES
   ========================================================================== */

groupe('Lecture des nombres tapés à la main', () => {
  verifie('virgule française', util.nombre('12,50'), 12.5);
  verifie('espaces de milliers', util.nombre('1 234,56'), 1234.56);
  verifie('symbole euro collé', util.nombre('89€'), 89);
  verifie('champ vide', util.nombre(''), 0);
  verifie('texte quelconque', util.nombre('abc', 7), 7);
  verifie('négatif', util.nombre('-15,5'), -15.5);
  verifie('déjà un nombre', util.nombre(3.14), 3.14);
  verifie('arrondi au centime', util.cts(0.1 + 0.2), 0.3);
  verifie('arrondi vers le haut', util.cts(2.345), 2.35);
});

groupe('Accord du pluriel', () => {
  verifie('un seul', util.pluriel(1, 'pièce'), '1 pièce');
  verifie('plusieurs', util.pluriel(3, 'pièce'), '3 pièces');
  verifie('zéro reste au singulier', util.pluriel(0, 'pièce'), '0 pièce');
  verifie('le groupe entier s’accorde', util.pluriel(34, 'prestation active'), '34 prestations actives');
  verifie('les petits mots ne s’accordent pas', util.pluriel(4, 'place de parking'), '4 places de parking');
  verifie('un mot déjà en s ne bouge pas', util.pluriel(2, 'devis envoyé'), '2 devis envoyés');
  verifie('créneau prend un x', util.pluriel(2, 'créneau libre'), '2 créneaux libres');
  verifie('journal fait journaux', util.pluriel(2, 'journal'), '2 journaux');
  verifie('pluriel irrégulier fourni', util.pluriel(2, 'travail', 'travaux'), '2 travaux');
  verifie('complément invariable', util.pluriel(3, 'dossier à facturer'), '3 dossiers à facturer');
  verifie('groupe long', util.pluriel(2, 'demande de créneau'), '2 demandes de créneau');
});

groupe('Immatriculations', () => {
  verifie('SIV en minuscules', util.plaqueJolie('ej456qt'), 'EJ-456-QT');
  verifie('SIV déjà formaté', util.plaqueJolie('EJ-456-QT'), 'EJ-456-QT');
  verifie('SIV avec espaces', util.plaqueJolie('EJ 456 QT'), 'EJ-456-QT');
  verifie('ancien format FNI', util.plaqueJolie('1234AB69'), '1234-AB-69');
  verifie('forme nue', util.plaqueNue('EJ-456-QT'), 'EJ456QT');
  vrai('SIV reconnu valide', util.plaqueValide('EJ-456-QT'));
  vrai('FNI reconnu valide', util.plaqueValide('123-ABC-45'));
  verifie('plaque farfelue refusée', util.plaqueValide('BONJOUR'), false);
});

groupe('Téléphones', () => {
  verifie('national vers international', util.telNu('06 12 34 56 78'), '+33612345678');
  verifie('déjà international', util.telNu('+33612345678'), '+33612345678');
  verifie('préfixe 00', util.telNu('0033612345678'), '+33612345678');
  verifie('affichage par paires', util.telJoli('0612345678'), '06 12 34 56 78');
  verifie('international réaffiché', util.telJoli('+33612345678'), '06 12 34 56 78');
});

groupe('Dates', () => {
  const d = new Date(2026, 2, 18, 14, 30).getTime();   // mercredi 18 mars 2026
  verifie('lundi de la semaine', new Date(util.lundi(d)).getDate(), 16);
  verifie('lundi reste lundi', new Date(util.lundi(new Date(2026, 2, 16).getTime())).getDate(), 16);
  verifie('dimanche appartient à sa semaine',
    new Date(util.lundi(new Date(2026, 2, 22).getTime())).getDate(), 16);
  /* Le 31 mars + 1 mois : février n'existe pas au 31. On ne doit pas déborder. */
  const fin = util.plusMois(new Date(2026, 0, 31).getTime(), 1);
  verifie('31 janvier + 1 mois = 28 février', [new Date(fin).getMonth(), new Date(fin).getDate()], [1, 28]);
  /* Le passage à l'heure d'été ne doit pas faire sauter un jour. */
  const avant = new Date(2026, 2, 28, 12, 0).getTime();
  verifie('un jour après le changement d’heure', new Date(util.plusJours(avant, 2)).getDate(), 30);
  verifie('heure en minutes', util.heureEnMinutes('08:30'), 510);
  /* Taper « 830 » au lieu de « 08:30 » est un geste courant au comptoir :
     on l'accepte plutôt que de faire retaper la personne. */
  verifie('heure sans deux-points', util.heureEnMinutes('830'), 510);
  verifie('heure avec un h', util.heureEnMinutes('8h30'), 510);
  verifie('heure ronde', util.heureEnMinutes('9'), 540);
  verifie('minutes en heure', util.minutesEnHeure(510), '08:30');
  verifie('heure invalide', util.heureEnMinutes('25:00'), null);
  verifie('aller-retour de date ISO',
    util.isoJour(util.depuisIsoJour('2026-03-18')), '2026-03-18');
});

groupe('Dates en clair', () => {
  const j = 86400000;
  verifie('demain', fmtQuand(Date.now() + j, { avecHeure: false }), 'demain');
  verifie('hier', fmtQuand(Date.now() - j, { avecHeure: false }), 'hier');
  verifie('la semaine passée', fmtQuand(Date.now() - 10 * j), 'il y a 1 sem.');
  /* Au-delà du mois on continue en mois : la date exacte est presque toujours
     affichée juste à côté, et « 27/02/26 (27/02/26) » n'apprend rien. */
  verifie('deux mois', fmtQuand(Date.now() - 60 * j), 'il y a 2 mois');
  verifie('un an et demi', fmtQuand(Date.now() - 540 * j), 'il y a un an');
  vrai('jamais la date brute au-delà du mois',
    !/\d{2}\/\d{2}/.test(fmtQuand(Date.now() - 200 * j)));
});

groupe('Recherche', () => {
  vrai('mots dans le désordre', util.correspond('Peugeot 308 BlueHDi', '308 peugeot'));
  vrai('sans accent', util.correspond('Citroën C3', 'citroen'));
  verifie('mot absent', util.correspond('Renault Clio', 'peugeot'), false);
  vrai('début de mot mieux noté', util.score('Dupuis', 'dup') > util.score('Grandupuis', 'dup'));
  verifie('rien trouvé', util.score('Renault', 'zzz'), -1);
  verifie('surlignage échappe le HTML',
    util.surligne('<script>x</script>', 'zzz'), '&lt;script&gt;x&lt;/script&gt;');
  vrai('surlignage marque le trouvé', util.surligne('Peugeot', 'peu').includes('<mark>Peu</mark>'));
});

/* ==========================================================================
   LES PRIX — le cœur du sujet
   ========================================================================== */

const REGLAGES = {
  tauxHoraire: 65, tauxHorairePro: 52, remiseProDefaut: 20,
  tauxTva: 20, tvaApplicable: true, margeDefaut: 30
};
const PART = calc.contexte(REGLAGES, { grille: 'part' });
const PRO = calc.contexte(REGLAGES, { grille: 'pro' });

groupe('Contexte de prix', () => {
  verifie('taux particulier', PART.taux, 65);
  verifie('taux professionnel', PRO.taux, 52);
  verifie('un client sans grille est un particulier', calc.contexte(REGLAGES, {}).grille, 'part');
  verifie('un client de type pro sans grille explicite suit la grille pro',
    calc.contexte(REGLAGES, { type: 'pro' }).grille, 'pro');
  verifie('franchise de TVA', calc.contexte({ tvaApplicable: false, tauxTva: 20 }, {}).tva, 0);
});

groupe('Prix d’une prestation', () => {
  const forfait = { type: 'forfait', temps: 1, prixHT: 189, prixPro: 159 };
  verifie('forfait particulier', calc.prixPrestation(forfait, PART), 189);
  verifie('forfait professionnel', calc.prixPrestation(forfait, PRO), 159);

  const sansPrixPro = { type: 'forfait', temps: 1, prixHT: 100, prixPro: 0 };
  verifie('sans prix pro, la remise générale s’applique', calc.prixPrestation(sansPrixPro, PRO), 80);

  const auTemps = { type: 'mo', temps: 2, prixHT: 0, prixPro: 0 };
  verifie('main-d’œuvre au temps, particulier', calc.prixPrestation(auTemps, PART), 130);
  verifie('main-d’œuvre au temps, professionnel', calc.prixPrestation(auTemps, PRO), 104);
});

groupe('Prix d’une pièce', () => {
  const p = { prixAchat: 20, prixVente: 50, prixVentePro: 40 };
  verifie('prix public', calc.prixPiece(p, PART), 50);
  verifie('prix confrère', calc.prixPiece(p, PRO), 40);
  verifie('sans prix confrère, remise générale',
    calc.prixPiece({ prixAchat: 20, prixVente: 50, prixVentePro: 0 }, PRO), 40);
  verifie('sans prix de vente, on propose l’achat majoré',
    calc.prixPiece({ prixAchat: 20, prixVente: 0 }, PART), 26);
  verifie('marge en euros et en taux', calc.marge(50, 20), { euros: 30, taux: 60 });
  verifie('prix conseillé', calc.prixConseille(20, 30), 26);
});

groupe('Une ligne', () => {
  const l = { type: 'mo', qte: 2, prixHT: 65, remise: 0 };
  verifie('sans remise', calc.ligneChiffree(l, PART),
    { brut: 130, remise: 0, ht: 130, tauxTva: 20, tva: 26, ttc: 156 });

  const avecRemise = { type: 'piece', qte: 1, prixHT: 100, remise: 10 };
  verifie('avec remise de 10 %', calc.ligneChiffree(avecRemise, PART),
    { brut: 100, remise: 10, ht: 90, tauxTva: 20, tva: 18, ttc: 108 });

  const tauxPropre = { type: 'piece', qte: 1, prixHT: 100, remise: 0, tva: 5.5 };
  verifie('taux de TVA propre à la ligne', calc.ligneChiffree(tauxPropre, PART).tva, 5.5);

  verifie('un sous-titre ne compte pas',
    calc.ligneChiffree({ type: 'titre', libelle: 'Mécanique' }, PART).ht, 0);

  /* Les centimes doivent tomber juste : 3 × 33,33 fait 99,99 et pas 99,99000000001 */
  verifie('trois fois 33,33', calc.ligneChiffree({ qte: 3, prixHT: 33.33 }, PART).ht, 99.99);
});

groupe('Le total d’un document', () => {
  const doc = {
    lignes: [
      nouvelleLigne({ type: 'titre', libelle: 'Mécanique' }),
      nouvelleLigne({ type: 'mo', qte: 2, prixHT: 65 }),
      nouvelleLigne({ type: 'piece', qte: 1, prixHT: 100, remise: 10 })
    ],
    remiseGlobale: 0
  };
  const t = calc.totaux(doc, PART);
  verifie('total hors taxes', t.ht, 220);
  verifie('TVA', t.tva, 44);
  verifie('total TTC', t.ttc, 264);
  verifie('remise de ligne comptée', t.remiseLignes, 10);
  verifie('le sous-titre n’est pas compté comme une ligne', t.nbLignes, 2);

  doc.remiseGlobale = 10;
  const t2 = calc.totaux(doc, PART);
  verifie('remise globale de 10 %', t2.remiseGlobale, 22);
  verifie('hors taxes après remise globale', t2.ht, 198);
  verifie('TTC après remise globale', t2.ttc, 237.6);
});

groupe('Deux taux de TVA dans le même document', () => {
  const doc = {
    lignes: [
      nouvelleLigne({ type: 'mo', qte: 1, prixHT: 100 }),              // 20 %
      nouvelleLigne({ type: 'piece', qte: 1, prixHT: 100, tva: 5.5 })  // 5,5 %
    ]
  };
  const t = calc.totaux(doc, PART);
  verifie('deux bases distinctes', t.detailTva.length, 2);
  verifie('TVA totale', t.tva, 25.5);
  verifie('les bases sont séparées',
    t.detailTva.map(x => [x.taux, x.base]), [[20, 100], [5.5, 100]]);

  /* La remise globale se répartit au prorata sur chaque base : sinon elle
     s'imputerait arbitrairement sur un taux plutôt que l'autre. */
  doc.remiseGlobale = 50;
  const t2 = calc.totaux(doc, PART);
  verifie('les deux bases baissent de moitié',
    t2.detailTva.map(x => x.base), [50, 50]);
  verifie('TVA après remise répartie', t2.tva, 12.75);
});

groupe('Franchise de TVA', () => {
  const sansTva = calc.contexte({ tauxTva: 20, tvaApplicable: false }, {});
  const t = calc.totaux({ lignes: [nouvelleLigne({ qte: 1, prixHT: 100 })] }, sansTva);
  verifie('aucune TVA', t.tva, 0);
  verifie('TTC égal au HT', t.ttc, 100);
});

groupe('Acomptes et règlements', () => {
  const f = {
    lignes: [nouvelleLigne({ qte: 1, prixHT: 100 })],
    reglements: [{ montant: 50 }, { montant: 30 }]
  };
  const t = calc.totaux(f, PART);
  verifie('déjà réglé', t.regle, 80);
  verifie('reste dû', t.reste, 40);
});

groupe('Marge d’un document', () => {
  const doc = {
    lignes: [
      nouvelleLigne({ type: 'mo', qte: 2, prixHT: 65 }),
      nouvelleLigne({ type: 'piece', qte: 1, prixHT: 100, pieceId: 'p1' })
    ]
  };
  const m = calc.margeDocument(doc, PART, [{ id: 'p1', prixAchat: 60 }]);
  verifie('chiffre de vente', m.vente, 230);
  verifie('coût des pièces', m.cout, 60);
  verifie('marge', m.marge, 170);
});

groupe('Vérification avant envoi', () => {
  const vide = calc.verifierDocument({ lignes: [] }, PART);
  vrai('un document vide est bloquant', vide.bloquant);

  const sansLibelle = calc.verifierDocument({
    lignes: [nouvelleLigne({ qte: 1, prixHT: 10, libelle: '' })]
  }, PART);
  vrai('une ligne sans désignation est bloquante', sansLibelle.bloquant);

  const zero = calc.verifierDocument({
    lignes: [nouvelleLigne({ qte: 1, prixHT: 0, libelle: 'Geste commercial' })]
  }, PART);
  verifie('une ligne à zéro avertit sans bloquer', zero.bloquant, false);
  vrai('… mais elle avertit', zero.soucis.some(s => s.gravite === 'avertissement'));
});

/* ==========================================================================
   LE MODÈLE
   ========================================================================== */

groupe('Normalisation d’un état', () => {
  const vide = normaliser({});
  vrai('les collections manquantes sont créées', Array.isArray(vide.clients));
  vrai('les réglages sont complétés', vide.reglages.tauxHoraire > 0);

  const abime = normaliser({
    clients: [{ id: 'c1', type: 'pro', societe: 'Garage X' }],
    dossiers: [{ id: 'd1', etape: 'inconnue', nature: 'nawak', place: 'A1' }],
    creneaux: [{ id: 'k1', debut: 1000, fin: 500 }],
    pieces: [{ id: 'p1', qte: 'beaucoup' }]
  });
  verifie('un client pro reçoit la grille pro', abime.clients[0].grille, 'pro');
  verifie('une étape inconnue retombe sur « reçu »', abime.dossiers[0].etape, 'accueil');
  verifie('une nature inconnue retombe sur mécanique', abime.dossiers[0].nature, 'meca');
  vrai('un créneau à l’envers reçoit une durée', abime.creneaux[0].fin > abime.creneaux[0].debut);
  verifie('une quantité illisible devient zéro', abime.pieces[0].qte, 0);

  /* Un dossier rendu ne peut pas occuper une place : le véhicule est parti. */
  const rendu = normaliser({ dossiers: [{ id: 'd2', etape: 'livre', place: 'B2' }] });
  verifie('un dossier rendu libère sa place', rendu.dossiers[0].place, null);

  /* Un devis envoyé dont la validité est passée devient périmé tout seul. */
  const perime = normaliser({
    devis: [{ id: 'v1', statut: 'envoye', valableJusquau: Date.now() - 86400000 }]
  });
  verifie('un devis dépassé devient périmé', perime.devis[0].statut, 'expire');
});

groupe('Numérotation', () => {
  const e = neuf();
  e.reglages.prefixeFacture = 'FA';
  const an = new Date().getFullYear();
  verifie('premier numéro', prochainNumero(e, 'facture'), 'FA-' + an + '-0001');
  verifie('le compteur avance', prochainNumero(e, 'facture'), 'FA-' + an + '-0002');

  /* Un numéro déjà émis ne doit jamais être réattribué : le compteur remonte
     au-dessus du plus grand numéro trouvé, même si les réglages disent moins. */
  const repris = normaliser({
    reglages: { prefixeFacture: 'FA', compteurFacture: 1 },
    factures: [{ id: 'f1', numero: 'FA-' + an + '-0042', statut: 'emise' }]
  });
  verifie('le compteur ne recule pas', repris.reglages.compteurFacture, 43);
});

/* ==========================================================================
   LES FICHIERS
   ========================================================================== */

groupe('CSV', () => {
  const texte = versCsv([['Nom', 'Ville'], ['Dupuis; fils', 'Lyon']]);
  vrai('point-virgule comme séparateur', texte.includes('Nom;Ville'));
  vrai('les cellules à risque sont protégées', texte.includes('"Dupuis; fils"'));
  vrai('marqueur d’ordre des octets en tête', texte.charCodeAt(0) === 0xFEFF);

  /* Un nom qui commence par = serait pris pour une formule par le tableur. */
  vrai('les formules sont neutralisées', versCsv([['=DUPONT']]).includes("'=DUPONT"));

  const relu = depuisCsv(texte);
  verifie('aller-retour', relu, [['Nom', 'Ville'], ['Dupuis; fils', 'Lyon']]);

  verifie('séparateur virgule deviné',
    depuisCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  verifie('guillemets doublés',
    depuisCsv('a;b\n"il dit ""oui""";2'), [['a', 'b'], ['il dit "oui"', '2']]);
  verifie('lignes vides ignorées', depuisCsv('a;b\n\n1;2').length, 2);
  verifie('en objets', csvEnObjets('Nom;Ville\nDupuis;Lyon'), [{ Nom: 'Dupuis', Ville: 'Lyon' }]);
});

/* ==========================================================================
   LES CODES D'ACCÈS
   ========================================================================== */

groupe('Empreintes', () => {
  verifie('vecteur connu (chaîne vide)', sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  verifie('vecteur connu (abc)', sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  verifie('les accents passent en UTF-8', sha256('é').length, 64);

  const v = verrou('1234');
  vrai('le bon code ouvre', verifier('1234', v));
  verifie('un mauvais code n’ouvre pas', verifier('1235', v), false);
  verifie('un verrou absent n’ouvre pas', verifier('1234', null), false);

  /* Deux personnes avec le même code doivent avoir deux empreintes différentes :
     sinon une table pré-calculée les ouvre toutes les deux d'un coup. */
  vrai('le sel rend les empreintes uniques', verrou('1234').emp !== verrou('1234').emp);
});

/* ==========================================================================
   LE MAGASIN — modifier, annuler, refaire
   ========================================================================== */

groupe('Modifications et annulation', () => {
  S.etat = neuf();
  S.moi = { id: 'u1', nom: 'Essai' };

  maj('Client créé', (e) => { e.clients.push({ id: 'c1', nom: 'Dupuis' }); });
  verifie('la modification est appliquée', S.etat.clients.length, 1);
  verifie('le geste est journalisé', S.etat.journal[S.etat.journal.length - 1].quoi, 'Client créé');
  vrai('on peut annuler', peutAnnuler());

  annuler();
  verifie('l’annulation remet l’état d’avant', S.etat.clients.length, 0);
  refaire();
  verifie('on peut refaire', S.etat.clients.length, 1);

  /* Une modification sans libellé — une lettre tapée dans une désignation —
     ne doit ni encombrer le journal ni photographier tout l'état. */
  const journalAvant = S.etat.journal.length;
  const annulablesAvant = peutAnnuler();
  maj(null, (e) => { e.clients[0].nom = 'Dupuis-Martin'; }, { journal: false });
  verifie('une frappe ne va pas au journal', S.etat.journal.length, journalAvant);
  verifie('une frappe ne s’annule pas séparément', peutAnnuler(), annulablesAvant);
  verifie('mais elle est bien appliquée', S.etat.clients[0].nom, 'Dupuis-Martin');

  /* Une modification qui casse en plein milieu ne doit rien laisser à moitié
     écrit : soit tout, soit rien. */
  const avant = JSON.stringify(S.etat.clients);
  let leve = false;
  try {
    maj('Modification bancale', (e) => {
      e.clients.push({ id: 'c2', nom: 'Perdu' });
      throw new Error('panne au milieu');
    });
  } catch (err) { leve = true; }
  vrai('l’erreur remonte à l’appelant', leve);
  verifie('l’état est remis comme avant', JSON.stringify(S.etat.clients), avant);
});

/* ==========================================================================
   BILAN
   ========================================================================== */

for (const g of groupes) {
  console.log('\n' + g.nom);
  for (const l of g.lignes) console.log(l);
}
console.log('\n' + '─'.repeat(56));
console.log(passes + ' vérifications passées, ' + echecs + ' en échec.');
process.exit(echecs ? 1 : 0);
