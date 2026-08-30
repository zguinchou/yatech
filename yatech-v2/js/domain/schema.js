/* ==========================================================================
   YATECH — le modèle
   --------------------------------------------------------------------------
   Ce fichier décide de la forme des données. Tout le reste de l'outil s'y
   réfère : un écran qui invente un champ crée une donnée que personne ne sait
   relire six mois plus tard.

   Le centre de gravité est le DOSSIER (l'ordre de réparation). Un véhicule
   entre, un dossier s'ouvre ; il porte les travaux, la place au parc, le
   planning, les pièces sorties du stock, l'intervention électronique, le devis
   et la facture. Fermer le dossier, c'est fermer tout le reste.

       client ──< véhicule ──< DOSSIER ──< lignes de travaux
                                  ├──< devis (versions figées, envoyées)
                                  ├──< facture (suivi + report EBP)
                                  ├──< créneaux de planning
                                  ├──< mouvements de stock
                                  ├──  place au parc
                                  └──< interventions électroniques

   Toutes les dates sont des nombres (millisecondes). Tous les montants sont
   hors taxes, en euros, arrondis au centime au moment du calcul.
   ========================================================================== */

import { id, copie, plaqueNue } from '../core/util.js';

export const VERSION_MODELE = 3;

/* ==========================================================================
   VOCABULAIRES
   Chaque état porte son libellé et son ton. Les écrans n'écrivent jamais
   « En atelier » à la main : ils lisent ici. Renommer une colonne se fait
   d'un seul endroit — et les réglages permettent de le faire sans toucher au
   code (reglages.libelles).
   ========================================================================== */

/** Les colonnes du tableau de l'atelier, dans l'ordre où le travail avance. */
export const ETAPES = [
  { cle: 'accueil',  nom: 'Reçu',            court: 'Reçu',     ton: 'neutre', aide: "Le véhicule est là, rien n'a encore commencé." },
  { cle: 'diag',     nom: 'Diagnostic',      court: 'Diag',     ton: 'info',   aide: 'Recherche de panne, lecture des défauts.' },
  { cle: 'devis',    nom: 'Devis à faire',   court: 'Devis',    ton: 'accent', aide: 'On sait quoi faire, reste à le chiffrer.' },
  { cle: 'accord',   nom: 'Attente accord',  court: 'Accord',   ton: 'alerte', aide: 'Le devis est parti, le client n’a pas répondu.' },
  { cle: 'piece',    nom: 'Attente pièce',   court: 'Pièce',    ton: 'violet', aide: 'Accord donné, la pièce est commandée.' },
  { cle: 'atelier',  nom: 'En atelier',      court: 'Atelier',  ton: 'accent', aide: 'Les travaux sont en cours.' },
  { cle: 'controle', nom: 'Essai / contrôle',court: 'Essai',    ton: 'info',   aide: 'Travaux finis, on vérifie avant de rendre.' },
  { cle: 'pret',     nom: 'Prêt à rendre',   court: 'Prêt',     ton: 'ok',     aide: 'Le client peut venir chercher son véhicule.' },
  { cle: 'livre',    nom: 'Rendu',           court: 'Rendu',    ton: 'neutre', aide: 'Le véhicule est parti. Reste la facturation.' }
];
export const CLES_ETAPES = ETAPES.map(e => e.cle);
/** Les étapes où le véhicule est encore chez nous. */
export const ETAPES_OUVERTES = ['accueil', 'diag', 'devis', 'accord', 'piece', 'atelier', 'controle', 'pret'];
/** Les étapes où l'on attend quelqu'un d'autre : ni nous, ni l'atelier. */
export const ETAPES_ATTENTE = ['accord', 'piece'];

export const NATURES = {
  meca:    { nom: 'Mécanique',    court: 'MÉCA', ton: 'alerte', icone: 'atelier' },
  electro: { nom: 'Électronique', court: 'ÉLEC', ton: 'info',   icone: 'puce' },
  mixte:   { nom: 'Méca + élec',  court: 'MIXTE',ton: 'violet', icone: 'jauge' }
};

export const PRIORITES = {
  basse:  { nom: 'Peut attendre', ton: 'neutre', rang: 0 },
  normale:{ nom: 'Normale',       ton: 'neutre', rang: 1 },
  urgent: { nom: 'Urgent',        ton: 'danger', rang: 2 }
};

export const STATUTS_DEVIS = {
  brouillon: { nom: 'Brouillon', ton: 'neutre', aide: "Pas encore montré au client." },
  envoye:    { nom: 'Envoyé',    ton: 'info',   aide: 'Le client l’a reçu, on attend sa réponse.' },
  accepte:   { nom: 'Accepté',   ton: 'ok',     aide: 'Accord donné : on peut lancer les travaux.' },
  refuse:    { nom: 'Refusé',    ton: 'danger', aide: 'Le client ne donne pas suite.' },
  expire:    { nom: 'Périmé',    ton: 'alerte', aide: 'Passé sa date de validité sans réponse.' }
};

export const STATUTS_FACTURE = {
  attente: { nom: 'À facturer', ton: 'alerte', aide: 'Travaux terminés, la facture reste à établir dans EBP.' },
  emise:   { nom: 'Émise',      ton: 'info',   aide: 'Facture établie, en attente de règlement.' },
  partiel: { nom: 'Acompte',    ton: 'accent', aide: 'Un premier versement est arrivé.' },
  reglee:  { nom: 'Réglée',     ton: 'ok',     aide: 'Soldée.' },
  impayee: { nom: 'Impayée',    ton: 'danger', aide: 'Échéance dépassée, rien reçu.' }
};

export const MODES_REGLEMENT = {
  cb:      'Carte bancaire',
  especes: 'Espèces',
  cheque:  'Chèque',
  virement:'Virement',
  autre:   'Autre'
};

/** Les natures de ligne dans un devis. Elles décident du calcul et de l'aspect. */
export const TYPES_LIGNE = {
  mo:      { nom: 'Main-d’œuvre',  unite: 'h',  icone: 'atelier' },
  piece:   { nom: 'Pièce',         unite: 'u',  icone: 'boite' },
  forfait: { nom: 'Forfait',       unite: 'u',  icone: 'etiquette' },
  electro: { nom: 'Électronique',  unite: 'u',  icone: 'puce' },
  sous:    { nom: 'Sous-traitance',unite: 'u',  icone: 'camion' },
  frais:   { nom: 'Frais',         unite: 'u',  icone: 'euro' },
  titre:   { nom: 'Sous-titre',    unite: '',   icone: 'etiquette' }
};

