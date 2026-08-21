/* ==========================================================================
   YATECH — écran « Véhicules »
   --------------------------------------------------------------------------
   Le parc roulant connu du garage. Cet écran ne sert presque jamais à lire la
   liste en entier : il sert à RETROUVER une voiture. On a la plaque sous les
   yeux, ou trois lettres du modèle, ou le nom du propriétaire au téléphone —
   et il faut tomber dessus tout de suite. Le champ de recherche est donc la
   pièce maîtresse, tout le reste vient après.

   La fenêtre de saisie d'un véhicule vit ici et s'exporte : la fiche client,
   la fiche véhicule et l'ouverture d'un dossier l'appellent toutes, pour que
   la même voiture se décrive partout de la même façon.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, vide } from '../core/ui.js';
import { maj, change } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import {
  plaqueNue, plaqueJolie, vinValide, nu, par, attend, surligne, unique, nombre, pluriel
} from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import { nouveauVehicule, PROTOCOLES } from '../domain/schema.js';
import {
  enTete, champ, grilleChamps, plaque, barreRecherche, filtres, choixClient
} from '../ui/widgets.js';

/* Le schéma range l'énergie et la boîte sous forme de clés : les libellés
   lisibles n'existent nulle part ailleurs, on les tient ici. */
const ENERGIES = {
  diesel: 'Diesel',
  essence: 'Essence',
  hybride: 'Hybride',
  electrique: 'Électrique',
  gpl: 'GPL'
};

const BOITES = {
  manuelle: 'Manuelle',
  automatique: 'Automatique'
};

/** Les tris proposés, avec le sens qui va de soi pour chacun : une plaque se
 *  lit dans l'ordre, un kilométrage et un passage se lisent du plus récent. */
