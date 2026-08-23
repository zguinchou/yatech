/* ==========================================================================
   YATECH — écran « Réglages »
   --------------------------------------------------------------------------
   Tout ce qui se règle sans toucher au code, rangé par sujet. Chaque section a
   son adresse (#/reglages/argent) : on peut envoyer un lien à quelqu'un, et le
   bouton « retour » du navigateur fait ce qu'on attend.

   Il n'y a PAS de bouton « Enregistrer ». Chaque contrôle écrit au moment où
   on le quitte (événement `change`) : un réglage à moitié saisi puis oublié
   est un piège, et une page de trente champs avec un seul bouton en bas en
   est un autre.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, messageOk, messageErreur } from '../core/ui.js';
import { S, maj, instantane, remplacer, ecrireMaintenant } from '../core/store.js';
import * as base from '../core/db.js';
import { telecharger, nomDate, choisirFichier, lireTexte } from '../core/fichiers.js';
import * as fmt from '../core/fmt.js';
import { nombre, minutesEnHeure, heureEnMinutes, ecartJours, JOUR } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import {
  ROLES, ETAPES, TYPES_PLACE, OUTILS_ELECTRO,
  apercuNumero, nouvelUtilisateur, normaliser, neuf, estUneSauvegarde,
  FAMILLES_ALERTE } from '../domain/schema.js';
import { enTete, champ, tete } from '../ui/widgets.js';
import { appliquerApparence, MENU } from '../coque.js';
import { verrou } from '../core/crypto.js';
import * as veille from '../core/veille.js';

/* Les teintes proposées pour l'accent : huit repères bien séparés sur la roue,
   plutôt qu'un sélecteur libre où l'on tombe sur un orange illisible. */
const TEINTES = [38, 195, 320, 145, 265, 15, 90, 220];

/* Les jours de la semaine dans l'ordre français. La valeur est celle rendue
   par Date.getDay() : dimanche vaut 0, il ferme donc la liste. */
const JOURS_SEMAINE = [
  { valeur: 1, nom: 'Lundi' }, { valeur: 2, nom: 'Mardi' }, { valeur: 3, nom: 'Mercredi' },
  { valeur: 4, nom: 'Jeudi' }, { valeur: 5, nom: 'Vendredi' }, { valeur: 6, nom: 'Samedi' },
  { valeur: 0, nom: 'Dimanche' }
];

/* Les balises que l'on peut poser dans un modèle de message. */
const BALISES = [
  { balise: '{prenom}', quoi: 'le prénom du client' },
  { balise: '{numero}', quoi: 'le numéro du devis ou de la facture' },
  { balise: '{vehicule}', quoi: 'la marque et le modèle' },
  { balise: '{immat}', quoi: 'la plaque' },
  { balise: '{montant}', quoi: 'le montant TTC' },
  { balise: '{garage}', quoi: 'le nom du garage' },
  { balise: '{jour}', quoi: 'le jour du rendez-vous' },
  { balise: '{heure}', quoi: 'l’heure du rendez-vous' },
  { balise: '{prestation}', quoi: 'ce qui est prévu' },
  { balise: '{date}', quoi: 'la date du document' }
];

/* Un nom court par type de place : dans une case de 60 px, « Pont élévateur »
   ne tient pas. */
const PLACE_COURT = { normale: 'SOL', pont: 'PONT', couvert: 'ABRI', hs: 'HS' };

const SECTIONS = [
  { cle: 'entreprise',   nom: 'Entreprise',   icone: 'carte',    peindre: sectionEntreprise },
  { cle: 'argent',       nom: 'Argent',       icone: 'euro',     peindre: sectionArgent },
  { cle: 'documents',    nom: 'Documents',    icone: 'document', peindre: sectionDocuments },
  { cle: 'equipe',       nom: 'Équipe',       icone: 'clients',  peindre: sectionEquipe },
  { cle: 'atelier',      nom: 'Atelier',      icone: 'atelier',  peindre: sectionAtelier },
  { cle: 'parc',         nom: 'Parc',         icone: 'parc',     peindre: sectionParc },
  { cle: 'planning',     nom: 'Planning',     icone: 'planning', peindre: sectionPlanning },
  { cle: 'stock',        nom: 'Stock',        icone: 'stock',    peindre: sectionStock },
  { cle: 'electronique', nom: 'Électronique', icone: 'puce',     peindre: sectionElectronique },
  { cle: 'alertes',      nom: 'Alertes',      icone: 'cloche',   peindre: sectionAlertes,   pourTous: true },
  { cle: 'apparence',    nom: 'Apparence',    icone: 'soleil',   peindre: sectionApparence, pourTous: true },
  { cle: 'donnees',      nom: 'Données',      icone: 'archive',  peindre: sectionDonnees,   pourTous: true }
];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const patron = estPatron(ctx);
  const visibles = patron ? SECTIONS : SECTIONS.filter(s => s.pourTous);
  const demandee = String((ctx.params && ctx.params.onglet) || '');
  const section = visibles.find(s => s.cle === demandee) || visibles[0];

  const corps = h('div.pile');
  /* Repeindre seulement la section : le menu latéral garde son défilement et
     le champ que l'on vient de quitter ne saute pas sous les doigts. */
  const refaire = () => poser(corps, section.peindre(ctx, refaire));
  refaire();

  return h('div.pile', [
    enTete({
      titre: 'Réglages',
      sous: patron
        ? 'Ce qui se règle sans toucher au code'
        : 'Vous pouvez régler l’apparence ; le reste appartient au responsable.'
    }),
    !patron ? h('div.bandeau', [
      icone('info'),
      h('span', 'Les réglages du garage (facturation, équipe, atelier) sont réservés '
        + 'au responsable. Ils sont montrés ici en lecture seule.')
    ]) : null,
    h('div.reglages', [
      h('nav.reglages__menu', { 'aria-label': 'Sections des réglages' }, visibles.map(s =>
        h('a.lien', {
          href: '#/reglages/' + s.cle,
          'aria-current': s.cle === section.cle ? 'page' : null
        }, [icone(s.icone), h('span', s.nom)])
      )),
      corps
    ])
  ]);
}

const estPatron = (ctx) => !!(ctx.moi && ctx.moi.role === 'patron');

/* ==========================================================================
   LES BRIQUES COMMUNES
   ========================================================================== */

function panneau(titre, enfants, aide) {
  return h('div.panneau', [
    h('div.panneau__tete', [h('h2.grandit', titre)]),
    h('div.panneau__corps', [
      aide ? h('p.petit.faible', aide) : null,
      h('div', enfants.filter(Boolean))
    ])
  ]);
}

/** Une ligne de réglage : libellé + explication à gauche, contrôle à droite. */
function ligne(titre, aide, controle, taille) {
  return h('div.reglage-ligne', [
    h('div.reglage-ligne__texte', [
      h('b', titre),
      aide ? h('small', aide) : null
    ]),
    h('div.reglage-ligne__action.reglages__ctrl'
      + (taille ? '.reglages__ctrl--' + taille : ''), controle)
  ]);
}

/**
 * Fabrique la ligne ET le champ, branchés sur `etat.reglages`.
 * `lire`/`ecrire` permettent de viser autre chose qu'une clé simple.
 */
function reglage(ctx, o) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const c = champ({
    type: o.type || 'text',
    options: o.options,
    unite: o.unite,
    exemple: o.exemple,
    lignes: o.lignes,
    bloque: lecture,
    valeur: o.lire ? o.lire(e) : e.reglages[o.cle],
    surChangement: (v) => {
      const valeur = o.convertir ? o.convertir(v) : v;
      maj('Réglage : ' + o.titre, (etat) => {
        if (o.ecrire) o.ecrire(etat, valeur);
        else etat.reglages[o.cle] = valeur;
      });
      if (o.apres) o.apres(valeur, c);
    }
  });
  return ligne(o.titre, o.aide, c.noeud, o.taille);
}

/** Interrupteur oui/non. Plus lisible qu'une case pour un réglage tranché. */
function bascule(valeur, surChangement, bloque) {
  const bouton = h('button.bascule', {
    type: 'button',
    role: 'switch',
    'aria-checked': valeur ? 'true' : 'false',
    disabled: bloque,
    onclick: () => {
      const neuve = bouton.getAttribute('aria-checked') !== 'true';
      bouton.setAttribute('aria-checked', neuve ? 'true' : 'false');
      surChangement(neuve);
    }
  });
  return h('div.reglages__bascule', bouton);
}

