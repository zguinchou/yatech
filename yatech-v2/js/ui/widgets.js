/* ==========================================================================
   YATECH — briques d'écran
   --------------------------------------------------------------------------
   Ce que tous les écrans partagent : un champ de formulaire, une pastille
   d'état, une carte de dossier, un sélecteur de client. Écrites ici, elles ont
   la même tête partout — et corriger un défaut le corrige dans tout l'outil.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { menu, message } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import {
  nombre, plaqueJolie, plaqueNue, telJoli, telNu, initiales, attend, isoJour,
  depuisIsoJour, minutesEnHeure, heureEnMinutes, score
} from '../core/util.js';
import { ETAPES, NATURES, PRIORITES, STATUTS_DEVIS, STATUTS_FACTURE } from '../domain/schema.js';
import * as lit from '../domain/selecteurs.js';

/* ==========================================================================
   EN-TÊTE D'ÉCRAN
   ========================================================================== */

/**
 * @param {object} o { titre, sous, actions:[noeuds], retour:'/chemin' }
 */
export function enTete(o) {
  const opts = o || {};
  /* `compacte` : quand l'action tient dans une icône, le titre et elle
     restent sur la même ligne, même sur téléphone. Empiler un bouton pleine
     largeur sous un « Bonsoir, Yanis » coûte un tiers d'écran pour rien. */
  return h('div.tete-ecran' + (opts.compacte ? '.tete-ecran--compacte' : ''), [
    opts.retour ? h('a.bt.bt--nu.bt--icone', {
      href: '#' + opts.retour, 'aria-label': 'Retour'
    }, icone('retour')) : null,
    h('div.grandit', [
      h('h1', opts.titre || ''),
      opts.sous ? h('div.tete-ecran__sous', opts.sous) : null
    ]),
    opts.actions && opts.actions.length
      ? h('div.tete-ecran__actions', opts.actions.filter(Boolean))
      : null
  ]);
}

/* ==========================================================================
   CHAMPS DE FORMULAIRE
   Une seule fonction pour tous les types. Elle rend un objet { noeud, lire,
   ecrire, focus } : l'écran garde la main sur la valeur sans relire le DOM.
   ========================================================================== */

/**
 * @param {object} o
 *   type      : text | nombre | euros | tel | email | date | heure | zone |
 *               liste | coche | plaque | km
 *   etiquette, valeur, exemple, aide, options, obligatoire, surChangement
 */
