/* ==========================================================================
   YATECH — écran « Tarifs »
   --------------------------------------------------------------------------
   Le garage vend la même heure à deux prix : au particulier qui pousse la
   porte, et au confrère mécanicien à qui on fait l'électronique. Deux grilles,
   donc, et un écran qui les montre CÔTE À CÔTE — parce que la seule question
   qu'on se pose vraiment devant un tarif, c'est « et pour un confrère, ça fait
   combien ? ».

   Rien n'est recalculé ici à la main : les deux colonnes de prix sortent de
   `prixPrestation()`, avec un contexte particulier et un contexte pro. Ce qui
   s'affiche est donc exactement ce qui tombera sur le devis. Une prestation
   sans prix fixé se chiffre au temps : on écrit le calcul en toutes lettres
   sous le prix, sinon personne ne comprend d'où sort le montant.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, menu, vide } from '../core/ui.js';
import { maj, ajoute, change, retire } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { nombre, cts, nu, id, par, pluriel, surligne, score } from '../core/util.js';
import {
  versCsv, csvEnObjets, telecharger, nomDate, choisirFichier, lireTexte
} from '../core/fichiers.js';
import * as lit from '../domain/selecteurs.js';
import { TYPES_LIGNE, nouvellePrestation } from '../domain/schema.js';
import { contexte, prixPrestation } from '../domain/calculs.js';
import { enTete, champ, grilleChamps, barreRecherche, filtres } from '../ui/widgets.js';

/* Le catalogue ne connaît pas tous les types de ligne : un sous-titre ou une
   sous-traitance ne se range pas dans une grille tarifaire. */
const TYPES_CATALOGUE = ['mo', 'forfait', 'electro', 'piece', 'frais'];

/* Les pas d'arrondi qui ont un sens dans un atelier. Facturer à la minute
   n'existe pas ; facturer à l'heure pleine fâche le client pour dix minutes. */
const ARRONDIS = [
  { valeur: '0', texte: 'Au réel, sans arrondi' },
  { valeur: '0.25', texte: 'Au quart d’heure' },
  { valeur: '0.5', texte: 'À la demi-heure' },
  { valeur: '1', texte: 'À l’heure entière' }
];

const FAMILLE_PAR_DEFAUT = 'Divers';

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  let famille = 'toutes';
  let avecInactives = false;

  const racine = h('div.pile');
  const zoneEcart = h('div');
  const zoneOutils = h('div');
  const zoneTable = h('div');
  const zoneGrillePro = h('div');
  const zoneRemises = h('div');

  /** Repeint la liste et ses filtres. Le bloc des taux, lui, ne bouge pas :
   *  on y a peut-être le curseur. */
  function refaireListe() {
    poser(zoneOutils, outils());
    const liste = retenues(e, requete, famille, avecInactives);
    poser(zoneTable, (e.prestations || []).length
      ? (liste.length ? tableau(e, liste, requete, rappels) : rienTrouve(e, requete, refaireTout))
      : catalogueVide(e, refaireTout));
  }

  /* Deux façons de rafraîchir, et il faut choisir la bonne : une correction de
     prix au clavier ne doit PAS repeindre le tableau (le champ suivant
     disparaîtrait sous les doigts), une création ou une suppression, si. */
  const rappels = {
    annexes: () => rafraichirAnnexes(),
    tout: () => refaireTout()
  };

  /** Les blocs qui découlent des prix sans contenir de saisie en cours. */
  function rafraichirAnnexes() {
    poser(zoneGrillePro, grillePro(e));
    poser(zoneRemises, clientsRemises(e));
  }

  /** Un taux horaire a bougé : tout ce qui se chiffre au temps a bougé avec. */
  function refaireTarifs() {
    poser(zoneEcart, ecartDesTaux(e));
    refaireListe();
    rafraichirAnnexes();
  }

  function refaireTout() {
    poser(racine, contenu());
    refaireListe();
    rafraichirAnnexes();
  }

  function outils() {
    const base = retenues(e, requete, 'toutes', avecInactives);
    const choix = [{ cle: 'toutes', texte: 'Toutes', compte: base.length }].concat(
      famillesConnues(e).map(f => ({
        cle: f, texte: f, compte: base.filter(p => familleDe(p) === f).length
      }))
    );
    const inactives = (e.prestations || []).filter(p => !p.actif).length;

    return h('div.rang.enroule.rang-haut', [
      h('div.grandit', filtres(choix, famille, (cle) => { famille = cle; refaireListe(); })),
      h('button.filtre', {
        type: 'button',
        'aria-pressed': avecInactives ? 'true' : 'false',
        onclick: () => { avecInactives = !avecInactives; refaireListe(); }
      }, [
        icone(avecInactives ? 'oeil' : 'oeilBarre', { taille: 14 }),
        h('span', 'Inactives'),
        h('span.compte', String(inactives))
      ])
    ]);
  }

  function contenu() {
    const total = (e.prestations || []).length;
    const actives = (e.prestations || []).filter(p => p.actif).length;

    return [
      enTete({
        titre: 'Tarifs',
        sous: total
          ? pluriel(actives, 'prestation active') + ' sur ' + total
            + ' · ' + pluriel(famillesConnues(e).length, 'famille')
          : 'Le catalogue est vide',
        actions: [
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => modalePrestation(e, null, refaireTout)
          }, [icone('plus'), h('span', 'Nouvelle prestation')]),
          h('button.bt.bt--contour.bt--icone', {
            type: 'button',
            'aria-label': 'Autres actions',
            onclick: (ev) => menuEcran(ev.currentTarget, e, refaireTout)
          }, icone('points'))
        ]
      }),
      blocTaux(e, zoneEcart, refaireTarifs),
      barreRecherche({
        valeur: requete,
        exemple: 'Code, désignation, famille…',
        surChangement: (v) => { requete = v; refaireListe(); }
      }),
      zoneOutils,
      zoneTable,
      h('div.deux-colonnes', [zoneGrillePro, zoneRemises])
    ];
  }

  poser(racine, contenu());
  refaireListe();
  rafraichirAnnexes();
  return racine;
}

