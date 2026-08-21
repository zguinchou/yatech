/* ==========================================================================
   YATECH — écran « EBP »
   --------------------------------------------------------------------------
   La passerelle, dans les deux sens. EBP tient la facturation officielle :
   les numéros légaux, la comptabilité, ce qui part chez le comptable. Cet
   outil capte au téléphone, chiffre, suit l'atelier — puis repasse à EBP ce
   qu'il lui faut, sans que personne ne ressaisisse une ligne. Le lien tient à
   une seule chose : le même code client des deux côtés.

   Trois précautions donnent son dessin à cet écran :
     • rien n'est marqué « reporté » tant que le fichier n'est pas parti ;
     • rien n'est créé à l'import tant qu'on n'a pas vu ce qui sera créé ;
     • une restauration prévient, en toutes lettres, de ce qu'elle écrase.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { message, messageErreur, confirmer } from '../core/ui.js';
import { maj, instantane, remplacer, ecrireMaintenant } from '../core/store.js';
import { telecharger, nomDate, copier, choisirFichier, lireTexte } from '../core/fichiers.js';
import * as fmt from '../core/fmt.js';
import { pluriel } from '../core/util.js';
import { nouveauClient, neuf, normaliser } from '../domain/schema.js';
import { contexte, totaux } from '../domain/calculs.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import * as ebp from '../domain/ebp.js';
import { enTete, indic, champ, grilleChamps } from '../ui/widgets.js';

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  /* Ce qui est coché et le fichier en cours d'examen vivent ici, pas dans
     l'état : ce sont des gestes en train de se faire, pas des données du
     garage. Ils survivent aux repeints locaux — cocher vingt factures puis
     tout voir se décocher parce qu'un compteur a bougé serait insupportable. */
  const selection = { client: new Set(), facture: new Set(), devis: new Set() };
  const importation = {
    nomFichier: '', texte: '', entetes: [], carte: null,
    lignes: [], choix: new Map(), colonnesOuvertes: false
  };

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    const attente = ebp.enAttenteDeReport(e);
    return [
      enTete({ titre: 'EBP', sous: 'Ce qui reste à passer, et ce qui vient d’en revenir' }),
      bandeauPrincipe(),
      indicateurs(e, attente),
      sectionAReporter(e, attente, selection, refaire),
      sectionImport(e, importation, refaire),
      sectionColonnes(),
      sectionSauvegarde(e)
    ];
  }

  poser(racine, contenu());
  return racine;
}

/* ==========================================================================
   LE PRINCIPE — à lire une fois, et à retrouver quand on doute
   ========================================================================== */

function bandeauPrincipe() {
  return h('div.bandeau', [
    icone('info'),
    h('div.grandit.pile-s', [
      h('b', 'EBP tient la facturation officielle. Cet outil la prépare.'),
      h('div', 'On capte au téléphone, on chiffre, on suit l’atelier — puis on repasse à EBP '
        + 'ce qu’il lui faut : les clients, les factures émises, les devis acceptés. '
        + 'Rien n’est ressaisi deux fois.'),
      h('div.petit.faible', 'Le lien tient à une seule chose : le même code client des deux côtés. '
        + 'Tant qu’un client porte ici le code qu’il porte dans EBP, tout se recolle tout seul.')
    ])
  ]);
}

/* ==========================================================================
   LES CHIFFRES — ce qui dort en attendant d'être passé
   ========================================================================== */

function indicateurs(e, attente) {
  const duFactures = attente.factures.reduce((s, f) => s + ttcDe(e, f), 0);

  return h('div.grille-indics', [
    indic({
      nom: 'Clients à reporter',
      valeur: attente.clients.length,
      ton: attente.clients.length ? 'alerte' : null,
      detail: attente.clients.length ? 'créés ici, inconnus d’EBP' : 'tout le monde est passé'
    }),
    indic({
      nom: 'Factures à reporter',
      valeur: attente.factures.length,
      ton: attente.factures.length ? 'alerte' : null,
      detail: attente.factures.length
        ? fmt.euros(duFactures, { sansCentimes: true }) + ' TTC à saisir'
        : 'rien en souffrance'
    }),
    indic({
      nom: 'Devis acceptés',
      valeur: attente.devis.length,
      ton: attente.devis.length ? 'alerte' : null,
      detail: attente.devis.length ? 'acceptés, pas encore dans EBP' : 'rien à passer'
    })
  ]);
}

