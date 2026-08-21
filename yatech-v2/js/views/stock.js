/* ==========================================================================
   YATECH — écran « Stock »
   --------------------------------------------------------------------------
   Le garage a des centaines de références et personne ne se souvient de tout.
   Cet écran répond à deux questions, et à rien d'autre :

       « est-ce qu'on en a ? »   → la recherche, en haut, toujours prête
       « où est-ce que c'est ? » → l'emplacement, montré partout, cliquable

   Le reste (créer, importer, inventorier) tourne autour de ces deux-là. Les
   boutons + et − sur chaque ligne existent parce qu'on range une livraison
   vingt fois par semaine : ouvrir une fiche pour ajouter une unité, personne
   ne le fait, et le stock finit faux.
   ========================================================================== */

import { h, poser, apres } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, message, messageOk, messageErreur, menu, vide } from '../core/ui.js';
import { maj, ajoute, change } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import {
  id, nombre, cts, pluriel, unique, score, surligne, compareTexte, somme, tronque
} from '../core/util.js';
import {
  versCsv, csvEnObjets, telecharger, nomDate, choisirFichier, lireTexte
} from '../core/fichiers.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { nouvellePiece } from '../domain/schema.js';
import { prixConseille, marge } from '../domain/calculs.js';
import { enTete, champ, grilleChamps, barreRecherche, filtres } from '../ui/widgets.js';
import { imprimerEtiquettes } from './impression.js';

/* Les trois états d'une pièce. Le schéma les range en clés (`occasion`), les
   libellés lisibles n'existent nulle part ailleurs. */
const ETATS = {
  neuf: 'Neuf',
  occasion: 'Occasion',
  reconditionne: 'Reconditionné'
};

/* Les unités qu'on manipule vraiment dans un atelier. La liste reste ouverte :
   le champ accepte n'importe quoi d'autre. */
const UNITES = ['u', 'L', 'kg', 'm', 'paire', 'lot', 'jeu'];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  /* L'alerte de l'accueil pointe ici avec `?filtre=alerte` : on arrive
     directement sur ce qui manque, sans avoir à recliquer. */
  let filtre = String((ctx.query && ctx.query.filtre) || 'tout');
  let vue = 'liste';

  /* L'inventaire vit le temps de la visite : les quantités comptées restent
     ici, en dehors de l'état, tant qu'on n'a pas validé. Repeindre la liste
     (une recherche, un filtre) ne les perd donc pas. */
  let enInventaire = false;
  const comptes = new Map();

  const racine = h('div.pile');
  const zoneFiltres = h('div');
  const zoneOutils = h('div.rang.enroule.entre');
  const zoneCorps = h('div');

  const tete = enTete({
    titre: 'Stock',
    sous: sousTitre(e),
    actions: [
      h('button.bt.bt--fort', {
        type: 'button',
        onclick: () => modalePiece(e, null, (p) => {
          refaireListe();
          messageOk('« ' + p.libelle + ' » ajoutée au stock');
        })
      }, [icone('plus'), h('span', 'Nouvelle pièce')]),
      h('button.bt.bt--contour.bt--icone', {
        type: 'button',
        'aria-label': 'Autres actions',
        onclick: (ev) => menuEcran(ev.currentTarget, e, {
          enInventaire,
          basculerInventaire: () => {
            enInventaire = !enInventaire;
            if (!enInventaire) comptes.clear();
            refaireListe();
          },
          refaireListe
        })
      }, icone('points'))
    ]
  });
  const noeudSous = tete.querySelector('.tete-ecran__sous');

  const zoneRecherche = barreRecherche({
    valeur: requete,
    exemple: 'Référence, code-barres, désignation, marque, emplacement, modèle…',
    surChangement: (v) => { requete = v; refaireListe(); }
  });
  const saisieRecherche = zoneRecherche.querySelector('input');

  /** Filtre la liste sur un emplacement précis : c'est ce que font le clic sur
   *  un bac et le clic sur l'étiquette de lieu d'une ligne. */
  function allerAuLieu(code) {
    requete = code;
    if (saisieRecherche) saisieRecherche.value = code;
    filtre = 'tout';
    vue = 'liste';
    refaireListe();
    if (saisieRecherche) saisieRecherche.focus();
  }

  const cadre = { allerAuLieu, refaireListe: () => refaireListe(), comptes };

  function refaireListe() {
    if (noeudSous) noeudSous.textContent = sousTitre(e);

    const base = piecesRetenues(e, requete);
    poser(zoneFiltres, filtres(compteursFiltres(e, base), filtre,
      (cle) => { filtre = cle; refaireListe(); }));

    const trie = base.filter(gardeDe(filtre, e)).sort(comparateur(requete));

    poser(zoneOutils, [
      h('div.segments', [
        segment('Liste', 'liste', vue, (v) => { vue = v; refaireListe(); }),
        segment('Par emplacement', 'lieux', vue, (v) => { vue = v; refaireListe(); })
      ]),
      enInventaire ? null : h('span.petit.faible.coupe',
        pluriel(trie.length, 'pièce affichée', 'pièces affichées'))
    ]);

    poser(zoneCorps, [
      enInventaire ? barreInventaire(e, comptes, () => {
        enInventaire = false;
        comptes.clear();
        refaireListe();
      }) : null,
      trie.length
        ? (vue === 'lieux'
            ? vueEmplacements(e, trie, cadre)
            : tableau(e, trie, requete, { enInventaire, comptes }, cadre))
        : rienTrouve(e, requete, filtre, refaireListe)
    ]);
  }

  poser(racine, [tete, zoneRecherche, zoneFiltres, zoneOutils, zoneCorps]);
  refaireListe();

  /* Au clavier, on arrive ici pour chercher : le curseur est déjà dans le
     champ. Sur téléphone on s'en garde bien, le clavier mangerait l'écran. */
  apres(() => {
    if (!saisieRecherche) return;
    if (!window.matchMedia('(min-width: 701px)').matches) return;
    try { saisieRecherche.focus({ preventScroll: true }); } catch (err) { /* champ retiré */ }
  });

  return racine;
}

function segment(texte, cle, actif, surChoix) {
  return h('button', {
    type: 'button',
    'aria-pressed': actif === cle ? 'true' : 'false',
    onclick: () => surChoix(cle)
  }, texte);
}

