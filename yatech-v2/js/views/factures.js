/* ==========================================================================
   YATECH — écran « Factures »
   --------------------------------------------------------------------------
   La facturation officielle vit dans EBP : c'est lui qui tient les numéros
   légaux et la comptabilité. Cet écran-ci sert à trois choses, et pas une de
   plus : préparer ce qui doit être facturé, savoir ce qui est réellement
   rentré, et relancer ce qui ne rentre pas.

   Une facture ne se crée donc pas depuis une page blanche : elle naît d'un
   dossier dont les travaux sont terminés (act.creerFacture fige ses lignes).
   D'où la section « À facturer » posée EN TÊTE de l'écran : c'est le seul
   endroit d'où le travail part, et on ne veut pas avoir à le chercher.

   Le numéro EBP se recopie à la main : c'est EBP qui le donne, une fois la
   facture réellement établie là-bas. Tant qu'il n'est pas saisi, la ligne
   montre un bouton plutôt qu'une pastille — on voit d'un coup d'œil ce qui
   n'a pas encore fait le voyage.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, demander, message, vide } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import {
  JOUR, nombre, par, pluriel, somme, surligne, correspond, cts,
  plaqueJolie, plaqueNue, plusMois, grouper
} from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { totaux } from '../domain/calculs.js';
import { MODES_REGLEMENT } from '../domain/schema.js';
import { telechargerFactures } from '../domain/ebp.js';
import {
  enTete, indic, filtres, barreRecherche, plaque, pastilleFacture, champ, menuEnvoi
} from '../ui/widgets.js';

/* « À facturer » recouvre deux réalités que le garagiste vit comme une seule :
   le dossier rendu dont la facture n'existe pas encore, et la facture
   préparée ici mais pas encore établie dans EBP. Les deux demandent le même
   geste, ils sont donc sous le même filtre. */
const FILTRES = [
  { cle: 'tous', texte: 'Tout', garde: () => true },
  { cle: 'attente', texte: 'À facturer', icone: 'sablier', garde: (x) => x.facture.statut === 'attente' },
  { cle: 'emise', texte: 'Émises', garde: (x) => x.facture.statut === 'emise' },
  { cle: 'partiel', texte: 'Partiellement réglées', garde: (x) => x.facture.statut === 'partiel' },
  { cle: 'reglee', texte: 'Réglées', garde: (x) => x.facture.statut === 'reglee' },
  { cle: 'retard', texte: 'En retard', icone: 'alerte', garde: (x) => x.enRetard }
];

