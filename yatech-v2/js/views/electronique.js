/* ==========================================================================
   YATECH — écran « Électronique »
   --------------------------------------------------------------------------
   Le poste de travail électronique. Deux choses comptent ici et nulle part
   ailleurs :

   1. LES CRÉDITS AUTOTUNER. On les achète à l'avance, ils se consomment à
      chaque écriture réussie, et tomber à zéro un vendredi soir avec un
      calculateur ouvert sur l'établi coûte un week-end. Le compteur est donc
      en haut, en gros, avant tout le reste.

   2. LA MÉMOIRE DES CALCULATEURS. « Le CRD2, on l'avait fait en bench » : cette
      phrase-là vaut une heure de tâtonnement. On la fabrique automatiquement
      à partir des interventions passées, regroupées par type de calculateur.

   Les fichiers binaires ne sont PAS stockés ici : ils vivent sur le PC de
   l'atelier, à côté de l'appareil qui les a lus. L'outil garde le nom et le
   rôle de chacun — c'est ce qui permet de retrouver une sauvegarde d'origine
   six mois plus tard, sans embarquer des méga-octets dans une base qui doit
   rester légère sur téléphone.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, vide } from '../core/ui.js';
import { maj } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { nombre, cts, id, jour0, pluriel, plaqueJolie, compareTexte } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { totaux } from '../domain/calculs.js';
import {
  OUTILS_ELECTRO, PROTOCOLES, OPERATIONS_ELECTRO, ETATS_INTERVENTION,
  MODIFICATIONS_ELECTRO, FAMILLES_MODIF, CONTROLES_ELECTRO
} from '../domain/schema.js';
import { enTete, indic, champ, grilleChamps, plaque, filtres } from '../ui/widgets.js';
import { calculateursConnus, ficheCalculateur, conseilAcces, cleCalculateur,
  typeCalculateur, controlesManquants, ecritDansLeBoitier,
  programmesFrequents } from '../domain/calculateurs.js';

/* Le rôle d'un fichier dans une intervention. Il ne vit que sur cet écran :
   le schéma se contente d'une chaîne, c'est ici qu'on lui donne un nom
   lisible et une couleur. */
const ROLES_FICHIER = {
  origine:    { nom: 'Origine', ton: 'ok' },
  modifie:    { nom: 'Modifié', ton: 'accent' },
  sauvegarde: { nom: 'Sauvegarde', ton: 'info' }
};

/* Le sens d'un mouvement de crédits, tel que `actions.js` l'écrit. */
const SENS_CREDIT = {
  entree:     { nom: 'Recharge', ton: 'ok', signe: '+' },
  sortie:     { nom: 'Consommé', ton: 'accent', signe: '−' },
  ajustement: { nom: 'Correction', ton: 'violet', signe: '' }
};

const CHOIX_FILTRES = [
  { cle: 'tout',    texte: 'Tout' },
  { cle: 'encours', texte: 'En cours' },
  { cle: 'ok',      texte: 'Réussies' },
  { cle: 'echec',   texte: 'Échecs' },
  { cle: 'mois',    texte: 'Ce mois' }
];

/** Sans filtre, on ne déroule pas trois ans d'historique dans un tableau. */
const LIMITE_LISTE = 30;

/** Le garage suit-il ses crédits ? Un atelier sous abonnement, ou dont l'outil
 *  est déjà débloqué, n'a que faire d'un compteur : tout ce qui parle de
 *  crédits disparaît alors de l'écran, sans toucher aux interventions. */
function suitLesCredits(e) {
  return e.reglages.suiviCredits !== false;
}

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  let filtreActif = 'tout';
  let ecuFiltre = '';        // type de calculateur choisi dans la mémoire d'atelier
  let modifFiltre = '';      // programme choisi dans « ce qu'on fait le plus »
  let toutMontrer = false;
  let historiqueOuvert = false;
  let cherche = '';

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    return [
      enTete({
        titre: 'Électronique',
        sous: 'Reprogrammation, codage, réparation de calculateurs',
        actions: [
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => modaleIntervention(e, refaire, null)
          }, [icone('plus'), h('span', 'Nouvelle intervention')])
        ]
      }),
      suitLesCredits(e) ? blocCredits(e, refaire) : null,
      indicateurs(e),
      h('div.deux-colonnes', [
        h('div.pile', [
          filtres(
            CHOIX_FILTRES.map(f => Object.assign({}, f, {
              compte: (e.interventions || []).filter(i => garde(i, f.cle)).length
            })),
            filtreActif,
            (cle) => { filtreActif = cle; toutMontrer = false; refaire(); }
          ),
          panneauInterventions(e, refaire, {
            filtreActif, ecuFiltre, modifFiltre, toutMontrer, cherche,
            surTout: () => { toutMontrer = true; refaire(); },
            surVidageEcu: () => { ecuFiltre = ''; refaire(); },
            surVidageModif: () => { modifFiltre = ''; refaire(); },
            surRecherche: (v) => { cherche = v; toutMontrer = false; }
          })
        ]),
        h('div.pile', [
          memoireCalculateurs(e, refaire, ecuFiltre, (type) => {
            ecuFiltre = (cleCalculateur(ecuFiltre) === cleCalculateur(type) ? '' : type);
            refaire();
          }),
          panneauProgrammes(e, modifFiltre, (cle) => {
            modifFiltre = (modifFiltre === cle ? '' : cle);
            refaire();
          }),
          suitLesCredits(e) ? panneauHistorique(e, historiqueOuvert, () => {
            historiqueOuvert = !historiqueOuvert;
            refaire();
          }) : null
        ])
      ])
    ];
  }

  poser(racine, contenu());
  return racine;
}

/* ==========================================================================
   LE COMPTEUR DE CRÉDITS
   ========================================================================== */

function blocCredits(e, refaire) {
  const solde = lit.soldeCredits(e);
  const seuil = nombre(e.reglages.creditsAlerte, 5);
  const consommes = lit.creditsConsommes(e, debutDuMois());
  const prixUnitaire = nombre(e.reglages.prixCredit, 0);

  return h('div.pile-s', [
    /* `.enroule` en plus de `.credits` : à 380 px les deux boutons passent
       sous le compteur au lieu de l'écraser. */
    h('div.credits.enroule', [
      icone('puce', { taille: 30, classe: 'faible' }),
      h('div.grandit', [
        h('div.rang-s', [
          h('div.credits__n', String(solde)),
          h('span.faible', solde === 1 ? 'crédit Autotuner' : 'crédits Autotuner')
        ]),
        h('div.petit.faible', [
          pluriel(consommes, 'crédit consommé') + ' ce mois',
          prixUnitaire > 0 ? 'valeur du solde ≈ ' + fmt.euros(cts(solde * prixUnitaire), { sansCentimes: true }) : ''
        ].filter(Boolean).join(' · '))
      ]),
      h('div.rang-s.enroule', [
        h('button.bt.bt--fort', {
          type: 'button', onclick: () => modaleRecharge(e, refaire)
        }, [icone('plus'), h('span', 'Recharger')]),
        h('button.bt.bt--contour', {
          type: 'button', onclick: () => modaleAjustement(e, refaire)
        }, [icone('balance'), h('span', 'Corriger le solde')])
      ])
    ]),
    solde <= seuil ? h('div.bandeau.bandeau--' + (solde <= 0 ? 'danger' : 'alerte'), [
      icone('alerte'),
      h('div.grandit', [
        h('div.gras', solde <= 0
          ? 'Plus aucun crédit : aucune écriture ne passera.'
          : 'Il ne reste que ' + pluriel(solde, 'crédit') + '.'),
        h('div.petit', 'Rechargez avant d’ouvrir le prochain calculateur — '
          + 'une commande de crédits n’est pas toujours instantanée.')
      ])
    ]) : null
  ]);
}

