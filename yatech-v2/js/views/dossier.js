/* ==========================================================================
   YATECH — la fiche d'un dossier (ordre de réparation)
   --------------------------------------------------------------------------
   L'écran où l'on passe la journée. Tout ce qui arrive à un véhicule pendant
   qu'il est chez nous s'écrit ici : ce que le client a dit, ce qu'on a trouvé,
   ce qu'on a fait, les pièces sorties du stock, le devis, la facture, les
   photos.

   Trois principes tiennent l'écran :
     • une seule vérité — les lignes de travaux sont celles du dossier, le
       devis et la facture en prennent une copie figée, jamais l'inverse ;
     • rien à enregistrer — chaque champ s'écrit quand on le quitte, il n'y a
       pas de bouton « Enregistrer » à oublier avant de fermer l'onglet ;
     • on repeint le moins possible — repeindre l'écran entier pendant qu'on
       tape un prix fait sauter le curseur, donc chaque zone se refait seule.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, messageErreur, menu, vide } from '../core/ui.js';
import { maj } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { id, nombre, pluriel, jour0, MINUTE } from '../core/util.js';
import { choisirFichier, reduireImage } from '../core/fichiers.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { totaux } from '../domain/calculs.js';
import { ETAPES, NATURES, PRIORITES, MOTIFS_PARC } from '../domain/schema.js';
import { editeurLignes } from '../ui/lignes.js';
import {
  champ, grilleChamps, pastilleEtape, pastilleNature, pastillePriorite,
  pastilleDevis, pastilleFacture, plaque, tete, lienTel, lienMail, menuEnvoi,
  blocTotaux, fil
} from '../ui/widgets.js';
import { imprimerOrdre } from './impression.js';

const ONGLETS = [
  { cle: 'travaux', nom: 'Travaux', icone: 'atelier' },
  { cle: 'suivi', nom: 'Suivi', icone: 'document' },
  { cle: 'facturation', nom: 'Devis & facture', icone: 'euro' },
  { cle: 'photos', nom: 'Photos', icone: 'camera' }
];

export function peindre(ctx) {
  const e = ctx.etat;
  const moi = ctx.moi;
  const d = lit.dossier(e, ctx.params.id);

  if (!d) {
    return vide({
      icone: 'question',
      titre: 'Dossier introuvable',
      texte: 'Ce dossier a été supprimé, ou le lien ne pointe plus sur rien.',
      action: { texte: 'Retour à l’atelier', faire: () => ctx.aller('/atelier') }
    });
  }

  /* L'onglet peut venir de l'adresse (#/dossier/x?onglet=photos) pour qu'un
     lien tombe au bon endroit, mais changer d'onglet ensuite ne touche plus à
     l'adresse : sur téléphone, cela rechargerait l'écran et remonterait tout
     en haut à chaque fois. */
  let onglet = ONGLETS.some(o => o.cle === ctx.query.onglet) ? ctx.query.onglet : 'travaux';

  const zoneTete = h('div');
  const zoneEtapes = h('div');
  const zoneOnglets = h('div');
  const zoneCorps = h('div');

  const racine = h('div.pile', [zoneTete, zoneEtapes, zoneOnglets, zoneCorps]);

  /* --- les modifications du dossier passent toutes par là ----------------- */
  function changer(quoi, faire) {
    return maj(quoi, (etat) => {
      const x = lit.dossier(etat, d.id);
      if (!x) return null;
      faire(x, etat);
      x.maj = Date.now();
      return x;
    }, { cible: { type: 'dossiers', id: d.id } });
  }

  function refaireTete() { poser(zoneTete, ficheTete(e, d, ctx, refaireTout)); }
  function refaireEtapes() { poser(zoneEtapes, barreEtapes(e, d, refaireTout)); }
  function refaireOnglets() { poser(zoneOnglets, barreOnglets(e, d, onglet, choisirOnglet)); }
  function refaireCorps() {
    if (onglet === 'suivi') poser(zoneCorps, ongletSuivi(e, d, moi, changer, refaireTete));
    else if (onglet === 'facturation') poser(zoneCorps, ongletFacturation(e, d, ctx));
    else if (onglet === 'photos') poser(zoneCorps, ongletPhotos(e, d, changer, refaireOnglets));
    else poser(zoneCorps, ongletTravaux(e, d, moi, changer, refaireOnglets));
  }

  function refaireTout() {
    refaireTete(); refaireEtapes(); refaireOnglets(); refaireCorps();
  }

  function choisirOnglet(cle) {
    if (cle === onglet) return;
    onglet = cle;
    refaireOnglets();
    refaireCorps();
  }

  refaireTout();
  return racine;
}

/* ==========================================================================
   L'EN-TÊTE — qui, quoi, et le geste qui suit
   ========================================================================== */

