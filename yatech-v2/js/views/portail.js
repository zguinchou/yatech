/* ==========================================================================
   YATECH — portail confrère
   --------------------------------------------------------------------------
   Un garage voisin nous confie l'électronique. On lui envoie UN lien, une
   fois ; il l'épingle sur son téléphone et il n'appelle plus pour demander un
   prix. C'est tout l'objet de cet écran.

   La personne qui l'ouvre N'EST PAS de la maison. Elle ne voit donc que ce qui
   la regarde : ses prix, ses véhicules chez nous, ses factures. Jamais une
   note interne, jamais une marge, jamais un prix d'achat. Cette règle n'est
   pas une politesse : c'est la raison pour laquelle on ose donner le lien.

   L'écran vit hors de l'outil — pas de menu, pas de barre, pas de session
   d'employé. Le lien porte un jeton, et un code court ouvre la porte. Ni l'un
   ni l'autre ne rend les données inviolables : ce qui vit dans un navigateur
   est lisible par qui tient l'appareil. Ce couple sépare les confrères entre
   eux et arrête celui qui tombe sur l'adresse par hasard.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, message, vide } from '../core/ui.js';
import { maj } from '../core/store.js';
import { verifier } from '../core/crypto.js';
import * as fmt from '../core/fmt.js';
import {
  jour0, plusJours, heureEnMinutes, nombre, borne, compareTexte, correspond,
  grouper, pluriel, plaqueJolie, telNu, telJoli, tronque, surligne, par, JOUR, MINUTE
} from '../core/util.js';
import { ETAPES_OUVERTES, TYPES_LIGNE, etape, nomEtape } from '../domain/schema.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { contexte, prixPrestation, totaux } from '../domain/calculs.js';
import {
  champ, plaque, barreRecherche, indic, pastilleFacture, blocTotaux
} from '../ui/widgets.js';

/* Cinq codes faux d'affilée, puis une minute d'arrêt. Assez pour que celui qui
   se trompe de touche recommence sans s'énerver, assez pour qu'une machine qui
   essaie tous les codes n'aille nulle part. */
const ESSAIS_MAX = 5;
const BLOCAGE = 60000;

/* Le catalogue est long : on ne déplie une famille entière que si elle tient
   à l'écran. Au-delà, la recherche fait le tri. */
const FAMILLE_PAR_DEFAUT = 'Divers';

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;
  const jeton = String((ctx.params && ctx.params.jeton) || '').trim();
  const racine = h('div.portail');
  const cadre = h('div.portail__cadre');
  racine.appendChild(cadre);

  const c = jeton
    ? (e.clients || []).find(x => x.portail && x.portail.jeton === jeton)
    : null;

  /* Un jeton inconnu, un client archivé, un accès sans code : même réponse,
     et sans détail. Dire « ce lien a existé » renseignerait déjà quelqu'un
     qui essaie des adresses au hasard. */
  if (!c || c.archive || !c.portail || !c.portail.verrou) {
    poser(cadre, porteFermee(e));
    return racine;
  }

  const cle = 'yatech.portail.' + jeton;

  function contenu() {
    if (!ouvert(cle)) return porteCode(e, c, cle, () => poser(cadre, contenu()));
    return espace(e, c);
  }

  poser(cadre, contenu());
  return racine;
}

/* ==========================================================================
   LA PORTE
   ========================================================================== */

function porteFermee(e) {
  return h('div.pile', [
    h('div.portail__tete', [
      icone('cadenas', { taille: 22 }),
      h('div.grandit', h('strong', e.reglages.raisonSociale || e.reglages.nomOutil || 'Garage'))
    ]),
    vide({
      icone: 'cadenas',
      titre: 'Lien invalide ou accès fermé',
      texte: 'Ce lien ne donne accès à rien. Demandez au garage de vous en '
        + 'envoyer un nouveau.'
    })
  ]);
}

