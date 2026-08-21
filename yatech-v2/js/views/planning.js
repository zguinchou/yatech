/* ==========================================================================
   YATECH — écran « Planning »
   --------------------------------------------------------------------------
   Le planning du mur, celui que les trois personnes regardent en arrivant.
   Trois façons de le lire, la même matière derrière :
     • Jour    — une colonne par personne, l'heure à gauche. C'est là qu'on
                 pose, qu'on déplace, qu'on coche.
     • Semaine — une colonne par jour ouvré. Les créneaux qui se recouvrent
                 se rangent côte à côte et portent la tête de leur personne :
                 à 1400 px on lit la semaine d'un coup d'œil, et sur un
                 téléphone six colonnes défilent horizontalement sans qu'on
                 perde de vue de quel jour on parle. Subdiviser chaque jour en
                 trois sous-colonnes fixes donnerait des bandes de 70 px où
                 aucun libellé ne tient.
     • Liste   — ce qui vient, groupé par jour. Le format qu'on lit au
                 téléphone d'une main.

   Deux règles métier tenues ici :
   — un chevauchement PRÉVIENT mais ne bloque jamais : au garage, un essai
     routier pendant qu'un calculateur flashe, ça arrive tous les jours ;
   — une absence ne compte pas dans la charge (c'est `lit.chargeDuJour` qui
     s'en charge), et se distingue à l'œil du travail posé.
   ========================================================================== */

import { h, poser, apres } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, choisir } from '../core/ui.js';
import { maj } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import {
  jour0, lundi, plusJours, estAujourdhui, minutesEnHeure, heureEnMinutes,
  depuisIsoJour, nombre, borne, par, grouper, pluriel
} from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { TYPES_CRENEAU, nouveauCreneau } from '../domain/schema.js';
import { enTete, champ, tete, plaque, filtres, vide } from '../ui/widgets.js';

/* En dessous de cette largeur, une seule journée tient à l'écran : on ouvre
   sur la vue Jour plutôt que sur une semaine illisible. */
const TELEPHONE = '(max-width: 900px)';
const veille = window.matchMedia(TELEPHONE);

/* Une case de 30 minutes doit rester tapable au doigt : 46 px au téléphone,
   30 px à la souris où l'on préfère voir la journée entière sans défiler. */
const HAUTEUR_DOIGT = 46;
const HAUTEUR_SOURIS = 30;

/* Comment on regarde le planning n'est pas du travail : ça ne va pas dans
   l'état enregistré, mais ça survit d'une visite à l'autre. */
const pref = {
  vue: null,       // 'semaine' | 'jour' | 'liste' — décidé à la première visite
  jour: null,      // minuit du jour regardé
  qui: 'tous'      // 'tous' ou l'identifiant d'une personne
};

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  if (!pref.vue) pref.vue = veille.matches ? 'jour' : 'semaine';
  if (pref.jour === null) pref.jour = jour0();

  /* On peut arriver ici par un lien : #/planning?vue=jour&jour=2026-08-21,
     et l'alerte du tableau de bord pointe sur ?demandes=1. */
  if (ctx.query.vue && ['semaine', 'jour', 'liste'].includes(ctx.query.vue)) pref.vue = ctx.query.vue;
  const jourDemande = ctx.query.jour ? depuisIsoJour(ctx.query.jour) : null;
  if (jourDemande) pref.jour = jour0(jourDemande);

  const racine = h('div.pile');
  const zoneTete = h('div.pile-s');
  const zoneDemandes = h('div');
  const zoneVue = h('div');

  /* Premier affichage : on amène la grille sur l'heure qu'il est. Les
     repeintures suivantes (un créneau coché, un déplacement) ne doivent pas
     ramener la personne en haut sous ses doigts. */
  let premierRendu = true;

  const cadre = {
    e,
    moi: ctx.moi,
    forcerDemandes: !!ctx.query.demandes,
    refaire
  };

  function refaire() {
    mesurer(cadre);
    poser(zoneTete, barre(cadre));
    poser(zoneDemandes, panneauDemandes(cadre));
    poser(zoneVue, vueCourante(cadre, premierRendu));
    premierRendu = false;
  }

  poser(racine, [zoneTete, zoneDemandes, zoneVue]);
  refaire();
  return racine;
}

/** Recalcule tout ce qui dépend des réglages et de la largeur de l'écran. */
function mesurer(cadre) {
  const r = cadre.e.reglages || {};
  const debut = heureEnMinutes(r.heureDebut);
  const fin = heureEnMinutes(r.heureFin);

  cadre.r = r;
  cadre.minDebut = debut === null ? 8 * 60 : debut;
  cadre.minFin = fin === null || fin <= cadre.minDebut ? cadre.minDebut + 600 : fin;
  cadre.pas = borne(Math.round(nombre(r.pasPlanning, 30)) || 30, 5, 120);
  cadre.cases = Math.ceil((cadre.minFin - cadre.minDebut) / cadre.pas);
  cadre.hauteur = veille.matches ? HAUTEUR_DOIGT : HAUTEUR_SOURIS;
  cadre.px = cadre.hauteur / cadre.pas;          // pixels par minute
  cadre.pause = {
    debut: heureEnMinutes(r.pauseDebut),
    fin: heureEnMinutes(r.pauseFin)
  };

  const actifs = (cadre.e.utilisateurs || []).filter(u => u.actif);
  cadre.equipe = actifs;
  cadre.users = pref.qui === 'tous' ? actifs : actifs.filter(u => u.id === pref.qui);
}