function ficheTete(e, d, ctx, refaireTout) {
  const v = lit.vehicule(e, d.vehiculeId);
  const c = lit.client(e, d.clientId);
  const jours = lit.joursDansAtelier(d);

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      h('div.rang-s.enroule', [
        h('span.minus.tres-faible.num', d.numero || ''),
        pastilleEtape(d.etape),
        pastilleNature(d.nature),
        pastillePriorite(d.priorite),
        d.archive ? h('span.pastille', 'archivé') : null
      ]),
      h('h1', lit.titreDossier(e, d)),
      h('div.fiche-tete__lignes', [
        v ? h('a.rang-s', { href: '#/vehicule/' + v.id }, [
          plaque(v.immat, true),
          h('span.coupe', lit.nomVehiculeLong(v))
        ]) : null,
        c ? h('a.rang-s', { href: '#/client/' + c.id }, [
          icone('clients', { taille: 14 }), h('span.coupe', lit.nomClient(c))
        ]) : null,
        c ? lienTel(c.tel) : null,
        c ? lienMail(c.email) : null,
        h('span.rang-s', [
          icone('horloge', { taille: 14 }),
          h('span', jours === 0 ? 'entré aujourd’hui' : 'ici depuis ' + pluriel(jours, 'jour'))
        ]),
        d.place ? h('span.rang-s', [
          icone('parc', { taille: 14 }), h('span', 'place ' + d.place)
        ]) : null
      ])
    ]),
    h('div.fiche-tete__actions', [
      boutonPrincipal(e, d, ctx, refaireTout),
      h('button.bt.bt--contour.bt--icone', {
        type: 'button', 'aria-label': 'Autres actions',
        onclick: (ev) => menuDossier(ev.currentTarget, e, d, ctx, refaireTout)
      }, icone('points'))
    ])
  ]);
}

/**
 * Le bouton qui dit ce qu'il reste à faire. Il change avec l'étape : à chaque
 * moment du dossier il n'y a qu'un geste évident, et c'est celui-là.
 */
function boutonPrincipal(e, d, ctx, refaireTout) {
  const bt = (texte, ico, faire) => h('button.bt.bt--fort', {
    type: 'button', onclick: faire
  }, [icone(ico), h('span', texte)]);

  const avancer = (etape) => () => { act.changerEtape(d.id, etape); refaireTout(); };

  switch (d.etape) {
    case 'accueil':
      return bt('Commencer le diagnostic', 'jauge', avancer('diag'));

    case 'diag':
      return bt('Passer au chiffrage', 'devis', avancer('devis'));

    case 'devis':
      return bt('Créer le devis', 'devis', () => creerDevisEtOuvrir(d, ctx));

    case 'accord': {
      const envoye = lit.devisDuDossier(e, d.id).find(x => x.statut === 'envoye');
      return bt('Le client a accepté', 'coche', async () => {
        const ok = await confirmer({
          titre: 'Accord du client ?',
          texte: envoye
            ? 'Le devis ' + envoye.numero + ' passe en accepté, ses lignes deviennent celles du dossier, '
              + 'et les travaux peuvent commencer.'
            : 'Le dossier passe en atelier.',
          ok: 'Oui, on lance les travaux'
        });
        if (!ok) return;
        if (envoye) act.accepterDevis(envoye.id);
        else act.changerEtape(d.id, 'atelier');
        refaireTout();
      });
    }

    case 'piece':
      return bt('La pièce est arrivée', 'boite', avancer('atelier'));

    case 'atelier':
      return bt('Travaux terminés', 'coche', avancer('controle'));

    case 'controle':
      return bt('Le véhicule est prêt', 'cocheRonde', avancer('pret'));

    case 'pret': {
      const c = lit.client(e, d.clientId);
      const v = lit.vehicule(e, d.vehiculeId);
      const t = lit.totauxDossier(e, d);
      return h('button.bt.bt--fort', {
        type: 'button',
        onclick: (ev) => menuEnvoi(ev.currentTarget, {
          tel: c && c.tel, email: c && c.email,
          sujet: 'Votre véhicule est prêt',
          texte: messagePret(e, d, c, v, t)
        })
      }, [icone('telephone'), h('span', 'Prévenir le client')]);
    }

    case 'livre':
      if (!d.factureId) {
        return bt('Préparer la facture', 'facture', () => {
          const f = act.creerFacture(d.id);
          if (!f) { messageErreur('La facture n’a pas pu être préparée.'); return; }
          message('Facture ' + f.numero + ' préparée', { ton: 'ok' });
          ctx.aller('/facture/' + f.id);
        });
      }
      return h('a.bt.bt--contour', { href: '#/facture/' + d.factureId },
        [icone('facture'), h('span', 'Voir la facture')]);

    default:
      return null;
  }
}

function creerDevisEtOuvrir(d, ctx) {
  const dv = act.creerDevis(d.id);
  if (!dv) { messageErreur('Le devis n’a pas pu être créé.'); return; }
  message('Devis ' + dv.numero + ' créé', { ton: 'ok' });
  ctx.aller('/devis/' + dv.id);
}

/** Le message qu'on envoie au client, avec les mots du garage (réglages). */
function messagePret(e, d, c, v, t) {
  return String(e.reglages.messagePret || '')
    .replace('{prenom}', (c && c.prenom) || lit.nomClient(c))
    .replace('{vehicule}', v ? lit.nomVehicule(v) : 'votre véhicule')
    .replace('{immat}', v ? v.immat : '')
    .replace('{montant}', fmt.euros(t.ttc))
    .replace('{garage}', e.reglages.raisonSociale || e.reglages.nomOutil || '');
}