function porteCode(e, c, cle, entre) {
  const bloqueJusqua = lireNombre(cle + '.bloque');
  const zoneErreur = h('div');

  const saisie = h('input.saisie', {
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'one-time-code',
    spellcheck: false,
    maxlength: 16,
    'aria-label': 'Code d’accès',
    placeholder: 'Votre code',
    style: {
      textAlign: 'center', letterSpacing: '.28em', textTransform: 'uppercase',
      fontFamily: 'var(--f-chiffre)', fontSize: 'var(--t-xl)'
    },
    onkeydown: (ev) => { if (ev.key === 'Enter') tenter(); }
  });

  const bouton = h('button.bt.bt--fort.bt--plein.bt--pouce', {
    type: 'button', onclick: () => tenter()
  }, 'Entrer');

  /* --- le compte à rebours du blocage ------------------------------------ */
  function bloquer(jusqua) {
    saisie.disabled = true;
    bouton.disabled = true;
    const texte = h('div.bandeau.bandeau--danger');
    poser(zoneErreur, texte);

    /* Au premier battement le bandeau n'est pas encore posé dans la page :
       c'est justement ce rendu-ci qui va l'y mettre. On ne surveille donc son
       rattachement qu'à partir du deuxième — sinon le minuteur s'arrêterait
       avant d'avoir affiché la première seconde. */
    const battre = (premier) => {
      if (!premier && !texte.isConnected) { clearInterval(minuteur); return; }
      const reste = Math.ceil((jusqua - Date.now()) / 1000);
      if (reste <= 0) {
        clearInterval(minuteur);
        ecrire(cle + '.essais', '0');
        ecrire(cle + '.bloque', '0');
        saisie.disabled = false;
        bouton.disabled = false;
        poser(zoneErreur, []);
        try { saisie.focus(); } catch (err) { /* clavier indisponible */ }
        return;
      }
      poser(texte, [
        icone('sablier'),
        h('span', 'Trop de codes faux. Réessayez dans ' + reste + ' s.')
      ]);
    };
    const minuteur = setInterval(() => battre(false), 1000);
    battre(true);
  }

  function tenter() {
    const brut = String(saisie.value || '').trim();
    if (!brut) return;

    /* La vérification enchaîne plusieurs milliers d'empreintes : sur un vieux
       téléphone elle bloque l'affichage une demi-seconde. On laisse le
       navigateur peindre le « Vérification… » avant de partir dans le calcul,
       sinon le bouton semble ne rien faire. */
    bouton.disabled = true;
    bouton.textContent = 'Vérification…';
    setTimeout(() => {
      /* Les codes distribués sont en majuscules, mais on ne punit pas quelqu'un
         qui a tapé en minuscules — tout en laissant sa chance à un code que le
         garage aurait écrit autrement. */
      const majuscule = brut.toUpperCase();
      const bon = verifier(brut, c.portail.verrou)
        || (majuscule !== brut && verifier(majuscule, c.portail.verrou));
      bouton.disabled = false;
      bouton.textContent = 'Entrer';

      if (bon) {
        ecrire(cle, 'ok');
        ecrire(cle + '.essais', '0');
        noterAcces(c);
        entre();
        return;
      }

      const essais = lireNombre(cle + '.essais') + 1;
      ecrire(cle + '.essais', String(essais));
      saisie.value = '';
      if (essais >= ESSAIS_MAX) {
        const jusqua = Date.now() + BLOCAGE;
        ecrire(cle + '.bloque', String(jusqua));
        bloquer(jusqua);
        return;
      }
      poser(zoneErreur, h('div.bandeau.bandeau--danger', [
        icone('alerte'),
        h('span', 'Code incorrect. Il reste '
          + pluriel(ESSAIS_MAX - essais, 'essai') + '.')
      ]));
      try { saisie.focus(); } catch (err) { /* clavier indisponible */ }
    }, 30);
  }

  if (bloqueJusqua > Date.now()) bloquer(bloqueJusqua);
  else setTimeout(() => { try { saisie.focus(); } catch (err) {} }, 80);

  return h('div.pile', [
    teteGarage(e),
    h('div.carte.carte--muette', { style: { display: 'block', maxWidth: '420px', margin: '0 auto' } },
      h('div.pile', [
        h('div.centre', [
          icone('cadenas', { taille: 32, classe: 'tres-faible' }),
          h('h1', { style: { fontSize: 'var(--t-xl)', marginTop: 'var(--e-2)' } },
            'Espace professionnel'),
          h('div.petit.faible', 'Entrez le code court reçu avec votre lien.')
        ]),
        saisie,
        zoneErreur,
        bouton
      ])),
    h('div.minus.tres-faible.centre',
      'Ce code ne vous sera plus demandé tant que vous gardez cet onglet ouvert.')
  ]);
}

/** L'accès s'ouvre pour la session du navigateur, pas pour toujours : fermer
 *  l'onglet referme la porte, et le confrère ne laisse rien derrière lui sur
 *  le téléphone de l'atelier. */
function ouvert(cle) {
  try { return sessionStorage.getItem(cle) === 'ok'; }
  catch (e) { return false; }
}

function ecrire(cle, valeur) {
  try { sessionStorage.setItem(cle, valeur); } catch (e) { /* navigation privée */ }
}

function lireNombre(cle) {
  try { return nombre(sessionStorage.getItem(cle), 0); }
  catch (e) { return 0; }
}