/** Les filtres où la liste des dossiers non facturés a sa place. */
const FILTRES_AVEC_DOSSIERS = ['tous', 'attente'];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  let filtre = String((ctx.query && ctx.query.filtre) || 'tous');
  if (!FILTRES.some(f => f.cle === filtre)) filtre = 'tous';

  const racine = h('div.pile');
  const zoneFiltres = h('div');
  const zoneAFacturer = h('div');
  const zoneListe = h('div');

  /* Les totaux d'une facture coûtent une boucle sur ses lignes. On les calcule
     une fois par peinture, pas à chaque frappe dans la barre de recherche. */
  let vues = preparer(e);

  /** Repeint filtres, section « à facturer » et tableau — mais pas l'en-tête
   *  ni la barre de recherche, pour que le curseur reste où il est. */
  function refaireListe() {
    const base = requete ? vues.filter(x => correspond(x.texte, requete)) : vues;
    const dossiers = dossiersAFacturer(e, requete);

    poser(zoneFiltres, filtres(
      FILTRES.map(f => ({
        cle: f.cle, texte: f.texte, icone: f.icone,
        /* Le compte du filtre « À facturer » additionne les dossiers rendus et
           les factures préparées : c'est bien ce que l'écran montre dessous, et
           un chiffre qui ne compte pas ce qu'on voit est pire que pas de
           chiffre du tout. */
        compte: base.filter(f.garde).length + (f.cle === 'attente' ? dossiers.length : 0)
      })),
      filtre,
      (cle) => { filtre = cle; refaireListe(); }
    ));

    poser(zoneAFacturer, FILTRES_AVEC_DOSSIERS.includes(filtre)
      ? sectionAFacturer(e, dossiers, refaireTout)
      : null);

    const f = FILTRES.find(x => x.cle === filtre) || FILTRES[0];
    /* La plus récente en haut : c'est celle dont on parle au téléphone. */
    const liste = base.filter(f.garde)
      .sort(par(x => x.facture.emiseLe || x.facture.cree || null, 'desc'));

    /* Quand la section « À facturer » porte déjà du travail, on ne colle pas
       dessous un grand panneau « il n'y a rien » : il y a quelque chose. */
    const sectionPorte = dossiers.length && FILTRES_AVEC_DOSSIERS.includes(filtre);
    poser(zoneListe, liste.length
      ? tableau(e, liste, requete, refaireTout)
      : (sectionPorte ? null : rienTrouve(e, requete, filtre)));
  }

  function refaireTout() {
    vues = preparer(e);
    poser(racine, contenu());
    refaireListe();
  }

  function contenu() {
    const du = lit.encours(e);

    return [
      enTete({
        titre: 'Factures',
        sous: du.total > 0.005
          ? fmt.euros(du.total, { sansCentimes: true }) + ' restent à encaisser, dont '
            + fmt.euros(du.retard, { sansCentimes: true }) + ' en retard'
          : 'Tout est encaissé : rien ne dort chez les clients',
        actions: [
          h('button.bt.bt--contour', {
            type: 'button',
            onclick: () => exporterVersEbp(e, refaireTout)
          }, [icone('telecharger'), h('span', 'Exporter vers EBP')]),
          h('button.bt.bt--contour', {
            type: 'button',
            onclick: () => modaleRelances(e)
          }, [icone('cloche'), h('span', 'Relancer les impayés')])
        ]
      }),
      indicateurs(e, vues),
      barreRecherche({
        valeur: requete,
        exemple: 'Numéro, numéro EBP, client, plaque…',
        surChangement: (v) => { requete = v; refaireListe(); }
      }),
      zoneFiltres,
      zoneAFacturer,
      zoneListe,
      recapitulatifMois(e)
    ];
  }

  poser(racine, contenu());
  refaireListe();
  return racine;
}

/* ==========================================================================
   CE QU'ON SAIT DE CHAQUE FACTURE
   ========================================================================== */

/**
 * Une vue par facture : le client, le véhicule, les totaux, le retard, et le
 * texte sur lequel la recherche mord.
 */