function sousTitre(e) {
  const v = lit.valeurStock(e);
  const refs = (e.pieces || []).filter(p => !p.archive).length;
  /* `valeurStock` ne compte que ce qui est physiquement là : une référence à
     zéro reste une référence connue, mais elle ne vaut rien. */
  return pluriel(refs, 'référence') + ', ' + pluriel(v.articles, 'article')
    + ', valeur d’achat ' + fmt.euros(v.achat, { sansCentimes: true });
}

/* ==========================================================================
   CE QU'ON RETIENT — la recherche d'abord, le filtre ensuite
   ========================================================================== */

/** Tout ce sur quoi la recherche mord. L'ordre compte : la référence et la
 *  désignation passent devant, ce sont elles qu'on tape. */
function texteCherchable(p) {
  return [p.ref, p.libelle, p.refFabricant, p.ean, p.marque, p.famille,
    p.emplacement, p.compatible].filter(Boolean).join(' ');
}

const noteDe = (p, requete) => score(texteCherchable(p), requete);

function piecesRetenues(e, requete) {
  const vivantes = (e.pieces || []).filter(p => !p.archive);
  if (!requete) return vivantes;
  return vivantes.filter(p => noteDe(p, requete) >= 0);
}

/**
 * L'ordre de la liste. Avec une recherche, le meilleur résultat en haut : on
 * regarde la première ligne et rien d'autre. Sans recherche, la liste suit
 * l'ordre des rayons — on la lit debout devant les étagères, et ce qui n'a pas
 * d'emplacement tombe à la fin, là où ça se voit.
 */
function comparateur(requete) {
  if (requete) return (a, b) => noteDe(b, requete) - noteDe(a, requete)
    || compareTexte(a.libelle, b.libelle);
  const rang = (p) => (String(p.emplacement || '').trim() ? 0 : 1);
  return (a, b) => rang(a) - rang(b)
    || compareTexte(a.emplacement || '', b.emplacement || '')
    || compareTexte(a.libelle, b.libelle);
}

/** Les familles réellement utilisées, dans l'ordre de l'alphabet. */
function famillesUtilisees(e) {
  return unique((e.pieces || [])
    .filter(p => !p.archive)
    .map(p => String(p.famille || '').trim())
    .filter(Boolean))
    .sort(compareTexte);
}

/** La règle de chaque filtre. `alerte` s'appuie sur le sélecteur du domaine :
 *  le seuil d'une pièce peut être le sien ou celui du garage. */
function gardeDe(cle, e) {
  if (cle === 'alerte') {
    const enAlerte = new Set(lit.piecesEnAlerte(e).map(p => p.id));
    return (p) => enAlerte.has(p.id);
  }
  if (cle === 'epuise') return (p) => nombre(p.qte, 0) <= 0;
  /* L'occasion et le reconditionné vont ensemble : c'est le même geste au
     comptoir, on prévient le client que la pièce n'est pas neuve. */
  if (cle === 'occasion') return (p) => p.etat === 'occasion' || p.etat === 'reconditionne';
  if (cle.startsWith('fam:')) {
    const f = cle.slice(4);
    return (p) => String(p.famille || '').trim() === f;
  }
  return () => true;
}

function compteursFiltres(e, base) {
  const compte = (cle) => base.filter(gardeDe(cle, e)).length;
  return [
    { cle: 'tout', texte: 'Tout', compte: base.length },
    { cle: 'alerte', texte: 'En alerte', icone: 'alerte', compte: compte('alerte') },
    { cle: 'epuise', texte: 'Épuisées', icone: 'boite', compte: compte('epuise') },
    { cle: 'occasion', texte: 'Occasion', icone: 'historique', compte: compte('occasion') }
  ].concat(famillesUtilisees(e).map(f => ({
    cle: 'fam:' + f, texte: f, compte: compte('fam:' + f)
  })));
}

/* ==========================================================================
   LA LISTE
   ========================================================================== */

function tableau(e, liste, requete, mode, cadre) {
  const reserves = lit.reservations(e);

  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      h('th', 'Qté'),
      h('th', 'Référence'),
      h('th', 'Désignation'),
      h('th', 'Emplacement'),
      h('th', 'Famille'),
      h('th.num', 'Prix achat'),
      h('th.num', 'Prix vente'),
      h('th.num', 'Marge')
    ])),
    h('tbody', liste.map(p => ligne(e, p, requete, mode, reserves, cadre)))
  ]));
}

