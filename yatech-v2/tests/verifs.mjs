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
/* Un document de poche, juste assez pour éprouver la fabrique d'éléments.
   Les écrans, eux, se testent dans un vrai navigateur ; ici on ne vérifie que
   la façon dont h() lit ses arguments. */
class NoeudEssai {
  constructor(nom) {
    this.tagName = String(nom).toUpperCase();
    this.id = '';
    /* Les propriétés que h() cherche sur un vrai élément : sans elles, il
       retomberait sur setAttribute et le test ne prouverait rien. */
    if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') {
      this.value = ''; this.checked = false; this.disabled = false;
      this.type = 'text'; this.spellcheck = true;
    }
    this.childNodes = [];
    this.attributs = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this._classes = [];
    this.classList = { add: (c) => this._classes.push(c) };
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v).split(/\s+/).filter(Boolean); }
  get firstChild() { return this.childNodes[0] || null; }
  get texteDedans() {
    return this.childNodes.map(n => n.donnee !== undefined ? n.donnee : n.texteDedans).join('');
  }
  appendChild(n) { this.childNodes.push(n); return n; }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); return n; }
  setAttribute(k, v) { this.attributs[k] = String(v); }
  getAttribute(k) { return this.attributs[k] === undefined ? null : this.attributs[k]; }
  addEventListener() {}
}
class TexteEssai { constructor(t) { this.donnee = String(t); } }
globalThis.Node = NoeudEssai;
globalThis.document = {
  createElement: (n) => new NoeudEssai(n),
  createTextNode: (t) => new TexteEssai(t),
  createDocumentFragment: () => new NoeudEssai('#frag'),
  addEventListener() {}
};

import { h } from '../js/core/dom.js';
import { normaliser, neuf, nouvelleLigne, prochainNumero, estUneSauvegarde,
  VERSION_MODELE } from '../js/domain/schema.js';
import { equipeDepart } from '../js/domain/demo.js';
import {
  ordreColonnes, colonnesVisibles, deuxColonnes, colonnes, blocVisible, rangees,
  raccourcisDe, BLOCS_COLONNES, CACHES_DORIGINE
} from '../js/domain/accueil.js';
import { reglagesDe, silencieux, aAnnoncer, vuesSuivantes } from '../js/core/veille.js';
import {
  preparerDemande, emballerDemande, deballerDemande, messageDemande, MARQUE
} from '../js/domain/demandePro.js';
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
function faux(quoi, valeur) { verifie(quoi, !!valeur, false); }

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

groupe('La fabrique d’éléments', () => {
  verifie('le sélecteur pose la balise', h('span').tagName, 'SPAN');
  verifie('et les classes', h('div.a.b').className, 'a b');
  verifie('l’identifiant aussi', h('div#x').id, 'x');

  /* Le deuxième argument omis : les enfants glissent à sa place. */
  verifie('un texte direct', h('b', 'salut').texteDedans, 'salut');
  verifie('un tableau direct', h('div', ['a', 'b']).texteDedans, 'ab');

  /* Le piège : des attributs conditionnels qui retombent sur null. Les
     enfants sont au troisième argument et doivent y rester. */
  verifie('des attributs nuls ne mangent pas les enfants',
    h('div', null, ['ici']).texteDedans, 'ici');
  verifie('des attributs présents non plus',
    h('div', { id: 'y' }, ['là']).texteDedans, 'là');
  verifie('et l’attribut est bien posé', h('div', { id: 'y' }, ['là']).id, 'y');

  /* Rien ne doit s'afficher pour un enfant absent : c'est ce qui permet
     d'écrire `condition ? h(...) : null` partout. */
  verifie('null, faux et undefined ne rendent rien',
    h('div', [null, false, undefined, 'reste']).texteDedans, 'reste');

  /* Un attribut booléen reçu en texte : « false » vaut faux. */
  verifie('spellcheck « false » est bien faux', h('input', { spellcheck: 'false' }).spellcheck, false);
});