function reglageBascule(ctx, o) {
  const e = ctx.etat;
  return ligne(o.titre, o.aide, bascule(!!(o.lire ? o.lire(e) : e.reglages[o.cle]), (v) => {
    maj('Réglage : ' + o.titre, (etat) => {
      if (o.ecrire) o.ecrire(etat, v); else etat.reglages[o.cle] = v;
    });
    if (o.apres) o.apres(v);
  }, !estPatron(ctx)), 's');
}

/** Interrupteur segmenté : deux ou trois choix exclusifs, tous visibles. */
function segments(options, valeur, surChoix, bloque) {
  return h('div.segments', options.map(o => h('button', {
    type: 'button',
    texte: o.texte,
    'aria-pressed': o.valeur === valeur ? 'true' : 'false',
    disabled: bloque,
    onclick: () => surChoix(o.valeur)
  })));
}

/* ==========================================================================
   ENTREPRISE
   ========================================================================== */

function sectionEntreprise(ctx) {
  const e = ctx.etat;
  const apercu = h('div.carte.carte--muette');
  const redessiner = () => poser(apercu, enTeteDocument(e));
  redessiner();

  const R = (o) => reglage(ctx, Object.assign({ apres: redessiner }, o));

  return h('div.pile', [
    panneau('Identité', [
      R({ cle: 'raisonSociale', titre: 'Raison sociale',
        aide: 'Le nom qui figure en haut des devis et des factures.', exemple: 'Garage Yatech', taille: 'l' }),
      R({ cle: 'formeJuridique', titre: 'Forme juridique',
        aide: 'SARL, SAS, entreprise individuelle…', exemple: 'SARL' }),
      R({ cle: 'capital', titre: 'Capital social',
        aide: 'À mentionner pour une société. Laissez vide sinon.', exemple: '10 000 €' })
    ]),

    panneau('Adresse et contact', [
      R({ cle: 'adresse', titre: 'Adresse', exemple: '12 rue des Ateliers', taille: 'l' }),
      R({ cle: 'cp', titre: 'Code postal', exemple: '69100', taille: 's' }),
      R({ cle: 'ville', titre: 'Ville', exemple: 'Villeurbanne' }),
      R({ cle: 'tel', titre: 'Téléphone', type: 'tel', exemple: '04 78 00 00 00' }),
      R({ cle: 'email', titre: 'Adresse e-mail', type: 'email', exemple: 'contact@exemple.fr', taille: 'l' }),
      R({ cle: 'siteWeb', titre: 'Site internet', exemple: 'www.exemple.fr', taille: 'l' })
    ]),

    panneau('Mentions légales', [
      R({ cle: 'siret', titre: 'SIRET',
        aide: 'Obligatoire sur toute facture.', exemple: '812 345 678 00019' }),
      R({ cle: 'tvaIntra', titre: 'TVA intracommunautaire',
        aide: 'Obligatoire dès que vous facturez de la TVA.', exemple: 'FR12812345678' }),
      R({ cle: 'rcs', titre: 'RCS', aide: 'Ville d’immatriculation et numéro.', exemple: 'RCS Lyon 812 345 678' }),
      R({ cle: 'ape', titre: 'Code APE', aide: 'Entretien et réparation : 4520A.', exemple: '4520A', taille: 's' }),
      R({ cle: 'assurance', titre: 'Assurance RC professionnelle',
        aide: 'Assureur et couverture géographique : la loi l’exige sur les factures de réparation.',
        exemple: 'AXA — France métropolitaine', taille: 'l' })
    ], 'Ces mentions sont reprises telles quelles en pied de devis et de facture.'),

    panneau('Coordonnées bancaires', [
      R({ cle: 'iban', titre: 'IBAN', aide: 'Imprimé sur la facture pour les virements.',
        exemple: 'FR76 3000 4000 0100 0000 0000 000', taille: 'l' }),
      R({ cle: 'bic', titre: 'BIC', exemple: 'BNPAFRPP' })
    ]),

    panneau('Ce que verra le client', [apercu],
      'L’en-tête tel qu’il apparaîtra en haut de vos documents imprimés.')
  ]);
}

function enTeteDocument(e) {
  const r = e.reglages;
  const lignes = [
    [r.adresse].filter(Boolean).join(''),
    [r.cp, r.ville].filter(Boolean).join(' '),
    [r.tel, r.email, r.siteWeb].filter(Boolean).join(' · '),
    [r.siret ? 'SIRET ' + r.siret : '', r.ape ? 'APE ' + r.ape : '', r.rcs].filter(Boolean).join(' · '),
    [r.tvaIntra ? 'TVA ' + r.tvaIntra : '',
      r.capital ? 'Capital ' + r.capital : ''].filter(Boolean).join(' · '),
    r.assurance ? 'Assurance RC pro : ' + r.assurance : '',
    [r.iban ? 'IBAN ' + r.iban : '', r.bic ? 'BIC ' + r.bic : ''].filter(Boolean).join(' · ')
  ].filter(Boolean);

  return h('div.pile-s', [
    h('div.gras.titre-typo', { style: { fontSize: 'var(--t-l)' } },
      [r.raisonSociale || 'Votre raison sociale', r.formeJuridique].filter(Boolean).join(' — ')),
    lignes.length
      ? h('div.petit.faible', lignes.map(t => h('div', t)))
      : h('div.petit.tres-faible', 'Remplissez les champs ci-dessus pour voir l’en-tête se composer.'),
    r.tvaApplicable === false
      ? h('div.minus.tres-faible', r.mentionFranchiseTva || '') : null
  ]);
}

/* ==========================================================================
   ARGENT
   ========================================================================== */

function sectionArgent(ctx, refaire) {
  const e = ctx.etat;
  const r = e.reglages;

  return h('div.pile', [
    panneau('Facturation', [
      reglage(ctx, {
        cle: 'devise', titre: 'Devise', type: 'liste',
        aide: 'Change l’affichage de tous les montants de l’outil.',
        options: [
          { valeur: 'EUR', texte: 'Euro (€)' },
          { valeur: 'CHF', texte: 'Franc suisse (CHF)' },
          { valeur: 'GBP', texte: 'Livre sterling (£)' },
          { valeur: 'USD', texte: 'Dollar ($)' }
        ],
        apres: (v) => { fmt.devise(v); refaire(); }
      }),
      reglageBascule(ctx, {
        cle: 'tvaApplicable', titre: 'TVA applicable',
        aide: 'Désactivez si vous êtes en franchise en base : les documents sortiront sans TVA, '
          + 'avec la mention légale à la place.',
        apres: () => refaire()
      }),
      reglage(ctx, {
        cle: 'tauxTva', titre: 'Taux de TVA', type: 'nombre', unite: '%',
        aide: r.tvaApplicable === false
          ? 'Sans effet tant que la TVA n’est pas applicable : gardé pour le jour où vous sortirez '
            + 'de la franchise.'
          : 'Le taux proposé par défaut sur chaque ligne. Il reste modifiable ligne à ligne.',
        taille: 's'
      }),
      /* La mention de franchise ne sert qu'à ceux qui ne facturent pas de TVA :
         la montrer aux autres, c'est une ligne de plus à lire pour rien. */
      r.tvaApplicable === false ? reglage(ctx, {
        cle: 'mentionFranchiseTva', titre: 'Mention de franchise',
        aide: 'Reprise en pied de devis et de facture, à la place du décompte de TVA.',
        exemple: 'TVA non applicable, art. 293 B du CGI', taille: 'l'
      }) : null,
      reglage(ctx, {
        cle: 'delaiPaiement', titre: 'Délai de paiement', type: 'nombre', unite: 'jours',
        aide: 'Sert à calculer l’échéance des factures et à repérer les impayés. '
          + '0 = paiement comptant, à l’enlèvement du véhicule.',
        taille: 's'
      })
    ]),

    panneau('Main-d’œuvre', [
      reglage(ctx, {
        cle: 'tauxHoraire', titre: 'Taux horaire particulier', type: 'euros', unite: '€ HT',
        aide: 'Le prix d’une heure d’atelier pour un client ordinaire.'
      }),
      reglage(ctx, {
        cle: 'tauxHorairePro', titre: 'Taux horaire professionnel', type: 'euros', unite: '€ HT',
        aide: 'Le prix pour un confrère ou un client en grille pro.'
      }),
      reglage(ctx, {
        cle: 'remiseProDefaut', titre: 'Remise professionnelle par défaut', type: 'nombre', unite: '%',
        aide: 'Appliquée aux pièces et forfaits du catalogue quand aucun prix pro n’est fixé.',
        taille: 's'
      }),
      reglage(ctx, {
        cle: 'arrondiHeure', titre: 'Arrondi du temps facturé', type: 'liste',
        aide: 'Le temps passé est arrondi au pas choisi, toujours vers le haut.',
        options: [
          { valeur: '0', texte: 'Pas d’arrondi' },
          { valeur: '0.1', texte: 'Au dixième d’heure (6 min)' },
          { valeur: '0.25', texte: 'Au quart d’heure' },
          { valeur: '0.5', texte: 'À la demi-heure' },
          { valeur: '1', texte: 'À l’heure entière' }
        ],
        lire: (etat) => String(nombre(etat.reglages.arrondiHeure, 0.25)),
        convertir: (v) => nombre(v, 0)
      })
    ]),

    panneau('Pièces et frais', [
      reglage(ctx, {
        cle: 'margeDefaut', titre: 'Marge par défaut sur les pièces', type: 'nombre', unite: '%',
        aide: 'Sert à proposer un prix de vente à partir du prix d’achat.',
        taille: 's'
      }),
      reglage(ctx, {
        cle: 'fraisGestion', titre: 'Frais de gestion', type: 'euros', unite: '€ HT',
        aide: 'Ingrédients et consommables ajoutés automatiquement. 0 pour ne rien ajouter.',
        taille: 's'
      })
    ])
  ]);
}

