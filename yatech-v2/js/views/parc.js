/* ==========================================================================
   YATECH — écran « Parc »
   --------------------------------------------------------------------------
   Le plan du parking, en une image. La question posée dix fois par jour n'est
   pas « combien de véhicules avons-nous » mais « où est la Clio de madame
   Roux ? » et « quelle place puis-je encore promettre au téléphone ? ».
   D'où le plan dessiné à l'échelle du vrai parking, la couleur qui dit
   pourquoi le véhicule est là, et le compteur de jours qui dénonce les
   ventouses.

   Il n'existe pas d'entité « place » dans l'état : le décor sort des réglages
   (`lit.places`) et l'occupation se lit sur les dossiers, qui portent un code
   de place (`lit.occupation`). Conséquence directe : garer, déplacer ou
   libérer, c'est toujours écrire dans un dossier — `act.garer` / `act.degarer`.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, choisir, message, messageErreur } from '../core/ui.js';
import { maj } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { nombre, pluriel, plaqueJolie, correspond, compareTexte } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { MOTIFS_PARC, TYPES_PLACE, ETAPES } from '../domain/schema.js';
import {
  enTete, indic, plaque, pastilleEtape, barreRecherche, champ, vide
} from '../ui/widgets.js';

/* La feuille de style ne connaît que six couleurs de place. Les huit motifs
   du métier s'y rangent par leur ton : deux motifs qui veulent dire à peu près
   la même chose au regard (pièce commandée / gros travaux) partagent la même
   couleur, et la légende le dit franchement. */
const CLASSE_MOTIF = {
  attente: 'meca',      // alerte  — le véhicule attend qu'on s'en occupe
  travaux: 'travaux',   // accent  — quelqu'un est dessus
  piece:   'gros',      // violet
  gros:    'gros',      // violet
  pret:    'pret',      // ok      — le client peut venir
  depot:   'electro',   // info    — gardiennage, il n'attend rien
  perso:   'perso',     // neutre
  epave:   'perso'      // neutre
};

/* La légende, écrite une fois : une ligne par couleur réellement dessinée. */
const LEGENDE = [
  { ton: 'alerte', texte: 'En attente de travaux' },
  { ton: 'accent', texte: 'Travaux en cours' },
  { ton: 'violet', texte: 'Pièce commandée ou gros travaux' },
  { ton: 'ok',     texte: 'Prêt, à récupérer' },
  { ton: 'info',   texte: 'Dépôt, gardiennage' },
  { ton: 'neutre', texte: 'Personnel, épave' },
  { ton: 'danger', texte: 'Immobilisé trop longtemps' }
];

/* Les réglages peuvent contenir un type de place inconnu (un fichier importé,
   une version plus récente) : on ne veut pas que le plan refuse de s'afficher
   pour si peu. */
const nomType = (t) => (TYPES_PLACE[t] || TYPES_PLACE.normale).nom;

/* Regarder le plan ou la liste n'est pas du travail : ça ne va pas dans l'état
   enregistré, mais ça survit d'une visite à l'autre. Au comptoir on veut le
   plan, en marchant dans la cour on veut la liste. */
const pref = { vue: 'plan' };

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    const p = releve(e);
    return [
      enTete({
        titre: 'Parc',
        sous: sousTitre(p),
        actions: [
          /* La ronde du matin : on marche dans la cour, téléphone en main, et
             on remet chaque voiture à son étape. C'est le geste qui garde
             l'atelier juste, et il ne se fait pas assis devant un plan. */
          h('button.bt.bt--fort', {
            type: 'button', onclick: () => modaleTour(e, refaire)
          }, [icone('parc'), h('span', 'Tour du parc')]),
          bascule(refaire)
        ]
      }),
      anomalies(e, p, refaire),
      indicateurs(e, p),
      pref.vue === 'plan' ? plan(e, p, refaire) : vueListe(e, p, refaire),
      legende(),
      sansPlace(e, p, refaire)
    ];
  }

  poser(racine, contenu());
  return racine;
}