function preparer(e) {
  const maintenant = Date.now();

  /* La grille tarifaire dépend du client, pas de la facture : un confrère qui
     a douze factures n'a pas douze remises. */
  const grilles = new Map();
  const grilleDe = (clientId) => {
    if (!grilles.has(clientId)) grilles.set(clientId, lit.prixDe(e, clientId));
    return grilles.get(clientId);
  };

  return (e.factures || []).map(f => {
    const c = f.clientId ? lit.client(e, f.clientId) : null;
    const v = f.vehiculeId ? lit.vehicule(e, f.vehiculeId) : null;
    const t = totaux(f, grilleDe(f.clientId));

    /* Le même calcul que les alertes du tableau de bord : une facture ne doit
       pas être « en retard » ici et pas là-bas, à un jour près. */
    const enRetard = f.statut !== 'attente' && t.reste > 0.005
      && !!f.echeanceLe && f.echeanceLe < maintenant;

    return {
      facture: f,
      client: c,
      vehicule: v,
      nomClient: lit.nomClient(c),
      totaux: t,
      enRetard,
      texte: [
        f.numero, f.numeroEbp, lit.nomClient(c),
        v ? plaqueNue(v.immat) : '', v ? plaqueJolie(v.immat) : '',
        v ? lit.nomVehicule(v) : ''
      ].filter(Boolean).join(' ')
    };
  });
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function indicateurs(e, vues) {
  const debutMois = debutDuMois(Date.now());
  const dossiers = lit.aFacturer(e);
  const montantDossiers = somme(dossiers, d => lit.totauxDossier(e, d).ttc);

  const ouvertes = vues.filter(x => x.facture.statut !== 'attente' && x.totaux.reste > 0.005);
  const enRetard = vues.filter(x => x.enRetard);
  const encaisse = encaissementsDepuis(e, debutMois);

  return h('div.grille-indics', [
    indic({
      nom: 'À facturer',
      valeur: dossiers.length,
      ton: dossiers.length ? 'alerte' : null,
      detail: dossiers.length
        ? fmt.euros(montantDossiers, { sansCentimes: true }) + ' de travaux rendus'
        : 'aucun véhicule rendu en attente'
    }),
    indic({
      nom: 'Émises non réglées',
      valeur: fmt.euros(somme(ouvertes, x => x.totaux.reste), { sansCentimes: true }),
      detail: ouvertes.length
        ? pluriel(ouvertes.length, 'facture ouverte', 'factures ouvertes')
        : 'plus rien d’ouvert'
    }),
    indic({
      nom: 'En retard',
      valeur: fmt.euros(somme(enRetard, x => x.totaux.reste), { sansCentimes: true }),
      ton: enRetard.length ? 'danger' : null,
      detail: enRetard.length
        ? pluriel(enRetard.length, 'échéance dépassée', 'échéances dépassées')
        : 'aucune échéance dépassée'
    }),
    indic({
      nom: 'Encaissé ce mois',
      valeur: fmt.euros(encaisse.total, { sansCentimes: true }),
      ton: encaisse.total > 0 ? 'ok' : null,
      detail: encaisse.nb
        ? pluriel(encaisse.nb, 'règlement reçu', 'règlements reçus')
        : 'rien reçu depuis le 1er'
    })
  ]);
}

/** Ce qui est réellement rentré depuis une date : les règlements, pas le
 *  chiffre facturé. Une facture émise n'est pas de l'argent en caisse. */
function encaissementsDepuis(e, depuis) {
  let total = 0, nb = 0;
  for (const f of e.factures || []) {
    for (const r of f.reglements || []) {
      if (!r || (r.quand || 0) < depuis) continue;
      total += nombre(r.montant);
      nb++;
    }
  }
  return { total: cts(total), nb };
}

/* ==========================================================================
   LA SECTION « À FACTURER » — les dossiers rendus, sans facture
   ========================================================================== */

/** Les dossiers rendus dont la facture n'existe pas encore, tamisés par la
 *  barre de recherche comme le reste de l'écran. */
function dossiersAFacturer(e, requete) {
  const liste = lit.aFacturer(e);
  if (!requete) return liste;
  return liste.filter(d => {
    const v = lit.vehicule(e, d.vehiculeId);
    return correspond([
      d.numero, lit.titreDossier(e, d), lit.nomClient(lit.client(e, d.clientId)),
      v ? plaqueNue(v.immat) : '', v ? plaqueJolie(v.immat) : ''
    ].filter(Boolean).join(' '), requete);
  });
}

function sectionAFacturer(e, dossiers, refaireTout) {
  if (!dossiers.length) return null;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('facture', { taille: 16 }),
      h('h2.grandit', 'À facturer'),
      h('span.compte.compte--accent', String(dossiers.length))
    ]),
    h('div.liste', dossiers.map(d => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      const t = lit.totauxDossier(e, d);

      return h('div.liste__ligne.liste__ligne--muette', [
        h('div.grandit.coupe', [
          h('div.rang-s', [
            v ? plaque(v.immat) : null,
            h('span.gras.coupe', lit.nomClient(c))
          ]),
          h('div.petit.faible.coupe', [
            d.numero,
            lit.titreDossier(e, d),
            fmt.euros(t.ttc) + ' TTC'
          ].filter(Boolean).join(' · '))
        ]),
        h('button.bt.bt--fort.bt--s', {
          type: 'button',
          onclick: () => {
            const f = act.creerFacture(d.id);
            if (!f) { message('Ce dossier n’a pas pu être facturé', { ton: 'danger' }); return; }
            message('Facture ' + (f.numero || '') + ' préparée', {
              ton: 'ok',
              action: { texte: 'Ouvrir', faire: () => { location.hash = '#/facture/' + f.id; } }
            });
            refaireTout();
          }
        }, [icone('facture', { taille: 14 }), h('span', 'Préparer la facture')])
      ]);
    }))
  ]);
}

