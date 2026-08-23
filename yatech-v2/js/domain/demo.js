/* ==========================================================================
   YATECH — jeu de démonstration
   --------------------------------------------------------------------------
   L'outil s'ouvre VIDE : c'est un atelier qui va y mettre ses vrais clients,
   pas une vitrine. Ce jeu-là se charge d'un bouton dans les réglages, pour
   voir à quoi ressemble un garage plein — et se vide du même bouton.

   Les données sont inventées mais plausibles : des vraies marques, des vraies
   pannes, des vrais délais. Un jeu de démonstration trop propre ne montre pas
   les cas qui font mal (le véhicule immobilisé depuis trois semaines, le devis
   sans réponse, la pièce à zéro).
   ========================================================================== */

import {
  nouveauClient, nouveauVehicule, nouveauDossier, nouvelleLigne, nouveauDevis,
  nouvelleFacture, nouvellePiece, nouveauFournisseur, nouvelUtilisateur,
  nouvellePrestation, nouvelleIntervention, nouvelAppel, neuf
} from './schema.js';
import { plusJours, jour0, lundi, id, JOUR, HEURE } from '../core/util.js';

/* Le planning de démonstration s'accroche à la SEMAINE en cours, pas à
   « aujourd'hui + n jours » : selon le jour où l'on ouvre l'outil, la moitié
   des rendez-vous tomberait le dimanche et disparaîtrait de l'écran.
   `j(1, 8.5)` = lundi de cette semaine, 8 h 30. */
const j = (jourSemaine, h) => lundi(Date.now()) + (jourSemaine - 1) * JOUR
  + (h === undefined ? 9 : h) * HEURE;
const ilYa = (n) => Date.now() - n * JOUR;
const dans = (n) => Date.now() + n * JOUR;

/* ==========================================================================
   LE CATALOGUE — il sert aussi de point de départ à un vrai garage
   ========================================================================== */

export function catalogueDepart() {
  const p = (code, libelle, famille, type, temps, prixHT, prixPro, extra) =>
    nouvellePrestation(Object.assign({ code, libelle, famille, type, temps, prixHT, prixPro }, extra));

  return [
    /* --- entretien courant ------------------------------------------------ */
    p('MEC-01', 'Vidange + filtre à huile',                  'Entretien', 'forfait', 0.5, 79,  69),
    p('MEC-02', 'Révision complète (vidange + 3 filtres)',    'Entretien', 'forfait', 1.5, 189, 159),
    p('MEC-03', 'Remplacement filtre habitacle',              'Entretien', 'forfait', 0.3, 39,  32),
    p('MEC-04', 'Plaquettes de frein avant (pose)',           'Freinage',  'mo',      1,   0,   0),
    p('MEC-05', 'Disques + plaquettes avant (pose)',          'Freinage',  'mo',      1.5, 0,   0),
    p('MEC-06', 'Purge circuit de freinage',                  'Freinage',  'forfait', 0.8, 69,  58),
    p('MEC-07', 'Kit de distribution + pompe à eau',          'Moteur',    'mo',      5,   0,   0),
    p('MEC-08', 'Remplacement embrayage',                     'Transmission','mo',    6,   0,   0),
    p('MEC-09', 'Remplacement amortisseurs (la paire)',       'Liaison au sol','mo',  2,   0,   0),
    p('MEC-10', 'Géométrie / parallélisme',                   'Liaison au sol','forfait', 1, 79, 65),
    p('MEC-11', 'Recharge climatisation + contrôle étanchéité','Climatisation','forfait',1, 95, 79),
    p('MEC-12', 'Nettoyage vanne EGR',                        'Moteur',    'mo',      2.5, 0,   0),
    p('MEC-13', 'Remplacement injecteur (l’unité, pose)',      'Moteur',    'mo',      1.5, 0,   0),
    p('MEC-14', 'Remplacement turbo',                         'Moteur',    'mo',      5,   0,   0),
    p('MEC-15', 'Recherche de fuite (moteur / circuit)',      'Moteur',    'mo',      1,   0,   0),

    /* --- électricité ------------------------------------------------------ */
    p('ELE-01', 'Diagnostic électronique complet',            'Électricité','forfait',1,   75,  62),
    p('ELE-02', 'Recherche de panne électrique',              'Électricité','mo',     1.5, 0,   0),
    p('ELE-03', 'Contrôle circuit de charge',                 'Électricité','forfait',0.5, 45,  38),
    p('ELE-04', 'Remplacement alternateur (pose)',            'Électricité','mo',     1.5, 0,   0),
    p('ELE-05', 'Remplacement démarreur (pose)',              'Électricité','mo',     1.5, 0,   0),
    p('ELE-06', 'Remplacement batterie + test de charge',     'Électricité','forfait',0.5, 39,  32),
    p('ELE-07', 'Réparation faisceau électrique',             'Électricité','mo',     2,   0,   0),
    p('ELE-08', 'Remplacement capteur (PMH, AAC, ABS…)',      'Électricité','mo',     1,   0,   0),

    /* --- électronique embarquée ------------------------------------------- */
    p('ECU-01', 'Lecture et sauvegarde du calculateur',       'Électronique','electro',1,  90,  70,  { credits: 1 }),
    p('ECU-02', 'Reprogrammation calculateur (OBD)',          'Électronique','electro',2,  290, 220, { credits: 1 }),
    p('ECU-03', 'Reprogrammation calculateur (bench / boot)', 'Électronique','electro',3,  390, 300, { credits: 2 }),
    p('ECU-04', 'Réparation matérielle de calculateur',       'Électronique','electro',3,  240, 190),
    p('ECU-05', 'Codage / adaptation d’organe neuf',          'Électronique','electro',1,  120, 95),
    p('ECU-06', 'Programmation de clé / antidémarrage',       'Électronique','electro',1.5,150, 120, { credits: 1 }),
    p('ECU-07', 'Remise à zéro compteurs après intervention', 'Électronique','electro',0.5, 55,  45),
    p('ECU-08', 'Sauvegarde EEPROM / lecture mémoire',        'Électronique','electro',1,  95,  75),

    /* --- prestations pour confrères ---------------------------------------- */
    p('PRO-01', 'Intervention électronique sur véhicule confrère','Confrères','electro',1, 0, 0,
      { detail: 'Déplacement non compris. Le véhicule reste sous la responsabilité du garage demandeur.' }),
    p('PRO-02', 'Diagnostic pour compte de confrère',         'Confrères','forfait', 1,  0,   55),
    p('PRO-03', 'Forfait déplacement atelier confrère',       'Confrères','frais',   0,  0,   45)
  ];
}