const TRIS = [
  { cle: 'plaque', nom: 'Plaque', sens: 'asc' },
  { cle: 'marque', nom: 'Marque', sens: 'asc' },
  { cle: 'km', nom: 'Kilométrage', sens: 'desc' },
  { cle: 'passage', nom: 'Dernier passage', sens: 'desc' }
];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;

  let requete = String((ctx.query && ctx.query.q) || '').trim();
  let filtre = String((ctx.query && ctx.query.filtre) || 'tous');
  let tri = 'plaque';
  let sens = 'asc';

  const racine = h('div.pile');
  const zoneFiltres = h('div');
  const zoneListe = h('div');

  /* Le rang du dernier passage se calcule une fois par peinture : sans cette
     table, chaque ligne relirait tous les dossiers du garage. */
  let passages = derniersPassages(e);
  let auGarage = vehiculesAuGarage(e);

  /** Repeint la liste et les compteurs de filtres, en gardant le curseur dans
   *  le champ de recherche : c'est là qu'on tape, on ne doit pas l'en sortir. */
  function refaireListe() {
    const base = vehiculesRetenus(e, requete);
    poser(zoneFiltres, filtres(
      FILTRES.map(f => ({
        cle: f.cle, texte: f.texte, icone: f.icone,
        compte: base.filter(v => f.garde(v, e, auGarage)).length
      })),
      filtre,
      (cle) => { filtre = cle; refaireListe(); }
    ));
    const f = FILTRES.find(x => x.cle === filtre) || FILTRES[0];
    const liste = base.filter(v => f.garde(v, e, auGarage)).sort(comparateur(tri, sens, passages));
    poser(zoneListe, liste.length
      ? tableau(e, liste, requete, passages, { tri, sens, surTri: changerTri })
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
    passages = derniersPassages(e);
    auGarage = vehiculesAuGarage(e);
    poser(racine, contenu());
    refaireListe();
  }

  function contenu() {
    const vivants = (e.vehicules || []).filter(v => !v.archive);
    const proprietaires = unique(vivants.map(v => v.clientId).filter(Boolean)).length;

    return [
      enTete({
        titre: 'Véhicules',
        sous: pluriel(vivants.length, 'véhicule') + ', ' + pluriel(proprietaires, 'propriétaire'),
        actions: [
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => modaleVehicule(e, null, (v) => {
              refaireTout();
              message('Véhicule ' + plaqueJolie(v.immat) + ' enregistré', { ton: 'ok' });
            })
          }, [icone('plus'), h('span', 'Nouveau véhicule')])
        ]
      }),
      h('div.vehicules-chercher', barreRecherche({
        valeur: requete,
        exemple: 'Plaque, marque, modèle, moteur, VIN, propriétaire, calculateur…',
        surChangement: (v) => { requete = v; refaireListe(); }
      })),
      h('div.vehicules-outils', [
        zoneFiltres,
        h('label.vehicules-tri-mobile', [
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
   CE QU'ON RETIENT — recherche puis filtre
   ========================================================================== */

const FILTRES = [
  { cle: 'tous', texte: 'Tous', garde: (v) => !v.archive },
  {
    cle: 'garage', texte: 'Au garage en ce moment', icone: 'atelier',
    garde: (v, e, auGarage) => !v.archive && auGarage.has(v.id)
  },
  { cle: 'diesel', texte: 'Diesel', garde: (v) => !v.archive && v.energie === 'diesel' },
  { cle: 'essence', texte: 'Essence', garde: (v) => !v.archive && v.energie === 'essence' },
  {
    cle: 'ecu', texte: 'Avec calculateur connu', icone: 'puce',
    garde: (v) => !v.archive && !!(v.ecu && String(v.ecu.type || '').trim())
  },
  { cle: 'archives', texte: 'Archivés', icone: 'archive', garde: (v) => !!v.archive }
];

/** Les véhicules que la recherche laisse passer, archivés compris : c'est le
 *  filtre qui décide ensuite lesquels s'affichent. */
function vehiculesRetenus(e, requete) {
  const liste = (e.vehicules || []);
  if (!requete) return liste.slice();
  return liste.filter(v => correspondVehicule(e, v, requete));
}

/**
 * Un véhicule répond à la recherche si CHAQUE mot tapé se retrouve quelque
 * part : dans sa plaque, sa marque, son modèle, sa motorisation, son VIN, le
 * nom de son propriétaire ou le type de son calculateur.
 *
 * La plaque est comparée sous sa forme nue des deux côtés : « ej456 » doit
 * tomber sur « EJ-456-QT », et « EJ-456 » aussi.
 */
function correspondVehicule(e, v, requete) {
  const texte = nu(texteCherchable(e, v));
  const immat = plaqueNue(v.immat);
  const mots = String(requete).trim().split(/\s+/).filter(Boolean);
  return mots.every(m => {
    if (texte.includes(nu(m))) return true;
    const p = plaqueNue(m);
    return p.length >= 2 && immat.includes(p);
  });
}

function texteCherchable(e, v) {
  const prop = v.clientId ? lit.client(e, v.clientId) : null;
  return [
    v.immat, plaqueNue(v.immat), v.marque, v.modele, v.finition, v.motorisation,
    v.cylindree, v.vin, v.couleur, v.clefs,
    prop ? lit.nomClient(prop) : '',
    v.ecu ? v.ecu.type : '', v.ecu ? v.ecu.marque : ''
  ].filter(Boolean).join(' ');
}

/** Les véhicules dont un dossier est ouvert : ceux qui sont chez nous. */
function vehiculesAuGarage(e) {
  return new Set(lit.dossiersOuverts(e).map(d => d.vehiculeId).filter(Boolean));
}

/** Le dernier passage de chaque véhicule : sa sortie, sinon son entrée. */
function derniersPassages(e) {
  const m = new Map();
  for (const d of e.dossiers || []) {
    if (!d.vehiculeId) continue;
    const t = d.sortie || d.entree || d.cree || 0;
    if (t > (m.get(d.vehiculeId) || 0)) m.set(d.vehiculeId, t);
  }
  return m;
}

function comparateur(tri, sens, passages) {
  if (tri === 'marque') return par(v => [v.marque, v.modele].filter(Boolean).join(' ') || null, sens);
  if (tri === 'km') return par(v => (v.km === null || v.km === undefined ? null : v.km), sens);
  if (tri === 'passage') return par(v => passages.get(v.id) || null, sens);
  return par(v => plaqueNue(v.immat) || null, sens);
}

/* ==========================================================================
   LE TABLEAU
   ========================================================================== */

function tableau(e, liste, requete, passages, triage) {
  /* Au clavier comme à la souris, on trie en cliquant la colonne ; le doigt,
     lui, passe par la liste déroulante de la barre d'outils. */
  const enteteTriable = (cle, nom, classe) => {
    const actif = triage.tri === cle;
    return h('th' + (classe || ''), {
      'aria-sort': actif ? (triage.sens === 'asc' ? 'ascending' : 'descending') : 'none'
    }, [
      h('button.vehicules-tri' + (actif ? '.vehicules-tri--actif' : ''), {
        type: 'button', onclick: () => triage.surTri(cle)
      }, [
        h('span', nom),
        icone(actif ? (triage.sens === 'asc' ? 'haut' : 'bas') : 'trier', { taille: 13 })
      ])
    ]);
  };

  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      enteteTriable('plaque', 'Plaque'),
      enteteTriable('marque', 'Marque & modèle'),
      h('th', 'Motorisation'),
      h('th', 'Énergie'),
      enteteTriable('km', 'Km', '.num'),
      h('th', 'Propriétaire'),
      enteteTriable('passage', 'Dernier passage'),
      h('th', 'Calculateur')
    ])),
    h('tbody', liste.map(v => ligne(e, v, requete, passages)))
  ]));
}

