/* ==========================================================================
   YATECH — pièces d'interface communes
   --------------------------------------------------------------------------
   Messages, fenêtres, confirmations, menus. Tout ce qui se pose PAR-DESSUS
   l'écran courant, et qui doit se comporter pareil partout : la touche Échap
   ferme, le clavier ne s'échappe pas de la fenêtre ouverte, et sur téléphone
   une feuille se referme d'un glissement vers le bas.
   ========================================================================== */

import { h, poser, vider, q } from './dom.js';
import { icone } from './icones.js';

const calqueModales = () => document.getElementById('calque-modales');
const calqueMessages = () => document.getElementById('calque-messages');

/* ==========================================================================
   MESSAGES ÉPHÉMÈRES
   Ils confirment une action faite. Un message n'est jamais le seul endroit où
   l'information existe : ce qui compte est déjà écrit dans l'écran derrière.
   ========================================================================== */

const messagesVivants = [];

/**
 * @param {string} texte
 * @param {object} [opts] { ton:'ok'|'alerte'|'danger', duree, action:{texte,faire} }
 */
export function message(texte, opts) {
  const o = opts || {};
  const calque = calqueMessages();
  if (!calque) return () => {};

  const boite = h('div.message' + (o.ton ? '.message--' + o.ton : ''), [
    o.ton === 'danger' ? icone('alerte') : (o.ton === 'ok' ? icone('cocheRonde') : null),
    h('span.grandit', String(texte)),
    o.action ? h('button.message__action', {
      type: 'button',
      texte: o.action.texte,
      onclick: () => { fermer(); o.action.faire(); }
    }) : null
  ]);

  calque.appendChild(boite);
  messagesVivants.push(boite);

  /* Trois messages empilés, pas plus : au-delà on ne lit plus rien. */
  while (messagesVivants.length > 3) {
    const vieux = messagesVivants.shift();
    if (vieux && vieux.parentNode) vieux.remove();
  }

  let minuteur = null;
  function fermer() {
    if (!boite.parentNode) return;
    clearTimeout(minuteur);
    boite.classList.add('message--parti');
    setTimeout(() => boite.remove(), 220);
    const i = messagesVivants.indexOf(boite);
    if (i >= 0) messagesVivants.splice(i, 1);
  }

  /* Un message avec un bouton reste plus longtemps : il faut le temps de lire
     ET de décider. */
  const duree = o.duree === undefined ? (o.action ? 7000 : 3200) : o.duree;
  if (duree > 0) minuteur = setTimeout(fermer, duree);
  boite.addEventListener('click', (e) => { if (!e.target.closest('button')) fermer(); });

  return fermer;
}

export const messageOk = (t, o) => message(t, Object.assign({ ton: 'ok' }, o));
export const messageErreur = (t, o) => message(t, Object.assign({ ton: 'danger', duree: 5200 }, o));

/* ==========================================================================
   FENÊTRES
   ========================================================================== */

const ouvertes = [];

/**
 * Ouvre une fenêtre.
 * @param {object} o { titre, corps, actions, taille, surFermeture, sansCroix }
 *   `corps`   : un nœud, un tableau de nœuds, ou une fonction (api) => nœud
 *   `actions` : tableau de boutons du bas [{ texte, ton, faire, ferme }]
 * @returns {object} { fermer, noeud, corps }
 */