/* ==========================================================================
   LA BARRE DU HAUT — la vue, la date, les flèches
   ========================================================================== */

function barre(cadre) {
  return [
    enTete({
      titre: 'Planning',
      sous: libelle(cadre),
      actions: [
        h('button.bt.bt--fort', {
          type: 'button',
          onclick: () => modaleCreneau(cadre, null, {})
        }, [icone('plus'), h('span', 'Créneau')])
      ]
    }),
    h('div.rang.enroule', [
      h('div.segments', [
        segment('Semaine', 'semaine', cadre),
        segment('Jour', 'jour', cadre),
        segment('Liste', 'liste', cadre)
      ]),
      pref.vue === 'liste' ? null : h('div.rang-s', [
        h('button.bt.bt--contour.bt--icone', {
          type: 'button', 'aria-label': 'Période précédente',
          onclick: () => { pref.jour = decaler(cadre, -1); cadre.refaire(); }
        }, icone('gauche')),
        h('button.bt.bt--contour', {
          type: 'button',
          onclick: () => { pref.jour = jour0(); cadre.refaire(); }
        }, 'Aujourd’hui'),
        h('button.bt.bt--contour.bt--icone', {
          type: 'button', 'aria-label': 'Période suivante',
          onclick: () => { pref.jour = decaler(cadre, 1); cadre.refaire(); }
        }, icone('droite'))
      ]),
      cadre.equipe.length > 1 ? h('div.pousse', filtres(
        [{ cle: 'tous', texte: 'Tout le monde' }].concat(
          cadre.equipe.map(u => ({ cle: u.id, texte: u.prenom || lit.nomUtilisateur(u) }))),
        pref.qui,
        (cle) => { pref.qui = cle; cadre.refaire(); }
      )) : null
    ])
  ];
}

function segment(texte, cle, cadre) {
  return h('button', {
    type: 'button',
    'aria-pressed': pref.vue === cle ? 'true' : 'false',
    onclick: () => { pref.vue = cle; cadre.refaire(); }
  }, texte);
}

/** La date regardée, écrite en toutes lettres. */
function libelle(cadre) {
  if (pref.vue === 'liste') return 'Tout ce qui vient';
  if (pref.vue === 'jour') return cap(fmt.date(pref.jour, 'complet'));
  const jours = joursDeLaSemaine(cadre);
  const premier = jours[0];
  const dernier = jours[jours.length - 1];
  /* « du 17 au 22 août » plutôt que « du 17 août au 22 août » : on ne répète
     le mois que si la semaine en chevauche deux. */
  const memeMois = new Date(premier).getMonth() === new Date(dernier).getMonth();
  return 'Semaine du ' + (memeMois ? String(new Date(premier).getDate()) : fmt.date(premier, 'jourMois'))
    + ' au ' + fmt.date(dernier, 'jourMois');
}

/** Une journée en vue Jour, une semaine en vue Semaine. En vue Jour on saute
 *  les jours fermés : personne ne veut faire défiler le dimanche. */
function decaler(cadre, sens) {
  if (pref.vue === 'semaine') return plusJours(pref.jour, 7 * sens);
  const ouvres = joursOuvres(cadre);
  let t = pref.jour;
  for (let i = 0; i < 7; i++) {
    t = plusJours(t, sens);
    if (ouvres.includes(new Date(t).getDay())) return t;
  }
  return plusJours(pref.jour, sens);
}

function joursOuvres(cadre) {
  const liste = (cadre.r.joursOuvres || []).map(Number).filter(n => n >= 0 && n <= 6);
  return liste.length ? liste : [0, 1, 2, 3, 4, 5, 6];
}

function joursDeLaSemaine(cadre) {
  const ouvres = joursOuvres(cadre);
  const debut = lundi(pref.jour);
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const t = plusJours(debut, i);
    if (ouvres.includes(new Date(t).getDay())) jours.push(t);
  }
  return jours.length ? jours : [debut];
}

/* La première lettre d'une date écrite en français est minuscule ; en tête
   d'écran on la relève. */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/* ==========================================================================
   LES DEMANDES DES CONFRÈRES
   Elles arrivent du portail professionnel et n'entrent pas au planning
   toutes seules : quelqu'un doit les prendre, et dire qui s'en occupe.
   ========================================================================== */

function panneauDemandes(cadre) {
  const e = cadre.e;
  const liste = lit.demandesEnAttente(e).slice().sort(par('debut'));
  if (!liste.length) {
    return cadre.forcerDemandes
      ? h('div.bandeau.bandeau--ok', [icone('cocheRonde'), h('span', 'Aucune demande en attente.')])
      : null;
  }

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('pro', { taille: 16 }),
      h('h2.grandit', 'Demandes de créneau'),
      h('span.compte.compte--accent', String(liste.length))
    ]),
    h('div.liste', liste.map(c => {
      const client = c.clientId ? lit.client(e, c.clientId) : null;
      const v = c.vehiculeId ? lit.vehicule(e, c.vehiculeId) : null;
      return h('div.liste__ligne.liste__ligne--muette', [
        h('div.grandit.coupe', [
          h('div.gras.coupe', c.titre || 'Demande'),
          h('div.petit.faible.coupe', [
            fmt.date(c.debut, 'jourMois') + ' à ' + fmt.heure(c.debut),
            fmt.duree(c.fin - c.debut),
            client ? lit.nomClient(client) : null,
            v ? v.immat : null
          ].filter(Boolean).join(' · ')),
          c.note ? h('div.minus.tres-faible.coupe-2', c.note) : null
        ]),
        h('div.rang-s', [
          h('button.bt.bt--ok.bt--s', {
            type: 'button',
            onclick: () => accepter(cadre, c)
          }, [icone('coche', { taille: 14 }), h('span', 'Accepter')]),
          h('button.bt.bt--nu.bt--icone.bt--s', {
            type: 'button', 'aria-label': 'Refuser cette demande',
            onclick: () => refuser(cadre, c)
          }, icone('croix'))
        ])
      ]);
    }))
  ]);
}