/** On garde trace de la dernière visite : le garage voit ainsi, sur la fiche
 *  client, si le lien sert vraiment ou s'il dort. */
function noterAcces(c) {
  maj(null, (etat) => {
    const x = etat.clients.find(y => y.id === c.id);
    if (x && x.portail) x.portail.dernierAcces = Date.now();
  }, { annulable: false, journal: false });
}

/* ==========================================================================
   L'ESPACE, UNE FOIS ENTRÉ
   ========================================================================== */

function espace(e, c) {
  const ctx = contexte(e.reglages, c);
  const zone = h('div');
  let onglet = 'tarifs';

  const pages = [
    { cle: 'tarifs', texte: 'Mes tarifs', icone: 'tarifs', faire: () => ongletTarifs(e, c, ctx) },
    { cle: 'vehicules', texte: 'Mes véhicules', icone: 'vehicule', faire: () => ongletVehicules(e, c, ctx) },
    { cle: 'creneau', texte: 'Demander un créneau', icone: 'planning', faire: () => ongletCreneau(e, c) },
    { cle: 'factures', texte: 'Mes factures', icone: 'facture', faire: () => ongletFactures(e, c, ctx) }
  ];

  const barre = h('div.onglets', { role: 'tablist' }, pages.map(p =>
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': p.cle === onglet ? 'true' : 'false',
      onclick: () => {
        onglet = p.cle;
        Array.from(barre.children).forEach((b, i) =>
          b.setAttribute('aria-selected', pages[i].cle === onglet ? 'true' : 'false'));
        poser(zone, p.faire());
        zone.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }, [icone(p.icone, { taille: 15 }), h('span', p.texte)])
  ));

  poser(zone, pages[0].faire());

  return h('div.pile', [
    teteGarage(e),
    h('div.rang.enroule', [
      h('div.grandit', [
        h('h1', { style: { fontSize: 'var(--t-xl)' } }, lit.nomClient(c)),
        h('div.petit.faible', 'Votre espace professionnel')
      ])
    ]),
    barre,
    zone,
    pied(e)
  ]);
}

