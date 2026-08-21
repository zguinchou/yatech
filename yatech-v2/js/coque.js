/* ==========================================================================
   YATECH — la coque
   --------------------------------------------------------------------------
   Ce qui entoure les écrans : le menu, la barre du haut, la recherche
   générale, le tiroir du téléphone. Peint une fois, mis à jour ensuite —
   repeindre le menu à chaque changement d'écran ferait clignoter la page et
   perdrait le défilement du rail.
   ========================================================================== */

import { h, poser, q, vider } from './core/dom.js';
import { icone } from './core/icones.js';
import { menu, message } from './core/ui.js';
import * as routeur from './core/routeur.js';
import { S, ecoute, annuler, peutAnnuler, dernierGeste } from './core/store.js';
import { chercher, nomClient, nomVehicule, alertes } from './domain/selecteurs.js';
import { compteEnAttente } from './domain/ebp.js';
import { surligne, attend, plaqueJolie } from './core/util.js';
import { tete } from './ui/widgets.js';
import { ROLES } from './domain/schema.js';

/* ==========================================================================
   LE MENU
   `roles` limite l'accès : un technicien n'a rien à faire dans les réglages
   de facturation, et la secrétaire n'a pas besoin du bench Autotuner.
   ========================================================================== */

export const MENU = [
  { section: 'Atelier' },
  /* `court` : le nom sous l'icône, en bas de l'écran du téléphone. Cinq
     onglets sur 390 px, il faut des mots courts sous peine de « Aujourd'… ». */
  { chemin: '/',            nom: "Aujourd'hui", court: 'Accueil', icone: 'accueil',  onglet: true },
  { chemin: '/atelier',     nom: 'Atelier',     icone: 'atelier',  onglet: true, compte: 'atelier' },
  { chemin: '/planning',    nom: 'Planning',    icone: 'planning', onglet: true },
  { chemin: '/parc',        nom: 'Parc',        icone: 'parc',     compte: 'parc' },

  { section: 'Clientèle' },
  { chemin: '/clients',     nom: 'Clients',     icone: 'clients' },
  { chemin: '/vehicules',   nom: 'Véhicules',   icone: 'vehicule' },

  { section: 'Facturation' },
  { chemin: '/devis',       nom: 'Devis',       icone: 'devis',   compte: 'devis' },
  { chemin: '/factures',    nom: 'Factures',    icone: 'facture', compte: 'factures' },
  { chemin: '/tarifs',      nom: 'Tarifs',      icone: 'tarifs' },
  { chemin: '/ebp',         nom: 'EBP',         icone: 'presse',  compte: 'ebp', roles: ['patron', 'secretariat'] },

  { section: 'Ressources' },
  { chemin: '/stock',       nom: 'Stock',       icone: 'stock',   onglet: true, compte: 'stock' },
  { chemin: '/electronique',nom: 'Électronique',icone: 'puce' },

  { section: null },
  { chemin: '/reglages',    nom: 'Réglages',    icone: 'reglages', roles: ['patron'] }
];

/** Les entrées visibles pour la personne connectée. */
function entrees() {
  const role = S.moi ? S.moi.role : 'patron';
  return MENU.filter(m => m.section !== undefined || !m.roles || m.roles.includes(role));
}

/* ==========================================================================
   LES PASTILLES DE COMPTE
   Ce qui mérite un chiffre rouge sur une entrée de menu : quelque chose à
   faire, pas une simple quantité.
   ========================================================================== */

function comptes() {
  const e = S.etat;
  if (!e) return {};
  const maintenant = Date.now();

  const dossiersOuverts = (e.dossiers || []).filter(d => !d.archive && d.etape !== 'livre');
  const devisSansReponse = (e.devis || []).filter(d => d.statut === 'envoye').length;
  const stockBas = (e.pieces || []).filter(p => !p.archive
    && p.qte <= (p.qteMin === null || p.qteMin === undefined ? (e.reglages.stockAlerteDefaut || 1) : p.qteMin)).length;
  const impayees = (e.factures || []).filter(f =>
    f.statut !== 'reglee' && f.statut !== 'attente' && f.echeanceLe && f.echeanceLe < maintenant).length;
  const aFacturer = (e.dossiers || []).filter(d => !d.archive && d.etape === 'livre' && !d.factureId).length;
  const ventouses = dossiersOuverts.filter(d => d.place
    && (maintenant - (d.entree || d.cree || maintenant)) > (e.reglages.parcAlerteGrave || 21) * 86400000).length;

  return {
    atelier: dossiersOuverts.length || null,
    devis: devisSansReponse || null,
    factures: (impayees + aFacturer) || null,
    stock: stockBas || null,
    parc: ventouses || null,
    ebp: compteEnAttente(e) || null
  };
}