async function accepter(cadre, c) {
  const equipe = cadre.equipe;
  if (!equipe.length) { message('Aucune personne active à qui confier ce créneau.', { ton: 'alerte' }); return; }

  let userId = c.userId;
  if (equipe.length === 1) userId = equipe[0].id;
  else {
    userId = await choisir({
      titre: 'Qui prend ce créneau ?',
      options: equipe.map(u => ({
        valeur: u.id,
        texte: lit.nomUtilisateur(u),
        detail: fmt.heuresMO(lit.chargeDuJour(cadre.e, u.id, c.debut) / 60) + ' déjà posées ce jour-là'
      }))
    });
    if (!userId) return;
  }

  prevenirChevauchement(cadre.e, {
    id: c.id, userId, type: c.type, debut: c.debut, fin: c.fin
  });
  act.accepterDemande(c.id, userId);
  message('Créneau accepté', { ton: 'ok' });
  pref.jour = jour0(c.debut);
  cadre.refaire();
}

async function refuser(cadre, c) {
  const ok = await confirmer({
    titre: 'Refuser cette demande ?',
    texte: (c.titre || 'Demande') + ' — ' + fmt.dateHeure(c.debut) + '. Elle sera effacée.',
    ok: 'Refuser', danger: true
  });
  if (!ok) return;
  maj('Demande de créneau refusée', (etat) => {
    const i = (etat.creneaux || []).findIndex(x => x.id === c.id);
    if (i >= 0) etat.creneaux.splice(i, 1);
  });
  cadre.refaire();
}

/* ==========================================================================
   AIGUILLAGE DES VUES
   ========================================================================== */

function vueCourante(cadre, amener) {
  if (!cadre.equipe.length) {
    return vide({
      icone: 'clients',
      titre: 'Personne à planifier',
      texte: 'Le planning se remplit par personne. Activez au moins quelqu’un dans les réglages.'
    });
  }
  if (pref.vue === 'liste') return vueListe(cadre);
  if (pref.vue === 'jour') return vueJour(cadre, amener);
  return vueSemaine(cadre, amener);
}

/* ==========================================================================
   LA GRILLE — partagée par la vue Jour et la vue Semaine
   ========================================================================== */

/** La colonne des heures, collante à gauche. */
function colonneHeures(cadre) {
  const col = h('div.planning__heures');
  for (let i = 0; i < cadre.cases; i++) {
    const min = cadre.minDebut + i * cadre.pas;
    /* Sous 30 minutes de pas, écrire chaque case rend la colonne illisible :
       on ne garde que les heures pleines. */
    const ecrire = cadre.pas >= 30 || min % 60 === 0;
    col.appendChild(h('div.planning__heure', ecrire ? minutesEnHeure(min) : ''));
  }
  return col;
}

/** Une colonne de la grille : les cases vides, puis les créneaux par-dessus.
 *  `jourDebut` est minuit du jour que la colonne montre ; `userId` n'est posé
 *  que dans la vue Jour, où déposer un créneau change aussi de personne. */
function colonne(cadre, creneaux, jourDebut, userId, avecPersonne) {
  const col = h('div.planning__colonne', {
    donnees: { jour: String(jourDebut), user: userId || '' },
    style: { minHeight: (cadre.cases * cadre.hauteur) + 'px' }
  });

  const dimanche = new Date(jourDebut).getDay() === 0;
  if (dimanche) col.classList.add('planning__colonne--week-end');

  for (let i = 0; i < cadre.cases; i++) {
    const min = cadre.minDebut + i * cadre.pas;
    const enPause = cadre.pause.debut !== null && cadre.pause.fin !== null
      && min >= cadre.pause.debut && min < cadre.pause.fin;
    col.appendChild(h('button.creneau-vide', {
      type: 'button',
      /* Une journée fait vingt cases par personne : les laisser toutes dans
         l'ordre de tabulation noierait le clavier. Le bouton « Créneau » de
         l'en-tête ouvre la même fenêtre. */
      tabindex: '-1',
      'aria-label': 'Poser un créneau à ' + minutesEnHeure(min),
      style: {
        top: (i * cadre.hauteur) + 'px',
        height: cadre.hauteur + 'px',
        background: enPause ? 'var(--voile)' : null
      },
      onclick: () => modaleCreneau(cadre, null, {
        debut: jourDebut + min * 60000,
        userId: userId || null
      })
    }));
  }

  const { rang, large } = couloirs(creneaux);
  for (const c of creneaux) {
    const geo = geometrie(cadre, c, jourDebut);
    if (!geo.visible) continue;
    const n = large.get(c.id) || 1;
    const i = rang.get(c.id) || 0;
    col.appendChild(carteCreneau(cadre, c, {
      haut: geo.haut,
      hauteur: geo.hauteur,
      gauche: 'calc(' + (100 / n * i) + '% + 3px)',
      largeur: 'calc(' + (100 / n) + '% - 6px)'
    }, avecPersonne));
  }

  return col;
}