function ligne(e, p, requete, mode, reserves, cadre) {
  const qte = nombre(p.qte, 0);
  const seuil = lit.seuilBas(e, p);
  const reserve = reserves.get(p.id) || 0;
  const m = marge(p.prixVente, p.prixAchat);
  const aller = () => { location.hash = '#/stock/' + p.id; };

  const ton = qte <= 0 ? '.qte--zero' : (qte <= seuil ? '.qte--bas' : '');

  return h('tr.cliquable', {
    tabindex: 0,
    onclick: aller,
    onkeydown: (ev) => {
      /* La ligne contient des boutons et, en inventaire, un champ de saisie.
         Sans ce garde-fou, une frappe Entrée dans le champ remonterait jusqu'ici
         et nous expédierait sur la fiche au milieu du comptage. */
      if (ev.target !== ev.currentTarget) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); }
    }
  }, [
    h('td.serre', { donnees: { col: 'Qté' } },
      h('div.stock-qte', [
        h('span.qte' + ton, fmt.nb(qte, 2)),
        mode.enInventaire
          ? champCompte(p, mode.comptes)
          : h('div.stock-plusmoins', [
              boutonMouvement(p, 'sortie', 'moins', 'Sortir une unité', cadre),
              boutonMouvement(p, 'entree', 'plus', 'Entrer une unité', cadre)
            ])
      ])),
    h('td.serre', { donnees: { col: 'Référence' } }, [
      p.ref
        ? h('div.gras.num', { html: surligne(p.ref, requete) })
        : h('div.tres-faible', 'sans référence'),
      p.refFabricant
        ? h('div.minus.tres-faible', { html: surligne(p.refFabricant, requete) })
        : null
    ]),
    h('td', { donnees: { col: 'Désignation' } }, [
      h('div.gras', { html: surligne(p.libelle || 'Sans nom', requete) }),
      h('div.minus.tres-faible.coupe', [
        p.marque ? h('span', { html: surligne(p.marque, requete) }) : null,
        p.marque && p.compatible ? h('span', ' · ') : null,
        p.compatible ? h('span', { html: surligne(tronque(p.compatible, 60), requete) }) : null,
        p.etat && p.etat !== 'neuf' ? h('span.etiq', ETATS[p.etat] || p.etat) : null
      ]),
      /* L'écart entre « il en reste 3 » et « il n'y en a plus » vient de là :
         des dossiers ouverts ont déjà retenu la pièce sans l'avoir sortie. */
      reserve > 0 ? h('div.minus', { style: { color: 'var(--alerte)' } },
        pluriel(reserve, 'réservé') + ' par un dossier en cours · '
        + fmt.nb(Math.max(0, qte - reserve), 2) + ' vraiment disponible') : null
    ]),
    h('td.serre', { donnees: { col: 'Emplacement' } }, p.emplacement
      ? h('button.etiq.stock-lieu', {
          type: 'button',
          title: 'Ne montrer que ce bac',
          onclick: (ev) => { ev.stopPropagation(); cadre.allerAuLieu(p.emplacement); }
        }, [icone('entrepot', { taille: 12 }), h('span', { html: surligne(p.emplacement, requete) })])
      : h('span.pastille.pastille--alerte.pastille--sans-point', 'non rangée')),
    h('td.serre', { donnees: { col: 'Famille' } },
      p.famille ? h('span.petit.faible', { html: surligne(p.famille, requete) })
        : h('span.tres-faible', '—')),
    h('td.num', { donnees: { col: 'Prix achat' } },
      nombre(p.prixAchat) > 0 ? fmt.euros(p.prixAchat) : h('span.tres-faible', '—')),
    h('td.num', { donnees: { col: 'Prix vente' } },
      nombre(p.prixVente) > 0 ? fmt.euros(p.prixVente) : h('span.tres-faible', '—')),
    h('td.num', { donnees: { col: 'Marge' } },
      nombre(p.prixVente) > 0 && nombre(p.prixAchat) > 0
        ? h('div', [
            h('div', fmt.euros(m.euros)),
            h('div.minus.tres-faible', fmt.pourcent(m.taux))
          ])
        : h('span.tres-faible', '—'))
  ]);
}

/** Le bouton +1 ou −1. Il vit dans une ligne cliquable : sans stopPropagation
 *  on partirait sur la fiche à chaque ajustement. */
function boutonMouvement(p, sens, ico, aide, cadre) {
  return h('button.bt.bt--contour.bt--icone.bt--s', {
    type: 'button',
    'aria-label': aide + ' de ' + (p.libelle || p.ref || 'cette pièce'),
    title: aide,
    onclick: (ev) => {
      ev.stopPropagation();
      const m = act.mouvementStock({
        pieceId: p.id, sens, qte: 1,
        motif: 'Ajustement rapide',
        prixUnit: nombre(p.prixAchat)
      });
      if (!m) {
        messageErreur('Impossible de sortir « ' + (p.libelle || p.ref) + ' » : '
          + 'il n’en reste aucune en stock. Passez par un inventaire si le bac '
          + (p.emplacement ? p.emplacement + ' ' : '') + 'dit le contraire.');
        return;
      }
      cadre.refaireListe();
    }
  }, icone(ico, { taille: 14 }));
}

/** Le champ de comptage, en mode inventaire. Le placeholder montre le stock
 *  théorique : on n'a pas à s'en souvenir pour savoir si ça colle. */
function champCompte(p, comptes) {
  return h('input.saisie.saisie--num.stock-compte', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: fmt.nb(nombre(p.qte, 0), 2),
    'aria-label': 'Quantité comptée pour ' + (p.libelle || p.ref || 'cette pièce'),
    value: comptes.has(p.id) ? comptes.get(p.id) : '',
    onclick: (ev) => ev.stopPropagation(),
    oninput: (ev) => comptes.set(p.id, ev.currentTarget.value)
  });
}

function rienTrouve(e, requete, filtre, refaireListe) {
  if (requete) {
    return vide({
      icone: 'chercher',
      titre: 'Rien pour « ' + requete + ' »',
      texte: 'Essayez la référence du fabricant, trois lettres de la désignation, '
        + 'ou le modèle sur lequel la pièce va.',
      action: {
        texte: 'Créer cette pièce',
        faire: () => modalePiece(e, null, () => refaireListe(), { libelle: requete })
      }
    });
  }
  if (filtre === 'alerte') {
    return vide({ icone: 'cocheRonde', titre: 'Rien sous le seuil', texte: 'Tout le stock est au-dessus de son seuil d’alerte.' });
  }
  if (filtre === 'epuise') {
    return vide({ icone: 'cocheRonde', titre: 'Aucune pièce épuisée', texte: 'Tout ce qui est référencé est présent.' });
  }
  if (filtre !== 'tout') {
    return vide({ icone: 'stock', titre: 'Aucune pièce dans ce filtre' });
  }
  return vide({
    icone: 'stock',
    titre: 'Le stock est vide',
    texte: 'Créez la première pièce, ou importez la liste que vous tenez déjà dans un tableur.',
    action: { texte: 'Nouvelle pièce', faire: () => modalePiece(e, null, () => refaireListe()) }
  });
}

/* ==========================================================================
   LA VUE PAR EMPLACEMENT — le plan du magasin
   Ce n'est pas une deuxième liste : c'est la carte des étagères. On y va pour
   ranger une livraison, ou pour retrouver ce qui traîne nulle part.
   ========================================================================== */

function vueEmplacements(e, liste, cadre) {
  const { rayons, orphelines } = rangerParRayon(liste);

  return h('div.pile', [
    /* Les pièces sans emplacement passent EN PREMIER : c'est le problème à
       résoudre, pas une note de bas de page. */
    orphelines.length ? blocNonRangees(e, orphelines, cadre) : null,
    ...rayons.map(([nomRayon, bacs]) => {
      const refs = somme(Array.from(bacs.values()), (v) => v.length);
      return h('div.rayon', [
        h('div.rayon__tete', [
          icone('entrepot', { taille: 15 }),
          h('span.grandit', 'Rayon ' + nomRayon),
          h('span.compte', String(refs))
        ]),
        h('div.bacs', Array.from(bacs.entries())
          .sort((a, b) => compareTexte(a[0], b[0]))
          .map(([code, pieces]) => bac(e, nomRayon, code, pieces, cadre)))
      ]);
    })
  ]);
}