/* ==========================================================================
   DOCUMENTS
   ========================================================================== */

function sectionDocuments(ctx) {
  const e = ctx.etat;

  return h('div.pile', [
    panneau('Numérotation', [
      blocNumero(ctx, 'dossier', 'Dossier (ordre de réparation)', 'prefixeDossier', 'compteurDossier'),
      blocNumero(ctx, 'devis', 'Devis', 'prefixeDevis', 'compteurDevis'),
      blocNumero(ctx, 'facture', 'Facture', 'prefixeFacture', 'compteurFacture')
    ], 'Format : PRÉFIXE-ANNÉE-0001. L’année évite de repartir à 1 chaque janvier '
      + 'tout en gardant un numéro court à dicter au téléphone.'),

    panneau('Devis', [
      reglage(ctx, {
        cle: 'validiteDevis', titre: 'Validité d’un devis', type: 'nombre', unite: 'jours',
        aide: 'Passé ce délai sans réponse, le devis bascule en « périmé ».', taille: 's'
      }),
      reglage(ctx, {
        cle: 'mentionsDevis', titre: 'Mentions du devis', type: 'zone', lignes: 4,
        aide: 'Imprimées en pied de devis. {validite} y est remplacé par le nombre de jours.',
        taille: 'l'
      })
    ]),

    panneau('Facture', [
      reglage(ctx, {
        cle: 'mentionsFacture', titre: 'Mentions de la facture', type: 'zone', lignes: 4,
        aide: '{delai} et {penalites} y sont remplacés par les valeurs ci-dessous.', taille: 'l'
      }),
      reglage(ctx, {
        cle: 'penalitesRetard', titre: 'Pénalités de retard', type: 'zone', lignes: 3,
        aide: 'Mention obligatoire entre professionnels.', taille: 'l'
      }),
      reglage(ctx, {
        cle: 'mentionElectronique', titre: 'Mention électronique', type: 'zone', lignes: 4,
        aide: 'Ajoutée aux documents qui portent une reprogrammation de calculateur.', taille: 'l'
      })
    ]),

    panneauMessages(ctx)
  ]);
}

function blocNumero(ctx, quoi, titre, clePrefixe, cleCompteur) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const emis = dernierNumeroEmis(e, quoi);
  const plancher = emis + 1;

  const vu = h('code.num.gras');
  const redessiner = () => { vu.textContent = apercuNumero(e, quoi); };

  const prefixe = champ({
    valeur: e.reglages[clePrefixe], bloque: lecture, exemple: 'FA',
    surChangement: (v) => {
      maj('Réglage : préfixe ' + titre, (etat) => {
        etat.reglages[clePrefixe] = String(v || '').toUpperCase();
      });
      prefixe.ecrire(e.reglages[clePrefixe]);
      redessiner();
    }
  });

  let compteur;
  compteur = champ({
    type: 'nombre', valeur: e.reglages[cleCompteur], bloque: lecture,
    surChangement: (v) => {
      const demande = Math.max(1, Math.round(nombre(v, 1)));
      /* Un numéro déjà émis qui ressort une seconde fois, c'est une anomalie
         comptable : deux pièces différentes portant la même référence. On
         refuse plutôt que de laisser faire — et de toute façon la relecture
         du fichier au démarrage remonterait le compteur toute seule. */
      if (demande < plancher) {
        compteur.ecrire(e.reglages[cleCompteur]);
        compteur.erreur('Le plus grand numéro déjà émis est le ' + emis
          + '. Le compteur ne peut pas descendre en dessous de ' + plancher
          + ' : deux documents ne doivent jamais porter le même numéro.');
        return;
      }
      compteur.erreur(null);
      maj('Réglage : compteur ' + titre, (etat) => { etat.reglages[cleCompteur] = demande; });
      redessiner();
    }
  });

  redessiner();

  return h('div.reglage-ligne', [
    h('div.reglage-ligne__texte', [
      h('b', titre),
      h('small', [
        'Prochain numéro : ', vu,
        emis ? ' · dernier émis : n° ' + emis : ' · aucun document émis pour l’instant'
      ])
    ]),
    h('div.reglage-ligne__action.reglages__ctrl.reglages__ctrl--l', h('div.rang-s', [
      h('div.grandit', [h('div.minus.tres-faible', 'Préfixe'), prefixe.noeud]),
      h('div.grandit', [h('div.minus.tres-faible', 'Prochain n°'), compteur.noeud])
    ]))
  ]);
}

/** Le plus grand numéro déjà attribué, pour empêcher un compteur de reculer. */
function dernierNumeroEmis(e, quoi) {
  const r = e.reglages;
  const liste = quoi === 'devis' ? e.devis : (quoi === 'facture' ? e.factures : e.dossiers);
  const prefixe = quoi === 'devis' ? r.prefixeDevis
    : (quoi === 'facture' ? r.prefixeFacture : r.prefixeDossier);
  const motif = new RegExp('^' + String(prefixe || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '[-_]?(?:\\d{2,4}[-_]?)?(\\d+)$', 'i');
  let maxi = 0;
  for (const x of liste || []) {
    const m = motif.exec(String(x.numero || ''));
    if (m) maxi = Math.max(maxi, parseInt(m[1], 10) || 0);
  }
  return maxi;
}

function panneauMessages(ctx) {
  const modeles = [
    { cle: 'messageDevis', titre: 'Envoi d’un devis' },
    { cle: 'messagePret', titre: 'Véhicule prêt' },
    { cle: 'messageRelance', titre: 'Relance d’un devis' },
    { cle: 'messageRdv', titre: 'Confirmation de rendez-vous' },
    { cle: 'messageImpaye', titre: 'Relance d’un impayé' }
  ];

  return h('div.panneau', [
    h('div.panneau__tete', [h('h2.grandit', 'Modèles de messages')]),
    h('div.panneau__corps', [
      h('p.petit.faible', 'Ces textes sont proposés quand vous envoyez un SMS ou un e-mail. '
        + 'Les balises sont remplacées par les vraies valeurs au moment de l’envoi.'),
      h('div.rang-s.enroule', { style: { margin: 'var(--e-3) 0' } }, BALISES.map(b =>
        h('span.etiq', { title: b.quoi }, b.balise)
      )),
      h('div.pile', modeles.map(m => champ({
        etiquette: m.titre, type: 'zone', lignes: 4,
        valeur: ctx.etat.reglages[m.cle], bloque: !estPatron(ctx),
        surChangement: (v) => maj('Modèle de message : ' + m.titre,
          (etat) => { etat.reglages[m.cle] = v; })
      }).noeud))
    ])
  ]);
}

/* ==========================================================================
   ÉQUIPE
   ========================================================================== */

function sectionEquipe(ctx, refaire) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const gens = (e.utilisateurs || []).slice()
    .sort((a, b) => (b.actif ? 1 : 0) - (a.actif ? 1 : 0));

  return h('div.pile', [
    h('div.panneau', [
      h('div.panneau__tete', [
        h('h2.grandit', 'Les personnes'),
        lecture ? null : h('button.bt.bt--contour.bt--s', {
          type: 'button', onclick: () => modalePersonne(e, null, refaire)
        }, [icone('plus'), h('span', 'Ajouter une personne')])
      ]),
      gens.length ? h('div.liste', gens.map(u => ligneUtilisateur(ctx, u, refaire)))
        : h('div.panneau__corps', h('div.petit.faible.centre',
          'Personne dans l’équipe : ajoutez au moins vous-même.'))
    ]),

    h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Les rôles')]),
      h('div.panneau__corps', h('div.pile-s', Object.keys(ROLES).map(cle =>
        h('div.rang.rang-haut', [
          h('span.etiq', ROLES[cle].nom),
          h('span.petit.faible.grandit', ROLES[cle].aide)
        ])
      )))
    ]),

    panneau('Accès à l’outil', [
      reglageBascule(ctx, {
        cle: 'demanderCode', titre: 'Demander un code à l’ouverture',
        aide: 'Par défaut, non : l’outil s’ouvre directement sur la première '
          + 'personne active. Activez si plusieurs personnes se partagent le poste '
          + 'et que chacune doit retrouver ses écrans — posez alors un code par '
          + 'personne avec la clé, dans la liste ci-dessus.'
      }),
      reglage(ctx, {
        cle: 'verrouAuto', titre: 'Verrouillage automatique', type: 'nombre', unite: 'min',
        aide: 'Minutes d’inactivité avant que l’outil redemande le code. 0 = jamais.',
        taille: 's'
      })
    ])
  ]);
}