export function modale(o) {
  const opts = o || {};
  const calque = calqueModales();

  const corpsNoeud = h('div.modale__corps');
  const pied = h('div.modale__pied');
  const boite = h('div.modale' + (opts.taille ? '.modale--' + opts.taille : ''), {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.titre || 'Fenêtre'
  });
  const masque = h('div.masque', [boite]);

  const api = {
    noeud: boite,
    corps: corpsNoeud,
    fermer,
    /** Remplace le contenu sans rouvrir la fenêtre. */
    poser: (contenu) => poser(corpsNoeud, contenu),
    /** Active ou désactive le bouton principal. */
    verrouiller: (bloque) => {
      const b = pied.querySelector('.bt--fort');
      if (b) b.disabled = !!bloque;
    }
  };

  if (opts.titre || !opts.sansCroix) {
    boite.appendChild(h('div.modale__tete', [
      h('h2', opts.titre || ''),
      opts.sansCroix ? null : h('button.bt.bt--nu.bt--icone', {
        type: 'button', 'aria-label': 'Fermer', onclick: () => fermer(null)
      }, icone('croix'))
    ]));
  }

  boite.appendChild(corpsNoeud);
  poser(corpsNoeud, typeof opts.corps === 'function' ? opts.corps(api) : opts.corps);

  if (opts.actions && opts.actions.length) {
    for (const a of opts.actions) {
      if (!a) continue;
      pied.appendChild(h('button.bt' + (a.ton ? '.bt--' + a.ton : '.bt--contour'), {
        type: 'button',
        texte: a.texte,
        onclick: async () => {
          if (a.faire) {
            const r = await a.faire(api);
            if (r === false) return;         // l'action refuse la fermeture
          }
          if (a.ferme !== false) fermer(a.valeur === undefined ? true : a.valeur);
        }
      }));
    }
    boite.appendChild(pied);
  }

  let resoudre = null;
  const promesse = new Promise((r) => { resoudre = r; });

  function fermer(valeur) {
    if (!masque.parentNode) return;
    const i = ouvertes.indexOf(fiche);
    if (i >= 0) ouvertes.splice(i, 1);
    masque.remove();
    if (!ouvertes.length) document.body.style.overflow = '';
    if (opts.surFermeture) opts.surFermeture(valeur);
    if (rendreFocus && rendreFocus.isConnected) { try { rendreFocus.focus(); } catch (e) {} }
    resoudre(valeur);
  }

  /* Toucher à côté ferme, sauf si la fenêtre demande une réponse. */
  masque.addEventListener('mousedown', (e) => {
    if (e.target === masque && opts.collante !== true) fermer(null);
  });

  const fiche = { fermer, boite, opts };
  ouvertes.push(fiche);

  const rendreFocus = document.activeElement;
  document.body.style.overflow = 'hidden';
  calque.appendChild(masque);
  glisserPourFermer(boite, () => fermer(null));

  /* Le premier champ prend la main : sur ordinateur on tape tout de suite.
     Sur téléphone on s'abstient, sinon le clavier recouvre la fenêtre avant
     même qu'on ait lu la question. */
  const petitEcran = window.matchMedia('(max-width: 700px)').matches;
  requestAnimationFrame(() => {
    const premier = boite.querySelector('[autofocus]')
      || (petitEcran ? null : boite.querySelector('input:not([type=hidden]), select, textarea'))
      || boite.querySelector('.bt--fort')
      || boite;
    try { premier.focus({ preventScroll: true }); } catch (e) {}
  });

  api.promesse = promesse;
  return api;
}

/* Échap ferme la dernière fenêtre ouverte ; Tab reste prisonnier dedans. */
document.addEventListener('keydown', (e) => {
  if (!ouvertes.length) return;
  const derniere = ouvertes[ouvertes.length - 1];

  if (e.key === 'Escape') {
    e.preventDefault();
    derniere.fermer(null);
    return;
  }
  if (e.key !== 'Tab') return;

  const focusables = derniere.boite.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), ' +
    'select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const premier = focusables[0];
  const dernier = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
  else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
});

/** Sur téléphone, la feuille se tire vers le bas pour se fermer. */
function glisserPourFermer(boite, fermer) {
  if (!window.matchMedia('(max-width: 700px)').matches) return;
  const poignee = boite.querySelector('.modale__tete');
  if (!poignee) return;

  let depart = null, delta = 0;
  poignee.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    depart = e.touches[0].clientY;
    delta = 0;
    boite.style.transition = 'none';
  }, { passive: true });

  poignee.addEventListener('touchmove', (e) => {
    if (depart === null) return;
    delta = Math.max(0, e.touches[0].clientY - depart);
    boite.style.transform = 'translateY(' + delta + 'px)';
  }, { passive: true });

  const fin = () => {
    if (depart === null) return;
    boite.style.transition = '';
    /* Un tiers de la hauteur : en dessous, c'était un geste de défilement. */
    if (delta > boite.offsetHeight / 3) fermer();
    else boite.style.transform = '';
    depart = null;
  };
  poignee.addEventListener('touchend', fin);
  poignee.addEventListener('touchcancel', fin);
}