/** Le total TTC d'un devis ou d'une facture, à la grille de son client. */
function ttcDe(e, doc) {
  return totaux(doc, contexte(e.reglages, lit.client(e, doc.clientId))).ttc;
}

/* ==========================================================================
   À REPORTER — les trois listes qui se vident
   ========================================================================== */

function sectionAReporter(e, attente, selection, refaire) {
  const clients = attente.clients.slice().sort((a, b) => (a.cree || 0) - (b.cree || 0));
  const factures = attente.factures.slice()
    .sort((a, b) => (a.emiseLe || a.cree || 0) - (b.emiseLe || b.cree || 0));
  const devis = attente.devis.slice()
    .sort((a, b) => (a.repondeLe || a.emisLe || a.cree || 0) - (b.repondeLe || b.emisLe || b.cree || 0));

  return h('div.pile', [
    h('h2.majuscule.faible', 'À reporter'),

    panneauReport({
      cle: 'client', titre: 'Clients', ico: 'clients', selection, refaire,
      elements: clients,
      rienATransmettre: 'Aucun client à créer dans EBP.',
      exporter: (choisis) => ebp.telechargerClients(e, choisis),
      rangee: (c) => [
        h('div.grandit.coupe', [
          h('div.gras.coupe', lit.nomClient(c)),
          h('div.petit.faible.coupe', 'créé ' + fmt.quand(c.cree)
            + (c.ville ? ' · ' + c.ville : ''))
        ]),
        h('span.etiq', ebp.codeEbp(e, c))
      ]
    }),

    panneauReport({
      cle: 'facture', titre: 'Factures', ico: 'facture', selection, refaire,
      elements: factures,
      rienATransmettre: 'Aucune facture en attente de saisie dans EBP.',
      exporter: (choisis) => ebp.telechargerFactures(e, choisis),
      rangee: (f) => [
        h('div.grandit.coupe', [
          h('div.gras.coupe', f.numero || 'sans numéro'),
          h('div.petit.faible.coupe', lit.nomClient(lit.client(e, f.clientId))
            + ' · ' + fmt.date(f.emiseLe || f.cree, 'court'))
        ]),
        h('span.gras.num', fmt.euros(ttcDe(e, f))),
        boutonFiche(e, f)
      ]
    }),

    panneauReport({
      cle: 'devis', titre: 'Devis acceptés', ico: 'devis', selection, refaire,
      elements: devis,
      rienATransmettre: 'Aucun devis accepté en attente.',
      exporter: (choisis) => ebp.telechargerDevis(e, choisis),
      rangee: (d) => [
        h('div.grandit.coupe', [
          h('div.gras.coupe', d.numero || 'sans numéro'),
          h('div.petit.faible.coupe', lit.nomClient(lit.client(e, d.clientId)))
        ]),
        h('span.gras.num', fmt.euros(ttcDe(e, d)))
      ]
    })
  ]);
}

/** Le bouton « fiche à recopier » : au comptoir, sur téléphone, relire un
 *  résumé va plus vite qu'ouvrir un fichier dans EBP. */
function boutonFiche(e, doc) {
  return h('button.bt.bt--nu.bt--icone', {
    type: 'button',
    title: 'Copier la fiche à saisir',
    'aria-label': 'Copier la fiche à saisir',
    onclick: async () => {
      const ok = await copier(ebp.ficheASaisir(e, doc));
      message(ok ? 'Fiche copiée : collez-la dans EBP' : 'Copie impossible',
        { ton: ok ? 'ok' : 'danger' });
    }
  }, icone('copier'));
}