/* ==========================================================================
   LE TOUR DU PARC
   --------------------------------------------------------------------------
   Une ligne par véhicule garé, dans l'ordre des places. On touche l'étape qui
   correspond, c'est enregistré aussitôt — pas de fenêtre, pas de bouton
   Valider. Debout dans la cour, avec des gants, on ne remplit pas un
   formulaire : on tape une pastille et on passe à la suivante.

   Les étapes proposées sont celles d'une ronde, pas les neuf du dossier :
   entre deux voitures, personne ne cherche « Attente accord » dans une liste.
   ========================================================================== */

const ETAPES_RONDE = ['diag', 'devis', 'piece', 'atelier', 'controle', 'pret'];

function modaleTour(e, refaireEcran) {
  const corps = h('div.pile-s');
  let touche = 0;

  function peindreTout() {
    const p = releve(e);
    const garees = p.occupees
      .map(place => ({ place, d: p.prises.get(place.code) }))
      .filter(x => x.d)
      .sort((a, b) => compareTexte(a.place.code, b.place.code));

    poser(corps, garees.length
      ? garees.map(({ place, d }) => ligneTour(e, place, d, peindreTout, () => { touche++; }))
      : h('div.petit.faible.centre', 'Le parc est vide : rien à faire ce matin.'));
  }
  peindreTout();

  modale({
    titre: 'Tour du parc',
    taille: 'large',
    corps: h('div.pile', [
      h('div.petit.faible',
        'Une ligne par véhicule. Touchez l’étape qui correspond : c’est enregistré '
        + 'aussitôt, il n’y a rien à valider.'),
      corps
    ]),
    actions: [{
      texte: 'Tour terminé', ton: 'fort',
      faire: () => {
        refaireEcran();
        if (touche) message(pluriel(touche, 'véhicule mis à jour', 'véhicules mis à jour'),
          { ton: 'ok' });
      }
    }]
  });
}

function ligneTour(e, place, d, repeindre, compter) {
  const v = lit.vehicule(e, d.vehiculeId);
  const c = lit.client(e, d.clientId || (v ? v.clientId : null));
  const jours = lit.joursDansAtelier(d);
  const cmd = lit.etatCommandes(d);
  const attend = cmd.total - cmd.recues;

  return h('div.carte.carte--muette.pile-s', [
    h('div.rang', [
      h('span.pastille.pastille--accent.num', place.code),
      h('div.grandit.coupe', [
        h('div.gras.coupe', v ? lit.nomVehicule(v) : 'Véhicule inconnu'),
        h('div.minus.tres-faible.coupe', [
          v ? plaqueJolie(v.immat) : null,
          c ? lit.nomClient(c) : null,
          jours === 0 ? 'arrivé aujourd’hui' : jours + ' jours sur le parc',
          attend > 0 ? pluriel(attend, 'pièce attendue', 'pièces attendues') : null
        ].filter(Boolean).join(' · '))
      ]),
      h('a.bt.bt--nu.bt--icone.bt--s', {
        href: '#/dossier/' + d.id, 'aria-label': 'Ouvrir le dossier'
      }, icone('droite'))
    ]),
    /* Les pastilles : la cible fait toute la hauteur d'un doigt, et l'étape
       en cours est marquée pour qu'on sache si on a déjà fait cette voiture. */
    h('div.rang-s.enroule', ETAPES_RONDE.map(cle => {
      const et = ETAPES.find(x => x.cle === cle);
      const actif = d.etape === cle;
      return h('button.etiq' + (actif ? '.etiq--accent' : ''), {
        type: 'button',
        'aria-pressed': actif ? 'true' : 'false',
        onclick: () => {
          if (actif) return;
          act.changerEtape(d.id, cle);
          compter();
          repeindre();
        }
      }, et ? et.court : cle);
    }))
  ]);
}

/* ==========================================================================
   LE RELEVÉ — tout ce que l'écran a besoin de savoir, calculé une seule fois
   ========================================================================== */