function ligneUtilisateur(ctx, u, refaire) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const role = ROLES[u.role] || ROLES.technicien;

  return h('div.liste__ligne.liste__ligne--muette', [
    tete(u),
    h('div.grandit.coupe', [
      h('div.gras.coupe', lit.nomUtilisateur(u)),
      h('div.petit.faible.coupe', [
        role.nom,
        u.verrou ? 'code posé' : 'sans code'
      ].join(' · '))
    ]),
    u.actif ? null : h('span.pastille', 'désactivée'),
    lecture ? null : h('div.rang-s', [
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Modifier ' + lit.nomUtilisateur(u),
        onclick: () => modalePersonne(e, u, refaire)
      }, icone('crayon')),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Couleur de ' + lit.nomUtilisateur(u),
        onclick: () => modaleCouleur(u, refaire)
      }, icone('etiquette')),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button',
        'aria-label': (u.verrou ? 'Changer le code de ' : 'Poser un code pour ')
          + lit.nomUtilisateur(u),
        onclick: () => modaleCode(u, refaire)
      }, icone('cle')),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': (u.actif ? 'Désactiver ' : 'Réactiver ') + lit.nomUtilisateur(u),
        onclick: () => basculerActif(e, u, refaire)
      }, icone(u.actif ? 'oeilBarre' : 'oeil'))
    ])
  ]);
}

function modalePersonne(e, u, refaire) {
  const prenom = champ({ etiquette: 'Prénom', valeur: u ? u.prenom : '', autofocus: true });
  const nom = champ({ etiquette: 'Nom', valeur: u ? u.nom : '' });
  const aide = h('div.petit.faible');
  const role = champ({
    etiquette: 'Rôle', type: 'liste', valeur: u ? u.role : 'technicien',
    options: Object.keys(ROLES).map(k => ({ valeur: k, texte: ROLES[k].nom })),
    surChangement: (v) => { aide.textContent = (ROLES[v] || {}).aide || ''; }
  });
  aide.textContent = (ROLES[u ? u.role : 'technicien'] || {}).aide || '';
  const email = champ({ etiquette: 'E-mail', type: 'email', valeur: u ? u.email : '' });
  const tel = champ({ etiquette: 'Téléphone', type: 'tel', valeur: u ? u.tel : '' });

  modale({
    titre: u ? 'Modifier ' + lit.nomUtilisateur(u) : 'Ajouter une personne',
    corps: h('div.pile', [prenom.noeud, nom.noeud, role.noeud, aide, email.noeud, tel.noeud]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: u ? 'Enregistrer' : 'Ajouter', ton: 'fort',
        faire: () => {
          if (!prenom.lire() && !nom.lire()) {
            prenom.erreur('Il faut au moins un prénom.');
            return false;
          }
          const champs = {
            prenom: prenom.lire(), nom: nom.lire(), role: role.lire(),
            email: email.lire(), tel: tel.lire()
          };
          if (u) {
            maj('Fiche de ' + lit.nomUtilisateur(u) + ' modifiée', (etat) => {
              const x = etat.utilisateurs.find(y => y.id === u.id);
              if (x) Object.assign(x, champs);
            });
          } else {
            maj('Personne ajoutée à l’équipe', (etat) => {
              /* Sans verrou, la personne choisit son code à sa première
                 connexion : personne n'a à lui en inventer un. */
              etat.utilisateurs.push(nouvelUtilisateur(Object.assign({
                couleur: TEINTES[etat.utilisateurs.length % TEINTES.length]
              }, champs)));
            });
          }
          messageOk(u ? 'Fiche mise à jour' : 'Personne ajoutée');
          refaire();
        }
      }
    ]
  });
}

function modaleCouleur(u, refaire) {
  let choisie = nombre(u.couleur, 200);
  const palette = h('div.teintes');

  const redessiner = () => poser(palette, TEINTES.map(t => h('button.teinte', {
    type: 'button',
    'aria-label': 'Teinte ' + t,
    'aria-pressed': t === choisie ? 'true' : 'false',
    style: { background: 'hsl(' + t + ' 62% 48%)' },
    onclick: () => { choisie = t; redessiner(); }
  })));
  redessiner();

  modale({
    titre: 'Couleur de ' + lit.nomUtilisateur(u),
    corps: h('div.pile', [
      h('p.petit.faible', 'Cette teinte sert à reconnaître la personne d’un coup d’œil : '
        + 'sur le planning, dans les dossiers, sur les pastilles d’initiales.'),
      palette
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Appliquer', ton: 'fort',
        faire: () => {
          maj('Couleur de ' + lit.nomUtilisateur(u) + ' changée', (etat) => {
            const x = etat.utilisateurs.find(y => y.id === u.id);
            if (x) x.couleur = choisie;
          });
          refaire();
        }
      }
    ]
  });
}

/* Poser, changer ou retirer le code de quelqu'un.
   On le tape deux fois : un code à quatre chiffres qu'on ne relit jamais et
   qu'on a mal tapé une fois, c'est quelqu'un dehors le lendemain matin. */
function modaleCode(u, refaire) {
  const chiffres = (etiquette, auto) => {
    const entree = h('input.saisie.saisie--num', {
      type: 'password', inputmode: 'numeric', autocomplete: 'off',
      maxlength: 4, placeholder: '••••', autofocus: auto || undefined,
      oninput: (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4); }
    });
    return { noeud: h('div.champ', [h('label', etiquette), entree]), entree };
  };

  const a = chiffres('Nouveau code (4 chiffres)', true);
  const b = chiffres('Le même, pour être sûr');
  const erreur = h('div.champ__erreur');

  modale({
    titre: (u.verrou ? 'Changer le code de ' : 'Poser un code pour ') + lit.nomUtilisateur(u),
    corps: h('div.pile', [
      h('p.petit.faible', 'Le code sépare les rôles au comptoir : il évite qu’un '
        + 'client lise les chiffres par-dessus votre épaule. Il ne chiffre rien — '
        + 'les données restent lisibles par qui a cet appareil en main.'),
      a.noeud, b.noeud, erreur,
      u.verrou ? h('div.petit.faible', 'Un code oublié se retire depuis l’écran '
        + 'de connexion : personne ne reste enfermé dehors.') : null,
      S.etat.reglages.demanderCode === false ? h('div.bandeau', [
        icone('info'),
        h('span', 'Le code ne sera pas demandé tant que « Demander un code à '
          + 'l’ouverture » reste éteint, plus bas sur cet écran.')
      ]) : null
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      u.verrou ? {
        texte: 'Retirer le code', ton: 'danger',
        faire: async () => {
          const ok = await confirmer({
            titre: 'Retirer le code ?',
            texte: lit.nomUtilisateur(u) + ' entrera sans rien taper.',
            ok: 'Retirer', danger: true
          });
          if (!ok) return false;
          maj('Code de ' + lit.nomUtilisateur(u) + ' retiré', (etat) => {
            const x = etat.utilisateurs.find(y => y.id === u.id);
            if (x) x.verrou = null;
          });
          messageOk('Code retiré');
          refaire();
        }
      } : null,
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: () => {
          const c1 = a.entree.value, c2 = b.entree.value;
          if (c1.length !== 4) { erreur.textContent = 'Il faut quatre chiffres.'; return false; }
          if (c1 !== c2) {
            erreur.textContent = 'Les deux saisies ne correspondent pas.';
            b.entree.value = ''; b.entree.focus();
            return false;
          }
          const v = verrou(c1);
          maj('Code de ' + lit.nomUtilisateur(u) + ' enregistré', (etat) => {
            const x = etat.utilisateurs.find(y => y.id === u.id);
            if (x) x.verrou = v;
          });
          messageOk('Code enregistré. Retenez-le : il n’est plus affiché.');
          refaire();
        }
      }
    ]
  });
}