/* ==========================================================================
   LE TABLEAU DES FACTURES
   ========================================================================== */

function tableau(e, liste, requete, refaireTout) {
  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      h('th', 'Numéro'),
      h('th', 'Date'),
      h('th', 'Client'),
      h('th', 'Véhicule'),
      h('th.num', 'Total TTC'),
      h('th.num', 'Réglé'),
      h('th.num', 'Reste'),
      h('th', 'Échéance'),
      h('th', 'Statut'),
      h('th', 'EBP'),
      h('th.serre', 'Encaisser')
    ])),
    h('tbody', liste.map(x => ligne(e, x, requete, refaireTout)))
  ]));
}

function ligne(e, x, requete, refaireTout) {
  const f = x.facture;
  const t = x.totaux;
  const aller = () => { location.hash = '#/facture/' + f.id; };

  return h('tr.cliquable' + (x.enRetard ? '.factures-retard' : ''), {
    tabindex: 0,
    onclick: aller,
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); }
    }
  }, [
    h('td.serre', { donnees: { col: 'Numéro' } },
      h('b.num', { html: surligne(f.numero || '—', requete) })),

    h('td.serre', { donnees: { col: 'Date' } }, fmt.date(f.emiseLe || f.cree, 'court')),

    h('td', { donnees: { col: 'Client' } }, x.client
      ? h('a.coupe', {
          href: '#/client/' + x.client.id,
          /* La ligne entière mène à la facture : sans ce stopPropagation, le
             clic sur le nom partirait chez le client puis serait écrasé. */
          onclick: (ev) => ev.stopPropagation(),
          html: surligne(x.nomClient, requete)
        })
      : h('span.tres-faible', 'client inconnu')),

    h('td.serre', { donnees: { col: 'Véhicule' } },
      x.vehicule ? plaque(x.vehicule.immat) : h('span.tres-faible', '—')),

    h('td.num', { donnees: { col: 'Total TTC' } }, fmt.euros(t.ttc)),

    h('td.num', { donnees: { col: 'Réglé' } }, t.regle > 0.005
      ? h('span', fmt.euros(t.regle))
      : h('span.tres-faible', '—')),

    h('td.num', { donnees: { col: 'Reste' } }, t.reste > 0.005
      ? h('b', { style: x.enRetard ? { color: 'var(--danger)' } : null }, fmt.euros(t.reste))
      : h('span.tres-faible', 'soldée')),

    h('td.serre', { donnees: { col: 'Échéance' } }, echeance(f, x.enRetard)),

    h('td.serre', { donnees: { col: 'Statut' } }, pastilleFacture(f.statut)),

    h('td.serre', { donnees: { col: 'EBP' } }, celluleEbp(e, f, refaireTout)),

    h('td.serre', { donnees: { col: 'Encaisser' } }, t.reste > 0.005 && f.statut !== 'attente'
      ? h('button.bt.bt--contour.bt--s', {
          type: 'button',
          'aria-label': 'Encaisser la facture ' + (f.numero || ''),
          onclick: (ev) => {
            ev.stopPropagation();
            modaleEncaissement(e, x, refaireTout);
          }
        }, [icone('euro', { taille: 14 }), h('span', 'Encaisser')])
      : null)
  ]);
}

function echeance(f, enRetard) {
  if (f.statut === 'attente') return h('span.tres-faible', 'pas encore émise');
  if (!f.echeanceLe) return h('span.tres-faible', '—');
  if (f.statut === 'reglee') return h('span.faible', fmt.date(f.echeanceLe, 'court'));
  return h('span' + (enRetard ? '.gras' : '.faible'), {
    style: enRetard ? { color: 'var(--danger)' } : null,
    title: fmt.date(f.echeanceLe, 'normal')
  }, fmt.quand(f.echeanceLe, { avecHeure: false }));
}

/* ==========================================================================
   LA COLONNE EBP
   Reporté ou pas : c'est la seule chose qu'on veut lire d'un coup d'œil.
   ========================================================================== */