groupe('L’accès à l’outil', () => {
  /* Un garage de trois personnes dans un atelier fermé ne tape pas un code
     pour lire son planning. Le code s'allume, il ne se subit pas. */
  verifie('aucun code demandé par défaut', neuf().reglages.demanderCode, false);
  verifie('l’équipe de départ part sans code',
    equipeDepart().filter(u => u.verrou).length, 0);

  /* Les installations d'avant demandaient un code, et celui qui l'oubliait
     restait dehors. La migration ouvre la porte une fois. */
  const ancienne = normaliser({
    version: 2, reglages: { demanderCode: true },
    clients: [], devis: [], dossiers: []
  });
  verifie('une installation d’avant est rouverte', ancienne.reglages.demanderCode, false);
  verifie('la version est enregistrée', ancienne.version, VERSION_MODELE);

  /* Mais celui qui rallume le code le garde : la migration ne repasse pas. */
  const rallume = normaliser({
    version: VERSION_MODELE, reglages: { demanderCode: true },
    clients: [], devis: [], dossiers: []
  });
  vrai('un code rallumé après coup reste allumé', rallume.reglages.demanderCode);
});

groupe('Des données abîmées n’empêchent pas d’ouvrir', () => {
  /* Un `null` égaré dans un tableau faisait planter la normalisation, donc le
     chargement, donc l'outil entier : le garage tombait sur l'écran de secours
     pour une virgule de trop dans un fichier de sauvegarde. */
  const sale = normaliser({
    version: 3,
    clients: [null, { id: 'c1', nom: 'Vrai' }, 'nawak', 42],
    vehicules: [null],
    utilisateurs: [null, { id: 'u1', prenom: 'Réel' }],
    creneaux: [null],
    devis: [{ id: 'd1', lignes: [null, 'x', { id: 'l1', qte: 2, prixHT: 10 }] }],
    factures: [{ id: 'f1', lignes: [null], reglements: [null] }],
    interventions: [{ id: 'i1', fichiers: [null, 'oups', { id: 'fi1', nom: 'a.bin' }] }],
    dossiers: [{ id: 'do1', lignes: [null], checklist: [null], notes: [null] }],
    credits: { solde: 0, historique: [null] }
  });
  verifie('le client valable survit seul', sale.clients.map(c => c.nom), ['Vrai']);
  verifie('les véhicules nuls disparaissent', sale.vehicules.length, 0);
  verifie('l’utilisateur valable reste', sale.utilisateurs.length, 1);
  verifie('les créneaux nuls aussi', sale.creneaux.length, 0);
  verifie('la ligne valable du devis reste', sale.devis[0].lignes.length, 1);
  verifie('les lignes de facture sont nettoyées', sale.factures[0].lignes.length, 0);
  verifie('les règlements aussi', sale.factures[0].reglements.length, 0);
  verifie('le fichier valable reste', sale.interventions[0].fichiers.map(f => f.nom), ['a.bin']);
  verifie('la checklist est nettoyée', sale.dossiers[0].checklist.length, 0);
  verifie('les notes aussi', sale.dossiers[0].notes.length, 0);
  verifie('l’historique de crédits aussi', sale.credits.historique.length, 0);

  /* Les étiquettes sont des mots, pas des fiches : on garde les mots. */
  const etiq = normaliser({ version: 3, clients: [{ id: 'c1', etiquettes: ['bon payeur', null, 7] }] });
  verifie('les étiquettes gardent leurs mots', etiq.clients[0].etiquettes, ['bon payeur']);
});

