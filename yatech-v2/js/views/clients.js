/* ==========================================================================
   YATECH — écran « Clients »
   --------------------------------------------------------------------------
   L'annuaire du garage. Comme l'écran des véhicules, il sert rarement à lire
   la liste : il sert à retrouver QUELQU'UN, le plus souvent pendant qu'il est
   au téléphone. D'où deux partis pris :

   1. La recherche accepte aussi les plaques. « Bonjour, c'est pour la 308
      grise, EJ-456-QT » — on tape la plaque, on tombe sur le propriétaire.
      C'est le chemin le plus court entre la question et la fiche.
   2. La colonne « Dû » est toujours là. Savoir qu'on parle à quelqu'un qui
      doit 840 € change la conversation, et personne n'ira le vérifier ailleurs
      avant de décrocher.

   La fenêtre de saisie d'un client vit ici et s'exporte : la fiche client et
   l'ouverture d'un dossier l'appellent, pour qu'une fiche se remplisse
   toujours de la même façon.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, message, menu, vide } from '../core/ui.js';
import { maj, change } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import {
  nu, par, pluriel, surligne, plaqueNue, telNu, emailValide,
  nombre, borne, attend, plaqueJolie } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import { nouveauClient } from '../domain/schema.js';
import { codeEbp, telechargerClients } from '../domain/ebp.js';
import {
  enTete, champ, grilleChamps, plaque, barreRecherche, filtres, lienTel
} from '../ui/widgets.js';

/* Le schéma range la civilité en texte libre : les choix courants sont ici,
   la saisie reste possible pour le reste (docteur, maître…). */
const CIVILITES = ['M.', 'Mme', 'M. et Mme'];

/** Combien de plaques on montre avant de compter le reste. Au-delà de trois,
 *  la colonne déborde et on ne lit plus rien. */
const PLAQUES_MONTREES = 3;

/** Les tris proposés, avec le sens qui va de soi pour chacun : un annuaire se
 *  lit de A à Z, un passage et une dette se lisent du plus gros d'abord. */
const TRIS = [
  { cle: 'nom', nom: 'Nom', sens: 'asc' },
  { cle: 'passage', nom: 'Dernier passage', sens: 'desc' },
  { cle: 'du', nom: 'Montant dû', sens: 'desc' }
];