function menuDossier(ancre, e, d, ctx, refaireTout) {
  menu(ancre, [
    { titre: d.numero || 'Dossier' },
    { texte: 'Imprimer l’ordre de réparation', icone: 'imprimer', faire: () => imprimerOrdre(e, d) },
    {
      texte: d.archive ? 'Sortir des archives' : 'Archiver le dossier', icone: 'archive',
      faire: () => {
        act.archiverDossier(d.id, !d.archive);
        message(d.archive ? 'Dossier ressorti des archives' : 'Dossier archivé', { ton: 'ok' });
        refaireTout();
      }
    },
    null,
    {
      texte: 'Supprimer le dossier', icone: 'poubelle', danger: true,
      faire: async () => {
        const ok = await confirmer({
          titre: 'Supprimer ce dossier ?',
          texte: (d.numero || 'Ce dossier') + ' — ' + lit.titreDossier(e, d),
          detail: 'Les devis et la facture déjà émis, eux, restent : ils ont une valeur comptable.',
          avertissement: 'Cette suppression ne se rattrape que par « annuler ».',
          ok: 'Supprimer', danger: true
        });
        if (!ok) return;
        maj('Dossier supprimé', (etat) => {
          const i = etat.dossiers.findIndex(x => x.id === d.id);
          if (i >= 0) etat.dossiers.splice(i, 1);
        });
        message('Dossier supprimé', { ton: 'ok' });
        ctx.aller('/atelier');
      }
    }
  ], { titre: 'Dossier' });
}

/* ==========================================================================
   LA BARRE D'AVANCEMENT
   Les neuf colonnes de l'atelier, en petit. On y touche pour faire avancer le
   dossier sans repasser par le tableau.
   ========================================================================== */