/* ==========================================================================
   LES DEUX CONTEXTES DE PRIX
   Un client fictif de chaque grille : c'est la seule façon d'afficher le prix
   que le moteur appliquera vraiment, plutôt qu'une copie du calcul.
   ========================================================================== */

const ctxParticulier = (e) => contexte(e.reglages, { grille: 'part' });
const ctxPro = (e) => contexte(e.reglages, { grille: 'pro' });

const familleDe = (p) => String(p.famille || '').trim() || FAMILLE_PAR_DEFAUT;

function famillesConnues(e) {
  const vues = new Set((e.prestations || []).map(familleDe));
  return Array.from(vues).sort((a, b) => a.localeCompare(b, 'fr'));
}

/** L'écart entre deux prix, en pourcentage du premier. `null` si indicible. */
function ecart(reference, autre) {
  const r = nombre(reference);
  if (r <= 0) return null;
  return cts(((r - nombre(autre)) / r) * 100);
}

function texteEcart(part, pro) {
  const ec = ecart(part, pro);
  if (ec === null) return h('span.tres-faible', '—');
  if (Math.abs(ec) < 0.05) return h('span.faible', 'même prix');
  return h('span' + (ec > 0 ? '.faible' : ''),
    (ec > 0 ? '−' : '+') + fmt.nb(Math.abs(ec), 1) + ' %');
}

/**
 * D'où sort le prix, quand il ne vient pas du catalogue.
 * @returns {string|null} null si le prix est fixé à la main : rien à expliquer.
 */
function calculDuPrix(p, e, grille) {
  const pro = grille === 'pro';
  const c = pro ? ctxPro(e) : ctxParticulier(e);
  const fixe = nombre(pro ? p.prixPro : p.prixHT);
  if (fixe > 0) return null;

  const prix = prixPrestation(p, c);
  if (pro && nombre(p.prixHT) > 0) {
    return '−' + fmt.nb(c.remisePro, 1) + ' % du prix public = ' + fmt.euros(prix);
  }
  const temps = nombre(p.temps);
  if (temps > 0) {
    return fmt.nb(temps, 2) + ' h × ' + fmt.euros(c.taux, { sansCentimes: true })
      + ' = ' + fmt.euros(prix);
  }
  return 'ni prix ni temps : à chiffrer sur le devis';
}

/* ==========================================================================
   LES TAUX HORAIRES — le chiffre dont tout le reste découle
   ========================================================================== */

function blocTaux(e, zoneEcart, apres) {
  const r = e.reglages;

  /** Un taux se corrige sur place : deux chiffres qu'on tape et qu'on quitte,
   *  sans passer par une fenêtre de réglages. */
  const caseTaux = (etiquette, cle, aide) => {
    const entree = h('input.saisie.saisie--num', {
      type: 'text',
      inputmode: 'decimal',
      'aria-label': etiquette,
      value: fmt.nb(nombre(r[cle]), 2),
      onchange: (ev) => {
        const v = Math.max(0, nombre(ev.currentTarget.value));
        maj('Taux horaire modifié', (etat) => { etat.reglages[cle] = v; });
        /* On réécrit ce qu'on a compris : la personne tape « 68 » ou « 68,00 »
           ou « 68 € », et voit tout de suite ce qui a été enregistré. */
        ev.currentTarget.value = fmt.nb(v, 2);
        apres();
      }
    });
    return h('div.tarifs-taux__case', [
      h('div.majuscule', etiquette),
      h('div.tarifs-taux__saisie', [entree, h('span.tarifs-taux__unite', '€ HT / h')]),
      h('div.minus.tres-faible', aide)
    ]);
  };

  const remise = champ({
    etiquette: 'Remise confrère par défaut',
    type: 'nombre',
    valeur: nombre(r.remiseProDefaut, 0),
    unite: '%',
    aide: 'Appliquée au prix particulier quand aucun prix confrère n’est fixé.',
    surChangement: (v) => {
      maj('Remise confrère modifiée', (etat) => {
        etat.reglages.remiseProDefaut = Math.min(90, Math.max(0, nombre(v)));
      });
      remise.ecrire(nombre(e.reglages.remiseProDefaut));
      apres();
    }
  });

  const arrondi = champ({
    etiquette: 'Arrondi du temps facturé',
    type: 'liste',
    valeur: String(nombre(r.arrondiHeure, 0)),
    options: ARRONDIS,
    aide: 'Le pas auquel on compte les heures de main-d’œuvre.',
    surChangement: (v) => {
      maj('Arrondi du temps modifié', (etat) => { etat.reglages.arrondiHeure = nombre(v); });
      apres();
    }
  });

  poser(zoneEcart, ecartDesTaux(e));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('euro', { taille: 16 }),
      h('h2.grandit', 'Taux horaires'),
      h('span.petit.faible', 'enregistré dès que vous quittez le champ')
    ]),
    h('div.panneau__corps.pile', [
      h('div.tarifs-taux', [
        caseTaux('Particulier', 'tauxHoraire', 'Le tarif affiché en clientèle.'),
        caseTaux('Professionnel', 'tauxHorairePro', 'Les confrères mécaniciens.')
      ]),
      zoneEcart,
      grilleChamps([remise, arrondi])
    ])
  ]);
}