/**
 * Une liste cochable, son bouton d'export et sa règle d'or : on ne marque
 * jamais « reporté » si le fichier n'est pas parti.
 * @param {object} o { cle, titre, ico, elements, rangee(x), exporter(choisis),
 *                     selection, refaire, rienATransmettre }
 */
function panneauReport(o) {
  const sel = o.selection[o.cle];

  /* Ce qui vient de passer dans EBP a quitté la liste : on nettoie la
     sélection, sinon un identifiant fantôme y resterait coché pour toujours. */
  for (const identifiant of Array.from(sel)) {
    if (!o.elements.some(x => x.id === identifiant)) sel.delete(identifiant);
  }

  const entete = h('div.panneau__tete', [
    icone(o.ico, { taille: 16 }),
    h('h2.grandit', o.titre),
    h('span.compte' + (o.elements.length ? '.compte--accent' : ''), String(o.elements.length))
  ]);

  if (!o.elements.length) {
    return h('div.panneau', [
      entete,
      h('div.panneau__corps', h('div.petit.faible.centre', o.rienATransmettre))
    ]);
  }

  const cases = [];
  const toutCocher = h('input', {
    type: 'checkbox',
    'aria-label': 'Tout sélectionner',
    onchange: () => {
      for (const c of cases) {
        c.entree.checked = toutCocher.checked;
        if (toutCocher.checked) sel.add(c.id); else sel.delete(c.id);
      }
      rafraichir();
    }
  });

  const compteur = h('span.petit.faible');
  const boutonExport = h('button.bt.bt--fort', {
    type: 'button',
    onclick: () => exporter()
  }, [icone('telecharger'), h('span', 'Exporter la sélection en CSV')]);

  function rafraichir() {
    const n = sel.size;
    boutonExport.disabled = n === 0;
    poser(compteur, n ? pluriel(n, 'sélectionné') + ' sur ' + o.elements.length : 'rien de coché');
    toutCocher.checked = n > 0 && n === o.elements.length;
    /* L'état « partiellement coché » ne se pose que par script : sans lui, une
       sélection de trois lignes sur vingt affiche une case vide, comme si rien
       n'était choisi. */
    toutCocher.indeterminate = n > 0 && n < o.elements.length;
  }

  async function exporter() {
    const choisis = o.elements.filter(x => sel.has(x.id));
    if (!choisis.length) return;

    boutonExport.disabled = true;
    let parti = false;
    try { parti = await o.exporter(choisis); }
    catch (err) { parti = false; }
    boutonExport.disabled = false;

    /* Le cœur de l'affaire : un téléchargement refusé par le navigateur ou
       annulé ne doit surtout pas passer les documents pour reportés — ils
       disparaîtraient de la liste sans jamais avoir atteint EBP. */
    if (!parti) {
      messageErreur('Le fichier n’est pas parti. Rien n’a été marqué comme reporté.');
      return;
    }

    const marquer = await confirmer({
      titre: 'Fichier téléchargé',
      texte: 'Importez-le dans EBP, puis marquez ces ' + o.titre.toLowerCase()
        + ' comme reportés pour qu’ils quittent la liste.',
      detail: pluriel(choisis.length, 'élément') + ' dans le fichier. '
        + 'Si l’import échoue dans EBP, répondez « Plus tard » : la liste restera intacte.',
      ok: 'Marquer comme reportés',
      annuler: 'Plus tard'
    });
    if (!marquer) {
      message('Fichier gardé. Rien n’est marqué comme reporté.');
      return;
    }

    for (const x of choisis) act.reporterDansEbp(o.cle, x.id);
    sel.clear();
    message(pluriel(choisis.length, 'élément') + ' marqué'
      + (choisis.length > 1 ? 's' : '') + ' comme reporté'
      + (choisis.length > 1 ? 's' : ''), { ton: 'ok' });
    o.refaire();
  }

  const lignes = o.elements.map((x) => {
    const entree = h('input', {
      type: 'checkbox',
      checked: sel.has(x.id),
      'aria-label': 'Sélectionner',
      onchange: () => {
        if (entree.checked) sel.add(x.id); else sel.delete(x.id);
        rafraichir();
      }
    });
    cases.push({ id: x.id, entree });

    /* La case seule fait 18 px : on l'habille d'une étiquette de 38 px pour
       qu'elle se coche au doigt sans viser. */
    return h('div.liste__ligne.liste__ligne--muette', [
      h('label.coche', {
        style: { minWidth: '38px', minHeight: '38px', justifyContent: 'center', flex: 'none' }
      }, entree)
    ].concat(o.rangee(x)));
  });

  const panneau = h('div.panneau', [
    entete,
    h('div.panneau__corps.rang.enroule', [
      h('label.coche', { style: { minHeight: '38px' } },
        [toutCocher, h('span.petit', 'Tout sélectionner')]),
      compteur
    ]),
    h('div.liste', lignes),
    h('div.panneau__pied.rang.enroule', [boutonExport])
  ]);

  rafraichir();
  return panneau;
}