async function basculerActif(e, u, refaire) {
  const patronsActifs = (e.utilisateurs || [])
    .filter(x => x.actif && x.role === 'patron' && x.id !== u.id).length;
  /* Désactiver le dernier responsable enferme tout le monde dehors : plus
     personne ne peut rouvrir les réglages pour le réactiver. */
  if (u.actif && u.role === 'patron' && patronsActifs === 0) {
    messageErreur('C’est le dernier responsable actif : nommez quelqu’un d’autre avant.');
    return;
  }
  if (u.actif) {
    const ok = await confirmer({
      titre: 'Désactiver ' + lit.nomUtilisateur(u) + ' ?',
      texte: 'La personne disparaît de la connexion et des listes d’assignation.',
      detail: 'Son travail passé reste dans les dossiers et au journal. C’est réversible.',
      ok: 'Désactiver', danger: true
    });
    if (!ok) return;
  }
  maj(lit.nomUtilisateur(u) + (u.actif ? ' désactivée' : ' réactivée'), (etat) => {
    const x = etat.utilisateurs.find(y => y.id === u.id);
    if (x) x.actif = !x.actif;
  });
  refaire();
}

/* ==========================================================================
   ATELIER
   ========================================================================== */

function sectionAtelier(ctx) {
  return h('div.pile', [
    panneau('Nom des étapes', ETAPES.map(et => reglage(ctx, {
      titre: et.nom,
      aide: et.aide || '',
      exemple: et.nom,
      taille: 'l',
      lire: (etat) => (etat.reglages.libelles || {})['etape.' + et.cle] || '',
      ecrire: (etat, v) => {
        if (!etat.reglages.libelles) etat.reglages.libelles = {};
        /* Vider le champ, c'est revenir au nom d'origine : on retire la clé
           plutôt que de ranger une chaîne vide qui masquerait tout. */
        if (String(v || '').trim()) etat.reglages.libelles['etape.' + et.cle] = String(v).trim();
        else delete etat.reglages.libelles['etape.' + et.cle];
      }
    })), 'Laissez vide pour garder le nom d’origine. Le changement se voit partout : '
      + 'colonnes de l’atelier, pastilles, filtres.'),

    panneau('Relances', [
      reglage(ctx, {
        cle: 'relanceDevis', titre: 'Relancer un devis après', type: 'nombre', unite: 'jours',
        aide: 'Sans réponse du client passé ce délai, le devis remonte dans les alertes.',
        taille: 's'
      }),
      reglage(ctx, {
        cle: 'relanceImpaye', titre: 'Relancer un impayé après', type: 'nombre', unite: 'jours',
        aide: 'Compté à partir de l’échéance de la facture.', taille: 's'
      }),
      reglage(ctx, {
        cle: 'rappelEbp', titre: 'Rappel de saisie EBP', type: 'nombre', unite: 'min',
        aide: 'Délai avant de rappeler qu’un document attend d’être repassé dans EBP. 0 = jamais.',
        taille: 's'
      })
    ])
  ]);
}

/* ==========================================================================
   PARC
   ========================================================================== */

function sectionParc(ctx, refaire) {
  const e = ctx.etat;
  const lettres = 'ABCDEFGHIJKLMNOPQRST';
  const rangees = Math.max(1, Math.min(20, nombre(e.reglages.parcRangees, 3)));

  return h('div.pile', [
    panneau('Dimensions', [
      reglage(ctx, {
        cle: 'parcColonnes', titre: 'Places par rangée', type: 'nombre',
        aide: 'De 1 à 20.', taille: 's',
        convertir: (v) => Math.max(1, Math.min(20, Math.round(nombre(v, 6)))),
        apres: refaire
      }),
      reglage(ctx, {
        cle: 'parcRangees', titre: 'Nombre de rangées', type: 'nombre',
        aide: 'Chaque rangée porte une lettre : A, B, C…', taille: 's',
        convertir: (v) => Math.max(1, Math.min(20, Math.round(nombre(v, 3)))),
        apres: refaire
      })
    ]),

    panneau('Nom des rangées', Array.from({ length: rangees }, (v, i) => {
      const lettre = lettres[i];
      return reglage(ctx, {
        titre: 'Rangée ' + lettre,
        aide: 'Le repère de l’atelier : « côté portail », « le long du mur »…',
        exemple: 'Rangée ' + lettre, taille: 'l',
        lire: (etat) => (etat.reglages.nomsRangees || {})[lettre] || '',
        ecrire: (etat, val) => {
          if (!etat.reglages.nomsRangees) etat.reglages.nomsRangees = {};
          if (String(val || '').trim()) etat.reglages.nomsRangees[lettre] = String(val).trim();
          else delete etat.reglages.nomsRangees[lettre];
        }
      });
    })),

    h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Type de chaque place')]),
      h('div.panneau__corps', [
        h('p.petit.faible', 'Touchez une place pour faire tourner son type : '
          + Object.keys(TYPES_PLACE).map(k => TYPES_PLACE[k].nom).join(' → ') + ' → …'),
        grilleTypesPlaces(ctx, refaire)
      ])
    ]),

    panneau('Alerte d’immobilisation', [
      reglage(ctx, {
        cle: 'parcAlerteJours', titre: 'Signaler au bout de', type: 'nombre', unite: 'jours',
        aide: 'La place passe en orange : le véhicule traîne.', taille: 's'
      }),
      reglage(ctx, {
        cle: 'parcAlerteGrave', titre: 'Alerte grave au bout de', type: 'nombre', unite: 'jours',
        aide: 'La place passe en rouge et remonte dans les alertes : c’est une ventouse.',
        taille: 's'
      })
    ])
  ]);
}

function grilleTypesPlaces(ctx, refaire) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const colonnes = Math.max(1, Math.min(20, nombre(e.reglages.parcColonnes, 6)));
  const cles = Object.keys(TYPES_PLACE);
  const prises = lit.occupation(e);

  return h('div.parc', h('div.parc__plan', {
    style: { gridTemplateColumns: 'repeat(' + colonnes + ', minmax(56px, 90px))' }
  }, lit.places(e).map(p => {
    const occupee = prises.has(p.code);
    return h('button.place' + (p.type === 'hs' ? '.place--hs' : '')
      + (occupee ? '.place--prise' : ''), {
      type: 'button',
      disabled: lecture,
      title: TYPES_PLACE[p.type].nom + (occupee ? ' — occupée' : ''),
      onclick: () => {
        const suivant = cles[(cles.indexOf(p.type) + 1) % cles.length];
        /* Déclarer inutilisable une place où dort un véhicule ferait mentir le
           plan du parc : on refuse tant qu'elle n'est pas libérée. */
        if (suivant === 'hs' && occupee) {
          messageErreur('La place ' + p.code + ' est occupée : sortez le véhicule d’abord.');
          return;
        }
        maj('Type de la place ' + p.code, (etat) => {
          if (!etat.reglages.typesPlaces) etat.reglages.typesPlaces = {};
          if (suivant === 'normale') delete etat.reglages.typesPlaces[p.code];
          else etat.reglages.typesPlaces[p.code] = suivant;
        });
        refaire();
      }
    }, [
      h('span.place__num', p.code),
      h('span.place__plaque', PLACE_COURT[p.type] || p.type),
      occupee ? h('span.place__modele', 'occupée') : null
    ]);
  })));
}

/* ==========================================================================
   PLANNING
   ========================================================================== */