function barreEtapes(e, d, refaireTout) {
  let courante = null;

  const barre = h('div.filtres', { role: 'group', 'aria-label': 'Étape du dossier' },
    ETAPES.map(et => h('button.filtre', {
      type: 'button',
      title: et.aide,
      'aria-pressed': et.cle === d.etape ? 'true' : 'false',
      ref: (n) => { if (et.cle === d.etape) courante = n; },
      onclick: () => {
        if (et.cle === d.etape) return;
        act.changerEtape(d.id, et.cle);
        message('Dossier en « ' + et.nom + ' »', { ton: 'ok', duree: 1800 });
        refaireTout();
      }
    }, [
      h('span', et.nom),
      et.cle === d.etape ? icone('coche', { taille: 13 }) : null
    ])));

  /* Sur téléphone la barre déborde : l'étape du jour doit être visible sans
     avoir à la chercher du doigt. */
  if (courante) {
    requestAnimationFrame(() => {
      try { courante.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (err) {}
    });
  }
  return barre;
}

/* ==========================================================================
   LES ONGLETS
   ========================================================================== */

function barreOnglets(e, d, actif, surChoix) {
  const comptes = {
    travaux: (d.lignes || []).filter(l => l && l.type !== 'titre').length,
    suivi: null,
    facturation: lit.devisDuDossier(e, d.id).length + (d.factureId ? 1 : 0),
    photos: (d.photos || []).length
  };

  return h('div.onglets', { role: 'tablist' }, ONGLETS.map(o => h('button', {
    type: 'button',
    role: 'tab',
    'aria-selected': o.cle === actif ? 'true' : 'false',
    onclick: () => surChoix(o.cle)
  }, [
    icone(o.icone, { taille: 15 }),
    h('span', o.nom),
    comptes[o.cle] ? h('span.compte', String(comptes[o.cle])) : null
  ])));
}

/* ==========================================================================
   ONGLET TRAVAUX — les lignes, le stock, la checklist
   ========================================================================== */

function ongletTravaux(e, d, moi, changer, refaireOnglets) {
  const zoneStock = h('div');
  const zoneCheck = h('div');
  /* Le compte rendu de la dernière sortie de stock vit hors du panneau : il
     survit à son repeint, sinon on n'a pas le temps de lire ce qui a manqué. */
  const zoneMessage = h('div.pile-s');

  /* On ne refait le panneau des pièces que si la liste a changé de forme :
     repeindre à chaque frappe dans une désignation ne servirait à rien. */
  let nbLignes = (d.lignes || []).length;

  const editeur = editeurLignes({
    etat: e,
    lignes: d.lignes,
    ctx: lit.prixDe(e, d.clientId),
    remise: d.remiseGlobale,
    /* L'éditeur travaille sur le tableau du dossier lui-même : on lui rend la
       main en enregistrant, sans repeindre la zone qu'il est en train
       d'éditer. */
    surChangement: (lignes, remise) => {
      maj(null, (etat) => {
        const x = lit.dossier(etat, d.id);
        if (!x) return;
        x.lignes = lignes;
        x.remiseGlobale = remise;
        x.maj = Date.now();
      }, { journal: false });
      marquerServies();
      if (lignes.length !== nbLignes) {
        nbLignes = lignes.length;
        refaireStock();
        marquerServies();
        refaireOnglets();
      }
    }
  });

  /* --- les pièces sorties du stock ---------------------------------------- */
  function lignesPiece() {
    return (d.lignes || []).filter(l => l.type === 'piece' && l.pieceId);
  }

  function marquerServies() {
    for (const l of lignesPiece()) {
      const n = editeur.noeud.querySelector('[data-ligne="' + l.id + '"]');
      if (n) n.classList.toggle('dossier-ligne-servie', !!l.sortieFaite);
    }
  }

  function refaireStock() {
    const avecPiece = lignesPiece();
    if (!avecPiece.length) { poser(zoneStock, []); return; }

    const aSortir = avecPiece.filter(l => !l.sortieFaite);
    const servies = avecPiece.filter(l => l.sortieFaite);

    poser(zoneStock, h('div.panneau', [
      h('div.panneau__tete', [
        icone('stock', { taille: 16 }),
        h('h2.grandit', 'Pièces'),
        h('span.petit.faible', servies.length + ' / ' + avecPiece.length + ' sorties')
      ]),
      h('div.panneau__corps.pile', [
        aSortir.length
          ? h('button.bt.bt--fort', {
              type: 'button',
              onclick: () => {
                const bilan = act.servirDossier(d.id);
                poser(zoneMessage, compteRenduSortie(bilan));
                if (bilan.sorties.length) {
                  message(pluriel(bilan.sorties.length, 'pièce sortie', 'pièces sorties') + ' du stock',
                    { ton: 'ok' });
                }
                refaireStock();
                marquerServies();
              }
            }, [icone('telecharger'), h('span', 'Sortir les pièces du stock')])
          : h('div.bandeau.bandeau--ok', [
              icone('cocheRonde'),
              h('span', 'Toutes les pièces du dossier sont sorties du stock.')
            ]),
        zoneMessage,
        servies.length ? h('div.pile-s', servies.map(l => {
          const p = lit.piece(e, l.pieceId);
          return h('div.carte.carte--muette.rang', [
            h('span.qte', fmt.nb(l.qte, 2)),
            h('div.grandit.coupe', [
              h('div.gras.coupe', l.libelle || (p ? p.libelle : 'Pièce')),
              h('div.minus.tres-faible.coupe',
                [l.ref, p ? p.emplacement : '', p ? 'reste ' + fmt.nb(p.qte, 2) : '']
                  .filter(Boolean).join(' · '))
            ]),
            h('button.bt.bt--contour.bt--s', {
              type: 'button',
              onclick: async () => {
                const ok = await confirmer({
                  titre: 'Rendre au stock ?',
                  texte: (l.libelle || 'Cette pièce') + ' retourne dans le rayon, en '
                    + fmt.nb(l.qte, 2) + ' exemplaire(s).',
                  ok: 'Rendre au stock'
                });
                if (!ok) return;
                act.rendreAuStock(d.id, l.id);
                message('Pièce rendue au stock', { ton: 'ok' });
                refaireStock();
                marquerServies();
              }
            }, [icone('retour', { taille: 14 }), h('span', 'Rendre')])
          ]);
        })) : null
      ])
    ]));
  }

  function compteRenduSortie(bilan) {
    const blocs = [];
    if (bilan.sorties.length) {
      blocs.push(h('div.bandeau.bandeau--ok', [
        icone('cocheRonde'),
        h('span', pluriel(bilan.sorties.length, 'pièce sortie', 'pièces sorties') + ' du stock : '
          + bilan.sorties.map(s => s.piece.libelle).join(', '))
      ]));
    }
    for (const m of bilan.manques) {
      blocs.push(h('div.bandeau.bandeau--alerte', [
        icone('alerte'),
        h('span', m.piece.libelle + ' : il en faut ' + fmt.nb(m.demande, 2)
          + ', il en reste ' + fmt.nb(m.dispo, 2) + '.')
      ]));
    }
    if (!blocs.length) {
      blocs.push(h('div.bandeau', [icone('info'), h('span', 'Rien à sortir : tout est déjà servi.')]));
    }
    return blocs;
  }

  /* --- la checklist du technicien ----------------------------------------- */
  function refaireCheck() {
    const liste = d.checklist || [];
    const faites = liste.filter(t => t.fait).length;
    const saisie = h('input.saisie', {
      type: 'text', placeholder: 'Un point à vérifier…', autocomplete: 'off',
      onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ajouter(); } }
    });

    function ajouter() {
      const texte = String(saisie.value || '').trim();
      if (!texte) { saisie.focus(); return; }
      changer(null, (x) => {
        if (!Array.isArray(x.checklist)) x.checklist = [];
        x.checklist.push({ id: id('chk'), texte, fait: false, par: null, quand: null });
      });
      refaireCheck();
    }

    poser(zoneCheck, h('div.panneau', [
      h('div.panneau__tete', [
        icone('coche', { taille: 16 }),
        h('h2.grandit', 'À vérifier'),
        liste.length ? h('span.petit.faible', faites + ' / ' + liste.length) : null
      ]),
      liste.length ? h('div.liste', liste.map(t => h('div.liste__ligne.liste__ligne--muette', [
        h('input', {
          type: 'checkbox',
          checked: !!t.fait,
          'aria-label': t.texte,
          style: { width: '20px', height: '20px', accentColor: 'var(--accent)', flex: 'none' },
          onchange: (ev) => {
            const coche = ev.target.checked;
            changer(null, (x) => {
              const y = (x.checklist || []).find(z => z.id === t.id);
              if (!y) return;
              y.fait = coche;
              y.par = coche && moi ? moi.id : null;
              y.quand = coche ? Date.now() : null;
            });
            refaireCheck();
          }
        }),
        h('div.grandit', {
          style: t.fait ? { opacity: '.55', textDecoration: 'line-through' } : null
        }, [
          h('div.coupe-2', t.texte),
          t.fait && t.quand ? h('div.minus.tres-faible',
            [t.par ? lit.nomUtilisateur(lit.utilisateur(e, t.par)) : '', fmt.quand(t.quand)]
              .filter(Boolean).join(' · ')) : null
        ]),
        h('button.bt.bt--nu.bt--icone.bt--s', {
          type: 'button', 'aria-label': 'Retirer',
          onclick: () => {
            changer(null, (x) => {
              const i = (x.checklist || []).findIndex(z => z.id === t.id);
              if (i >= 0) x.checklist.splice(i, 1);
            });
            refaireCheck();
          }
        }, icone('croix'))
      ]))) : null,
      h('div.panneau__corps', h('div.rang', [
        h('div.grandit', saisie),
        h('button.bt.bt--contour', { type: 'button', onclick: ajouter },
          [icone('plus'), h('span', 'Ajouter')])
      ]))
    ]));
  }

  refaireStock();
  refaireCheck();
  requestAnimationFrame(marquerServies);

  return h('div.pile', [editeur.noeud, zoneStock, zoneCheck]);
}