/* ==========================================================================
   IMPORTER DES CLIENTS DEPUIS EBP
   Le fichier est lu, montré, corrigé — et seulement ensuite écrit. Un import
   qui s'exécute avant qu'on ait vu ce qu'il fait est un import qu'on regrette.
   ========================================================================== */

/* Les champs qu'on sait reconnaître, dans l'ordre où on les relit. Les clés
   sont celles de `ebp.devinerColonnes`. */
const CHAMPS_IMPORT = [
  { cle: 'code', nom: 'Code client' },
  { cle: 'nom', nom: 'Nom ou raison sociale' },
  { cle: 'prenom', nom: 'Prénom' },
  { cle: 'civilite', nom: 'Civilité' },
  { cle: 'adresse', nom: 'Adresse' },
  { cle: 'cp', nom: 'Code postal' },
  { cle: 'ville', nom: 'Ville' },
  { cle: 'tel', nom: 'Téléphone' },
  { cle: 'tel2', nom: 'Portable' },
  { cle: 'email', nom: 'Courriel' },
  { cle: 'siret', nom: 'SIRET' },
  { cle: 'tva', nom: 'N° TVA' },
  { cle: 'type', nom: 'Type de tiers' },
  { cle: 'notes', nom: 'Commentaire' }
];

function sectionImport(e, imp, refaire) {
  const corps = h('div.panneau__corps.pile');

  function repeindreCorps() { poser(corps, imp.lignes.length ? apercu() : accueil()); }

  /* Relit le fichier gardé en mémoire avec la correspondance de colonnes du
     moment : changer une colonne rejoue toute l'analyse, doublons compris. */
  function analyser() {
    const lu = ebp.lireFichierClients(imp.texte, imp.carte);
    imp.entetes = lu.entetes;
    imp.carte = lu.carte;
    imp.lignes = ebp.repererDoublons(e, lu.lignes);
    /* Un doublon ne s'importe pas par défaut : on ne crée jamais un deuxième
       « DUPONT Jean » derrière le dos de la secrétaire. */
    imp.choix = new Map();
    for (const l of imp.lignes) if (l.existant) imp.choix.set(l.rang, 'ignorer');
    repeindreCorps();
  }

  function oublier() {
    imp.nomFichier = '';
    imp.texte = '';
    imp.entetes = [];
    imp.carte = null;
    imp.lignes = [];
    imp.choix = new Map();
    repeindreCorps();
  }

  async function ouvrirFichier() {
    const fichiers = await choisirFichier({ accepte: '.csv,text/csv,text/plain' });
    if (!fichiers.length) return;

    let texte = '';
    try { texte = await lireTexte(fichiers[0]); }
    catch (err) { messageErreur('Fichier illisible.'); return; }

    imp.nomFichier = fichiers[0].name || 'fichier';
    imp.texte = texte;
    imp.carte = null;              // on redevine, le fichier a changé

    const essai = ebp.lireFichierClients(texte, null);
    if (!essai.lignes.length) {
      oublier();
      messageErreur('Aucune ligne de client là-dedans. Il faut un CSV avec une ligne d’en-têtes.');
      return;
    }
    analyser();
  }

  /* --- avant qu'un fichier soit choisi ----------------------------------- */

  function accueil() {
    return [
      h('div.petit.faible', 'Sortez la liste des clients depuis EBP au format CSV, puis '
        + 'ouvrez-la ici. Rien n’est écrit tant que vous n’avez pas confirmé.'),
      h('div.rang.enroule', [
        h('button.bt.bt--contour', { type: 'button', onclick: ouvrirFichier },
          [icone('televerser'), h('span', 'Choisir un fichier CSV')])
      ])
    ];
  }

  /* --- l'aperçu : ce qui sera fait, ligne par ligne ---------------------- */

  function apercu() {
    const compteur = h('div.rang-s.enroule');

    function compter() {
      const c = { creer: 0, majour: 0, doublons: 0, invalides: 0 };
      for (const l of imp.lignes) {
        if (!l.valide) { c.invalides++; continue; }
        if (!l.existant) { c.creer++; continue; }
        c.doublons++;
        const choix = imp.choix.get(l.rang);
        if (choix === 'creer') c.creer++;
        else if (choix === 'majour') c.majour++;
      }
      return c;
    }

    function majCompteur() {
      const c = compter();
      poser(compteur, [
        h('span.pastille.pastille--ok.pastille--sans-point', pluriel(c.creer, 'à créer', 'à créer')),
        c.majour ? h('span.pastille.pastille--accent.pastille--sans-point',
          pluriel(c.majour, 'à mettre à jour', 'à mettre à jour')) : null,
        h('span.pastille.pastille--alerte.pastille--sans-point', pluriel(c.doublons, 'doublon')),
        h('span.pastille' + (c.invalides ? '.pastille--danger' : '') + '.pastille--sans-point',
          pluriel(c.invalides, 'ligne invalide', 'lignes invalides'))
      ]);
      boutonImporter.disabled = (c.creer + c.majour) === 0;
    }

    const boutonImporter = h('button.bt.bt--fort', {
      type: 'button',
      onclick: () => importer(compter())
    }, [icone('coche'), h('span', 'Importer')]);

    async function importer(c) {
      const total = c.creer + c.majour;
      if (!total) return;

      const ok = await confirmer({
        titre: 'Importer ces clients ?',
        texte: pluriel(c.creer, 'fiche') + ' à créer'
          + (c.majour ? ', ' + pluriel(c.majour, 'fiche') + ' à mettre à jour' : '') + '.',
        detail: [
          c.doublons ? pluriel(c.doublons, 'doublon reconnu', 'doublons reconnus') : null,
          c.invalides ? pluriel(c.invalides, 'ligne invalide', 'lignes invalides')
            + ' laissée' + (c.invalides > 1 ? 's' : '') + ' de côté' : null
        ].filter(Boolean).join(' · ') || 'Rien d’autre ne sera touché.',
        ok: 'Importer'
      });
      if (!ok) return;

      const fait = ecrireLignes(e, imp);
      message(pluriel(fait.crees, 'client créé', 'clients créés')
        + (fait.majs ? ', ' + pluriel(fait.majs, 'mis à jour', 'mis à jour') : ''),
        { ton: 'ok' });
      oublier();
      refaire();
    }

    const table = h('table.grille.repliable', [
      h('thead', h('tr', [
        h('th.serre', 'Ligne'),
        h('th', 'Ce qui sera créé'),
        h('th', 'Déjà connu ici'),
        h('th.serre', 'À faire')
      ])),
      h('tbody', imp.lignes.map(l => rangeeApercu(e, l, imp, majCompteur)))
    ]);

    majCompteur();

    return [
      h('div.rang.enroule', [
        h('div.grandit.coupe', [
          h('div.gras.coupe', imp.nomFichier),
          h('div.petit.faible', pluriel(imp.lignes.length, 'ligne') + ' lue'
            + (imp.lignes.length > 1 ? 's' : ''))
        ]),
        h('button.bt.bt--nu.bt--s', { type: 'button', onclick: ouvrirFichier },
          [icone('rafraichir'), h('span', 'Autre fichier')]),
        h('button.bt.bt--nu.bt--s', { type: 'button', onclick: oublier },
          [icone('croix'), h('span', 'Abandonner')])
      ]),
      blocColonnes(imp, analyser),
      compteur,
      h('div.tableau-cadre', table),
      h('div.rang.enroule', [boutonImporter])
    ];
  }

  repeindreCorps();

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('televerser', { taille: 16 }),
      h('h2.grandit', 'Importer des clients depuis EBP')
    ]),
    corps
  ]);
}