function bac(e, nomRayon, code, pieces, cadre) {
  const articles = somme(pieces, (p) => nombre(p.qte, 0));
  const enAlerte = pieces.some(p => nombre(p.qte, 0) <= lit.seuilBas(e, p));
  const ton = articles <= 0 ? '.bac--zero' : (enAlerte ? '.bac--bas' : '');
  /* Le rayon est déjà écrit sur la tête du bloc : on n'affiche que la fin du
     code, sinon toutes les cases se ressemblent. */
  const court = code.startsWith(nomRayon + '-') ? code.slice(nomRayon.length + 1) : code;

  return h('button.bac' + ton, {
    type: 'button',
    title: code + ' — ' + pluriel(pieces.length, 'référence'),
    onclick: () => cadre.allerAuLieu(code)
  }, [
    h('span.bac__code', court),
    h('span.bac__n', fmt.nb(articles, 2)),
    h('span.minus.tres-faible.coupe', pieces.length === 1
      ? tronque(pieces[0].libelle || pieces[0].ref || '', 22)
      : pluriel(pieces.length, 'réf.', 'réf.'))
  ]);
}

function blocNonRangees(e, orphelines, cadre) {
  return h('div.rayon.stock-rayon--orphelin', [
    h('div.rayon__tete', [
      icone('alerte', { taille: 15 }),
      h('span.grandit', 'Non rangées'),
      h('span.compte.compte--alerte', String(orphelines.length))
    ]),
    h('div.panneau__corps.pile-s', [
      h('div.petit.faible',
        'Ces pièces sont quelque part dans l’atelier, mais l’outil ne sait pas où. '
        + 'Touchez-en une pour lui donner un bac.'),
      h('div.liste', orphelines.slice(0, 40).map(p =>
        h('button.liste__ligne', {
          type: 'button',
          onclick: () => modalePiece(e, p, () => cadre.refaireListe())
        }, [
          h('span.qte' + (nombre(p.qte, 0) <= 0 ? '.qte--zero' : ''), fmt.nb(nombre(p.qte, 0), 2)),
          h('div.grandit.coupe', [
            h('div.gras.coupe', p.libelle || 'Sans nom'),
            h('div.minus.tres-faible.coupe', [p.ref, p.famille].filter(Boolean).join(' · '))
          ]),
          h('span.etiq', [icone('entrepot', { taille: 12 }), h('span', 'Ranger')])
        ]))),
      orphelines.length > 40
        ? h('div.minus.tres-faible', 'et ' + (orphelines.length - 40) + ' autres…')
        : null
    ])
  ]);
}

/** Range les pièces par rayon puis par bac. Le rayon vient du premier segment
 *  du code d'emplacement (« R2-B-04 » → rayon R2). */
function rangerParRayon(liste) {
  const rayons = new Map();
  const orphelines = [];

  for (const p of liste) {
    if (!String(p.emplacement || '').trim()) { orphelines.push(p); continue; }
    const em = lit.lireEmplacement(p.emplacement);
    const r = em.rayon || '?';
    if (!rayons.has(r)) rayons.set(r, new Map());
    const bacs = rayons.get(r);
    if (!bacs.has(em.code)) bacs.set(em.code, []);
    bacs.get(em.code).push(p);
  }

  return {
    rayons: Array.from(rayons.entries()).sort((a, b) => compareTexte(a[0], b[0])),
    orphelines: orphelines.sort((a, b) => compareTexte(a.libelle, b.libelle))
  };
}

/* ==========================================================================
   LA FENÊTRE DE SAISIE — création et modification
   ========================================================================== */

/**
 * @param {object} e     l'état
 * @param {object} piece la pièce à modifier, ou null pour en créer une
 * @param {function} fini appelée avec la pièce enregistrée
 * @param {object} [depart] valeurs pré-remplies à la création
 */