function modaleRecharge(e, refaire) {
  const combien = champ({ etiquette: 'Crédits achetés', type: 'nombre', autofocus: true, unite: 'cr.' });
  const cout = champ({ etiquette: 'Coût total payé', type: 'euros', unite: '€' });
  const note = champ({ etiquette: 'Note', exemple: 'Commande du 12/03, facture Autotuner' });
  const calcul = h('div.champ__aide');

  /* Le prix unitaire sert ensuite à chiffrer la marge d'une prestation
     électronique : on le montre pendant la saisie pour que la faute de frappe
     saute aux yeux tout de suite. */
  function recalculer() {
    const n = nombre(combien.lire(), 0);
    const c = nombre(cout.lire(), 0);
    calcul.textContent = (n > 0 && c > 0)
      ? 'Soit ' + fmt.euros(cts(c / n)) + ' le crédit — cette valeur remplacera le prix unitaire des réglages.'
      : '';
  }
  combien.entree.addEventListener('input', recalculer);
  cout.entree.addEventListener('input', recalculer);

  modale({
    titre: 'Recharger les crédits',
    corps: h('div.pile', [
      h('div.bandeau', [
        icone('info'),
        h('span', 'Saisissez ce que l’appareil a réellement encaissé après la recharge.')
      ]),
      grilleChamps([combien, cout]),
      calcul,
      note.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Recharger', ton: 'fort',
        faire: () => {
          const n = nombre(combien.lire(), 0);
          if (n <= 0) { combien.erreur('Combien de crédits ont été achetés ?'); return false; }
          act.rechargerCredits(n, nombre(cout.lire(), 0), note.lire());
          message(pluriel(n, 'crédit ajouté'), { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}

function modaleAjustement(e, refaire) {
  const avant = lit.soldeCredits(e);
  const solde = champ({
    etiquette: 'Solde affiché sur l’appareil', type: 'nombre', valeur: avant,
    autofocus: true, unite: 'cr.'
  });
  const note = champ({ etiquette: 'Pourquoi cet écart ?', exemple: 'Essai raté non compté, recharge oubliée…' });
  const ecart = h('div.champ__aide');

  function recalculer() {
    const d = cts(nombre(solde.lire(), 0) - avant);
    ecart.textContent = d === 0 ? '' : (d > 0 ? '+' + d : String(d)) + ' par rapport au solde noté ici.';
  }
  solde.entree.addEventListener('input', recalculer);

  modale({
    titre: 'Corriger le solde',
    corps: h('div.pile', [
      h('div.bandeau.bandeau--alerte', [
        icone('alerte'),
        h('div.grandit', [
          h('div.gras', 'C’est l’appareil qui fait foi.'),
          h('div.petit', 'Yatech ne parle pas à l’Autotuner : il déduit le solde des interventions '
            + 'enregistrées. Un essai raté compté par l’appareil, une recharge non saisie, et les deux '
            + 'chiffres divergent. Recopiez celui de l’appareil, sans chercher à comprendre l’écart.')
        ])
      ]),
      solde.noeud,
      ecart,
      note.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Corriger', ton: 'fort',
        faire: () => {
          const v = nombre(solde.lire(), -1);
          if (v < 0) { solde.erreur('Un solde ne peut pas être négatif.'); return false; }
          act.ajusterCredits(v, note.lire());
          message('Solde aligné sur l’appareil', { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}

/* ==========================================================================
   LES CHIFFRES DU MOIS
   ========================================================================== */

function indicateurs(e) {
  const depuis = debutDuMois();
  const duMois = (e.interventions || []).filter(i => i.quand >= depuis);
  const reussies = duMois.filter(i => i.etat === 'ok').length;
  const ratees = duMois.filter(i => i.etat === 'echec').length;
  const jugees = reussies + ratees;
  const ca = caElectronique(e, depuis);
  /* Un « programme », c'est une écriture réussie qui a changé quelque chose
     au fichier. Une lecture n'en est pas un, et c'est bien ce qu'on veut
     compter quand on se demande combien on en fait par mois. */
  const programmes = duMois.filter(i => i.etat === 'ok' && (i.modifications || []).length);
  const top = programmesFrequents(e, depuis)[0];

  return h('div.grille-indics', [
    indic({
      nom: 'Interventions', valeur: duMois.length,
      detail: fmt.nomMois(Date.now(), true)
    }),
    indic({
      nom: 'Programmes', valeur: programmes.length,
      detail: top ? 'surtout ' + top.nom.toLowerCase() + ' (' + top.nb + ')' : 'aucun ce mois'
    }),
    indic({
      nom: 'Taux de réussite',
      valeur: jugees ? fmt.pourcent(reussies / jugees * 100, 0) : '—',
      ton: jugees && reussies / jugees < 0.8 ? 'alerte' : null,
      detail: jugees
        ? reussies + ' sur ' + jugees + ' terminées'
        : 'rien de terminé ce mois'
    }),
    suitLesCredits(e) ? indic({
      nom: 'Crédits consommés', valeur: lit.creditsConsommes(e, depuis),
      detail: 'solde : ' + lit.soldeCredits(e)
    }) : null,
    indic({
      nom: 'Chiffre d’affaires élec.',
      valeur: fmt.euros(ca.ht, { sansCentimes: true }),
      detail: ca.nb ? pluriel(ca.nb, 'facture') + ' HT' : 'aucune facture'
    })
  ]);
}

/**
 * Le chiffre d'affaires électronique du mois.
 *
 * Approche volontairement simple : on prend les factures émises dans la
 * période dont le dossier est de nature « électronique » ou « mixte », et on
 * compte leur total entier. Un dossier mixte contient donc aussi ses lignes de
 * mécanique — découper facture par facture supposerait que chaque ligne porte
 * sa nature, ce qui n'est pas le cas et alourdirait la saisie pour un chiffre
 * qui sert à sentir une tendance, pas à remplir une déclaration. EBP reste la
 * comptabilité officielle.
 */
function caElectronique(e, depuis, jusqua) {
  const fin = jusqua === undefined ? Date.now() : jusqua;
  let ht = 0, nb = 0;
  for (const f of e.factures || []) {
    const quand = f.emiseLe || f.cree;
    if (!quand || quand < depuis || quand > fin) continue;
    if (f.statut === 'attente') continue;      // pas encore une vraie facture
    const d = f.dossierId ? lit.dossier(e, f.dossierId) : null;
    if (!d || (d.nature !== 'electro' && d.nature !== 'mixte')) continue;
    ht += totaux(f, lit.prixDe(e, f.clientId)).ht;
    nb++;
  }
  return { ht: cts(ht), nb };
}

/* ==========================================================================
   LA LISTE DES INTERVENTIONS
   ========================================================================== */

function garde(i, cle) {
  if (cle === 'encours') return i.etat === 'prevu' || i.etat === 'encours';
  if (cle === 'ok') return i.etat === 'ok';
  if (cle === 'echec') return i.etat === 'echec';
  if (cle === 'mois') return i.quand >= debutDuMois();
  return true;
}

/** Le texte cherché touche-t-il cette intervention ? On ratisse large : la
 *  plaque, le client, le boîtier, le programme, le nom d'un fichier, une note.
 *  Devant l'établi, on se souvient d'un mot, pas d'une colonne. */
function correspond(e, i, mots) {
  if (!mots.length) return true;
  const v = i.vehiculeId ? lit.vehicule(e, i.vehiculeId) : null;
  const c = lit.client(e, i.clientId || (v ? v.clientId : null));
  const ecu = i.ecu || {};
  const foin = [
    v ? v.immat : '', v ? lit.nomVehicule(v) : '',
    c ? lit.nomClient(c) : '',
    ecu.marque, ecu.type, ecu.hw, ecu.sw,
    (OPERATIONS_ELECTRO[i.operation] || {}).nom,
    (PROTOCOLES[i.protocole] || {}).nom,
    i.slave, i.resultat, i.notes,
    (i.modifications || []).map(m => (MODIFICATIONS_ELECTRO[m] || {}).nom).join(' '),
    (i.fichiers || []).map(f => f.nom + ' ' + (f.ou || '')).join(' ')
  ].join(' ').toLowerCase();
  return mots.every(m => foin.indexOf(m) >= 0);
}

function panneauInterventions(e, refaire, o) {
  const mots = String(o.cherche || '').toLowerCase().split(/\s+/).filter(Boolean);
  const toutes = lit.interventionsRecentes(e, (e.interventions || []).length);
  let liste = toutes.filter(i => garde(i, o.filtreActif));
  if (o.ecuFiltre) liste = liste.filter(i => memeEcu(i, o.ecuFiltre));
  if (o.modifFiltre) liste = liste.filter(i => (i.modifications || []).indexOf(o.modifFiltre) >= 0);
  liste = liste.filter(i => correspond(e, i, mots));

  const tronque = !o.toutMontrer && liste.length > LIMITE_LISTE;
  const visibles = tronque ? liste.slice(0, LIMITE_LISTE) : liste;

  /* Le champ garde son contenu et le curseur d'un repeint à l'autre : on ne
     repeint pas la liste à chaque lettre, on la filtre à la volée. */
  const recherche = h('input.saisie', {
    type: 'search', value: o.cherche || '', spellcheck: false,
    placeholder: 'Plaque, client, boîtier, programme, fichier…',
    'aria-label': 'Rechercher une intervention',
    oninput: (ev) => { o.surRecherche(ev.target.value); tout = false; rafraichirCorps(); }
  });

  /* Une nouvelle recherche referme la liste à sa longueur normale : on cherche
     pour réduire, pas pour dérouler trois ans d'un coup. */
  let tout = o.toutMontrer;
  const corps = h('div');
  const compteur = h('span.compte', String(liste.length));

  function rafraichirCorps() {
    const m = String(recherche.value || '').toLowerCase().split(/\s+/).filter(Boolean);
    let l = toutes.filter(i => garde(i, o.filtreActif));
    if (o.ecuFiltre) l = l.filter(i => memeEcu(i, o.ecuFiltre));
    if (o.modifFiltre) l = l.filter(i => (i.modifications || []).indexOf(o.modifFiltre) >= 0);
    l = l.filter(i => correspond(e, i, m));
    compteur.textContent = String(l.length);
    poser(corps, tableau(l.slice(0, tout ? l.length : LIMITE_LISTE), l));
  }

  function tableau(vus, tous) {
    if (!vus.length) {
      return h('div.panneau__corps', vide({
        icone: 'electro',
        titre: 'Aucune intervention',
        texte: o.filtreActif === 'tout' && !o.ecuFiltre && !o.modifFiltre && !recherche.value
          ? 'Chaque lecture et chaque écriture notée ici devient la mémoire de l’atelier.'
          : 'Rien ne correspond.',
        action: o.filtreActif === 'tout' && !o.ecuFiltre && !o.modifFiltre && !recherche.value
          ? { texte: 'Nouvelle intervention', faire: () => modaleIntervention(e, refaire, null) }
          : null
      }));
    }
    return [
      h('div.panneau__corps', h('div.tableau-cadre', h('table.grille.repliable', [
        h('thead', h('tr', [
          h('th', 'Date'),
          h('th', 'Véhicule'),
          h('th', 'Client'),
          h('th', 'Calculateur'),
          h('th', 'Opération'),
          h('th', 'Accès'),
          h('th', 'Programme'),
          suitLesCredits(e) ? h('th.num', 'Crédits') : null,
          h('th.num', 'Durée'),
          h('th', 'État')
        ])),
        h('tbody', vus.map(i => ligneIntervention(e, i, refaire)))
      ]))),
      tous.length > vus.length ? h('div.panneau__pied', h('button.bt.bt--nu.bt--plein', {
        type: 'button', onclick: o.surTout
      }, 'Afficher les ' + tous.length + ' interventions')) : null
    ];
  }

  poser(corps, tableau(visibles, liste));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('electro', { taille: 16 }),
      h('h2.grandit', 'Interventions'),
      compteur
    ]),
    h('div.panneau__corps', { style: { paddingBottom: '0' } }, h('div.pile-s', [
      recherche,
      o.ecuFiltre || o.modifFiltre ? h('div.rang-s.enroule', [
        o.ecuFiltre ? h('button.etiq.etiq--accent', {
          type: 'button', onclick: o.surVidageEcu
        }, [h('span', 'Boîtier ' + o.ecuFiltre), icone('croix', { taille: 13 })]) : null,
        o.modifFiltre ? h('button.etiq.etiq--accent', {
          type: 'button', onclick: o.surVidageModif
        }, [h('span', (MODIFICATIONS_ELECTRO[o.modifFiltre] || {}).nom || o.modifFiltre),
            icone('croix', { taille: 13 })]) : null
      ]) : null
    ])),
    corps
  ]);
}

/** Les programmes d'une intervention, en pastilles. */
function pastillesModifs(i, limite) {
  const l = (i.modifications || []).map(m => MODIFICATIONS_ELECTRO[m] ? m : null).filter(Boolean);
  if (!l.length) return null;
  const montrees = limite ? l.slice(0, limite) : l;
  return h('div.rang-s.enroule', [
    ...montrees.map(m => h('span.pastille.pastille--'
      + (MODIFICATIONS_ELECTRO[m].route === false ? 'alerte' : 'violet')
      + '.pastille--sans-point', MODIFICATIONS_ELECTRO[m].nom)),
    l.length > montrees.length
      ? h('span.minus.tres-faible', '+' + (l.length - montrees.length))
      : null
  ]);
}

function ligneIntervention(e, i, refaire) {
  const v = i.vehiculeId ? lit.vehicule(e, i.vehiculeId) : null;
  const c = lit.client(e, i.clientId || (v ? v.clientId : null));
  const etat = ETATS_INTERVENTION[i.etat] || ETATS_INTERVENTION.prevu;
  const ope = OPERATIONS_ELECTRO[i.operation];
  const proto = PROTOCOLES[i.protocole];
  const ecu = i.ecu || {};
  const ouvrir = () => modaleIntervention(e, refaire, i);

  return h('tr.cliquable', {
    tabindex: 0,
    onclick: ouvrir,
    onkeydown: (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ouvrir();
    }
  }, [
    h('td', { donnees: { col: 'Date' } }, h('span.num', fmt.date(i.quand, 'court'))),
    h('td', { donnees: { col: 'Véhicule' } }, v
      ? h('div.rang-s', [plaque(v.immat), h('span.petit.faible.coupe', lit.nomVehicule(v))])
      : h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Client' } }, h('span.coupe', c ? lit.nomClient(c) : '—')),
    h('td', { donnees: { col: 'Calculateur' } },
      [ecu.marque, ecu.type].filter(Boolean).join(' ') || h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Opération' } }, ope ? ope.nom : i.operation),
    h('td', { donnees: { col: 'Accès' } }, proto ? proto.nom : i.protocole),
    h('td', { donnees: { col: 'Programme' } },
      pastillesModifs(i, 3) || h('span.tres-faible', '—')),
    suitLesCredits(e) ? h('td.num', { donnees: { col: 'Crédits' } },
      nombre(i.credits, 0) ? String(nombre(i.credits, 0)) : '') : null,
    h('td.num', { donnees: { col: 'Durée' } },
      nombre(i.dureeMin, 0) ? fmt.duree(nombre(i.dureeMin, 0) * 60000) : ''),
    h('td', { donnees: { col: 'État' } }, h('span.pastille.pastille--' + etat.ton, etat.nom))
  ]);
}

/* ==========================================================================
   LA MÉMOIRE DES CALCULATEURS
   --------------------------------------------------------------------------
   Regroupe les interventions par type de calculateur. Le protocole retenu est
   celui qui a fonctionné le plus souvent : sur un calculateur, savoir qu'il
   se lit en bench et pas en OBD fait gagner la demi-heure qu'on aurait passée
   à insister sur la prise diagnostic.
   ========================================================================== */

/* La comparaison de deux types saisis à la main : « EDC17 C64 » et
   « edc17-c64 » sont le même boîtier. */
function memeEcu(i, type) {
  return cleCalculateur(typeCalculateur(i)) === cleCalculateur(type);
}

/* ==========================================================================
   CE QU'ON SAIT D'UN CALCULATEUR
   Le cœur du gain de temps : pas « on a déjà vu ce boîtier », mais « pour
   l'écrire, on est passé par le bench, et l'OBD a échoué deux fois ».
   ========================================================================== */

/** Une voie en une pastille : « OBD ✓3 » ou « OBD ✗2 ». */
function pastilleVoie(v, discret) {
  const sure = v.ok > 0;
  const n = sure ? v.ok : v.ko;
  return h('span.pastille.pastille--' + (sure ? 'ok' : 'danger')
    + (discret ? '.pastille--sans-point' : ''), [
    v.nomProtocole,
    h('span.tres-faible', ' ' + (sure ? '✓' : '✗') + n)
  ]);
}

/** Le résumé d'une opération : par où ça passe, par où ça ne passe pas. */
function ligneOperation(e, op, opts) {
  const o = opts || {};
  const s = op.sure;
  return h('div.pile-s', [
    h('div.rang-s.enroule', [
      h('span.etiq.grandit', op.nom),
      ...op.voies.slice(0, 4).map(v => pastilleVoie(v))
    ]),
    s && (s.minutesTypiques || s.creditsTypiques)
      ? h('div.minus.tres-faible', [
          s.nomProtocole,
          s.minutesTypiques ? '≈ ' + fmt.duree(s.minutesTypiques * 60000) : null,
          s.creditsTypiques && suitLesCredits(e) ? s.creditsTypiques + ' cr.' : null
        ].filter(Boolean).join(' · '))
      : null,
    o.astuces && s && s.astuce
      ? h('div.minus.faible.coupe-2', '« ' + s.astuce + ' »')
      : null
  ]);
}

function memoireCalculateurs(e, refaire, ecuFiltre, surChoix) {
  const fiches = calculateursConnus(e);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('puce', { taille: 16 }),
      h('h2.grandit', 'Calculateurs déjà vus'),
      fiches.length ? h('span.compte.compte--accent', String(fiches.length)) : null
    ]),
    fiches.length
      ? h('div.liste', fiches.slice(0, 14).map(f => {
          const choisi = cleCalculateur(ecuFiltre) === cleCalculateur(f.type);

          return h('div.liste__ligne',
            choisi ? { style: { background: 'var(--accent-voile)' } } : null, [
            h('button.bt.bt--nu.grandit.coupe', {
              type: 'button',
              style: { textAlign: 'left', display: 'block', padding: '0' },
              'aria-pressed': choisi ? 'true' : 'false',
              onclick: () => surChoix(f.type)
            }, h('div.pile-s', [
              h('div.rang-s', [
                h('span.gras.coupe', f.type),
                h('span.petit.tres-faible', f.nb + ' fois')
              ]),
              f.marque ? h('div.petit.faible.coupe', f.marque) : null,
              /* L'essentiel, visible sans ouvrir : par où passe chaque
                 opération sur ce boîtier. */
              h('div.pile-s', f.operations.slice(0, 3).map(op =>
                h('div.rang-s.enroule', [
                  h('span.minus.tres-faible', op.nom),
                  ...op.voies.slice(0, 3).map(v => pastilleVoie(v, true))
                ]))),
              f.modifications.length
                ? h('div.rang-s.enroule', f.modifications.slice(0, 4).map(m =>
                    h('span.pastille.pastille--violet.pastille--sans-point',
                      m.nom + (m.nb > 1 ? ' ×' + m.nb : ''))))
                : null
            ])),
            h('button.bt.bt--nu.bt--icone.bt--s', {
              type: 'button', 'aria-label': 'Fiche du ' + f.type,
              onclick: () => ficheCalculateurModale(e, refaire, f.type)
            }, icone('oeil'))
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Renseignez le type de calculateur, l’opération et l’accès sur vos '
          + 'interventions : l’atelier se souviendra tout seul par où passer '
          + 'la prochaine fois.'))
  ]);
}

/* ==========================================================================
   LA FICHE D'UN CALCULATEUR
   Tout ce que l'atelier sait d'un boîtier, sur une page : par où on entre
   pour chaque opération, ce qu'on y a programmé, sur quelles voitures, et le
   détail des tentatives — les ratées comprises, ce sont les plus utiles.
   ========================================================================== */

function ficheCalculateurModale(e, refaire, type) {
  const f = ficheCalculateur(e, type);
  if (!f) { message('Ce calculateur n’a pas encore d’histoire ici.'); return; }

  const passees = (e.interventions || [])
    .filter(i => memeEcu(i, type) && (i.etat === 'ok' || i.etat === 'echec'))
    .sort((a, b) => b.quand - a.quand);

  const plaques = f.vehicules.map(vid => lit.vehicule(e, vid)).filter(Boolean);
  const modale_ = modale({
    titre: f.type + (f.marque ? ' — ' + f.marque : ''),
    taille: 'large',
    corps: h('div.pile', [
      h('div.rang-s.enroule', [
        h('span.pastille', f.nb + (f.nb > 1 ? ' tentatives' : ' tentative')),
        h('span.pastille.pastille--ok', f.reussies + ' réussies'),
        f.nb > f.reussies
          ? h('span.pastille.pastille--danger', (f.nb - f.reussies) + ' ratées') : null,
        f.dernier ? h('span.petit.faible', 'la dernière ' + fmt.quand(f.dernier)) : null
      ]),

      h('div.majuscule', 'Par où on entre'),
      h('div.pile', f.operations.map(op => ligneOperation(e, op, { astuces: true }))),

      f.modifications.length ? h('div.majuscule', 'Ce qu’on y programme') : null,
      f.modifications.length
        ? h('div.rang-s.enroule', f.modifications.map(m =>
            h('span.pastille.pastille--' + (m.route === false ? 'alerte' : 'violet'),
              m.nom + ' ×' + m.nb)))
        : null,

      plaques.length ? h('div.majuscule', 'Sur ces véhicules') : null,
      plaques.length
        ? h('div.rang-s.enroule', plaques.map(v => h('button.etiq', {
            type: 'button',
            onclick: () => { modale_.fermer(); location.hash = '#/vehicule/' + v.id; }
          }, plaqueJolie(v.immat) + ' — ' + lit.nomVehicule(v))))
        : null,

      h('div.majuscule', 'Les tentatives, une par une'),
      h('div.liste', passees.slice(0, 12).map(i => {
        const etat = ETATS_INTERVENTION[i.etat] || ETATS_INTERVENTION.prevu;
        const v = i.vehiculeId ? lit.vehicule(e, i.vehiculeId) : null;
        return h('div.liste__ligne', [
          h('div.grandit.coupe.pile-s', [
            h('div.rang-s.enroule', [
              h('span.num.petit', fmt.date(i.quand, 'court')),
              h('span.pastille.pastille--' + etat.ton + '.pastille--sans-point', etat.nom),
              h('span.petit', (OPERATIONS_ELECTRO[i.operation] || {}).nom || i.operation),
              h('span.petit.faible', (PROTOCOLES[i.protocole] || {}).nom || i.protocole),
              v ? h('span.petit.tres-faible', plaqueJolie(v.immat)) : null
            ]),
            pastillesModifs(i),
            i.resultat ? h('div.minus.faible.coupe-2', i.resultat) : null
          ]),
          h('button.bt.bt--nu.bt--s', {
            type: 'button',
            onclick: () => { modale_.fermer(); modaleIntervention(e, refaire, null, i); }
          }, 'Refaire')
        ]);
      }))
    ]),
    actions: [{ texte: 'Fermer', ton: 'contour' }]
  });
}

/* ==========================================================================
   CE QU'ON PROGRAMME LE PLUS
   ========================================================================== */

function panneauProgrammes(e, modifFiltre, surChoix) {
  const tous = programmesFrequents(e);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('etiquette', { taille: 16 }),
      h('h2.grandit', 'Ce qu’on programme'),
      tous.length ? h('span.compte', String(tous.length)) : null
    ]),
    tous.length
      ? h('div.liste', tous.slice(0, 10).map(m => {
          const choisi = modifFiltre === m.cle;
          return h('button.liste__ligne', {
            type: 'button',
            'aria-pressed': choisi ? 'true' : 'false',
            style: choisi ? { background: 'var(--accent-voile)' } : null,
            onclick: () => surChoix(m.cle)
          }, [
            h('div.grandit.coupe', [
              h('div.rang-s', [
                h('span.gras.coupe', m.nom),
                m.route === false
                  ? h('span.pastille.pastille--alerte.pastille--sans-point', 'hors route')
                  : null
              ]),
              h('div.minus.tres-faible', [
                (FAMILLES_MODIF[m.famille] || {}).nom,
                m.minutesTypiques ? '≈ ' + fmt.duree(m.minutesTypiques * 60000) : null
              ].filter(Boolean).join(' · '))
            ]),
            h('span.compte', String(m.nb))
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Cochez ce que vous avez fait au fichier sur vos interventions : '
          + 'l’atelier saura ce qu’il vend le plus, et en combien de temps.'))
  ]);
}

/* ==========================================================================
   L'HISTORIQUE DES CRÉDITS
   ========================================================================== */

function panneauHistorique(e, ouvert, surBascule) {
  const lignes = ((e.credits && e.credits.historique) || []).slice().sort((a, b) => b.quand - a.quand);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('historique', { taille: 16 }),
      h('h2.grandit', 'Historique des crédits'),
      h('button.bt.bt--nu.bt--s', {
        type: 'button',
        'aria-expanded': ouvert ? 'true' : 'false',
        onclick: surBascule
      }, ouvert ? 'Replier' : (lignes.length ? 'Voir (' + lignes.length + ')' : 'Voir'))
    ]),
    !ouvert ? null : (lignes.length
      ? h('div.panneau__corps', h('div.tableau-cadre', h('table.grille.repliable', [
          h('thead', h('tr', [
            h('th', 'Date'),
            h('th', 'Sens'),
            h('th.num', 'Nombre'),
            h('th.num', 'Solde'),
            h('th', 'Motif'),
            h('th.num', 'Coût')
          ])),
          h('tbody', lignes.slice(0, 60).map(m => {
            const s = SENS_CREDIT[m.sens] || { nom: m.sens, ton: 'neutre', signe: '' };
            const n = nombre(m.n, 0);
            return h('tr', [
              h('td', { donnees: { col: 'Date' } }, h('span.num', fmt.date(m.quand, 'court'))),
              h('td', { donnees: { col: 'Sens' } }, h('span.pastille.pastille--' + s.ton, s.nom)),
              h('td.num', { donnees: { col: 'Nombre' } },
                (s.signe || (n >= 0 ? '+' : '')) + Math.abs(n)),
              h('td.num', { donnees: { col: 'Solde' } }, String(nombre(m.solde, 0))),
              h('td', { donnees: { col: 'Motif' } }, h('span.coupe', m.motif || '')),
              h('td.num', { donnees: { col: 'Coût' } },
                nombre(m.cout, 0) ? fmt.euros(m.cout, { sansCentimes: true }) : '')
            ]);
          }))
        ])))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Aucun mouvement : ni recharge, ni consommation enregistrée.')))
  ]);
}

/* ==========================================================================
   LA MODALE D'INTERVENTION
   ========================================================================== */

/**
 * La fiche d'une intervention.
 * @param {object}  e          l'état
 * @param {function} refaire   repeindre l'écran
 * @param {object}  [existante] l'intervention à modifier
 * @param {object}  [modele]   une intervention passée à recopier : même boîtier,
 *                             même opération, mêmes programmes. Le véhicule et
 *                             le résultat, eux, ne se recopient pas — c'est une
 *                             autre voiture et une autre journée.
 */
function modaleIntervention(e, refaire, existante, modele) {
  const i = existante || null;
  const dep = i || modele || null;
  const soldeActuel = lit.soldeCredits(e);

  /* --- dossier et véhicule ------------------------------------------------ */
  const dossiers = lit.dossiersOuverts(e)
    .filter(d => d.nature === 'electro' || d.nature === 'mixte')
    .sort(lit.triDossiers);
  /* Une intervention peut porter sur un dossier déjà refermé : sans ça, le
     rouvrir en modification remettrait la liste sur « hors dossier » et
     détacherait silencieusement l'intervention. */
  if (i && i.dossierId && !dossiers.some(d => d.id === i.dossierId)) {
    const d = lit.dossier(e, i.dossierId);
    if (d) dossiers.unshift(d);
  }

  const vehicules = (e.vehicules || [])
    .filter(v => !v.archive || (i && v.id === i.vehiculeId))
    .sort((a, b) => compareTexte(a.immat, b.immat));

  const chDossier = champ({
    etiquette: 'Dossier',
    type: 'liste',
    valeur: i ? (i.dossierId || '') : '',
    aide: 'Certaines interventions se font hors dossier : pour un confrère, ou sur un boîtier seul.',
    options: [{ valeur: '', texte: 'Hors dossier' }].concat(
      dossiers.map(d => ({ valeur: d.id, texte: lit.titreDossier(e, d) })))
  });

  const chVehicule = champ({
    etiquette: 'Véhicule',
    type: 'liste',
    valeur: i ? (i.vehiculeId || '') : '',
    options: [{ valeur: '', texte: '— aucun —' }].concat(
      vehicules.map(v => ({
        valeur: v.id,
        texte: plaqueJolie(v.immat) + ' — ' + lit.nomVehicule(v)
      })))
  });

  const ligneClient = h('div.petit.faible');

  /* --- outil, opération, protocole ---------------------------------------- */
  const chOutil = champ({
    etiquette: 'Outil', type: 'liste',
    valeur: dep ? dep.outil : (e.reglages.outilDefaut || 'autotuner'),
    options: Object.keys(OUTILS_ELECTRO).map(k => ({ valeur: k, texte: OUTILS_ELECTRO[k] }))
  });
  const chOperation = champ({
    etiquette: 'Opération', type: 'liste',
    valeur: dep ? dep.operation : 'lecture',
    options: Object.keys(OPERATIONS_ELECTRO).map(k => ({ valeur: k, texte: OPERATIONS_ELECTRO[k].nom }))
  });
  const chProtocole = champ({
    etiquette: 'Accès', type: 'liste',
    valeur: dep ? dep.protocole : 'obd',
    options: Object.keys(PROTOCOLES).map(k => ({ valeur: k, texte: PROTOCOLES[k].nom }))
  });
  aideVivante(chOperation, (v) => (OPERATIONS_ELECTRO[v] || {}).aide);
  aideVivante(chProtocole, (v) => (PROTOCOLES[v] || {}).aide);

  /* --- le calculateur ------------------------------------------------------ */
  const ecuDepart = (dep && dep.ecu) || {};
  const chMarque = champ({ etiquette: 'Marque calculateur', valeur: ecuDepart.marque || '', exemple: 'Bosch' });
  const chType   = champ({ etiquette: 'Type', valeur: ecuDepart.type || '', exemple: 'EDC17C10' });
  const chHw     = champ({ etiquette: 'HW', valeur: ecuDepart.hw || '', exemple: '03…' });
  const chSw     = champ({ etiquette: 'SW', valeur: ecuDepart.sw || '', exemple: '1037…' });

  /* Tant que personne n'a touché aux champs du calculateur, ils suivent la
     fiche du véhicule choisi. Dès la première frappe, on arrête de les
     écraser : rien n'est plus agaçant qu'une saisie qui s'efface. */
  /* Quand on recopie une intervention passée, le boîtier vient d'elle : la
     fiche du nouveau véhicule ne doit pas l'effacer. */
  let ecuTouche = !!(modele && !i);
  for (const c of [chMarque, chType, chHw, chSw]) {
    c.entree.addEventListener('input', () => { ecuTouche = true; });
  }

  /* --- le reste ------------------------------------------------------------ */
  const chDate = champ({ etiquette: 'Date', type: 'date', valeur: i ? i.quand : Date.now() });
  const chCredits = champ({
    etiquette: 'Crédits consommés', type: 'nombre',
    valeur: i ? nombre(i.credits, 0) : 0, unite: 'cr.'
  });
  const chSlave = champ({
    etiquette: 'Identifiant du slave', valeur: i ? i.slave : '',
    exemple: 'SL-01', aide: 'Quel boîtier esclave a servi — utile en cas de retour.'
  });
  const chDuree = champ({
    etiquette: 'Durée', type: 'nombre',
    valeur: i ? nombre(i.dureeMin, 0) : 0, unite: 'min'
  });
  const chEtat = champ({
    etiquette: 'État', type: 'liste', valeur: i ? i.etat : 'ok',
    options: Object.keys(ETATS_INTERVENTION).map(k => ({ valeur: k, texte: ETATS_INTERVENTION[k].nom }))
  });
  const chResultat = champ({
    etiquette: 'Résultat', type: 'zone', lignes: 3, valeur: i ? i.resultat : '',
    exemple: 'Ce que le calculateur a rendu, les défauts effacés, ce qui reste à surveiller…'
  });
  const chNotes = champ({
    etiquette: 'Notes', type: 'zone', lignes: 2, valeur: i ? i.notes : '',
    exemple: 'Astuce de branchement, piège rencontré…'
  });

  const fichiers = editeurFichiers(i ? i.fichiers : []);
  const avertCredits = h('div');
  const memoEcu = h('div');

  /* Ce qu'on a fait au fichier, et le déroulé qu'on ne saute pas. Un modèle
     recopié apporte ses programmes : c'est tout l'intérêt de « Refaire ». */
  const programmes = choixProgrammes(dep ? dep.modifications : []);
  /* Les contrôles, eux, ne se recopient jamais : cocher « original
     sauvegardé » sur une voiture qu'on n'a pas encore lue serait un mensonge
     qui coûte cher. */
  const controles = listeControles(i ? i.controles : {});

  /* Une lecture ne change rien au fichier : lui proposer vingt-quatre
     pastilles serait du bruit. La section n'apparaît que pour les opérations
     qui écrivent — et reste là si une intervention en porte déjà, pour ne
     jamais escamoter ce qui a été saisi. */
  const blocProgramme = h('div.pile-s');
  function rafraichirProgramme() {
    const utile = ecritDansLeBoitier(chOperation.lire()) || programmes.lire().length > 0;
    poser(blocProgramme, utile
      ? [h('div.majuscule', 'Le programme'), programmes.noeud]
      : null);
  }
  chOperation.entree.addEventListener('change', rafraichirProgramme);
  rafraichirProgramme();

  /* L'accès suit ce qui a marché la dernière fois, tant que personne n'y
     touche : c'est le quart d'heure qu'on ne repasse pas à chercher. */
  let protoTouche = !!dep;
  chProtocole.entree.addEventListener('change', () => { protoTouche = true; });

  /* --- les liaisons vivantes ---------------------------------------------- */
  function vehiculeChoisi() {
    const d = chDossier.lire() ? lit.dossier(e, chDossier.lire()) : null;
    if (d && d.vehiculeId) return lit.vehicule(e, d.vehiculeId);
    return chVehicule.lire() ? lit.vehicule(e, chVehicule.lire()) : null;
  }

  function rafraichir() {
    const d = chDossier.lire() ? lit.dossier(e, chDossier.lire()) : null;
    /* Le dossier commande : son véhicule ne se choisit pas deux fois. */
    if (d) {
      chVehicule.ecrire(d.vehiculeId || '');
      chVehicule.entree.disabled = true;
    } else {
      chVehicule.entree.disabled = false;
    }

    const v = vehiculeChoisi();
    const c = lit.client(e, d ? d.clientId : (v ? v.clientId : null));
    poser(ligneClient, c
      ? [icone('clients', { taille: 13 }), ' ' + lit.nomClient(c)]
      : 'Aucun client rattaché.');

    if (v && !ecuTouche) {
      const ecu = v.ecu || {};
      chMarque.ecrire(ecu.marque || '');
      chType.ecrire(ecu.type || '');
      chHw.ecrire(ecu.hw || '');
      chSw.ecrire(ecu.sw || '');
      if (ecu.protocole && PROTOCOLES[ecu.protocole]) chProtocole.ecrire(ecu.protocole);
    }
    verifierCredits();
    rafraichirMemoire();
  }

  /* Ce que le garage sait déjà de ce boîtier, affiché pendant la saisie.
     On ne montre que l'opération en cours : devant la voiture, la question
     est « pour l'écrire, je passe par où ? », pas « raconte-moi tout ». */
  function rafraichirMemoire() {
    const fiche = ficheCalculateur(e, chType.lire());
    /* Une fiche en cours de modification s'apprend à elle-même : sans ça,
       elle se conseillerait son propre accès comme s'il avait fait ses
       preuves. On la retire du compte. */
    const c = fiche ? conseilAcces(fiche, chOperation.lire()) : null;

    if (!fiche) { poser(memoEcu, null); return; }

    if (c && c.sure && !protoTouche && chProtocole.lire() !== c.sure.protocole) {
      chProtocole.ecrire(c.sure.protocole);
    }

    poser(memoEcu, h('div.bandeau.pile-s', [
      h('div.rang-s.enroule', [
        icone('puce', { taille: 14 }),
        h('span.gras', fiche.type),
        h('span.petit.faible', 'déjà ouvert ' + fiche.nb + ' fois'
          + (fiche.dernier ? ', le dernier ' + fmt.quand(fiche.dernier) : ''))
      ]),
      c
        ? ligneOperation(e, c, { astuces: true })
        : h('div.petit.faible', 'Jamais fait « '
            + ((OPERATIONS_ELECTRO[chOperation.lire()] || {}).nom || '').toLowerCase()
            + ' » sur ce boîtier.'),
      /* Les autres opérations en une ligne : on sait souvent lire un boîtier
         avant de savoir l'écrire, et l'info d'à côté oriente. */
      fiche.operations.length > (c ? 1 : 0)
        ? h('div.pile-s', fiche.operations
            .filter(op => !c || op.operation !== c.operation)
            .slice(0, 3)
            .map(op => h('div.rang-s.enroule', [
              h('span.minus.tres-faible', op.nom),
              ...op.voies.slice(0, 3).map(v => pastilleVoie(v, true))
            ])))
        : null
    ]));
  }

  function verifierCredits() {
    if (!suitLesCredits(e)) { poser(avertCredits, null); return; }
    const n = nombre(chCredits.lire(), 0);
    const compte = chEtat.lire() === 'ok' && n > 0;
    poser(avertCredits, compte && n > soldeActuel
      ? h('div.bandeau.bandeau--danger', [
          icone('alerte'),
          h('span', 'Vous demandez ' + n + ' crédits alors qu’il n’en reste que '
            + soldeActuel + '. L’enregistrement passera, mais le solde deviendra négatif : '
            + 'rechargez ou corrigez le solde.')
        ])
      : null);
  }

  chDossier.entree.addEventListener('change', rafraichir);
  chVehicule.entree.addEventListener('change', rafraichir);
  chCredits.entree.addEventListener('input', verifierCredits);
  chEtat.entree.addEventListener('change', verifierCredits);
  chType.entree.addEventListener('input', rafraichirMemoire);
  chOperation.entree.addEventListener('change', rafraichirMemoire);
  rafraichir();

  /* --- le corps ------------------------------------------------------------ */
  const corps = h('div.pile', [
    chDossier.noeud,
    chVehicule.noeud,
    ligneClient,
    h('hr', { style: { border: '0', borderTop: '1px solid var(--trait-fin)' } }),
    grilleChamps([chDate, chOutil]),
    grilleChamps([chOperation, chProtocole]),
    h('div.majuscule', 'Le calculateur'),
    grilleChamps([chMarque, chType, chHw, chSw]),
    memoEcu,
    blocProgramme,
    h('div.majuscule', 'Le déroulé'),
    controles.noeud,
    suitLesCredits(e)
      ? grilleChamps([chCredits, chDuree, chSlave])
      : grilleChamps([chDuree, chSlave]),
    chEtat.noeud,
    i && i.etat === 'ok' && suitLesCredits(e) ? h('div.bandeau.bandeau--alerte', [
      icone('info'),
      h('span', 'Les crédits de cette intervention ont déjà été débités. '
        + 'La repasser en échec ne les rend pas : passez par « Corriger le solde » '
        + 'si l’appareil affiche autre chose.')
    ]) : null,
    avertCredits,
    chResultat.noeud,
    h('div.majuscule', 'Les fichiers'),
    fichiers.noeud,
    chNotes.noeud
  ]);

  modale({
    titre: i
      ? 'Intervention du ' + fmt.date(i.quand, 'normal')
      : (modele
        /* On dit d'où vient ce qui est déjà rempli : sinon on croit à une
           fiche vierge et on ne relit pas ce qui a été recopié. */
        ? 'Nouvelle intervention — d’après celle du ' + fmt.date(modele.quand, 'court')
        : 'Nouvelle intervention'),
    taille: 'large',
    corps,
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      /* La fiche papier : ce qu'on classe au dossier, et ce qu'on fait signer
         quand on a touché à la dépollution. On imprime ce qui est ENREGISTRÉ,
         pas ce qui est à l'écran — sinon on fait signer un brouillon. */
      i ? {
        texte: 'Imprimer', ton: 'contour', ferme: false,
        faire: async () => {
          const { imprimerFicheElectro } = await import('./impression.js');
          imprimerFicheElectro(e, i);
        }
      } : null,
      {
        texte: i ? 'Enregistrer' : 'Enregistrer l’intervention', ton: 'fort',
        faire: async () => {
          const d = chDossier.lire() ? lit.dossier(e, chDossier.lire()) : null;
          const v = vehiculeChoisi();
          if (!d && !v) {
            chVehicule.erreur('Choisissez un dossier ou, à défaut, le véhicule concerné.');
            return false;
          }

          const ecu = {
            marque: chMarque.lire(), type: chType.lire(),
            hw: chHw.lire(), sw: chSw.lire()
          };
          const protocole = chProtocole.lire();
          const etatVoulu = chEtat.lire();

          /* Le garde-fou. Déclarer réussie une écriture sans original
             sauvegardé ni maintien de charge, c'est ce qui transforme une
             prestation en litige six mois plus tard. On ne bloque pas — c'est
             l'atelier qui sait — mais on ne laisse pas passer en silence. */
          const manquants = controlesManquants({
            operation: chOperation.lire(), etat: etatVoulu, controles: controles.lire()
          });
          if (manquants.length) {
            const ok = await confirmer({
              titre: 'Enregistrer quand même ?',
              texte: 'Cette écriture est déclarée réussie, mais '
                + (manquants.length > 1 ? 'ces points ne sont pas cochés' : 'ce point n’est pas coché')
                + ' : ' + manquants.map(c => c.nom.toLowerCase()).join(', ') + '.',
              detail: 'Cochez-les si c’est un oubli de saisie. Sinon, notez-le : '
                + 'c’est exactement ce qu’on cherche quand la voiture revient.',
              avertissement: manquants.some(c => c.cle === 'origine')
                ? 'Sans original sauvegardé, ce calculateur ne peut plus être remis d’aplomb.'
                : null,
              ok: 'Enregistrer quand même', annuler: 'Revenir cocher', danger: true
            });
            if (!ok) return false;
          }

          /* On garde l'heure d'origine tant que le jour ne change pas : une
             intervention notée « aujourd'hui » ne doit pas reculer à minuit
             au premier passage en modification. */
          const jourSaisi = chDate.lire();
          const base = i ? i.quand : Date.now();
          const quand = (jourSaisi && jour0(jourSaisi) !== jour0(base)) ? jourSaisi : base;

          const champs = {
            dossierId: d ? d.id : null,
            vehiculeId: v ? v.id : null,
            clientId: d ? d.clientId : (v ? v.clientId : null),
            outil: chOutil.lire(),
            operation: chOperation.lire(),
            protocole,
            ecu,
            credits: nombre(chCredits.lire(), 0),
            modifications: programmes.lire(),
            controles: controles.lire(),
            slave: chSlave.lire(),
            dureeMin: nombre(chDuree.lire(), 0),
            resultat: chResultat.lire(),
            notes: chNotes.lire(),
            fichiers: fichiers.lire(),
            quand
          };

          if (i) enregistrerModification(i, champs, etatVoulu);
          else act.enregistrerIntervention(Object.assign({ etat: etatVoulu }, champs));

          await proposerMajFicheVehicule(v, ecu, protocole);
          message(i ? 'Intervention mise à jour' : 'Intervention enregistrée', { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}

/**
 * Modification d'une intervention existante.
 *
 * Le solde de crédits est réconcilié par le domaine, pas ici : lui seul sait
 * ce que cette intervention a déjà fait retirer, et donc ce qu'il reste à
 * bouger. L'écran se contente de dire à quoi elle doit ressembler.
 */
function enregistrerModification(i, champs, etatVoulu) {
  /* Un seul geste : `modifierIntervention` écrit les champs ET remet le solde
     de crédits d'accord avec le résultat. Écrire les champs à part laissait le
     solde inchangé quand on corrigeait le nombre de crédits sans toucher à
     l'état. */
  act.modifierIntervention(i.id, Object.assign({}, champs, { etat: etatVoulu }));
}

/** Ce qu'on a lu sur le boîtier vaut mieux que ce que la fiche véhicule dit. */
async function proposerMajFicheVehicule(v, ecu, protocole) {
  if (!v) return;
  const ancien = v.ecu || {};
  const differe = ['marque', 'type', 'hw', 'sw'].some(k => (ecu[k] || '') !== (ancien[k] || ''))
    || (protocole || '') !== (ancien.protocole || '');
  if (!differe) return;
  /* Rien à proposer si l'intervention ne dit rien du calculateur. */
  if (!ecu.marque && !ecu.type && !ecu.hw && !ecu.sw) return;

  const ok = await confirmer({
    titre: 'Mettre à jour la fiche du véhicule ?',
    texte: 'La fiche de ' + plaqueJolie(v.immat) + ' porterait désormais : '
      + [ecu.marque, ecu.type, ecu.hw ? 'HW ' + ecu.hw : '', ecu.sw ? 'SW ' + ecu.sw : '',
         (PROTOCOLES[protocole] || {}).nom].filter(Boolean).join(' · ')
      + '. La prochaine intervention partira de ces valeurs.',
    ok: 'Mettre à jour'
  });
  if (!ok) return;

  maj('Calculateur du véhicule mis à jour', (etat) => {
    const x = lit.vehicule(etat, v.id);
    if (!x) return null;
    x.ecu = Object.assign({}, x.ecu, ecu, { protocole });
    x.maj = Date.now();
    return x;
  }, { cible: { type: 'vehicules', id: v.id } });
}

/* ==========================================================================
   CE QU'ON A FAIT AU FICHIER
   --------------------------------------------------------------------------
   Des pastilles qu'on tape du pouce, groupées par famille. Pas une liste
   déroulante : on en coche trois ou quatre d'un coup, et on veut les voir
   toutes en même temps pour ne pas en oublier une au moment de facturer.
   ========================================================================== */

function choixProgrammes(depart) {
  const choisis = new Set((depart || []).filter(m => MODIFICATIONS_ELECTRO[m]));
  const zone = h('div.pile-s');
  const avert = h('div');

  function basculer(cle) {
    if (choisis.has(cle)) choisis.delete(cle); else choisis.add(cle);
    peindreTout();
  }

  function peindreTout() {
    poser(zone, Object.keys(FAMILLES_MODIF).map(fam => {
      const cles = Object.keys(MODIFICATIONS_ELECTRO)
        .filter(k => MODIFICATIONS_ELECTRO[k].famille === fam);
      if (!cles.length) return null;
      return h('div.pile-s', [
        h('div.minus.tres-faible', FAMILLES_MODIF[fam].nom),
        h('div.rang-s.enroule', cles.map(k => {
          const m = MODIFICATIONS_ELECTRO[k];
          const actif = choisis.has(k);
          return h('button.etiq' + (actif ? '.etiq--accent' : ''), {
            type: 'button',
            'aria-pressed': actif ? 'true' : 'false',
            title: m.aide || '',
            onclick: () => basculer(k)
          }, [
            actif ? icone('coche', { taille: 12 }) : null,
            h('span', m.nom)
          ]);
        }))
      ]);
    }));

    /* Une mention, pas une leçon : c'est le client qui roule avec, et c'est
       sur son document que ça doit figurer. */
    const horsRoute = Array.from(choisis).filter(k => MODIFICATIONS_ELECTRO[k].route === false);
    poser(avert, horsRoute.length
      ? h('div.bandeau.bandeau--alerte', [
          icone('alerte'),
          h('div.grandit', [
            h('div.gras', 'Hors homologation route'),
            h('div.petit', horsRoute.map(k => MODIFICATIONS_ELECTRO[k].nom).join(', ')
              + ' — à reporter sur le document remis au client.')
          ])
        ])
      : null);
  }

  peindreTout();

  return {
    noeud: h('div.pile-s', [zone, avert]),
    lire: () => Object.keys(MODIFICATIONS_ELECTRO).filter(k => choisis.has(k))
  };
}

/* ==========================================================================
   LE DÉROULÉ QU'ON NE SAUTE PAS
   --------------------------------------------------------------------------
   Six cases. Deux d'entre elles — l'original sauvegardé et le maintien de
   charge — sont celles qui séparent une prestation d'un boîtier mort. Elles
   portent une marque, et l'enregistrement les redemande si elles manquent.
   ========================================================================== */

function listeControles(depart) {
  const coches = {};
  for (const k in CONTROLES_ELECTRO) if (depart && depart[k]) coches[k] = true;

  const noeud = h('div.pile-s', Object.keys(CONTROLES_ELECTRO).map(cle => {
    const c = CONTROLES_ELECTRO[cle];
    const case_ = h('input', {
      type: 'checkbox', checked: !!coches[cle],
      style: { accentColor: 'var(--accent)', flex: 'none', marginTop: '2px' },
      onchange: (ev) => { coches[cle] = !!ev.target.checked; }
    });
    /* L'entrée est DANS l'étiquette : toute la ligne devient cliquable, ce
       qui compte quand on coche avec des gants. */
    return h('label.rang.rang-haut', { style: { cursor: 'pointer' } }, [
      case_,
      h('div.grandit', [
        h('div.rang-s', [
          h('span', c.nom),
          c.bloquant ? h('span.pastille.pastille--alerte.pastille--sans-point', 'clé') : null
        ]),
        c.aide ? h('div.minus.tres-faible', c.aide) : null
      ])
    ]);
  }));

  return {
    noeud,
    lire: () => {
      const sortie = {};
      for (const k in CONTROLES_ELECTRO) if (coches[k]) sortie[k] = true;
      return sortie;
    }
  };
}

/* ==========================================================================
   LES FICHIERS D'UNE INTERVENTION
   --------------------------------------------------------------------------
   On note des NOMS, pas des binaires. Un fichier de calculateur pèse de
   quelques centaines de kilo-octets à plusieurs méga-octets ; les entasser
   dans la base rendrait l'outil inutilisable sur le téléphone de l'atelier,
   et une base ne remplace de toute façon pas la sauvegarde faite par
   l'appareil. Ce qu'on veut retrouver six mois plus tard, c'est : « quel
   fichier d'origine, lu quel jour, sur quelle voiture ».
   ========================================================================== */

function editeurFichiers(depart) {
  const fichiers = (depart || []).map(f => Object.assign({}, f));
  const liste = h('div.pile-s');
  const chNom = champ({ etiquette: 'Nom du fichier', exemple: 'EDC17C64_origine.bin' });
  const chRole = champ({
    etiquette: 'Rôle', type: 'liste',
    options: Object.keys(ROLES_FICHIER).map(k => ({ valeur: k, texte: ROLES_FICHIER[k].nom }))
  });
  /* Où il est rangé. C'est ce qui manque toujours deux ans plus tard : le nom
     du fichier, on l'a ; savoir sur quel disque et dans quel dossier, non. */
  const chOu = champ({
    etiquette: 'Rangé où', exemple: 'D:\\ECU\\2026\\FT-789-AB',
    aide: 'Disque, dossier, sauvegarde en ligne — de quoi remettre la main dessus.'
  });

  function peindre() {
    poser(liste, fichiers.length
      ? fichiers.map((f, index) => {
          const r = ROLES_FICHIER[f.role] || ROLES_FICHIER.origine;
          return h('div.carte.carte--muette.pile-s', [
            h('div.rang', [
              h('span.pastille.pastille--' + r.ton, r.nom),
              h('span.grandit.coupe.num', f.nom || 'sans nom'),
              /* Recopier le nom à la main devant le PC, c'est une faute de
                 frappe assurée. */
              h('button.bt.bt--nu.bt--icone.bt--s', {
                type: 'button', 'aria-label': 'Copier le nom de ' + (f.nom || 'ce fichier'),
                onclick: () => copier(f.nom)
              }, icone('copier')),
              h('button.bt.bt--nu.bt--icone.bt--s', {
                type: 'button', 'aria-label': 'Retirer ' + (f.nom || 'ce fichier'),
                onclick: () => { fichiers.splice(index, 1); peindre(); }
              }, icone('croix'))
            ]),
            f.ou ? h('div.minus.tres-faible.coupe', [
              icone('dossier', { taille: 12 }), ' ' + f.ou
            ]) : null
          ]);
        })
      : h('div.petit.faible', 'Aucun fichier noté pour l’instant.'));
  }

  function ajouter() {
    const n = chNom.lire();
    if (!n) { chNom.erreur('Recopiez le nom du fichier tel qu’il est rangé sur le PC.'); return; }
    chNom.erreur('');
    fichiers.push({
      id: id('fic'), nom: n, role: chRole.lire() || 'origine',
      ou: chOu.lire(), taille: 0, quand: Date.now()
    });
    chNom.ecrire('');
    chNom.focus();
    peindre();
  }

  peindre();

  const noeud = h('div.pile-s', [
    h('div.bandeau', [
      icone('info'),
      h('div.grandit', [
        h('div.gras', 'On note le nom et l’endroit, pas le fichier.'),
        h('div.petit', 'Les binaires restent sur le PC de l’atelier, avec l’outil qui les a lus. '
          + 'Ce que Yatech garde, c’est la trace de ce qui a été lu et écrit, et où c’est rangé — '
          + 'de quoi retrouver la bonne sauvegarde d’origine sans fouiller trois disques.')
      ])
    ]),
    liste,
    h('div.pile-s', [
      h('div.rang.enroule', { style: { alignItems: 'flex-end' } }, [
        h('div.grandit', chNom.noeud),
        chRole.noeud
      ]),
      h('div.rang.enroule', { style: { alignItems: 'flex-end' } }, [
        h('div.grandit', chOu.noeud),
        h('button.bt.bt--contour', {
          type: 'button', onclick: ajouter
        }, [icone('plus'), h('span', 'Ajouter')])
      ])
    ])
  ]);

  return { noeud, lire: () => fichiers.map(f => Object.assign({}, f)) };
}

/** Mettre un texte dans le presse-papiers, sans faire d'histoires si le
 *  navigateur refuse : on le dit, on ne casse rien. */
function copier(texte) {
  const t = String(texte || '');
  if (!t) return;
  const dire = (ok) => message(ok ? 'Copié' : 'Copie impossible sur cet appareil',
    { ton: ok ? 'ok' : 'danger', duree: 1600 });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => dire(true), () => dire(false));
    return;
  }
  dire(false);
}

/* ==========================================================================
   PETITS OUTILS DE CET ÉCRAN
   ========================================================================== */

/** Le premier instant du mois en cours. */
function debutDuMois() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Une aide qui change avec la valeur choisie. `champ()` ne pose son aide
 * qu'une fois, à la construction ; ici le texte du protocole ou de l'opération
 * doit suivre la liste, sinon il explique autre chose que ce qui est
 * sélectionné.
 */
function aideVivante(ch, texteDe) {
  const n = h('div.champ__aide');
  ch.noeud.appendChild(n);
  const rafraichir = () => { n.textContent = texteDe(ch.lire()) || ''; };
  ch.entree.addEventListener('change', rafraichir);
  rafraichir();
  return n;
}