function releve(e) {
  const places = lit.places(e);
  const prises = lit.occupation(e);
  const connues = new Set(places.map(x => x.code));
  const ouverts = lit.dossiersOuverts(e);

  const occupees = places.filter(x => prises.has(x.code));
  const utilisables = places.filter(x => x.type !== 'hs' || prises.has(x.code));
  const libres = places.filter(x => x.type !== 'hs' && !prises.has(x.code));
  const jours = occupees.map(x => lit.joursDansAtelier(prises.get(x.code)));

  return {
    places, prises, occupees, utilisables, libres,
    /* Un dossier peut porter un code de place qui n'existe plus : il suffit
       d'avoir réduit le parking dans les réglages. Ces véhicules seraient
       invisibles sur le plan, donc on les remonte à part. */
    horsPlan: ouverts.filter(d => d.place && !connues.has(d.place)),
    sansPlace: ouverts.filter(d => !d.place).sort(lit.triDossiers),
    conflits: lit.conflitsParc(e),
    seuilAlerte: nombre(e.reglages.parcAlerteJours, 7),
    seuilGrave: nombre(e.reglages.parcAlerteGrave, 21),
    jours,
    moyenne: jours.length ? jours.reduce((t, j) => t + j, 0) / jours.length : null,
    colonnes: places.reduce((m, x) => Math.max(m, x.colonne), 1),
    rangees: [...new Set(places.map(x => x.rangee))]
  };
}

function sousTitre(p) {
  return pluriel(p.occupees.length, 'place occupée', 'places occupées')
    + ' sur ' + p.utilisables.length + ', '
    + pluriel(p.libres.length, 'libre', 'libres');
}

function bascule(refaire) {
  const bt = (cle, texte, ico) => h('button', {
    type: 'button',
    'aria-pressed': pref.vue === cle ? 'true' : 'false',
    onclick: () => { pref.vue = cle; refaire(); }
  }, [icone(ico, { taille: 14 }), h('span', texte)]);

  return h('div.segments', [bt('plan', 'Plan', 'parc'), bt('liste', 'Liste', 'menu')]);
}

/* ==========================================================================
   CE QUI CLOCHE — deux véhicules au même endroit, ou une place disparue
   ========================================================================== */

function anomalies(e, p, refaire) {
  if (!p.conflits.length && !p.horsPlan.length) return null;

  const sortir = (d, texte) => h('button.bt.bt--contour.bt--s', {
    type: 'button',
    onclick: () => { act.degarer(d.id); message('Place libérée', { ton: 'ok' }); refaire(); }
  }, [icone('sortir', { taille: 14 }), h('span', texte)]);

  return h('div.pile-s', [
    ...p.conflits.map(c => h('div.bandeau.bandeau--danger', [
      icone('alerte'),
      h('div.grandit', [
        h('div.gras', 'Deux véhicules annoncés sur la place ' + c.place),
        h('div.petit', c.dossiers.map(d => etiquetteVehicule(e, d)).join('  et  ')),
        h('div.rang-s.enroule', { style: { marginTop: 'var(--e-2)' } },
          c.dossiers.map(d => sortir(d, 'Sortir ' + etiquetteVehicule(e, d))))
      ])
    ])),
    ...p.horsPlan.map(d => h('div.bandeau.bandeau--alerte', [
      icone('alerte'),
      h('div.grandit', [
        h('div.gras', etiquetteVehicule(e, d) + ' est garé en « ' + d.place + ' »'),
        h('div.petit', 'Cette place n’existe plus sur le plan. Donnez-lui-en une autre, ou libérez-la.'),
        h('div.rang-s.enroule', { style: { marginTop: 'var(--e-2)' } }, [
          h('button.bt.bt--contour.bt--s', {
            type: 'button', onclick: () => choisirPlaceLibre(e, d, refaire)
          }, [icone('parc', { taille: 14 }), h('span', 'Changer de place')]),
          sortir(d, 'Libérer')
        ])
      ])
    ]))
  ]);
}