/* ==========================================================================
   ONGLET SUIVI — ce qu'on écrit, qui s'en occupe, où c'est garé, quand
   ========================================================================== */

function ongletSuivi(e, d, moi, changer, refaireTete) {
  const zoneAssignes = h('div');
  const zoneParc = h('div');
  const zonePlanning = h('div');
  const zoneNotes = h('div');

  /* --- le récit du dossier ------------------------------------------------- */
  const titre = champ({
    etiquette: 'Objet du dossier', valeur: d.titre || '',
    exemple: 'Ce qui amène le client',
    surChangement: (v) => { changer(null, (x) => { x.titre = v; }); refaireTete(); }
  });
  const demande = champ({
    etiquette: 'Ce que dit le client', type: 'zone', lignes: 3, valeur: d.demande || '',
    aide: 'Ses mots à lui : c’est ce qui fait foi si la panne revient.',
    surChangement: (v) => changer(null, (x) => { x.demande = v; })
  });
  const constat = champ({
    etiquette: 'Constat de l’atelier', type: 'zone', lignes: 3, valeur: d.constat || '',
    surChangement: (v) => changer(null, (x) => { x.constat = v; })
  });
  const travaux = champ({
    etiquette: 'Travaux réalisés', type: 'zone', lignes: 3, valeur: d.travaux || '',
    aide: 'Ce texte part sur la facture : il dit au client ce qu’il a payé.',
    surChangement: (v) => changer(null, (x) => { x.travaux = v; })
  });

  const kmEntree = champ({
    etiquette: 'Km à l’entrée', type: 'km', unite: 'km', valeur: d.kmEntree || '',
    surChangement: (v) => changer(null, (x) => { x.kmEntree = v || null; })
  });
  const kmSortie = champ({
    etiquette: 'Km à la sortie', type: 'km', unite: 'km', valeur: d.kmSortie || '',
    surChangement: (v) => {
      changer(null, (x, etat) => {
        x.kmSortie = v || null;
        /* Le compteur relevé en rendant le véhicule est le chiffre le plus
           frais qu'on aura : il met la fiche du véhicule à jour. */
        const veh = lit.vehicule(etat, x.vehiculeId);
        if (veh && v && v > nombre(veh.km, 0)) { veh.km = v; veh.kmReleveLe = Date.now(); }
      });
    }
  });

  const nature = champ({
    etiquette: 'Nature', type: 'liste', valeur: d.nature,
    options: Object.keys(NATURES).map(k => ({ valeur: k, texte: NATURES[k].nom })),
    surChangement: (v) => { changer(null, (x) => { x.nature = v; }); refaireTete(); }
  });
  const priorite = champ({
    etiquette: 'Priorité', type: 'liste', valeur: d.priorite,
    options: Object.keys(PRIORITES).map(k => ({ valeur: k, texte: PRIORITES[k].nom })),
    surChangement: (v) => { changer(null, (x) => { x.priorite = v; }); refaireTete(); }
  });
  const sortiePrevue = champ({
    etiquette: 'Sortie prévue', type: 'date', valeur: d.sortiePrevue || null,
    aide: 'Ce qu’on a promis au client.',
    surChangement: (v) => changer(null, (x) => { x.sortiePrevue = v || null; })
  });

  /* --- qui s'en occupe ----------------------------------------------------- */
  function refaireAssignes() {
    const equipe = (e.utilisateurs || []).filter(u => u.actif);
    poser(zoneAssignes, h('div.panneau', [
      h('div.panneau__tete', [icone('clients', { taille: 16 }), h('h2.grandit', 'Qui s’en occupe')]),
      h('div.panneau__corps', equipe.length
        ? h('div.rang.enroule', equipe.map(u => {
            const pris = (d.assignes || []).includes(u.id);
            return h('button.filtre', {
              type: 'button',
              'aria-pressed': pris ? 'true' : 'false',
              onclick: () => { act.assigner(d.id, u.id); refaireAssignes(); }
            }, [tete(u, 's'), h('span', lit.nomUtilisateur(u))]);
          }))
        : h('div.petit.faible', 'Aucune personne active dans l’équipe.'))
    ]));
  }

  /* --- la place au parc ---------------------------------------------------- */
  function refaireParc() {
    const libres = lit.placesLibres(e);
    const options = [{ valeur: '', texte: 'Pas de place attribuée' }]
      .concat(d.place ? [{ valeur: d.place, texte: d.place + ' — place actuelle' }] : [])
      .concat(libres.map(p => ({
        valeur: p.code,
        texte: p.code + (p.nomRangee ? ' — ' + p.nomRangee : '')
      })));

    const place = champ({ etiquette: 'Place', type: 'liste', valeur: d.place || '', options });
    const motif = champ({
      etiquette: 'Pourquoi il est là', type: 'liste', valeur: d.motifParc || 'attente',
      options: Object.keys(MOTIFS_PARC).map(k => ({ valeur: k, texte: MOTIFS_PARC[k].nom }))
    });

    const appliquer = () => {
      const voulue = place.lire();
      if (!act.garer(d.id, voulue || null, motif.lire())) {
        messageErreur('Place déjà occupée : choisissez-en une autre.');
        refaireParc();
        return;
      }
      message(voulue ? 'Véhicule garé en ' + voulue : 'Place libérée', { ton: 'ok', duree: 1800 });
      refaireParc();
      refaireTete();
    };
    place.entree.addEventListener('change', appliquer);
    motif.entree.addEventListener('change', appliquer);

    poser(zoneParc, h('div.panneau', [
      h('div.panneau__tete', [
        icone('parc', { taille: 16 }),
        h('h2.grandit', 'Au parc'),
        h('a.bt.bt--nu.bt--s', { href: '#/parc' }, 'Le plan')
      ]),
      h('div.panneau__corps', grilleChamps([place, motif]))
    ]));
  }

  /* --- le planning --------------------------------------------------------- */
  function refairePlanning() {
    const creneaux = lit.creneauxDuDossier(e, d.id);
    poser(zonePlanning, h('div.panneau', [
      h('div.panneau__tete', [
        icone('planning', { taille: 16 }),
        h('h2.grandit', 'Planning'),
        h('button.bt.bt--nu.bt--s', {
          type: 'button',
          onclick: () => modaleCreneau(e, d, moi, refairePlanning)
        }, [icone('plus'), h('span', 'Poser un créneau')])
      ]),
      creneaux.length
        ? h('div.liste', creneaux.map(cr => {
            const u = cr.userId ? lit.utilisateur(e, cr.userId) : null;
            return h('a.liste__ligne', { href: '#/planning' }, [
              h('div', { style: { minWidth: '78px' } }, [
                h('div.gras.num', fmt.date(cr.debut, 'jourMois')),
                h('div.minus.tres-faible', fmt.heure(cr.debut) + ' · ' + fmt.duree(cr.fin - cr.debut))
              ]),
              h('div.grandit.coupe', [
                h('div.coupe', cr.titre || lit.titreDossier(e, d)),
                cr.fait ? h('div.minus.tres-faible', 'fait') : null
              ]),
              u ? tete(u, 's') : null
            ]);
          }))
        : h('div.panneau__corps', h('div.petit.faible.centre', 'Aucun créneau posé pour ce dossier.'))
    ]));
  }

  /* --- les notes ----------------------------------------------------------- */
  function refaireNotes() {
    const saisie = champ({
      type: 'zone', lignes: 2, etiquette: 'Ajouter une note',
      exemple: 'Ce qu’il faut se rappeler demain matin'
    });
    const notes = (d.notes || []).slice().sort((a, b) => (b.quand || 0) - (a.quand || 0));

    poser(zoneNotes, h('div.panneau', [
      h('div.panneau__tete', [icone('epingle', { taille: 16 }), h('h2.grandit', 'Notes')]),
      h('div.panneau__corps.pile', [
        saisie.noeud,
        h('button.bt.bt--contour', {
          type: 'button',
          onclick: () => {
            const t = saisie.lire();
            if (!t) { saisie.focus(); return; }
            act.noterDansDossier(d.id, t);
            refaireNotes();
          }
        }, [icone('plus'), h('span', 'Noter')]),
        notes.length ? fil(notes.map(n => ({
          quand: n.quand,
          icone: 'epingle',
          texte: n.texte,
          qui: n.qui ? lit.nomUtilisateur(lit.utilisateur(e, n.qui)) : null
        }))) : h('div.petit.faible', 'Aucune note pour l’instant.')
      ])
    ]));
  }

  refaireAssignes();
  refaireParc();
  refairePlanning();
  refaireNotes();

  return h('div.deux-colonnes', [
    h('div.pile', [
      h('div.panneau', [
        h('div.panneau__tete', [icone('document', { taille: 16 }), h('h2.grandit', 'Le dossier')]),
        h('div.panneau__corps.pile', [
          titre.noeud,
          demande.noeud,
          constat.noeud,
          travaux.noeud,
          grilleChamps([kmEntree, kmSortie]),
          grilleChamps([nature, priorite, sortiePrevue])
        ])
      ]),
      zoneNotes
    ]),
    h('div.pile', [
      zoneAssignes,
      zoneParc,
      zonePlanning,
      histoire(e, d)
    ])
  ]);
}