export function modalePiece(e, piece, fini, depart) {
  const creation = !piece;
  const p = piece || nouvellePiece(depart || {});
  const r = e.reglages || {};

  const idFamilles = id('lst');
  const idLieux = id('lst');

  const ref = champ({ etiquette: 'Référence', valeur: p.ref, exemple: 'FIL-H-001' });
  const refFab = champ({ etiquette: 'Réf. fabricant', valeur: p.refFabricant, exemple: 'LS932' });
  const ean = champ({ etiquette: 'Code-barres (EAN)', valeur: p.ean, exemple: '3286064012345' });
  const libelle = champ({
    etiquette: 'Désignation', valeur: p.libelle, obligatoire: true, autofocus: creation,
    exemple: 'Filtre à huile Purflux LS932'
  });
  const famille = champ({
    etiquette: 'Famille', valeur: p.famille, exemple: 'Filtration',
    aide: 'Choisissez-en une existante, ou tapez-en une nouvelle.'
  });
  famille.entree.setAttribute('list', idFamilles);

  const marqueP = champ({ etiquette: 'Marque', valeur: p.marque, exemple: 'Purflux' });
  const fournisseur = champ({
    etiquette: 'Fournisseur', type: 'liste', valeur: p.fournisseurId || '',
    options: [{ valeur: '', texte: 'Aucun' }].concat(
      (e.fournisseurs || []).filter(f => !f.archive)
        .sort((a, b) => compareTexte(a.nom, b.nom))
        .map(f => ({ valeur: f.id, texte: f.nom })))
  });
  const etat = champ({
    etiquette: 'État', type: 'liste', valeur: p.etat || 'neuf',
    options: Object.keys(ETATS).map(k => ({ valeur: k, texte: ETATS[k] }))
  });

  const emplacement = champ({
    etiquette: 'Emplacement', valeur: p.emplacement, exemple: 'R2-B-04',
    aide: 'Rayon, travée, bac. C’est ce qu’on lira dans six mois.'
  });
  emplacement.entree.setAttribute('list', idLieux);
  const zoneAuto = h('div.champ__aide');

  const qte = champ({
    etiquette: creation ? 'Quantité de départ' : 'Quantité',
    type: 'nombre', valeur: creation ? 0 : nombre(p.qte, 0), unite: p.unite || 'u',
    bloque: !creation,
    aide: creation ? null : 'La quantité se corrige par un mouvement, jamais à la main.'
  });
  const seuil = champ({
    etiquette: 'Seuil d’alerte', type: 'nombre',
    valeur: p.qteMin === null || p.qteMin === undefined ? '' : p.qteMin,
    aide: 'Vide : le seuil général du garage (' + nombre(r.stockAlerteDefaut, 1) + ').'
  });
  const unite = champ({
    etiquette: 'Unité', type: 'liste', valeur: p.unite || 'u',
    options: UNITES.map(u => ({ valeur: u, texte: u }))
  });

  const achat = champ({ etiquette: 'Prix d’achat HT', type: 'euros', valeur: p.prixAchat || '', unite: '€' });
  const vente = champ({ etiquette: 'Prix de vente HT', type: 'euros', valeur: p.prixVente || '', unite: '€' });
  const ventePro = champ({ etiquette: 'Prix de vente pro HT', type: 'euros', valeur: p.prixVentePro || '', unite: '€' });
  const zoneMarge = h('div.champ__aide');

  const compatible = champ({
    etiquette: 'Compatible avec', type: 'zone', lignes: 2, valeur: p.compatible,
    exemple: 'Peugeot 308 II 1.6 BlueHDi, Citroën C4 1.6 HDi…',
    aide: 'Les modèles sur lesquels la pièce va. C’est ce qui la fait retrouver.'
  });
  const notes = champ({ etiquette: 'Notes', type: 'zone', lignes: 2, valeur: p.notes });

  function majMarge() {
    const m = marge(vente.lire(), achat.lire());
    if (achat.lire() <= 0 || vente.lire() <= 0) { poser(zoneMarge, []); return; }
    poser(zoneMarge, h('span', {
      style: { color: m.euros >= 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: '600' }
    }, 'Marge : ' + fmt.euros(m.euros) + ' — ' + fmt.pourcent(m.taux) + ' du prix de vente'));
  }

  /* Le prix de vente se remplit tout seul pendant qu'on tape l'achat, mais
     seulement tant qu'il est vide : on n'écrase jamais un prix décidé à la
     main, même si l'achat change ensuite. */
  achat.entree.addEventListener('input', () => {
    if (achat.lire() > 0 && vente.lire() <= 0) {
      vente.ecrire(fmt.montant(prixConseille(achat.lire(), nombre(r.margeDefaut, 30))));
    }
    majMarge();
  });
  vente.entree.addEventListener('input', majMarge);
  majMarge();

  function proposerBac() {
    poser(zoneAuto, []);
    if (!r.emplacementsAuto) return;
    const saisi = emplacement.lire().trim();
    if (!saisi) return;
    const em = lit.lireEmplacement(saisi);
    /* On n'aide que si la personne a tapé un rayon tout seul (« R2 ») : dès
       qu'elle précise la travée, elle sait où elle va. */
    if (!em.rayon || em.travee) return;
    const libre = prochainBacLibre(e, em.rayon);
    poser(zoneAuto, h('button.bt.bt--nu.bt--s', {
      type: 'button',
      onclick: () => { emplacement.ecrire(libre); poser(zoneAuto, []); }
    }, [icone('entrepot', { taille: 13 }), h('span', 'Prochain bac libre : ' + libre)]));
  }
  emplacement.entree.addEventListener('input', proposerBac);
  proposerBac();

  modale({
    titre: creation ? 'Nouvelle pièce' : 'Modifier la pièce',
    taille: 'large',
    corps: h('div.pile', [
      h('datalist', { id: idFamilles }, famillesUtilisees(e).map(f => h('option', { value: f }))),
      h('datalist', { id: idLieux }, lieuxConnus(e).map(c => h('option', { value: c }))),

      h('div.majuscule', 'Identification'),
      grilleChamps([ref, refFab, ean]),
      libelle.noeud,
      grilleChamps([famille, marqueP, fournisseur, etat]),

      h('div.majuscule', 'Où et combien'),
      h('div.pile-s', [emplacement.noeud, zoneAuto]),
      grilleChamps([qte, seuil, unite]),

      h('div.majuscule', 'Prix'),
      grilleChamps([achat, vente, ventePro]),
      zoneMarge,

      h('div.majuscule', 'Pour la retrouver'),
      compatible.noeud,
      notes.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: creation ? 'Créer la pièce' : 'Enregistrer',
        ton: 'fort',
        faire: () => {
          if (!libelle.lire()) {
            libelle.erreur('Une pièce sans désignation ne se retrouve pas.');
            libelle.focus();
            return false;
          }
          const champs = {
            ref: ref.lire(),
            refFabricant: refFab.lire(),
            ean: ean.lire(),
            libelle: libelle.lire(),
            famille: famille.lire(),
            marque: marqueP.lire(),
            fournisseurId: fournisseur.lire() || null,
            etat: etat.lire(),
            emplacement: emplacement.lire().toUpperCase(),
            qteMin: seuil.entree.value.trim() === '' ? null : seuil.lire(),
            unite: unite.lire(),
            prixAchat: achat.lire(),
            prixVente: vente.lire(),
            prixVentePro: ventePro.lire(),
            compatible: compatible.lire(),
            notes: notes.lire()
          };

          if (!creation) {
            const modifiee = change('pieces', p.id, champs, 'Pièce modifiée');
            if (fini) fini(modifiee || p);
            return;
          }

          const creee = ajoute('pieces', nouvellePiece(Object.assign({}, champs, { qte: 0 })), 'Pièce créée');
          /* La quantité de départ passe par un vrai mouvement d'entrée : sans
             ça, l'historique de la pièce commencerait par un trou. */
          const depart0 = qte.lire();
          if (depart0 > 0) {
            act.mouvementStock({
              pieceId: creee.id, sens: 'entree', qte: depart0,
              motif: 'Stock de départ', prixUnit: champs.prixAchat
            });
          }
          if (fini) fini(creee);
        }
      }
    ]
  });
}