export function champ(o) {
  const opts = o || {};
  const type = opts.type || 'text';
  let entree;

  const commun = {
    placeholder: opts.exemple || '',
    value: opts.valeur === null || opts.valeur === undefined ? '' : opts.valeur,
    disabled: opts.bloque || false,
    id: opts.id,
    autocomplete: opts.autocomplete || 'off',
    name: opts.nom || undefined
  };

  const prevenir = () => {
    if (opts.surChangement) opts.surChangement(lire(), entree);
  };

  switch (type) {
    case 'zone':
      entree = h('textarea.saisie', Object.assign({}, commun, { rows: opts.lignes || 3 }));
      break;

    case 'liste':
      entree = h('select.saisie', Object.assign({}, commun, { value: undefined }));
      for (const op of opts.options || []) {
        const v = typeof op === 'object' ? op.valeur : op;
        const t = typeof op === 'object' ? op.texte : op;
        entree.appendChild(h('option', { value: v, texte: t }));
      }
      /* Poser une valeur qui ne correspond à aucune option laisse la liste
         visuellement vide, et la personne croit avoir choisi quelque chose.
         On ne l'écrit que si l'option existe ; sinon on laisse le navigateur
         sélectionner la première, ce qui est toujours vrai à l'œil. */
      const valeurs = Array.from(entree.options).map(o => o.value);
      if (valeurs.includes(String(commun.value))) entree.value = commun.value;
      break;

    case 'coche':
      entree = h('input', { type: 'checkbox', checked: !!opts.valeur, disabled: opts.bloque });
      break;

    case 'nombre':
    case 'euros':
    case 'km':
      /* `inputmode="decimal"` fait sortir le pavé numérique sur téléphone sans
         imposer le type `number`, dont les flèches et le défilement à la
         molette provoquent des saisies fausses. */
      entree = h('input.saisie.saisie--num', Object.assign({}, commun, {
        type: 'text', inputmode: 'decimal'
      }));
      break;

    case 'tel':
      entree = h('input.saisie', Object.assign({}, commun, {
        type: 'tel', inputmode: 'tel', autocomplete: 'tel'
      }));
      break;

    case 'email':
      entree = h('input.saisie', Object.assign({}, commun, {
        type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off'
      }));
      break;

    case 'date':
      entree = h('input.saisie', Object.assign({}, commun, {
        type: 'date',
        value: opts.valeur ? isoJour(opts.valeur) : ''
      }));
      break;

    case 'heure':
      entree = h('input.saisie', Object.assign({}, commun, {
        type: 'time',
        step: 300,
        value: typeof opts.valeur === 'number' ? minutesEnHeure(opts.valeur) : (opts.valeur || '')
      }));
      break;

    case 'plaque':
      entree = h('input.saisie.saisie--plaque', Object.assign({}, commun, {
        type: 'text', autocapitalize: 'characters', spellcheck: false,
        value: opts.valeur ? plaqueJolie(opts.valeur) : ''
      }));
      /* On reformate à la volée : la personne tape « ej456qt », elle voit
         « EJ-456-QT ». Sans ça, la même plaque s'écrit de trois façons. */
      entree.addEventListener('input', () => {
        const pos = entree.selectionStart;
        const avant = entree.value.length;
        const joli = plaqueJolie(entree.value);
        if (joli !== entree.value) {
          entree.value = joli;
          const decalage = joli.length - avant;
          try { entree.setSelectionRange(pos + decalage, pos + decalage); } catch (e) {}
        }
      });
      break;

    default:
      entree = h('input.saisie', Object.assign({}, commun, { type: 'text' }));
  }

  if (opts.obligatoire) entree.required = true;
  if (opts.autofocus) entree.setAttribute('autofocus', '');

  entree.addEventListener('change', prevenir);
  if (opts.surFrappe) {
    entree.addEventListener('input', attend(() => opts.surFrappe(lire(), entree), opts.delai || 220));
  }

  function lire() {
    if (type === 'coche') return entree.checked;
    const v = entree.value;
    if (type === 'nombre' || type === 'euros' || type === 'km') return nombre(v, 0);
    if (type === 'date') return depuisIsoJour(v);
    if (type === 'heure') return heureEnMinutes(v);
    if (type === 'plaque') return plaqueNue(v);
    return String(v || '').trim();
  }

  function ecrire(v) {
    if (type === 'coche') { entree.checked = !!v; return; }
    if (type === 'date') { entree.value = v ? isoJour(v) : ''; return; }
    if (type === 'heure') { entree.value = typeof v === 'number' ? minutesEnHeure(v) : (v || ''); return; }
    if (type === 'plaque') { entree.value = v ? plaqueJolie(v) : ''; return; }
    entree.value = v === null || v === undefined ? '' : v;
  }

  /* Une case à cocher a sa propre disposition : le libellé à droite. */
  if (type === 'coche') {
    const noeud = h('label.coche', [entree, h('span', opts.etiquette || '')]);
    return { noeud, entree, lire, ecrire, focus: () => entree.focus() };
  }

  const corps = opts.unite
    ? h('div.champ-unite', [entree, h('span.champ-unite__unite', opts.unite)])
    : entree;

  const noeud = h('div.champ' + (opts.large ? '.grandit' : ''), [
    opts.etiquette ? h('label', { for: opts.id, texte: opts.etiquette }) : null,
    corps,
    opts.aide ? h('div.champ__aide', opts.aide) : null
  ]);

  return {
    noeud, entree, lire, ecrire,
    focus: () => entree.focus(),
    erreur: (texte) => {
      entree.setAttribute('aria-invalid', texte ? 'true' : 'false');
      const ancienne = noeud.querySelector('.champ__erreur');
      if (ancienne) ancienne.remove();
      if (texte) noeud.appendChild(h('div.champ__erreur', texte));
    }
  };
}

/** Une grille de champs qui se réorganise seule selon la place. */
export function grilleChamps(champs, colonnes) {
  return h('div', {
    style: {
      display: 'grid',
      gap: 'var(--e-3)',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(' + (colonnes === 1 ? '100%' : '190px') + ', 100%), 1fr))'
    }
  }, champs.filter(Boolean).map(c => (c.noeud || c)));
}

