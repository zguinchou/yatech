/* ==========================================================================
   YATECH — écran « Devis »
   --------------------------------------------------------------------------
   Un devis, c'est de l'argent qui n'est pas encore gagné. Cet écran ne sert
   pas à admirer ce qu'on a chiffré : il sert à voir ce qui dort. Un devis
   parti chez le client il y a une semaine sans réponse ne rapporte rien tant
   que personne ne décroche le téléphone — c'est pour ça que la relance est un
   bouton sur la ligne, et pas une case cachée dans la fiche.

   Un devis ne se crée PAS ici : il naît d'un dossier, dont il fige les lignes
   (voir act.creerDevis). D'où le bouton « Nouveau dossier » plutôt que
   « Nouveau devis » : partir d'ici pour chiffrer, ce serait chiffrer un
   véhicule qui n'est rattaché à rien.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { menu, message, confirmer, vide } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import {
  JOUR, nombre, par, pluriel, somme, surligne, correspond, plaqueJolie, plaqueNue
} from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { totaux } from '../domain/calculs.js';
import { telechargerDevis } from '../domain/ebp.js';
import {
  enTete, indic, filtres, barreRecherche, plaque, pastilleDevis, menuEnvoi
} from '../ui/widgets.js';
import { nouveauDossierModale } from './dossier-nouveau.js';

/** Les tris proposés, avec le sens qui va de soi pour chacun : une liste de
 *  devis se lit du plus récent, un montant du plus gros, un client de A à Z. */
const TRIS = [
  { cle: 'date', nom: 'Date', sens: 'desc' },
  { cle: 'montant', nom: 'Montant', sens: 'desc' },
  { cle: 'client', nom: 'Client', sens: 'asc' }
];

/* « Envoyés » garde tout ce qui est parti, « À relancer » n'en montre que la
   part qui traîne : les deux se recoupent volontairement, on veut pouvoir
   regarder l'ensemble puis ne garder que ce qui presse. */
const FILTRES = [
  { cle: 'tous', texte: 'Tous', garde: () => true },
  { cle: 'brouillon', texte: 'Brouillons', garde: (x) => x.devis.statut === 'brouillon' },
  { cle: 'envoye', texte: 'Envoyés', garde: (x) => x.devis.statut === 'envoye' },
  { cle: 'relance', texte: 'À relancer', icone: 'cloche', garde: (x) => x.aRelancer },
  { cle: 'accepte', texte: 'Acceptés', garde: (x) => x.devis.statut === 'accepte' },
  { cle: 'refuse', texte: 'Refusés', garde: (x) => x.devis.statut === 'refuse' },
  { cle: 'expire', texte: 'Périmés', icone: 'sablier', garde: (x) => x.devis.statut === 'expire' }
];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  let filtre = String((ctx.query && ctx.query.filtre) || 'tous');
  let tri = 'date';
  let sens = 'desc';

  const racine = h('div.pile');
  const zoneFiltres = h('div');
  const zoneListe = h('div');

  /* Les montants, le client et le véhicule de chaque devis sont préparés une
     fois par peinture : les recalculer à chaque frappe dans la recherche
     relirait tout le fichier des dossiers pour rien. */
  let vues = preparer(e);

  /** Repeint filtres et liste sans toucher au reste : on tape dans la barre de
   *  recherche, le curseur doit y rester. */
  function refaireListe() {
    const base = requete ? vues.filter(x => correspond(x.texte, requete)) : vues;

    poser(zoneFiltres, filtres(
      FILTRES.map(f => ({
        cle: f.cle, texte: f.texte, icone: f.icone,
        compte: base.filter(f.garde).length
      })),
      filtre,
      (cle) => { filtre = cle; refaireListe(); }
    ));

    const f = FILTRES.find(x => x.cle === filtre) || FILTRES[0];
    const liste = base.filter(f.garde).sort(comparateur(tri, sens));

    poser(zoneListe, liste.length
      ? tableau(e, liste, requete, { tri, sens, surTri: changerTri }, refaireTout)
      : rienTrouve(e, requete, filtre, refaireTout));
  }

  function changerTri(cle) {
    /* Recliquer sur la même colonne inverse le sens ; changer de colonne
       repart du sens naturel de cette colonne. */
    if (tri === cle) sens = sens === 'asc' ? 'desc' : 'asc';
    else { tri = cle; sens = (TRIS.find(t => t.cle === cle) || {}).sens || 'asc'; }
    refaireListe();
  }

  function refaireTout() {
    vues = preparer(e);
    poser(racine, contenu());
    refaireListe();
  }

  function contenu() {
    const attente = vues.filter(x => x.devis.statut === 'envoye');
    const enJeu = somme(attente, x => x.ttc);

    return [
      enTete({
        titre: 'Devis',
        sous: attente.length
          ? attente.length + ' en attente de réponse, '
            + fmt.euros(enJeu, { sansCentimes: true }) + ' en jeu'
          : 'Aucun devis en attente de réponse',
        actions: [
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => nouveauDossierModale(e, refaireTout)
          }, [icone('plus'), h('span', 'Nouveau dossier')]),
          h('button.bt.bt--contour.bt--icone', {
            type: 'button',
            'aria-label': 'Autres actions',
            onclick: (ev) => menuEcran(ev.currentTarget, e, refaireTout)
          }, icone('points'))
        ]
      }),
      indicateurs(e, vues),
      barreRecherche({
        valeur: requete,
        exemple: 'Numéro, objet, nom du client, plaque…',
        surChangement: (v) => { requete = v; refaireListe(); }
      }),
      h('div.devis-outils', [
        zoneFiltres,
        h('label.devis-tri-mobile', [
          h('span.majuscule', 'Trier par'),
          h('select.saisie', {
            onchange: (ev) => {
              tri = ev.currentTarget.value;
              sens = (TRIS.find(t => t.cle === tri) || {}).sens || 'asc';
              refaireListe();
            }
          }, TRIS.map(t => h('option', { value: t.cle, texte: t.nom, selected: t.cle === tri })))
        ])
      ]),
      zoneListe
    ];
  }

  poser(racine, contenu());
  refaireListe();
  return racine;
}