function etiquetteVehicule(e, d) {
  const v = lit.vehicule(e, d.vehiculeId);
  return v ? plaqueJolie(v.immat) : lit.titreDossier(e, d);
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function indicateurs(e, p) {
  const trainent = p.jours.filter(j => j > p.seuilAlerte).length;
  const ventouses = p.jours.filter(j => j > p.seuilGrave).length;

  return h('div.grille-indics', [
    indic({
      nom: 'Places libres', valeur: p.libres.length,
      ton: p.libres.length === 0 ? 'danger' : (p.libres.length <= 1 ? 'alerte' : null),
      detail: 'sur ' + p.utilisables.length + ' utilisables'
    }),
    indic({
      nom: 'Plus de ' + p.seuilAlerte + ' jours', valeur: trainent,
      ton: trainent ? 'alerte' : null,
      detail: trainent ? 'à relancer' : 'rien ne traîne'
    }),
    indic({
      nom: 'Plus de ' + p.seuilGrave + ' jours', valeur: ventouses,
      ton: ventouses ? 'danger' : null,
      detail: ventouses ? 'places bloquées pour rien' : 'aucune ventouse'
    }),
    indic({
      nom: 'Immobilisation moyenne',
      valeur: p.moyenne === null ? '—' : fmt.nb(p.moyenne, 1) + ' j',
      detail: p.occupees.length ? 'sur les véhicules présents' : 'parc vide'
    })
  ]);
}

/* ==========================================================================
   LE PLAN
   ========================================================================== */

function plan(e, p, refaire) {
  if (!p.places.length) {
    return h('div.panneau', h('div.panneau__corps', vide({
      icone: 'parc', titre: 'Aucune place définie',
      texte: 'Décrivez le parking dans les réglages : nombre de colonnes, de rangées, noms des allées.'
    })));
  }

  /* Une colonne de plus, à gauche, pour le nom des allées — et seulement si
     au moins une allée porte un nom : sinon c'est une bande vide. */
  const nommees = p.places.some(x => x.nomRangee);
  const grille = h('div.parc__plan', {
    style: {
      gridTemplateColumns: (nommees ? 'auto ' : '') + 'repeat(' + p.colonnes + ', minmax(62px, 100px))',
      justifyContent: 'center'
    },
    ref: (n) => brancherGlisser(n, e, refaire)
  });

  for (const lettre of p.rangees) {
    if (nommees) {
      const nom = (p.places.find(x => x.rangee === lettre) || {}).nomRangee;
      grille.appendChild(h('div.parc__rangee-nom', nom || lettre));
    }
    p.places
      .filter(x => x.rangee === lettre)
      .sort((a, b) => a.colonne - b.colonne)
      .forEach(x => grille.appendChild(unePlace(e, p, x, refaire)));
  }

  return h('div.parc', grille);
}

function unePlace(e, p, place, refaire) {
  const d = p.prises.get(place.code) || null;
  const v = d ? lit.vehicule(e, d.vehiculeId) : null;
  const jours = d ? lit.joursDansAtelier(d) : 0;
  const retard = d && jours > p.seuilGrave;

  const classes = ['place'];
  if (d) {
    classes.push('place--prise');
    /* Le rouge du retard remplace la couleur du motif au lieu de s'y ajouter :
       deux règles de même poids, l'ordre de la feuille de style déciderait à
       notre place. */
    classes.push('place--' + (retard ? 'retard' : (CLASSE_MOTIF[d.motifParc] || 'meca')));
  } else if (place.type === 'hs') {
    classes.push('place--hs');
  }
  if (place.type === 'pont') classes.push('place--pont');

  const libreEtCondamnee = !d && place.type === 'hs';
  const dit = d
    ? 'Place ' + place.code + ', ' + (v ? plaqueJolie(v.immat) : 'véhicule')
      + (v ? ', ' + lit.nomVehicule(v) : '') + ', ' + pluriel(jours, 'jour', 'jours')
    : 'Place ' + place.code + (libreEtCondamnee ? ', inutilisable' : ', libre');

  return h('button.' + classes.join('.'), {
    type: 'button',
    draggable: !!d,
    disabled: libreEtCondamnee,
    donnees: { place: place.code, hs: libreEtCondamnee ? 'oui' : null },
    'aria-label': dit,
    title: dit + (place.type !== 'normale' ? ' — ' + nomType(place.type) : ''),
    onclick: () => {
      if (libreEtCondamnee) return;
      if (d) modaleOccupee(e, place, d, refaire);
      else modaleLibre(e, place, refaire);
    }
  }, d ? [
    h('span.place__num', place.code),
    v ? h('div.place__plaque', plaqueJolie(v.immat)) : null,
    v ? h('div.place__modele', lit.nomVehicule(v)) : h('div.place__modele', lit.titreDossier(e, d)),
    h('span.place__jours', jours + ' j')
  ] : [
    h('div.num.gras', place.code)
  ]);
}

/* ==========================================================================
   LA LÉGENDE
   ========================================================================== */

function legende() {
  const pave = (ton) => h('i', {
    style: { color: 'var(--' + ton + ')', background: 'var(--' + ton + '-voile)' }
  });
  return h('div.parc__legende', [
    ...LEGENDE.map(l => h('span', [pave(l.ton), l.texte])),
    h('span', [icone('parc', { taille: 13 }), 'Pointillés : place libre']),
    h('span', [icone('haut', { taille: 13 }), 'PONT : pont élévateur']),
    h('span', [icone('croix', { taille: 13 }), 'Hachures : place inutilisable'])
  ]);
}

/* ==========================================================================
   LA VUE LISTE — la même chose au doigt, du plus ancien au plus récent
   ========================================================================== */

function vueListe(e, p, refaire) {
  if (!p.occupees.length) {
    return h('div.panneau', h('div.panneau__corps', vide({
      icone: 'parc', titre: 'Le parc est vide', texte: 'Aucun véhicule n’occupe de place.'
    })));
  }

  const rangs = p.occupees
    .map(place => ({ place, d: p.prises.get(place.code) }))
    .sort((a, b) => lit.joursDansAtelier(b.d) - lit.joursDansAtelier(a.d));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('sablier', { taille: 16 }),
      h('h2.grandit', 'Du plus ancien au plus récent'),
      h('span.compte', String(rangs.length))
    ]),
    h('div.liste', rangs.map(({ place, d }) => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      const jours = lit.joursDansAtelier(d);
      const motif = MOTIFS_PARC[d.motifParc];
      return h('button.liste__ligne', {
        type: 'button', onclick: () => modaleOccupee(e, place, d, refaire)
      }, [
        h('span.etiq', { style: { minWidth: '40px', justifyContent: 'center' } }, place.code),
        h('div.grandit.coupe', [
          h('div.rang-s', [
            v ? plaque(v.immat) : null,
            h('span.gras.coupe', v ? lit.nomVehicule(v) : lit.titreDossier(e, d))
          ]),
          h('div.petit.faible.coupe', [
            c ? lit.nomClient(c) : '',
            motif ? motif.nom : ''
          ].filter(Boolean).join(' · '))
        ]),
        pastilleEtape(d.etape),
        h('span.num.gras', {
          style: jours > p.seuilGrave ? { color: 'var(--danger)' }
            : (jours > p.seuilAlerte ? { color: 'var(--alerte)' } : null)
        }, jours + ' j')
      ]);
    }))
  ]);
}