function teteGarage(e) {
  const r = e.reglages || {};
  const adresse = [r.adresse, [r.cp, r.ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');

  return h('div.portail__tete.enroule', [
    h('img', { src: 'assets/icone.svg', alt: '', width: 40, height: 40,
      style: { borderRadius: 'var(--r-m)', flex: 'none' } }),
    h('div.grandit', { style: { minWidth: '140px' } }, [
      h('strong', r.raisonSociale || r.nomOutil || 'Garage'),
      adresse ? h('div.petit.faible.coupe', adresse) : null,
      r.email ? h('div.minus.tres-faible.coupe', r.email) : null
    ]),
    r.tel ? h('a.bt.bt--fort', { href: 'tel:' + telNu(r.tel) },
      [icone('telephone'), h('span', 'Appeler')]) : null
  ]);
}

function pied(e) {
  const r = e.reglages || {};
  return h('div.pile-s', { style: { marginTop: 'var(--e-6)' } }, [
    h('hr'),
    h('div.minus.tres-faible.centre',
      'Les tarifs affichés sont ceux de votre grille. Ils se mettent à jour tout '
      + 'seuls : ce lien montre toujours les prix du jour, sans nouvel envoi.'),
    r.tel ? h('div.minus.tres-faible.centre',
      'Une question sur un montant ? ' + telJoli(r.tel)) : null
  ]);
}

/* ==========================================================================
   1. MES TARIFS
   La raison d'être du lien : le confrère lit ses prix lui-même. Rien n'est
   recalculé ici — les montants sortent de `prixPrestation()`, donc ce sont
   exactement ceux qui tomberont sur son devis.
   ========================================================================== */

function ongletTarifs(e, c, ctx) {
  const zone = h('div.pile');
  let requete = '';

  const recherche = barreRecherche({
    exemple: 'Chercher une prestation, un forfait…',
    surChangement: (v) => { requete = v; refaire(); }
  });

  function refaire() {
    const actives = (e.prestations || []).filter(p => p.actif);
    const retenues = requete
      ? actives.filter(p => correspondPrestation(p, requete))
      : actives;

    if (!actives.length) {
      poser(zone, vide({
        icone: 'tarifs',
        titre: 'Grille en préparation',
        texte: 'Le garage n’a pas encore publié son catalogue. Appelez-le pour un chiffrage.'
      }));
      return;
    }
    if (!retenues.length) {
      poser(zone, vide({
        icone: 'chercher',
        titre: 'Rien à ce nom',
        texte: 'Essayez un autre mot, ou appelez le garage : tout n’est pas au catalogue.'
      }));
      return;
    }

    const familles = Array.from(grouper(retenues, p => familleDe(p)).entries())
      .sort((a, b) => compareTexte(a[0], b[0]));

    poser(zone, familles.map(([famille, liste]) => h('div.panneau', [
      h('div.panneau__tete', [
        h('h2.grandit', famille),
        h('span.compte', String(liste.length))
      ]),
      h('div.liste', liste
        .slice()
        .sort((a, b) => compareTexte(a.libelle, b.libelle))
        .map(p => ligneTarif(p, ctx, requete)))
    ])));
  }

  refaire();

  return h('div.pile', [
    enTeteTarifs(ctx),
    recherche,
    zone
  ]);
}

function enTeteTarifs(ctx) {
  return h('div.pile-s', [
    h('div.grille-indics', [
      indic({
        nom: 'Votre taux horaire',
        valeur: fmt.euros(ctx.taux),
        detail: 'de main-d’œuvre, hors taxes'
      }),
      ctx.remisePro > 0 ? indic({
        nom: 'Remise confrère',
        valeur: fmt.pourcent(ctx.remisePro, 0),
        detail: 'sur les prestations sans prix confrère fixé'
      }) : null
    ].filter(Boolean)),
    h('div.bandeau', [
      icone('info'),
      h('span', ctx.tvaApplicable
        ? 'Tous les montants sont hors taxes. La TVA de '
          + fmt.nb(ctx.tva, 1) + ' % s’ajoute sur la facture.'
        : 'Montants nets : le garage ne facture pas la TVA.')
    ])
  ]);
}

function ligneTarif(p, ctx, requete) {
  const prix = prixPrestation(p, ctx);

  /* Un prix qui sort d'un calcul au temps mérite qu'on écrive le calcul : sans
     ça, personne ne comprend d'où sort le montant, et on décroche le téléphone
     — exactement ce que ce portail doit éviter. */
  const auTemps = ctx.pro
    ? !(nombre(p.prixPro) > 0 || nombre(p.prixHT) > 0)
    : !(nombre(p.prixHT) > 0);

  const bouts = [];
  if (p.code) bouts.push(p.code);
  if (auTemps && nombre(p.temps) > 0) {
    bouts.push(fmt.heuresMO(p.temps) + ' × ' + fmt.euros(ctx.taux));
  } else if (nombre(p.temps) > 0 && p.type === 'mo') {
    bouts.push(fmt.heuresMO(p.temps) + ' de main-d’œuvre');
  }
  if (p.detail) bouts.push(tronque(p.detail, 90));

  return h('div.liste__ligne.liste__ligne--muette', [
    h('div.grandit.coupe', [
      h('div.gras.coupe', requete
        ? { html: surligne(p.libelle, requete) }
        : { texte: p.libelle }),
      bouts.length ? h('div.petit.faible.coupe', bouts.join(' · ')) : null
    ]),
    h('div', { style: { flex: 'none', textAlign: 'right' } }, [
      h('div.gras.num', fmt.euros(prix)),
      h('div.minus.tres-faible', 'HT')
    ])
  ]);
}

const familleDe = (p) => String(p.famille || '').trim() || FAMILLE_PAR_DEFAUT;

/** La recherche du portail ne fouille que ce que le confrère voit : libellé,
 *  code, famille, détail. Ni les notes, ni les références internes. */
function correspondPrestation(p, requete) {
  return correspond(
    [p.libelle, p.code, p.famille, p.detail].filter(Boolean).join(' '),
    requete);
}

/* ==========================================================================
   2. MES VÉHICULES EN COURS
   Ce que le confrère veut savoir : où en est la voiture qu'il a déposée. Rien
   de plus — ni les notes de l'atelier, ni ce que la pièce nous a coûtée.
   ========================================================================== */

function ongletVehicules(e, c, ctx) {
  const dossiers = lit.dossiersDe(e, c.id)
    .filter(d => !d.archive && ETAPES_OUVERTES.includes(d.etape))
    .sort((a, b) => (a.entree || a.cree || 0) - (b.entree || b.cree || 0));

  if (!dossiers.length) {
    return vide({
      icone: 'vehicule',
      titre: 'Aucun véhicule en cours',
      texte: 'Vous n’avez rien chez nous en ce moment. Les véhicules rendus '
        + 'sortent de cette liste.'
    });
  }

  return h('div.pile', dossiers.map(d => {
    const v = lit.vehicule(e, d.vehiculeId);
    const et = etape(d.etape);
    const devis = dernierDevisEnvoye(e, d);
    const jours = lit.joursDansAtelier(d);

    return h('div.carte.carte--muette', { style: { display: 'block' } }, h('div.pile-s', [
      h('div.rang.enroule', [
        v ? plaque(v.immat, true) : null,
        h('div.grandit', { style: { minWidth: '120px' } }, [
          h('div.gras.coupe', v ? lit.nomVehiculeLong(v) : 'Véhicule'),
          h('div.petit.faible.coupe', lit.titreDossier(e, d))
        ]),
        h('span.pastille.pastille--' + et.ton, nomEtape(e, d.etape))
      ]),
      h('div.petit.faible', [
        'Entré le ' + fmt.date(d.entree || d.cree, 'lettre'),
        jours > 0 ? ' · ' + pluriel(jours, 'jour') + ' chez nous' : ''
      ].join('')),
      devis ? h('div.rang.enroule', [
        h('div.grandit', { style: { minWidth: '120px' } }, [
          h('div.petit.faible', 'Devis ' + (devis.numero || '')
            + ' du ' + fmt.date(devis.envoyeLe || devis.emisLe, 'court')),
          h('div.gras.num', fmt.euros(totaux(devis, ctx).ttc) + ' TTC')
        ]),
        h('button.bt.bt--contour', {
          type: 'button',
          onclick: () => modaleDevis(e, devis, ctx)
        }, [icone('devis', { taille: 15 }), h('span', 'Voir le devis')])
      ]) : null
    ]));
  }));
}

/** Le dernier devis parti chez le confrère. Un brouillon n'existe pas pour
 *  lui : tant qu'il n'est pas envoyé, il peut encore changer du tout au tout. */
function dernierDevisEnvoye(e, d) {
  return lit.devisDuDossier(e, d.id)
    .filter(x => x.statut !== 'brouillon' && x.envoyeLe)
    .sort((a, b) => (b.envoyeLe || 0) - (a.envoyeLe || 0))[0] || null;
}

function modaleDevis(e, devis, ctx) {
  const t = totaux(devis, ctx);
  const v = lit.vehicule(e, devis.vehiculeId);

  const corps = h('div.pile', [
    h('div.petit.faible', [
      v ? lit.nomVehiculeLong(v) + ' — ' + plaqueJolie(v.immat) : null,
      devis.objet || null,
      devis.valableJusquau
        ? 'Valable jusqu’au ' + fmt.date(devis.valableJusquau, 'lettre')
        : null
    ].filter(Boolean).join(' · ')),

    h('div.tableau-cadre', h('table.grille.repliable', [
      h('thead', h('tr', [
        h('th', 'Désignation'),
        h('th.num', 'Qté'),
        h('th.num', 'Prix unitaire'),
        h('th.num', 'Total HT')
      ])),
      h('tbody', (devis.lignes || []).map(l => {
        if (l.type === 'titre') {
          return h('tr', h('td', { colspan: 4 }, h('b', l.libelle || '')));
        }
        const unite = l.unite || (TYPES_LIGNE[l.type] ? TYPES_LIGNE[l.type].unite : '');
        const brut = nombre(l.qte) * nombre(l.prixHT);
        const ht = brut * (1 - nombre(l.remise, 0) / 100);
        return h('tr', [
          h('td', { 'data-col': 'Désignation' }, [
            h('div', l.libelle || ''),
            l.detail ? h('div.minus.tres-faible', l.detail) : null,
            nombre(l.remise) > 0
              ? h('div.minus.tres-faible', 'remise ' + fmt.pourcent(l.remise, 0))
              : null
          ]),
          h('td.num', { 'data-col': 'Qté' },
            fmt.nb(l.qte, nombre(l.qte) % 1 === 0 ? 0 : 2) + (unite ? ' ' + unite : '')),
          h('td.num', { 'data-col': 'Prix unitaire' }, fmt.euros(l.prixHT)),
          h('td.num', { 'data-col': 'Total HT' }, fmt.euros(ht))
        ]);
      }))
    ])),

    blocTotaux(t),
    devis.motDuJour ? h('div.bandeau', [icone('info'), h('span', devis.motDuJour)]) : null
  ]);

  modale({
    titre: 'Devis ' + (devis.numero || ''),
    corps,
    taille: 'large',
    actions: [{ texte: 'Fermer', ton: 'contour' }]
  });
}

/* ==========================================================================
   3. DEMANDER UN CRÉNEAU
   Une demande, pas un rendez-vous. Le garage garde la main : tant qu'il n'a
   pas accepté, rien n'est pris. C'est écrit noir sur blanc à trois endroits,
   parce qu'un confrère qui croit avoir un rendez-vous vient pour rien.
   ========================================================================== */

function ongletCreneau(e, c) {
  const cal = cadreOuverture(e);
  const jours = joursProposes(cal);

  let jourChoisi = jours.length ? jours[0] : null;
  let debutChoisi = null;
  let duree = cal.duree;

  const zoneJours = h('div.portail__jours');
  const zoneCreneaux = h('div');
  const zoneDuree = h('div');
  const zoneRetour = h('div');
  const zoneMiennes = h('div');

  /* Les champs sont construits une fois pour toutes : les repeindre à chaque
     changement de jour effacerait sous les doigts ce que le confrère est en
     train d'écrire. */
  const vehicule = champ({
    etiquette: 'Véhicule', exemple: 'Peugeot 308 2.0 HDi', obligatoire: true
  });
  const immat = champ({ etiquette: 'Immatriculation', type: 'plaque', exemple: 'AB-123-CD' });
  const besoin = champ({
    etiquette: 'Ce que vous attendez de nous',
    type: 'zone', lignes: 4,
    exemple: 'Lecture calculateur, défaut P0299 récurrent, déjà changé le capteur…',
    obligatoire: true
  });

  function refaireJours() {
    poser(zoneJours, jours.map(j => h('button.jour-onglet'
      + (j === jour0() ? '.jour-onglet--auj' : ''), {
      type: 'button',
      'aria-pressed': j === jourChoisi ? 'true' : 'false',
      onclick: () => {
        jourChoisi = j;
        debutChoisi = null;
        refaireJours();
        refaireCreneaux();
        refaireDuree();
      }
    }, [
      h('small', fmt.nomJour(j)),
      h('b', String(new Date(j).getDate())),
      h('small', fmt.nomMois(j))
    ])));
  }

  function refaireCreneaux() {
    if (!jourChoisi) {
      poser(zoneCreneaux, h('div.petit.faible.centre', 'Aucun jour ouvré à venir.'));
      return;
    }
    const libres = libresDuJour(e, jourChoisi, cal);
    if (!libres.length) {
      poser(zoneCreneaux, h('div.bandeau.bandeau--alerte', [
        icone('horloge'),
        h('span', 'Plus rien de libre ce jour-là. Essayez un autre jour, '
          + 'ou appelez-nous : on trouve souvent une place.')
      ]));
      return;
    }
    poser(zoneCreneaux, h('div.portail__creneaux', libres.map(t =>
      h('button.portail__creneau', {
        type: 'button',
        'aria-pressed': t === debutChoisi ? 'true' : 'false',
        onclick: () => { debutChoisi = t; refaireCreneaux(); refaireDuree(); }
      }, fmt.heure(t))
    )));
  }

  function refaireDuree() {
    if (!debutChoisi) {
      poser(zoneDuree, h('div.petit.faible', 'Choisissez une heure ci-dessus.'));
      return;
    }
    /* On ne propose que des durées qui tiennent VRAIMENT dans le trou libre :
       promettre trois heures là où il n'y en a qu'une, c'est fabriquer une
       déception et un coup de téléphone. */
    const libres = libresDuJour(e, jourChoisi, cal);
    const suite = tranchesLibres(libres, debutChoisi, cal.pas);
    const choix = [];
    for (let n = 1; n <= Math.min(suite, Math.ceil(480 / cal.pas)); n++) {
      choix.push(n * cal.pas);
    }
    if (!choix.includes(duree)) {
      duree = choix.reduce((meilleur, m) =>
        Math.abs(m - cal.duree) < Math.abs(meilleur - cal.duree) ? m : meilleur, choix[0]);
    }

    poser(zoneDuree, h('div.pile-s', [
      h('div.etiquette', 'Durée estimée'),
      h('div.filtres', choix.map(m => h('button.filtre', {
        type: 'button',
        'aria-pressed': m === duree ? 'true' : 'false',
        onclick: () => { duree = m; refaireDuree(); }
      }, fmt.duree(m * MINUTE)))),
      h('div.petit.faible', 'Le ' + fmt.date(debutChoisi, 'lettre')
        + ' de ' + fmt.heure(debutChoisi)
        + ' à ' + fmt.heure(debutChoisi + duree * MINUTE) + '.')
    ]));
  }

  function refaireMiennes() {
    const miennes = (e.creneaux || [])
      .filter(x => x.clientId === c.id && x.fin >= Date.now() && !x.fait)
      .sort(par('debut'));
    if (!miennes.length) { poser(zoneMiennes, []); return; }

    poser(zoneMiennes, h('div.panneau', [
      h('div.panneau__tete', [
        icone('horloge', { taille: 16 }),
        h('h2.grandit', 'Vos demandes et rendez-vous')
      ]),
      h('div.liste', miennes.map(x => h('div.liste__ligne.liste__ligne--muette', [
        h('div.grandit.coupe', [
          h('div.gras.coupe', fmt.date(x.debut, 'lettre') + ' à ' + fmt.heure(x.debut)),
          h('div.petit.faible.coupe', x.titre || 'Demande')
        ]),
        x.demande
          ? h('span.pastille.pastille--alerte', 'à confirmer')
          : h('span.pastille.pastille--ok', 'confirmé')
      ])))
    ]));
  }

  function envoyer() {
    if (!debutChoisi) {
      poser(zoneRetour, h('div.bandeau.bandeau--alerte', [
        icone('alerte'), h('span', 'Choisissez d’abord un jour et une heure.')
      ]));
      return;
    }
    if (!vehicule.lire()) { vehicule.erreur('Dites-nous quel véhicule.'); return; }
    vehicule.erreur('');
    if (!besoin.lire()) { besoin.erreur('Décrivez ce que vous attendez.'); return; }
    besoin.erreur('');

    const plaqueTexte = immat.lire() ? plaqueJolie(immat.lire()) : '';
    act.poserCreneau({
      clientId: c.id,
      userId: null,
      dossierId: null,
      vehiculeId: null,
      type: 'rdv',
      demande: true,
      fait: false,
      debut: debutChoisi,
      fin: debutChoisi + duree * MINUTE,
      titre: lit.nomClient(c) + ' — ' + tronque(vehicule.lire(), 40)
        + (plaqueTexte ? ' (' + plaqueTexte + ')' : ''),
      note: [vehicule.lire(), plaqueTexte].filter(Boolean).join(' · ')
        + ' — ' + besoin.lire()
    });

    message('Demande envoyée au garage', { ton: 'ok' });
    debutChoisi = null;
    vehicule.ecrire('');
    immat.ecrire('');
    besoin.ecrire('');
    refaireCreneaux();
    refaireDuree();
    refaireMiennes();
    poser(zoneRetour, h('div.bandeau.bandeau--ok', [
      icone('cocheRonde'),
      h('div', [
        h('b', 'Votre demande est enregistrée.'),
        h('div', 'Elle sera confirmée par le garage. Tant qu’il ne l’a pas '
          + 'acceptée, ce n’est PAS un rendez-vous : n’amenez pas le véhicule '
          + 'avant d’avoir reçu la confirmation.')
      ])
    ]));
    zoneRetour.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  refaireJours();
  refaireCreneaux();
  refaireDuree();
  refaireMiennes();

  return h('div.pile', [
    h('div.bandeau', [
      icone('info'),
      h('span', 'Vous envoyez une DEMANDE de créneau. Elle n’est pas un '
        + 'rendez-vous tant que le garage ne l’a pas acceptée — vous serez '
        + 'prévenu.')
    ]),
    zoneMiennes,
    h('div.panneau', [
      h('div.panneau__tete', [
        icone('planning', { taille: 16 }),
        h('h2.grandit', 'Quand ?'),
        h('span.petit.faible', 'horizon ' + pluriel(cal.horizon, 'jour'))
      ]),
      zoneJours,
      h('div.panneau__corps', h('div.pile', [zoneCreneaux, zoneDuree]))
    ]),
    h('div.panneau', [
      h('div.panneau__tete', [
        icone('vehicule', { taille: 16 }),
        h('h2.grandit', 'Quoi ?')
      ]),
      h('div.panneau__corps', h('div.pile', [
        vehicule.noeud,
        immat.noeud,
        besoin.noeud
      ]))
    ]),
    zoneRetour,
    h('button.bt.bt--fort.bt--plein.bt--pouce', {
      type: 'button', onclick: envoyer
    }, [icone('planning'), h('span', 'Envoyer ma demande')])
  ]);
}

/* --- ce que « ouvert » veut dire, d'après les réglages du garage ---------- */

function cadreOuverture(e) {
  const r = e.reglages || {};
  const debut = heureEnMinutes(r.heureDebut);
  const fin = heureEnMinutes(r.heureFin);
  const minDebut = debut === null ? 8 * 60 : debut;
  const minFin = (fin === null || fin <= minDebut) ? minDebut + 600 : fin;
  const ouvres = (r.joursOuvres || []).map(Number).filter(n => n >= 0 && n <= 6);

  return {
    minDebut,
    minFin,
    pas: borne(Math.round(nombre(r.pasPlanning, 30)) || 30, 5, 120),
    pauseDebut: heureEnMinutes(r.pauseDebut),
    pauseFin: heureEnMinutes(r.pauseFin),
    ouvres: ouvres.length ? ouvres : [1, 2, 3, 4, 5],
    horizon: borne(Math.round(nombre(r.joursReservablesPro, 14)) || 14, 1, 90),
    duree: borne(Math.round(nombre(r.dureeDefaut, 60)) || 60, 15, 480)
  };
}

/** Les jours ouvrés à venir, dans la limite ouverte aux confrères. */
function joursProposes(cal) {
  const jours = [];
  for (let i = 0; i < cal.horizon; i++) {
    const t = plusJours(jour0(), i);
    if (cal.ouvres.includes(new Date(t).getDay())) jours.push(t);
  }
  return jours;
}

/**
 * Les heures encore libres d'une journée : les heures ouvrées, moins la pause,
 * moins tout ce qui est déjà posé au planning — les demandes des autres
 * confrères comprises, sinon deux d'entre eux réservent la même heure.
 * @returns {Array<number>} les débuts de tranche, en millisecondes
 */
function libresDuJour(e, jour, cal) {
  const base = jour0(jour);
  const maintenant = Date.now();
  const occupes = (e.creneaux || [])
    .filter(x => x.debut < base + JOUR && x.fin > base);

  const libres = [];
  for (let min = cal.minDebut; min + cal.pas <= cal.minFin; min += cal.pas) {
    const debut = base + min * MINUTE;
    const fin = debut + cal.pas * MINUTE;

    if (debut <= maintenant) continue;                 // le passé ne se réserve pas
    if (cal.pauseDebut !== null && cal.pauseFin !== null
      && min < cal.pauseFin && min + cal.pas > cal.pauseDebut) continue;
    if (occupes.some(x => x.debut < fin && x.fin > debut)) continue;

    libres.push(debut);
  }
  return libres;
}

/** Combien de tranches libres se suivent à partir de celle-ci. */
function tranchesLibres(libres, debut, pas) {
  let n = 0;
  let t = debut;
  while (libres.includes(t)) { n++; t += pas * MINUTE; }
  return Math.max(1, n);
}

/* ==========================================================================
   4. MES FACTURES
   En lecture seule. Rien ici ne se règle en ligne : le garage encaisse
   lui-même, et une facture qui se dit « payée » toute seule est une facture
   qu'on cherche pendant deux heures.
   ========================================================================== */

function ongletFactures(e, c, ctx) {
  /* Une facture au statut « à facturer » n'existe pas encore : elle n'a ni
     numéro ni date tant qu'EBP ne l'a pas éditée. La montrer au confrère
     l'obligerait à comprendre notre cuisine interne. */
  const factures = lit.facturesDe(e, c.id).filter(f => f.statut !== 'attente');

  if (!factures.length) {
    return vide({
      icone: 'facture',
      titre: 'Aucune facture',
      texte: 'Vos factures apparaîtront ici dès qu’elles seront éditées.'
    });
  }

  const du = lit.duPar(e, c.id);

  return h('div.pile', [
    h('div.grille-indics', [
      indic({
        nom: 'Reste à régler',
        valeur: fmt.euros(du.total, { sansCentimes: true }),
        ton: du.total > 0 ? 'alerte' : null,
        detail: du.total > 0
          ? pluriel(du.factures.length, 'facture') + ' en attente'
          : 'tout est soldé'
      }),
      indic({
        nom: 'Factures',
        valeur: factures.length,
        detail: 'depuis le début'
      })
    ]),
    h('div.tableau-cadre', h('table.grille.repliable', [
      h('thead', h('tr', [
        h('th', 'Numéro'),
        h('th', 'Date'),
        h('th.num', 'Montant TTC'),
        h('th.num', 'Reste dû'),
        h('th', 'Statut')
      ])),
      h('tbody', factures.map(f => {
        const t = totaux(f, ctx);
        return h('tr', [
          h('td', { 'data-col': 'Numéro' },
            h('span.gras', f.numeroEbp || f.numero || '—')),
          h('td', { 'data-col': 'Date' }, fmt.date(f.emiseLe || f.cree, 'court')),
          h('td.num', { 'data-col': 'Montant TTC' }, fmt.euros(t.ttc)),
          h('td.num', { 'data-col': 'Reste dû' },
            t.reste > 0.005
              ? h('b', { style: { color: 'var(--alerte)' } }, fmt.euros(t.reste))
              : '—'),
          h('td', { 'data-col': 'Statut' }, pastilleFacture(f.statut))
        ]);
      }))
    ])),
    h('div.minus.tres-faible',
      'Les règlements sont enregistrés par le garage. En cas d’écart, appelez : '
      + 'c’est plus rapide qu’un courriel.')
  ]);
}