function ecartDesTaux(e) {
  const part = nombre(e.reglages.tauxHoraire);
  const pro = nombre(e.reglages.tauxHorairePro);
  const ec = ecart(part, pro);

  if (ec === null) {
    return h('div.bandeau.bandeau--alerte', [
      icone('alerte'),
      h('span', 'Sans taux particulier, toute prestation chiffrée au temps tombe à zéro.')
    ]);
  }
  if (Math.abs(ec) < 0.05) {
    return h('div.bandeau', [
      icone('balance'),
      h('span', 'Les deux grilles sont au même taux : le confrère paie comme un particulier.')
    ]);
  }
  return h('div.bandeau' + (ec < 0 ? '.bandeau--alerte' : ''), [
    icone('balance'),
    h('span', ec > 0
      ? 'Le confrère paie ' + fmt.nb(ec, 1) + ' % de moins de l’heure : '
        + fmt.euros(pro, { sansCentimes: true }) + ' contre ' + fmt.euros(part, { sansCentimes: true }) + '.'
      : 'Le taux confrère est ' + fmt.nb(-ec, 1) + ' % PLUS cher que le taux particulier : '
        + fmt.euros(pro, { sansCentimes: true }) + ' contre ' + fmt.euros(part, { sansCentimes: true }) + '.')
  ]);
}

/* ==========================================================================
   CE QU'ON RETIENT — recherche, famille, actives ou non
   ========================================================================== */

function retenues(e, requete, famille, avecInactives) {
  let liste = (e.prestations || []).slice();
  if (!avecInactives) liste = liste.filter(p => p.actif);
  if (famille && famille !== 'toutes') liste = liste.filter(p => familleDe(p) === famille);

  if (requete) {
    liste = liste
      .map(p => ({ p, n: score(texteCherchable(p), requete) }))
      .filter(x => x.n >= 0)
      .sort((a, b) => b.n - a.n)
      .map(x => x.p);
    return liste;
  }
  /* Sans recherche, l'ordre du catalogue papier : par famille, puis par code. */
  return liste.sort(par(p => familleDe(p) + ' ' + (p.code || 'zzz') + ' ' + (p.libelle || '')));
}

const texteCherchable = (p) =>
  [p.code, p.libelle, p.famille, p.detail, (TYPES_LIGNE[p.type] || {}).nom].filter(Boolean).join(' ');

/* ==========================================================================
   LE TABLEAU — les deux grilles l'une à côté de l'autre
   ========================================================================== */

function tableau(e, liste, requete, rappels) {
  /* La colonne des crédits ne sert qu'au garage qui fait de la reprogrammation
     et seulement pour quelques prestations : on ne la sort que si elle a
     quelque chose à dire. */
  const avecCredits = liste.some(p => nombre(p.credits) > 0);

  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      h('th', 'Code'),
      h('th', 'Désignation'),
      h('th', 'Famille'),
      h('th', 'Type'),
      h('th.num', 'Temps'),
      h('th.num', 'Prix particulier'),
      h('th.num', 'Prix pro'),
      h('th.num', 'Écart'),
      avecCredits ? h('th.num', 'Crédits') : null,
      h('th.serre', 'Actif'),
      h('th.serre', '')
    ].filter(Boolean))),
    h('tbody', liste.map(p => ligne(e, p, requete, avecCredits, rappels)))
  ]));
}