function celluleEbp(e, f, refaireTout) {
  if (f.ebp) {
    return h('span.pastille.pastille--ok.pastille--sans-point', {
      title: 'Reporté dans EBP le ' + fmt.date(f.ebp, 'normal')
    }, f.numeroEbp ? f.numeroEbp : 'reporté');
  }

  /* Une facture pas encore émise n'a rien à faire dans EBP : on n'y propose
     pas un bouton qui ferait saisir un numéro qui n'existe pas. */
  if (f.statut === 'attente') return h('span.tres-faible', '—');

  return h('button.bt.bt--nu.bt--s', {
    type: 'button',
    'aria-label': 'Saisir le numéro EBP de la facture ' + (f.numero || ''),
    onclick: async (ev) => {
      ev.stopPropagation();
      const numero = await demander({
        titre: 'Numéro EBP',
        etiquette: 'Numéro donné par EBP à la facture ' + (f.numero || ''),
        exemple: 'FA00123',
        aide: 'Laissez vide si vous voulez seulement marquer la facture comme reportée.',
        ok: 'Marquer reportée'
      });
      if (numero === null) return;
      act.reporterDansEbp('facture', f.id, String(numero).trim());
      message('Facture marquée reportée dans EBP', { ton: 'ok' });
      refaireTout();
    }
  }, [icone('televerser', { taille: 14 }), h('span', 'à reporter')]);
}

/* ==========================================================================
   L'ENCAISSEMENT RAPIDE
   Le client est au comptoir, la carte à la main : deux champs, pas trois.
   ========================================================================== */

function modaleEncaissement(e, x, refaireTout) {
  const f = x.facture;
  const reste = x.totaux.reste;

  const montant = champ({
    type: 'euros', etiquette: 'Montant encaissé', unite: '€',
    valeur: fmt.montant(reste, 2), autofocus: true
  });
  const mode = champ({
    type: 'liste', etiquette: 'Mode de règlement',
    valeur: 'cb',
    options: Object.keys(MODES_REGLEMENT).map(k => ({ valeur: k, texte: MODES_REGLEMENT[k] }))
  });
  const note = champ({ etiquette: 'Note (facultatif)', exemple: 'N° de chèque, banque…' });

  /* Le solde d'un coup : c'est le cas neuf fois sur dix, et ça évite de
     retaper un montant au centime près. */
  const solder = h('button.bt.bt--contour.bt--s', {
    type: 'button',
    onclick: () => { montant.ecrire(fmt.montant(reste, 2)); montant.focus(); }
  }, [icone('coche', { taille: 14 }), h('span', 'Solder : ' + fmt.euros(reste))]);

  modale({
    titre: 'Encaisser la facture ' + (f.numero || ''),
    corps: h('div.pile', [
      h('div.petit.faible', [
        x.nomClient,
        x.vehicule ? ' · ' + plaqueJolie(x.vehicule.immat) : '',
        ' · total ' + fmt.euros(x.totaux.ttc) + ' TTC'
      ].join('')),
      montant.noeud,
      h('div.rang.enroule', [solder]),
      mode.noeud,
      note.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: async () => {
          const m = montant.lire();
          if (!(m > 0)) { montant.erreur('Un montant supérieur à zéro.'); return false; }

          /* Encaisser plus que le reste dû est presque toujours une faute de
             frappe. Presque : un client peut arrondir. On demande, on
             n'interdit pas. */
          if (m > reste + 0.005) {
            const quandMeme = await confirmer({
              titre: 'Plus que le reste dû ?',
              texte: 'Vous encaissez ' + fmt.euros(m) + ' alors qu’il reste '
                + fmt.euros(reste) + '. La facture passera en trop-perçu.',
              ok: 'Encaisser quand même'
            });
            if (!quandMeme) { montant.focus(); return false; }
          }

          act.encaisser(f.id, m, mode.lire(), note.lire());
          message('Règlement de ' + fmt.euros(m) + ' enregistré', { ton: 'ok' });
          refaireTout();
        }
      }
    ]
  });
}