/* ==========================================================================
   PASTILLES
   ========================================================================== */

export function pastilleEtape(cle) {
  const e = ETAPES.find(x => x.cle === cle);
  if (!e) return h('span.pastille', cle || '—');
  return h('span.pastille.pastille--' + e.ton, e.nom);
}

export function pastilleNature(cle) {
  const n = NATURES[cle];
  if (!n) return null;
  return h('span.etiq', { title: n.nom }, n.court);
}

export function pastillePriorite(cle) {
  const p = PRIORITES[cle];
  if (!p || cle === 'normale') return null;
  return h('span.pastille.pastille--' + p.ton, p.nom);
}

export function pastilleDevis(statut) {
  const s = STATUTS_DEVIS[statut];
  return h('span.pastille.pastille--' + (s ? s.ton : 'neutre'), s ? s.nom : statut);
}

export function pastilleFacture(statut) {
  const s = STATUTS_FACTURE[statut];
  return h('span.pastille.pastille--' + (s ? s.ton : 'neutre'), s ? s.nom : statut);
}

/** La plaque, dessinée comme la vraie. */
export function plaque(immat, grande) {
  if (!immat) return null;
  return h('span.plaque' + (grande ? '.plaque--l' : ''), plaqueJolie(immat));
}

/** La tête d'une personne, à sa couleur. */
export function tete(u, taille) {
  if (!u) return null;
  const t = taille === 's' ? '.tete--s' : (taille === 'l' ? '.tete--l' : '');
  return h('span.tete' + t, {
    title: lit.nomUtilisateur(u),
    style: {
      background: 'hsl(' + (u.couleur || 200) + ' 60% 45% / .22)',
      color: 'hsl(' + (u.couleur || 200) + ' 70% 60%)'
    }
  }, initiales(u.nom, u.prenom));
}

export function tetes(e, ids, taille) {
  const liste = (ids || []).map(i => lit.utilisateur(e, i)).filter(Boolean);
  if (!liste.length) return null;
  return h('span.tetes', liste.map(u => tete(u, taille || 's')));
}

/* ==========================================================================
   LIENS UTILES — téléphoner, écrire, ouvrir la carte
   ========================================================================== */

export function lienTel(numero, texte) {
  if (!numero) return null;
  return h('a.rang-s', { href: 'tel:' + telNu(numero) }, [
    icone('telephone', { taille: 14 }), h('span', texte || telJoli(numero))
  ]);
}

export function lienMail(adresse, texte) {
  if (!adresse) return null;
  return h('a.rang-s', { href: 'mailto:' + adresse }, [
    icone('courriel', { taille: 14 }), h('span.coupe', texte || adresse)
  ]);
}

/** Ouvre WhatsApp, les SMS ou la messagerie avec le texte déjà écrit.
 *  Une page hébergée n'expédie rien toute seule : elle prépare, la personne
 *  envoie d'un geste depuis son téléphone. */