/** Tous les codes d'emplacement déjà utilisés, plus les rayons seuls : de quoi
 *  proposer aussi bien « R2 » que « R2-B-04 ». */
function lieuxConnus(e) {
  const codes = Array.from(lit.emplacements(e).keys());
  const rayons = unique(codes.map(c => lit.lireEmplacement(c).rayon).filter(Boolean));
  return unique(rayons.concat(codes)).sort(compareTexte);
}

/** Le prochain bac libre d'un rayon : on continue la dernière travée occupée,
 *  et on passe à la suivante quand elle déborde. */
function prochainBacLibre(e, rayon) {
  const occupes = [];
  for (const p of e.pieces || []) {
    if (p.archive) continue;
    const em = lit.lireEmplacement(p.emplacement);
    if (em.rayon === rayon && em.travee) occupes.push(em);
  }
  if (!occupes.length) return rayon + '-A-01';

  const travee = occupes.map(x => x.travee).sort(compareTexte).pop();
  const numeros = occupes.filter(x => x.travee === travee)
    .map(x => parseInt(x.bac, 10)).filter(n => !isNaN(n));
  const suivant = (numeros.length ? Math.max.apply(null, numeros) : 0) + 1;

  if (suivant <= 99) return rayon + '-' + travee + '-' + String(suivant).padStart(2, '0');
  const lettre = String.fromCharCode(travee.charCodeAt(0) + 1);
  return rayon + '-' + lettre + '-01';
}

/* ==========================================================================
   L'INVENTAIRE
   Compter ce qu'il y a vraiment, et écrire l'écart. Un inventaire qui ne
   laisse pas de trace ne sert à rien : chaque correction devient un mouvement.
   ========================================================================== */

function barreInventaire(e, comptes, quitter) {
  return h('div.bandeau.bandeau--alerte', [
    icone('balance'),
    h('div.grandit', [
      h('div.gras', 'Inventaire en cours'),
      h('div.petit', 'Tapez la quantité comptée devant chaque pièce. Laissez vide '
        + 'ce que vous ne comptez pas — rien ne bouge tant que vous n’avez pas validé.')
    ]),
    h('div.rang-s', [
      h('button.bt.bt--contour.bt--s', { type: 'button', onclick: quitter }, 'Abandonner'),
      h('button.bt.bt--fort.bt--s', {
        type: 'button',
        onclick: () => validerInventaire(e, comptes, quitter)
      }, [icone('coche'), h('span', 'Valider')])
    ])
  ]);
}

function validerInventaire(e, comptes, quitter) {
  const ecarts = [];
  for (const [pieceId, brut] of comptes) {
    if (String(brut).trim() === '') continue;
    const p = lit.piece(e, pieceId);
    if (!p) continue;
    const compte = nombre(brut, null);
    if (compte === null || compte < 0) continue;
    const avant = nombre(p.qte, 0);
    if (cts(compte) === cts(avant)) continue;
    ecarts.push({ piece: p, avant, compte, ecart: cts(compte - avant) });
  }

  if (!ecarts.length) {
    message('Inventaire conforme : rien à corriger.', { ton: 'ok' });
    quitter();
    return;
  }

  const valeur = cts(somme(ecarts, (x) => x.ecart * nombre(x.piece.prixAchat)));

  modale({
    titre: 'Écarts constatés',
    taille: 'large',
    corps: h('div.pile', [
      h('p.petit.faible', 'Un mouvement d’inventaire sera écrit pour chacune de ces '
        + 'pièces. Les autres ne bougent pas.'),
      h('div.tableau-cadre', h('table.grille.repliable', [
        h('thead', h('tr', [
          h('th', 'Pièce'),
          h('th.num', 'Théorique'),
          h('th.num', 'Compté'),
          h('th.num', 'Écart'),
          h('th.num', 'Valeur')
        ])),
        h('tbody', ecarts.map(x => h('tr', [
          h('td', { donnees: { col: 'Pièce' } }, [
            h('div.gras.coupe', x.piece.libelle || x.piece.ref || 'Sans nom'),
            h('div.minus.tres-faible', [x.piece.ref, x.piece.emplacement].filter(Boolean).join(' · '))
          ]),
          h('td.num', { donnees: { col: 'Théorique' } }, fmt.nb(x.avant, 2)),
          h('td.num', { donnees: { col: 'Compté' } }, fmt.nb(x.compte, 2)),
          h('td.num', { donnees: { col: 'Écart' } },
            h('b', { style: { color: x.ecart < 0 ? 'var(--danger)' : 'var(--ok)' } },
              (x.ecart > 0 ? '+' : '') + fmt.nb(x.ecart, 2))),
          h('td.num', { donnees: { col: 'Valeur' } },
            fmt.euros(cts(x.ecart * nombre(x.piece.prixAchat))))
        ])))
      ])),
      h('div.totaux', h('div.totaux__ligne', [
        h('span.faible', 'Écart de valeur au prix d’achat'),
        h('b', { style: { color: valeur < 0 ? 'var(--danger)' : 'var(--ok)' } },
          (valeur > 0 ? '+' : '') + fmt.euros(valeur))
      ]))
    ]),
    actions: [
      { texte: 'Revenir au comptage', ton: 'contour' },
      {
        texte: 'Écrire les corrections',
        ton: 'fort',
        faire: () => {
          let faits = 0;
          for (const x of ecarts) {
            const m = act.mouvementStock({
              pieceId: x.piece.id, sens: 'inventaire', qte: x.compte,
              motif: 'Inventaire', prixUnit: nombre(x.piece.prixAchat)
            });
            if (m) faits++;
          }
          quitter();
          bilanInventaire(faits, valeur);
        }
      }
    ]
  });
}

function bilanInventaire(faits, valeur) {
  modale({
    titre: 'Inventaire terminé',
    corps: h('div.pile', [
      h('div.bandeau.bandeau--ok', [
        icone('cocheRonde'),
        h('span', pluriel(faits, 'pièce corrigée', 'pièces corrigées')
          + ', écart de ' + fmt.euros(valeur) + ' au prix d’achat.')
      ]),
      h('p.petit.faible', 'Chaque correction est enregistrée comme un mouvement '
        + 'd’inventaire : on peut la relire sur la fiche de la pièce.')
    ]),
    actions: [{ texte: 'Fermer', ton: 'fort' }]
  });
}