/** Où se pose un créneau dans une colonne, en pixels. Un créneau qui déborde
 *  des heures d'ouverture est rogné plutôt que jeté : on doit le voir. */
function geometrie(cadre, c, jourDebut) {
  const brutDebut = (c.debut - jourDebut) / 60000;
  const brutFin = (c.fin - jourDebut) / 60000;
  const deb = Math.max(cadre.minDebut, brutDebut);
  const fin = Math.min(cadre.minFin, brutFin);
  return {
    visible: brutFin > cadre.minDebut && brutDebut < cadre.minFin,
    haut: (deb - cadre.minDebut) * cadre.px,
    hauteur: Math.max(18, (fin - deb) * cadre.px)
  };
}

/** Range côte à côte les créneaux qui se recouvrent. On raisonne par grappes :
 *  deux rendez-vous superposés le matin ne doivent pas rétrécir de moitié
 *  l'après-midi, qui est libre. */
function couloirs(liste) {
  const rang = new Map();     // créneau -> n° de couloir
  const large = new Map();    // créneau -> nombre de couloirs de sa grappe
  const tries = liste.slice().sort(par('debut'));
  const fins = [];            // fin du dernier créneau de chaque couloir
  let grappe = [];
  let finGrappe = -Infinity;

  const fermer = () => {
    const n = Math.max(1, fins.length);
    grappe.forEach(c => large.set(c.id, n));
    grappe = [];
    fins.length = 0;
    finGrappe = -Infinity;
  };

  for (const c of tries) {
    if (c.debut >= finGrappe) fermer();
    let i = 0;
    while (i < fins.length && fins[i] > c.debut) i++;
    fins[i] = c.fin;
    rang.set(c.id, i);
    grappe.push(c);
    finGrappe = Math.max(finGrappe, c.fin);
  }
  fermer();
  return { rang, large };
}

/** La couleur d'un créneau : son type d'abord, la nature du dossier ensuite.
 *  Un « travaux » sur un dossier électronique doit se lire comme électronique. */
function classeCreneau(e, c) {
  let cl = '.rdv';
  if (c.type === 'absence') cl += '.rdv--absence';
  else {
    const d = c.dossierId ? lit.dossier(e, c.dossierId) : null;
    const nature = c.type === 'electro' ? 'electro' : (d ? d.nature : null);
    if (nature === 'electro') cl += '.rdv--electro';
    else if (nature === 'meca') cl += '.rdv--meca';
  }
  if (c.fait) cl += '.rdv--fait';
  return cl;
}

function titreCreneau(e, c) {
  if (String(c.titre || '').trim()) return c.titre;
  const d = c.dossierId ? lit.dossier(e, c.dossierId) : null;
  if (d) return lit.titreDossier(e, d);
  const t = TYPES_CRENEAU[c.type];
  return t ? t.nom : 'Créneau';
}

function vehiculeDe(e, c) {
  if (c.vehiculeId) return lit.vehicule(e, c.vehiculeId);
  const d = c.dossierId ? lit.dossier(e, c.dossierId) : null;
  return d ? lit.vehicule(e, d.vehiculeId) : null;
}

function carteCreneau(cadre, c, geo, avecPersonne) {
  const e = cadre.e;
  const u = c.userId ? lit.utilisateur(e, c.userId) : null;
  const v = vehiculeDe(e, c);
  const t = TYPES_CRENEAU[c.type];

  /* En vue Semaine la colonne dit déjà le jour mais pas qui travaille : on
     écrit le prénom à la place de la plaque, qui ne tiendrait pas de toute
     façon dans une colonne de jour. */
  const seconde = [
    fmt.heure(c.debut),
    avecPersonne ? (u ? (u.prenom || lit.nomUtilisateur(u)) : null) : (v ? v.immat : null)
  ].filter(Boolean).join(' · ');

  return h('button' + classeCreneau(e, c), {
    type: 'button',
    draggable: true,
    donnees: { creneau: c.id },
    title: [
      titreCreneau(e, c),
      fmt.heure(c.debut) + ' – ' + fmt.heure(c.fin) + ' (' + fmt.duree(c.fin - c.debut) + ')',
      u ? lit.nomUtilisateur(u) : null,
      t ? t.nom : null,
      v ? lit.nomVehiculeLong(v) + ' — ' + v.immat : null,
      c.note || null
    ].filter(Boolean).join('\n'),
    style: {
      top: geo.haut + 'px',
      height: geo.hauteur + 'px',
      left: geo.gauche,
      right: 'auto',
      width: geo.largeur,
      /* Un bouton n'hérite pas de la police du document : sans ça, le planning
         s'écrit dans la police du système et jure avec le reste. */
      fontFamily: 'inherit'
    },
    onclick: () => modaleCreneau(cadre, c, {})
  }, [
    h('b.coupe', titreCreneau(e, c)),
    h('div.minus.coupe', seconde)
  ]);
}

/* ==========================================================================
   VUE JOUR
   ========================================================================== */