/* ==========================================================================
   CONFIRMATION
   Une seule règle : le bouton dit ce qui va se passer. Jamais « OK ».
   ========================================================================== */

export function confirmer(o) {
  const opts = typeof o === 'string' ? { texte: o } : (o || {});
  return new Promise((resoudre) => {
    modale({
      titre: opts.titre || 'Confirmer',
      taille: opts.taille,
      corps: [
        h('p', opts.texte || ''),
        opts.detail ? h('p.petit.faible', opts.detail) : null,
        opts.avertissement ? h('div.bandeau.bandeau--danger', [
          icone('alerte'), h('span', opts.avertissement)
        ]) : null
      ],
      actions: [
        { texte: opts.annuler || 'Annuler', ton: 'contour', valeur: false },
        {
          texte: opts.ok || 'Confirmer',
          ton: opts.danger ? 'danger' : 'fort',
          valeur: true
        }
      ],
      surFermeture: (v) => resoudre(v === true)
    });
  });
}

/** Demande une valeur en une ligne. Rend null si on annule. */
export function demander(o) {
  const opts = o || {};
  return new Promise((resoudre) => {
    let champ;
    const boite = modale({
      titre: opts.titre || 'Saisir',
      corps: h('div.champ', [
        opts.etiquette ? h('label', opts.etiquette) : null,
        champ = h(opts.lignes ? 'textarea.saisie' : 'input.saisie', {
          value: opts.valeur === undefined ? '' : opts.valeur,
          placeholder: opts.exemple || '',
          type: opts.type || 'text',
          autofocus: true,
          rows: opts.lignes || undefined,
          onkeydown: (e) => {
            if (e.key === 'Enter' && !opts.lignes) { e.preventDefault(); valider(); }
          }
        }),
        opts.aide ? h('div.champ__aide', opts.aide) : null
      ]),
      actions: [
        { texte: 'Annuler', ton: 'contour', valeur: null },
        { texte: opts.ok || 'Valider', ton: 'fort', faire: () => { valider(); return false; } }
      ],
      surFermeture: (v) => resoudre(v === null || v === undefined || v === false ? null : v)
    });
    function valider() {
      const v = String(champ.value || '').trim();
      if (opts.obligatoire && !v) { champ.setAttribute('aria-invalid', 'true'); champ.focus(); return; }
      boite.fermer(v);
    }
  });
}

/** Propose une liste de choix. Rend la valeur choisie, ou null. */
export function choisir(o) {
  const opts = o || {};
  return new Promise((resoudre) => {
    const boite = modale({
      titre: opts.titre || 'Choisir',
      corps: h('div.pile-s', (opts.options || []).map(op =>
        h('button.carte.rang', {
          type: 'button',
          onclick: () => boite.fermer(op.valeur)
        }, [
          op.icone ? icone(op.icone) : null,
          h('div.grandit', [
            h('div.gras', op.texte),
            op.detail ? h('div.petit.faible', op.detail) : null
          ])
        ])
      )),
      actions: [{ texte: 'Annuler', ton: 'contour', valeur: null }],
      surFermeture: (v) => resoudre(v === true || v === false || v === undefined ? null : v)
    });
  });
}

/* ==========================================================================
   MENU CONTEXTUEL
   ========================================================================== */

let menuOuvert = null;

/**
 * @param {Event|HTMLElement} ancre  d'où sort le menu
 * @param {Array} items  [{texte, icone, faire, danger}] — `null` fait un trait
 */