const FILTRES = [
  { cle: 'tous', texte: 'Tous', garde: (c) => !c.archive },
  { cle: 'part', texte: 'Particuliers', garde: (c) => !c.archive && c.type !== 'pro' },
  { cle: 'pro', texte: 'Professionnels', icone: 'pro', garde: (c) => !c.archive && c.type === 'pro' },
  {
    cle: 'doit', texte: 'Qui doivent de l’argent', icone: 'euro',
    garde: (c, dus) => !c.archive && (dus.get(c.id) || 0) > 0.005
  },
  { cle: 'archives', texte: 'Archivés', icone: 'archive', garde: (c) => !!c.archive }
];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  let filtre = String((ctx.query && ctx.query.filtre) || 'tous');
  if (!FILTRES.some(f => f.cle === filtre)) filtre = 'tous';
  let tri = 'nom';
  let sens = 'asc';

  const racine = h('div.pile');
  const zoneFiltres = h('div');
  const zoneListe = h('div');

  /* Ces trois tables coûtent chacune un parcours complet des dossiers, des
     véhicules et des factures. On les monte une fois par peinture : sans
     elles, chaque ligne du tableau relirait tout le garage, et le tri par
     montant dû le relirait autant de fois qu'il y a de clients. */
  let plaques = plaquesParClient(e);
  let passages = derniersPassages(e);
  let dus = dusParClient(e);

  /* Ce que le tableau montre à l'instant : c'est cette liste-là qu'on exporte,
     pas tout l'annuaire. Exporter « les professionnels d'Amiens » doit sortir
     les professionnels d'Amiens. */
  let visibles = [];

  /** Repeint filtres et tableau, mais ni l'en-tête ni la barre de recherche :
   *  le curseur doit rester dans le champ où l'on est en train de taper. */
  function refaireListe() {
    const base = (e.clients || []).filter(c => !requete || correspondClient(c, requete, plaques));

    poser(zoneFiltres, filtres(
      FILTRES.map(f => ({
        cle: f.cle, texte: f.texte, icone: f.icone,
        compte: base.filter(c => f.garde(c, dus)).length
      })),
      filtre,
      (cle) => { filtre = cle; refaireListe(); }
    ));

    const f = FILTRES.find(x => x.cle === filtre) || FILTRES[0];
    visibles = base.filter(c => f.garde(c, dus)).sort(comparateur(tri, sens, passages, dus));

    poser(zoneListe, visibles.length
      ? tableau(visibles, requete, { plaques, passages, dus }, { tri, sens, surTri: changerTri })
      : rienTrouve(e, requete, filtre, refaireTout));
  }

  function changerTri(cle) {
    /* Recliquer sur la même colonne inverse le sens ; changer de colonne
       repart du sens naturel de cette colonne-là. */
    if (tri === cle) sens = sens === 'asc' ? 'desc' : 'asc';
    else { tri = cle; sens = (TRIS.find(t => t.cle === cle) || {}).sens || 'asc'; }
    refaireListe();
  }

  function refaireTout() {
    plaques = plaquesParClient(e);
    passages = derniersPassages(e);
    dus = dusParClient(e);
    poser(racine, contenu());
    refaireListe();
  }

  function contenu() {
    const vivants = (e.clients || []).filter(c => !c.archive);
    const pros = vivants.filter(c => c.type === 'pro').length;

    return [
      enTete({
        titre: 'Clients',
        sous: pluriel(vivants.length - pros, 'particulier') + ', ' + pluriel(pros, 'professionnel'),
        actions: [
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => modaleClient(e, null, (c) => {
              refaireTout();
              message(lit.nomClient(c) + ' est enregistré', { ton: 'ok' });
            })
          }, [icone('plus'), h('span', 'Nouveau client')]),
          h('button.bt.bt--contour.bt--icone', {
            type: 'button', 'aria-label': 'Autres actions',
            onclick: (ev) => menu(ev.currentTarget, [
              {
                texte: 'Importer depuis EBP', icone: 'televerser',
                faire: () => { location.hash = '#/ebp'; }
              },
              {
                texte: 'Exporter en CSV', icone: 'telecharger',
                faire: () => exporter(e, visibles)
              }
            ], { titre: 'Clients' })
          }, icone('points'))
        ]
      }),
      h('div.clients-chercher', barreRecherche({
        valeur: requete,
        exemple: 'Nom, société, téléphone, e-mail, ville, plaque…',
        surChangement: (v) => { requete = v; refaireListe(); }
      })),
      h('div.clients-outils', [
        zoneFiltres,
        h('label.clients-tri-mobile', [
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
   CE QU'ON PRÉPARE UNE FOIS
   ========================================================================== */

/** Les plaques de chaque client. Elles servent deux fois : à la recherche et
 *  à la colonne « Véhicules ». */
function plaquesParClient(e) {
  const m = new Map();
  for (const v of e.vehicules || []) {
    if (v.archive || !v.clientId || !v.immat) continue;
    const deja = m.get(v.clientId);
    if (deja) deja.push(plaqueJolie(v.immat));
    else m.set(v.clientId, [plaqueJolie(v.immat)]);
  }
  return m;
}

/** Le dernier passage de chaque client : la sortie de son dernier dossier, ou
 *  à défaut son entrée. */
function derniersPassages(e) {
  const m = new Map();
  for (const d of e.dossiers || []) {
    if (!d.clientId) continue;
    const t = d.sortie || d.entree || d.cree || 0;
    if (t > (m.get(d.clientId) || 0)) m.set(d.clientId, t);
  }
  return m;
}

/**
 * Ce que chacun doit. `lit.duPar` parcourt toutes les factures du garage : on
 * ne l'appelle donc que pour les clients qui ont au moins une facture non
 * soldée. Les autres doivent zéro, et le vérifier coûterait un parcours
 * complet par fiche de l'annuaire.
 */
function dusParClient(e) {
  const enJeu = new Set();
  for (const f of e.factures || []) {
    if (!f.clientId || f.statut === 'reglee' || f.statut === 'attente') continue;
    enJeu.add(f.clientId);
  }
  const m = new Map();
  for (const id of enJeu) {
    const t = lit.duPar(e, id).total;
    if (t > 0.005) m.set(id, t);
  }
  return m;
}

/* ==========================================================================
   LA RECHERCHE
   ========================================================================== */

/**
 * Un client répond si CHAQUE mot tapé se retrouve quelque part : son nom, sa
 * société, une de ses villes, son e-mail, son code EBP — ou la plaque d'un de
 * ses véhicules.
 *
 * Deux souplesses sans lesquelles la recherche rate ce qu'on cherche :
 * les chiffres tapés sont comparés au numéro débarrassé de ses espaces
 * (« 0612 » doit tomber sur « 06 12 34 56 78 »), et une plaque est comparée
 * sous sa forme nue des deux côtés (« ej456 » doit tomber sur « EJ-456-QT »).
 */
function correspondClient(c, requete, plaques) {
  const texte = nu([
    lit.nomClient(c), c.nom, c.prenom, c.societe, c.email,
    c.ville, c.cp, c.adresse, c.codeEbp, c.siret, c.tvaIntra
  ].filter(Boolean).join(' '));
  const chiffres = [c.tel, c.tel2].filter(Boolean)
    .map(t => String(t).replace(/\D/g, '')).join(' ');
  const immats = (plaques.get(c.id) || []).map(plaqueNue).join(' ');

  const mots = String(requete).trim().split(/\s+/).filter(Boolean);
  return mots.every(m => {
    if (texte.includes(nu(m))) return true;
    const p = plaqueNue(m);
    if (p.length >= 2 && immats.includes(p)) return true;
    const n = m.replace(/\D/g, '');
    return n.length >= 3 && chiffres.includes(n);
  });
}

function comparateur(tri, sens, passages, dus) {
  if (tri === 'passage') return par(c => passages.get(c.id) || null, sens);
  if (tri === 'du') return par(c => dus.get(c.id) || null, sens);
  return par(c => lit.nomClientTri(c) || null, sens);
}

/* ==========================================================================
   LE TABLEAU
   ========================================================================== */

function tableau(liste, requete, tables, triage) {
  /* Au clavier comme à la souris, on trie en cliquant la colonne ; le doigt,
     lui, passe par la liste déroulante de la barre d'outils — sur téléphone
     les en-têtes du tableau n'existent plus. */
  const enteteTriable = (cle, nom, classe) => {
    const actif = triage.tri === cle;
    return h('th' + (classe || ''), {
      'aria-sort': actif ? (triage.sens === 'asc' ? 'ascending' : 'descending') : 'none'
    }, [
      h('button.clients-tri' + (actif ? '.clients-tri--actif' : ''), {
        type: 'button', onclick: () => triage.surTri(cle)
      }, [
        h('span', nom),
        icone(actif ? (triage.sens === 'asc' ? 'haut' : 'bas') : 'trier', { taille: 13 })
      ])
    ]);
  };

  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      enteteTriable('nom', 'Nom'),
      h('th', 'Téléphone'),
      h('th', 'Ville'),
      h('th', 'Véhicules'),
      enteteTriable('passage', 'Dernier passage'),
      enteteTriable('du', 'Dû', '.num')
    ])),
    h('tbody', liste.map(c => ligne(c, requete, tables)))
  ]));
}