/* ==========================================================================
   LES VÉHICULES SANS PLACE
   ========================================================================== */

function sansPlace(e, p, refaire) {
  if (!p.sansPlace.length) return null;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('question', { taille: 16 }),
      h('h2.grandit', 'Sans place'),
      h('span.compte', String(p.sansPlace.length))
    ]),
    h('div.liste', p.sansPlace.map(d => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      return h('div.liste__ligne.liste__ligne--muette', [
        h('div.grandit.coupe', [
          h('div.rang-s', [
            v ? plaque(v.immat) : null,
            h('span.gras.coupe', v ? lit.nomVehicule(v) : lit.titreDossier(e, d))
          ]),
          h('div.petit.faible.coupe', c ? lit.nomClient(c) : '')
        ]),
        pastilleEtape(d.etape),
        h('button.bt.bt--contour.bt--s', {
          type: 'button', onclick: () => choisirPlaceLibre(e, d, refaire)
        }, [icone('parc', { taille: 14 }), h('span', 'Lui donner une place')])
      ]);
    }))
  ]);
}

/* ==========================================================================
   LES MODALES
   ========================================================================== */

function modaleOccupee(e, place, d, refaire) {
  const v = lit.vehicule(e, d.vehiculeId);
  const c = lit.client(e, d.clientId);
  const t = lit.totauxDossier(e, d);
  const jours = lit.joursDansAtelier(d);
  const motif = MOTIFS_PARC[d.motifParc];

  const action = (texte, ico, faire, danger) => h('button.bt.bt--plein' + (danger ? '.bt--danger' : '.bt--contour'), {
    type: 'button', onclick: faire
  }, [icone(ico, { taille: 15 }), h('span', texte)]);

  const boite = modale({
    titre: 'Place ' + place.code,
    corps: h('div.pile', [
      h('div.rang.enroule', [
        v ? plaque(v.immat, true) : null,
        h('div.grandit.coupe', [
          h('div.gras', v ? lit.nomVehiculeLong(v) : lit.titreDossier(e, d)),
          h('div.petit.faible', c ? lit.nomClient(c) : 'Client inconnu')
        ]),
        pastilleEtape(d.etape)
      ]),
      h('div.pile-s', [
        detail('Motif', motif ? motif.nom : d.motifParc),
        detail('Ici depuis', pluriel(jours, 'jour', 'jours')
          + (d.entree ? ' (' + fmt.date(d.entree, 'normal') + ')' : '')),
        detail('Type de place', nomType(place.type)
          + (place.nomRangee ? ' · ' + place.nomRangee : '')),
        detail('Total du dossier', fmt.euros(t.ttc) + ' TTC')
      ]),
      h('div.pile-s', [
        action('Changer le motif', 'etiquette', async () => {
          const choix = await choisir({
            titre: 'Pourquoi est-il là ?',
            options: Object.keys(MOTIFS_PARC).map(k => ({
              valeur: k, texte: MOTIFS_PARC[k].nom,
              detail: k === d.motifParc ? 'motif actuel' : null
            }))
          });
          if (!choix) return;
          act.garer(d.id, d.place, choix);
          boite.fermer();
          message('Motif changé', { ton: 'ok' });
          refaire();
        }),
        action('Déplacer vers une autre place', 'parc', () => {
          boite.fermer();
          choisirPlaceLibre(e, d, refaire);
        }),
        action('Libérer la place', 'sortir', async () => {
          const ok = await confirmer({
            titre: 'Libérer la place ' + place.code + ' ?',
            texte: 'Le dossier reste ouvert, il n’aura simplement plus de place au parc.',
            ok: 'Libérer', danger: true
          });
          if (!ok) return;
          act.degarer(d.id);
          boite.fermer();
          message('Place ' + place.code + ' libérée', { ton: 'ok' });
          refaire();
        }, true)
      ])
    ]),
    actions: [
      { texte: 'Fermer', ton: 'contour' },
      {
        texte: 'Ouvrir le dossier', ton: 'fort',
        faire: () => { location.hash = '#/dossier/' + d.id; }
      }
    ]
  });
}