/** Une ligne du fichier, et la décision qu'on prend à son sujet. */
function rangeeApercu(e, l, imp, majCompteur) {
  const existant = l.existant ? lit.client(e, l.existant) : null;
  const nom = l.type === 'pro' ? l.societe : [l.prenom, l.nom].filter(Boolean).join(' ');
  const adresse = [l.cp, l.ville].filter(Boolean).join(' ');
  const contact = [l.tel, l.email].filter(Boolean).join(' · ');

  const decision = !l.valide
    ? h('span.pastille.pastille--danger.pastille--sans-point', 'ignorée')
    : (existant
        ? champ({
            type: 'liste',
            valeur: imp.choix.get(l.rang) || 'ignorer',
            options: [
              { valeur: 'ignorer', texte: 'Ignorer' },
              { valeur: 'majour', texte: 'Mettre à jour' },
              { valeur: 'creer', texte: 'Créer quand même' }
            ],
            surChangement: (v) => { imp.choix.set(l.rang, v); majCompteur(); }
          }).noeud
        : h('span.pastille.pastille--ok.pastille--sans-point', 'à créer'));

  return h('tr', { style: l.valide ? null : { opacity: '.55' } }, [
    h('td.serre', { donnees: { col: 'Ligne' } }, h('span.minus.tres-faible', String(l.rang))),
    h('td', { donnees: { col: 'Ce qui sera créé' } }, h('div.pile-s', [
      h('div.rang-s.enroule', [
        h('span.gras.coupe', nom || 'sans nom'),
        l.type === 'pro' ? h('span.etiq', 'pro') : null,
        l.codeEbp ? h('span.etiq', l.codeEbp) : null
      ]),
      adresse || contact
        ? h('div.petit.faible.coupe', [adresse, contact].filter(Boolean).join(' — '))
        : null,
      l.valide ? null : h('div.petit.faible', 'Pas de nom lisible dans la colonne choisie.')
    ])),
    h('td', { donnees: { col: 'Déjà connu ici' } }, existant
      ? h('a.coupe', { href: '#/client/' + existant.id }, lit.nomClient(existant))
      : h('span.tres-faible', '—')),
    h('td.serre', { donnees: { col: 'À faire' } }, decision)
  ]);
}