/** Poser un créneau pour ce dossier : qui, quel jour, à quelle heure, combien
 *  de temps. Le reste (le dossier, le client, le véhicule) se déduit. */
function modaleCreneau(e, d, moi, apres) {
  const equipe = (e.utilisateurs || []).filter(u => u.actif);
  const qui = champ({
    etiquette: 'Pour qui', type: 'liste',
    valeur: moi ? moi.id : (equipe[0] ? equipe[0].id : ''),
    options: equipe.map(u => ({ valeur: u.id, texte: lit.nomUtilisateur(u) }))
  });
  const jour = champ({ etiquette: 'Jour', type: 'date', valeur: Date.now() });
  const debut = champ({
    etiquette: 'Début', type: 'heure',
    valeur: e.reglages.heureDebut || '08:00'
  });
  const duree = champ({
    etiquette: 'Durée', type: 'liste',
    valeur: String(nombre(e.reglages.dureeDefaut, 60)),
    options: [30, 60, 90, 120, 180, 240, 480].map(n => ({
      valeur: String(n), texte: fmt.duree(n * MINUTE)
    }))
  });
  const objet = champ({ etiquette: 'Intitulé', valeur: lit.titreDossier(e, d) });

  modale({
    titre: 'Poser un créneau',
    corps: h('div.pile', [
      qui.noeud,
      grilleChamps([jour, debut, duree]),
      objet.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Poser', ton: 'fort',
        faire: () => {
          const j = jour.lire();
          const minutes = debut.lire();
          if (!j) { jour.erreur('Choisissez un jour.'); return false; }
          if (minutes === null) { debut.erreur('Une heure, sous la forme 08:30.'); return false; }
          const depart = jour0(j) + minutes * MINUTE;
          act.poserCreneau({
            userId: qui.lire() || null,
            dossierId: d.id,
            clientId: d.clientId,
            vehiculeId: d.vehiculeId,
            titre: objet.lire(),
            type: d.nature === 'electro' ? 'electro' : 'travaux',
            debut: depart,
            fin: depart + nombre(duree.lire(), 60) * MINUTE
          });
          message('Créneau posé', { ton: 'ok' });
          apres();
        }
      }
    ]
  });
}