function detail(nom, valeur) {
  return h('div.rang', [
    h('span.petit.faible', { style: { minWidth: '130px' } }, nom),
    h('span.grandit.gras.coupe', valeur)
  ]);
}

function modaleLibre(e, place, refaire) {
  const candidats = lit.dossiersOuverts(e).filter(d => !d.place).sort(lit.triDossiers);

  if (!candidats.length) {
    modale({
      titre: 'Place ' + place.code,
      corps: vide({
        icone: 'coche', titre: 'Tout le monde est garé',
        texte: 'Aucun dossier ouvert n’attend une place.'
      }),
      actions: [{ texte: 'Fermer', ton: 'contour' }]
    });
    return;
  }

  const motif = champ({
    type: 'liste', etiquette: 'Pourquoi est-il là ?', valeur: 'attente',
    options: Object.keys(MOTIFS_PARC).map(k => ({ valeur: k, texte: MOTIFS_PARC[k].nom }))
  });
  const liste = h('div.pile-s');
  let boite;

  function garnir(requete) {
    const vus = candidats.filter(d => {
      if (!requete) return true;
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      return correspond([
        /* La plaque est cherchable sous ses deux formes : on tape « EK741 »
           comme « EK-741 » selon qu'on lit l'écran ou la carte grise. */
        v ? v.immat : '', v ? plaqueJolie(v.immat) : '', v ? lit.nomVehicule(v) : '',
        c ? lit.nomClient(c) : '', d.numero, d.demande
      ].filter(Boolean).join(' '), requete);
    });

    poser(liste, vus.length ? vus.slice(0, 40).map(d => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      return h('button.carte.rang', {
        type: 'button',
        onclick: () => {
          if (!act.garer(d.id, place.code, motif.lire())) {
            messageErreur('Cette place vient d’être prise. Choisissez-en une autre.');
            return;
          }
          if (boite) boite.fermer();
          message(etiquetteVehicule(e, d) + ' garé en ' + place.code, { ton: 'ok' });
          refaire();
        }
      }, [
        h('div.grandit.coupe', [
          h('div.rang-s', [
            v ? plaque(v.immat) : null,
            h('span.gras.coupe', v ? lit.nomVehicule(v) : lit.titreDossier(e, d))
          ]),
          h('div.petit.faible.coupe', c ? lit.nomClient(c) : '')
        ]),
        pastilleEtape(d.etape),
        icone('droite', { taille: 14 })
      ]);
    }) : h('div.petit.faible.centre', 'Aucun dossier ne correspond.'));
  }

  garnir('');

  boite = modale({
    titre: 'Garer sur la place ' + place.code,
    corps: h('div.pile', [
      motif.noeud,
      barreRecherche({ exemple: 'Plaque, client, modèle…', surChangement: garnir }),
      liste
    ]),
    actions: [{ texte: 'Annuler', ton: 'contour' }]
  });
}