function ligne(e, v, requete, passages) {
  const prop = v.clientId ? lit.client(e, v.clientId) : null;
  const passage = passages.get(v.id) || null;
  const aller = () => { location.hash = '#/vehicule/' + v.id; };

  return h('tr.cliquable', {
    tabindex: 0,
    style: v.archive ? { opacity: '.6' } : null,
    onclick: aller,
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); }
    }
  }, [
    h('td.serre', { donnees: { col: 'Plaque' } }, plaque(v.immat) || h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Marque & modèle' } }, [
      h('div.gras.coupe', { html: surligne([v.marque, v.modele].filter(Boolean).join(' ') || '—', requete) }),
      v.finition ? h('div.minus.tres-faible.coupe', { html: surligne(v.finition, requete) }) : null
    ]),
    h('td', { donnees: { col: 'Motorisation' } },
      v.motorisation
        ? h('span', { html: surligne(v.motorisation, requete) })
        : h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Énergie' } },
      h('span' + (v.energie ? '' : '.tres-faible'), ENERGIES[v.energie] || '—')),
    h('td.num', { donnees: { col: 'Km' } },
      v.km ? h('span', fmt.km(v.km)) : h('span.tres-faible', '—')),
    h('td', { donnees: { col: 'Propriétaire' } },
      prop
        ? h('a', {
            href: '#/client/' + prop.id,
            /* La ligne entière mène au véhicule : sans ça, le clic sur le nom
               partirait chez le client puis serait aussitôt écrasé. */
            onclick: (ev) => ev.stopPropagation(),
            html: surligne(lit.nomClient(prop), requete)
          })
        : h('span.tres-faible', 'sans propriétaire')),
    h('td', { donnees: { col: 'Dernier passage' } }, passage
      ? h('div', [
          h('div', fmt.date(passage, 'court')),
          h('div.minus.tres-faible', fmt.quand(passage, { avecHeure: false }))
        ])
      : h('span.tres-faible', 'jamais venu')),
    h('td', { donnees: { col: 'Calculateur' } },
      v.ecu && String(v.ecu.type || '').trim()
        ? h('span.etiq', { html: surligne(v.ecu.type, requete) })
        : h('span.tres-faible', '—'))
  ]);
}