/* ==========================================================================
   CE QU'ON SAIT DE CHAQUE DEVIS
   ========================================================================== */

/**
 * Une vue par devis : le client, le véhicule, le total TTC, l'ancienneté de
 * l'envoi et le texte sur lequel la recherche mord.
 */
function preparer(e) {
  const seuil = nombre(e.reglages.relanceDevis, 4);
  const maintenant = Date.now();

  /* Le contexte de prix dépend du client, pas du devis : un client qui a dix
     devis n'a pas dix grilles tarifaires. */
  const grilles = new Map();
  const grilleDe = (clientId) => {
    if (!grilles.has(clientId)) grilles.set(clientId, lit.prixDe(e, clientId));
    return grilles.get(clientId);
  };

  return (e.devis || []).map(dv => {
    const c = dv.clientId ? lit.client(e, dv.clientId) : null;
    const v = dv.vehiculeId ? lit.vehicule(e, dv.vehiculeId) : null;
    /* Même calcul que les alertes du tableau de bord : sans ça un devis
       serait « à relancer » ici et pas là-bas, à un jour près. */
    const jours = dv.envoyeLe ? Math.round((maintenant - dv.envoyeLe) / JOUR) : null;

    return {
      devis: dv,
      client: c,
      vehicule: v,
      nomClient: lit.nomClient(c),
      triClient: lit.nomClientTri(c) || null,
      ttc: totaux(dv, grilleDe(dv.clientId)).ttc,
      jours,
      aRelancer: dv.statut === 'envoye' && jours !== null && jours >= seuil,
      texte: [
        dv.numero, dv.objet, lit.nomClient(c),
        v ? plaqueNue(v.immat) : '', v ? plaqueJolie(v.immat) : ''
      ].filter(Boolean).join(' ')
    };
  });
}