/** Donner (ou changer) la place d'un dossier depuis n'importe où dans l'écran. */
async function choisirPlaceLibre(e, d, refaire) {
  const libres = lit.placesLibres(e);
  if (!libres.length) {
    messageErreur('Plus une seule place libre.');
    return;
  }
  const choix = await choisir({
    titre: 'Vers quelle place ?',
    options: libres.map(x => ({
      valeur: x.code, texte: 'Place ' + x.code, icone: 'parc',
      detail: [x.nomRangee, x.type !== 'normale' ? nomType(x.type) : null]
        .filter(Boolean).join(' · ') || null
    }))
  });
  if (!choix) return;
  if (!act.garer(d.id, choix, d.motifParc)) {
    messageErreur('Cette place vient d’être prise.');
    return;
  }
  message(etiquetteVehicule(e, d) + ' garé en ' + choix, { ton: 'ok' });
  refaire();
}

/* ==========================================================================
   GLISSER-DÉPOSER — souris et doigt
   --------------------------------------------------------------------------
   Déplacer une voiture dans la cour, c'est un geste ; le logiciel fait le même.
   Au doigt, l'événement `drag` n'existe pas et le simple glissement sert déjà
   à faire défiler le plan : on exige donc un appui long avant de considérer
   qu'une place est « en main ».
   ========================================================================== */