function rienTrouve(e, requete, filtre, refaire) {
  if (requete) {
    return vide({
      icone: 'chercher',
      titre: 'Aucun véhicule pour « ' + requete + ' »',
      texte: 'Essayez trois lettres de la plaque, la marque, ou le nom du propriétaire.',
      action: { texte: 'Créer ce véhicule', faire: () => modaleVehicule(e, null, refaire) }
    });
  }
  if (filtre === 'archives') {
    return vide({ icone: 'archive', titre: 'Aucun véhicule archivé', texte: 'Tout le parc connu est actif.' });
  }
  if (filtre !== 'tous') {
    return vide({ icone: 'vehicule', titre: 'Aucun véhicule dans ce filtre' });
  }
  return vide({
    icone: 'vehicule',
    titre: 'Aucun véhicule enregistré',
    texte: 'Le parc se remplit tout seul au fil des dossiers ; on peut aussi ajouter une voiture à l’avance.',
    action: { texte: 'Nouveau véhicule', faire: () => modaleVehicule(e, null, refaire) }
  });
}

/* ==========================================================================
   LA FENÊTRE VÉHICULE — création et modification
   --------------------------------------------------------------------------
   Une seule fenêtre pour les deux : ce qu'on saisit à la création est
   exactement ce qu'on corrige six mois plus tard.
   ========================================================================== */

/**
 * @param {object}   e                  l'état
 * @param {object}   [vehicule]         la fiche à modifier, ou rien pour créer
 * @param {function} [apres]            rappelée avec le véhicule enregistré
 * @param {string}   [clientIdParDefaut] propriétaire imposé (fiche client)
 */