groupe('L’accueil de chacun', () => {
  const defaut = BLOCS_COLONNES.map(b => b.cle);
  verifie('sans préférence, l’ordre d’origine', ordreColonnes(null), defaut);
  /* L'accueil d'origine dépend de l'écran : tout sur un bureau, un panneau de
     moins sur un téléphone où chacun coûte un tiers d'écran. */
  verifie('tout est visible sur un bureau',
    colonnesVisibles(null, CACHES_DORIGINE.grand).length, defaut.length);
  verifie('les pièces attendues en font partie',
    colonnesVisibles(null, CACHES_DORIGINE.grand).includes('commandes'), true);
  verifie('un panneau de moins sur téléphone',
    colonnesVisibles(null, CACHES_DORIGINE.telephone).length, defaut.length - 1);
  verifie('et c’est celui qui redit les alertes',
    colonnesVisibles(null, CACHES_DORIGINE.telephone).includes('attente'), false);
  /* Qui a rangé son accueil décide, et sur les deux écrans. */
  verifie('un choix enregistré l’emporte sur l’écran',
    colonnesVisibles({ preferences: { accueil: { ordre: [], caches: [] } } },
      CACHES_DORIGINE.telephone).length, defaut.length);
  /* Une personne qui range son accueil décide, même si elle ne masque rien. */
  verifie('et qui masque, masque',
    colonnesVisibles({ preferences: { accueil: { ordre: [], caches: ['attente'] } } }).length,
    defaut.length - 1);
  verifie('et les raccourcis d’origine',
    raccourcisDe(null), ['dossier', 'appel', 'pensebete', 'planning']);

  /* Ce qui est enregistré n'est jamais cru sur parole : une sauvegarde plus
     ancienne peut porter un bloc disparu, un doublon, ou en oublier un. */
  const bancal = { preferences: { accueil: {
    ordre: ['appels', 'nawak', 'appels', 'journee'], caches: ['rendre', 'inconnu']
  } } };
  const range = ordreColonnes(bancal);
  verifie('les clés inventées sautent',range.includes('nawak'), false);
  verifie('les doublons aussi', range.filter(k => k === 'appels').length, 1);
  verifie('rien ne se perd', range.slice().sort().join(), defaut.slice().sort().join());
  verifie('ce qui était choisi passe devant', range.slice(0, 2), ['appels', 'journee']);
  /* Ce qui n'était pas rangé suit, dans l'ordre d'origine — à la fin, pour
     ne pas bousculer ce que la personne a arrangé. */
  verifie('le reste suit sans bousculer', range.slice(2),
    defaut.filter(k => k !== 'appels' && k !== 'journee'));

  verifie('un bloc masqué disparaît', blocVisible(bancal, 'rendre'), false);
  verifie('les autres restent', blocVisible(bancal, 'journee'), true);
  verifie('et il quitte la liste affichée', colonnesVisibles(bancal).includes('rendre'), false);

  /* La première moitié à gauche : c'est la seule règle qu'on puisse
     expliquer debout devant l'écran. */
  verifie('cinq panneaux : trois à gauche, deux à droite',
    deuxColonnes(['a', 'b', 'c', 'd', 'e']).map(c => c.length), [3, 2]);
  verifie('un seul panneau reste à gauche',
    deuxColonnes(['a']).map(c => c.length), [1, 0]);
  verifie('aucun ne casse rien', deuxColonnes([]).map(c => c.length), [0, 0]);

  /* Sur grand écran, trois colonnes. Découper en tranches égales laisserait
     la troisième vide avec quatre panneaux — et un grand blanc à droite. */
  verifie('quatre panneaux sur trois colonnes',
    colonnes(['a', 'b', 'c', 'd'], 3).map(c => c.length), [2, 1, 1]);
  verifie('cinq sur trois', colonnes(['a', 'b', 'c', 'd', 'e'], 3).map(c => c.length), [2, 2, 1]);
  verifie('un seul ne laisse pas deux vides derrière lui',
    colonnes(['a'], 3).map(c => c.length), [1, 0, 0]);
  verifie('l’ordre est respecté', colonnes(['a', 'b', 'c', 'd'], 3), [['a', 'b'], ['c'], ['d']]);
  verifie('une colonne, tout dedans', colonnes(['a', 'b'], 1), [['a', 'b']]);

  /* Tout masquer laisserait une barre de raccourcis vide, sans moyen d'en
     remettre : on garde le geste principal. */
  verifie('les raccourcis ne se vident jamais',
    raccourcisDe({ preferences: { raccourcis: [] } }), ['dossier']);
  verifie('un raccourci inventé est ignoré',
    raccourcisDe({ preferences: { raccourcis: ['parc', 'nawak'] } }), ['parc']);

  verifie('le rangement ne garde que des clés connues',
    rangees(['journee', 'nawak'], ['alertes', 'nawak']),
    { ordre: ['journee'], caches: ['alertes'] });
});