/* ==========================================================================
   PEINTURE
   ========================================================================== */

let racine = null;
let zoneContenu = null;
let peintUneFois = false;

export function contenu() { return zoneContenu; }

export function peindreCoque() {
  racine = document.getElementById('app');
  if (!peintUneFois) {
    construire();
    peintUneFois = true;
  }
  majMenu();
}

function construire() {
  zoneContenu = h('main.contenu', { id: 'contenu' });

  racine.className = 'coque';
  poser(racine, [
    railLateral(),
    h('div.grandit', { style: { display: 'flex', flexDirection: 'column', minHeight: '100dvh' } }, [
      barreHaut(),
      zoneContenu
    ]),
    ongletsBas()
  ]);
  racine.hidden = false;
}

/* --- le rail, sur grand écran -------------------------------------------- */

function railLateral() {
  return h('nav.rail', { id: 'rail', 'aria-label': 'Navigation' }, [
    h('div.rail__marque', [
      h('img', { src: 'assets/icone.svg', alt: '', width: 26, height: 26 }),
      h('strong', S.etat && S.etat.reglages.nomOutil ? S.etat.reglages.nomOutil : 'Yatech')
    ]),
    h('div.rail__liens', { id: 'rail-liens' }),
    h('div.rail__pied', [boutonMoi()])
  ]);
}

function liensMenu(surClic) {
  const actif = routeur.actuelle().chemin;
  const n = comptes();
  const sortie = [];

  for (const m of entrees()) {
    if (m.section !== undefined) {
      if (m.section) sortie.push(h('div.rail__section', m.section));
      continue;
    }
    const compte = m.compte ? n[m.compte] : null;
    sortie.push(h('a.lien', {
      href: '#' + m.chemin,
      'aria-current': estActif(actif, m.chemin) ? 'page' : null,
      onclick: surClic || null
    }, [
      icone(m.icone),
      h('span', m.nom),
      compte ? h('span.compte' + (m.compte === 'factures' || m.compte === 'parc' ? '.compte--alerte' : ''),
        String(compte)) : null
    ]));
  }
  return sortie;
}

/** L'accueil ne s'allume que sur lui-même ; les autres, sur leurs sous-écrans. */
function estActif(actuel, chemin) {
  if (chemin === '/') return actuel === '/';
  return actuel === chemin || actuel.startsWith(chemin + '/');
}

/* --- la barre du haut ----------------------------------------------------- */

function barreHaut() {
  return h('header.barre', [
    h('button.bt.bt--nu.bt--icone', {
      type: 'button', 'aria-label': 'Menu', id: 'bt-tiroir',
      onclick: ouvrirTiroir,
      style: { display: 'none' }
    }, icone('menu')),

    h('div.barre__marque', [
      h('img', { src: 'assets/icone.svg', alt: '', width: 24, height: 24 }),
      h('strong.titre-typo', { style: { letterSpacing: '.12em' } },
        S.etat && S.etat.reglages.nomOutil ? S.etat.reglages.nomOutil : 'Yatech')
    ]),

    h('h1.barre__titre', { id: 'barre-titre' }, ''),

    h('button.chercher-tout', {
      type: 'button', onclick: ouvrirPalette, 'aria-label': 'Rechercher'
    }, [icone('chercher'), h('span.grandit', 'Rechercher…'), h('kbd', '/')]),

    h('div.barre__outils', [
      h('span', { id: 'voyant-reseau' }),
      h('button.bt.bt--nu.bt--icone', {
        type: 'button', 'aria-label': 'Rechercher', id: 'bt-chercher',
        onclick: ouvrirPalette
      }, icone('chercher')),
      h('button.bt.bt--nu.bt--icone', {
        type: 'button', 'aria-label': 'Alertes', id: 'bt-alertes',
        onclick: (ev) => menuAlertes(ev.currentTarget)
      }, icone('cloche')),
      h('button.bt.bt--nu.bt--icone', {
        type: 'button', 'aria-label': 'Mon compte', id: 'bt-moi',
        onclick: (ev) => menuMoi(ev.currentTarget)
      }, icone('clients'))
    ])
  ]);
}

/* --- les onglets du bas, sur téléphone ------------------------------------ */

function ongletsBas() {
  return h('nav.onglets-bas', { id: 'onglets-bas', 'aria-label': 'Navigation' });
}