function sectionPlanning(ctx, refaire) {
  const e = ctx.etat;
  const lecture = !estPatron(ctx);
  const ouvres = Array.isArray(e.reglages.joursOuvres) ? e.reglages.joursOuvres : [];

  const cases = h('div.rang-s.enroule', JOURS_SEMAINE.map(j => {
    const c = champ({
      type: 'coche', etiquette: j.nom, valeur: ouvres.includes(j.valeur), bloque: lecture,
      surChangement: (v) => {
        maj('Jours ouvrés', (etat) => {
          const liste = new Set(etat.reglages.joursOuvres || []);
          if (v) liste.add(j.valeur); else liste.delete(j.valeur);
          /* Une semaine sans aucun jour ouvré vide le planning et bloque toute
             prise de rendez-vous : on garde au moins le jour décoché. */
          if (!liste.size) { liste.add(j.valeur); }
          etat.reglages.joursOuvres = Array.from(liste).sort();
        });
        refaire();
      }
    });
    return c.noeud;
  }));

  return h('div.pile', [
    h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Jours ouvrés')]),
      h('div.panneau__corps', [
        h('p.petit.faible', 'Les jours fermés n’apparaissent pas au planning et ne sont pas '
          + 'proposés aux confrères.'),
        cases
      ])
    ]),

    panneau('Horaires', [
      reglageHeure(ctx, 'heureDebut', 'Ouverture', 'Première case du planning.'),
      reglageHeure(ctx, 'heureFin', 'Fermeture', 'Dernière case du planning.'),
      reglageHeure(ctx, 'pauseDebut', 'Début de pause', 'La bande grisée du midi.'),
      reglageHeure(ctx, 'pauseFin', 'Fin de pause', '')
    ]),

    panneau('Réservations', [
      reglage(ctx, {
        cle: 'pasPlanning', titre: 'Pas du planning', type: 'liste',
        aide: 'La hauteur d’une case. Plus le pas est fin, plus la journée est longue à faire défiler.',
        options: [
          { valeur: '15', texte: '15 minutes' },
          { valeur: '30', texte: '30 minutes' },
          { valeur: '60', texte: '1 heure' }
        ],
        lire: (etat) => String(nombre(etat.reglages.pasPlanning, 30)),
        convertir: (v) => nombre(v, 30)
      }),
      reglage(ctx, {
        cle: 'dureeDefaut', titre: 'Durée par défaut', type: 'nombre', unite: 'min',
        aide: 'Proposée à la création d’un créneau.', taille: 's'
      }),
      reglage(ctx, {
        cle: 'joursReservablesPro', titre: 'Horizon confrère', type: 'nombre', unite: 'jours',
        aide: 'Jusqu’où un confrère peut réserver un créneau depuis son espace.',
        taille: 's'
      })
    ])
  ]);
}

/** Les heures sont rangées en « HH:MM » ; le champ « heure » rend des minutes. */
function reglageHeure(ctx, cle, titre, aide) {
  const e = ctx.etat;
  let c;
  c = champ({
    type: 'heure', valeur: e.reglages[cle], bloque: !estPatron(ctx),
    surChangement: (v) => {
      /* Un champ d'heure vidé rend null. Ranger une chaîne vide viderait le
         planning de la journée : on remet l'horaire d'avant. */
      if (typeof v !== 'number') { c.ecrire(e.reglages[cle]); return; }
      maj('Réglage : ' + titre, (etat) => { etat.reglages[cle] = minutesEnHeure(v); });
    }
  });
  return ligne(titre, aide, c.noeud, 's');
}

/* ==========================================================================
   STOCK
   ========================================================================== */

function sectionStock(ctx) {
  return h('div.pile', [
    panneau('Valeurs par défaut', [
      reglage(ctx, {
        cle: 'stockAlerteDefaut', titre: 'Seuil d’alerte par défaut', type: 'nombre', unite: 'u',
        aide: 'Utilisé quand une pièce ne fixe pas son propre seuil.', taille: 's'
      }),
      reglage(ctx, {
        cle: 'margeDefaut', titre: 'Marge par défaut', type: 'nombre', unite: '%',
        aide: 'Sert à proposer un prix de vente à partir du prix d’achat. '
          + 'C’est le même réglage que dans la section Argent.', taille: 's'
      })
    ]),

    panneau('Rangement', [
      reglageBascule(ctx, {
        cle: 'emplacementsAuto', titre: 'Proposer un emplacement',
        aide: 'À la création d’une pièce, l’outil propose le prochain bac libre.'
      }),
      reglage(ctx, {
        cle: 'inventaireRappel', titre: 'Rappel d’inventaire', type: 'nombre', unite: 'jours',
        aide: 'Délai conseillé entre deux inventaires. 0 = pas de rappel.', taille: 's'
      })
    ])
  ]);
}

/* ==========================================================================
   ALERTES
   --------------------------------------------------------------------------
   Ce que l'outil a le droit de faire pour attirer l'attention. Chacun règle le
   sien : c'est lui qu'on dérange.

   On dit franchement ce que ça fait et ce que ça ne fait pas. Un écran qui
   promet des avertissements et n'en envoie pas quand l'onglet est fermé, c'est
   pire que pas d'avertissement du tout.
   ========================================================================== */

function sectionAlertes(ctx, refaire) {
  const e = ctx.etat;
  const moi = ctx.moi;
  const r = veille.reglagesDe(e.reglages, moi);
  const permission = veille.etatPermission();

  /* Toute case cochée ici est enregistrée SUR LA PERSONNE : le garage propose,
     chacun dispose. Ce qui n'a jamais été touché continue de suivre le garage. */
  const poser = (champs) => {
    if (!moi) return;
    const avant = (moi.preferences && moi.preferences.notifs) || {};
    const apres = Object.assign({}, avant, champs);
    if (champs.quoi) apres.quoi = Object.assign({}, avant.quoi || {}, champs.quoi);
    moi.preferences = Object.assign({}, moi.preferences, { notifs: apres });
    maj('Réglage des alertes', (etat) => {
      const u = lit.utilisateur(etat, moi.id);
      if (!u) return;
      const a = (u.preferences && u.preferences.notifs) || {};
      const b = Object.assign({}, a, champs);
      if (champs.quoi) b.quoi = Object.assign({}, a.quoi || {}, champs.quoi);
      u.preferences = Object.assign({}, u.preferences, { notifs: b });
    });
    refaire();
  };

  const pretes = permission === 'granted';

  return h('div.pile', [
    /* --- ce que ça fait, sans enjoliver ---------------------------------- */
    h('div.bandeau', [
      icone('info'),
      h('div.grandit', [
        h('div.gras', 'Ce que l’outil peut faire, et ce qu’il ne peut pas.'),
        h('div.petit', 'Il fait apparaître un avertissement par-dessus les autres '
          + 'fenêtres quand quelque chose arrive — un appel à rappeler, une pièce en '
          + 'retard, un créneau demandé. Cela ne marche que si Yatech est ouvert '
          + 'quelque part, même en arrière-plan : tous les onglets fermés, plus rien. '
          + 'Il n’envoie ni SMS ni e-mail tout seul ; pour joindre quelqu’un qui n’est '
          + 'pas devant l’écran, servez-vous de « Prévenir » depuis la cloche.')
      ])
    ]),

    permission === 'impossible'
      ? h('div.bandeau.bandeau--alerte', [
          icone('alerte'),
          h('span', 'Ce navigateur ne sait pas afficher d’avertissement. Le reste de '
            + 'l’outil fonctionne normalement ; la cloche en haut garde la liste.')
        ])
      : null,

    permission === 'denied'
      ? h('div.bandeau.bandeau--danger', [
          icone('alerte'),
          h('div.grandit', [
            h('div.gras', 'Les avertissements sont refusés pour ce site.'),
            h('div.petit', 'C’est le navigateur qui décide, pas l’outil : il faut '
              + 'les réautoriser dans ses réglages de site (le cadenas à côté de '
              + 'l’adresse), puis revenir ici.')
          ])
        ])
      : null,

    panneau('Sur cet appareil', [
      ligne('Avertissements du navigateur',
        pretes ? 'Autorisés. Cet appareil peut faire apparaître des bulles.'
          : 'À autoriser une fois par appareil et par navigateur.',
        permission === 'default'
          ? h('button.bt.bt--fort', {
              type: 'button',
              onclick: async () => {
                await veille.demanderPermission();
                refaire();
              }
            }, [icone('cloche'), h('span', 'Autoriser')])
          : h('span.pastille.pastille--' + (pretes ? 'ok' : 'danger'),
              pretes ? 'autorisés' : 'refusés')),

      pretes ? ligne('Voir à quoi ça ressemble',
        'Une bulle d’essai, tout de suite.',
        h('button.bt.bt--contour', {
          type: 'button',
          onclick: () => {
            if (!veille.essai(r)) messageErreur('Le navigateur n’a rien affiché.');
          }
        }, 'Essayer')) : null
    ]),

    panneau('Me prévenir', [
      ligne('Recevoir des avertissements',
        moi ? 'Pour ' + lit.nomUtilisateur(moi) + ', sur tous ses appareils autorisés.'
          : 'Personne n’est connecté.',
        bascule(!!r.actives, (v) => poser({ actives: v }), !moi)),

      ligne('Un petit son avec',
        'Court, fabriqué par le navigateur. Rien à télécharger.',
        bascule(!!r.son, (v) => poser({ son: v }), !moi))
    ]),

    panneau('De quoi', Object.keys(FAMILLES_ALERTE).map(cle =>
      ligne(FAMILLES_ALERTE[cle].nom, null,
        bascule(r.quoi[cle] !== false, (v) => poser({ quoi: { [cle]: v } }), !moi))
    )),

    panneau('La paix', [
      ligne('Ne pas déranger le soir et la nuit',
        r.silenceActif
          ? 'De ' + minutesEnHeure(nombre(r.silenceDe, 0)) + ' à '
            + minutesEnHeure(nombre(r.silenceA, 0)) + '. Rien ne sonne pendant ce temps.'
          : 'L’outil peut avertir à toute heure.',
        bascule(!!r.silenceActif, (v) => poser({ silenceActif: v }), !moi)),

      r.silenceActif ? ligne('À partir de', null,
        h('input.saisie', {
          type: 'time', step: 300, value: minutesEnHeure(nombre(r.silenceDe, 0)),
          style: { maxWidth: '9rem' },
          onchange: (ev) => poser({ silenceDe: heureEnMinutes(ev.target.value) })
        })) : null,

      r.silenceActif ? ligne('Jusqu’à', null,
        h('input.saisie', {
          type: 'time', step: 300, value: minutesEnHeure(nombre(r.silenceA, 0)),
          style: { maxWidth: '9rem' },
          onchange: (ev) => poser({ silenceA: heureEnMinutes(ev.target.value) })
        })) : null
    ]),

    estPatron(ctx) ? panneau('Ce que le garage propose', [
      h('div.panneau__corps', h('div.petit.faible',
        'Ces réglages servent de point de départ à qui n’a rien choisi. '
        + 'Ils ne défont pas les choix déjà faits par quelqu’un.')),
      reglageBascule(ctx, {
        cle: 'notifs.actives', titre: 'Avertir, par défaut',
        lire: (etat) => !!(etat.reglages.notifs || {}).actives,
        ecrire: (etat, v) => {
          etat.reglages.notifs = Object.assign({}, etat.reglages.notifs, { actives: v });
        },
        aide: 'Pour les personnes qui n’ont pas encore réglé les leurs.'
      })
    ]) : null
  ]);
}