groupe('Être prévenu', () => {
  const garage = {
    notifs: {
      actives: true, son: false,
      quoi: { appels: true, rdv: true, pieces: true, paiement: true, devis: true, parc: true, credits: true },
      silenceActif: true, silenceDe: 19 * 60, silenceA: 7 * 60 + 30
    }
  };
  const a18h = new Date(2026, 5, 10, 18, 0).getTime();
  const a20h = new Date(2026, 5, 10, 20, 0).getTime();
  const a3h  = new Date(2026, 5, 10, 3, 0).getTime();
  const a8h  = new Date(2026, 5, 10, 8, 0).getTime();

  /* --- ce que chacun règle pour lui-même --------------------------------- */
  const brut = reglagesDe(garage, null);
  verifie('sans personne, les réglages du garage', brut.actives, true);

  const paulette = { preferences: { notifs: { son: true, quoi: { credits: false } } } };
  const sien = reglagesDe(garage, paulette);
  verifie('son réglage à elle l’emporte', sien.son, true);
  verifie('ce qu’elle n’a pas touché reste celui du garage', sien.actives, true);
  verifie('une famille refusée est refusée', sien.quoi.credits, false);
  verifie('les autres restent acceptées', sien.quoi.appels, true);

  /* --- la paix le soir ---------------------------------------------------- */
  faux('18 h, on peut déranger', silencieux(sien, a18h));
  vrai('20 h, non', silencieux(sien, a20h));
  vrai('3 h du matin, encore moins', silencieux(sien, a3h));
  faux('8 h, la journée commence', silencieux(sien, a8h));
  faux('sans plage de silence, jamais',
    silencieux({ silenceActif: false, silenceDe: 19 * 60, silenceA: 7 * 60 }, a3h));
  /* Une plage vide ne doit pas faire taire la journée entière. */
  faux('une plage de durée nulle ne bâillonne rien',
    silencieux({ silenceActif: true, silenceDe: 600, silenceA: 600 }, a18h));
  /* Une plage qui ne traverse pas minuit : la pause de midi. */
  const midi = { silenceActif: true, silenceDe: 12 * 60, silenceA: 14 * 60 };
  vrai('13 h dans la pause', silencieux(midi, new Date(2026, 5, 10, 13, 0).getTime()));
  faux('15 h hors de la pause', silencieux(midi, new Date(2026, 5, 10, 15, 0).getTime()));

  /* --- ce qu'on annonce --------------------------------------------------- */
  const liste = [
    { cle: 'appels', famille: 'appels', titre: 'Deux personnes à rappeler' },
    { cle: 'credits', famille: 'credits', titre: 'Plus de crédits' },
    { cle: 'impaye-1', famille: 'paiement', titre: 'Facture impayée' }
  ];
  verifie('éteint, on n’annonce rien',
    aAnnoncer(liste, [], reglagesDe({ notifs: { actives: false } }, null), a18h).length, 0);
  verifie('la nuit non plus', aAnnoncer(liste, [], sien, a3h).length, 0);

  const dit = aAnnoncer(liste, {}, sien, a18h);
  verifie('les familles acceptées passent', dit.map(a => a.cle), ['appels', 'impaye-1']);
  verifie('déjà annoncée, on se tait',
    aAnnoncer(liste, { appels: 2, credits: 1, 'impaye-1': 1 }, sien, a18h).length, 0);

  /* --- « ça a empiré », pas « je ne l'ai pas vue » ------------------------- */
  const appels = (n) => [{ cle: 'appels', famille: 'appels', nb: n, titre: n + ' à rappeler' }];
  verifie('un appel de plus, ça sonne',
    aAnnoncer(appels(3), { appels: 2 }, sien, a18h).length, 1);
  verifie('un appel traité, ça ne sonne pas',
    aAnnoncer(appels(1), { appels: 2 }, sien, a18h).length, 0);
  verifie('le même nombre non plus',
    aAnnoncer(appels(2), { appels: 2 }, sien, a18h).length, 0);
  /* Sans compte, une alerte pèse un : présente ou absente, rien entre les deux. */
  verifie('une alerte sans compte ne sonne qu’une fois',
    aAnnoncer([{ cle: 'impaye-1', famille: 'paiement', titre: 'x' }], { 'impaye-1': 1 }, sien, a18h).length, 0);

  /* On ne fait pas apparaître dix bulles d'un coup. */
  const dix = Array.from({ length: 10 }, (_, i) => ({ cle: 'x' + i, famille: 'appels', titre: 'x' }));
  verifie('trois bulles au plus d’un coup', aAnnoncer(dix, {}, sien, a18h).length, 3);

  /* Une famille inconnue — ajoutée par une mise à jour — passe quand même :
     mieux vaut un avertissement de trop qu'un impayé qu'on n'apprend pas. */
  verifie('une famille inconnue n’est pas filtrée',
    aAnnoncer([{ cle: 'z', famille: 'nouveaute', titre: 'x' }], {}, sien, a18h).length, 1);

  /* --- ce dont on se souvient --------------------------------------------- */
  const apres = vuesSuivantes(appels(3));
  verifie('on retient le compte du moment', apres.appels, 3);
  const oubli = vuesSuivantes([{ cle: 'appels', nb: 2 }]);
  verifie('une alerte réglée est oubliée', oubli['impaye-1'], undefined);
  verifie('pour pouvoir sonner de nouveau si elle revient',
    aAnnoncer([{ cle: 'impaye-1', famille: 'paiement', titre: 'x' }], oubli, sien, a18h).length, 1);
  /* Une salve entière est retenue, même si on n'en a annoncé que trois : le
     reste ne doit pas ressortir en gouttes au tour suivant. */
  verifie('toute la salve est retenue', Object.keys(vuesSuivantes(dix)).length, 10);
});