function majOngletsBas() {
  const barre = document.getElementById('onglets-bas');
  if (!barre) return;
  const actif = routeur.actuelle().chemin;
  const n = comptes();

  const principaux = entrees().filter(m => m.onglet);
  const noeuds = principaux.map(m => h('button.onglet-bas', {
    type: 'button',
    'aria-current': estActif(actif, m.chemin) ? 'page' : null,
    onclick: () => routeur.aller(m.chemin)
  }, [
    icone(m.icone),
    h('span', m.court || m.nom),
    m.compte && n[m.compte] ? h('span.onglet-bas__puce', String(n[m.compte])) : null
  ]));

  noeuds.push(h('button.onglet-bas', {
    type: 'button', onclick: ouvrirTiroir, 'aria-label': 'Plus'
  }, [icone('points'), h('span', 'Plus')]));

  poser(barre, noeuds);
}

/* --- le tiroir ------------------------------------------------------------ */

let tiroirOuvert = null;

export function ouvrirTiroir() {
  if (tiroirOuvert) return;
  const fermer = () => {
    if (!tiroirOuvert) return;
    tiroirOuvert.masque.remove();
    tiroirOuvert.boite.remove();
    tiroirOuvert = null;
    document.removeEventListener('keydown', surEchap);
  };
  const surEchap = (ev) => { if (ev.key === 'Escape') fermer(); };

  const masque = h('div.tiroir-masque', { onclick: fermer });
  const boite = h('nav.tiroir', { 'aria-label': 'Menu' }, [
    h('div.rail__marque', [
      h('img', { src: 'assets/icone.svg', alt: '', width: 26, height: 26 }),
      h('strong.grandit', S.etat && S.etat.reglages.nomOutil ? S.etat.reglages.nomOutil : 'Yatech'),
      h('button.bt.bt--nu.bt--icone', { type: 'button', 'aria-label': 'Fermer', onclick: fermer },
        icone('croix'))
    ]),
    h('div.rail__liens', liensMenu(fermer)),
    h('div.rail__pied', [boutonMoi(fermer)])
  ]);

  document.body.appendChild(masque);
  document.body.appendChild(boite);
  document.addEventListener('keydown', surEchap);
  tiroirOuvert = { masque, boite, fermer };
}

/* --- qui est connecté ----------------------------------------------------- */

function boutonMoi(avant) {
  const u = S.moi;
  return h('button.moi', {
    type: 'button',
    onclick: (ev) => { if (avant) avant(); menuMoi(ev.currentTarget); }
  }, [
    u ? tete(u) : icone('clients'),
    h('div.grandit.coupe', [
      h('div.moi__nom.coupe', u ? [u.prenom, u.nom].filter(Boolean).join(' ') : 'Non connecté'),
      h('div.moi__role', u && ROLES[u.role] ? ROLES[u.role].nom : '')
    ]),
    icone('bas', { taille: 15 })
  ]);
}

function menuMoi(ancre) {
  const e = S.etat;
  const theme = (e && e.reglages.theme) || 'auto';
  menu(ancre, [
    { titre: S.moi ? [S.moi.prenom, S.moi.nom].filter(Boolean).join(' ') : 'Yatech' },
    {
      texte: theme === 'sombre' ? 'Passer en clair' : 'Passer en sombre',
      icone: theme === 'sombre' ? 'soleil' : 'lune',
      faire: () => basculerTheme()
    },
    peutAnnuler() ? {
      texte: 'Annuler : ' + (dernierGeste() || 'dernier geste'),
      icone: 'retour',
      faire: () => {
        const geste = annuler();
        message(geste ? 'Annulé : ' + geste : 'Rien à annuler');
        /* L'écran affiche encore l'état d'avant l'annulation : sans ce repeint,
           on croit que rien ne s'est passé. */
        if (geste) routeur.repeindre();
      }
    } : null,
    null,
    { texte: 'Réglages', icone: 'reglages', faire: () => routeur.aller('/reglages') },
    { texte: 'Sauvegarder les données', icone: 'telecharger', faire: sauvegarder },
    null,
    {
      texte: 'Verrouiller', icone: 'cadenas', danger: false,
      faire: () => { S.moi = null; routeur.aller('/connexion'); }
    }
  ]);
}

async function sauvegarder() {
  const { telecharger, nomDate } = await import('./core/fichiers.js');
  const { instantane } = await import('./core/store.js');
  const doc = instantane();
  const ok = await telecharger(nomDate('yatech-sauvegarde', 'json'), JSON.stringify(doc, null, 2),
    'application/json');
  if (ok) {
    S.etat.reglages.derniereSauvegarde = Date.now();
    message('Sauvegarde enregistrée', { ton: 'ok' });
  } else {
    message('La sauvegarde n’est pas partie', { ton: 'danger' });
  }
}