export function modaleVehicule(e, vehicule, apres, clientIdParDefaut) {
  const edition = !!vehicule;
  const v = vehicule || {};
  const ecu = v.ecu || {};

  const proprietaire = choixClient({
    etat: e,
    etiquette: 'Propriétaire',
    valeur: v.clientId || clientIdParDefaut || null
  });

  const immat = champ({
    etiquette: 'Immatriculation', type: 'plaque', valeur: v.immat || '',
    obligatoire: true, autofocus: !edition, exemple: 'EJ-456-QT'
  });
  const alerteDoublon = h('div');

  const vin = champ({
    etiquette: 'VIN', valeur: v.vin || '', exemple: 'VF3XXXXXXXXXXXXXX',
    aide: 'Sur la carte grise, repère E. 17 caractères.'
  });
  const alerteVin = h('div.minus', { style: { color: 'var(--alerte)' } });

  const marque = champ({ etiquette: 'Marque', valeur: v.marque || '', exemple: 'Peugeot' });
  const modele = champ({ etiquette: 'Modèle', valeur: v.modele || '', exemple: '308' });
  const finition = champ({ etiquette: 'Finition', valeur: v.finition || '', exemple: 'Allure' });
  const motorisation = champ({
    etiquette: 'Motorisation', valeur: v.motorisation || '', exemple: '1.6 BlueHDi 120'
  });
  const cylindree = champ({ etiquette: 'Cylindrée', valeur: v.cylindree || '', exemple: '1560 cm³' });
  const energie = champ({
    etiquette: 'Énergie', type: 'liste', valeur: v.energie || '',
    options: [{ valeur: '', texte: 'Non précisée' }]
      .concat(Object.keys(ENERGIES).map(k => ({ valeur: k, texte: ENERGIES[k] })))
  });
  const puissanceCh = champ({
    etiquette: 'Puissance', type: 'nombre', unite: 'ch',
    valeur: v.puissanceCh === null || v.puissanceCh === undefined ? '' : v.puissanceCh
  });
  const puissanceFisc = champ({
    etiquette: 'Puissance fiscale', type: 'nombre', unite: 'CV',
    valeur: v.puissanceFisc === null || v.puissanceFisc === undefined ? '' : v.puissanceFisc
  });
  const boite = champ({
    etiquette: 'Boîte', type: 'liste', valeur: v.boite || '',
    options: [{ valeur: '', texte: 'Non précisée' }]
      .concat(Object.keys(BOITES).map(k => ({ valeur: k, texte: BOITES[k] })))
  });
  const couleur = champ({ etiquette: 'Couleur', valeur: v.couleur || '', exemple: 'Gris Artense' });
  const dateMec = champ({
    etiquette: 'Première mise en circulation', type: 'date', valeur: v.dateMec || null
  });
  const km = champ({
    etiquette: 'Kilométrage', type: 'km', unite: 'km',
    valeur: v.km === null || v.km === undefined ? '' : v.km
  });
  const clefs = champ({
    etiquette: 'Repère du trousseau', valeur: v.clefs || '', exemple: 'Crochet 12',
    aide: 'Où sont pendues les clés au tableau.'
  });

  const ecuMarque = champ({ etiquette: 'Marque du calculateur', valeur: ecu.marque || '', exemple: 'Bosch' });
  const ecuType = champ({ etiquette: 'Type', valeur: ecu.type || '', exemple: 'EDC17C60' });
  const ecuHw = champ({ etiquette: 'Version matérielle (HW)', valeur: ecu.hw || '' });
  const ecuSw = champ({ etiquette: 'Version logicielle (SW)', valeur: ecu.sw || '' });
  const ecuProtocole = champ({
    etiquette: 'Protocole d’accès', type: 'liste', valeur: ecu.protocole || '',
    options: [{ valeur: '', texte: 'Non connu' }]
      .concat(Object.keys(PROTOCOLES).map(k => ({ valeur: k, texte: PROTOCOLES[k].nom }))),
    aide: aideProtocole(ecu.protocole)
  });
  ecuProtocole.entree.addEventListener('change', () => {
    const bulle = ecuProtocole.noeud.querySelector('.champ__aide');
    if (bulle) bulle.textContent = aideProtocole(ecuProtocole.lire());
  });

  const notes = champ({
    etiquette: 'Notes', type: 'zone', lignes: 3, valeur: v.notes || '',
    exemple: 'Ce qu’il faut savoir avant de toucher à cette voiture.'
  });

  let fenetre = null;
  let doublon = null;

  /* La plaque est la seule chose qui distingue vraiment deux voitures : on
     signale le doublon pendant la frappe, pas à l'enregistrement, quand tout
     le reste a déjà été saisi pour rien. */
  function verifierDoublon() {
    const p = plaqueNue(immat.lire());
    doublon = p.length >= 5
      ? (e.vehicules || []).find(x => x.id !== v.id && plaqueNue(x.immat) === p) || null
      : null;

    if (!doublon) { poser(alerteDoublon, []); return; }
    const prop = doublon.clientId ? lit.client(e, doublon.clientId) : null;
    poser(alerteDoublon, h('div.bandeau.bandeau--alerte', [
      icone('alerte'),
      h('div.grandit', [
        h('div', 'Cette plaque est déjà enregistrée : ' + lit.nomVehiculeLong(doublon)
          + (prop ? ', à ' + lit.nomClient(prop) : ', sans propriétaire') + '.'),
        h('button.bt.bt--nu.bt--s', {
          type: 'button',
          onclick: () => {
            if (fenetre) fenetre.fermer(null);
            location.hash = '#/vehicule/' + doublon.id;
          }
        }, [icone('ouvrir', { taille: 14 }), h('span', 'Ouvrir cette fiche')])
      ])
    ]));
  }
  immat.entree.addEventListener('input', attend(verifierDoublon, 250));
  verifierDoublon();

  /* Un VIN faux se remarque à l'œil : 17 caractères, et jamais de I, O ni Q
     (on les confond avec 1 et 0). On avertit sans bloquer : une carte grise
     étrangère ou un vieux châssis peut sortir de la règle. */
  function verifierVin() {
    const t = vin.lire().replace(/\s/g, '');
    if (!t || vinValide(t)) { alerteVin.textContent = ''; return; }
    alerteVin.textContent = t.length !== 17
      ? 'Ce VIN a ' + t.length + ' caractères au lieu de 17. À revérifier sur la carte grise.'
      : 'Ce VIN contient un I, un O ou un Q : ce sont des 1 et des 0. À revérifier.';
  }
  vin.entree.addEventListener('input', attend(verifierVin, 250));
  verifierVin();

  const bloc = (titre, champs) => h('div.pile-s', [h('div.majuscule', titre), grilleChamps(champs)]);

  fenetre = modale({
    titre: edition ? 'Modifier le véhicule' : 'Nouveau véhicule',
    taille: 'large',
    corps: h('div.pile', [
      proprietaire.noeud,
      h('hr'),
      immat.noeud,
      alerteDoublon,
      h('div.pile-s', [vin.noeud, alerteVin]),
      bloc('Le véhicule', [marque, modele, finition]),
      bloc('Le moteur', [motorisation, cylindree, energie, puissanceCh, puissanceFisc, boite]),
      bloc('Le reste', [couleur, dateMec, km, clefs]),
      h('details.vehicules-repli', [
        h('summary', [icone('puce', { taille: 16 }), h('span', 'Calculateur')]),
        h('div.vehicules-repli__corps', [
          h('div.petit.faible',
            'C’est ce qu’on cherche en premier quand le véhicule revient pour de '
            + 'l’électronique : le noter aujourd’hui évite de redéposer le cache moteur demain.'),
          grilleChamps([ecuMarque, ecuType, ecuHw, ecuSw]),
          ecuProtocole.noeud
        ])
      ]),
      notes.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: edition ? 'Enregistrer' : 'Créer le véhicule', ton: 'fort',
        faire: async () => {
          if (!immat.lire()) { immat.erreur('Une plaque, au minimum.'); return false; }
          immat.erreur('');

          verifierDoublon();
          if (doublon && !await confirmer({
            titre: 'Cette plaque existe déjà',
            texte: 'Une autre fiche porte déjà ' + plaqueJolie(immat.lire())
              + (edition
                ? '. Deux véhicules sur la même plaque, c’est un historique coupé en deux.'
                : '. Enregistrer quand même créera un second véhicule identique.'),
            ok: 'Enregistrer quand même'
          })) return false;

          const champs = {
            clientId: proprietaire.lire() || null,
            immat: immat.lire(),
            vin: vin.lire().toUpperCase(),
            marque: marque.lire(),
            modele: modele.lire(),
            finition: finition.lire(),
            motorisation: motorisation.lire(),
            cylindree: cylindree.lire(),
            energie: energie.lire(),
            puissanceCh: valeurOuRien(puissanceCh),
            puissanceFisc: valeurOuRien(puissanceFisc),
            boite: boite.lire(),
            couleur: couleur.lire(),
            dateMec: dateMec.lire(),
            clefs: clefs.lire(),
            notes: notes.lire(),
            ecu: {
              marque: ecuMarque.lire(), type: ecuType.lire(),
              hw: ecuHw.lire(), sw: ecuSw.lire(), protocole: ecuProtocole.lire()
            }
          };

          /* La date du relevé ne bouge que si le compteur bouge : sinon on
             daterait d'aujourd'hui un kilométrage vieux d'un an. */
          const kmLu = valeurOuRien(km);
          champs.km = kmLu;
          if (kmLu !== null && kmLu !== (v.km === undefined ? null : v.km)) {
            champs.kmReleveLe = Date.now();
          }

          const enregistre = edition
            ? change('vehicules', v.id, champs, 'Véhicule modifié')
            : maj('Véhicule créé', (etat) => {
                const x = nouveauVehicule(champs);
                etat.vehicules.push(x);
                return x;
              });

          if (apres) apres(enregistre || Object.assign({ id: v.id }, champs));
        }
      }
    ]
  });

  return fenetre;
}

/* ==========================================================================
   PETITES MAINS
   ========================================================================== */

/** Un champ numérique laissé vide vaut « pas renseigné », pas zéro : un
 *  véhicule sans puissance connue n'a pas 0 ch. */
function valeurOuRien(c) {
  return String(c.entree.value || '').trim() === '' ? null : nombre(c.lire(), null);
}

function aideProtocole(cle) {
  const p = PROTOCOLES[cle];
  return p ? p.aide : 'Par quel accès on lit ce calculateur.';
}