groupe('La demande d’un confrère fait l’aller-retour', () => {
  const demande = {
    clientId: 'cli_9', confrere: 'Garage du Pont',
    vehicule: 'Golf VII 2.0 TDI', immat: 'ab123cd',
    jour: Date.UTC(2026, 5, 15), heure: 9 * 60,
    tel: '04 78 00 11 22',
    texte: 'Le client se plaint d’un manque de puissance à froid.',
    prestations: [
      { code: 'REP-01', libelle: 'Stage 1 — cartographie moteur', prix: 290 },
      { code: 'REP-05', libelle: 'Retrait EGR', prix: 190 }
    ]
  };

  const range = preparerDemande(demande);
  verifie('le confrère est identifié', range.ci, 'cli_9');
  verifie('la plaque est rangée proprement', range.im, 'AB123CD');
  verifie('les prestations voyagent en clair', range.p.length, 2);
  verifie('avec leur prix', range.p[0][2], 290);
  /* Un texte de trois pages ne doit pas faire un code de trois pages. */
  const long = preparerDemande({ texte: 'x'.repeat(2000), prestations: [] });
  verifie('le texte est borné', long.t.length, 600);
  verifie('les prestations aussi',
    preparerDemande({ prestations: Array.from({ length: 50 }, () => ({ code: 'A' })) }).p.length, 20);

  /* --- le message que le confrère envoie vraiment ------------------------- */
  const texte = messageDemande({
    confrere: 'Garage du Pont', vehicule: 'Golf VII', immat: 'AB-123-CD',
    jourTexte: 'lundi 15 juin, 9 h', total: '480 € HT',
    prestations: [{ libelle: 'Stage 1', prix: '290 €' }, { libelle: 'Retrait EGR', prix: '190 €' }],
    texte: 'Manque de puissance à froid.', tel: '04 78 00 11 22'
  }, 'YATECH-RDV:zABC');
  vrai('le message se lit sans le code', texte.includes('Stage 1') && texte.includes('Golf VII'));
  vrai('le jour souhaité y est', texte.includes('lundi 15 juin'));
  vrai('et le code est à la fin', texte.trim().endsWith('YATECH-RDV:zABC'));
});