function brancherGlisser(grille, e, refaire) {
  let emporte = null;
  let touche = null;
  let avaleClic = false;

  const nettoyer = () => grille.querySelectorAll('.place').forEach(n =>
    n.classList.remove('place--cible', 'place--emportee'));

  const viser = (noeud) => {
    grille.querySelectorAll('.place--cible').forEach(n => n.classList.remove('place--cible'));
    if (noeud) noeud.classList.add('place--cible');
  };

  const accepte = (noeud, depart) =>
    noeud && noeud.dataset.place && noeud.dataset.place !== depart && noeud.dataset.hs !== 'oui';

  /* --- souris ------------------------------------------------------------ */
  grille.addEventListener('dragstart', (ev) => {
    const prise = ev.target.closest('.place--prise');
    if (!prise) { ev.preventDefault(); return; }
    emporte = prise.dataset.place;
    prise.classList.add('place--emportee');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', emporte); } catch (err) {}
  });

  grille.addEventListener('dragend', () => { emporte = null; nettoyer(); });

  grille.addEventListener('dragover', (ev) => {
    if (!emporte) return;
    const sur = ev.target.closest('.place');
    if (!accepte(sur, emporte)) return;
    /* Sans ce preventDefault, le navigateur refuse le dépôt. */
    ev.preventDefault();
    viser(sur);
  });

  grille.addEventListener('dragleave', (ev) => {
    if (emporte && !grille.contains(ev.relatedTarget)) viser(null);
  });

  grille.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const sur = ev.target.closest('.place');
    const depart = emporte || (ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '');
    emporte = null;
    nettoyer();
    if (accepte(sur, depart)) deposer(e, depart, sur.dataset.place, refaire);
  });

  /* --- doigt ------------------------------------------------------------- */
  const lacher = () => {
    if (touche && touche.minuteur) clearTimeout(touche.minuteur);
    touche = null;
    nettoyer();
  };

  grille.addEventListener('touchstart', (ev) => {
    if (ev.touches.length > 1) { lacher(); return; }
    const dessus = ev.target.closest('.place--prise');
    if (!dessus) return;
    const t = ev.touches[0];
    touche = { code: dessus.dataset.place, x: t.clientX, y: t.clientY, prise: false };
    touche.minuteur = setTimeout(() => {
      touche.prise = true;
      dessus.classList.add('place--emportee');
      if (navigator.vibrate) navigator.vibrate(12);
    }, 320);
  }, { passive: true });

  grille.addEventListener('touchmove', (ev) => {
    if (!touche) return;
    const t = ev.touches[0];
    if (!touche.prise) {
      /* Le doigt bouge avant la fin de l'appui long : la personne fait défiler
         le plan, elle ne déménage pas une voiture. On lui laisse la main. */
      if (Math.abs(t.clientX - touche.x) > 8 || Math.abs(t.clientY - touche.y) > 8) lacher();
      return;
    }
    ev.preventDefault();
    const sous = document.elementFromPoint(t.clientX, t.clientY);
    const sur = sous ? sous.closest('.place') : null;
    viser(accepte(sur, touche.code) ? sur : null);
  }, { passive: false });

  grille.addEventListener('touchend', (ev) => {
    if (!touche) return;
    const enMain = touche.prise;
    const depart = touche.code;
    const cible = grille.querySelector('.place--cible');
    lacher();
    if (!enMain) return;
    /* Le relâchement d'un appui long produit encore un clic : sans ce
       garde-fou, la place déposée ouvrirait sa fiche dans la foulée. */
    ev.preventDefault();
    avaleClic = true;
    setTimeout(() => { avaleClic = false; }, 400);
    /* Le dépôt repeint l'écran, donc remplace ce plan-ci : on le laisse
       d'abord avaler le clic fantôme, sinon celui-ci atterrit sur le plan
       tout neuf, qui n'a plus de garde-fou. */
    if (cible) setTimeout(() => deposer(e, depart, cible.dataset.place, refaire), 0);
  });

  grille.addEventListener('touchcancel', lacher);

  grille.addEventListener('click', (ev) => {
    if (!avaleClic) return;
    avaleClic = false;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
}

async function deposer(e, depart, arrivee, refaire) {
  if (!depart || !arrivee || depart === arrivee) return;
  const prises = lit.occupation(e);
  const bouge = prises.get(depart);
  if (!bouge) return;

  const place = lit.places(e).find(x => x.code === arrivee);
  if (!place) return;
  const occupant = prises.get(arrivee);

  if (!occupant) {
    if (place.type === 'hs') { messageErreur('La place ' + arrivee + ' est inutilisable.'); return; }
    if (!act.garer(bouge.id, arrivee, bouge.motifParc)) {
      messageErreur('Déplacement refusé : la place n’est plus libre.');
      return;
    }
    message(etiquetteVehicule(e, bouge) + ' : ' + depart + ' → ' + arrivee, { ton: 'ok' });
    refaire();
    return;
  }

  const ok = await confirmer({
    titre: 'Échanger les deux places ?',
    texte: etiquetteVehicule(e, bouge) + ' prend la place ' + arrivee + ', et '
      + etiquetteVehicule(e, occupant) + ' prend la place ' + depart + '.',
    ok: 'Échanger'
  });
  if (!ok) return;
  echanger(bouge.id, occupant.id);
  message('Places échangées', { ton: 'ok' });
  refaire();
}

/* `act.garer` refuse une place déjà prise, et c'est heureux : deux voitures
   sur un même emplacement, ça n'existe pas. L'échange doit donc se faire d'un
   seul geste, les deux dossiers écrits ensemble. */
function echanger(idA, idB) {
  maj('Places échangées', (etat) => {
    const a = lit.dossier(etat, idA);
    const b = lit.dossier(etat, idB);
    if (!a || !b) return;
    const gardee = a.place;
    a.place = b.place;
    b.place = gardee;
    a.maj = Date.now();
    b.maj = a.maj;
  }, { cible: { type: 'dossiers', id: idA } });
}