export function basculerTheme() {
  const e = S.etat;
  if (!e) return;
  const actuel = e.reglages.theme || 'auto';
  const sombreActuel = actuel === 'sombre'
    || (actuel === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  e.reglages.theme = sombreActuel ? 'clair' : 'sombre';
  appliquerApparence(e.reglages);
}

/** Pose le thème, la teinte et la densité sur la racine du document. */
export function appliquerApparence(r) {
  const racineDoc = document.documentElement;
  racineDoc.dataset.theme = r.theme || 'auto';
  racineDoc.dataset.densite = r.densite || 'confort';
  racineDoc.style.setProperty('--h-accent', String(r.teinte === undefined ? 38 : r.teinte));

  /* La couleur de la barre système du téléphone suit le fond de l'outil :
     sinon, en mode sombre, on garde un bandeau blanc en haut de l'écran. */
  const sombre = (r.theme === 'sombre')
    || (r.theme === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.remove();
  document.head.appendChild(h('meta', { name: 'theme-color', content: sombre ? '#0f1417' : '#eef1f4' }));
}

/* ==========================================================================
   ALERTES
   ========================================================================== */

function menuAlertes(ancre) {
  const liste = alertes(S.etat).slice(0, 12);
  if (!liste.length) {
    menu(ancre, [{ texte: 'Rien à signaler', icone: 'cocheRonde', faire: () => {} }]);
    return;
  }
  menu(ancre, [
    { titre: liste.length + (liste.length > 1 ? ' points à traiter' : ' point à traiter') },
    ...liste.map(a => ({
      texte: a.titre,
      icone: a.icone,
      danger: a.ton === 'danger',
      faire: () => routeur.aller(a.vers)
    }))
  ]);
}

/** Le petit point rouge sur la cloche, quand il y a du grave. */
function majAlertes() {
  const bouton = document.getElementById('bt-alertes');
  if (!bouton) return;
  const liste = alertes(S.etat);
  const graves = liste.filter(a => a.ton === 'danger').length;
  bouton.style.color = graves ? 'var(--danger)' : '';
  bouton.setAttribute('aria-label', liste.length
    ? liste.length + ' points à traiter' : 'Aucune alerte');
}

/* ==========================================================================
   RECHERCHE GÉNÉRALE
   ========================================================================== */

let paletteOuverte = null;

export function ouvrirPalette(requeteInitiale) {
  if (paletteOuverte) return;

  let vise = 0;
  let trouves = [];

  const entree = h('input', {
    type: 'search',
    placeholder: 'Client, plaque, dossier, pièce…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    value: typeof requeteInitiale === 'string' ? requeteInitiale : ''
  });

  const zone = h('div.palette__resultats');
  const boite = h('div.palette', [
    h('div.palette__saisie', [
      icone('chercher'),
      entree,
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Fermer', onclick: () => fermer()
      }, icone('croix'))
    ]),
    zone,
    h('div.palette__pied', [
      h('span', [h('kbd', '↑'), h('kbd', '↓'), ' naviguer']),
      h('span', [h('kbd', '↵'), ' ouvrir']),
      h('span', [h('kbd', 'Échap'), ' fermer'])
    ])
  ]);

  const masque = h('div.palette-masque', {
    onmousedown: (ev) => { if (ev.target === masque) fermer(); }
  }, [boite]);

  const ICONES = {
    client: 'clients', vehicule: 'vehicule', dossier: 'dossier',
    piece: 'stock', devis: 'devis', facture: 'facture', prestation: 'tarifs'
  };

  function peindre() {
    const qte = entree.value.trim();
    if (!qte) {
      trouves = [];
      poser(zone, [
        h('div.palette__groupe', 'Aller à'),
        ...entrees().filter(m => m.chemin).slice(0, 8).map(m =>
          h('button.palette__item', {
            type: 'button', onclick: () => { fermer(); routeur.aller(m.chemin); }
          }, [icone(m.icone), h('span.grandit', m.nom)]))
      ]);
      return;
    }

    trouves = chercher(S.etat, qte, { limite: 20 });
    vise = 0;
    if (!trouves.length) {
      poser(zone, h('div.vide', [
        icone('chercher', { taille: 32 }),
        h('h3', 'Rien trouvé'),
        h('p', 'Essayez trois lettres d’un nom, ou les chiffres d’une plaque.')
      ]));
      return;
    }

    poser(zone, trouves.map((r, i) =>
      h('button.palette__item', {
        type: 'button',
        donnees: { vise: i === 0 ? '1' : '0' },
        onmouseenter: () => { vise = i; marquer(); },
        onclick: () => { fermer(); routeur.aller(r.vers); }
      }, [
        icone(ICONES[r.type] || 'document'),
        h('div.grandit.coupe', [
          h('div.coupe', { html: surligne(titreResultat(r), qte) }),
          r.sous ? h('div.petit.faible.coupe', r.sous) : null
        ]),
        h('span.minus.tres-faible', nomType(r.type))
      ])
    ));
  }

  function titreResultat(r) {
    if (r.type === 'client') return nomClient(r.objet);
    if (r.type === 'vehicule') return plaqueJolie(r.objet.immat) + ' — ' + nomVehicule(r.objet);
    if (r.type === 'dossier') return (r.objet.numero || '') + ' ' + (r.objet.titre || '');
    if (r.type === 'piece') return (r.objet.ref ? r.objet.ref + ' — ' : '') + r.objet.libelle;
    if (r.type === 'prestation') return r.objet.libelle;
    return r.objet.numero || r.objet.libelle || '';
  }

  const NOMS = {
    client: 'Client', vehicule: 'Véhicule', dossier: 'Dossier', piece: 'Pièce',
    devis: 'Devis', facture: 'Facture', prestation: 'Tarif'
  };
  const nomType = (t) => NOMS[t] || '';

  function marquer() {
    const items = zone.querySelectorAll('.palette__item');
    items.forEach((n, i) => { n.dataset.vise = i === vise ? '1' : '0'; });
    if (items[vise]) items[vise].scrollIntoView({ block: 'nearest' });
  }

  entree.addEventListener('input', attend(peindre, 120));
  entree.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); vise = Math.min(vise + 1, Math.max(0, trouves.length - 1)); marquer(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); vise = Math.max(0, vise - 1); marquer(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const items = zone.querySelectorAll('.palette__item');
      if (items[vise]) items[vise].click();
    } else if (ev.key === 'Escape') { ev.preventDefault(); fermer(); }
  });

  function fermer() {
    if (!paletteOuverte) return;
    masque.remove();
    paletteOuverte = null;
  }

  document.body.appendChild(masque);
  paletteOuverte = { fermer };
  peindre();
  requestAnimationFrame(() => entree.focus());
}