/* ==========================================================================
   ÉLECTRONIQUE
   ========================================================================== */

function sectionElectronique(ctx) {
  const e = ctx.etat;
  const moyen = coutMoyenCredit(e);

  return h('div.pile', [
    panneau('Outils', [
      reglage(ctx, {
        cle: 'outilDefaut', titre: 'Outil par défaut', type: 'liste',
        aide: 'Proposé à l’ouverture d’une intervention.',
        options: Object.keys(OUTILS_ELECTRO).map(k => ({ valeur: k, texte: OUTILS_ELECTRO[k] }))
      })
    ]),

    panneau('Crédits', [
      reglageBascule(ctx, {
        cle: 'suiviCredits', titre: 'Suivre les crédits',
        aide: 'Autotuner vend l’accès aux protocoles au crédit : le compteur '
          + 'prévient avant d’être à sec en plein travail. Éteignez si votre '
          + 'outil est sous abonnement ou déjà débloqué — les crédits '
          + 'disparaissent alors partout, les interventions restent.'
      }),
      reglage(ctx, {
        cle: 'creditsAlerte', titre: 'Seuil d’alerte des crédits', type: 'nombre', unite: 'crédits',
        aide: 'En dessous, l’outil prévient avant que le bench soit à sec. '
          + 'Solde actuel : ' + lit.soldeCredits(e) + '.', taille: 's'
      }),
      reglage(ctx, {
        cle: 'prixCredit', titre: 'Prix d’un crédit', type: 'euros', unite: '€ HT',
        aide: moyen === null
          ? 'Sert à calculer la marge d’une reprogrammation. Aucune recharge enregistrée pour l’instant.'
          : 'Sert à calculer la marge d’une reprogrammation. Coût moyen constaté sur vos recharges : '
            + fmt.euros(moyen) + '.'
      })
    ])
  ]);
}

/** Ce qu'un crédit a réellement coûté, tous achats confondus. Plus honnête que
 *  le prix affiché du dernier pack, qui varie avec les promotions. */
function coutMoyenCredit(e) {
  const recharges = ((e.credits && e.credits.historique) || [])
    .filter(x => x.sens === 'entree' && nombre(x.n) > 0 && nombre(x.cout) > 0);
  if (!recharges.length) return null;
  const cout = recharges.reduce((t, x) => t + nombre(x.cout), 0);
  const n = recharges.reduce((t, x) => t + nombre(x.n), 0);
  return n ? cout / n : null;
}

/* ==========================================================================
   APPARENCE
   ========================================================================== */

function sectionApparence(ctx, refaire) {
  const e = ctx.etat;
  const r = e.reglages;
  const lecture = !estPatron(ctx);

  /* L'apparence doit changer sous les yeux : un thème qui n'arrive qu'au
     prochain écran donne l'impression que le bouton n'a pas marché. */
  const poserEtAppliquer = (quoi, champs) => {
    maj(quoi, (etat) => Object.assign(etat.reglages, champs));
    appliquerApparence(S.etat.reglages);
    refaire();
  };

  return h('div.pile', [
    panneau('Thème', [
      ligne('Clair ou sombre', '« Automatique » suit le réglage du téléphone ou de l’ordinateur.',
        segments([
          { valeur: 'auto', texte: 'Automatique' },
          { valeur: 'clair', texte: 'Clair' },
          { valeur: 'sombre', texte: 'Sombre' }
        ], r.theme || 'auto', (v) => poserEtAppliquer('Thème : ' + v, { theme: v }), lecture), 'l'),

      ligne('Teinte d’accent', 'La couleur des boutons, des liens et des sélections.',
        h('div.teintes', TEINTES.map(t => h('button.teinte', {
          type: 'button',
          'aria-label': 'Teinte ' + t,
          'aria-pressed': nombre(r.teinte, 38) === t ? 'true' : 'false',
          disabled: lecture,
          style: { background: 'hsl(' + t + ' 62% 48%)' },
          onclick: () => {
            /* On pose la teinte tout de suite : la palette se recolore pendant
               que le doigt est encore dessus. */
            document.documentElement.style.setProperty('--h-accent', String(t));
            poserEtAppliquer('Teinte d’accent', { teinte: t });
          }
        }))), 'l'),

      ligne('Densité', 'Compact resserre les listes : plus de lignes visibles, cibles plus petites.',
        segments([
          { valeur: 'confort', texte: 'Confort' },
          { valeur: 'compact', texte: 'Compact' }
        ], r.densite || 'confort', (v) => poserEtAppliquer('Densité : ' + v, { densite: v }), lecture))
    ]),

    panneau('Démarrage', [
      reglage(ctx, {
        cle: 'ecranAccueil', titre: 'Écran d’accueil', type: 'liste',
        aide: 'L’écran ouvert au démarrage de l’outil.',
        options: MENU.filter(m => m.chemin).map(m => ({ valeur: m.chemin, texte: m.nom })),
        taille: 'l'
      })
    ])
  ]);
}

/* ==========================================================================
   DONNÉES
   ========================================================================== */