function comparateur(tri, sens) {
  if (tri === 'montant') return par(x => x.ttc, sens);
  if (tri === 'client') return par(x => x.triClient, sens);
  return par(x => x.devis.emisLe || x.devis.cree || null, sens);
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function indicateurs(e, vues) {
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  const brouillons = vues.filter(x => x.devis.statut === 'brouillon');
  const attente = vues.filter(x => x.devis.statut === 'envoye');
  const aRelancer = vues.filter(x => x.aRelancer);
  const acceptes = vues.filter(x => x.devis.statut === 'accepte');
  const refuses = vues.filter(x => x.devis.statut === 'refuse');
  const acceptesDuMois = acceptes.filter(x => (x.devis.repondeLe || 0) >= debutMois);

  const repondus = acceptes.length + refuses.length;
  const taux = repondus ? Math.round((acceptes.length / repondus) * 100) : null;

  return h('div.grille-indics', [
    indic({
      nom: 'Brouillons', valeur: brouillons.length,
      detail: brouillons.length ? 'pas encore montrés au client' : 'rien qui traîne'
    }),
    indic({
      nom: 'Sans réponse', valeur: attente.length,
      ton: aRelancer.length ? 'alerte' : null,
      detail: aRelancer.length
        ? pluriel(aRelancer.length, 'à relancer', 'à relancer')
        : 'tous encore dans les temps'
    }),
    indic({
      nom: 'Acceptés ce mois', valeur: acceptesDuMois.length,
      ton: acceptesDuMois.length ? 'ok' : null,
      detail: fmt.euros(somme(acceptesDuMois, x => x.ttc), { sansCentimes: true }) + ' signés'
    }),
    indic({
      nom: 'Taux d’acceptation',
      valeur: taux === null ? null : fmt.pourcent(taux),
      detail: repondus
        ? acceptes.length + ' oui / ' + refuses.length + ' non'
        : 'aucune réponse encore reçue'
    }),
    indic({
      nom: 'Montant en attente',
      valeur: fmt.euros(somme(attente, x => x.ttc), { sansCentimes: true }),
      detail: 'chez le client, sans réponse'
    })
  ]);
}

/* ==========================================================================
   LE TABLEAU
   ========================================================================== */

function tableau(e, liste, requete, triage, refaireTout) {
  /* Au clavier comme à la souris, on trie en cliquant la colonne ; le doigt,
     lui, passe par la liste déroulante de la barre d'outils. */
  const enteteTriable = (cle, nom, classe) => {
    const actif = triage.tri === cle;
    return h('th' + (classe || ''), {
      'aria-sort': actif ? (triage.sens === 'asc' ? 'ascending' : 'descending') : 'none'
    }, h('button.devis-tri' + (actif ? '.devis-tri--actif' : ''), {
      type: 'button', onclick: () => triage.surTri(cle)
    }, [
      h('span', nom),
      icone(actif ? (triage.sens === 'asc' ? 'haut' : 'bas') : 'trier', { taille: 13 })
    ]));
  };

  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      h('th', 'Numéro'),
      enteteTriable('date', 'Date'),
      enteteTriable('client', 'Client'),
      h('th', 'Véhicule'),
      h('th', 'Objet'),
      enteteTriable('montant', 'Montant TTC', '.num'),
      h('th', 'Statut'),
      h('th', 'Depuis'),
      h('th.serre', 'Relance')
    ])),
    h('tbody', liste.map(x => ligne(e, x, requete, refaireTout)))
  ]));
}

function ligne(e, x, requete, refaireTout) {
  const dv = x.devis;
  const aller = () => { location.hash = '#/devis/' + dv.id; };

  return h('tr.cliquable' + (x.aRelancer ? '.devis-relance' : ''), {
    tabindex: 0,
    onclick: aller,
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); }
    }
  }, [
    h('td.serre', { donnees: { col: 'Numéro' } }, [
      h('b.num', { html: surligne(dv.numero || '—', requete) }),
      dv.version > 1 ? h('span.minus.tres-faible', ' v' + dv.version) : null
    ]),
    h('td.serre', { donnees: { col: 'Date' } }, fmt.date(dv.emisLe || dv.cree, 'court')),
    h('td', { donnees: { col: 'Client' } }, x.client
      ? h('a.coupe', {
          href: '#/client/' + x.client.id,
          /* La ligne entière mène au devis : sans ça, le clic sur le nom
             partirait chez le client puis serait aussitôt écrasé. */
          onclick: (ev) => ev.stopPropagation(),
          html: surligne(x.nomClient, requete)
        })
      : h('span.tres-faible', 'client inconnu')),
    h('td.serre', { donnees: { col: 'Véhicule' } },
      x.vehicule ? plaque(x.vehicule.immat) : h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Objet' } }, dv.objet
      ? h('span.coupe', { html: surligne(dv.objet, requete) })
      : h('span.tres-faible', 'sans objet')),
    h('td.num', { donnees: { col: 'Montant TTC' } }, fmt.euros(x.ttc)),
    h('td.serre', { donnees: { col: 'Statut' } }, pastilleDevis(dv.statut)),
    h('td.serre', { donnees: { col: 'Depuis' } }, dv.envoyeLe
      ? h('span' + (x.aRelancer ? '.gras' : '.faible'), fmt.quand(dv.envoyeLe, { avecHeure: false }))
      : h('span.tres-faible', 'pas envoyé')),
    h('td.serre', { donnees: { col: 'Relance' } }, x.aRelancer
      ? h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: (ev) => {
            ev.stopPropagation();
            relancer(e, x, ev.currentTarget);
          }
        }, [icone('cloche', { taille: 14 }), h('span', 'Relancer')])
      : null)
  ]);
}

/* ==========================================================================
   LA RELANCE
   Le message est préparé, jamais expédié : une page web n'envoie rien toute
   seule, c'est le téléphone de la personne qui envoie.
   ========================================================================== */