/** La correspondance des colonnes : devinée, montrée, corrigible. */
function blocColonnes(imp, analyser) {
  const options = [{ valeur: '', texte: '— aucune —' }]
    .concat(imp.entetes.map(x => ({ valeur: x, texte: x })));

  const devinees = CHAMPS_IMPORT.filter(c => imp.carte && imp.carte[c.cle]).length;

  const selecteurs = CHAMPS_IMPORT.map(c => champ({
    etiquette: c.nom,
    type: 'liste',
    options,
    valeur: (imp.carte && imp.carte[c.cle]) || '',
    surChangement: (v) => {
      imp.carte[c.cle] = v || null;
      analyser();
    }
  }).noeud);

  /* Corriger une colonne rejoue l'analyse, donc repeint ce bloc : sans cette
     mémoire, le volet se refermerait à chaque correction. */
  const volet = h('details.ebp-repli', {
    open: imp.colonnesOuvertes,
    ontoggle: () => { imp.colonnesOuvertes = volet.open; }
  }, [
    h('summary', [
      icone('filtre', { taille: 16 }),
      h('span.grandit', 'Correspondance des colonnes'),
      h('span.petit.faible', devinees + ' sur ' + CHAMPS_IMPORT.length + ' reconnues')
    ]),
    h('div.ebp-repli__corps', [
      h('div.petit.faible', 'Devinée d’après les en-têtes du fichier. Corrigez ce qui est '
        + 'de travers : l’aperçu se recalcule aussitôt.'),
      grilleChamps(selecteurs)
    ])
  ]);
  return volet;
}