function ligne(c, requete, tables) {
  const immats = tables.plaques.get(c.id) || [];
  const passage = tables.passages.get(c.id) || null;
  const du = tables.dus.get(c.id) || 0;
  const aller = () => { location.hash = '#/client/' + c.id; };

  const tel = lienTel(c.tel);
  /* La ligne entière mène à la fiche : sans ce garde-fou, appuyer sur le
     numéro déclencherait l'appel ET la navigation, et le téléphone
     n'appellerait jamais. */
  if (tel) tel.addEventListener('click', (ev) => ev.stopPropagation());

  return h('tr.cliquable', {
    tabindex: 0,
    style: c.archive ? { opacity: '.6' } : null,
    onclick: aller,
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); }
    }
  }, [
    h('td', { donnees: { col: 'Nom' } }, [
      h('div.rang-s', [
        h('span.gras.coupe', { html: surligne(lit.nomClient(c), requete) }),
        c.type === 'pro' ? h('span.etiq.etiq--accent', 'PRO') : null,
        c.archive ? h('span.etiq', 'archivé') : null
      ]),
      /* Sous la raison sociale on met le nom de l'interlocuteur. Encore
         faut-il que ce soit quelqu'un : si le champ « nom » répète la raison
         sociale — ce qui arrive vite à la saisie — on n'écrit pas deux fois
         la même chose. */
      c.type === 'pro' && [c.prenom, c.nom].filter(Boolean).join(' ').trim()
        && nu([c.prenom, c.nom].filter(Boolean).join(' ')) !== nu(lit.nomClient(c))
        ? h('div.minus.tres-faible.coupe', {
            html: surligne([c.prenom, c.nom].filter(Boolean).join(' '), requete)
          })
        : null
    ]),
    h('td', { donnees: { col: 'Téléphone' } },
      tel || h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Ville' } },
      c.ville
        ? h('span.coupe', { html: surligne(c.ville, requete) })
        : h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Véhicules' } },
      immats.length
        ? h('div.clients-plaques', [
            ...immats.slice(0, PLAQUES_MONTREES).map(i => plaque(i)),
            immats.length > PLAQUES_MONTREES
              ? h('span.minus.tres-faible', '+' + (immats.length - PLAQUES_MONTREES))
              : null
          ])
        : h('span.tres-faible', 'aucun')),
    h('td', { donnees: { col: 'Dernier passage' } }, passage
      ? h('div', [
          h('div', fmt.date(passage, 'court')),
          h('div.minus.tres-faible', fmt.quand(passage, { avecHeure: false }))
        ])
      : h('span.tres-faible', 'jamais venu')),
    h('td.num', { donnees: { col: 'Dû' } },
      du > 0.005
        ? h('b', { style: { color: 'var(--danger)' } }, fmt.euros(du))
        : h('span.tres-faible', '—'))
  ]);
}