function sectionDonnees(ctx, refaire) {
  const e = ctx.etat;
  const patron = estPatron(ctx);
  const derniere = nombre(e.reglages.derniereSauvegarde, 0);
  const vieille = !derniere || (Date.now() - derniere) > 7 * JOUR;

  const placeVue = h('span.gras.num', '…');
  base.place().then((p) => {
    placeVue.textContent = p && p.total
      ? fmt.octets(p.utilise) + ' sur ' + fmt.octets(p.total)
      : (p && p.utilise ? fmt.octets(p.utilise) : 'non communiquée par le navigateur');
  }).catch(() => { placeVue.textContent = 'non communiquée par le navigateur'; });

  return h('div.pile', [
    h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Où vivent vos données')]),
      h('div.panneau__corps', h('div.pile-s', [
        S.mode === 'secours'
          ? h('div.bandeau.bandeau--alerte', [
            icone('alerte'),
            h('span', 'Mode de secours : la base du navigateur est indisponible, les données '
              + 'tiennent dans le stockage local. C’est plus fragile et plus limité en place — '
              + 'sauvegardez souvent, et prévenez si cela dure.')
          ])
          : h('div.bandeau.bandeau--ok', [
            icone('cocheRonde'),
            h('span', 'Base du navigateur (IndexedDB) : tout reste sur cet appareil. '
              + 'Rien ne part sur internet, et rien ne revient si l’appareil est perdu.')
          ]),
        h('div.rang.entre', [h('span.petit.faible', 'Place occupée'), placeVue])
      ]))
    ]),

    h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Sauvegarde')]),
      h('div.panneau__corps', h('div.pile', [
        vieille ? h('div.bandeau.bandeau--danger', [
          icone('alerte'),
          h('span', derniere
            ? 'Dernière sauvegarde il y a ' + Math.abs(ecartJours(derniere, Date.now()))
              + ' jours. Un téléphone se casse, un navigateur se vide : téléchargez le fichier '
              + 'et rangez-le ailleurs.'
            : 'Aucune sauvegarde n’a jamais été faite depuis cet appareil.')
        ]) : h('div.bandeau.bandeau--ok', [
          icone('cocheRonde'),
          h('span', 'Dernière sauvegarde ' + fmt.quand(derniere) + '.')
        ]),
        h('div.rang.enroule', [
          h('button.bt.bt--fort', {
            type: 'button', onclick: () => sauvegarderMaintenant(refaire)
          }, [icone('telecharger'), h('span', 'Sauvegarder maintenant')]),
          patron ? h('button.bt.bt--contour', {
            type: 'button', onclick: () => restaurer()
          }, [icone('televerser'), h('span', 'Restaurer une sauvegarde')]) : null
        ])
      ]))
    ]),

    patron ? h('div.panneau', [
      h('div.panneau__tete', [h('h2.grandit', 'Entretien')]),
      h('div.panneau__corps', h('div.pile', [
        ligne('Faire le ménage',
          'Efface ce qui ne sert plus : vieux créneaux, appels traités, lignes de journal.',
          h('button.bt.bt--contour', {
            type: 'button', onclick: () => modaleMenage(refaire)
          }, [icone('poubelle'), h('span', 'Faire le ménage')]), 'l'),
        ligne('Jeu de démonstration',
          'Remplace tout par un garage fictif complet, pour essayer l’outil sans risque.',
          h('button.bt.bt--contour', {
            type: 'button', onclick: () => chargerDemo()
          }, [icone('fusee'), h('span', 'Charger la démonstration')]), 'l'),
        ligne('Repartir de zéro',
          'Efface clients, véhicules, dossiers, devis, factures et stock. Sans retour possible.',
          h('button.bt.bt--danger', {
            type: 'button', onclick: () => repartirDeZero()
          }, [icone('alerte'), h('span', 'Repartir de zéro')]), 'l')
      ]))
    ]) : null,

    panneauJournal(e)
  ]);
}

async function sauvegarderMaintenant(refaire) {
  const doc = instantane();
  const ok = await telecharger(nomDate('yatech-sauvegarde', 'json'),
    JSON.stringify(doc, null, 2), 'application/json');
  if (!ok) { messageErreur('La sauvegarde n’est pas partie'); return; }
  maj('Sauvegarde téléchargée', (etat) => { etat.reglages.derniereSauvegarde = Date.now(); });
  messageOk('Sauvegarde enregistrée');
  refaire();
}

/** Remplace l'état puis recharge la page : la coque, la devise et l'apparence
 *  sont reconstruites depuis les nouvelles données, sans reste de l'ancienne. */
async function reprendreAvec(doc) {
  remplacer(doc, { normaliser });
  await ecrireMaintenant();
  location.reload();
}

async function restaurer() {
  const fichiers = await choisirFichier({ accepte: '.json,application/json' });
  if (!fichiers || !fichiers.length) return;

  let doc = null;
  try { doc = JSON.parse(await lireTexte(fichiers[0])); }
  catch (err) { messageErreur('Fichier illisible : ce n’est pas du JSON.'); return; }

  /* On vérifie AVANT de remplacer quoi que ce soit : normaliser() est
     indulgent par nécessité — il relit les vieilles sauvegardes — et
     transformerait un fichier quelconque en garage vide. */
  if (!estUneSauvegarde(doc)) {
    messageErreur('Ce fichier n’est pas une sauvegarde Yatech. Rien n’a été touché.');
    return;
  }

  const ok = await confirmer({
    titre: 'Restaurer cette sauvegarde ?',
    texte: (doc.cree ? 'Sauvegarde d’un garage créé le ' + fmt.date(doc.cree, 'normal') + '. ' : '')
      + (doc.clients || []).length + ' clients, ' + (doc.dossiers || []).length + ' dossiers, '
      + (doc.factures || []).length + ' factures.',
    avertissement: 'Toutes les données actuellement dans l’outil seront remplacées.',
    ok: 'Restaurer', danger: true
  });
  if (!ok) return;
  await reprendreAvec(doc);
}

async function chargerDemo() {
  const ok = await confirmer({
    titre: 'Charger le jeu de démonstration ?',
    texte: 'Un garage fictif complet : clients, véhicules, dossiers en cours, devis, factures, stock.',
    avertissement: 'Vos données actuelles seront remplacées. Sauvegardez-les d’abord si elles comptent.',
    ok: 'Charger la démonstration', danger: true
  });
  if (!ok) return;
  const { jeuDemo } = await import('../domain/demo.js');
  await reprendreAvec(jeuDemo());
}

function repartirDeZero() {
  const compris = champ({
    type: 'coche',
    etiquette: 'Je comprends que tout sera effacé et que rien ne pourra être récupéré.'
  });

  modale({
    titre: 'Repartir de zéro',
    corps: h('div.pile', [
      h('div.bandeau.bandeau--danger', [
        icone('alerte'),
        h('span', 'Clients, véhicules, dossiers, devis, factures, stock, planning et journal : '
          + 'tout disparaît. Seuls l’équipe et le catalogue de prestations de départ sont remis en place.')
      ]),
      h('p.petit.faible', 'Si vous n’êtes pas certain, fermez cette fenêtre et téléchargez '
        + 'd’abord une sauvegarde.'),
      compris.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Tout effacer', ton: 'danger',
        /* Deux gestes distincts — cocher, puis appuyer — plutôt qu'un seul :
           on n'efface pas un garage d'un doigt qui glisse. */
        faire: async () => {
          if (!compris.lire()) {
            message('Cochez la case pour confirmer', { ton: 'alerte' });
            return false;
          }
          const { equipeDepart, catalogueDepart } = await import('../domain/demo.js');
          const vierge = neuf();
          vierge.utilisateurs = equipeDepart();
          vierge.prestations = catalogueDepart();
          await reprendreAvec(vierge);
        }
      }
    ]
  });
}

function modaleMenage(refaire) {
  const creneaux = champ({ type: 'coche', etiquette: 'Créneaux passés', valeur: true });
  const appels = champ({ type: 'coche', etiquette: 'Appels déjà traités', valeur: true });
  const dossiers = champ({ type: 'coche', etiquette: 'Archiver les dossiers rendus', valeur: false });
  const journal = champ({ type: 'coche', etiquette: 'Vieilles lignes de journal', valeur: false });
  const jours = champ({
    etiquette: 'Ne toucher à rien de plus récent que', type: 'nombre', unite: 'jours', valeur: 90
  });

  modale({
    titre: 'Faire le ménage',
    corps: h('div.pile', [
      h('p.petit.faible', 'Rien n’est touché en dehors de ce que vous cochez, '
        + 'et rien de plus récent que le délai choisi.'),
      creneaux.noeud, appels.noeud, dossiers.noeud, journal.noeud,
      jours.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Faire le ménage', ton: 'fort',
        faire: () => {
          const bilan = act.menage({
            creneaux: creneaux.lire(),
            appels: appels.lire(),
            dossiers: dossiers.lire(),
            journal: journal.lire(),
            jours: Math.max(1, nombre(jours.lire(), 90))
          });
          const dit = [
            bilan.creneaux ? bilan.creneaux + ' créneaux' : '',
            bilan.appels ? bilan.appels + ' appels' : '',
            bilan.dossiers ? bilan.dossiers + ' dossiers archivés' : '',
            bilan.journal ? bilan.journal + ' lignes de journal' : ''
          ].filter(Boolean);
          messageOk(dit.length ? 'Ménage fait : ' + dit.join(', ') : 'Rien à jeter, tout est déjà propre.');
          refaire();
        }
      }
    ]
  });
}

function panneauJournal(e) {
  const lignes = (e.journal || []).slice(-100).reverse();

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('historique', { taille: 16 }),
      h('h2.grandit', 'Journal'),
      h('span.petit.faible', lignes.length + ' dernières lignes')
    ]),
    lignes.length
      ? h('div.liste', lignes.map(j => {
        const qui = j.qui ? lit.utilisateur(e, j.qui) : null;
        return h('div.liste__ligne.liste__ligne--muette', [
          h('div', { style: { minWidth: '96px' } }, [
            h('div.petit.num', fmt.heure(j.quand)),
            h('div.minus.tres-faible', fmt.date(j.quand, 'court'))
          ]),
          h('div.grandit.coupe-2', j.quoi),
          h('span.minus.tres-faible', qui ? lit.nomUtilisateur(qui) : '—')
        ]);
      }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
        'Le journal est vide : rien n’a encore été fait dans l’outil.'))
  ]);
}