/* --- Stock ---------------------------------------------------------------- */
export const SENS_MOUVEMENT = {
  entree:  { nom: 'Entrée',      signe: 1,  ton: 'ok',     icone: 'televerser' },
  sortie:  { nom: 'Sortie',      signe: -1, ton: 'alerte', icone: 'telecharger' },
  retour:  { nom: 'Retour',      signe: 1,  ton: 'info',   icone: 'retour' },
  perte:   { nom: 'Perte / casse',signe: -1,ton: 'danger', icone: 'alerte' },
  inventaire: { nom: 'Inventaire',signe: 0, ton: 'violet', icone: 'balance' }
};

/* --- Électronique --------------------------------------------------------- */
export const OUTILS_ELECTRO = {
  autotuner: 'Autotuner',
  kess:      'KESS / K-Tag',
  pcmflash:  'PCMflash',
  bitbox:    'BitBox',
  autre:     'Autre outil'
};

export const PROTOCOLES = {
  obd:  { nom: 'OBD',   aide: 'Par la prise diagnostic, calculateur en place.' },
  bench:{ nom: 'Bench', aide: 'Calculateur déposé, alimenté sur établi.' },
  boot: { nom: 'Boot',  aide: 'Calculateur ouvert, mode amorçage.' },
  jtag: { nom: 'JTAG',  aide: 'Accès direct au processeur.' },
  can:  { nom: 'CAN',   aide: 'Sur le bus, sans passer par la prise.' }
};

export const OPERATIONS_ELECTRO = {
  lecture:      { nom: 'Lecture', aide: 'Sauvegarde du fichier d’origine.' },
  ecriture:     { nom: 'Écriture', aide: 'Écriture d’un fichier dans le calculateur.' },
  reparation:   { nom: 'Réparation calculateur', aide: 'Remise en état matérielle.' },
  codage:       { nom: 'Codage / adaptation', aide: 'Apprentissage, codage d’un organe neuf.' },
  cle:          { nom: 'Clé / antidémarrage', aide: 'Programmation de clé, apprentissage.' },
  diagnostic:   { nom: 'Diagnostic approfondi', aide: 'Relevé et analyse des défauts.' },
  autre:        { nom: 'Autre', aide: '' }
};

/* --- ce qu'on a fait au fichier ------------------------------------------
   Le protocole dit par où on est entré ; ça, c'est ce qu'on a changé une fois
   dedans. C'est la seule chose qu'un client rappelle deux ans plus tard :
   « vous m'aviez fait quoi, déjà ? » — et la seule qu'un confrère demande
   avant de reprendre une voiture qu'on a touchée.

   `route: false` marque ce qui n'est pas homologué pour un usage routier. Ce
   n'est pas un jugement, c'est une mention à reporter sur le document remis
   au client : c'est lui qui roule avec. */
export const FAMILLES_MODIF = {
  puissance:   { nom: 'Puissance' },
  depollution: { nom: 'Dépollution' },
  agrement:    { nom: 'Agrément' },
  codage:      { nom: 'Codage' }
};

export const MODIFICATIONS_ELECTRO = {
  stage1:     { nom: 'Stage 1', famille: 'puissance', aide: 'Cartographie sur véhicule d’origine.' },
  stage2:     { nom: 'Stage 2', famille: 'puissance', aide: 'Avec mécanique modifiée : ligne, admission, échangeur.' },
  perso:      { nom: 'Sur mesure', famille: 'puissance', aide: 'Cartographie faite pour ce véhicule seul.' },
  e85:        { nom: 'Conversion E85', famille: 'puissance' },
  vmax:       { nom: 'Vmax', famille: 'puissance', aide: 'Limiteur de vitesse relevé ou retiré.', route: false },
  couple:     { nom: 'Limiteur de couple', famille: 'puissance' },
  egr:        { nom: 'EGR', famille: 'depollution', route: false },
  fap:        { nom: 'FAP / DPF', famille: 'depollution', route: false },
  adblue:     { nom: 'AdBlue / SCR', famille: 'depollution', route: false },
  lambda:     { nom: 'Sonde lambda', famille: 'depollution', route: false },
  cata:       { nom: 'Catalyseur', famille: 'depollution', route: false },
  volets:     { nom: 'Volets d’admission', famille: 'depollution' },
  ssop:       { nom: 'Start & Stop', famille: 'agrement' },
  pedale:     { nom: 'Réponse pédale', famille: 'agrement' },
  crackle:    { nom: 'Crackle / popcorn', famille: 'agrement', route: false },
  hotstart:   { nom: 'Hot start', famille: 'agrement' },
  boite:      { nom: 'Boîte / TCU', famille: 'agrement' },
  dtc:        { nom: 'DTC off', famille: 'codage' },
  immo:       { nom: 'Immo off', famille: 'codage' },
  injecteurs: { nom: 'Codage injecteurs', famille: 'codage' },
  cluster:    { nom: 'Compteur', famille: 'codage' },
  cleModif:   { nom: 'Clé', famille: 'codage' },
  autreModif: { nom: 'Autre', famille: 'codage' }
};

/* --- le déroulé qu'on ne saute pas ---------------------------------------
   Six cases. Elles ne servent pas à faire joli : `bloquant` marque celles
   sans lesquelles on refuse de déclarer une écriture réussie. Un calculateur
   écrit sans original sauvegardé, c'est une voiture qu'on ne peut plus
   remettre d'aplomb. */
export const CONTROLES_ELECTRO = {
  origine:   { nom: 'Original sauvegardé', bloquant: true,
    aide: 'Lu, rangé et nommé AVANT la moindre écriture.' },
  charge:    { nom: 'Maintien de charge', bloquant: true,
    aide: 'Chargeur branché du début à la fin. Une coupure en pleine écriture brique le boîtier.' },
  checksum:  { nom: 'Checksum corrigé',
    aide: 'Somme de contrôle recalculée sur le fichier écrit.' },
  relecture: { nom: 'Relecture vérifiée',
    aide: 'On relit le calculateur : il rend bien ce qu’on lui a écrit.' },
  defauts:   { nom: 'Défauts effacés',
    aide: 'Mémoire de défauts vidée après l’essai, pas avant.' },
  essai:     { nom: 'Essai routier fait',
    aide: 'Moteur chaud, sous charge, avec le client si possible.' }
};

/* Les opérations qui écrivent dans le calculateur : ce sont les seules où
   les contrôles bloquants s'appliquent. Relever des défauts ne risque rien. */
export const OPERATIONS_QUI_ECRIVENT = ['ecriture', 'codage', 'cle'];

/* --- la commande d'une pièce ---------------------------------------------
   « Attente pièce » est une étape du dossier. Mais une étape ne dit pas QUELLE
   pièce manque, chez qui elle est commandée, ni quand elle devait arriver.
   C'est pourtant la question du lundi matin : qu'est-ce que je dois commander
   aujourd'hui, et qu'est-ce qui aurait dû arriver ?

   L'état vit sur la LIGNE du dossier, pas sur la pièce du stock : c'est cette
   pièce-là, pour cette voiture-là, qu'on attend. */