function ligne(e, p, requete, avecCredits, rappels) {
  const aidePart = h('div.minus.tres-faible');
  const aidePro = h('div.minus.tres-faible');
  const celluleEcart = h('td.num', { donnees: { col: 'Écart' } });

  /** Les cellules dérivées se recalculent sans repeindre la ligne : sinon le
   *  champ qu'on vient de quitter disparaît sous le doigt, et la tabulation
   *  vers le prix suivant se perd. */
  function rafraichirDerives() {
    const part = prixPrestation(p, ctxParticulier(e));
    const pro = prixPrestation(p, ctxPro(e));
    entreePart.placeholder = fmt.nb(part, 2);
    entreePro.placeholder = fmt.nb(pro, 2);
    poser(aidePart, calculDuPrix(p, e, 'part'));
    poser(aidePro, calculDuPrix(p, e, 'pro'));
    poser(celluleEcart, texteEcart(part, pro));
    rappels.annexes();
  }

  const saisiePrix = (cle, etiquette) => h('input.saisie.saisie--num.tarifs-prix', {
    type: 'text',
    inputmode: 'decimal',
    'aria-label': etiquette + ' de ' + (p.libelle || 'cette prestation'),
    value: nombre(p[cle]) > 0 ? fmt.nb(nombre(p[cle]), 2) : '',
    onchange: (ev) => {
      const v = Math.max(0, nombre(ev.currentTarget.value));
      change('prestations', p.id, { [cle]: v }, 'Tarif modifié');
      ev.currentTarget.value = v > 0 ? fmt.nb(v, 2) : '';
      rafraichirDerives();
    }
  });

  const entreePart = saisiePrix('prixHT', 'Prix particulier HT');
  const entreePro = saisiePrix('prixPro', 'Prix confrère HT');

  const rangee = h('tr' + (p.actif ? '' : '.tarifs-inactive'), [
    h('td.serre', { donnees: { col: 'Code' } }, p.code
      ? h('span.etiq', { html: surligne(p.code, requete) })
      : h('span.tres-faible', '—')),

    h('td', { donnees: { col: 'Désignation' } }, [
      h('button.tarifs-nom', {
        type: 'button',
        onclick: () => modalePrestation(e, p, rappels.tout),
        html: surligne(p.libelle || 'Sans désignation', requete)
      }),
      p.detail ? h('div.minus.tres-faible.coupe-2', p.detail) : null
    ]),

    h('td', { donnees: { col: 'Famille' } },
      h('span.petit', { html: surligne(familleDe(p), requete) })),

    h('td', { donnees: { col: 'Type' } },
      h('span.etiq', (TYPES_LIGNE[p.type] || {}).nom || p.type || '—')),

    h('td.num', { donnees: { col: 'Temps' } }, nombre(p.temps) > 0
      ? h('span', fmt.heuresMO(p.temps))
      : h('span.tres-faible', '—')),

    h('td.num', { donnees: { col: 'Prix particulier' } },
      h('div.tarifs-cellule', [entreePart, aidePart])),

    h('td.num', { donnees: { col: 'Prix pro' } },
      h('div.tarifs-cellule', [entreePro, aidePro])),

    celluleEcart,

    avecCredits
      ? h('td.num', { donnees: { col: 'Crédits' } }, nombre(p.credits) > 0
          ? h('span.etiq.etiq--accent', fmt.nb(p.credits) + ' cr.')
          : null)
      : null,

    h('td.serre', { donnees: { col: 'Actif' } }, h('input', {
      type: 'checkbox',
      checked: !!p.actif,
      'aria-label': 'Prestation active',
      style: { width: '20px', height: '20px', accentColor: 'var(--accent)' },
      onchange: (ev) => {
        const v = ev.currentTarget.checked;
        change('prestations', p.id, { actif: v }, v ? 'Prestation réactivée' : 'Prestation désactivée');
        /* La ligne reste à l'écran même si le filtre ne la retient plus : on
           vient de la décocher, on veut pouvoir se raviser tout de suite. */
        rangee.classList.toggle('tarifs-inactive', !v);
        rappels.annexes();
      }
    })),

    h('td.serre', h('button.bt.bt--nu.bt--icone.bt--s', {
      type: 'button',
      'aria-label': 'Actions sur ' + (p.libelle || 'cette prestation'),
      onclick: (ev) => menuLigne(ev.currentTarget, e, p, rappels.tout)
    }, icone('points')))
  ].filter(Boolean));

  poser(aidePart, calculDuPrix(p, e, 'part'));
  poser(aidePro, calculDuPrix(p, e, 'pro'));
  poser(celluleEcart, texteEcart(prixPrestation(p, ctxParticulier(e)), prixPrestation(p, ctxPro(e))));
  entreePart.placeholder = fmt.nb(prixPrestation(p, ctxParticulier(e)), 2);
  entreePro.placeholder = fmt.nb(prixPrestation(p, ctxPro(e)), 2);

  return rangee;
}

function menuLigne(ancre, e, p, apres) {
  menu(ancre, [
    { texte: 'Modifier', icone: 'crayon', faire: () => modalePrestation(e, p, apres) },
    {
      texte: 'Dupliquer', icone: 'copier',
      faire: () => {
        const copie = nouvellePrestation({
          code: p.code ? p.code + '-BIS' : '',
          libelle: (p.libelle || '') + ' (copie)',
          famille: p.famille, type: p.type, temps: p.temps,
          prixHT: p.prixHT, prixPro: p.prixPro, credits: p.credits,
          detail: p.detail, actif: p.actif
        });
        ajoute('prestations', copie, 'Prestation dupliquée');
        message('Prestation dupliquée', { ton: 'ok' });
        apres();
        modalePrestation(e, copie, apres);
      }
    },
    null,
    {
      texte: 'Supprimer du catalogue', icone: 'poubelle', danger: true,
      faire: () => supprimer(e, p, apres)
    }
  ]);
}