groupe('Reconnaître une sauvegarde', () => {
  /* Ce contrôle protège d'une perte de données : normaliser() est indulgent
     par nécessité et transformerait n'importe quoi en garage vide. */
  vrai('une vraie sauvegarde', estUneSauvegarde(neuf()));
  verifie('un tableau', estUneSauvegarde([1, 2, 3]), false);
  verifie('du texte', estUneSauvegarde('bonjour'), false);
  verifie('null', estUneSauvegarde(null), false);
  verifie('un objet quelconque', estUneSauvegarde({ a: 1 }), false);
  verifie('des réglages seuls', estUneSauvegarde({ reglages: {} }), false);
  verifie('deux collections ne suffisent pas',
    estUneSauvegarde({ reglages: {}, clients: [], devis: [] }), false);
  vrai('trois collections suffisent',
    estUneSauvegarde({ reglages: {}, clients: [], devis: [], dossiers: [] }));
  verifie('des collections qui n’en sont pas',
    estUneSauvegarde({ reglages: {}, clients: 'oui', devis: 3, dossiers: null }), false);
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
   LA GRILLE QUI VOYAGE
   Elle part dans l'adresse d'un lien pour s'ouvrir sur le téléphone d'un
   confrère, qui n'a rien de notre base. Si l'emballage se casse, il ne voit
   rien du tout — et il rappelle, ce qui était exactement le problème à régler.
   ========================================================================== */

const grilleDeDemo = async () => {
  const { preparerGrille, emballer, deballer, compteGrille } = await import('../js/domain/grille.js');
  const { jeuDemo } = await import('../js/domain/demo.js');
  const e = normaliser(jeuDemo());
  const pro = e.clients.find(c => c.type === 'pro');
  const part = e.clients.find(c => c.type === 'part' && c.grille !== 'pro');
  return { e, pro, part, preparerGrille, emballer, deballer, compteGrille };
};

groupe('Grille tarifaire transportable', () => { /* rempli plus bas, c'est asynchrone */ });

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

/* --- la grille, qui demande de l'asynchrone ------------------------------ */
{
  const { e, pro, part, preparerGrille, emballer, deballer, compteGrille } = await grilleDeDemo();
  groupeCourant = groupes.find(g => g.nom === 'Grille tarifaire transportable');

  const gPro = preparerGrille(e, pro);
  const gPart = preparerGrille(e, part);

  verifie('la grille confrère prend le taux confrère', gPro.th, e.reglages.tauxHorairePro);
  verifie('la grille particulier prend le taux public', gPart.th, e.reglages.tauxHoraire);
  vrai('les prix confrère sont plus bas', gPro.f[0][1][0][2] < gPart.f[0][1][0][2]);
  vrai('elle porte sa date', gPro.d > 0);
  verifie('elle nomme le destinataire', gPro.c, pro.societe || pro.nom);
  vrai('elle contient les prestations actives',
    compteGrille(gPro) === e.prestations.filter(p => p.actif).length);

  /* Rien d'interne ne doit se retrouver dans ce qui part chez le confrère. */
  const texte = JSON.stringify(gPro);
  verifie('aucun prix d’achat ne fuit', /prixAchat/.test(texte), false);
  verifie('aucune note interne ne fuit', /notes/.test(texte), false);
  verifie('aucun autre client ne fuit',
    e.clients.filter(c => c.id !== pro.id).some(c => texte.includes(c.nom || c.societe || 'zzz')), false);

  const paquet = await emballer(gPro);
  vrai('le paquet ne contient que des caractères sûrs pour une adresse',
    /^[zp][A-Za-z0-9_-]+$/.test(paquet));
  vrai('il tient dans un message (moins de 4000 caractères)', paquet.length < 4000);

  const relu = await deballer(paquet);
  vrai('le déballage rend la même grille', relu && JSON.stringify(relu) === JSON.stringify(gPro));

  verifie('un paquet tronqué est refusé', await deballer(paquet.slice(0, paquet.length - 30)), null);
  verifie('un paquet vide est refusé', await deballer(''), null);
  verifie('n’importe quel texte est refusé', await deballer('pbonjour'), null);
  verifie('une grille d’une version future est refusée',
    await deballer(await emballer(Object.assign({}, gPro, { v: 99 }))), null);
}

/* --- l'aller-retour d'une demande, asynchrone aussi ---------------------- */
{
  groupeCourant = groupes.find(g => g.nom === 'La demande d’un confrère fait l’aller-retour');

  const d = {
    clientId: 'cli_9', confrere: 'Garage du Pont', vehicule: 'Golf VII',
    immat: 'AB-123-CD', jour: Date.UTC(2026, 5, 15), heure: 9 * 60,
    texte: 'Manque de puissance à froid.', tel: '0478001122',
    prestations: [{ code: 'REP-01', libelle: 'Stage 1', prix: 290 }]
  };
  const code = await emballerDemande(d);
  vrai('le code s’annonce', code.startsWith(MARQUE));
  vrai('et ne contient que des caractères qu’un SMS ne casse pas',
    /^YATECH-RDV:[zp][A-Za-z0-9_-]+$/.test(code));
  vrai('il tient dans un message', code.length < 1200);

  const relu = await deballerDemande(code);
  verifie('le confrère est retrouvé', relu.ci, 'cli_9');
  verifie('le véhicule aussi', relu.ve, 'Golf VII');
  verifie('la prestation aussi', relu.p[0][1], 'Stage 1');

  /* Personne ne sélectionne proprement soixante caractères sur un téléphone :
     on doit retrouver le code dans le message entier, guillemets compris. */
  const messageEntier = messageDemande(Object.assign({}, d, { jourTexte: 'lundi 15 juin' }), code);
  const dansLeMessage = await deballerDemande(messageEntier);
  vrai('on le retrouve dans le message complet', dansLeMessage && dansLeMessage.ci === 'cli_9');
  const cite = '> ' + messageEntier.replace(/\n/g, '\n> ') + '\n\nrépondu depuis mon téléphone';
  const dansLaCitation = await deballerDemande(cite);
  vrai('même recopié dans une réponse citée', dansLaCitation && dansLaCitation.ci === 'cli_9');

  verifie('un texte sans code ne donne rien', await deballerDemande('bonjour, un rdv ?'), null);
  verifie('un code abîmé ne donne rien', await deballerDemande(MARQUE + 'zNAWAK!!'), null);
  verifie('une demande d’une version future est refusée',
    await deballerDemande(MARQUE + await (await import('../js/core/codec.js')).emballer({ v: 99, p: [] })), null);
}

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