/**
 * L'écriture, enfin. Tout part dans une seule modification : un import raté à
 * moitié s'annule d'un seul geste.
 */
function ecrireLignes(e, imp) {
  const bilan = { crees: 0, majs: 0 };

  maj('Import de clients depuis EBP', (etat) => {
    for (const l of imp.lignes) {
      if (!l.valide) continue;
      const choix = l.existant ? (imp.choix.get(l.rang) || 'ignorer') : 'creer';
      if (l.existant && choix === 'ignorer') continue;

      if (l.existant && choix === 'majour') {
        const c = (etat.clients || []).find(x => x.id === l.existant);
        if (!c) continue;
        /* On complète, on n'efface pas : une colonne vide dans le fichier ne
           doit pas emporter un numéro de portable noté ici au téléphone. */
        for (const cle of ['civilite', 'nom', 'societe', 'prenom', 'adresse', 'cp', 'ville',
          'tel', 'tel2', 'email', 'siret', 'tvaIntra', 'codeEbp']) {
          if (l[cle]) c[cle] = l[cle];
        }
        if (l.notes && !String(c.notes || '').includes(l.notes)) {
          c.notes = [c.notes, l.notes].filter(Boolean).join('\n');
        }
        /* Il vient d'EBP : il y est déjà, inutile de le lui repasser. */
        if (!c.ebp) c.ebp = Date.now();
        c.maj = Date.now();
        bilan.majs++;
        continue;
      }

      etat.clients.push(nouveauClient({
        type: l.type,
        civilite: l.civilite,
        nom: l.nom,
        prenom: l.prenom,
        societe: l.societe,
        siret: l.siret,
        tvaIntra: l.tvaIntra,
        tel: l.tel,
        tel2: l.tel2,
        email: l.email,
        adresse: l.adresse,
        cp: l.cp,
        ville: l.ville,
        grille: l.grille,
        codeEbp: l.codeEbp,
        notes: l.notes,
        ebp: Date.now()
      }));
      bilan.crees++;
    }
  });

  return bilan;
}

/* ==========================================================================
   RÉGLAGES DE L'EXPORT — les intitulés qu'EBP attend
   ========================================================================== */

function sectionColonnes() {
  const bloc = (titre, colonnes) => h('div.pile-s', [
    h('div.gras', titre),
    h('div.rang-s.enroule', colonnes.map(c => h('span.etiq', c)))
  ]);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('presse', { taille: 16 }),
      h('h2.grandit', 'Réglages de l’export')
    ]),
    h('div.panneau__corps.pile', [
      h('div.bandeau.bandeau--alerte', [
        icone('alerte'),
        h('div.grandit', [
          h('b', 'À vérifier au premier import.'),
          h('div', 'Ces intitulés de colonnes changent d’une version d’EBP à l’autre. '
            + 'Comparez-les une fois avec ce qu’attend votre EBP : si l’import refuse le '
            + 'fichier, c’est presque toujours de là que ça vient.')
        ])
      ]),
      bloc('Fichier des clients', ebp.COLONNES_CLIENTS),
      bloc('Fichier des documents de vente (devis et factures)', ebp.COLONNES_DOCUMENTS),
      h('div.petit.faible', 'Le fichier sort en CSV français : point-virgule, guillemets '
        + 'doublés, accents conservés. EBP et Excel l’ouvrent sans réglage.')
    ])
  ]);
}

/* ==========================================================================
   SAUVEGARDE COMPLÈTE
   L'export EBP ne sauvegarde rien : il ne transporte ni les dossiers, ni les
   photos, ni le planning. La vraie sauvegarde, c'est ce fichier-ci.
   ========================================================================== */