function relancer(e, x, ancre) {
  const c = x.client;
  const dv = x.devis;
  const texte = remplirModele(e.reglages.messageRelance, {
    prenom: (c && c.prenom) || x.nomClient,
    numero: dv.numero || '',
    vehicule: x.vehicule ? lit.nomVehicule(x.vehicule) : 'votre véhicule',
    immat: x.vehicule ? plaqueJolie(x.vehicule.immat) : '',
    montant: fmt.euros(x.ttc),
    garage: e.reglages.raisonSociale || e.reglages.nomOutil || ''
  });

  menuEnvoi(ancre, {
    tel: c ? c.tel : null,
    email: c ? c.email : null,
    sujet: 'Devis ' + (dv.numero || '') + ' — votre accord',
    texte
  });
}

/**
 * Remplit un modèle de message. Les repères inconnus sont laissés tels quels :
 * le garagiste écrit ses modèles à la main dans les réglages, et voir
 * « {prenon} » en clair lui montre sa faute de frappe mieux qu'un trou.
 */
function remplirModele(modele, valeurs) {
  return String(modele || '').replace(/\{(\w+)\}/g, (tout, cle) =>
    (valeurs[cle] === undefined || valeurs[cle] === null) ? tout : String(valeurs[cle]));
}

/* ==========================================================================
   LE MENU DE L'ÉCRAN — le passage vers EBP
   La facturation officielle vit dans EBP : ici on prépare le fichier, on le
   dépose, et on marque ce qui est passé pour ne pas le repasser deux fois.
   ========================================================================== */

function menuEcran(ancre, e, refaireTout) {
  const acceptes = (e.devis || []).filter(d => d.statut === 'accepte');
  const jamaisReportes = acceptes.filter(d => !d.ebp);

  const items = [];
  if (jamaisReportes.length) {
    items.push({
      texte: 'Exporter les ' + jamaisReportes.length + ' non reportés',
      icone: 'telecharger',
      faire: () => exporterVersEbp(e, jamaisReportes, refaireTout)
    });
  }
  items.push({
    texte: acceptes.length
      ? 'Exporter tous les acceptés (' + acceptes.length + ')'
      : 'Aucun devis accepté à exporter',
    icone: 'telecharger',
    faire: () => {
      if (!acceptes.length) {
        message('Aucun devis accepté pour le moment', { ton: 'alerte' });
        return;
      }
      exporterVersEbp(e, acceptes, refaireTout);
    }
  });

  menu(ancre, items, { titre: 'Vers EBP' });
}

async function exporterVersEbp(e, liste, refaireTout) {
  telechargerDevis(e, liste);
  message(pluriel(liste.length, 'devis exporté', 'devis exportés'), { ton: 'ok' });

  /* On ne marque pas d'office : le fichier peut très bien finir dans les
     téléchargements sans jamais être importé. C'est la personne qui a EBP
     sous les yeux qui sait si c'est passé. */
  const ok = await confirmer({
    titre: 'Marquer ces devis comme reportés ?',
    texte: 'À faire une fois le fichier importé dans EBP. Ils ne ressortiront '
      + 'plus dans « non reportés ».',
    ok: 'Marquer reportés'
  });
  if (!ok) return;

  for (const dv of liste) act.reporterDansEbp('devis', dv.id);
  refaireTout();
}

/* ==========================================================================
   QUAND IL N'Y A RIEN À MONTRER
   ========================================================================== */

function rienTrouve(e, requete, filtre, refaireTout) {
  if (requete) {
    return vide({
      icone: 'chercher',
      titre: 'Aucun devis pour « ' + requete + ' »',
      texte: 'Essayez le numéro du devis, trois lettres de la plaque, ou le nom du client.'
    });
  }

  if (filtre === 'relance') {
    return vide({
      icone: 'cocheRonde',
      titre: 'Rien à relancer',
      texte: 'Aucun devis envoyé ne dépasse '
        + pluriel(nombre(e.reglages.relanceDevis, 4), 'jour')
        + ' sans réponse. Ce délai se règle dans les réglages.'
    });
  }

  if (filtre !== 'tous') {
    const f = FILTRES.find(x => x.cle === filtre);
    return vide({
      icone: 'devis',
      titre: 'Aucun devis dans « ' + (f ? f.texte : filtre) + ' »',
      texte: 'Choisissez « Tous » pour revoir l’ensemble des devis.'
    });
  }

  return vide({
    icone: 'devis',
    titre: 'Aucun devis pour l’instant',
    texte: 'Un devis ne se crée pas depuis cet écran : il se prépare dans un dossier. '
      + 'Ouvrez le dossier du véhicule, posez les lignes de travaux, puis « Créer un devis » — '
      + 'le devis fige ces lignes et vient s’afficher ici.',
    action: {
      texte: 'Nouveau dossier',
      faire: () => nouveauDossierModale(e, refaireTout)
    }
  });
}