export function menu(ancre, items, opts) {
  fermerMenu();
  const o = opts || {};

  const boite = h('div.menu-flotte', { role: 'menu' });
  if (o.titre) boite.appendChild(h('div.menu-flotte__titre', o.titre));

  for (const it of items) {
    if (!it) { boite.appendChild(h('hr')); continue; }
    if (it.titre) { boite.appendChild(h('div.menu-flotte__titre', it.titre)); continue; }
    boite.appendChild(h('button' + (it.danger ? '.danger' : ''), {
      type: 'button',
      role: 'menuitem',
      onclick: () => { fermerMenu(); if (it.faire) it.faire(); }
    }, [
      it.icone ? icone(it.icone) : null,
      h('span.grandit', it.texte),
      it.raccourci ? h('kbd', it.raccourci) : null
    ]));
  }

  document.body.appendChild(boite);

  /* On place le menu là où il tient : sous l'ancre si possible, au-dessus
     sinon, et jamais en dehors de l'écran. */
  const cible = ancre instanceof Event
    ? (ancre.currentTarget || ancre.target)
    : ancre;
  const r = cible && cible.getBoundingClientRect
    ? cible.getBoundingClientRect()
    : { left: (ancre.clientX || 0), right: (ancre.clientX || 0), top: (ancre.clientY || 0), bottom: (ancre.clientY || 0), width: 0, height: 0 };

  const marge = 8;
  const largeur = boite.offsetWidth;
  const hauteur = boite.offsetHeight;
  let x = o.aligne === 'gauche' ? r.left : r.right - largeur;
  let y = r.bottom + 4;

  if (x + largeur > window.innerWidth - marge) x = window.innerWidth - largeur - marge;
  if (x < marge) x = marge;
  if (y + hauteur > window.innerHeight - marge) {
    y = r.top - hauteur - 4;
    if (y < marge) y = Math.max(marge, window.innerHeight - hauteur - marge);
  }
  boite.style.left = x + 'px';
  boite.style.top = y + 'px';

  menuOuvert = boite;
  /* On attend la fin du clic courant avant d'écouter : sinon le clic qui ouvre
     le menu le referme aussitôt. */
  setTimeout(() => {
    document.addEventListener('mousedown', surClicDehors, true);
    document.addEventListener('keydown', surEchap, true);
    window.addEventListener('scroll', fermerMenu, true);
    window.addEventListener('resize', fermerMenu);
  }, 0);
  return { fermer: fermerMenu };
}

function surClicDehors(e) {
  if (menuOuvert && !menuOuvert.contains(e.target)) fermerMenu();
}
function surEchap(e) {
  if (e.key === 'Escape') { e.stopPropagation(); fermerMenu(); }
}
export function fermerMenu() {
  if (!menuOuvert) return;
  menuOuvert.remove();
  menuOuvert = null;
  document.removeEventListener('mousedown', surClicDehors, true);
  document.removeEventListener('keydown', surEchap, true);
  window.removeEventListener('scroll', fermerMenu, true);
  window.removeEventListener('resize', fermerMenu);
}

/* ==========================================================================
   ÉTAT VIDE — le même partout, avec sa porte de sortie
   ========================================================================== */
export function vide(o) {
  const opts = o || {};
  return h('div.vide', [
    icone(opts.icone || 'boite', { taille: 40 }),
    h('h3', opts.titre || 'Rien ici'),
    opts.texte ? h('p', opts.texte) : null,
    opts.action ? h('button.bt.bt--fort', {
      type: 'button', onclick: opts.action.faire
    }, [icone('plus'), h('span', opts.action.texte)]) : null
  ]);
}

/* ==========================================================================
   BOUTON QUI TRAVAILLE — évite le double envoi
   ========================================================================== */
export function occupe(bouton, pendant) {
  if (!bouton || bouton.disabled) return Promise.resolve();
  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = '…';
  return Promise.resolve()
    .then(pendant)
    .finally(() => {
      if (!bouton.isConnected) return;
      bouton.disabled = false;
      bouton.textContent = texte;
    });
}