function rienTrouve(e, requete, filtre, refaire) {
  if (requete) {
    return vide({
      icone: 'chercher',
      titre: 'Personne pour « ' + requete + ' »',
      texte: 'Essayez trois lettres du nom, quatre chiffres du numéro, ou la plaque du véhicule.',
      action: { texte: 'Créer ce client', faire: () => modaleClient(e, null, refaire) }
    });
  }
  if (filtre === 'archives') {
    return vide({ icone: 'archive', titre: 'Aucun client archivé', texte: 'Tout l’annuaire est actif.' });
  }
  if (filtre === 'doit') {
    return vide({
      icone: 'cocheRonde', titre: 'Personne ne doit rien',
      texte: 'Toutes les factures émises sont soldées.'
    });
  }
  if (filtre !== 'tous') {
    return vide({ icone: 'clients', titre: 'Aucun client dans ce filtre' });
  }
  return vide({
    icone: 'clients',
    titre: 'L’annuaire est vide',
    texte: 'On peut saisir un client à la main, ou reprendre ceux d’EBP par un fichier.',
    action: { texte: 'Nouveau client', faire: () => modaleClient(e, null, refaire) }
  });
}

/** L'export part avec ce que l'écran montre : filtres et recherche compris. */
function exporter(e, liste) {
  if (!liste.length) {
    message('Rien à exporter dans cette liste', { ton: 'alerte' });
    return;
  }
  telechargerClients(e, liste);
  message(pluriel(liste.length, 'client') + ' dans le fichier', { ton: 'ok' });
}

/* ==========================================================================
   LA FENÊTRE CLIENT — création et modification
   --------------------------------------------------------------------------
   Une seule fenêtre pour les deux : ce qu'on saisit à la création est
   exactement ce qu'on corrige deux ans plus tard.
   ========================================================================== */

/**
 * @param {object}   e         l'état
 * @param {object}   [client]  la fiche à modifier, ou rien pour créer
 * @param {function} [apres]   rappelée avec la fiche enregistrée
 */