export function envoyer(canal, destinataire, texte, sujet) {
  const t = encodeURIComponent(texte || '');
  const d = telNu(destinataire || '');
  let url;
  if (canal === 'whatsapp') url = 'https://wa.me/' + d.replace(/^\+/, '') + '?text=' + t;
  else if (canal === 'sms') url = 'sms:' + d + (/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?') + 'body=' + t;
  else url = 'mailto:' + (destinataire || '') + '?subject=' + encodeURIComponent(sujet || '') + '&body=' + t;
  window.open(url, '_blank', 'noopener');
}

/** Le menu « prévenir » : trois canaux, le même message. */
export function menuEnvoi(ancre, o) {
  const opts = o || {};
  const items = [];
  if (opts.tel) {
    items.push({ texte: 'WhatsApp', icone: 'partage', faire: () => envoyer('whatsapp', opts.tel, opts.texte) });
    items.push({ texte: 'SMS', icone: 'telephone', faire: () => envoyer('sms', opts.tel, opts.texte) });
  }
  if (opts.email) {
    items.push({ texte: 'E-mail', icone: 'courriel', faire: () => envoyer('email', opts.email, opts.texte, opts.sujet) });
  }
  items.push(null);
  items.push({
    texte: 'Copier le message', icone: 'copier',
    faire: async () => {
      const { copier } = await import('../core/fichiers.js');
      const ok = await copier(opts.texte || '');
      message(ok ? 'Message copié' : 'Copie impossible', { ton: ok ? 'ok' : 'danger' });
    }
  });
  if (!opts.tel && !opts.email) {
    message('Ni téléphone ni e-mail sur cette fiche', { ton: 'alerte' });
    return;
  }
  return menu(ancre, items, { titre: 'Prévenir' });
}

/* ==========================================================================
   CARTE D'UN DOSSIER — telle qu'elle apparaît dans le tableau de l'atelier
   ========================================================================== */

export function carteDossier(e, d, options) {
  const o = options || {};
  const v = lit.vehicule(e, d.vehiculeId);
  const c = lit.client(e, d.clientId);
  const jours = lit.joursDansAtelier(d);
  const seuil = nombre(e.reglages.parcAlerteJours, 7);

  return h('button.dossier.dossier--' + d.nature + (d.priorite === 'urgent' ? '.dossier--urgent' : ''), {
    type: 'button',
    donnees: { dossier: d.id },
    draggable: o.glissable !== false,
    onclick: () => { location.hash = '#/dossier/' + d.id; }
  }, [
    h('div.dossier__tete', [
      h('div.dossier__titre.grandit', lit.titreDossier(e, d)),
      d.priorite === 'urgent' ? icone('alerte', { taille: 15, classe: 'urgent' }) : null
    ]),
    h('div.dossier__meta', [
      v ? plaque(v.immat) : null,
      c ? h('span.coupe', lit.nomClient(c)) : null
    ]),
    h('div.dossier__pied', [
      d.place ? h('span.etiq', [icone('parc', { taille: 12 }), h('span', d.place)]) : null,
      h('span.minus' + (jours >= seuil ? '.pastille.pastille--alerte.pastille--sans-point' : '.tres-faible'),
        jours === 0 ? "aujourd'hui" : jours + ' j'),
      h('span.pousse'),
      tetes(e, d.assignes)
    ])
  ]);
}

/* ==========================================================================
   SÉLECTEURS — choisir un client, un véhicule, une pièce
   Un champ qui cherche, propose, et laisse créer si rien ne correspond.
   ========================================================================== */

/**
 * @param {object} o { etat, valeur, surChoix(id), creation:bool, etiquette }
 */
export function choixClient(o) {
  const opts = o || {};
  const e = opts.etat;
  let choisi = opts.valeur || null;

  const affichage = h('div.rang.grandit');
  const zone = h('div.pile-s');
  const recherche = h('input.saisie', {
    type: 'search', placeholder: 'Nom, téléphone, plaque…', autocomplete: 'off'
  });
  const resultats = h('div.pile-s', { style: { maxHeight: '260px', overflowY: 'auto' } });

  function peindreChoisi() {
    const c = choisi ? lit.client(e, choisi) : null;
    poser(affichage, c ? [
      h('div.grandit', [
        h('div.gras', lit.nomClient(c)),
        h('div.petit.faible', [c.type === 'pro' ? 'Professionnel' : 'Particulier',
          c.tel ? ' · ' + telJoli(c.tel) : ''].join(''))
      ]),
      h('button.bt.bt--nu.bt--s', {
        type: 'button', onclick: () => { choisi = null; peindre(); if (opts.surChoix) opts.surChoix(null); }
      }, 'Changer')
    ] : []);
  }

  function chercher() {
    const q = recherche.value.trim();
    const liste = (e.clients || []).filter(c => !c.archive);
    const trouves = (q
      ? liste.map(c => ({
          c, n: score([lit.nomClient(c), c.tel, c.tel2, c.email, c.ville].filter(Boolean).join(' '), q)
        })).filter(x => x.n >= 0).sort((a, b) => b.n - a.n).map(x => x.c)
      : liste.slice().sort((a, b) => (b.maj || 0) - (a.maj || 0))
    ).slice(0, 12);

    poser(resultats, trouves.length ? trouves.map(c =>
      h('button.carte.rang', {
        type: 'button',
        onclick: () => { choisi = c.id; peindre(); if (opts.surChoix) opts.surChoix(c.id); }
      }, [
        h('div.grandit.coupe', [
          h('div.gras.coupe', lit.nomClient(c)),
          h('div.petit.faible.coupe', [c.tel ? telJoli(c.tel) : '', c.ville].filter(Boolean).join(' · '))
        ]),
        c.type === 'pro' ? h('span.etiq', 'PRO') : null
      ])
    ) : h('div.petit.faible.centre', { style: { padding: 'var(--e-3)' } },
        q ? 'Personne ne correspond.' : 'Aucun client enregistré.'));
  }

  recherche.addEventListener('input', attend(chercher, 160));

  function peindre() {
    poser(zone, choisi
      ? [h('div.carte.carte--muette.rang', [affichage])]
      : [recherche, resultats]);
    if (choisi) peindreChoisi();
    else chercher();
  }

  peindre();
  return {
    noeud: h('div.champ', [
      opts.etiquette ? h('label', opts.etiquette) : null,
      zone
    ]),
    lire: () => choisi,
    ecrire: (v) => { choisi = v; peindre(); }
  };
}

/** Choisir un véhicule, éventuellement limité à un client. */
export function choixVehicule(o) {
  const opts = o || {};
  const e = opts.etat;
  let choisi = opts.valeur || null;
  const zone = h('div.pile-s');

  function peindre() {
    const liste = (opts.clientId
      ? lit.vehiculesDe(e, opts.clientId)
      : (e.vehicules || []).filter(v => !v.archive)).slice(0, 40);

    poser(zone, [
      liste.length ? h('div.pile-s', liste.map(v =>
        h('button.carte.rang', {
          type: 'button',
          'aria-pressed': choisi === v.id ? 'true' : 'false',
          style: choisi === v.id ? { borderColor: 'var(--accent)', background: 'var(--accent-voile)' } : null,
          onclick: () => { choisi = v.id; peindre(); if (opts.surChoix) opts.surChoix(v.id); }
        }, [
          plaque(v.immat),
          h('div.grandit.coupe', [
            h('div.gras.coupe', lit.nomVehicule(v)),
            v.motorisation ? h('div.petit.faible.coupe', v.motorisation) : null
          ])
        ])
      )) : h('div.petit.faible', 'Aucun véhicule pour ce client.'),
      opts.surCreation ? h('button.bt.bt--contour.bt--plein', {
        type: 'button', onclick: opts.surCreation
      }, [icone('plus'), h('span', 'Nouveau véhicule')]) : null
    ]);
  }

  peindre();
  return {
    noeud: h('div.champ', [opts.etiquette ? h('label', opts.etiquette) : null, zone]),
    lire: () => choisi,
    ecrire: (v) => { choisi = v; peindre(); },
    rafraichir: (clientId) => { opts.clientId = clientId; choisi = null; peindre(); }
  };
}

/* ==========================================================================
   TOTAUX — le bloc qui clôt un devis, une facture, un dossier
   ========================================================================== */

export function blocTotaux(t, options) {
  const o = options || {};
  return h('div.totaux', [
    t.remiseTotale > 0 ? h('div.totaux__ligne', [
      h('span.faible', 'Total brut'), h('b', fmt.euros(t.brut))
    ]) : null,
    t.remiseLignes > 0 ? h('div.totaux__ligne', [
      h('span.faible', 'Remises de ligne'), h('b', '−' + fmt.euros(t.remiseLignes))
    ]) : null,
    t.remiseGlobale > 0 ? h('div.totaux__ligne', [
      h('span.faible', 'Remise globale'), h('b', '−' + fmt.euros(t.remiseGlobale))
    ]) : null,
    h('div.totaux__ligne', [h('span.faible', 'Total HT'), h('b', fmt.euros(t.ht))]),
    ...t.detailTva.map(d => h('div.totaux__ligne', [
      h('span.faible', 'TVA ' + fmt.nb(d.taux, 1) + ' %'), h('b', fmt.euros(d.tva))
    ])),
    h('div.totaux__ligne.totaux__ttc', [h('span', 'Total TTC'), h('b', fmt.euros(t.ttc))]),
    t.acompte > 0 ? h('div.totaux__ligne', [
      h('span.faible', 'Acompte'), h('b', '−' + fmt.euros(t.acompte))
    ]) : null,
    t.regle > 0 ? h('div.totaux__ligne', [
      h('span.faible', 'Déjà réglé'), h('b', '−' + fmt.euros(t.regle))
    ]) : null,
    (t.acompte > 0 || t.regle > 0) ? h('div.totaux__ligne.gras', [
      h('span', 'Reste à payer'), h('b', fmt.euros(t.reste))
    ]) : null,
    o.pied || null
  ]);
}

/* ==========================================================================
   INDICATEUR — un chiffre qui compte
   ========================================================================== */

export function indic(o) {
  const opts = o || {};
  return h('div.indic' + (opts.vers ? '.indic--cliquable' : ''), {
    onclick: opts.vers ? () => { location.hash = '#' + opts.vers; } : null,
    role: opts.vers ? 'button' : null,
    tabindex: opts.vers ? 0 : null,
    onkeydown: opts.vers ? (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); location.hash = '#' + opts.vers; }
    } : null
  }, [
    h('div.indic__nom', opts.nom || ''),
    h('div.indic__val', { style: opts.ton ? { color: 'var(--' + opts.ton + ')' } : null },
      opts.valeur === null || opts.valeur === undefined ? '—' : String(opts.valeur)),
    opts.detail ? h('div.indic__pied', opts.detail) : null
  ]);
}

