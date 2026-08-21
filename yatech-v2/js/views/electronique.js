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
  OUTILS_ELECTRO, PROTOCOLES, OPERATIONS_ELECTRO, ETATS_INTERVENTION
} from '../domain/schema.js';
import { enTete, indic, champ, grilleChamps, plaque, filtres } from '../ui/widgets.js';

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

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  let filtreActif = 'tout';
  let ecuFiltre = '';        // type de calculateur choisi dans la mémoire d'atelier
  let toutMontrer = false;
  let historiqueOuvert = false;

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
      blocCredits(e, refaire),
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
          panneauInterventions(e, refaire, filtreActif, ecuFiltre, toutMontrer, {
            surTout: () => { toutMontrer = true; refaire(); },
            surVidageEcu: () => { ecuFiltre = ''; refaire(); }
          })
        ]),
        h('div.pile', [
          memoireCalculateurs(e, ecuFiltre, (type) => {
            ecuFiltre = (ecuFiltre === type ? '' : type);
            refaire();
          }),
          panneauHistorique(e, historiqueOuvert, () => {
            historiqueOuvert = !historiqueOuvert;
            refaire();
          })
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

  return h('div.grille-indics', [
    indic({
      nom: 'Interventions', valeur: duMois.length,
      detail: fmt.nomMois(Date.now(), true)
    }),
    indic({
      nom: 'Taux de réussite',
      valeur: jugees ? fmt.pourcent(reussies / jugees * 100, 0) : '—',
      ton: jugees && reussies / jugees < 0.8 ? 'alerte' : null,
      detail: jugees
        ? reussies + ' sur ' + jugees + ' terminées'
        : 'rien de terminé ce mois'
    }),
    indic({
      nom: 'Crédits consommés', valeur: lit.creditsConsommes(e, depuis),
      detail: 'solde : ' + lit.soldeCredits(e)
    }),
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

function panneauInterventions(e, refaire, filtreActif, ecuFiltre, toutMontrer, rappels) {
  const toutes = lit.interventionsRecentes(e, (e.interventions || []).length);
  let liste = toutes.filter(i => garde(i, filtreActif));
  if (ecuFiltre) liste = liste.filter(i => cleEcu(i) === ecuFiltre);

  const tronque = !toutMontrer && liste.length > LIMITE_LISTE;
  const visibles = tronque ? liste.slice(0, LIMITE_LISTE) : liste;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('electro', { taille: 16 }),
      h('h2.grandit', 'Interventions'),
      h('span.compte', String(liste.length))
    ]),
    ecuFiltre ? h('div.panneau__corps', { style: { paddingBottom: '0' } },
      h('button.etiq.etiq--accent', {
        type: 'button', onclick: rappels.surVidageEcu
      }, [h('span', 'Calculateur ' + ecuFiltre), icone('croix', { taille: 13 })])
    ) : null,
    visibles.length
      ? h('div.panneau__corps', h('div.tableau-cadre', h('table.grille.repliable', [
          h('thead', h('tr', [
            h('th', 'Date'),
            h('th', 'Véhicule'),
            h('th', 'Client'),
            h('th', 'Calculateur'),
            h('th', 'Opération'),
            h('th', 'Protocole'),
            h('th.num', 'Crédits'),
            h('th.num', 'Durée'),
            h('th', 'État')
          ])),
          h('tbody', visibles.map(i => ligneIntervention(e, i, refaire)))
        ])))
      : h('div.panneau__corps', vide({
          icone: 'electro',
          titre: 'Aucune intervention',
          texte: filtreActif === 'tout' && !ecuFiltre
            ? 'Chaque lecture et chaque écriture notée ici devient la mémoire de l’atelier.'
            : 'Rien ne correspond à ce filtre.',
          action: filtreActif === 'tout' && !ecuFiltre
            ? { texte: 'Nouvelle intervention', faire: () => modaleIntervention(e, refaire, null) }
            : null
        })),
    tronque ? h('div.panneau__pied', h('button.bt.bt--nu.bt--plein', {
      type: 'button', onclick: rappels.surTout
    }, 'Afficher les ' + liste.length + ' interventions')) : null
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
    h('td', { donnees: { col: 'Protocole' } }, proto ? proto.nom : i.protocole),
    h('td.num', { donnees: { col: 'Crédits' } },
      nombre(i.credits, 0) ? String(nombre(i.credits, 0)) : ''),
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

function cleEcu(i) {
  return String((i.ecu && i.ecu.type) || '').trim();
}

function regrouperParEcu(e) {
  const par = new Map();
  for (const i of e.interventions || []) {
    const type = cleEcu(i);
    if (!type) continue;
    const cle = type.toUpperCase();
    let g = par.get(cle);
    if (!g) {
      g = { type, marque: '', nb: 0, protocoles: new Map(), vehicules: new Set(), dernier: 0, reussies: 0 };
      par.set(cle, g);
    }
    g.nb++;
    if (i.etat === 'ok') {
      g.reussies++;
      const p = i.protocole || '';
      if (p) g.protocoles.set(p, (g.protocoles.get(p) || 0) + 1);
    }
    if (i.vehiculeId) g.vehicules.add(i.vehiculeId);
    if (i.quand > g.dernier) {
      g.dernier = i.quand;
      g.type = type;                                   // la dernière orthographe saisie
      if (i.ecu && i.ecu.marque) g.marque = i.ecu.marque;
    }
  }

  const sortie = Array.from(par.values());
  for (const g of sortie) {
    let meilleur = null, mieux = 0;
    for (const [p, n] of g.protocoles) if (n > mieux) { mieux = n; meilleur = p; }
    g.protocole = meilleur;
  }
  return sortie.sort((a, b) => b.nb - a.nb || b.dernier - a.dernier);
}

function memoireCalculateurs(e, ecuFiltre, surChoix) {
  const groupes = regrouperParEcu(e);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('puce', { taille: 16 }),
      h('h2.grandit', 'Calculateurs déjà vus'),
      groupes.length ? h('span.compte.compte--accent', String(groupes.length)) : null
    ]),
    groupes.length
      ? h('div.liste', groupes.slice(0, 14).map(g => {
          const proto = g.protocole ? PROTOCOLES[g.protocole] : null;
          const plaques = Array.from(g.vehicules)
            .map(vid => lit.vehicule(e, vid))
            .filter(Boolean)
            .map(v => plaqueJolie(v.immat));
          const choisi = ecuFiltre === g.type;

          return h('button.liste__ligne', {
            type: 'button',
            'aria-pressed': choisi ? 'true' : 'false',
            style: choisi ? { background: 'var(--accent-voile)' } : null,
            onclick: () => surChoix(g.type)
          }, [
            h('div.grandit.coupe', [
              h('div.rang-s', [
                h('span.gras.coupe', g.type),
                proto ? h('span.pastille.pastille--info', proto.nom) : null
              ]),
              h('div.petit.faible.coupe', [
                g.marque,
                g.nb + ' fois'
              ].filter(Boolean).join(' · ')),
              plaques.length
                ? h('div.minus.tres-faible.coupe', plaques.slice(0, 4).join(' · ')
                    + (plaques.length > 4 ? ' +' + (plaques.length - 4) : ''))
                : null
            ]),
            icone(choisi ? 'croix' : 'filtre', { taille: 14, classe: 'tres-faible' })
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Renseignez le type de calculateur sur vos interventions : '
          + 'l’atelier se constitue tout seul une mémoire des boîtiers déjà ouverts.'))
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

function modaleIntervention(e, refaire, existante) {
  const i = existante || null;
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
    valeur: i ? i.outil : (e.reglages.outilDefaut || 'autotuner'),
    options: Object.keys(OUTILS_ELECTRO).map(k => ({ valeur: k, texte: OUTILS_ELECTRO[k] }))
  });
  const chOperation = champ({
    etiquette: 'Opération', type: 'liste',
    valeur: i ? i.operation : 'lecture',
    options: Object.keys(OPERATIONS_ELECTRO).map(k => ({ valeur: k, texte: OPERATIONS_ELECTRO[k].nom }))
  });
  const chProtocole = champ({
    etiquette: 'Protocole', type: 'liste',
    valeur: i ? i.protocole : 'obd',
    options: Object.keys(PROTOCOLES).map(k => ({ valeur: k, texte: PROTOCOLES[k].nom }))
  });
  aideVivante(chOperation, (v) => (OPERATIONS_ELECTRO[v] || {}).aide);
  aideVivante(chProtocole, (v) => (PROTOCOLES[v] || {}).aide);

  /* --- le calculateur ------------------------------------------------------ */
  const ecuDepart = (i && i.ecu) || {};
  const chMarque = champ({ etiquette: 'Marque calculateur', valeur: ecuDepart.marque || '', exemple: 'Bosch' });
  const chType   = champ({ etiquette: 'Type', valeur: ecuDepart.type || '', exemple: 'EDC17C10' });
  const chHw     = champ({ etiquette: 'HW', valeur: ecuDepart.hw || '', exemple: '03…' });
  const chSw     = champ({ etiquette: 'SW', valeur: ecuDepart.sw || '', exemple: '1037…' });

  /* Tant que personne n'a touché aux champs du calculateur, ils suivent la
     fiche du véhicule choisi. Dès la première frappe, on arrête de les
     écraser : rien n'est plus agaçant qu'une saisie qui s'efface. */
  let ecuTouche = false;
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
  }

  function verifierCredits() {
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
    h('div.majuscule', 'Le déroulé'),
    grilleChamps([chCredits, chDuree, chSlave]),
    chEtat.noeud,
    i && i.etat === 'ok' ? h('div.bandeau.bandeau--alerte', [
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
    titre: i ? 'Intervention du ' + fmt.date(i.quand, 'normal') : 'Nouvelle intervention',
    taille: 'large',
    corps,
    actions: [
      { texte: 'Annuler', ton: 'contour' },
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
 * L'état est traité à part : passer en « réussie » débite les crédits, et
 * seul `terminerIntervention` sait ne le faire qu'une fois. On écrit donc tout
 * le reste d'abord, puis on lui laisse la main sur l'état.
 */
function enregistrerModification(i, champs, etatVoulu) {
  maj('Intervention modifiée', (etat) => {
    const x = lit.intervention(etat, i.id);
    if (!x) return null;
    Object.assign(x, champs);
    return x;
  }, { cible: { type: 'interventions', id: i.id } });

  if (etatVoulu !== i.etat) act.terminerIntervention(i.id, etatVoulu, champs.resultat);
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
  const chNom = champ({ etiquette: 'Nom du fichier', exemple: 'EDC17C10_origine.bin' });
  const chRole = champ({
    etiquette: 'Rôle', type: 'liste',
    options: Object.keys(ROLES_FICHIER).map(k => ({ valeur: k, texte: ROLES_FICHIER[k].nom }))
  });

  function peindre() {
    poser(liste, fichiers.length
      ? fichiers.map((f, index) => {
          const r = ROLES_FICHIER[f.role] || ROLES_FICHIER.origine;
          return h('div.carte.rang.carte--muette', [
            h('span.pastille.pastille--' + r.ton, r.nom),
            h('span.grandit.coupe.num', f.nom || 'sans nom'),
            h('button.bt.bt--nu.bt--icone.bt--s', {
              type: 'button', 'aria-label': 'Retirer ' + (f.nom || 'ce fichier'),
              onclick: () => { fichiers.splice(index, 1); peindre(); }
            }, icone('croix'))
          ]);
        })
      : h('div.petit.faible', 'Aucun fichier noté pour l’instant.'));
  }

  function ajouter() {
    const n = chNom.lire();
    if (!n) { chNom.erreur('Recopiez le nom du fichier tel qu’il est rangé sur le PC.'); return; }
    chNom.erreur('');
    fichiers.push({ id: id('fic'), nom: n, role: chRole.lire() || 'origine', quand: Date.now() });
    chNom.ecrire('');
    chNom.focus();
    peindre();
  }

  peindre();

  const noeud = h('div.pile-s', [
    h('div.bandeau', [
      icone('info'),
      h('div.grandit', [
        h('div.gras', 'On note le nom, pas le fichier.'),
        h('div.petit', 'Les binaires restent sur le PC de l’atelier, avec l’outil qui les a lus. '
          + 'Ce que Yatech garde, c’est la trace de ce qui a été lu et écrit — de quoi retrouver '
          + 'la bonne sauvegarde d’origine sans fouiller trois disques.')
      ])
    ]),
    liste,
    h('div.rang.enroule', { style: { alignItems: 'flex-end' } }, [
      h('div.grandit', chNom.noeud),
      chRole.noeud,
      h('button.bt.bt--contour', {
        type: 'button', onclick: ajouter
      }, [icone('plus'), h('span', 'Ajouter')])
    ])
  ]);

  return { noeud, lire: () => fichiers.map(f => Object.assign({}, f)) };
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