function vueJour(cadre, amener) {
  const e = cadre.e;
  const jourDebut = pref.jour;

  const grille = h('div.planning__grille', {
    style: {
      '--colonnes': String(cadre.users.length),
      '--h-creneau': cadre.hauteur + 'px'
    }
  });

  grille.appendChild(h('div.planning__coin', h('span.minus.tres-faible', 'h')));
  for (const u of cadre.users) {
    const charge = lit.chargeDuJour(e, u.id, jourDebut);
    grille.appendChild(h('div.planning__qui', [
      tete(u, 's'),
      h('span.coupe', u.prenom || lit.nomUtilisateur(u)),
      h('span.minus.tres-faible', charge ? fmt.heuresMO(charge / 60) : '—')
    ]));
  }

  grille.appendChild(colonneHeures(cadre));
  for (const u of cadre.users) {
    const siens = lit.creneauxDuJour(e, jourDebut, u.id).filter(c => !c.demande);
    grille.appendChild(colonne(cadre, siens, jourDebut, u.id, false));
  }

  if (estAujourdhui(jourDebut)) traitMaintenant(cadre, grille, -1);
  brancherGlisser(cadre, grille);
  if (amener) amenerSurLHeure(cadre, grille);

  return h('div.planning', grille);
}

/* ==========================================================================
   VUE SEMAINE
   ========================================================================== */

function vueSemaine(cadre, amener) {
  const e = cadre.e;
  const jours = joursDeLaSemaine(cadre);
  const semaine = lit.creneauxDeLaSemaine(e, pref.jour)
    .filter(c => !c.demande && (pref.qui === 'tous' || c.userId === pref.qui));

  const grille = h('div.planning__grille', {
    style: {
      '--colonnes': String(jours.length),
      '--h-creneau': cadre.hauteur + 'px'
    }
  });

  grille.appendChild(h('div.planning__coin', h('span.minus.tres-faible', 'h')));
  for (const t of jours) {
    const charge = cadre.users.reduce((somme, u) => somme + lit.chargeDuJour(e, u.id, t), 0);
    const auj = estAujourdhui(t);
    grille.appendChild(h('div.planning__qui', h('button.jour-onglet' + (auj ? '.jour-onglet--auj' : ''), {
      type: 'button',
      'aria-pressed': 'false',
      title: 'Ouvrir cette journée en détail',
      onclick: () => { pref.jour = t; pref.vue = 'jour'; cadre.refaire(); }
    }, [
      h('small', fmt.nomJour(t)),
      h('b', String(new Date(t).getDate())),
      h('span.minus.tres-faible', charge ? fmt.heuresMO(charge / 60) : '—')
    ])));
  }

  grille.appendChild(colonneHeures(cadre));
  for (const t of jours) {
    const fin = plusJours(t, 1);
    const duJour = semaine.filter(c => c.debut < fin && c.fin > t).sort(par('debut'));
    grille.appendChild(colonne(cadre, duJour, t, null, true));
  }

  const aujourdhui = jours.findIndex(t => estAujourdhui(t));
  if (aujourdhui >= 0) traitMaintenant(cadre, grille, aujourdhui);
  brancherGlisser(cadre, grille);
  if (amener) amenerSurLHeure(cadre, grille);

  return h('div.planning', grille);
}

/* ==========================================================================
   LE TRAIT DE L'HEURE COURANTE
   ========================================================================== */

/** `colonneVisee` : l'index de la colonne à barrer, ou -1 pour toute la
 *  largeur. En vue Semaine, un trait qui traverserait les six jours dirait
 *  qu'il est la même heure lundi et samedi. */
function traitMaintenant(cadre, grille, colonneVisee) {
  const d = new Date();
  const min = d.getHours() * 60 + d.getMinutes();
  if (min < cadre.minDebut || min > cadre.minFin) return;

  const trait = h('div.trait-maintenant', {
    title: 'Il est ' + minutesEnHeure(min),
    style: { left: '56px' }
  });
  grille.appendChild(trait);

  /* Le trait se pose en absolu dans la grille, sous la ligne d'en-têtes, dont
     la hauteur dépend du texte : on la mesure une fois le navigateur passé
     plutôt que de la deviner. */
  apres(() => {
    const colonnes = grille.querySelectorAll('.planning__colonne');
    const reference = colonnes[Math.max(0, colonneVisee === undefined ? 0 : colonneVisee)];
    if (!reference) return;
    trait.style.top = (reference.offsetTop + (min - cadre.minDebut) * cadre.px) + 'px';
    if (colonneVisee >= 0) {
      trait.style.left = reference.offsetLeft + 'px';
      trait.style.right = 'auto';
      trait.style.width = reference.offsetWidth + 'px';
    }
  });
}

/** À l'ouverture, la grille se cale une heure avant maintenant : on arrive
 *  sur ce qui se passe, pas sur l'ouverture du garage. */
function amenerSurLHeure(cadre, grille) {
  if (!estAujourdhui(pref.jour)) return;
  const d = new Date();
  const min = d.getHours() * 60 + d.getMinutes();
  apres(() => {
    grille.scrollTop = Math.max(0, (min - 60 - cadre.minDebut) * cadre.px);
  });
}

/* ==========================================================================
   GLISSER-DÉPOSER — souris et doigt
   ========================================================================== */