async function supprimer(e, p, apres) {
  const n = utilisations(e, p.id);
  const ok = await confirmer({
    titre: 'Supprimer « ' + (p.libelle || 'cette prestation') + ' » ?',
    texte: n
      ? 'Elle figure sur ' + pluriel(n, 'document') + '. Les lignes déjà écrites gardent '
        + 'leur libellé et leur prix : seul le catalogue perd la prestation.'
      : 'Elle disparaît du catalogue. Les devis en cours ne changent pas.',
    ok: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  retire('prestations', p.id, 'Prestation supprimée');
  message('Prestation supprimée', { ton: 'ok' });
  apres();
}

/** Combien de documents portent une ligne issue de cette prestation. */
function utilisations(e, prestationId) {
  const porte = (doc) => (doc.lignes || []).some(l => l && l.prestationId === prestationId);
  return [].concat(e.dossiers || [], e.devis || [], e.factures || []).filter(porte).length;
}

/* ==========================================================================
   LES ÉTATS VIDES
   ========================================================================== */

function catalogueVide(e, apres) {
  return vide({
    icone: 'tarifs',
    titre: 'Aucune prestation au catalogue',
    texte: 'Le catalogue évite de retaper les mêmes libellés et les mêmes prix à chaque devis. '
      + 'On peut aussi importer un fichier CSV depuis le menu.',
    action: { texte: 'Nouvelle prestation', faire: () => modalePrestation(e, null, apres) }
  });
}

function rienTrouve(e, requete, apres) {
  return vide({
    icone: 'chercher',
    titre: requete ? 'Rien pour « ' + requete + ' »' : 'Rien dans ce filtre',
    texte: 'Essayez un code, un mot de la désignation, ou changez de famille.',
    action: { texte: 'Créer cette prestation', faire: () => modalePrestation(e, null, apres) }
  });
}

/* ==========================================================================
   LA FICHE PRESTATION
   ========================================================================== */

function modalePrestation(e, existante, apres) {
  const p = existante || nouvellePrestation({});
  const idFamilles = id('familles');

  const code = champ({
    etiquette: 'Code', valeur: p.code, exemple: 'MEC-01',
    aide: 'Facultatif, mais c’est lui qu’on tape pour retrouver la prestation.'
  });
  const libelle = champ({
    etiquette: 'Désignation', valeur: p.libelle, obligatoire: true, autofocus: !existante,
    exemple: 'Vidange + filtre à huile'
  });
  const famille = champ({ etiquette: 'Famille', valeur: existante ? p.famille : '', exemple: 'Entretien' });
  /* Une liste déroulante enfermerait le garage dans les familles d'hier : on
     propose celles qui existent, on laisse écrire les autres. */
  famille.entree.setAttribute('list', idFamilles);
  const listeFamilles = h('datalist', { id: idFamilles },
    famillesConnues(e).map(f => h('option', { value: f })));

  const type = champ({
    etiquette: 'Type', type: 'liste', valeur: p.type,
    options: TYPES_CATALOGUE.map(t => ({ valeur: t, texte: TYPES_LIGNE[t].nom }))
  });
  const temps = champ({
    etiquette: 'Temps', type: 'nombre', valeur: nombre(p.temps) || '', unite: 'h',
    aide: 'En heures décimales : 1,5 pour 1 h 30.'
  });
  const prixPart = champ({
    etiquette: 'Prix particulier HT', type: 'euros', valeur: nombre(p.prixHT) || '', unite: '€',
    aide: 'À 0 : calculé au temps.'
  });
  const prixPro = champ({
    etiquette: 'Prix confrère HT', type: 'euros', valeur: nombre(p.prixPro) || '', unite: '€',
    aide: 'À 0 : remise confrère appliquée.'
  });
  const credits = champ({
    etiquette: 'Crédits Autotuner', type: 'nombre', valeur: nombre(p.credits) || '',
    aide: 'Ce que la prestation consomme sur le compteur.'
  });
  const detail = champ({
    etiquette: 'Détail', type: 'zone', lignes: 2, valeur: p.detail,
    aide: 'Ce qui s’imprime sous la ligne, sur le devis.'
  });
  const actif = champ({
    type: 'coche', etiquette: 'Proposée à la saisie d’un devis',
    valeur: existante ? !!p.actif : true
  });

  const apercu = h('div.tarifs-apercu');

  /** Ce que donneront les deux grilles, tant qu'on tape : personne ne devrait
   *  avoir à enregistrer pour savoir combien il vient d'écrire. */
  function rafraichirApercu() {
    poser(apercu, apercuDesDeuxGrilles(e, {
      type: type.lire(),
      temps: nombre(temps.lire()),
      prixHT: nombre(prixPart.lire()),
      prixPro: nombre(prixPro.lire())
    }));
  }
  for (const c of [type, temps, prixPart, prixPro]) {
    c.entree.addEventListener('input', rafraichirApercu);
    c.entree.addEventListener('change', rafraichirApercu);
  }
  rafraichirApercu();

  modale({
    titre: existante ? 'Modifier la prestation' : 'Nouvelle prestation',
    taille: 'large',
    corps: h('div.pile', [
      libelle.noeud,
      grilleChamps([code, famille, type]),
      listeFamilles,
      h('div.bandeau', [
        icone('info'),
        h('span', 'Laissez un prix à 0 pour qu’il se calcule au temps : temps × taux horaire '
          + 'de la grille. Un prix écrit ici, lui, ne bouge plus quand le taux change.')
      ]),
      grilleChamps([temps, prixPart, prixPro]),
      apercu,
      grilleChamps([credits]),
      detail.noeud,
      actif.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: existante ? 'Enregistrer' : 'Ajouter au catalogue', ton: 'fort',
        faire: () => {
          if (!libelle.lire()) {
            libelle.erreur('Une désignation, au minimum : c’est ce que le client lit.');
            return false;
          }
          const champs = {
            code: code.lire(),
            libelle: libelle.lire(),
            famille: famille.lire() || FAMILLE_PAR_DEFAUT,
            type: type.lire(),
            temps: Math.max(0, nombre(temps.lire())),
            prixHT: Math.max(0, nombre(prixPart.lire())),
            prixPro: Math.max(0, nombre(prixPro.lire())),
            credits: Math.max(0, nombre(credits.lire())),
            detail: detail.lire(),
            actif: actif.lire()
          };
          if (existante) change('prestations', p.id, champs, 'Prestation modifiée');
          else ajoute('prestations', nouvellePrestation(champs), 'Prestation ajoutée');
          message(existante ? 'Prestation enregistrée' : 'Prestation ajoutée au catalogue', { ton: 'ok' });
          apres();
        }
      }
    ]
  });
}

function apercuDesDeuxGrilles(e, brouillon) {
  const p = Object.assign({}, brouillon);
  const cases = [
    { nom: 'Grille particulier', grille: 'part', ctx: ctxParticulier(e) },
    { nom: 'Grille professionnelle', grille: 'pro', ctx: ctxPro(e) }
  ];
  return cases.map(c => {
    const prix = prixPrestation(p, c.ctx);
    const explication = calculDuPrix(p, e, c.grille);
    return h('div.tarifs-apercu__case', [
      h('div.majuscule', c.nom),
      h('div.tarifs-apercu__prix', fmt.euros(prix)),
      h('div.minus.tres-faible', explication || 'prix fixé au catalogue')
    ]);
  });
}

/* ==========================================================================
   LA GRILLE PROFESSIONNELLE — ce que voit le confrère
   ========================================================================== */

function grillePro(e) {
  const c = ctxPro(e);
  const actives = (e.prestations || []).filter(p => p.actif)
    .sort(par(p => familleDe(p) + ' ' + (p.code || 'zzz') + ' ' + (p.libelle || '')));

  const groupes = new Map();
  for (const p of actives) {
    const f = familleDe(p);
    if (!groupes.has(f)) groupes.set(f, []);
    groupes.get(f).push(p);
  }

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('pro', { taille: 16 }),
      h('h2.grandit', 'Grille professionnelle'),
      h('button.bt.bt--contour.bt--s', {
        type: 'button', onclick: () => imprimerGrillePro(e)
      }, [icone('imprimer', { taille: 14 }), h('span', 'Imprimer')])
    ]),
    h('div.panneau__corps.pile', [
      h('div.bandeau', [
        icone('portail'),
        h('span', 'Chaque client professionnel peut consulter cette grille en ligne : '
          + 'son lien de portail se crée depuis sa fiche client.')
      ]),
      h('div.petit.faible', 'Taux horaire confrère : '
        + fmt.euros(c.taux, { sansCentimes: true }) + ' HT · remise par défaut sur le catalogue : '
        + fmt.nb(c.remisePro, 1) + ' %'),
      actives.length
        ? h('div.grille-auto', Array.from(groupes.entries()).map(([f, liste]) => h('div', [
            h('div.majuscule', f),
            h('div', liste.map(p => h('div.tarifs-groupe__ligne', [
              h('span.grandit.coupe', p.libelle || 'Sans désignation'),
              h('b.tarifs-groupe__prix', fmt.euros(prixPrestation(p, c)))
            ])))
          ])))
        : h('div.petit.faible.centre', 'Aucune prestation active : la grille confrère est vide.')
    ])
  ]);
}