/* ==========================================================================
   ENTRER ET SORTIR — le CSV, les étiquettes
   ========================================================================== */

/* Les colonnes qu'on sait reconnaître dans un fichier venu d'ailleurs. La
   première graphie de chaque liste est celle qu'on écrit à l'export : un
   fichier exporté puis réimporté doit retomber sur ses pieds. */
const COLONNES = [
  { champ: 'ref', noms: ['référence', 'reference', 'ref', 'code', 'code article', 'article'] },
  { champ: 'refFabricant', noms: ['réf. fabricant', 'ref fabricant', 'reference fabricant', 'ref fournisseur', 'oem'] },
  { champ: 'ean', noms: ['ean', 'code-barres', 'code barre', 'code barres', 'gencod'] },
  { champ: 'libelle', noms: ['désignation', 'designation', 'libellé', 'libelle', 'nom', 'description'] },
  { champ: 'famille', noms: ['famille', 'catégorie', 'categorie'] },
  { champ: 'marque', noms: ['marque', 'fabricant', 'équipementier', 'equipementier'] },
  { champ: 'fournisseur', noms: ['fournisseur', 'four'] },
  { champ: 'etat', noms: ['état', 'etat'] },
  { champ: 'emplacement', noms: ['emplacement', 'rangement', 'localisation', 'bac', 'lieu'] },
  { champ: 'qte', noms: ['quantité', 'quantite', 'qte', 'stock', 'qté'] },
  { champ: 'qteMin', noms: ['seuil', 'seuil d’alerte', 'seuil d\'alerte', 'stock mini', 'mini', 'qte min'] },
  { champ: 'unite', noms: ['unité', 'unite', 'un'] },
  { champ: 'prixAchat', noms: ['prix achat', 'prix d’achat', 'prix d\'achat', 'achat', 'pa', 'prix achat ht'] },
  { champ: 'prixVente', noms: ['prix vente', 'prix de vente', 'vente', 'pv', 'prix vente ht', 'prix public'] },
  { champ: 'prixVentePro', noms: ['prix vente pro', 'prix pro', 'pro'] },
  { champ: 'compatible', noms: ['compatible', 'compatibilité', 'compatibilite', 'modèles', 'modeles', 'application'] },
  { champ: 'notes', noms: ['notes', 'note', 'remarque', 'commentaire'] }
];

/* On compare les en-têtes sans accent, sans casse et sans ponctuation : les
   tableurs ajoutent des espaces insécables et des majuscules au hasard. */
const cleColonne = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function reconnaitreColonnes(entetes) {
  const trouvees = {};
  const ignorees = [];
  for (const t of entetes) {
    const k = cleColonne(t);
    const c = COLONNES.find(col => col.noms.some(n => cleColonne(n) === k));
    if (c && !trouvees[c.champ]) trouvees[c.champ] = t;
    else ignorees.push(t);
  }
  return { trouvees, ignorees };
}

async function importerCsv(e, refaireListe) {
  const fichiers = await choisirFichier({ accepte: '.csv,text/csv,text/plain' });
  if (!fichiers.length) return;

  let objets;
  try {
    objets = csvEnObjets(await lireTexte(fichiers[0]));
  } catch (err) {
    messageErreur('Fichier illisible. Enregistrez-le en CSV depuis votre tableur.');
    return;
  }
  if (!objets.length) {
    messageErreur('Ce fichier ne contient aucune ligne exploitable (il faut une ligne d’en-têtes).');
    return;
  }

  const entetes = Object.keys(objets[0]);
  const { trouvees, ignorees } = reconnaitreColonnes(entetes);
  if (!trouvees.libelle && !trouvees.ref) {
    messageErreur('Aucune colonne « Désignation » ni « Référence » reconnue : '
      + 'l’outil ne saurait pas quoi créer.');
    return;
  }

  /* On reconnaît les pièces déjà présentes par leur référence : réimporter le
     tarif d'un fournisseur doit mettre à jour, pas dupliquer. */
  const parRef = new Map();
  for (const p of e.pieces || []) {
    if (p.archive) continue;
    const k = cleColonne(p.ref);
    if (k) parRef.set(k, p);
  }
  const lignes = objets.map(o => {
    const champs = {};
    for (const c of COLONNES) {
      if (!trouvees[c.champ]) continue;
      champs[c.champ] = String(o[trouvees[c.champ]] || '').trim();
    }
    const k = cleColonne(champs.ref);
    return { champs, existante: k ? parRef.get(k) || null : null };
  }).filter(l => l.champs.libelle || l.champs.ref);

  if (!lignes.length) {
    messageErreur('Aucune ligne n’a de désignation ni de référence : rien à importer.');
    return;
  }

  /* Le fournisseur est écrit en toutes lettres dans le fichier : on le
     rattache à une fiche existante, et on l'ignore s'il est inconnu plutôt
     que d'en créer une à l'aveugle. */
  const fournisseursConnus = new Map((e.fournisseurs || [])
    .filter(f => !f.archive)
    .map(f => [cleColonne(f.nom), f.id]));

  const neuves = lignes.filter(l => !l.existante).length;
  const majs = lignes.length - neuves;

  modale({
    titre: 'Aperçu de l’import',
    taille: 'immense',
    corps: h('div.pile', [
      h('div.bandeau', [
        icone('info'),
        h('span', pluriel(lignes.length, 'ligne exploitable', 'lignes exploitables')
          + ' dans ce fichier : ' + pluriel(neuves, 'nouvelle pièce', 'nouvelles pièces')
          + (majs ? ' et ' + pluriel(majs, 'déjà connue (elle sera mise à jour)',
              'déjà connues (elles seront mises à jour)') : '') + '.')
      ]),
      h('div.pile-s', [
        h('div.majuscule', 'Colonnes reconnues'),
        h('div.rang-s.enroule', Object.keys(trouvees).map(c =>
          h('span.etiq.etiq--accent', trouvees[c])))
      ]),
      ignorees.length ? h('div.pile-s', [
        h('div.majuscule', 'Colonnes ignorées'),
        h('div.rang-s.enroule', ignorees.map(t => h('span.etiq', t)))
      ]) : null,
      h('div.majuscule', 'Les ' + Math.min(10, lignes.length) + ' premières lignes'),
      h('div.tableau-cadre', h('table.grille', [
        h('thead', h('tr', [h('th', '')].concat(
          Object.keys(trouvees).map(c => h('th', trouvees[c]))))),
        h('tbody', lignes.slice(0, 10).map(l => h('tr', [
          h('td.serre', l.existante
            ? h('span.etiq', 'mise à jour')
            : h('span.etiq.etiq--accent', 'nouvelle'))
        ].concat(Object.keys(trouvees).map(c =>
          h('td', { style: { whiteSpace: 'nowrap' } }, tronque(l.champs[c] || '—', 40)))))))
      ]))
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Importer ' + pluriel(lignes.length, 'pièce'),
        ton: 'fort',
        faire: () => {
          maj('Stock importé', (etat) => {
            for (const l of lignes) {
              const champs = versPiece(l.champs, fournisseursConnus);
              if (l.existante) {
                const x = etat.pieces.find(y => y.id === l.existante.id);
                if (x) { Object.assign(x, champs); x.maj = Date.now(); }
              } else {
                etat.pieces.push(nouvellePiece(champs));
              }
            }
          });
          refaireListe();
          messageOk(pluriel(lignes.length, 'pièce importée', 'pièces importées'));
        }
      }
    ]
  });
}