/* --- de quoi on peut être prévenu -----------------------------------------
   Les alertes portent une famille ; c'est elle qu'on choisit de recevoir ou
   non, pas chaque alerte une par une. Sept cases, pas soixante. */
export const FAMILLES_ALERTE = {
  appels:   { nom: 'Les appels à rappeler', icone: 'telephone' },
  rdv:      { nom: 'Les demandes de créneau', icone: 'pro' },
  pieces:   { nom: 'Les pièces : à commander, en retard, stock bas', icone: 'stock' },
  paiement: { nom: 'Les impayés et ce qui reste à facturer', icone: 'euro' },
  devis:    { nom: 'Les devis sans réponse', icone: 'devis' },
  parc:     { nom: 'Le parc : véhicules oubliés, places en conflit', icone: 'parc' },
  credits:  { nom: 'Les crédits Autotuner', icone: 'puce' }
};

export const ETATS_COMMANDE = {
  a_commander: { nom: 'À commander', court: 'À cmd.', ton: 'danger', rang: 0 },
  commandee:   { nom: 'Commandée',   court: 'Cmd.',   ton: 'alerte', rang: 1 },
  recue:       { nom: 'Reçue',       court: 'Reçue',  ton: 'ok',     rang: 2 }
};

export const ETATS_INTERVENTION = {
  prevu:   { nom: 'Prévue',      ton: 'neutre' },
  encours: { nom: 'En cours',    ton: 'accent' },
  ok:      { nom: 'Réussie',     ton: 'ok' },
  echec:   { nom: 'Échec',       ton: 'danger' },
  annule:  { nom: 'Annulée',     ton: 'neutre' }
};

/* --- Parc ----------------------------------------------------------------- */
export const TYPES_PLACE = {
  normale: { nom: 'Place ordinaire' },
  pont:    { nom: 'Pont élévateur' },
  couvert: { nom: 'Sous abri' },
  hs:      { nom: 'Inutilisable' }
};

export const MOTIFS_PARC = {
  attente:  { nom: 'En attente de travaux', ton: 'alerte' },
  travaux:  { nom: 'Travaux en cours',      ton: 'accent' },
  piece:    { nom: 'Attente de pièce',      ton: 'violet' },
  pret:     { nom: 'Prêt, à récupérer',     ton: 'ok' },
  gros:     { nom: 'Gros travaux',          ton: 'violet' },
  perso:    { nom: 'Véhicule du personnel', ton: 'neutre' },
  depot:    { nom: 'Dépôt / gardiennage',   ton: 'info' },
  epave:    { nom: 'Épave / pièces',        ton: 'neutre' }
};

/* --- Planning -------------------------------------------------------------- */
export const TYPES_CRENEAU = {
  travaux:  { nom: 'Travaux',        ton: 'accent' },
  rdv:      { nom: 'Rendez-vous',    ton: 'info' },
  electro:  { nom: 'Électronique',   ton: 'info' },
  essai:    { nom: 'Essai routier',  ton: 'ok' },
  absence:  { nom: 'Absence',        ton: 'neutre' },
  autre:    { nom: 'Autre',          ton: 'neutre' }
};

export const ROLES = {
  patron:      { nom: 'Responsable',  aide: 'Accès à tout, y compris les réglages et les chiffres.' },
  technicien:  { nom: 'Technicien',   aide: 'Atelier, dossiers, stock, planning. Pas les réglages.' },
  secretariat: { nom: 'Secrétariat',  aide: 'Clients, devis, facturation, planning, appels.' }
};

/* ==========================================================================
   RÉGLAGES PAR DÉFAUT
   Tout ce qui se règle sans toucher au code.
   ========================================================================== */