function imprimerGrillePro(e) {
  const zone = document.getElementById('impression');
  if (!zone) return;

  const r = e.reglages;
  const c = ctxPro(e);
  const actives = (e.prestations || []).filter(p => p.actif)
    .sort(par(p => familleDe(p) + ' ' + (p.code || 'zzz') + ' ' + (p.libelle || '')));

  if (!actives.length) {
    message('Il n’y a aucune prestation active à imprimer.', { ton: 'alerte' });
    return;
  }

  const rangees = [];
  let familleCourante = null;
  for (const p of actives) {
    const f = familleDe(p);
    if (f !== familleCourante) {
      familleCourante = f;
      rangees.push(h('tr.sous-titre', h('td', { colspan: 4 }, f)));
    }
    rangees.push(h('tr', [
      h('td', p.code || ''),
      h('td', [
        h('div', p.libelle || ''),
        p.detail ? h('div', { style: { fontSize: '8pt' } }, p.detail) : null
      ]),
      h('td.num', nombre(p.temps) > 0 ? fmt.heuresMO(p.temps) : ''),
      h('td.num', fmt.euros(prixPrestation(p, c)))
    ]));
  }

  poser(zone, h('div.doc', [
    h('div.doc__tete', [
      h('div.doc__emetteur', [
        h('strong', r.raisonSociale || r.nomOutil || 'Garage'),
        r.adresse ? h('div', r.adresse) : null,
        (r.cp || r.ville) ? h('div', [r.cp, r.ville].filter(Boolean).join(' ')) : null,
        r.tel ? h('div', 'Tél. ' + r.tel) : null,
        r.email ? h('div', r.email) : null,
        r.siret ? h('div', 'SIRET ' + r.siret) : null
      ]),
      h('div.doc__type', [
        h('b', 'Grille confrères'),
        h('span', { style: { display: 'block' } }, 'au ' + fmt.date(Date.now(), 'normal')),
        h('span', { style: { display: 'block' } },
          'Taux horaire : ' + fmt.euros(c.taux, { sansCentimes: true }) + ' HT')
      ])
    ]),
    h('table', [
      h('thead', h('tr', [
        h('th', 'Code'),
        h('th', 'Prestation'),
        h('th.num', 'Temps'),
        h('th.num', 'Prix HT')
      ])),
      h('tbody', rangees)
    ]),
    h('div.doc__mentions', [
      h('div', 'Tarifs hors taxes, réservés aux professionnels de l’automobile, '
        + 'hors pièces et hors consommables sauf mention contraire.'),
      h('div', 'Les prestations chiffrées au temps sont facturées au temps réellement passé, '
        + 'sur la base du taux horaire ci-dessus.'),
      r.tvaApplicable === false && r.mentionFranchiseTva ? h('div', r.mentionFranchiseTva) : null
    ])
  ]));

  /* Le navigateur a besoin d'un instant pour poser la mise en page : sans ce
     délai, Safari imprime une page à moitié construite. */
  setTimeout(() => {
    window.print();
    setTimeout(() => poser(zone, []), 800);
  }, 120);
}