export function modaleClient(e, client, apres) {
  const edition = !!client;
  const c = client || {};
  let type = c.type === 'pro' ? 'pro' : 'part';

  /* --- l'identité, selon le type ---------------------------------------- */

  const civilite = champ({
    etiquette: 'Civilité', type: 'liste', valeur: c.civilite || '',
    options: [{ valeur: '', texte: '—' }].concat(CIVILITES.map(x => ({ valeur: x, texte: x })))
  });
  const nom = champ({ etiquette: 'Nom', valeur: c.nom || '', exemple: 'Dupont' });
  const prenom = champ({ etiquette: 'Prénom', valeur: c.prenom || '', exemple: 'Martine' });

  const societe = champ({
    etiquette: 'Raison sociale', valeur: c.societe || '', exemple: 'Garage des Trois Ponts'
  });
  const siret = champ({
    etiquette: 'SIRET', valeur: c.siret || '', exemple: '812 345 678 00019',
    aide: '14 chiffres, sur le Kbis ou l’en-tête de leurs factures.'
  });
  const tvaIntra = champ({
    etiquette: 'TVA intracommunautaire', valeur: c.tvaIntra || '', exemple: 'FR12345678900'
  });
  const contact = champ({
    etiquette: 'Interlocuteur', valeur: [c.prenom, c.nom].filter(Boolean).join(' ') || '',
    exemple: 'Qui décroche', aide: 'La personne qu’on demande quand on appelle la société.'
  });

  /* --- les coordonnées --------------------------------------------------- */

  const tel = champ({
    etiquette: 'Téléphone', type: 'tel', valeur: c.tel || '', exemple: '06 12 34 56 78'
  });
  const tel2 = champ({
    etiquette: 'Second téléphone', type: 'tel', valeur: c.tel2 || '', exemple: 'Fixe, atelier…'
  });
  const email = champ({ etiquette: 'E-mail', type: 'email', valeur: c.email || '' });
  const alerteEmail = h('div.minus', { style: { color: 'var(--alerte)' } });
  const adresse = champ({
    etiquette: 'Adresse', valeur: c.adresse || '', exemple: '12 rue des Ateliers'
  });
  const cp = champ({ etiquette: 'Code postal', valeur: c.cp || '', exemple: '80000' });
  const ville = champ({ etiquette: 'Ville', valeur: c.ville || '', exemple: 'Amiens' });

  /* --- la tarification --------------------------------------------------- */

  const taux = nombre(e.reglages && e.reglages.tauxHoraire, 65);
  const tauxPro = nombre(e.reglages && e.reglages.tauxHorairePro, 52);
  const grille = champ({
    etiquette: 'Grille appliquée', type: 'liste',
    valeur: c.grille || (type === 'pro' ? 'pro' : 'part'),
    options: [
      {
        valeur: 'part',
        texte: 'Particulier — ' + fmt.euros(taux, { sansCentimes: true }) + ' HT de l’heure'
      },
      {
        valeur: 'pro',
        texte: 'Confrère — ' + fmt.euros(tauxPro, { sansCentimes: true }) + ' HT de l’heure'
      }
    ],
    aide: 'Indépendante du type de fiche : un ancien collègue peut garder la '
      + 'grille confrère sans être une société, et une société peut payer plein tarif.'
  });
  const remise = champ({
    etiquette: 'Remise supplémentaire', type: 'nombre', unite: '%',
    valeur: nombre(c.remise, 0),
    aide: 'Elle sert de base quand on remise une ligne de devis. Elle ne se '
      + 'déduit pas toute seule du total : c’est la remise du document qui le fait.'
  });

  /* --- le reste ---------------------------------------------------------- */

  const codeEbpChamp = champ({
    etiquette: 'Code EBP', valeur: c.codeEbp || '',
    aide: 'Le code sous lequel EBP connaît ce client. Laissé vide, il se propose tout seul.'
  });
  const notes = champ({
    etiquette: 'Notes', type: 'zone', lignes: 3, valeur: c.notes || '',
    exemple: 'Ce qu’il faut savoir avant de l’appeler.'
  });

  /* --- la bascule particulier / professionnel ----------------------------- */

  const zoneIdentite = h('div.pile-s');
  const btPart = h('button', {
    type: 'button', texte: 'Particulier', onclick: () => choisirType('part')
  });
  const btPro = h('button', {
    type: 'button', texte: 'Professionnel', onclick: () => choisirType('pro')
  });
  const segments = h('div.segments.segments--plein', { role: 'group' }, [btPart, btPro]);

  function choisirType(t) {
    if (t === type) return;
    /* Le nom saisi d'un côté suit de l'autre : quelqu'un qui commence en
       particulier puis se ravise ne doit pas retaper le nom, et l'écrire deux
       fois donnerait deux orthographes. */
    if (t === 'pro') contact.ecrire([prenom.lire(), nom.lire()].filter(Boolean).join(' '));
    else {
      const duo = decouperNom(contact.lire());
      if (duo.nom) { nom.ecrire(duo.nom); prenom.ecrire(duo.prenom); }
    }
    type = t;
    /* Changer de type change la grille par défaut, mais jamais une grille déjà
       choisie à la main : on ne défait pas un geste volontaire. */
    if (!c.grille) grille.ecrire(t === 'pro' ? 'pro' : 'part');
    peindreIdentite();
    verifierDoublon();
  }

  function peindreIdentite() {
    btPart.setAttribute('aria-pressed', type === 'part' ? 'true' : 'false');
    btPro.setAttribute('aria-pressed', type === 'pro' ? 'true' : 'false');
    /* Les champs sont construits une fois pour toutes : on les déplace, on ne
       les recrée pas, sinon la bascule effacerait ce qui vient d'être tapé. */
    poser(zoneIdentite, type === 'pro'
      ? [grilleChamps([societe, siret, tvaIntra]), contact.noeud]
      : [grilleChamps([civilite, nom, prenom])]);
  }

  /* --- doublons ---------------------------------------------------------- */

  const alerteDoublon = h('div');
  let fenetre = null;
  let doublon = null;

  /**
   * On prévient PENDANT la saisie, pas à l'enregistrement : une fiche en
   * double se répare mal (l'historique se coupe en deux, la dette se compte
   * deux fois), et à l'enregistrement tout le reste a déjà été tapé pour rien.
   */
  function verifierDoublon() {
    const nomEnCours = type === 'pro'
      ? societe.lire()
      : [prenom.lire(), nom.lire()].filter(Boolean).join(' ');
    doublon = chercherDoublon(e, c.id, nomEnCours, tel.lire());
    if (!doublon) { poser(alerteDoublon, []); return; }

    const trouve = doublon.client;
    poser(alerteDoublon, h('div.bandeau.bandeau--alerte', [
      icone('alerte'),
      h('div.grandit', [
        h('div', (doublon.raison === 'tel'
          ? 'Ce numéro est déjà sur une fiche : '
          : 'Ce nom existe déjà : ')
          + lit.nomClient(trouve) + (trouve.ville ? ' — ' + trouve.ville : '') + '.'),
        h('button.bt.bt--nu.bt--s', {
          type: 'button',
          onclick: () => {
            if (fenetre) fenetre.fermer(null);
            location.hash = '#/client/' + trouve.id;
          }
        }, [icone('ouvrir', { taille: 14 }), h('span', 'Ouvrir cette fiche')])
      ])
    ]));
  }
  const verifierPlusTard = attend(verifierDoublon, 250);
  for (const ch of [nom, prenom, societe, tel]) {
    ch.entree.addEventListener('input', verifierPlusTard);
  }

  /* --- e-mail : on avertit, on ne bloque pas ------------------------------ */

  function verifierEmail() {
    const t = email.lire();
    alerteEmail.textContent = !t || emailValide(t)
      ? ''
      : 'Cette adresse a l’air incomplète : il manque un @ ou ce qui suit le point.';
  }
  email.entree.addEventListener('input', attend(verifierEmail, 250));

  /* --- code EBP : proposé, jamais imposé ---------------------------------- */

  /** EBP retrouve un client par son code : mieux vaut qu'il ressemble au nom
   *  plutôt qu'il reste vide, et on le laisse corrigeable. */
  function proposerCode() {
    if (String(codeEbpChamp.lire()).trim()) return;
    codeEbpChamp.ecrire(codeEbp(e, {
      type,
      nom: nom.lire() || decouperNom(contact.lire()).nom,
      prenom: prenom.lire(),
      societe: societe.lire(),
      cree: c.cree || Date.now()
    }));
  }
  for (const ch of [nom, societe, contact]) {
    ch.entree.addEventListener('blur', proposerCode);
  }

  peindreIdentite();
  verifierEmail();
  verifierDoublon();
  if (edition) proposerCode();

  const bloc = (titre, contenu) => h('div.pile-s', [h('div.majuscule', titre), contenu]);

  fenetre = modale({
    titre: edition ? 'Modifier le client' : 'Nouveau client',
    taille: 'large',
    corps: h('div.pile', [
      segments,
      zoneIdentite,
      alerteDoublon,
      bloc('Coordonnées', h('div.pile-s', [
        grilleChamps([tel, tel2]),
        email.noeud,
        alerteEmail,
        adresse.noeud,
        grilleChamps([cp, ville])
      ])),
      bloc('Tarification', grilleChamps([grille, remise])),
      bloc('Comptabilité', codeEbpChamp.noeud),
      notes.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: edition ? 'Enregistrer' : 'Créer le client', ton: 'fort',
        faire: () => {
          /* Un interlocuteur de société se range dans nom/prénom, comme pour un
             particulier : c'est le même carnet d'adresses, et l'export EBP
             comme le portail confrère y lisent les mêmes champs. */
          const duo = type === 'pro'
            ? decouperNom(contact.lire())
            : { prenom: prenom.lire(), nom: nom.lire() };
          const societeSaisie = societe.lire();

          if (!duo.nom && !societeSaisie) {
            if (type === 'pro') societe.erreur('Une raison sociale, ou au moins un interlocuteur.');
            else nom.erreur('Un nom, au minimum.');
            return false;
          }
          nom.erreur('');
          societe.erreur('');

          const champs = {
            type,
            civilite: type === 'pro' ? '' : civilite.lire(),
            nom: duo.nom,
            prenom: duo.prenom,
            societe: societeSaisie,
            siret: type === 'pro' ? siret.lire() : (c.siret || ''),
            tvaIntra: type === 'pro' ? tvaIntra.lire() : (c.tvaIntra || ''),
            tel: tel.lire(),
            tel2: tel2.lire(),
            email: email.lire(),
            adresse: adresse.lire(),
            cp: cp.lire(),
            ville: ville.lire(),
            grille: grille.lire() === 'pro' ? 'pro' : 'part',
            remise: borne(nombre(remise.lire(), 0), 0, 100),
            codeEbp: codeEbpChamp.lire(),
            notes: notes.lire()
          };

          const enregistre = edition
            ? change('clients', c.id, champs, 'Client modifié')
            : maj('Client créé', (etat) => {
                const x = nouveauClient(champs);
                etat.clients.push(x);
                return x;
              });

          if (apres) apres(enregistre || Object.assign({ id: c.id }, champs));
        }
      }
    ]
  });

  return fenetre;
}