export const REGLAGES_DEFAUT = {
  /* --- l'entreprise ------------------------------------------------------ */
  nomOutil: 'Yatech',
  raisonSociale: '',
  formeJuridique: '',
  adresse: '',
  cp: '',
  ville: '',
  tel: '',
  email: '',
  siteWeb: '',
  siret: '',
  tvaIntra: '',
  rcs: '',
  ape: '',
  capital: '',
  assurance: '',            // nom de l'assureur RC pro, exigé sur les factures
  iban: '',
  bic: '',

  /* --- l'argent ----------------------------------------------------------- */
  devise: 'EUR',
  tauxTva: 20,
  tvaApplicable: true,      // faux si franchise en base
  mentionFranchiseTva: 'TVA non applicable, art. 293 B du CGI',
  tauxHoraire: 65,          // grille particulier, € HT
  tauxHorairePro: 52,       // grille confrère
  remiseProDefaut: 15,      // % appliqué au catalogue quand aucun prix pro n'est fixé
  fraisGestion: 0,          // € HT ajoutés automatiquement (ingrédients, consommables)
  arrondiHeure: 0.25,       // on facture au quart d'heure

  /* --- les documents ------------------------------------------------------ */
  prefixeDevis: 'DV',
  prefixeFacture: 'FA',
  prefixeDossier: 'OR',
  compteurDevis: 1,
  compteurFacture: 1,
  compteurDossier: 1,
  validiteDevis: 30,        // jours
  delaiPaiement: 30,        // jours
  penalitesRetard: 'Taux d’intérêt légal majoré de 10 points. Indemnité forfaitaire de recouvrement : 40 €.',
  mentionsDevis: 'Devis gratuit, valable {validite} jours. Toute pièce ou opération non prévue au présent '
    + 'devis fera l’objet d’un accord préalable du client. Les pièces remplacées sont tenues à disposition '
    + 'du client conformément à l’article L. 224-67 du code de la consommation.',
  mentionsFacture: 'Paiement à {delai} jours. En cas de retard : {penalites} Réserve de propriété : '
    + 'les pièces fournies restent la propriété du garage jusqu’au paiement intégral.',
  mentionElectronique: 'Les prestations de reprogrammation de calculateur sont réalisées à la demande '
    + 'expresse du client, qui déclare en connaître la destination et demeure responsable de la conformité '
    + 'de son véhicule à la réglementation en vigueur pour l’usage qu’il en fait.',

  /* --- le parc ------------------------------------------------------------ */
  parcColonnes: 6,
  parcRangees: 3,
  nomsRangees: {},          // { A: 'Côté portail' }
  typesPlaces: {},          // { A1: 'pont' }
  parcAlerteJours: 7,       // au-delà, la place passe en alerte
  parcAlerteGrave: 21,      // au-delà, en rouge : un véhicule ventouse

  /* --- le planning -------------------------------------------------------- */
  joursOuvres: [1, 2, 3, 4, 5, 6],   // 1 = lundi … 0 = dimanche
  heureDebut: '08:00',
  heureFin: '18:30',
  pauseDebut: '12:00',
  pauseFin: '14:00',
  pasPlanning: 30,          // minutes par case
  dureeDefaut: 60,          // minutes proposées pour un nouveau créneau
  joursReservablesPro: 14,  // horizon de réservation ouvert aux confrères

  /* --- le stock ----------------------------------------------------------- */
  stockAlerteDefaut: 1,     // seuil bas quand la pièce n'en fixe pas
  margeDefaut: 30,          // % appliqué au prix d'achat pour proposer un prix de vente
  emplacementsAuto: true,   // proposer le prochain bac libre à la création
  inventaireRappel: 180,    // jours entre deux inventaires conseillés

  /* --- l'électronique ----------------------------------------------------- */
  outilDefaut: 'autotuner',
  /* Autotuner vend l'accès aux protocoles au crédit : c'est la seule chose,
     dans une reprogrammation, qui s'épuise et bloque un travail en plein
     après-midi. D'où le compteur. Un atelier sous abonnement, ou qui travaille
     à l'outil déjà débloqué, éteint tout ça d'un interrupteur. */
  suiviCredits: true,
  creditsAlerte: 5,         // prévenir en dessous de ce solde
  prixCredit: 0,            // ce qu'un crédit vous coûte, pour la marge

  /* --- les alertes -------------------------------------------------------- */
  relanceDevis: 4,          // jours sans réponse avant de relancer
  relanceImpaye: 30,        // jours après échéance
  rappelEbp: 120,           // minutes ; 0 = jamais

  /* --- l'apparence -------------------------------------------------------- */
  theme: 'auto',            // auto | clair | sombre
  teinte: 38,               // teinte d'accent, en degrés
  densite: 'confort',       // confort | compact
  ecranAccueil: '/',

  /* --- l'espace des confrères ----------------------------------------------
     Ce qu'un garage partenaire voit dans le lien qu'on lui envoie. Réglé une
     fois, appliqué à tous les liens fabriqués ensuite. */
  espacePro: {
    /* Les familles de prestations montrées. Vide = toutes. On ne montre pas
       forcément les vidanges à quelqu'un qui ne nous confie que l'électronique. */
    familles: [],
    rdv: true,                // il peut demander un rendez-vous
    temps: true,              // le temps de main-d'œuvre est affiché
    accueil: '',              // un mot en haut de sa page ; vide = rien
    /* Les délais qu'on annonce, pour qu'il ne demande pas pour demain matin
       ce qui prend trois jours. Vide = on n'annonce rien. */
    delai: ''
  },

  /* --- être prévenu --------------------------------------------------------
     Ce que le garage propose par défaut ; chacun l'ajuste pour lui-même dans
     ses préférences. Éteint d'origine : un outil qui se met à sonner sans
     qu'on l'ait demandé, on le referme. */
  notifs: {
    actives: false,          // le garage autorise-t-il les avertissements ?
    son: false,             // un petit son en plus de l'avertissement
    quoi: {                 // par famille d'alerte
      appels: true, rdv: true, pieces: true, paiement: true,
      devis: true, parc: true, credits: true
    },
    silenceActif: true,     // ne pas déranger la nuit
    silenceDe: 19 * 60,     // minutes depuis minuit
    silenceA: 7 * 60 + 30
  },

  /* --- l'accès ------------------------------------------------------------ */
  verrouAuto: 0,            // minutes d'inactivité avant verrouillage ; 0 = jamais
  /* L'outil s'ouvre directement, sur la première personne active. Un garage de
     trois personnes dans un atelier fermé n'a pas à taper un code pour lire son
     planning — et le code n'a jamais protégé grand-chose : les données vivent
     en clair dans le navigateur, le vrai verrou c'est celui du téléphone.
     Le garage qui veut séparer les rôles l'allume dans Réglages → Équipe. */
  demanderCode: false,

  /* --- les modèles de messages -------------------------------------------- */
  messageDevis: 'Bonjour {prenom},\n\nVoici le devis {numero} pour votre {vehicule} ({immat}), '
    + 'd’un montant de {montant} TTC.\n\nÀ votre disposition pour en parler.\n\n{garage}',
  messagePret: 'Bonjour {prenom},\n\nVotre {vehicule} ({immat}) est prête, les travaux sont terminés.\n'
    + 'Vous pouvez venir la récupérer aux horaires d’ouverture.\n\nMontant : {montant} TTC.\n\n{garage}',
  messageRelance: 'Bonjour {prenom},\n\nJe reviens vers vous au sujet du devis {numero} pour votre '
    + '{vehicule}. Souhaitez-vous que nous programmions l’intervention ?\n\n{garage}',
  messageRdv: 'Bonjour {prenom},\n\nVotre rendez-vous est confirmé : {jour} à {heure}, pour {prestation} '
    + '— véhicule {immat}.\n\nÀ {jour},\n{garage}',
  messageImpaye: 'Bonjour {prenom},\n\nSauf erreur de notre part, la facture {numero} du {date} '
    + '({montant} TTC) reste impayée. Merci de votre retour.\n\n{garage}',

  /* --- interne ------------------------------------------------------------ */
  demoChargee: false,
  derniereSauvegarde: 0,
  vuLaVisite: false
};

/* ==========================================================================
   FABRIQUES
   Une seule façon de créer chaque objet : personne n'oublie un champ.
   ========================================================================== */

export function nouveauClient(champs) {
  return Object.assign({
    id: id('cli'),
    type: 'part',            // part | pro
    civilite: '',
    nom: '',
    prenom: '',
    societe: '',
    siret: '',
    tvaIntra: '',
    tel: '',
    tel2: '',
    email: '',
    adresse: '',
    cp: '',
    ville: '',
    /* Tarification : 'part' suit la grille publique, 'pro' la grille confrère.
       `remise` s'ajoute par-dessus, en pourcentage, pour les cas particuliers. */
    grille: 'part',
    remise: 0,
    codeEbp: '',
    ebp: null,               // date de report dans EBP ; null = jamais reporté
    notes: '',
    etiquettes: [],
    /* Accès au portail confrère : jeton dans le lien, code pour entrer. */
    portail: null,           // { jeton, verrou, ouvertLe, dernierAcces }
    /* Le lien d'espace professionnel qu'on lui a envoyé, et combien de fois.
       On ne garde pas le lien : il se refabrique, et il pèse. */
    espacePro: null,         // { envoyeLe, version }
    archive: false,
    cree: Date.now(),
    maj: Date.now()
  }, champs);
}