/* ==========================================================================
   MISE À JOUR DE LA COQUE
   ========================================================================== */

export function majMenu() {
  const liens = document.getElementById('rail-liens');
  if (liens) poser(liens, liensMenu());
  majOngletsBas();
  majAlertes();
  majBoutonTiroir();

  const marque = q('.rail__marque strong');
  if (marque && S.etat) marque.textContent = S.etat.reglages.nomOutil || 'Yatech';
}

function majBoutonTiroir() {
  const bt = document.getElementById('bt-tiroir');
  if (!bt) return;
  /* Sur téléphone, la barre du bas suffit pour les cinq écrans principaux ;
     le bouton du haut n'apparaît que si l'on est ailleurs. */
  const petit = window.matchMedia('(max-width: 900px)').matches;
  bt.style.display = petit ? '' : 'none';
}

export function titreEcran(texte) {
  const t = document.getElementById('barre-titre');
  if (t) t.textContent = texte || '';
  document.title = texte ? texte + ' · ' + (S.etat ? S.etat.reglages.nomOutil : 'Yatech')
    : (S.etat ? S.etat.reglages.nomOutil : 'Yatech');
}

/* ==========================================================================
   ÉTAT DU RÉSEAU
   ========================================================================== */

export function surveillerReseau() {
  const peindre = () => {
    const zone = document.getElementById('voyant-reseau');
    if (!zone) return;
    if (navigator.onLine) { vider(zone); return; }
    poser(zone, h('span.voyant-hors-ligne', [
      icone('alerte', { taille: 12 }), h('span', 'Hors ligne')
    ]));
  };
  window.addEventListener('online', () => { peindre(); message('Connexion revenue', { ton: 'ok' }); });
  window.addEventListener('offline', () => { peindre(); message('Hors ligne — l’outil continue de fonctionner', { ton: 'alerte' }); });
  peindre();
}

/* L'état change quelque part : les compteurs du menu doivent suivre. */
ecoute(attend(() => { if (peintUneFois) majMenu(); }, 260));
window.addEventListener('resize', attend(majBoutonTiroir, 200));