/* ==========================================================================
   PETITES MAINS
   ========================================================================== */

/**
 * La fiche qui ressemble le plus à celle qu'on est en train de saisir : même
 * nom, ou même numéro de téléphone. Le numéro passe en premier — deux Martin
 * peuvent coexister, deux fiches sur la même ligne téléphonique presque
 * jamais.
 */
function chercherDoublon(e, idCourant, nomSaisi, telSaisi) {
  const t = telNu(telSaisi);
  if (t.length >= 9) {
    const parTel = (e.clients || []).find(x => x.id !== idCourant
      && [x.tel, x.tel2].filter(Boolean).some(y => telNu(y) === t));
    if (parTel) return { client: parTel, raison: 'tel' };
  }

  const n = nu(nomSaisi).replace(/\s+/g, ' ').trim();
  if (n.length >= 3) {
    const parNom = (e.clients || []).find(x => x.id !== idCourant
      && nu(lit.nomClient(x)).replace(/\s+/g, ' ').trim() === n);
    if (parNom) return { client: parNom, raison: 'nom' };
  }
  return null;
}

/** « Jean-Pierre Martin » → prénom « Jean-Pierre », nom « Martin ». Le dernier
 *  mot fait le nom : c'est faux pour « Van Damme », vrai neuf fois sur dix, et
 *  toujours corrigeable à la main sur la fiche. */
function decouperNom(entier) {
  const mots = String(entier || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return { prenom: '', nom: '' };
  if (mots.length === 1) return { prenom: '', nom: mots[0] };
  return { prenom: mots.slice(0, -1).join(' '), nom: mots[mots.length - 1] };
}