/* ==========================================================================
   LES REMISES PARTICULIÈRES
   Une remise sur une fiche client s'applique en plus de la grille. Elle est
   invisible depuis le catalogue : on la rappelle ici, sinon on l'oublie et on
   s'étonne des totaux.
   ========================================================================== */

function clientsRemises(e) {
  const liste = (e.clients || [])
    .filter(c => !c.archive && nombre(c.remise) > 0)
    .sort(par(c => nombre(c.remise), 'desc'));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('etiquette', { taille: 16 }),
      h('h2.grandit', 'Clients avec une remise particulière'),
      liste.length ? h('span.compte', String(liste.length)) : null
    ]),
    liste.length
      ? h('div.liste', liste.map(c => h('a.liste__ligne', { href: '#/client/' + c.id }, [
          h('div.grandit.coupe', [
            h('div.gras.coupe', lit.nomClient(c)),
            h('div.minus.tres-faible', c.grille === 'pro' || c.type === 'pro'
              ? 'grille professionnelle'
              : 'grille particulier')
          ]),
          h('span.pastille.pastille--accent.pastille--sans-point', '−' + fmt.nb(c.remise, 1) + ' %')
        ])))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Personne : tout le monde est au tarif de sa grille.'))
  ]);
}

/* ==========================================================================
   LE MENU DE L'ÉCRAN — sortir et rentrer le catalogue
   ========================================================================== */

function menuEcran(ancre, e, apres) {
  menu(ancre, [
    { texte: 'Exporter le catalogue (CSV)', icone: 'telecharger', faire: () => exporterCsv(e) },
    { texte: 'Importer un CSV', icone: 'televerser', faire: () => importerCsv(e, apres) },
    null,
    { texte: 'Imprimer la grille confrères', icone: 'imprimer', faire: () => imprimerGrillePro(e) }
  ]);
}

const COLONNES_CSV = [
  'Code', 'Désignation', 'Famille', 'Type', 'Temps (h)',
  'Prix particulier HT', 'Prix pro HT', 'Crédits', 'Détail', 'Actif'
];

function exporterCsv(e) {
  const liste = (e.prestations || []);
  if (!liste.length) { message('Le catalogue est vide : rien à exporter.', { ton: 'alerte' }); return; }

  const lignes = [COLONNES_CSV].concat(liste.map(p => [
    p.code || '',
    p.libelle || '',
    familleDe(p),
    (TYPES_LIGNE[p.type] || {}).nom || p.type || '',
    fmt.nb(nombre(p.temps), 2),
    fmt.nb(nombre(p.prixHT), 2),
    fmt.nb(nombre(p.prixPro), 2),
    nombre(p.credits) > 0 ? fmt.nb(p.credits) : '',
    p.detail || '',
    p.actif ? 'oui' : 'non'
  ]));

  telecharger(nomDate('catalogue-tarifs', 'csv'), versCsv(lignes));
  message(pluriel(liste.length, 'prestation') + ' exportée' + (liste.length > 1 ? 's' : ''), { ton: 'ok' });
}

/** La clé d'une colonne, réduite à ce qui ne change pas d'un tableur à l'autre. */
const cleColonne = (s) => nu(s).replace(/[^a-z0-9]+/g, '');

/** Lit une colonne quel que soit le nom qu'elle porte dans le fichier reçu. */
function colonne(objet, noms) {
  const cherchees = noms.map(cleColonne);
  for (const cle in objet) {
    if (cherchees.includes(cleColonne(cle))) return String(objet[cle] || '').trim();
  }
  return '';
}

const CHAMPS_CSV = {
  code: ['code', 'ref', 'reference'],
  libelle: ['designation', 'libelle', 'intitule', 'nom', 'prestation'],
  famille: ['famille', 'categorie', 'groupe', 'rayon'],
  type: ['type', 'nature'],
  temps: ['temps', 'tempsh', 'heures', 'duree', 'mo'],
  prixHT: ['prixparticulierht', 'prixparticulier', 'prixpublic', 'prixpublicht', 'prixht', 'prix', 'pu'],
  prixPro: ['prixproht', 'prixpro', 'prixconfrere', 'prixconfrereht', 'prixprofessionnel'],
  credits: ['credits', 'credit', 'creditsautotuner'],
  detail: ['detail', 'details', 'description', 'commentaire'],
  actif: ['actif', 'active', 'enservice']
};

/** Retrouve le type de ligne, qu'on ait reçu la clé ou le libellé français. */
function typeDepuisTexte(texte) {
  const t = cleColonne(texte);
  if (!t) return null;
  for (const cle of TYPES_CATALOGUE) {
    if (cleColonne(cle) === t || cleColonne(TYPES_LIGNE[cle].nom) === t) return cle;
  }
  if (t.startsWith('maindoeuvre') || t === 'mainoeuvre' || t === 'heure') return 'mo';
  return null;
}

/**
 * Confronte le fichier au catalogue existant.
 * On reconnaît une prestation à son code, sinon à sa désignation : réimporter
 * un fichier corrigé doit mettre à jour, pas créer un doublon.
 */