/* ==========================================================================
   LE PASSAGE VERS EBP
   On produit le fichier, puis on demande si le report a bien eu lieu : un CSV
   peut très bien finir dans les téléchargements sans jamais être importé.
   ========================================================================== */

async function exporterVersEbp(e, refaireTout) {
  const liste = (e.factures || []).filter(f => f.statut !== 'attente' && !f.ebp);

  if (!liste.length) {
    message('Aucune facture à reporter : tout est déjà passé dans EBP', { ton: 'ok' });
    return;
  }

  telechargerFactures(e, liste);
  message(pluriel(liste.length, 'facture exportée', 'factures exportées'), { ton: 'ok' });

  const ok = await confirmer({
    titre: 'Marquer ces factures comme reportées ?',
    texte: 'À faire une fois le fichier importé dans EBP. Elles ne ressortiront plus '
      + 'dans « à reporter ». Les numéros EBP se saisissent ensuite ligne par ligne.',
    ok: 'Marquer reportées'
  });
  if (!ok) return;

  for (const f of liste) act.reporterDansEbp('facture', f.id);
  refaireTout();
}

/* ==========================================================================
   LES RELANCES
   Une relance par client, pas par facture : personne n'envoie trois messages
   d'affilée à la même personne. Le message est préparé, jamais expédié — une
   page web n'envoie rien toute seule, c'est le téléphone qui envoie.
   ========================================================================== */

function modaleRelances(e, refaireTout) {
  const maintenant = Date.now();
  const retards = [];

  for (const f of e.factures || []) {
    if (f.statut === 'attente') continue;
    if (!f.echeanceLe || f.echeanceLe > maintenant) continue;
    const t = totaux(f, lit.prixDe(e, f.clientId));
    if (t.reste <= 0.005) continue;
    retards.push({ facture: f, reste: t.reste, ttc: t.ttc });
  }

  if (!retards.length) {
    message('Aucune facture en retard : rien à relancer', { ton: 'ok' });
    return;
  }

  const parClient = grouper(retards, x => x.facture.clientId);
  const corps = h('div.pile-s');

  for (const [clientId, factures] of parClient) {
    const c = lit.client(e, clientId);
    const nom = lit.nomClient(c);
    const du = cts(somme(factures, x => x.reste));
    const plusVieille = factures.slice().sort(par(x => x.facture.echeanceLe, 'asc'))[0].facture;
    const joursRetard = Math.max(0, Math.round((maintenant - plusVieille.echeanceLe) / JOUR));

    const texte = remplirModele(e.reglages.messageImpaye, {
      prenom: (c && c.prenom) || nom,
      numero: factures.map(x => x.facture.numero).filter(Boolean).join(', '),
      date: fmt.date(plusVieille.emiseLe || plusVieille.cree, 'normal'),
      montant: fmt.euros(du),
      garage: e.reglages.raisonSociale || e.reglages.nomOutil || ''
    });

    corps.appendChild(h('div.carte.carte--muette.rang', [
      h('div.grandit.coupe', [
        h('div.gras.coupe', nom),
        h('div.petit.faible.coupe',
          pluriel(factures.length, 'facture', 'factures') + ' · '
          + fmt.euros(du) + ' dus · ' + pluriel(joursRetard, 'jour de retard', 'jours de retard')),
        h('div.minus.tres-faible.coupe',
          factures.map(x => x.facture.numero).filter(Boolean).join(' · '))
      ]),
      c && (c.tel || c.email)
        ? h('button.bt.bt--contour.bt--s', {
            type: 'button',
            onclick: (ev) => menuEnvoi(ev.currentTarget, {
              tel: c.tel, email: c.email,
              sujet: 'Facture impayée — ' + (e.reglages.raisonSociale || e.reglages.nomOutil || ''),
              texte
            })
          }, [icone('cloche', { taille: 14 }), h('span', 'Relancer')])
        : h('span.minus.tres-faible', 'ni téléphone ni e-mail')
    ]));
  }

  modale({
    titre: pluriel(parClient.size, 'client à relancer', 'clients à relancer'),
    taille: 'large',
    corps: h('div.pile', [
      h('div.bandeau.bandeau--alerte', [
        icone('info'),
        h('span', 'Le message est préparé avec le modèle des réglages. Rien ne part '
          + 'tout seul : vous relisez, puis vous envoyez depuis votre téléphone.')
      ]),
      corps
    ]),
    actions: [{ texte: 'Fermer', ton: 'contour' }],
    surFermeture: () => refaireTout()
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
   LES SIX DERNIERS MOIS
   Pas un graphique : six barres, pour voir si le mois en cours tient la route
   par rapport aux précédents. C'est la seule question qu'on se pose ici.
   ========================================================================== */

function recapitulatifMois(e) {
  const debutCourant = debutDuMois(Date.now());
  const mois = [];

  for (let i = 5; i >= 0; i--) {
    /* Le premier du mois : plusMois n'a rien à rogner, le jour vaut déjà 1. */
    const debut = plusMois(debutCourant, -i);
    const fin = plusMois(debutCourant, -i + 1) - 1;
    const ca = lit.chiffreAffaires(e, debut, fin);
    mois.push({ debut, ca, courant: i === 0 });
  }

  const maxi = Math.max(1, ...mois.map(m => m.ca.ht));
  const total = somme(mois, m => m.ca.ht);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('graphique', { taille: 16 }),
      h('h2.grandit', 'Facturé sur six mois'),
      h('span.petit.faible', fmt.euros(total, { sansCentimes: true }) + ' HT au total')
    ]),
    h('div.panneau__corps', h('div.factures-mois', mois.map(m =>
      h('div.factures-mois__ligne', [
        h('span.majuscule', {
          style: m.courant ? { color: 'var(--accent)' } : null
        }, fmt.nomMois(m.debut) + ' ' + String(new Date(m.debut).getFullYear()).slice(2)),
        h('span.factures-mois__barre',
          h('i.factures-mois__part' + (m.courant ? '.factures-mois__part--courant' : ''), {
            /* Une largeur en pourcentage : la seule valeur qui dépende des
               données, et elle ne peut pas sortir de 0–100. */
            style: { width: Math.round((m.ca.ht / maxi) * 100) + '%' }
          })),
        h('span.num.petit', [
          h('b', fmt.euros(m.ca.ht, { sansCentimes: true })),
          h('span.minus.tres-faible', ' · ' + m.ca.nb)
        ])
      ])
    )))
  ]);
}