export function nouveauVehicule(champs) {
  const v = Object.assign({
    id: id('veh'),
    clientId: null,
    immat: '',
    vin: '',
    marque: '',
    modele: '',
    finition: '',
    energie: '',             // diesel | essence | hybride | electrique | gpl
    motorisation: '',        // « 2.0 HDi 136 »
    cylindree: '',
    puissanceCh: null,
    puissanceFisc: null,
    boite: '',               // manuelle | automatique
    couleur: '',
    dateMec: null,           // première mise en circulation
    km: null,
    kmReleveLe: null,
    /* Ce qu'on veut savoir avant même d'ouvrir le capot, côté électronique. */
    ecu: { marque: '', type: '', hw: '', sw: '', protocole: '' },
    clefs: '',               // repère du trousseau au tableau des clés
    notes: '',
    photos: [],              // clés de fichiers rangés à part
    archive: false,
    cree: Date.now(),
    maj: Date.now()
  }, champs);
  v.immat = plaqueNue(v.immat);
  return v;
}

export function nouveauDossier(champs) {
  return Object.assign({
    id: id('dos'),
    numero: '',
    clientId: null,
    vehiculeId: null,
    titre: '',
    nature: 'meca',          // meca | electro | mixte
    etape: 'accueil',
    priorite: 'normale',
    assignes: [],            // identifiants d'utilisateurs
    demande: '',             // ce que le client a dit, dans ses mots
    constat: '',             // ce qu'on a trouvé
    travaux: '',             // ce qu'on a fait
    lignes: [],              // voir `nouvelleLigne`
    remiseGlobale: 0,        // % sur le total
    kmEntree: null,
    kmSortie: null,
    /* Le parc : la place occupée, et depuis quand. */
    place: null,             // 'B3'
    motifParc: 'attente',
    entree: Date.now(),
    sortiePrevue: null,
    sortie: null,
    /* Suivi */
    checklist: [],           // [{ id, texte, fait, par, quand }]
    photos: [],
    notes: [],               // [{ id, quand, qui, texte }]
    devisIds: [],
    factureId: null,
    archive: false,
    cree: Date.now(),
    maj: Date.now()
  }, champs);
}

export function nouvelleLigne(champs) {
  return Object.assign({
    id: id('lig'),
    type: 'mo',              // voir TYPES_LIGNE
    ref: '',
    libelle: '',
    detail: '',
    qte: 1,
    unite: '',
    prixHT: 0,
    remise: 0,               // %
    tva: null,               // null : on suit le taux général du garage
    pieceId: null,           // si la ligne sort du stock
    prestationId: null,      // si elle vient du catalogue
    sortieFaite: false,      // la pièce a-t-elle vraiment été décomptée ?
    fait: false,             // le technicien a coché « c'est fait »
    /* --- la commande, quand la pièce n'est pas dans le rayon --------------
       `null` : la question ne se pose pas (main-d'œuvre, pièce déjà en stock,
       forfait). Sinon une des clés d'ETATS_COMMANDE. */
    commande: null,
    fournisseurId: null,     // chez qui elle est commandée
    attendueLe: null,        // la date annoncée par le fournisseur
    commandeLe: null,        // quand on a passé la commande
    recueLe: null            // quand elle est arrivée
  }, champs);
}

export function nouveauDevis(champs) {
  return Object.assign({
    id: id('dev'),
    numero: '',
    dossierId: null,
    clientId: null,
    vehiculeId: null,
    version: 1,
    statut: 'brouillon',
    lignes: [],              // copie figée : le devis ne bouge plus une fois envoyé
    remiseGlobale: 0,
    tauxTva: null,
    acompte: 0,
    objet: '',
    motDuJour: '',           // le petit mot ajouté au client
    valableJusquau: null,
    emisLe: Date.now(),
    envoyeLe: null,
    repondeLe: null,
    signature: null,         // { nom, quand, trace }
    ebp: null,
    cree: Date.now(),
    maj: Date.now()
  }, champs);
}

export function nouvelleFacture(champs) {
  return Object.assign({
    id: id('fac'),
    numero: '',
    dossierId: null,
    devisId: null,
    clientId: null,
    vehiculeId: null,
    statut: 'attente',
    lignes: [],
    remiseGlobale: 0,
    tauxTva: null,
    emiseLe: null,
    echeanceLe: null,
    reglements: [],          // [{ id, quand, montant, mode, note }]
    /* EBP tient la facturation officielle. Ici on garde le lien : le numéro
       qu'EBP a donné, et la date où on lui a passé l'information. */
    ebp: null,
    numeroEbp: '',
    note: '',
    cree: Date.now(),
    maj: Date.now()
  }, champs);
}

export function nouvellePiece(champs) {
  return Object.assign({
    id: id('pie'),
    ref: '',                 // notre référence
    refFabricant: '',
    ean: '',
    libelle: '',
    famille: '',
    marque: '',
    fournisseurId: null,
    emplacement: '',         // 'R2-B-04'
    qte: 0,
    qteMin: null,            // null : on suit le seuil général
    unite: 'u',
    prixAchat: 0,
    prixVente: 0,
    prixVentePro: 0,
    /* Ce sur quoi la pièce va : les modèles, en texte libre. C'est ce qu'on
       relit dans six mois pour savoir si le filtre du fond va sur la 308. */
    compatible: '',
    etat: 'neuf',            // neuf | occasion | reconditionne
    photo: null,
    notes: '',
    inventorieLe: null,
    archive: false,
    cree: Date.now(),
    maj: Date.now()
  }, champs);
}

export function nouveauMouvement(champs) {
  return Object.assign({
    id: id('mvt'),
    pieceId: null,
    sens: 'sortie',
    qte: 1,
    avant: 0,
    apres: 0,
    prixUnit: 0,
    dossierId: null,
    fournisseurId: null,
    motif: '',
    qui: null,
    quand: Date.now()
  }, champs);
}

export function nouveauFournisseur(champs) {
  return Object.assign({
    id: id('four'),
    nom: '',
    contact: '',
    tel: '',
    email: '',
    site: '',
    compte: '',              // numéro de compte chez eux
    delaiJours: 1,
    remise: 0,
    notes: '',
    archive: false,
    cree: Date.now()
  }, champs);
}

export function nouveauCreneau(champs) {
  return Object.assign({
    id: id('cre'),
    userId: null,
    dossierId: null,
    clientId: null,
    vehiculeId: null,
    titre: '',
    type: 'travaux',
    debut: Date.now(),
    fin: Date.now() + 3600000,
    fait: false,
    note: '',
    /* Une demande venue du portail confrère n'entre pas au planning toute
       seule : elle attend qu'on la prenne. */
    demande: false,
    cree: Date.now()
  }, champs);
}