/** L'histoire du dossier, reconstituée : son ouverture, ce que le journal a
 *  retenu de lui, ses devis et sa facture. */
function histoire(e, d) {
  const nom = (userId) => (userId ? lit.nomUtilisateur(lit.utilisateur(e, userId)) : null);
  const evenements = [];

  evenements.push({
    quand: d.entree || d.cree,
    icone: 'dossier',
    texte: 'Dossier ' + (d.numero || '') + ' ouvert'
  });

  for (const j of e.journal || []) {
    if (!j.cible || j.cible.type !== 'dossiers' || j.cible.id !== d.id) continue;
    evenements.push({ quand: j.quand, icone: 'historique', texte: j.quoi, qui: nom(j.qui) });
  }

  for (const dv of lit.devisDuDossier(e, d.id)) {
    evenements.push({
      quand: dv.cree, icone: 'devis',
      texte: 'Devis ' + dv.numero + ' (version ' + dv.version + ') établi'
    });
    if (dv.envoyeLe) evenements.push({ quand: dv.envoyeLe, icone: 'partage', texte: 'Devis ' + dv.numero + ' envoyé au client' });
    if (dv.repondeLe) {
      evenements.push({
        quand: dv.repondeLe,
        icone: dv.statut === 'accepte' ? 'coche' : 'croix',
        texte: 'Devis ' + dv.numero + (dv.statut === 'accepte' ? ' accepté' : ' refusé')
      });
    }
  }

  const f = d.factureId ? lit.facture(e, d.factureId) : null;
  if (f) {
    evenements.push({ quand: f.cree, icone: 'facture', texte: 'Facture ' + f.numero + ' préparée' });
    if (f.emiseLe) evenements.push({ quand: f.emiseLe, icone: 'facture', texte: 'Facture ' + f.numero + ' émise' });
    for (const r of f.reglements || []) {
      evenements.push({ quand: r.quand, icone: 'euro', texte: 'Règlement de ' + fmt.euros(r.montant), qui: nom(r.qui) });
    }
  }

  if (d.sortie) evenements.push({ quand: d.sortie, icone: 'sortir', texte: 'Véhicule rendu' });

  evenements.sort((a, b) => (b.quand || 0) - (a.quand || 0));

  return h('div.panneau', [
    h('div.panneau__tete', [icone('historique', { taille: 16 }), h('h2.grandit', 'Historique')]),
    h('div.panneau__corps', fil(evenements.slice(0, 40))
      || h('div.petit.faible', 'Rien à raconter pour l’instant.'))
  ]);
}

/* ==========================================================================
   ONGLET DEVIS & FACTURE
   ========================================================================== */