function sectionSauvegarde(e) {
  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('archive', { taille: 16 }),
      h('h2.grandit', 'Sauvegarde complète')
    ]),
    h('div.panneau__corps.pile', [
      h('div.petit.faible', 'Tout l’outil dans un seul fichier : clients, véhicules, '
        + 'dossiers, devis, factures, stock, planning, réglages. Les données vivent dans ce '
        + 'navigateur et nulle part ailleurs — un téléphone perdu, c’est tout le garage perdu. '
        + 'Une sauvegarde par semaine, rangée ailleurs que sur l’appareil.'),
      h('div.rang.enroule', [
        h('button.bt.bt--contour', { type: 'button', onclick: (ev) => sauvegarder(ev.currentTarget) },
          [icone('telecharger'), h('span', 'Télécharger la sauvegarde')]),
        h('button.bt.bt--danger', { type: 'button', onclick: () => restaurer(e) },
          [icone('televerser'), h('span', 'Restaurer une sauvegarde')])
      ]),
      h('div.minus.tres-faible', 'Dernière modification enregistrée : '
        + (e.journal && e.journal.length
          ? fmt.dateHeure(e.journal[e.journal.length - 1].quand)
          : 'aucune'))
    ])
  ]);
}

async function sauvegarder(bouton) {
  if (bouton) bouton.disabled = true;
  let parti = false;
  try {
    const doc = instantane();
    parti = await telecharger(nomDate('yatech-sauvegarde', 'json'),
      JSON.stringify(doc, null, 2), 'application/json');
  } catch (err) { parti = false; }
  if (bouton && bouton.isConnected) bouton.disabled = false;

  if (parti) message('Sauvegarde téléchargée. Rangez-la ailleurs que sur cet appareil.', { ton: 'ok' });
  else messageErreur('La sauvegarde n’est pas partie. Réessayez.');
}

async function restaurer(e) {
  const fichiers = await choisirFichier({ accepte: '.json,application/json,text/plain' });
  if (!fichiers.length) return;

  let doc = null;
  try { doc = JSON.parse(await lireTexte(fichiers[0])); }
  catch (err) { doc = null; }

  /* Une sauvegarde d'un autre outil remplacerait tout par du vide : on
     s'assure d'abord que le fichier ressemble à un état de Yatech. */
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)
      || (!Array.isArray(doc.clients) && !Array.isArray(doc.dossiers) && !doc.reglages)) {
    messageErreur('Ce fichier n’est pas une sauvegarde Yatech.');
    return;
  }

  const compte = (x) => (Array.isArray(x) ? x.length : 0);
  const dansLeFichier = pluriel(compte(doc.clients), 'client') + ', '
    + pluriel(compte(doc.dossiers), 'dossier') + ', '
    + pluriel(compte(doc.factures), 'facture');
  const ici = pluriel(compte(e.clients), 'client') + ', '
    + pluriel(compte(e.dossiers), 'dossier') + ', '
    + pluriel(compte(e.factures), 'facture');

  const ok = await confirmer({
    titre: 'Tout remplacer par cette sauvegarde ?',
    texte: 'Le fichier contient ' + dansLeFichier + '.',
    detail: 'Ce qui est actuellement dans cet appareil — ' + ici
      + ' — sera effacé et remplacé. Rien ne sera récupérable, même par l’annulation.',
    avertissement: 'Téléchargez d’abord une sauvegarde de l’état actuel : c’est la seule '
      + 'façon de revenir en arrière si ce fichier n’est pas le bon.',
    ok: 'Tout remplacer',
    annuler: 'Ne rien toucher',
    danger: true
  });
  if (!ok) return;

  remplacer(doc, { neuf, normaliser });
  /* On force l'écriture avant de recharger : la sauvegarde différée n'aurait
     pas le temps de se faire, et le rechargement relirait l'ancien état. */
  try { await ecrireMaintenant(); } catch (err) { /* on recharge quand même */ }
  location.reload();
}