export function nouvelleIntervention(champs) {
  return Object.assign({
    id: id('int'),
    dossierId: null,
    vehiculeId: null,
    clientId: null,
    outil: 'autotuner',
    operation: 'lecture',
    protocole: 'obd',
    ecu: { marque: '', type: '', hw: '', sw: '' },
    credits: 0,              // crédits Autotuner que l'intervention coûte
    /* Ce qui a DÉJÀ été retiré du solde pour elle. L'écart entre les deux
       est ce qu'il reste à faire bouger — voir reconcilierCredits(). */
    creditsDebites: 0,
    slave: '',               // identifiant de l'appareil utilisé
    etat: 'prevu',
    modifications: [],       // clés de MODIFICATIONS_ELECTRO : ce qu'on a changé
    controles: {},           // clés de CONTROLES_ELECTRO -> vrai quand la case est cochée
    fichiers: [],            // [{ id, nom, role, ou, taille, quand }]
    dureeMin: 0,
    resultat: '',
    notes: '',
    par: null,
    quand: Date.now(),
    cree: Date.now()
  }, champs);
}

export function nouvellePrestation(champs) {
  return Object.assign({
    id: id('pst'),
    code: '',
    libelle: '',
    famille: 'Mécanique',
    type: 'mo',              // mo | forfait | electro | piece
    temps: 1,                // heures de main-d'œuvre
    prixHT: 0,               // grille particulier ; 0 = calculé sur le temps
    prixPro: 0,              // grille confrère ; 0 = remise générale appliquée
    credits: 0,              // crédits Autotuner que la prestation consomme
    /* Pas homologuée pour la voie publique. La mention suit la prestation
       partout : sur la grille du confrère comme sur le document du client. */
    horsRoute: false,
    detail: '',
    actif: true,
    cree: Date.now()
  }, champs);
}

export function nouvelleTache(champs) {
  return Object.assign({
    id: id('tac'),
    texte: '',
    pour: null,              // identifiant d'utilisateur ; null = pour tout le monde
    par: null,
    dossierId: null,
    clientId: null,
    echeance: null,
    faite: false,
    faiteLe: null,
    urgent: false,
    cree: Date.now()
  }, champs);
}

export function nouvelAppel(champs) {
  return Object.assign({
    id: id('app'),
    quand: Date.now(),
    tel: '',
    nom: '',
    clientId: null,
    vehiculeId: null,
    objet: '',
    aRappeler: false,
    traite: false,
    par: null,
    note: ''
  }, champs);
}

export function nouvelUtilisateur(champs) {
  return Object.assign({
    id: id('usr'),
    nom: '',
    prenom: '',
    role: 'technicien',
    couleur: 200,            // teinte, en degrés
    email: '',
    tel: '',
    verrou: null,
    actif: true,
    /* Ce qui n'appartient qu'à cette personne : sa façon de travailler. */
    /* Ce qui appartient à la personne, pas au garage : son écran de départ,
       son thème, et la façon dont elle range son accueil. Trois personnes ne
       regardent pas les mêmes choses le matin. */
    preferences: {
      ecranAccueil: null, densite: null, theme: null,
      accueil: null,       // { ordre: [clés], caches: [clés] }
      raccourcis: null,    // [clés] ; null = ceux d'origine
      rail: false,         // le menu de gauche, sur grand écran
      /* null : on suit ce que le garage propose. Un objet de la même forme
         que `reglages.notifs` remplace, champ par champ, ce qui y figure. */
      notifs: null
    },
    cree: Date.now()
  }, champs);
}

/* ==========================================================================
   UN GARAGE NEUF
   L'outil s'ouvre vide : c'est un atelier qui va y mettre ses vrais clients,
   pas une vitrine. Le jeu de démonstration reste à un bouton des réglages.
   ========================================================================== */

export function neuf() {
  return {
    version: VERSION_MODELE,
    cree: Date.now(),
    reglages: copie(REGLAGES_DEFAUT),
    utilisateurs: [],
    clients: [],
    vehicules: [],
    dossiers: [],
    devis: [],
    factures: [],
    pieces: [],
    mouvements: [],
    fournisseurs: [],
    creneaux: [],
    interventions: [],
    prestations: [],
    taches: [],
    appels: [],
    credits: { solde: 0, historique: [] },   // crédits Autotuner
    journal: []
  };
}

/* ==========================================================================
   NORMALISATION
   Une sauvegarde faite avec une version antérieure ne connaît pas les champs
   d'aujourd'hui. Plutôt que de semer des `if (x.machin)` dans tout l'outil, on
   complète ici, une fois, au chargement. Le reste du code peut alors compter
   sur la forme.
   ========================================================================== */

const COLLECTIONS = ['utilisateurs', 'clients', 'vehicules', 'dossiers', 'devis', 'factures',
  'pieces', 'mouvements', 'fournisseurs', 'creneaux', 'interventions', 'prestations',
  'taches', 'appels', 'journal'];

/**
 * Est-ce vraiment une sauvegarde de l'outil ?
 *
 * `normaliser()` est volontairement indulgent : il complète ce qui manque et
 * ne rejette rien, parce qu'il sert à relire les vieilles sauvegardes. Cette
 * indulgence devient dangereuse au moment d'une RESTAURATION : un fichier
 * quelconque passerait, deviendrait un garage vide, et remplacerait les vraies
 * données. On demande donc des marques précises avant d'aller plus loin.
 */
export function estUneSauvegarde(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (!doc.reglages || typeof doc.reglages !== 'object' || Array.isArray(doc.reglages)) return false;
  /* Au moins trois des grandes collections doivent être présentes ET être des
     tableaux : un objet qui a « reglages » par hasard n'ira pas plus loin. */
  const presentes = ['clients', 'vehicules', 'dossiers', 'devis', 'factures', 'pieces', 'prestations']
    .filter(k => Array.isArray(doc[k]));
  return presentes.length >= 3;
}

/** Une vraie fiche : un objet, ni null, ni tableau, ni texte, ni nombre.
 *  C'est le seul filtre qui sépare des données abîmées d'un outil qui refuse
 *  de s'ouvrir. */