function brancherGlisser(cadre, grille) {
  let emporte = null;     // { id, prise } — prise : où le curseur a saisi la carte
  let touche = null;
  let avaleClic = false;

  const relacher = () => {
    grille.querySelectorAll('.rdv').forEach(n => {
      n.style.opacity = '';
      n.style.transform = '';
      n.style.pointerEvents = '';
    });
    emporte = null;
  };

  /** Pose le créneau à l'endroit visé, aimanté au pas du planning. */
  const deposer = (id, prise, colonneCible, clientY) => {
    if (!id || !colonneCible) return;
    const c = (cadre.e.creneaux || []).find(x => x.id === id);
    if (!c) return;

    const rect = colonneCible.getBoundingClientRect();
    const brut = cadre.minDebut + (clientY - rect.top - prise) / cadre.px;
    const cases = Math.round((brut - cadre.minDebut) / cadre.pas);
    const min = borne(
      cadre.minDebut + cases * cadre.pas,
      cadre.minDebut,
      Math.max(cadre.minDebut, cadre.minFin - cadre.pas)
    );

    const jour = Number(colonneCible.dataset.jour);
    if (!isFinite(jour)) return;
    const debut = jour + min * 60000;
    const versUser = colonneCible.dataset.user || null;
    if (debut === c.debut && (!versUser || versUser === c.userId)) return;

    prevenirChevauchement(cadre.e, {
      id: c.id,
      userId: versUser || c.userId,
      type: c.type,
      debut,
      fin: debut + (c.fin - c.debut)
    });
    act.deplacerCreneau(c.id, debut, versUser);
    cadre.refaire();
  };

  /* --- souris ------------------------------------------------------------ */
  grille.addEventListener('dragstart', (ev) => {
    const carte = ev.target.closest('.rdv');
    if (!carte || !carte.dataset.creneau) { ev.preventDefault(); return; }
    emporte = { id: carte.dataset.creneau, prise: ev.clientY - carte.getBoundingClientRect().top };
    carte.style.opacity = '.45';
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', emporte.id); } catch (err) {}
    }
  });

  grille.addEventListener('dragend', relacher);

  grille.addEventListener('dragover', (ev) => {
    if (!emporte) return;
    /* Sans ce refus du comportement par défaut, le navigateur n'accepte aucun
       dépôt : c'est le piège classique du glisser-déposer. */
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  });

  grille.addEventListener('drop', (ev) => {
    if (!emporte) return;
    ev.preventDefault();
    const cible = ev.target.closest('.planning__colonne');
    const { id, prise } = emporte;
    const y = ev.clientY;
    relacher();
    deposer(id, prise, cible, y);
  });

  /* --- doigt --------------------------------------------------------------
     Un appui long saisit la carte ; un simple glissement fait défiler la
     grille, ce qui est le geste le plus fréquent sur un téléphone. */
  const lacherTouche = () => {
    if (touche && touche.minuteur) clearTimeout(touche.minuteur);
    touche = null;
    relacher();
  };

  grille.addEventListener('touchstart', (ev) => {
    if (ev.touches.length > 1) { lacherTouche(); return; }
    const carte = ev.target.closest('.rdv');
    if (!carte || !carte.dataset.creneau) return;
    const t = ev.touches[0];
    touche = {
      id: carte.dataset.creneau,
      carte,
      x: t.clientX,
      y: t.clientY,
      prise: t.clientY - carte.getBoundingClientRect().top,
      pris: false
    };
    /* On retient CE geste-ci : si un autre doigt arrive entre-temps, le
       minuteur du premier ne doit pas saisir la carte du second. */
    const geste = touche;
    touche.minuteur = setTimeout(() => {
      if (touche !== geste) return;
      touche.pris = true;
      carte.style.opacity = '.6';
      /* La carte suit le doigt : sans la rendre transparente aux événements,
         c'est elle qu'on retrouve sous le doigt au moment de lâcher, et non
         la colonne visée. */
      carte.style.pointerEvents = 'none';
      if (navigator.vibrate) navigator.vibrate(12);
    }, 320);
  }, { passive: true });

  grille.addEventListener('touchmove', (ev) => {
    if (!touche) return;
    const t = ev.touches[0];
    if (!touche.pris) {
      if (Math.abs(t.clientX - touche.x) > 8 || Math.abs(t.clientY - touche.y) > 8) lacherTouche();
      return;
    }
    ev.preventDefault();
    touche.carte.style.transform =
      'translate(' + (t.clientX - touche.x) + 'px,' + (t.clientY - touche.y) + 'px)';
  }, { passive: false });

  grille.addEventListener('touchend', (ev) => {
    if (!touche) return;
    const { id, prise, pris } = touche;
    const t = ev.changedTouches[0];
    lacherTouche();
    if (!pris) return;
    /* Le relâchement d'un appui long produit encore un clic : sans ce
       garde-fou, le créneau déposé ouvrirait sa fenêtre dans la foulée. */
    ev.preventDefault();
    avaleClic = true;
    setTimeout(() => { avaleClic = false; }, 400);
    const sous = document.elementFromPoint(t.clientX, t.clientY);
    deposer(id, prise, sous ? sous.closest('.planning__colonne') : null, t.clientY);
  });

  grille.addEventListener('touchcancel', lacherTouche);

  grille.addEventListener('click', (ev) => {
    if (!avaleClic) return;
    avaleClic = false;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
}

/* ==========================================================================
   VUE LISTE
   ========================================================================== */

function vueListe(cadre) {
  const e = cadre.e;
  const maintenant = Date.now();
  const aVenir = (e.creneaux || [])
    .filter(c => !c.demande && c.fin >= maintenant
      && (pref.qui === 'tous' || c.userId === pref.qui))
    .sort(par('debut'));

  if (!aVenir.length) {
    return vide({
      icone: 'planning',
      titre: 'Rien de prévu',
      texte: 'Aucun créneau à venir. Posez-en un, ou revenez à la vue Semaine.',
      action: { texte: 'Poser un créneau', faire: () => modaleCreneau(cadre, null, {}) }
    });
  }

  const jours = grouper(aVenir, c => jour0(c.debut));
  const blocs = [];
  jours.forEach((liste, quand) => {
    blocs.push(h('div.panneau', [
      h('div.panneau__tete', [
        icone('planning', { taille: 16 }),
        h('h2.grandit', cap(fmt.date(quand, 'complet'))),
        h('span.petit.faible', fmt.quand(quand, { avecHeure: false })),
        h('span.compte', String(liste.length))
      ]),
      h('div.liste', liste.map(c => ligneListe(cadre, c)))
    ]));
  });

  return h('div.pile', blocs);
}

function ligneListe(cadre, c) {
  const e = cadre.e;
  const u = c.userId ? lit.utilisateur(e, c.userId) : null;
  const v = vehiculeDe(e, c);
  const t = TYPES_CRENEAU[c.type];

  return h('div.liste__ligne', {
    role: 'button',
    tabindex: 0,
    onclick: () => modaleCreneau(cadre, c, {}),
    onkeydown: (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      modaleCreneau(cadre, c, {});
    }
  }, [
    h('div', { style: { minWidth: '52px' } }, [
      h('div.gras.num', fmt.heure(c.debut)),
      h('div.minus.tres-faible', fmt.duree(c.fin - c.debut))
    ]),
    tete(u, 's'),
    h('div.grandit.coupe', {
      style: c.fait ? { opacity: '.55' } : null
    }, [
      h('div.coupe', titreCreneau(e, c)),
      h('div.petit.faible.coupe', [
        u ? lit.nomUtilisateur(u) : 'Personne',
        v ? lit.nomVehicule(v) : null
      ].filter(Boolean).join(' · '))
    ]),
    v ? plaque(v.immat) : null,
    c.type === 'absence'
      ? h('span.pastille.pastille--sans-point', t ? t.nom : 'Absence')
      : null,
    c.fait ? h('span.pastille.pastille--ok.pastille--sans-point', 'fait') : null
  ]);
}

/* ==========================================================================
   LA FENÊTRE D'UN CRÉNEAU — création et modification
   ========================================================================== */

function modaleCreneau(cadre, creneau, defauts) {
  const e = cadre.e;
  const d = defauts || {};
  const c = creneau || null;

  const debut = c ? c.debut : (d.debut || prochaineCase(cadre));
  const dureeMin = c
    ? Math.max(5, Math.round((c.fin - c.debut) / 60000))
    : borne(Math.round(nombre(cadre.r.dureeDefaut, 60)) || 60, 5, 24 * 60);

  const chTitre = champ({
    etiquette: 'Quoi ?', autofocus: true,
    valeur: c ? c.titre : '',
    exemple: 'Vidange, diagnostic, essai routier…'
  });

  const chQui = champ({
    etiquette: 'Pour qui', type: 'liste', options: optionsPersonnes(cadre, c),
    valeur: (c && c.userId) || d.userId || (cadre.moi ? cadre.moi.id : '')
  });

  const chType = champ({
    etiquette: 'Type', type: 'liste',
    options: Object.keys(TYPES_CRENEAU).map(k => ({ valeur: k, texte: TYPES_CRENEAU[k].nom })),
    valeur: c ? c.type : 'travaux'
  });

  const chDossier = champ({
    etiquette: 'Dossier lié', type: 'liste', options: optionsDossiers(e, c),
    valeur: (c && c.dossierId) || d.dossierId || ''
  });

  const chJour = champ({ etiquette: 'Jour', type: 'date', valeur: debut });
  const chHeure = champ({
    etiquette: 'Début', type: 'heure',
    valeur: new Date(debut).getHours() * 60 + new Date(debut).getMinutes()
  });
  const chDuree = champ({
    etiquette: 'Durée', type: 'nombre', unite: 'min', valeur: dureeMin,
    aide: 'Le planning avance par ' + cadre.pas + ' min'
  });

  const chFait = champ({ type: 'coche', etiquette: 'Fait', valeur: !!(c && c.fait) });
  const chNote = champ({
    etiquette: 'Note', type: 'zone', lignes: 2, valeur: c ? c.note : '',
    exemple: 'Ce qu’il faut savoir avant de commencer'
  });

  const actions = [{ texte: 'Annuler', ton: 'contour' }];

  if (c) {
    actions.push({
      texte: 'Supprimer', ton: 'danger',
      faire: async () => {
        const ok = await confirmer({
          titre: 'Supprimer ce créneau ?',
          texte: titreCreneau(e, c) + ' — ' + fmt.dateHeure(c.debut),
          ok: 'Supprimer', danger: true
        });
        if (!ok) return false;
        maj('Créneau supprimé', (etat) => {
          const i = (etat.creneaux || []).findIndex(x => x.id === c.id);
          if (i >= 0) etat.creneaux.splice(i, 1);
        });
        cadre.refaire();
      }
    });
  }

  actions.push({
    texte: c ? 'Enregistrer' : 'Poser', ton: 'fort',
    faire: () => {
      const jour = chJour.lire();
      if (!jour) { chJour.erreur('Choisissez un jour.'); return false; }
      const min = chHeure.lire();
      if (min === null) { chHeure.erreur('Une heure, comme 08:30.'); return false; }
      const qui = chQui.lire();
      if (!qui) { chQui.erreur('Un créneau appartient à quelqu’un.'); return false; }

      const duree = borne(Math.round(nombre(chDuree.lire(), cadre.pas)) || cadre.pas, 5, 24 * 60);
      const debutVoulu = jour0(jour) + min * 60000;
      const dossierId = chDossier.lire() || null;
      const dossier = dossierId ? lit.dossier(e, dossierId) : null;

      const champs = {
        titre: chTitre.lire(),
        userId: qui,
        type: chType.lire(),
        dossierId,
        /* Le client et le véhicule suivent le dossier : la vue Liste et le
           portail confrère les lisent sans repasser par le dossier. */
        clientId: dossier ? dossier.clientId : (c ? c.clientId : null),
        vehiculeId: dossier ? dossier.vehiculeId : (c ? c.vehiculeId : null),
        debut: debutVoulu,
        fin: debutVoulu + duree * 60000,
        fait: chFait.lire(),
        note: chNote.lire()
      };

      prevenirChevauchement(e, Object.assign({ id: c ? c.id : '' }, champs));

      if (c) {
        maj('Créneau modifié', (etat) => {
          const x = (etat.creneaux || []).find(y => y.id === c.id);
          if (x) Object.assign(x, champs);
        });
      } else {
        act.poserCreneau(nouveauCreneau(champs));
        message('Créneau posé', { ton: 'ok' });
      }

      pref.jour = jour0(debutVoulu);
      cadre.refaire();
    }
  });

  modale({
    titre: c ? 'Le créneau' : 'Nouveau créneau',
    taille: 'large',
    corps: h('div.pile', [
      chTitre.noeud,
      h('div.paires', [chQui.noeud, chType.noeud]),
      chDossier.noeud,
      h('div.paires', [chJour.noeud, chHeure.noeud, chDuree.noeud]),
      chNote.noeud,
      chFait.noeud
    ]),
    actions
  });
}

/** La prochaine case du planning à partir de maintenant : ce qu'on veut neuf
 *  fois sur dix quand on ouvre la fenêtre depuis le bouton de l'en-tête. */
function prochaineCase(cadre) {
  const base = estAujourdhui(pref.jour) ? Date.now() : pref.jour + cadre.minDebut * 60000;
  const d = new Date(base);
  const min = d.getHours() * 60 + d.getMinutes();
  const cases = Math.ceil((min - cadre.minDebut) / cadre.pas);
  const cale = borne(
    cadre.minDebut + Math.max(0, cases) * cadre.pas,
    cadre.minDebut,
    Math.max(cadre.minDebut, cadre.minFin - cadre.pas)
  );
  return jour0(base) + cale * 60000;
}

/** Les personnes proposées : l'équipe active, plus celle déjà inscrite sur le
 *  créneau même si elle a quitté le garage — sinon l'enregistrer la remplace
 *  en douce par quelqu'un d'autre. */
function optionsPersonnes(cadre, c) {
  const options = cadre.equipe.map(u => ({ valeur: u.id, texte: lit.nomUtilisateur(u) }));
  if (c && c.userId && !options.some(o => o.valeur === c.userId)) {
    const u = lit.utilisateur(cadre.e, c.userId);
    options.unshift({ valeur: c.userId, texte: lit.nomUtilisateur(u) + ' (inactif)' });
  }
  return options;
}

function optionsDossiers(e, c) {
  const options = [{ valeur: '', texte: 'Aucun' }];
  const ouverts = lit.dossiersOuverts(e).sort(lit.triDossiers);
  for (const d of ouverts) {
    const v = lit.vehicule(e, d.vehiculeId);
    options.push({
      valeur: d.id,
      texte: [d.numero, lit.titreDossier(e, d), v ? v.immat : null].filter(Boolean).join(' — ')
    });
  }
  /* Un créneau posé sur un dossier depuis refermé garde son lien : on l'ajoute
     à la liste plutôt que de le perdre au premier enregistrement. */
  if (c && c.dossierId && !options.some(o => o.valeur === c.dossierId)) {
    const d = lit.dossier(e, c.dossierId);
    if (d) options.push({ valeur: d.id, texte: lit.titreDossier(e, d) + ' (clos)' });
  }
  return options;
}

/* ==========================================================================
   LES CHEVAUCHEMENTS
   On prévient, on ne bloque pas : deux choses en parallèle, ça se décide au
   comptoir, pas dans le logiciel.
   ========================================================================== */

function prevenirChevauchement(e, provisoire) {
  if (!provisoire.userId) return;
  const autres = lit.chevauchements(e, provisoire).filter(x => !x.demande);
  if (!autres.length) return;
  const u = lit.utilisateur(e, provisoire.userId);
  message(
    'Attention : chevauche ' + pluriel(autres.length, 'autre créneau', 'autres créneaux')
      + ' de ' + lit.nomUtilisateur(u) + '. Gardé quand même.',
    { ton: 'alerte', duree: 5200 }
  );
}