/* ==========================================================================
   BARRE DE FILTRES
   ========================================================================== */

/**
 * @param {Array} choix  [{ cle, texte, compte }]
 * @param {string} actif
 * @param {function} surChoix
 */
export function filtres(choix, actif, surChoix) {
  return h('div.filtres', choix.filter(Boolean).map(c =>
    h('button.filtre', {
      type: 'button',
      'aria-pressed': c.cle === actif ? 'true' : 'false',
      onclick: () => surChoix(c.cle)
    }, [
      c.icone ? icone(c.icone, { taille: 14 }) : null,
      h('span', c.texte),
      c.compte !== undefined && c.compte !== null ? h('span.compte', String(c.compte)) : null
    ])
  ));
}

/** Le champ de recherche d'une liste, avec sa croix pour vider. */
export function barreRecherche(o) {
  const opts = o || {};
  let entree;
  const vider = h('button.recherche__vider', {
    type: 'button', 'aria-label': 'Vider',
    hidden: !opts.valeur,
    onclick: () => { entree.value = ''; vider.hidden = true; if (opts.surChangement) opts.surChangement(''); entree.focus(); }
  }, icone('croix', { taille: 15 }));

  entree = h('input.saisie', {
    type: 'search',
    placeholder: opts.exemple || 'Rechercher…',
    value: opts.valeur || '',
    autocomplete: 'off',
    oninput: attend(function () {
      vider.hidden = !this.value;
      if (opts.surChangement) opts.surChangement(this.value.trim());
    }, opts.delai || 200)
  });

  return h('div.recherche', [icone('chercher'), entree, vider]);
}

/* ==========================================================================
   LISTE VIDE AVEC PORTE DE SORTIE
   ========================================================================== */
export { vide } from '../core/ui.js';

/* ==========================================================================
   FIL DES ÉVÉNEMENTS
   ========================================================================== */

export function fil(evenements) {
  if (!evenements || !evenements.length) return null;
  return h('div.fil', evenements.map(ev =>
    h('div.fil__item', [
      h('div.fil__pion', icone(ev.icone || 'info', { taille: 13 })),
      h('div', [
        h('div.fil__quoi', ev.texte),
        h('div.fil__quand', [
          fmt.quand(ev.quand),
          ev.qui ? ' · ' + ev.qui : ''
        ].join(''))
      ])
    ])
  ));
}

/* ==========================================================================
   CONFIRMATION AVANT DE QUITTER UNE SAISIE EN COURS
   ========================================================================== */

let sauvegardeEnAttente = null;

/** Prévient si on quitte la page avec des modifications non enregistrées. */
export function surveillerSaisie(estSale) {
  sauvegardeEnAttente = estSale;
}
window.addEventListener('beforeunload', (ev) => {
  if (sauvegardeEnAttente && sauvegardeEnAttente()) {
    ev.preventDefault();
    ev.returnValue = '';
  }
});