function ongletFacturation(e, d, ctx) {
  const devis = lit.devisDuDossier(e, d.id);
  const f = d.factureId ? lit.facture(e, d.factureId) : null;
  const ctxPrix = lit.prixDe(e, d.clientId);

  const blocDevis = h('div.panneau', [
    h('div.panneau__tete', [
      icone('devis', { taille: 16 }),
      h('h2.grandit', 'Devis'),
      h('button.bt.bt--fort.bt--s', {
        type: 'button', onclick: () => creerDevisEtOuvrir(d, ctx)
      }, [icone('plus'), h('span', 'Créer un devis')])
    ]),
    devis.length
      ? h('div.liste', devis.map(dv => {
          const t = totaux(dv, ctxPrix);
          return h('a.liste__ligne', { href: '#/devis/' + dv.id }, [
            h('div.grandit.coupe', [
              h('div.gras.coupe', dv.numero + (dv.version > 1 ? ' — version ' + dv.version : '')),
              h('div.minus.tres-faible.coupe',
                [fmt.date(dv.cree, 'court'), dv.objet].filter(Boolean).join(' · '))
            ]),
            pastilleDevis(dv.statut),
            h('div.gras.num', fmt.euros(t.ttc)),
            icone('droite', { taille: 15, classe: 'tres-faible' })
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Aucun devis. Le premier reprend les lignes de l’onglet Travaux.'))
  ]);

  const blocFacture = h('div.panneau', [
    h('div.panneau__tete', [icone('facture', { taille: 16 }), h('h2.grandit', 'Facture')]),
    f
      ? h('div.liste', [
          (() => {
            const t = totaux(f, ctxPrix);
            return h('a.liste__ligne', { href: '#/facture/' + f.id }, [
              h('div.grandit.coupe', [
                h('div.gras.coupe', f.numero + (f.numeroEbp ? ' · EBP ' + f.numeroEbp : '')),
                h('div.minus.tres-faible.coupe', f.echeanceLe
                  ? 'échéance ' + fmt.date(f.echeanceLe, 'court') : 'sans échéance')
              ]),
              pastilleFacture(f.statut),
              h('div.droite', [
                h('div.gras.num', fmt.euros(t.ttc)),
                t.reste > 0.005
                  ? h('div.minus.tres-faible', 'reste ' + fmt.euros(t.reste))
                  : h('div.minus.tres-faible', 'soldée')
              ]),
              icone('droite', { taille: 15, classe: 'tres-faible' })
            ]);
          })()
        ])
      : h('div.panneau__corps.pile', [
          h('div.petit.faible', 'Pas encore de facture pour ce dossier.'),
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => {
              const nouvelle = act.creerFacture(d.id);
              if (!nouvelle) { messageErreur('La facture n’a pas pu être préparée.'); return; }
              message('Facture ' + nouvelle.numero + ' préparée', { ton: 'ok' });
              ctx.aller('/facture/' + nouvelle.id);
            }
          }, [icone('facture'), h('span', 'Préparer la facture')])
        ])
  ]);

  return h('div.deux-colonnes', [
    h('div.pile', [blocDevis, blocFacture]),
    h('div.pile', [
      h('div.panneau', [
        h('div.panneau__tete', [icone('euro', { taille: 16 }), h('h2.grandit', 'Total du dossier')]),
        h('div.panneau__corps', blocTotaux(lit.totauxDossier(e, d)))
      ])
    ])
  ]);
}

/* ==========================================================================
   ONGLET PHOTOS
   Une photo avant démontage vaut toutes les explications quand le client
   revient trois semaines plus tard.
   ========================================================================== */

function ongletPhotos(e, d, changer, refaireOnglets) {
  const grille = h('div.dossier-photos');
  const zoneEtat = h('div');

  function refaireGrille() {
    const photos = (d.photos || []).slice().sort((a, b) => (b.quand || 0) - (a.quand || 0));
    if (!photos.length) {
      poser(grille, []);
      poser(zoneEtat, h('div.vide', [
        icone('camera', { taille: 34 }),
        h('h3', 'Aucune photo'),
        h('p', 'Prenez l’état du véhicule à l’entrée, la pièce usée, le numéro du calculateur.')
      ]));
      return;
    }
    poser(zoneEtat, []);
    poser(grille, photos.map(p => h('button.dossier-photo', {
      type: 'button',
      'aria-label': p.legende || ('Photo du ' + fmt.dateHeure(p.quand)),
      onclick: () => agrandir(p)
    }, [
      h('img', { src: p.donnee, alt: p.legende || '', loading: 'lazy' }),
      h('span.dossier-photo__pied', p.legende || fmt.date(p.quand, 'court'))
    ])));
  }

  function agrandir(p) {
    const legende = champ({ etiquette: 'Légende', valeur: p.legende || '' });
    modale({
      titre: 'Photo du ' + fmt.dateHeure(p.quand),
      taille: 'large',
      corps: h('div.pile', [
        h('img.dossier-photo__grande', { src: p.donnee, alt: p.legende || '' }),
        legende.noeud
      ]),
      actions: [
        {
          texte: 'Supprimer', ton: 'danger',
          faire: async () => {
            const ok = await confirmer({
              titre: 'Supprimer cette photo ?',
              texte: 'Elle ne sera plus dans le dossier.',
              ok: 'Supprimer', danger: true
            });
            if (!ok) return false;
            changer('Photo supprimée', (x) => {
              const i = (x.photos || []).findIndex(y => y.id === p.id);
              if (i >= 0) x.photos.splice(i, 1);
            });
            refaireGrille();
            refaireOnglets();
          }
        },
        {
          texte: 'Enregistrer', ton: 'fort',
          faire: () => {
            changer(null, (x) => {
              const y = (x.photos || []).find(z => z.id === p.id);
              if (y) y.legende = legende.lire();
            });
            refaireGrille();
          }
        }
      ]
    });
  }

  async function prendre() {
    const fichiers = await choisirFichier({ accepte: 'image/*', appareilPhoto: true, plusieurs: true });
    if (!fichiers || !fichiers.length) return;

    let ajoutees = 0;
    for (const f of fichiers) {
      let reduite = null;
      try {
        reduite = await reduireImage(f, { maxi: 1400 });
      } catch (err) {
        /* Un fichier HEIC d'iPhone, une image corrompue, un navigateur sans
           canvas : on le dit pour ce fichier-là et on continue les autres. */
        messageErreur('Photo « ' + (f.name || 'sans nom') + ' » illisible : elle n’a pas été ajoutée.');
        continue;
      }
      if (!reduite || !reduite.donnee) continue;
      changer(null, (x) => {
        if (!Array.isArray(x.photos)) x.photos = [];
        x.photos.push({ id: id('pho'), donnee: reduite.donnee, quand: Date.now(), legende: '' });
      });
      ajoutees++;
    }

    if (ajoutees) {
      message(pluriel(ajoutees, 'photo ajoutée', 'photos ajoutées'), { ton: 'ok' });
      refaireGrille();
      refaireOnglets();
    }
  }

  refaireGrille();

  return h('div.pile', [
    h('div.rang.enroule', [
      h('button.bt.bt--fort', { type: 'button', onclick: prendre },
        [icone('camera'), h('span', 'Prendre une photo')]),
      h('span.petit.faible', 'Les photos sont réduites avant d’être rangées : elles restent lisibles '
        + 'sans remplir la mémoire de l’appareil.')
    ]),
    zoneEtat,
    grille
  ]);
}