/** Traduit une ligne de CSV en champs de pièce. Ce qui est absent du fichier
 *  n'est pas écrit : un import partiel ne doit pas effacer ce qu'on savait. */
function versPiece(brut, fournisseursConnus) {
  const champs = {};
  const texte = ['ref', 'refFabricant', 'ean', 'libelle', 'famille', 'marque',
    'emplacement', 'unite', 'compatible', 'notes'];
  for (const c of texte) if (brut[c] !== undefined && brut[c] !== '') champs[c] = brut[c];
  if (champs.emplacement) champs.emplacement = champs.emplacement.toUpperCase();

  if (brut.fournisseur) {
    const trouve = fournisseursConnus.get(cleColonne(brut.fournisseur));
    if (trouve) champs.fournisseurId = trouve;
  }

  for (const c of ['qte', 'prixAchat', 'prixVente', 'prixVentePro']) {
    if (brut[c] !== undefined && brut[c] !== '') champs[c] = nombre(brut[c], 0);
  }
  if (brut.qteMin !== undefined && brut.qteMin !== '') champs.qteMin = nombre(brut.qteMin, null);

  if (brut.etat) {
    const k = cleColonne(brut.etat);
    const trouve = Object.keys(ETATS).find(x => cleColonne(ETATS[x]) === k || x === k);
    if (trouve) champs.etat = trouve;
  }
  return champs;
}

function exporterCsv(e) {
  /* Le fichier sort dans l'ordre des rayons, comme la liste à l'écran : c'est
     celui dans lequel on fera le tour des étagères, papier en main. */
  const vivantes = (e.pieces || []).filter(p => !p.archive).sort(comparateur(''));

  /* Le tableur français lit « 4,20 » comme un nombre et « 4.20 » comme du
     texte : on écrit la virgule, et l'import la relit sans broncher. */
  const virgule = (n) => String(cts(nombre(n, 0))).replace('.', ',');

  const lignes = [[
    'Référence', 'Réf. fabricant', 'EAN', 'Désignation', 'Famille', 'Marque',
    'Fournisseur', 'État', 'Emplacement', 'Quantité', 'Seuil', 'Unité',
    'Prix achat', 'Prix vente', 'Prix vente pro', 'Compatible', 'Notes'
  ]];
  for (const p of vivantes) {
    const f = p.fournisseurId ? lit.fournisseur(e, p.fournisseurId) : null;
    lignes.push([
      p.ref, p.refFabricant, p.ean, p.libelle, p.famille, p.marque,
      f ? f.nom : '', ETATS[p.etat] || '', p.emplacement,
      virgule(p.qte),
      p.qteMin === null || p.qteMin === undefined ? '' : virgule(p.qteMin),
      p.unite || 'u',
      virgule(p.prixAchat), virgule(p.prixVente), virgule(p.prixVentePro),
      p.compatible, p.notes
    ]);
  }

  telecharger(nomDate('stock', 'csv'), versCsv(lignes));
  messageOk(pluriel(vivantes.length, 'pièce exportée', 'pièces exportées'));
}

/** Une étiquette par bac occupé : le code en gros, et de quoi reconnaître le
 *  contenu sans ouvrir le bac. */
function etiquettesDesBacs(e) {
  const bacs = lit.emplacements(e);
  if (!bacs.size) {
    messageErreur('Aucune pièce n’a d’emplacement : il n’y a rien à étiqueter.');
    return;
  }
  const planche = Array.from(bacs.entries())
    .sort((a, b) => compareTexte(a[0], b[0]))
    .map(([code, pieces]) => ({
      code,
      libelle: pieces.length === 1
        ? tronque(pieces[0].libelle || pieces[0].ref || '', 40)
        : (unique(pieces.map(p => p.famille).filter(Boolean))[0] || 'Divers'),
      detail: pluriel(pieces.length, 'référence') + ' · '
        + pluriel(somme(pieces, (p) => nombre(p.qte, 0)), 'article')
    }));
  imprimerEtiquettes(planche);
}

/* ==========================================================================
   LE MENU ⋮
   ========================================================================== */

function menuEcran(ancre, e, cadre) {
  menu(ancre, [
    { texte: 'Importer un CSV', icone: 'televerser', faire: () => importerCsv(e, cadre.refaireListe) },
    { texte: 'Exporter le stock (CSV)', icone: 'telecharger', faire: () => exporterCsv(e) },
    null,
    { texte: 'Imprimer les étiquettes de bacs', icone: 'imprimer', faire: () => etiquettesDesBacs(e) },
    null,
    {
      texte: cadre.enInventaire ? 'Quitter l’inventaire' : 'Lancer un inventaire',
      icone: 'balance',
      faire: cadre.basculerInventaire
    }
  ], { titre: 'Stock' });
}