function estUneFiche(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Un tableau de fiches, débarrassé de ce qui n'en est pas. */
function tableauDeFiches(l) {
  return Array.isArray(l) ? l.filter(estUneFiche) : [];
}

export function normaliser(e) {
  if (!e || typeof e !== 'object') return neuf();

  /* --- l'ossature --------------------------------------------------------
     Chaque collection ne contient que de vraies fiches. Une entrée nulle ou
     un bout de texte égaré — un fichier de sauvegarde tronqué, une fusion
     ratée, un import à moitié écrit — faisait planter la normalisation, donc
     le chargement, donc l'outil entier : le garage se retrouvait devant
     l'écran de secours pour un `null` dans un tableau. On jette l'intrus et
     on garde le reste. */
  for (const c of COLLECTIONS) {
    e[c] = Array.isArray(e[c]) ? e[c].filter(estUneFiche) : [];
  }
  if (!e.credits || typeof e.credits !== 'object') e.credits = { solde: 0, historique: [] };
  e.credits.historique = Array.isArray(e.credits.historique)
    ? e.credits.historique.filter(estUneFiche) : [];
  if (typeof e.credits.solde !== 'number') e.credits.solde = 0;

  /* --- les réglages : on ajoute ce qui manque, on ne touche pas au reste -- */
  const versionLue = typeof e.version === 'number' ? e.version : 0;
  if (!e.reglages || typeof e.reglages !== 'object') e.reglages = {};
  const parDefaut = copie(REGLAGES_DEFAUT);
  for (const k in parDefaut) if (e.reglages[k] === undefined) e.reglages[k] = parDefaut[k];
  if (!e.reglages.nomsRangees || typeof e.reglages.nomsRangees !== 'object') e.reglages.nomsRangees = {};
  if (!e.reglages.typesPlaces || typeof e.reglages.typesPlaces !== 'object') e.reglages.typesPlaces = {};
  if (!Array.isArray(e.reglages.joursOuvres) || !e.reglages.joursOuvres.length) {
    e.reglages.joursOuvres = [1, 2, 3, 4, 5, 6];
  }

  /* Modèle 3 : le code à l'ouverture était demandé par défaut, et quelqu'un
     qui l'oubliait n'avait aucune porte de sortie. Le réglage passe à « non »
     pour les installations d'avant : on ne laisse personne dehors de son
     propre atelier. Celui qui le rallume ensuite le garde — la migration ne
     repasse pas, la version est enregistrée avec les données. */
  if (versionLue > 0 && versionLue < 3) e.reglages.demanderCode = false;

  /* --- les gens ---------------------------------------------------------- */
  e.utilisateurs.forEach(u => {
    if (!u.id) u.id = id('usr');
    if (!u.role || !ROLES[u.role]) u.role = 'technicien';
    if (typeof u.actif !== 'boolean') u.actif = true;
    if (!u.preferences || typeof u.preferences !== 'object') u.preferences = {};
    if (typeof u.couleur !== 'number') u.couleur = 200;
  });

  /* --- les clients ------------------------------------------------------- */
  e.clients.forEach(c => {
    if (!c.id) c.id = id('cli');
    if (c.type !== 'pro' && c.type !== 'part') c.type = 'part';
    /* Avant, la grille tarifaire se déduisait du type. Elle est maintenant
       explicite : un particulier peut avoir la grille pro (un ami, un ancien
       collègue) sans devenir une société. */
    if (!c.grille) c.grille = c.type === 'pro' ? 'pro' : 'part';
    if (typeof c.remise !== 'number') c.remise = 0;
    c.etiquettes = Array.isArray(c.etiquettes) ? c.etiquettes.filter(x => typeof x === 'string') : [];
    if (typeof c.archive !== 'boolean') c.archive = false;
  });

  /* --- les véhicules ------------------------------------------------------ */
  e.vehicules.forEach(v => {
    if (!v.id) v.id = id('veh');
    v.immat = plaqueNue(v.immat);
    if (!v.ecu || typeof v.ecu !== 'object') v.ecu = { marque: '', type: '', hw: '', sw: '', protocole: '' };
    if (!Array.isArray(v.photos)) v.photos = [];
    if (typeof v.archive !== 'boolean') v.archive = false;
  });

  /* --- les dossiers ------------------------------------------------------- */
  e.dossiers.forEach(d => {
    if (!d.id) d.id = id('dos');
    if (!CLES_ETAPES.includes(d.etape)) d.etape = 'accueil';
    if (!NATURES[d.nature]) d.nature = 'meca';
    if (!PRIORITES[d.priorite]) d.priorite = 'normale';
    if (!Array.isArray(d.assignes)) d.assignes = [];
    d.lignes = tableauDeFiches(d.lignes);
    d.checklist = tableauDeFiches(d.checklist);
    d.notes = tableauDeFiches(d.notes);
    if (!Array.isArray(d.photos)) d.photos = [];
    if (!Array.isArray(d.devisIds)) d.devisIds = [];
    if (typeof d.remiseGlobale !== 'number') d.remiseGlobale = 0;
    if (typeof d.archive !== 'boolean') d.archive = false;
    d.lignes.forEach(l => normaliserLigne(l));
    /* Une place occupée par un dossier rendu n'a plus lieu d'être : le
       véhicule est parti, la place est libre. */
    if (d.place && (d.etape === 'livre' || d.archive)) d.place = null;
  });

  /* --- devis et factures --------------------------------------------------- */
  e.devis.forEach(d => {
    if (!d.id) d.id = id('dev');
    if (!STATUTS_DEVIS[d.statut]) d.statut = 'brouillon';
    d.lignes = tableauDeFiches(d.lignes);
    d.lignes.forEach(l => normaliserLigne(l));
    if (typeof d.version !== 'number') d.version = 1;
    /* Un devis parti sans réponse et dont la validité est passée n'est plus
       un devis en attente : il est périmé, et il faut le voir comme tel. */
    if (d.statut === 'envoye' && d.valableJusquau && d.valableJusquau < Date.now()) {
      d.statut = 'expire';
    }
  });

  e.factures.forEach(f => {
    if (!f.id) f.id = id('fac');
    if (!STATUTS_FACTURE[f.statut]) f.statut = 'attente';
    f.lignes = tableauDeFiches(f.lignes);
    f.reglements = tableauDeFiches(f.reglements);
    f.lignes.forEach(l => normaliserLigne(l));
  });

  /* --- le stock ------------------------------------------------------------ */
  e.pieces.forEach(p => {
    if (!p.id) p.id = id('pie');
    if (typeof p.qte !== 'number' || !isFinite(p.qte)) p.qte = 0;
    if (typeof p.prixAchat !== 'number') p.prixAchat = 0;
    if (typeof p.prixVente !== 'number') p.prixVente = 0;
    if (typeof p.archive !== 'boolean') p.archive = false;
    if (!p.unite) p.unite = 'u';
    p.emplacement = String(p.emplacement || '').toUpperCase().trim();
  });

  e.mouvements.forEach(m => {
    if (!m.id) m.id = id('mvt');
    if (!SENS_MOUVEMENT[m.sens]) m.sens = 'sortie';
    if (typeof m.qte !== 'number') m.qte = 0;
  });

  /* --- planning ------------------------------------------------------------ */
  e.creneaux.forEach(c => {
    if (!c.id) c.id = id('cre');
    if (!TYPES_CRENEAU[c.type]) c.type = 'travaux';
    if (typeof c.debut !== 'number') c.debut = Date.now();
    /* Un créneau qui finit avant de commencer casse l'affichage : on lui rend
       une durée minimale plutôt que de le jeter. */
    if (typeof c.fin !== 'number' || c.fin <= c.debut) c.fin = c.debut + 30 * 60000;
  });

  /* --- électronique -------------------------------------------------------- */
  e.interventions.forEach(i => {
    if (!i.id) i.id = id('int');
    if (!ETATS_INTERVENTION[i.etat]) i.etat = 'prevu';
    if (!OPERATIONS_ELECTRO[i.operation]) i.operation = 'autre';
    if (!PROTOCOLES[i.protocole]) i.protocole = 'obd';
    if (!i.ecu || typeof i.ecu !== 'object') i.ecu = { marque: '', type: '', hw: '', sw: '' };

    /* Ce qu'on a changé dans le fichier. On jette les clés inconnues plutôt
       que d'afficher des pastilles vides, et on dédoublonne : une liste
       recopiée d'une intervention à l'autre peut avoir été enrichie deux fois. */
    i.modifications = Array.isArray(i.modifications)
      ? i.modifications.filter((m, n, l) => MODIFICATIONS_ELECTRO[m] && l.indexOf(m) === n)
      : [];
    /* Les contrôles : on ne garde que des vrais. Une case décochée n'a pas à
       occuper de place, et son absence se lit pareil. */
    const coches = {};
    if (i.controles && typeof i.controles === 'object') {
      for (const k in CONTROLES_ELECTRO) if (i.controles[k]) coches[k] = true;
    }
    i.controles = coches;

    i.fichiers = tableauDeFiches(i.fichiers);
    i.fichiers.forEach(f => {
      if (!f.id) f.id = id('fic');
      if (typeof f.nom !== 'string') f.nom = '';
      if (typeof f.ou !== 'string') f.ou = '';
      if (typeof f.taille !== 'number' || !isFinite(f.taille) || f.taille < 0) f.taille = 0;
      if (typeof f.quand !== 'number') f.quand = Date.now();
    });
    if (typeof i.credits !== 'number') i.credits = 0;
    /* Les interventions d'avant la réconciliation : celles qui étaient
       réussies avaient bien été débitées, on le note pour ne pas les
       débiter une seconde fois au prochain enregistrement. */
    if (typeof i.creditsDebites !== 'number') i.creditsDebites = (i.etat === 'ok' ? i.credits : 0);
  });

  /* --- catalogue ------------------------------------------------------------ */
  e.prestations.forEach(p => {
    if (!p.id) p.id = id('pst');
    if (typeof p.actif !== 'boolean') p.actif = true;
    if (typeof p.horsRoute !== 'boolean') p.horsRoute = false;
    if (typeof p.temps !== 'number') p.temps = 0;
    if (typeof p.prixHT !== 'number') p.prixHT = 0;
    if (typeof p.prixPro !== 'number') p.prixPro = 0;
  });

  e.taches.forEach(t => { if (!t.id) t.id = id('tac'); });
  e.appels.forEach(a => { if (!a.id) a.id = id('app'); });

  /* --- les compteurs ne reculent jamais ------------------------------------
     Un numéro de facture réutilisé, c'est une anomalie comptable. On remonte
     le compteur au-dessus du plus grand numéro déjà émis, quoi qu'il arrive. */
  e.reglages.compteurDevis = Math.max(e.reglages.compteurDevis || 1,
    plusGrandNumero(e.devis, e.reglages.prefixeDevis) + 1);
  e.reglages.compteurFacture = Math.max(e.reglages.compteurFacture || 1,
    plusGrandNumero(e.factures, e.reglages.prefixeFacture) + 1);
  e.reglages.compteurDossier = Math.max(e.reglages.compteurDossier || 1,
    plusGrandNumero(e.dossiers, e.reglages.prefixeDossier) + 1);

  e.version = VERSION_MODELE;
  return e;
}

function normaliserLigne(l) {
  if (!l.id) l.id = id('lig');
  if (!TYPES_LIGNE[l.type]) l.type = 'mo';
  if (typeof l.qte !== 'number' || !isFinite(l.qte)) l.qte = 1;
  if (typeof l.prixHT !== 'number' || !isFinite(l.prixHT)) l.prixHT = 0;
  if (typeof l.remise !== 'number' || !isFinite(l.remise)) l.remise = 0;
  /* Une commande ne se suit que sur une pièce, et seulement avec un état
     connu. Le reste retombe à « pas concerné » plutôt que d'afficher une
     pastille vide sur une ligne de main-d'œuvre. */
  if (l.type !== 'piece' || !ETATS_COMMANDE[l.commande]) l.commande = null;
  if (!l.commande) { l.fournisseurId = null; l.attendueLe = null; l.commandeLe = null; l.recueLe = null; }
  return l;
}

/** Le plus grand numéro déjà attribué dans une collection. */
function plusGrandNumero(liste, prefixe) {
  let maxi = 0;
  const motif = new RegExp('^' + String(prefixe || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '[-_]?(?:\\d{2,4}[-_]?)?(\\d+)$', 'i');
  for (const x of liste || []) {
    const m = motif.exec(String(x.numero || ''));
    if (m) maxi = Math.max(maxi, parseInt(m[1], 10) || 0);
  }
  return maxi;
}

/* ==========================================================================
   NUMÉROTATION
   Format : DV-2026-0042. L'année dans le numéro évite de recommencer à 1 tout
   en gardant un numéro court et lisible au téléphone.
   ========================================================================== */

export function prochainNumero(etat, quoi) {
  const r = etat.reglages;
  const cle = quoi === 'devis' ? 'compteurDevis'
    : quoi === 'facture' ? 'compteurFacture' : 'compteurDossier';
  const prefixe = quoi === 'devis' ? r.prefixeDevis
    : quoi === 'facture' ? r.prefixeFacture : r.prefixeDossier;
  const n = r[cle] || 1;
  r[cle] = n + 1;
  return prefixe + '-' + new Date().getFullYear() + '-' + String(n).padStart(4, '0');
}

/** Lit le prochain numéro sans le consommer : pour l'afficher avant validation. */
export function apercuNumero(etat, quoi) {
  const r = etat.reglages;
  const n = quoi === 'devis' ? r.compteurDevis
    : quoi === 'facture' ? r.compteurFacture : r.compteurDossier;
  const prefixe = quoi === 'devis' ? r.prefixeDevis
    : quoi === 'facture' ? r.prefixeFacture : r.prefixeDossier;
  return prefixe + '-' + new Date().getFullYear() + '-' + String(n || 1).padStart(4, '0');
}

/* ==========================================================================
   LIBELLÉS
   Les réglages permettent de renommer une étape ou un motif sans toucher au
   code : « Attente accord » devient « Attente client » si c'est le mot de la
   maison.
   ========================================================================== */

export function libelle(etat, famille, cle, defaut) {
  const perso = etat && etat.reglages && etat.reglages.libelles;
  if (perso && perso[famille + '.' + cle]) return perso[famille + '.' + cle];
  return defaut;
}

export function nomEtape(etat, cle) {
  const e = ETAPES.find(x => x.cle === cle);
  return libelle(etat, 'etape', cle, e ? e.nom : cle);
}

export const etape = (cle) => ETAPES.find(x => x.cle === cle) || ETAPES[0];