function preparerImport(e, objets) {
  const parCode = new Map();
  const parLibelle = new Map();
  for (const p of e.prestations || []) {
    if (p.code) parCode.set(nu(p.code), p);
    if (p.libelle) parLibelle.set(nu(p.libelle), p);
  }

  const nouvelles = [], modifiees = [];
  let ignorees = 0;

  for (const o of objets) {
    const libelle = colonne(o, CHAMPS_CSV.libelle);
    const code = colonne(o, CHAMPS_CSV.code);
    if (!libelle) { ignorees++; continue; }

    const actifBrut = nu(colonne(o, CHAMPS_CSV.actif));
    const type = typeDepuisTexte(colonne(o, CHAMPS_CSV.type));
    const champs = {
      code,
      libelle,
      famille: colonne(o, CHAMPS_CSV.famille) || FAMILLE_PAR_DEFAUT,
      temps: Math.max(0, nombre(colonne(o, CHAMPS_CSV.temps))),
      prixHT: Math.max(0, nombre(colonne(o, CHAMPS_CSV.prixHT))),
      prixPro: Math.max(0, nombre(colonne(o, CHAMPS_CSV.prixPro))),
      credits: Math.max(0, nombre(colonne(o, CHAMPS_CSV.credits))),
      detail: colonne(o, CHAMPS_CSV.detail),
      /* Colonne absente : on n'invente pas une désactivation. */
      actif: actifBrut ? !['non', 'no', 'faux', 'false', '0'].includes(actifBrut) : true
    };
    if (type) champs.type = type;

    const connue = (code && parCode.get(nu(code))) || parLibelle.get(nu(libelle)) || null;
    if (connue) modifiees.push({ prestation: connue, champs });
    else nouvelles.push(champs);
  }
  return { nouvelles, modifiees, ignorees };
}

async function importerCsv(e, apres) {
  const fichiers = await choisirFichier({ accepte: '.csv,text/csv,text/plain' });
  if (!fichiers || !fichiers.length) return;

  let objets;
  try {
    objets = csvEnObjets(await lireTexte(fichiers[0]));
  } catch (err) {
    message('Ce fichier n’a pas pu être lu.', { ton: 'danger' });
    return;
  }
  if (!objets.length) {
    message('Aucune ligne exploitable : il faut une ligne d’en-tête, puis une prestation par ligne.',
      { ton: 'danger', duree: 6000 });
    return;
  }

  const plan = preparerImport(e, objets);
  if (!plan.nouvelles.length && !plan.modifiees.length) {
    message('Aucune désignation reconnue dans ce fichier.', { ton: 'danger' });
    return;
  }

  const apercu = plan.nouvelles.map(c => ({ quoi: 'Nouvelle', champs: c }))
    .concat(plan.modifiees.map(m => ({ quoi: 'Mise à jour', champs: m.champs })));

  modale({
    titre: 'Aperçu avant import',
    taille: 'large',
    corps: h('div.pile', [
      h('div.bandeau', [
        icone('info'),
        h('span', pluriel(plan.nouvelles.length, 'prestation') + ' à créer, '
          + plan.modifiees.length + ' à mettre à jour'
          + (plan.ignorees ? ', ' + pluriel(plan.ignorees, 'ligne sans désignation ignorée', 'lignes sans désignation ignorées') : '')
          + '. Rien n’est effacé : les prestations absentes du fichier restent au catalogue.')
      ]),
      h('div.tableau-cadre', h('table.grille.repliable', [
        h('thead', h('tr', [
          h('th', ''), h('th', 'Code'), h('th', 'Désignation'),
          h('th.num', 'Particulier'), h('th.num', 'Pro')
        ])),
        h('tbody', apercu.slice(0, 25).map(x => h('tr', [
          h('td.serre', { donnees: { col: '' } },
            h('span.pastille' + (x.quoi === 'Nouvelle' ? '.pastille--ok' : '.pastille--info'), x.quoi)),
          h('td.serre', { donnees: { col: 'Code' } }, x.champs.code || '—'),
          h('td', { donnees: { col: 'Désignation' } }, x.champs.libelle),
          h('td.num', { donnees: { col: 'Particulier' } },
            x.champs.prixHT > 0 ? fmt.euros(x.champs.prixHT) : 'au temps'),
          h('td.num', { donnees: { col: 'Pro' } },
            x.champs.prixPro > 0 ? fmt.euros(x.champs.prixPro) : 'au temps')
        ])))
      ])),
      apercu.length > 25
        ? h('div.petit.faible.centre', 'et ' + pluriel(apercu.length - 25, 'autre ligne', 'autres lignes') + '…')
        : null
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Importer', ton: 'fort',
        faire: () => {
          maj('Catalogue importé', (etat) => {
            if (!Array.isArray(etat.prestations)) etat.prestations = [];
            for (const champs of plan.nouvelles) etat.prestations.push(nouvellePrestation(champs));
            for (const m of plan.modifiees) {
              const x = etat.prestations.find(y => y.id === m.prestation.id);
              if (x) Object.assign(x, m.champs, { maj: Date.now() });
            }
          });
          message('Catalogue importé : ' + pluriel(plan.nouvelles.length, 'création')
            + ' et ' + pluriel(plan.modifiees.length, 'mise à jour', 'mises à jour'), { ton: 'ok' });
          apres();
        }
      }
    ]
  });
}