/** Le premier du mois d'une date, à minuit. */
function debutDuMois(t) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/* ==========================================================================
   QUAND IL N'Y A RIEN À MONTRER
   ========================================================================== */

function rienTrouve(e, requete, filtre) {
  if (requete) {
    return vide({
      icone: 'chercher',
      titre: 'Aucune facture pour « ' + requete + ' »',
      texte: 'Essayez le numéro de facture, le numéro EBP, trois lettres de la plaque, '
        + 'ou le nom du client.'
    });
  }

  if (filtre === 'retard') {
    return vide({
      icone: 'cocheRonde',
      titre: 'Aucun impayé',
      texte: 'Toutes les factures émises sont réglées ou dans les délais. '
        + 'Le délai de paiement se règle dans les réglages.'
    });
  }

  if (filtre === 'attente') {
    return vide({
      icone: 'cocheRonde',
      titre: 'Aucune facture en attente',
      texte: 'Les factures préparées ici mais pas encore établies dans EBP '
        + 'apparaîtraient dans cette liste.'
    });
  }

  if (filtre !== 'tous') {
    const f = FILTRES.find(x => x.cle === filtre);
    return vide({
      icone: 'facture',
      titre: 'Aucune facture dans « ' + (f ? f.texte : filtre) + ' »',
      texte: 'Choisissez « Tout » pour revoir l’ensemble des factures.'
    });
  }

  return vide({
    icone: 'facture',
    titre: 'Aucune facture pour l’instant',
    texte: 'Une facture ne se crée pas depuis une page blanche : elle naît d’un dossier '
      + 'dont le véhicule est rendu. Dès qu’un dossier passe à « livré », il remonte '
      + 'ici dans « À facturer », et le bouton « Préparer la facture » fige ses lignes.'
  });
}