/* ==========================================================================
   L'ÉQUIPE PAR DÉFAUT — trois personnes, comme dans l'atelier
   ========================================================================== */

/* Personne ne part avec un code : inventer un code d'usine, c'est livrer un
   atelier fermé à clé avec la clé écrite dans le mode d'emploi. Chacun pose le
   sien quand il le décide, dans Réglages → Équipe. */
export function equipeDepart() {
  return [
    nouvelUtilisateur({ id: 'usr_patron', prenom: 'Yanis', nom: 'B.', role: 'patron', couleur: 38 }),
    nouvelUtilisateur({ id: 'usr_tech', prenom: 'Karim', nom: 'M.', role: 'technicien', couleur: 200 }),
    nouvelUtilisateur({ id: 'usr_sec', prenom: 'Sophie', nom: 'L.', role: 'secretariat', couleur: 320 })
  ];
}

/* ==========================================================================
   LE JEU COMPLET
   ========================================================================== */

export function jeuDemo() {
  const e = neuf();

  e.reglages = Object.assign(e.reglages, {
    raisonSociale: 'Garage Yatech',
    formeJuridique: 'SARL',
    adresse: '12 rue des Ateliers',
    cp: '69100',
    ville: 'Villeurbanne',
    tel: '04 78 00 00 00',
    email: 'contact@yatech-garage.fr',
    siret: '812 345 678 00019',
    tvaIntra: 'FR12812345678',
    tauxHoraire: 68,
    tauxHorairePro: 54,
    remiseProDefaut: 18,
    /* Quatre rangées de six : la rangée D accueille les véhicules qui dorment,
       et le jeu de démonstration en a besoin pour montrer une ventouse. */
    parcColonnes: 6,
    parcRangees: 4,
    nomsRangees: { A: 'Devant l’atelier', B: 'Côté portail', C: 'Sous abri', D: 'Fond de cour' },
    typesPlaces: { A1: 'pont', A2: 'pont', C1: 'couvert', C2: 'couvert', C3: 'couvert', D6: 'hs' },
    demoChargee: true
  });

  e.utilisateurs = equipeDepart();
  /* Le jeu de démonstration donne des coordonnées à l'équipe : sans elles,
     « Prévenir quelqu'un » n'a rien à montrer. Un garage neuf, lui, part sans
     — on n'invente pas le numéro de portable de quelqu'un. */
  const joignables = [
    { tel: '06 11 22 33 44', email: 'yanis@garage-yatech.fr' },
    { tel: '06 55 66 77 88', email: 'karim@garage-yatech.fr' },
    { tel: '06 99 88 77 66', email: 'sophie@garage-yatech.fr' }
  ];
  e.utilisateurs.forEach((u, i) => Object.assign(u, joignables[i] || {}));
  e.prestations = catalogueDepart();
  e.credits = {
    solde: 12,
    historique: [
      { id: id('cre'), quand: ilYa(46), sens: 'entree', n: 25, solde: 25, cout: 750, motif: 'Recharge Autotuner' },
      { id: id('cre'), quand: ilYa(20), sens: 'sortie', n: 1, solde: 24, motif: 'EDC17C10' },
      { id: id('cre'), quand: ilYa(12), sens: 'sortie', n: 2, solde: 22, motif: 'MED17.5.2 bench' },
      { id: id('cre'), quand: ilYa(4),  sens: 'sortie', n: 1, solde: 12, motif: 'SID807EVO' }
    ]
  };

  /* --- fournisseurs ------------------------------------------------------- */
  const f1 = nouveauFournisseur({ nom: 'Autodistribution', tel: '04 72 00 11 22', delaiJours: 1, compte: 'AD-4471' });
  const f2 = nouveauFournisseur({ nom: 'Oscaro', site: 'oscaro.com', delaiJours: 2 });
  const f3 = nouveauFournisseur({ nom: 'Doyen Auto', tel: '04 78 33 44 55', delaiJours: 1, remise: 22 });
  const f4 = nouveauFournisseur({ nom: 'Casse Rhône Auto', tel: '04 74 55 66 77', delaiJours: 3,
    notes: 'Pièces d’occasion, garanties 3 mois.' });
  e.fournisseurs = [f1, f2, f3, f4];

  /* --- clients ------------------------------------------------------------ */
  /* Les clients ne sont pas tous arrivés le même jour, et la plupart existent
     déjà dans EBP : sans ça, l'écran EBP annonce dix fiches à reporter alors
     qu'un garage installé n'en a qu'une ou deux en retard. */
  let ancienneteClient = 900;
  const cli = (champs) => {
    const c = nouveauClient(champs);
    ancienneteClient -= 60 + Math.floor(Math.random() * 50);
    c.cree = ilYa(Math.max(2, ancienneteClient));
    c.maj = ilYa(Math.max(1, Math.floor(ancienneteClient / 3)));
    if (c.codeEbp) c.ebp = c.cree + 2 * JOUR;
    e.clients.push(c);
    return c;
  };

  const c1 = cli({ type: 'part', civilite: 'M.', prenom: 'Jean-Marc', nom: 'Dupuis', tel: '0612345678',
    email: 'jm.dupuis@example.fr', adresse: '4 allée des Tilleuls', cp: '69100', ville: 'Villeurbanne',
    codeEbp: 'DUPUIS001' });
  const c2 = cli({ type: 'part', civilite: 'Mme', prenom: 'Nadia', nom: 'Belkacem', tel: '0678901234',
    email: 'n.belkacem@example.fr', cp: '69003', ville: 'Lyon', codeEbp: 'BELKACE002' });
  const c3 = cli({ type: 'pro', societe: 'Garage du Pont',
    siret: '442 111 222 00033', tel: '0472889900', email: 'contact@garagedupont.fr',
    adresse: '88 avenue de la République', cp: '69150', ville: 'Décines',
    grille: 'pro', remise: 0, codeEbp: 'GARPONT003',
    notes: 'Confrère mécanique. Nous confie toute l’électronique. Facturation mensuelle.' });
  const c4 = cli({ type: 'pro', societe: 'AutoPlus Décines',
    tel: '0478112233', email: 'atelier@autoplus-decines.fr', cp: '69150', ville: 'Décines',
    grille: 'pro', remise: 5, codeEbp: 'AUTOPLU004',
    notes: 'Remise supplémentaire 5 % négociée sur le volume.' });
  const c5 = cli({ type: 'part', civilite: 'M.', prenom: 'Thomas', nom: 'Rivière', tel: '0699887766',
    cp: '69100', ville: 'Villeurbanne', codeEbp: 'RIVIERE005' });
  const c6 = cli({ type: 'part', civilite: 'Mme', prenom: 'Claire', nom: 'Fontaine', tel: '0644556677',
    email: 'claire.fontaine@example.fr', cp: '69120', ville: 'Vaulx-en-Velin', codeEbp: 'FONTAIN006' });
  const c7 = cli({ type: 'pro', societe: 'Transports Meyzieu',
    tel: '0472334455', cp: '69330', ville: 'Meyzieu', grille: 'pro',
    notes: 'Flotte de 9 utilitaires. Entretien groupé.', codeEbp: 'TRANSPO007' });
  const c8 = cli({ type: 'part', civilite: 'M.', prenom: 'Ali', nom: 'Khaled', tel: '0655443322',
    cp: '69008', ville: 'Lyon', codeEbp: 'KHALED008' });
  const c9 = cli({ type: 'part', civilite: 'M.', prenom: 'Bernard', nom: 'Petit', tel: '0611223344',
    cp: '69100', ville: 'Villeurbanne', grille: 'pro', remise: 0,
    notes: 'Ancien collègue : tarif confrère à titre personnel.', codeEbp: 'PETIT009' });
  const c10 = cli({ type: 'part', civilite: 'Mme', prenom: 'Sylvie', nom: 'Marchand', tel: '0688776655',
    cp: '69200', ville: 'Vénissieux' });
  /* Deux fiches ouvertes cette semaine, pas encore passées dans EBP : c'est
     exactement ce que la passerelle doit rattraper. */
  c10.cree = ilYa(3); c10.ebp = null;
  c8.ebp = null; c8.cree = ilYa(6);

  /* --- véhicules ---------------------------------------------------------- */
  const veh = (champs) => {
    const v = nouveauVehicule(champs);
    const prop = e.clients.find(c => c.id === v.clientId);
    /* Un véhicule est enregistré au premier passage de son propriétaire. */
    v.cree = prop ? prop.cree + JOUR : ilYa(200);
    v.maj = v.cree;
    e.vehicules.push(v);
    return v;
  };

  const v1 = veh({ clientId: c1.id, immat: 'EJ456QT', marque: 'Peugeot', modele: '308',
    motorisation: '1.6 BlueHDi 120', energie: 'diesel', boite: 'manuelle', annee: 2017,
    dateMec: new Date(2017, 4, 12).getTime(), km: 168400, kmReleveLe: ilYa(3), couleur: 'Gris Artense',
    vin: 'VF3LBBHZHHS123456', ecu: { marque: 'Bosch', type: 'EDC17C60', hw: '0281031234', sw: '1037551234', protocole: 'obd' } });
  const v2 = veh({ clientId: c2.id, immat: 'FT789AB', marque: 'Renault', modele: 'Clio IV',
    motorisation: '1.5 dCi 90', energie: 'diesel', annee: 2015, km: 212300, kmReleveLe: ilYa(10),
    ecu: { marque: 'Continental', type: 'SID807EVO', protocole: 'obd' } });
  const v3 = veh({ clientId: c5.id, immat: 'AB123CD', marque: 'Volkswagen', modele: 'Golf VII',
    motorisation: '2.0 TDI 150', energie: 'diesel', annee: 2016, km: 143900,
    ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210',
      protocole: 'bench' } });
  const v4 = veh({ clientId: c6.id, immat: 'DR951KL', marque: 'Citroën', modele: 'C3',
    motorisation: '1.2 PureTech 82', energie: 'essence', annee: 2018, km: 74200 });
  const v5 = veh({ clientId: c8.id, immat: 'GH246MN', marque: 'BMW', modele: 'Série 3 (F30)',
    motorisation: '320d 184', energie: 'diesel', annee: 2014, km: 236800,
    ecu: { marque: 'Bosch', type: 'EDC17C50', protocole: 'bench' } });
  const v6 = veh({ clientId: c10.id, immat: 'BX357PQ', marque: 'Dacia', modele: 'Sandero',
    motorisation: '1.0 SCe 75', energie: 'essence', annee: 2019, km: 51200 });
  const v7 = veh({ clientId: c9.id, immat: 'CV852RS', marque: 'Audi', modele: 'A4 (B8)',
    motorisation: '2.0 TDI 143', energie: 'diesel', annee: 2012, km: 289000,
    ecu: { marque: 'Bosch', type: 'EDC17CP14', protocole: 'boot' } });
  /* Deux véhicules confiés par des confrères : ils appartiennent au garage
     demandeur le temps de l'intervention. */
  const v8 = veh({ clientId: c3.id, immat: 'EK741TU', marque: 'Mercedes', modele: 'Classe A (W176)',
    motorisation: '180 CDI', energie: 'diesel', annee: 2015, km: 179000,
    notes: 'Véhicule d’un client du Garage du Pont.',
    ecu: { marque: 'Delphi', type: 'CRD2', protocole: 'bench' } });
  const v9 = veh({ clientId: c4.id, immat: 'FF159GH', marque: 'Ford', modele: 'Focus',
    motorisation: '1.5 TDCi 120', energie: 'diesel', annee: 2017, km: 132400,
    notes: 'Confié par AutoPlus pour reprogrammation.' });
  const v10 = veh({ clientId: c7.id, immat: 'DK963VW', marque: 'Renault', modele: 'Master',
    motorisation: '2.3 dCi 145', energie: 'diesel', annee: 2018, km: 198700,
    notes: 'Utilitaire n°4 de la flotte.' });

  /* --- pièces en stock ----------------------------------------------------- */
  const pie = (champs) => { const p = nouvellePiece(champs); e.pieces.push(p); return p; };

  const stock = [
    ['FIL-H-001', 'Filtre à huile Purflux LS932',   'Filtration', 'R1-A-01', 6, 2, 4.20, 11.90, 'PSA 1.6 HDi / BlueHDi'],
    ['FIL-H-002', 'Filtre à huile Mann HU7008z',    'Filtration', 'R1-A-02', 3, 2, 7.80, 19.90, 'VAG 2.0 TDI EA288'],
    ['FIL-A-001', 'Filtre à air Bosch F026400374',  'Filtration', 'R1-A-04', 2, 2, 9.40, 24.50, 'Renault 1.5 dCi'],
    ['FIL-C-001', 'Filtre habitacle charbon actif', 'Filtration', 'R1-B-01', 8, 3, 6.10, 18.90, 'Universel PSA'],
    ['FIL-G-001', 'Filtre à gazole Purflux C594',   'Filtration', 'R1-B-02', 0, 2, 12.30, 29.90, 'PSA 1.6 HDi'],
    ['FRE-P-001', 'Plaquettes avant Bosch BP1234',  'Freinage',   'R2-A-01', 4, 2, 26.50, 62.00, 'Peugeot 308 II'],
    ['FRE-P-002', 'Plaquettes arrière ATE',         'Freinage',   'R2-A-02', 1, 2, 22.00, 54.00, 'Golf VII'],
    ['FRE-D-001', 'Disques avant ventilés 302mm',   'Freinage',   'R2-B-01', 2, 1, 48.00, 118.00, 'Ford Focus III'],
    ['FRE-L-001', 'Liquide de frein DOT4 1L',       'Freinage',   'R2-C-01', 5, 2, 4.90, 13.50, 'Universel'],
    ['MOT-H-001', 'Huile 5W30 C2 bidon 5L',         'Lubrifiants','R3-A-01', 7, 3, 24.00, 58.00, 'PSA / Renault'],
    ['MOT-H-002', 'Huile 5W30 504/507 bidon 5L',    'Lubrifiants','R3-A-02', 4, 2, 32.00, 74.00, 'VAG'],
    ['MOT-H-003', 'Huile 0W20 bidon 1L',            'Lubrifiants','R3-A-03', 3, 2, 12.50, 29.00, 'Hybrides récents'],
    ['MOT-C-001', 'Courroie accessoires 6PK1080',   'Moteur',     'R3-B-02', 2, 1, 14.20, 36.00, 'PSA'],
    ['MOT-K-001', 'Kit distribution Gates K015603XS','Moteur',    'R3-C-01', 1, 1, 96.00, 235.00, 'VAG 2.0 TDI'],
    ['MOT-P-001', 'Pompe à eau Hepu P546',          'Moteur',     'R3-C-02', 1, 1, 42.00, 105.00, 'VAG 2.0 TDI'],
    ['ELE-B-001', 'Batterie 12V 70Ah 640A',         'Électricité','R4-A-01', 3, 2, 68.00, 149.00, 'Universel'],
    ['ELE-B-002', 'Batterie 12V 60Ah 540A',         'Électricité','R4-A-02', 2, 2, 54.00, 119.00, 'Universel'],
    ['ELE-A-001', 'Alternateur reconditionné 150A', 'Électricité','R4-B-01', 1, 0, 145.00, 320.00, 'PSA 1.6 HDi',
      { etat: 'reconditionne' }],
    ['ELE-D-001', 'Démarreur Valeo TS12E',          'Électricité','R4-B-02', 0, 1, 118.00, 265.00, 'Renault 1.5 dCi'],
    ['ELE-C-001', 'Capteur PMH Bosch 0261210170',   'Électricité','R4-C-01', 3, 1, 21.00, 55.00, 'VAG / PSA'],
    ['ELE-C-002', 'Sonde lambda universelle 4 fils','Électricité','R4-C-02', 2, 1, 34.00, 82.00, 'Universel'],
    ['ELE-F-001', 'Boîte de fusibles maxi assortis','Électricité','R4-D-01', 12, 4, 0.60, 2.50, 'Universel'],
    ['ELE-G-001', 'Gaine thermorétractable (lot)',  'Électricité','R4-D-02', 5, 2, 3.20, 9.00, 'Universel'],
    ['SUS-A-001', 'Amortisseurs avant Monroe (paire)','Liaison au sol','R5-A-01', 1, 1, 88.00, 210.00, 'Clio IV'],
    ['SUS-R-001', 'Rotule de direction',            'Liaison au sol','R5-A-03', 4, 2, 16.50, 44.00, 'PSA'],
    ['SUS-S-001', 'Silent-bloc de triangle',        'Liaison au sol','R5-B-01', 6, 2, 11.00, 32.00, 'Renault'],
    ['CLI-G-001', 'Gaz R134a bouteille 12kg',       'Climatisation','R6-A-01', 1, 1, 190.00, 0, 'Consommable atelier'],
    ['CLI-G-002', 'Gaz R1234yf bouteille 5kg',      'Climatisation','R6-A-02', 1, 1, 460.00, 0, 'Consommable atelier'],
    ['CON-N-001', 'Nettoyant frein aérosol 500ml',  'Consommables','R7-A-01', 9, 4, 2.90, 8.50, 'Atelier'],
    ['CON-D-001', 'Dégrippant 400ml',               'Consommables','R7-A-02', 6, 3, 3.40, 9.90, 'Atelier'],
    ['CON-J-001', 'Joints cuivre vidange (lot 50)', 'Consommables','R7-B-01', 2, 1, 8.00, 0, 'Atelier — refacturé dans le forfait'],
    ['CON-G-001', 'Gants nitrile (boîte 100)',      'Consommables','R7-B-02', 4, 2, 7.50, 0, 'Atelier'],
    ['ECU-S-001', 'Support calculateur bench',      'Électronique','R8-A-01', 2, 1, 45.00, 0, 'Outillage'],
    ['ECU-F-001', 'Faisceau bench EDC17 universel', 'Électronique','R8-A-02', 1, 1, 210.00, 0, 'Outillage'],
    ['ECU-T-001', 'Transpondeur clé ID46 vierge',   'Électronique','R8-B-01', 5, 2, 6.00, 28.00, 'PSA / Renault'],
    ['ECU-T-002', 'Coque de clé 3 boutons PSA',     'Électronique','R8-B-02', 3, 2, 8.50, 32.00, 'Peugeot / Citroën'],
    ['OCC-P-001', 'Rétroviseur droit occasion 308', 'Occasion',   'R9-A-01', 1, 0, 35.00, 95.00, 'Peugeot 308 II',
      { etat: 'occasion' }],
    ['OCC-C-001', 'Calculateur EDC17C60 occasion',  'Occasion',   'R9-A-02', 1, 0, 120.00, 340.00, 'PSA — à coder',
      { etat: 'occasion' }]
  ];

  const piecesCreees = stock.map(([ref, libelle, famille, emplacement, qte, qteMin, prixAchat, prixVente, compatible, extra]) =>
    pie(Object.assign({
      ref, libelle, famille, emplacement, qte, qteMin, prixAchat, prixVente, compatible,
      fournisseurId: famille === 'Occasion' ? f4.id : (famille === 'Électronique' ? f2.id : f1.id),
      inventorieLe: ilYa(120 + Math.floor(Math.random() * 60)),
      /* Un stock « créé à l'instant » sur toutes les références trahit la
         démonstration : on l'étale sur les deux dernières années. */
      cree: ilYa(180 + Math.floor(Math.random() * 540)),
      maj: ilYa(Math.floor(Math.random() * 40))
    }, extra || {})));

  const parRef = (r) => piecesCreees.find(p => p.ref === r);

  /* --- dossiers ------------------------------------------------------------ */
  let numero = 1;
  const dos = (champs) => {
    const d = nouveauDossier(Object.assign({
      numero: 'OR-' + new Date().getFullYear() + '-' + String(numero++).padStart(4, '0')
    }, champs));
    /* Un dossier créé « à l'instant » alors qu'il est entré il y a huit jours
       trahit la démonstration : les fils d'événements deviennent absurdes. */
    if (d.entree) { d.cree = d.entree; d.maj = Math.min(Date.now(), d.entree + 3600000); }
    e.dossiers.push(d);
    return d;
  };
  const L = (champs) => nouvelleLigne(champs);

  /* 1 — reçu ce matin, rien de fait */
  dos({
    clientId: c6.id, vehiculeId: v4.id, titre: 'Voyant moteur allumé',
    nature: 'electro', etape: 'accueil', priorite: 'normale',
    demande: 'Voyant moteur orange depuis hier, la voiture broute au démarrage à froid.',
    entree: ilYa(0), place: 'A1', motifParc: 'attente', kmEntree: 74200,
    assignes: ['usr_tech']
  });

  /* 2 — diagnostic en cours */
  dos({
    clientId: c1.id, vehiculeId: v1.id, titre: 'Perte de puissance + fumée',
    nature: 'mixte', etape: 'diag', priorite: 'urgent',
    demande: 'Se met en mode dégradé sur autoroute. Fumée noire à l’accélération.',
    constat: 'Défaut P2002 mémorisé. Contre-pression anormale. Vanne EGR très encrassée.',
    entree: ilYa(1), place: 'A2', motifParc: 'travaux', kmEntree: 168400,
    assignes: ['usr_patron', 'usr_tech'],
    lignes: [
      L({ type: 'forfait', ref: 'ELE-01', libelle: 'Diagnostic électronique complet', qte: 1, prixHT: 75 })
    ],
    checklist: [
      { id: id('chk'), texte: 'Lecture des défauts', fait: true, quand: ilYa(1) },
      { id: id('chk'), texte: 'Contrôle contre-pression', fait: true, quand: ilYa(1) },
      { id: id('chk'), texte: 'Dépose vanne EGR', fait: false }
    ]
  });

  /* 3 — devis à faire */
  const d3 = dos({
    clientId: c5.id, vehiculeId: v3.id, titre: 'Distribution + embrayage',
    nature: 'meca', etape: 'devis', priorite: 'normale',
    demande: 'Bruit de courroie et pédale d’embrayage qui patine.',
    constat: 'Distribution à faire (143 900 km). Disque d’embrayage en fin de vie.',
    entree: ilYa(2), place: 'B1', motifParc: 'attente', kmEntree: 143900,
    assignes: ['usr_patron'],
    lignes: [
      L({ type: 'mo', ref: 'MEC-07', libelle: 'Kit de distribution + pompe à eau', qte: 5, unite: 'h', prixHT: 68 }),
      L({ type: 'piece', ref: 'MOT-K-001', libelle: 'Kit distribution Gates K015603XS', qte: 1, prixHT: 235,
          pieceId: parRef('MOT-K-001') ? parRef('MOT-K-001').id : null }),
      L({ type: 'piece', ref: 'MOT-P-001', libelle: 'Pompe à eau Hepu P546', qte: 1, prixHT: 105,
          pieceId: parRef('MOT-P-001') ? parRef('MOT-P-001').id : null }),
      L({ type: 'mo', ref: 'MEC-08', libelle: 'Remplacement embrayage', qte: 6, unite: 'h', prixHT: 68 }),
      L({ type: 'piece', libelle: 'Kit embrayage Valeo 826704', qte: 1, prixHT: 289 })
    ]
  });

  /* 4 — devis envoyé, sans réponse depuis six jours */
  const d4 = dos({
    clientId: c8.id, vehiculeId: v5.id, titre: 'Turbo + injecteurs',
    nature: 'meca', etape: 'accord', priorite: 'normale',
    demande: 'Sifflement à l’accélération, consommation en hausse.',
    constat: 'Jeu axial du turbo hors tolérance. Injecteur n°3 hors débit de retour.',
    entree: ilYa(8), place: 'B2', motifParc: 'attente', kmEntree: 236800,
    assignes: ['usr_patron'],
    lignes: [
      L({ type: 'mo', ref: 'MEC-14', libelle: 'Remplacement turbo', qte: 5, unite: 'h', prixHT: 68 }),
      L({ type: 'piece', libelle: 'Turbo échange standard Garrett', qte: 1, prixHT: 690 }),
      L({ type: 'mo', ref: 'MEC-13', libelle: 'Remplacement injecteur (pose)', qte: 1.5, unite: 'h', prixHT: 68 }),
      L({ type: 'piece', libelle: 'Injecteur Bosch échange standard', qte: 1, prixHT: 245,
          /* Accord donné, rien de commandé : c'est le coup de fil du matin. */
          commande: 'a_commander' })
    ]
  });

  /* 5 — attente de pièce */
  dos({
    clientId: c2.id, vehiculeId: v2.id, titre: 'Démarreur HS',
    nature: 'mixte', etape: 'piece', priorite: 'normale',
    demande: 'Ne démarre plus, un clac au contact.',
    constat: 'Démarreur hors service. Commandé chez Doyen, livraison demain.',
    entree: ilYa(3), place: 'B3', motifParc: 'piece', kmEntree: 212300,
    assignes: ['usr_tech'],
    lignes: [
      L({ type: 'mo', ref: 'ELE-05', libelle: 'Remplacement démarreur (pose)', qte: 1.5, unite: 'h', prixHT: 68 }),
      L({ type: 'piece', ref: 'ELE-D-001', libelle: 'Démarreur Valeo TS12E', qte: 1, prixHT: 265,
          pieceId: parRef('ELE-D-001') ? parRef('ELE-D-001').id : null,
          /* Commandée hier chez Doyen, annoncée pour demain : le dossier sait
             ce qu'il attend, et de qui. */
          commande: 'commandee', fournisseurId: f3.id,
          commandeLe: ilYa(1), attendueLe: dans(1) })
    ]
  });

  /* 6 — en atelier, travail d'un confrère */
  const d6 = dos({
    clientId: c3.id, vehiculeId: v8.id, titre: 'Reprogrammation calculateur (bench)',
    nature: 'electro', etape: 'atelier', priorite: 'normale',
    demande: 'Le Garage du Pont nous confie le véhicule pour intervention sur calculateur.',
    constat: 'Calculateur CRD2 déposé. Lecture faite, sauvegarde d’origine conservée.',
    entree: ilYa(1), place: 'C1', motifParc: 'travaux', kmEntree: 179000,
    assignes: ['usr_patron'],
    lignes: [
      L({ type: 'electro', ref: 'ECU-03', libelle: 'Reprogrammation calculateur (bench / boot)', qte: 1, prixHT: 300 }),
      L({ type: 'electro', ref: 'ECU-01', libelle: 'Lecture et sauvegarde du calculateur', qte: 1, prixHT: 70 })
    ],
    checklist: [
      { id: id('chk'), texte: 'Dépose du calculateur', fait: true, quand: ilYa(1) },
      { id: id('chk'), texte: 'Lecture + sauvegarde origine', fait: true, quand: ilYa(1) },
      { id: id('chk'), texte: 'Écriture', fait: false },
      { id: id('chk'), texte: 'Repose + essai', fait: false }
    ]
  });

  /* 7 — essai en cours */
  dos({
    clientId: c10.id, vehiculeId: v6.id, titre: 'Révision + freins avant',
    nature: 'meca', etape: 'controle', priorite: 'normale',
    entree: ilYa(1), place: 'C2', motifParc: 'travaux', kmEntree: 51200,
    assignes: ['usr_tech'],
    lignes: [
      L({ type: 'forfait', ref: 'MEC-02', libelle: 'Révision complète (vidange + 3 filtres)', qte: 1, prixHT: 189, fait: true }),
      L({ type: 'mo', ref: 'MEC-04', libelle: 'Plaquettes de frein avant (pose)', qte: 1, unite: 'h', prixHT: 68, fait: true }),
      L({ type: 'piece', ref: 'FRE-P-001', libelle: 'Plaquettes avant Bosch BP1234', qte: 1, prixHT: 62,
          pieceId: parRef('FRE-P-001') ? parRef('FRE-P-001').id : null, sortieFaite: true, fait: true })
    ]
  });

  /* 8 — prêt à rendre */
  const d8 = dos({
    clientId: c4.id, vehiculeId: v9.id, titre: 'Reprogrammation + codage',
    nature: 'electro', etape: 'pret', priorite: 'normale',
    entree: ilYa(2), place: 'C3', motifParc: 'pret', kmEntree: 132400, kmSortie: 132410,
    assignes: ['usr_patron'],
    lignes: [
      L({ type: 'electro', ref: 'ECU-02', libelle: 'Reprogrammation calculateur (OBD)', qte: 1, prixHT: 220, fait: true }),
      L({ type: 'electro', ref: 'ECU-05', libelle: 'Codage / adaptation d’organe neuf', qte: 1, prixHT: 95, fait: true })
    ]
  });

  /* 9 — véhicule ventouse : trois semaines sur le parc */
  dos({
    clientId: c9.id, vehiculeId: v7.id, titre: 'Devis refusé — véhicule non repris',
    nature: 'meca', etape: 'accord', priorite: 'basse',
    demande: 'Ne démarre plus. Le client hésite à réparer vu le kilométrage.',
    constat: 'Pompe haute pression HS. Devis à 1 480 € refusé pour l’instant.',
    entree: ilYa(24), place: 'D1', motifParc: 'gros', kmEntree: 289000,
    lignes: [
      L({ type: 'mo', libelle: 'Remplacement pompe haute pression', qte: 6, unite: 'h', prixHT: 54 }),
      L({ type: 'piece', libelle: 'Pompe HP Bosch échange standard', qte: 1, prixHT: 890 })
    ]
  });

  /* 10 — rendu, à facturer */
  const d10 = dos({
    clientId: c7.id, vehiculeId: v10.id, titre: 'Entretien flotte — Master n°4',
    nature: 'meca', etape: 'livre', priorite: 'normale',
    entree: ilYa(6), sortie: ilYa(4), kmEntree: 198700, kmSortie: 198740,
    assignes: ['usr_tech'],
    lignes: [
      L({ type: 'forfait', ref: 'MEC-02', libelle: 'Révision complète (vidange + 3 filtres)', qte: 1, prixHT: 159, fait: true }),
      L({ type: 'forfait', ref: 'MEC-10', libelle: 'Géométrie / parallélisme', qte: 1, prixHT: 65, fait: true }),
      L({ type: 'piece', libelle: 'Jeu de balais d’essuie-glace', qte: 1, prixHT: 24, fait: true })
    ]
  });

  /* --- devis --------------------------------------------------------------- */
  const dv1 = nouveauDevis({
    numero: 'DV-' + new Date().getFullYear() + '-0001',
    dossierId: d4.id, clientId: c8.id, vehiculeId: v5.id,
    statut: 'envoye', lignes: d4.lignes.map(l => Object.assign({}, l)),
    objet: 'Turbo + injecteur', emisLe: ilYa(7), envoyeLe: ilYa(6), cree: ilYa(7), maj: ilYa(6),
    valableJusquau: plusJours(ilYa(7), 30)
  });
  const dv2 = nouveauDevis({
    numero: 'DV-' + new Date().getFullYear() + '-0002',
    dossierId: d6.id, clientId: c3.id, vehiculeId: v8.id,
    statut: 'accepte', lignes: d6.lignes.map(l => Object.assign({}, l)),
    objet: 'Intervention calculateur', emisLe: ilYa(2), envoyeLe: ilYa(2), repondeLe: ilYa(1), cree: ilYa(2), maj: ilYa(1),
    valableJusquau: plusJours(ilYa(2), 30),
    signature: { nom: 'Garage du Pont', quand: ilYa(1) }
  });
  const dv3 = nouveauDevis({
    numero: 'DV-' + new Date().getFullYear() + '-0003',
    dossierId: d3.id, clientId: c5.id, vehiculeId: v3.id,
    statut: 'brouillon', lignes: d3.lignes.map(l => Object.assign({}, l)),
    objet: 'Distribution + embrayage', emisLe: Date.now(),
    valableJusquau: plusJours(Date.now(), 30)
  });
  e.devis.push(dv1, dv2, dv3);
  d4.devisIds = [dv1.id];
  d6.devisIds = [dv2.id];
  d3.devisIds = [dv3.id];

  /* --- factures ------------------------------------------------------------- */
  const fa1 = nouvelleFacture({
    numero: 'FA-' + new Date().getFullYear() + '-0001',
    dossierId: d10.id, clientId: c7.id, vehiculeId: v10.id,
    statut: 'emise', lignes: d10.lignes.map(l => Object.assign({}, l)),
    emiseLe: ilYa(4), echeanceLe: plusJours(ilYa(4), 30), cree: ilYa(4), maj: ilYa(4),
    numeroEbp: 'FC2600184', ebp: ilYa(4)
  });
  const fa2 = nouvelleFacture({
    numero: 'FA-' + new Date().getFullYear() + '-0002',
    dossierId: d8.id, clientId: c4.id, vehiculeId: v9.id,
    statut: 'attente', lignes: d8.lignes.map(l => Object.assign({}, l))
  });
  /* Un impayé, pour que l'écran des relances ait de quoi montrer. */
  const fa3 = nouvelleFacture({
    numero: 'FA-' + (new Date().getFullYear()) + '-0003',
    clientId: c1.id, vehiculeId: v1.id,
    statut: 'emise', emiseLe: ilYa(52), echeanceLe: ilYa(22), cree: ilYa(52), maj: ilYa(52),
    lignes: [nouvelleLigne({ type: 'forfait', libelle: 'Révision + géométrie', qte: 1, prixHT: 254 })]
  });
  const fa4 = nouvelleFacture({
    numero: 'FA-' + new Date().getFullYear() + '-0004',
    clientId: c6.id, vehiculeId: v4.id,
    statut: 'reglee', emiseLe: ilYa(30), echeanceLe: ilYa(0), cree: ilYa(30), maj: ilYa(29),
    lignes: [nouvelleLigne({ type: 'forfait', libelle: 'Vidange + filtre à huile', qte: 1, prixHT: 79 })],
    reglements: [{ id: id('reg'), quand: ilYa(29), montant: 94.80, mode: 'cb' }]
  });
  e.factures.push(fa1, fa2, fa3, fa4);
  d10.factureId = fa1.id;
  d8.factureId = fa2.id;

  /* --- interventions électroniques ------------------------------------------ */
  e.interventions.push(
    nouvelleIntervention({
      dossierId: d6.id, vehiculeId: v8.id, clientId: c3.id,
      outil: 'autotuner', operation: 'lecture', protocole: 'bench',
      ecu: { marque: 'Delphi', type: 'CRD2', hw: 'A6519002100', sw: '28345678' },
      credits: 1, slave: 'AT-SLV-0042', etat: 'ok', dureeMin: 45,
      resultat: 'Lecture complète. Sauvegarde d’origine archivée.',
      quand: ilYa(1), par: 'usr_patron',
      fichiers: [{ id: id('fic'), nom: 'CRD2_origine.bin', role: 'origine',
        ou: 'D:\\ECU\\2026\\GJ-159-KL', taille: 2048, quand: ilYa(1) }]
    }),
    nouvelleIntervention({
      dossierId: d8.id, vehiculeId: v9.id, clientId: c4.id,
      outil: 'autotuner', operation: 'ecriture', protocole: 'obd',
      ecu: { marque: 'Ford', type: 'SID209', hw: '', sw: '' },
      credits: 1, etat: 'ok', dureeMin: 70,
      modifications: ['stage1', 'ssop'],
      controles: { origine: true, charge: true, checksum: true, relecture: true, essai: true, defauts: true },
      resultat: 'Écriture réussie, essai routier concluant.',
      quand: ilYa(2), par: 'usr_patron'
    }),
    nouvelleIntervention({
      vehiculeId: v7.id, clientId: c9.id,
      outil: 'autotuner', operation: 'lecture', protocole: 'boot',
      ecu: { marque: 'Bosch', type: 'EDC17CP14' },
      credits: 0, etat: 'echec', dureeMin: 90,
      resultat: 'Communication impossible en boot : piste coupée sur la carte. À réparer avant de retenter.',
      quand: ilYa(12), par: 'usr_patron'
    }),
    nouvelleIntervention({
      vehiculeId: v5.id, clientId: c8.id,
      outil: 'autotuner', operation: 'diagnostic', protocole: 'obd',
      ecu: { marque: 'Bosch', type: 'EDC17C50' },
      credits: 0, etat: 'ok', dureeMin: 40,
      resultat: 'Relevé complet : P0234, P2263. Turbo confirmé.',
      quand: ilYa(8), par: 'usr_tech'
    }),

    /* --- l'histoire d'un boîtier, sur trois mois ----------------------------
       C'est ce vécu-là qui alimente la mémoire des calculateurs : l'EDC17C64
       se lit par la prise, mais refuse l'écriture — deux après-midi perdus
       avant de comprendre qu'il faut le déposer. La troisième fois, l'outil
       le dit avant qu'on branche. */
    nouvelleIntervention({
      vehiculeId: v3.id, clientId: c5.id,
      outil: 'autotuner', operation: 'lecture', protocole: 'obd',
      ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210' },
      credits: 1, etat: 'ok', dureeMin: 25,
      resultat: 'Lecture par la prise, sans dépose.',
      quand: ilYa(74), par: 'usr_patron'
    }),
    nouvelleIntervention({
      vehiculeId: v3.id, clientId: c5.id,
      outil: 'autotuner', operation: 'ecriture', protocole: 'obd',
      ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210' },
      credits: 0, etat: 'echec', dureeMin: 55,
      modifications: ['stage1', 'egr'],
      controles: { origine: true, charge: true },
      resultat: 'Refuse l’écriture par OBD : coupe la communication à 12 %.',
      quand: ilYa(73), par: 'usr_patron'
    }),
    nouvelleIntervention({
      vehiculeId: v3.id, clientId: c5.id,
      outil: 'autotuner', operation: 'ecriture', protocole: 'bench',
      ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210' },
      credits: 2, slave: 'AT-SLV-0042', etat: 'ok', dureeMin: 50,
      modifications: ['stage1', 'egr', 'dtc'],
      controles: { origine: true, charge: true, checksum: true, relecture: true, essai: true, defauts: true },
      resultat: 'Écrit au bench du premier coup, boîtier déposé.',
      notes: 'Alimentation 12 V bien stable, sinon il décroche en fin d’écriture.',
      quand: ilYa(73), par: 'usr_patron'
    }),
    nouvelleIntervention({
      vehiculeId: v3.id, clientId: c5.id,
      outil: 'autotuner', operation: 'ecriture', protocole: 'obd',
      ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210' },
      credits: 0, etat: 'echec', dureeMin: 40,
      modifications: ['stage1'],
      controles: { origine: true, charge: true },
      resultat: 'Même refus que la dernière fois par la prise.',
      quand: ilYa(40), par: 'usr_tech'
    }),
    nouvelleIntervention({
      vehiculeId: v3.id, clientId: c5.id,
      outil: 'autotuner', operation: 'lecture', protocole: 'obd',
      ecu: { marque: 'Bosch', type: 'EDC17C64', hw: '0281019112', sw: '1037543210' },
      credits: 1, etat: 'ok', dureeMin: 20,
      resultat: 'Lecture sans histoire.',
      quand: ilYa(40), par: 'usr_tech'
    }),
    nouvelleIntervention({
      dossierId: d6.id, vehiculeId: v8.id, clientId: c3.id,
      outil: 'autotuner', operation: 'ecriture', protocole: 'bench',
      ecu: { marque: 'Delphi', type: 'CRD2', hw: 'A6519002100', sw: '28345678' },
      credits: 2, slave: 'AT-SLV-0042', etat: 'ok', dureeMin: 60,
      modifications: ['stage1', 'fap', 'adblue'],
      controles: { origine: true, charge: true, checksum: true, relecture: true, essai: true, defauts: true },
      resultat: 'Écriture au bench, essai routier concluant.',
      notes: 'Le CRD2 ne se laisse pas faire par la prise : bench d’emblée.',
      quand: ilYa(1), par: 'usr_patron'
    })
  );

  /* --- planning de la semaine ------------------------------------------------ */
  const cre = (userId, jour, hDebut, minutes, titre, type, dossierId) => {
    e.creneaux.push({
      id: id('cre'), userId, dossierId: dossierId || null,
      titre, type: type || 'travaux',
      debut: j(jour, hDebut), fin: j(jour, hDebut) + minutes * 60000,
      /* Ce qui est déjà passé dans la semaine est coché : un planning de
         démonstration entièrement « à faire » ne ressemble à rien. */
      fait: j(jour, hDebut) + minutes * 60000 < Date.now(),
      cree: Date.now()
    });
  };
  cre('usr_tech',   1, 8,    120, 'Diagnostic C3 — voyant moteur', 'travaux');
  cre('usr_tech',   1, 10.5,  90, 'Démarreur Clio (dès réception)', 'travaux');
  cre('usr_tech',   1, 14,   180, 'Révision Sandero', 'travaux');
  cre('usr_patron', 1, 8.5,  150, 'Bench Mercedes — écriture', 'electro', d6.id);
  cre('usr_patron', 1, 14,    60, 'Essai routier Ford Focus', 'essai', d8.id);
  cre('usr_patron', 1, 15.5, 120, 'Devis distribution Golf', 'travaux', d3.id);
  cre('usr_sec',    1, 9,     60, 'Relances devis + impayés', 'autre');
  cre('usr_tech',   2, 8,    240, 'Distribution Golf VII', 'travaux', d3.id);
  cre('usr_patron', 2, 9,    120, 'Reprogrammation A4 (si carte réparée)', 'electro');
  cre('usr_sec',    2, 10,    90, 'Facturation flotte Meyzieu', 'autre');
  cre('usr_tech',   3, 8,    480, 'Embrayage Golf VII', 'travaux', d3.id);
  cre('usr_patron', 3, 14,    90, 'Rendez-vous client — 308', 'rdv');
  cre('usr_patron', 3, 9,    120, 'Lecture calculateur BMW', 'electro');
  cre('usr_sec',    4, 8,    480, 'Congé', 'absence');
  cre('usr_patron', 4, 8,    180, 'Turbo BMW (si accord)', 'travaux');
  cre('usr_tech',   4, 13.5, 150, 'Géométrie + freins Focus', 'travaux');
  cre('usr_tech',   5, 8,    240, 'Rattrapage — entretien flotte', 'travaux');
  cre('usr_patron', 5, 8,    120, 'Reprises et essais', 'essai');
  /* Une demande venue du portail confrère, pas encore acceptée. */
  e.creneaux.push({
    id: id('cre'), userId: null, clientId: c3.id,
    titre: 'Demande Garage du Pont — lecture calculateur Golf',
    type: 'electro', demande: true,
    debut: j(3, 10), fin: j(3, 12), cree: ilYa(0)
  });

  /* --- appels et pense-bêtes -------------------------------------------------- */
  e.appels.push(
    nouvelAppel({ quand: Date.now() - 2 * HEURE, tel: '0688776655', nom: 'Sylvie Marchand',
      clientId: c10.id, objet: 'Demande si la Sandero est prête', aRappeler: true, traite: false }),
    nouvelAppel({ quand: Date.now() - 5 * HEURE, tel: '0472889900', nom: 'Garage du Pont',
      clientId: c3.id, objet: 'Confirme le dépôt d’un second véhicule jeudi', traite: true }),
    nouvelAppel({ quand: ilYa(1), tel: '0611223344', nom: 'Bernard Petit', clientId: c9.id,
      objet: 'Réfléchit encore pour la pompe HP. Rappeler la semaine prochaine.',
      aRappeler: true, traite: false })
  );

  e.taches.push(
    { id: id('tac'), texte: 'Commander le démarreur Clio chez Doyen', pour: 'usr_sec', par: 'usr_tech',
      urgent: true, faite: false, cree: ilYa(1), echeance: jour0() },
    { id: id('tac'), texte: 'Relancer M. Khaled pour le devis turbo', pour: 'usr_sec', par: 'usr_patron',
      faite: false, cree: ilYa(2) },
    { id: id('tac'), texte: 'Recharger les crédits Autotuner (12 restants)', pour: 'usr_patron',
      par: 'usr_patron', faite: false, cree: ilYa(4) },
    { id: id('tac'), texte: 'Faire l’inventaire du rayon R4', pour: null, par: 'usr_patron',
      faite: false, cree: ilYa(9) },
    { id: id('tac'), texte: 'Envoyer la facture flotte à Transports Meyzieu', pour: 'usr_sec',
      par: 'usr_sec', faite: true, faiteLe: ilYa(4), cree: ilYa(5) }
  );

  /* --- quelques mouvements de stock, pour que l'historique existe ------------- */
  const mvt = (ref, sens, qte, motif, quand) => {
    const p = parRef(ref);
    if (!p) return;
    e.mouvements.push({
      id: id('mvt'), pieceId: p.id, sens, qte, avant: p.qte, apres: p.qte,
      prixUnit: p.prixAchat, motif, qui: 'usr_tech', quand
    });
  };
  mvt('FRE-P-001', 'sortie', 1, 'Dossier Sandero', ilYa(1));
  mvt('MOT-H-001', 'entree', 6, 'Livraison Autodistribution', ilYa(5));
  mvt('FIL-G-001', 'sortie', 2, 'Révisions du jour', ilYa(6));
  mvt('ELE-B-001', 'entree', 3, 'Livraison Doyen', ilYa(11));
  mvt('CON-N-001', 'sortie', 3, 'Consommation atelier', ilYa(13));

  return e;
}

/** Reconnaît un jeu de démonstration : sert à ne pas l'effacer par surprise,
 *  et à proposer de le remplacer par de vraies données. */
export function estLaDemo(e) {
  return !!(e && e.reglages && e.reglages.demoChargee);
}
