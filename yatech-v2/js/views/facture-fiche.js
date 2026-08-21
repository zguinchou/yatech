/* ==========================================================================
   YATECH — la fiche d'une facture
   --------------------------------------------------------------------------
   La facture officielle vit dans EBP. Celle-ci sert à trois choses : préparer
   ce qu'il faudra saisir là-bas, suivre ce qui rentre vraiment, et garder la
   trace du voyage vers EBP. Rien d'autre.

   D'où la coupure qui tient tout l'écran : tant que la facture est « à
   facturer », elle se travaille comme un brouillon — on ajoute une ligne, on
   corrige un prix. Dès qu'elle est ÉMISE, elle est figée : c'est le papier
   que le client a entre les mains, et un montant qui bouge après coup est un
   montant qu'on ne sait plus expliquer. Pour corriger, on passe par un avoir
   dans EBP, pas par cet écran.

   L'argent, lui, continue d'arriver après l'émission : les règlements
   s'ajoutent, se suppriment quand on s'est trompé, et c'est le reste dû qui
   décide du statut — jamais l'inverse.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, demander, menu, message, messageErreur, vide } from '../core/ui.js';
import { maj } from '../core/store.js';
import { copier } from '../core/fichiers.js';
import * as fmt from '../core/fmt.js';
import { borne, jour0, ecartJours, pluriel } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import * as ebp from '../domain/ebp.js';
import { totaux, verifierDocument } from '../domain/calculs.js';
import { MODES_REGLEMENT, STATUTS_FACTURE } from '../domain/schema.js';
import { editeurLignes } from '../ui/lignes.js';
import { champ, pastilleFacture, plaque, lienTel, lienMail, fil } from '../ui/widgets.js';
import { imprimer } from './impression.js';

export function peindre(ctx) {
  const e = ctx.etat;
  const identifiant = ctx.params.id;

  if (!lit.facture(e, identifiant)) {
    return vide({
      icone: 'question',
      titre: 'Facture introuvable',
      texte: 'Cette facture a été supprimée, ou le lien ne pointe plus sur rien.',
      action: { texte: 'Voir toutes les factures', faire: () => ctx.aller('/factures') }
    });
  }

  const zoneTete = h('div.pile');
  const zoneLignes = h('div');
  const zoneCote = h('div.pile');

  const racine = h('div.pile', [
    zoneTete,
    h('div.deux-colonnes', [zoneLignes, zoneCote])
  ]);

  /* Chaque zone relit la facture dans l'état au lieu de garder l'objet capturé
     à la peinture : après un encaissement ou une émission, c'est la version
     fraîche qu'il faut dessiner, pas celle d'il y a trois clics. */
  const ecran = {
    etat: e,
    ctx,
    facture: () => lit.facture(e, identifiant),
    refaireTete() {
      const f = ecran.facture();
      if (f) poser(zoneTete, [ficheTete(ecran, f), bandeaux(ecran, f)]);
    },
    refaireLignes() {
      const f = ecran.facture();
      if (f) poser(zoneLignes, panneauLignes(ecran, f));
    },
    refaireCote() {
      const f = ecran.facture();
      if (!f) return;
      poser(zoneCote, [
        panneauReglements(ecran, f),
        panneauEbp(ecran, f),
        panneauHistoire(e, f)
      ]);
    },
    /* Un règlement change à la fois la jauge, les totaux du bloc de lignes,
       la pastille de l'en-tête et le fil : tout bouge ensemble. */
    refaireTout() { ecran.refaireTete(); ecran.refaireLignes(); ecran.refaireCote(); }
  };

  ecran.refaireTout();
  return racine;
}

/* ==========================================================================
   CE QU'ON RECALCULE PARTOUT
   ========================================================================== */

const totauxDe = (e, f) => totaux(f, lit.prixDe(e, f.clientId));

/** Une facture est soldée quand il reste moins d'un demi-centime : c'est le
 *  seuil que le domaine emploie pour décider du statut, on ne l'invente pas.
 *  Mais « soldée » ne veut rien dire d'une facture encore vide : un total à
 *  zéro laisse un reste à zéro sans qu'un centime soit jamais entré. */
const estSoldee = (f, t) => t.reste <= 0.005 && (t.ttc > 0.005 || f.statut === 'reglee');

/** Une échéance ne « dépasse » que si la facture existe vraiment : une facture
 *  préparée mais pas encore émise porte une échéance provisoire. */
const enRetard = (f, t) =>
  !!(f.echeanceLe && f.echeanceLe < Date.now() && f.statut !== 'attente' && !estSoldee(f, t));

/* ==========================================================================
   L'EN-TÊTE — qui, combien, pour quand, et le geste du moment
   ========================================================================== */

function ficheTete(ecran, f) {
  const e = ecran.etat;
  const c = lit.client(e, f.clientId);
  const v = lit.vehicule(e, f.vehiculeId);
  const d = f.dossierId ? lit.dossier(e, f.dossierId) : null;
  const t = totauxDe(e, f);
  const retard = enRetard(f, t);

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      h('div.rang-s.enroule', [
        pastilleFacture(f.statut),
        f.ebp ? h('span.etiq', f.numeroEbp ? 'EBP ' + f.numeroEbp : 'saisie dans EBP') : null
      ]),
      h('h1.num', f.numero || 'Facture'),
      h('div.faible', fmt.euros(t.ttc) + ' TTC'
        + (estSoldee(f, t) ? ' · soldée' : ' · reste ' + fmt.euros(t.reste))),
      h('div.fiche-tete__lignes', [
        c ? h('a.rang-s', { href: '#/client/' + c.id }, [
          icone('clients', { taille: 14 }), h('span.coupe', lit.nomClient(c))
        ]) : null,
        v ? h('a.rang-s', { href: '#/vehicule/' + v.id }, [
          plaque(v.immat), h('span.coupe', lit.nomVehicule(v))
        ]) : null,
        d ? h('a.rang-s', { href: '#/dossier/' + d.id }, [
          icone('dossier', { taille: 14 }),
          h('span.coupe', 'dossier ' + (d.numero || lit.titreDossier(e, d)))
        ]) : null,
        h('span.rang-s', [
          icone('horloge', { taille: 14 }),
          h('span', f.emiseLe
            ? 'émise le ' + fmt.date(f.emiseLe, 'normal')
            : 'pas encore émise')
        ]),
        h('span.rang-s', {
          /* L'échéance dépassée est la seule information de cette barre qui
             demande une action : elle se lit avant les autres. */
          classe: retard ? 'gras' : '',
          style: retard ? { color: 'var(--danger)' } : null
        }, [
          icone(retard ? 'alerte' : 'sablier', { taille: 14 }),
          h('span', f.echeanceLe
            ? (retard ? 'échéance dépassée le ' : 'à payer avant le ')
              + fmt.date(f.echeanceLe, 'normal')
            : 'sans échéance')
        ]),
        f.ebp ? h('span.rang-s', [
          icone('presse', { taille: 14 }),
          h('span', f.numeroEbp ? 'n° EBP ' + f.numeroEbp : 'reportée dans EBP')
        ]) : null,
        c ? lienTel(c.tel) : null,
        c ? lienMail(c.email) : null
      ])
    ]),
    h('div.fiche-tete__actions', actions(ecran, f, t))
  ]);
}

/**
 * Les boutons suivent le statut : à chaque moment de la vie d'une facture il
 * n'y a qu'un geste évident, et il doit être le plus gros.
 */
function actions(ecran, f, t) {
  const e = ecran.etat;
  const liste = [];
  const reste = t.reste;

  if (f.statut === 'attente') {
    liste.push(h('button.bt.bt--fort', {
      type: 'button', onclick: () => emettre(ecran, f)
    }, [icone('facture'), h('span', 'Émettre')]));
  }

  if (reste > 0.005) {
    liste.push(h('button.bt' + (f.statut === 'attente' ? '.bt--contour' : '.bt--fort'), {
      type: 'button', onclick: () => modaleReglement(ecran, f)
    }, [icone('argent'), h('span', 'Encaisser')]));
  }

  liste.push(h('button.bt.bt--contour', {
    type: 'button', onclick: () => imprimer(e, f, 'facture')
  }, [icone('imprimer'), h('span', 'Imprimer / PDF')]));

  liste.push(h('button.bt.bt--contour.bt--icone', {
    type: 'button', 'aria-label': 'Autres actions',
    onclick: (ev) => menuAutres(ecran, f, ev.currentTarget)
  }, icone('points')));

  return liste;
}

function menuAutres(ecran, f, ancre) {
  const e = ecran.etat;
  const items = [
    { titre: f.numero || 'Facture' },
    {
      texte: 'Copier pour EBP', icone: 'copier',
      faire: () => copierPourEbp(e, f)
    },
    {
      texte: 'Exporter en CSV EBP', icone: 'telecharger',
      faire: () => {
        ebp.telechargerFactures(e, [f]);
        message('Fichier CSV prêt pour l’import EBP', { ton: 'ok' });
      }
    },
    {
      texte: f.ebp ? 'Corriger le numéro EBP' : 'Marquer reportée dans EBP', icone: 'presse',
      faire: () => marquerReportee(ecran, f)
    }
  ];

  if (f.dossierId) {
    items.push({
      texte: 'Voir le dossier', icone: 'dossier',
      faire: () => ecran.ctx.aller('/dossier/' + f.dossierId)
    });
  }

  items.push(null);
  items.push({
    texte: 'Supprimer la facture', icone: 'poubelle', danger: true,
    faire: () => supprimer(ecran, f)
  });

  menu(ancre, items);
}

/* ==========================================================================
   LES BANDEAUX — dire pourquoi, plutôt que de griser en silence
   ========================================================================== */

function bandeaux(ecran, f) {
  const t = totauxDe(ecran.etat, f);
  const liste = [];

  if (f.statut === 'attente') {
    liste.push(h('div.bandeau', [
      icone('info'),
      h('div.grandit', [
        h('b', 'Facture préparée, pas encore émise'),
        h('div', (STATUTS_FACTURE.attente.aide || '')
          + ' Les lignes se corrigent librement tant qu’elle n’est pas émise ; '
          + 'après, elles sont figées.')
      ])
    ]));
  }

  if (enRetard(f, t)) {
    const jours = Math.max(0, ecartJours(f.echeanceLe, Date.now()));
    liste.push(h('div.bandeau.bandeau--danger', [
      icone('alerte'),
      h('div.grandit', [
        h('b', 'Impayée depuis ' + pluriel(jours, 'jour', 'jours')),
        h('div', 'Il reste ' + fmt.euros(t.reste) + ' à encaisser sur cette facture.')
      ])
    ]));
  }

  return liste;
}

/* ==========================================================================
   LES LIGNES
   ========================================================================== */

function panneauLignes(ecran, f) {
  const e = ecran.etat;
  const modifiable = f.statut === 'attente';

  const editeur = editeurLignes({
    etat: e,
    lignes: f.lignes,
    ctx: lit.prixDe(e, f.clientId),
    remise: f.remiseGlobale,
    lecture: !modifiable,
    /* Les règlements descendent jusqu'au bloc des totaux : c'est lui qui
       affiche « déjà réglé » et le reste à payer, et il doit dire la même
       chose que la jauge d'à côté. */
    reglements: f.reglements,
    /* L'éditeur prévient à chaque frappe. On enregistre sans journaliser :
       sinon taper une désignation écrit trente lignes d'historique. */
    surChangement: (lignes, remise) => {
      maj(null, (etat) => {
        const x = lit.facture(etat, f.id);
        if (!x) return;
        x.lignes = lignes;
        x.remiseGlobale = remise;
        x.maj = Date.now();
      }, { journal: false });
    }
  });

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('facture', { taille: 16 }),
      h('h2.grandit', modifiable ? 'Ce qui sera facturé' : 'Ce que le client a reçu'),
      modifiable ? null : h('span.rang-s.petit.faible', [
        icone('cadenas', { taille: 14 }), h('span', 'lecture seule')
      ])
    ]),
    h('div.panneau__corps', editeur.noeud)
  ]);
}

/* ==========================================================================
   LES RÈGLEMENTS — ce qui est réellement rentré
   ========================================================================== */

function panneauReglements(ecran, f) {
  const e = ecran.etat;
  const t = totauxDe(e, f);
  const regles = (f.reglements || []).slice().sort((a, b) => (a.quand || 0) - (b.quand || 0));
  const part = t.ttc > 0 ? borne(t.regle / t.ttc, 0, 1) : (estSoldee(f, t) ? 1 : 0);
  const ton = estSoldee(f, t) ? 'ok' : (enRetard(f, t) ? 'danger' : '');

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('argent', { taille: 16 }),
      h('h2.grandit', 'Règlements'),
      regles.length ? h('span.compte', String(regles.length)) : null
    ]),
    h('div.panneau__corps.pile-s', [
      h('div.rang.entre', [
        h('span.petit.faible', fmt.euros(t.regle) + ' encaissés sur ' + fmt.euros(t.ttc)),
        h('b', { style: estSoldee(f, t) ? { color: 'var(--ok)' } : null },
          estSoldee(f, t) ? 'soldée' : 'reste ' + fmt.euros(t.reste))
      ]),
      h('div.jauge' + (ton ? '.jauge--' + ton : ''),
        h('i', { style: { width: Math.round(part * 100) + '%' } }))
    ]),
    regles.length
      ? h('div.liste', regles.map(r => ligneReglement(ecran, f, r)))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Rien d’encaissé pour l’instant.')),
    h('div.panneau__pied', h('button.bt.bt--contour.bt--plein', {
      type: 'button', onclick: () => modaleReglement(ecran, f)
    }, [icone('plus'), h('span', 'Enregistrer un règlement')]))
  ]);
}

function ligneReglement(ecran, f, r) {
  const u = r.qui ? lit.utilisateur(ecran.etat, r.qui) : null;
  const detail = [
    MODES_REGLEMENT[r.mode] || r.mode || 'Autre',
    u ? 'par ' + lit.nomUtilisateur(u) : ''
  ].filter(Boolean).join(' · ');

  return h('div.liste__ligne.liste__ligne--muette', [
    h('div.grandit.coupe', [
      h('div.rang-s', [
        h('b.num', fmt.euros(r.montant)),
        h('span.petit.faible', 'le ' + fmt.date(r.quand, 'normal'))
      ]),
      h('div.minus.tres-faible.coupe', detail),
      r.note ? h('div.petit.faible.coupe-2', r.note) : null
    ]),
    h('button.bt.bt--nu.bt--icone.bt--s', {
      type: 'button', 'aria-label': 'Supprimer ce règlement',
      onclick: () => supprimerReglement(ecran, f, r)
    }, icone('poubelle'))
  ]);
}

/**
 * La modale d'encaissement : le client est au comptoir, la carte à la main.
 * Le montant est pré-rempli avec le reste dû parce que c'est le cas neuf fois
 * sur dix, et retaper un montant au centime près fait des fautes de frappe.
 */
function modaleReglement(ecran, f) {
  const e = ecran.etat;
  const t = totauxDe(e, f);
  const reste = Math.max(0, t.reste);

  const montant = champ({
    type: 'euros', etiquette: 'Montant encaissé', unite: '€',
    valeur: fmt.montant(reste, 2), autofocus: true
  });
  const mode = champ({
    type: 'liste', etiquette: 'Mode de règlement', valeur: 'cb',
    options: Object.keys(MODES_REGLEMENT).map(k => ({ valeur: k, texte: MODES_REGLEMENT[k] }))
  });
  const quand = champ({
    type: 'date', etiquette: 'Date du règlement', valeur: Date.now(),
    aide: 'Un chèque reçu la semaine dernière se date de la semaine dernière.'
  });
  const note = champ({ etiquette: 'Note (facultatif)', exemple: 'N° de chèque, banque…' });

  const solder = h('button.bt.bt--contour.bt--s', {
    type: 'button',
    onclick: () => { montant.ecrire(fmt.montant(reste, 2)); montant.focus(); }
  }, [icone('coche', { taille: 14 }), h('span', 'Solder : ' + fmt.euros(reste))]);

  modale({
    titre: 'Encaisser la facture ' + (f.numero || ''),
    corps: h('div.pile', [
      h('div.petit.faible', fmt.euros(t.ttc) + ' TTC · déjà réglé '
        + fmt.euros(t.regle) + ' · reste ' + fmt.euros(reste)),
      montant.noeud,
      reste > 0.005 ? h('div.rang.enroule', [solder]) : null,
      mode.noeud,
      quand.noeud,
      note.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: async () => {
          const m = montant.lire();
          if (!(m > 0)) { montant.erreur('Un montant supérieur à zéro.'); return false; }

          /* Encaisser plus que le reste dû est presque toujours une faute de
             frappe. Presque : un client peut arrondir. On demande, on
             n'interdit pas. */
          if (m > reste + 0.005) {
            const quandMeme = await confirmer({
              titre: 'Plus que le reste dû ?',
              texte: 'Vous encaissez ' + fmt.euros(m) + ' alors qu’il reste '
                + fmt.euros(reste) + '. La facture passera en trop-perçu.',
              ok: 'Encaisser quand même'
            });
            if (!quandMeme) { montant.focus(); return false; }
          }

          const apres = act.encaisser(f.id, m, mode.lire(), note.lire());
          if (!apres) { messageErreur('Le règlement n’a pas pu être enregistré.'); return false; }
          daterDernierReglement(f.id, quand.lire());

          message('Règlement de ' + fmt.euros(m) + ' enregistré', { ton: 'ok' });
          ecran.refaireTout();
        }
      }
    ]
  });
}

/** `act.encaisser` date le règlement de l'instant : c'est juste au comptoir,
 *  faux pour un chèque arrivé jeudi dernier. On rectifie la date seulement si
 *  la personne en a choisi une autre, pour garder l'heure quand c'est le jour
 *  même — deux règlements du même jour se relisent alors dans l'ordre. */
function daterDernierReglement(factureId, quand) {
  if (!quand || jour0(quand) === jour0()) return;
  maj(null, (etat) => {
    const x = lit.facture(etat, factureId);
    if (!x || !x.reglements || !x.reglements.length) return;
    x.reglements[x.reglements.length - 1].quand = quand;
    x.maj = Date.now();
  }, { journal: false });
}

/**
 * Supprimer un règlement, c'est réparer une erreur de saisie — pas rendre
 * l'argent. Le statut se recalcule exactement comme le fait `act.encaisser` :
 * c'est le reste dû qui commande, jamais un clic.
 */
async function supprimerReglement(ecran, f, r) {
  const ok = await confirmer({
    titre: 'Supprimer ce règlement ?',
    texte: fmt.euros(r.montant) + ' du ' + fmt.date(r.quand, 'normal')
      + ' (' + (MODES_REGLEMENT[r.mode] || r.mode || 'autre') + ').',
    detail: 'À faire seulement en cas d’erreur de saisie : le montant sera '
      + 'de nouveau dû sur cette facture.',
    danger: true,
    ok: 'Supprimer'
  });
  if (!ok) return;

  maj('Règlement supprimé', (etat) => {
    const x = lit.facture(etat, f.id);
    if (!x) return null;
    const i = (x.reglements || []).findIndex(y => y.id === r.id);
    if (i < 0) return null;
    x.reglements.splice(i, 1);

    /* La même règle qu'à l'encaissement, à la virgule près. Une facture qui
       retombe sans aucun règlement reste « émise » : elle a bien été établie,
       c'est seulement l'argent qui n'est plus là. */
    const t = totaux(x, lit.prixDe(etat, x.clientId));
    x.statut = t.reste <= 0.005 ? 'reglee' : (t.regle > 0 ? 'partiel' : 'emise');
    x.maj = Date.now();
    return x;
  }, { cible: { type: 'factures', id: f.id } });

  message('Règlement supprimé');
  ecran.refaireTout();
}

/* ==========================================================================
   EBP — la facturation officielle se fait là-bas
   ========================================================================== */

function panneauEbp(ecran, f) {
  const e = ecran.etat;

  return h('div.panneau', [
    h('div.panneau__tete', [icone('presse', { taille: 16 }), h('h2.grandit', 'EBP')]),
    h('div.panneau__corps.pile-s', f.ebp ? dejaDansEbp(ecran, f) : pasEncoreDansEbp(ecran, f, e))
  ]);
}

function dejaDansEbp(ecran, f) {
  return [
    h('div.bandeau.bandeau--ok', [
      icone('cocheRonde'),
      h('div.grandit', [
        h('b', 'Reportée dans EBP'),
        h('div', 'le ' + fmt.date(f.ebp, 'lettre')
          + (f.numeroEbp ? ' · numéro ' + f.numeroEbp : ' · sans numéro noté'))
      ])
    ]),
    h('button.bt.bt--nu.bt--s', {
      type: 'button', onclick: () => marquerReportee(ecran, f)
    }, [icone('crayon'), h('span', f.numeroEbp ? 'Corriger le numéro' : 'Noter le numéro EBP')])
  ];
}

function pasEncoreDansEbp(ecran, f, e) {
  return [
    h('div.bandeau.bandeau--alerte', [
      icone('televerser'),
      h('div.grandit', [
        h('b', 'Pas encore dans EBP'),
        h('div', 'Cette facture n’existe officiellement que le jour où elle est saisie '
          + 'dans EBP. Importez le fichier, ou recopiez la fiche ci-dessous.')
      ])
    ]),
    h('div.rang.enroule', [
      h('button.bt.bt--contour.bt--s', {
        type: 'button',
        onclick: () => {
          ebp.telechargerFactures(e, [f]);
          message('Fichier CSV prêt pour l’import EBP', { ton: 'ok' });
        }
      }, [icone('telecharger'), h('span', 'Exporter en CSV EBP')]),
      h('button.bt.bt--contour.bt--s', {
        type: 'button', onclick: () => copierPourEbp(e, f)
      }, [icone('copier'), h('span', 'Copier la fiche')]),
      h('button.bt.bt--nu.bt--s', {
        type: 'button', onclick: () => marquerReportee(ecran, f)
      }, [icone('coche'), h('span', 'C’est saisi')])
    ]),
    /* La fiche à recopier tient dans un bloc préformaté : sur téléphone, au
       comptoir, la relire à l'écran va plus vite qu'ouvrir un fichier. */
    h('pre.facture-fiche__ebp', { texte: ebp.ficheASaisir(e, f) })
  ];
}

async function copierPourEbp(e, f) {
  const ok = await copier(ebp.ficheASaisir(e, f));
  message(ok ? 'Fiche copiée : collez-la dans EBP' : 'Copie impossible',
    { ton: ok ? 'ok' : 'danger' });
}

/** Le numéro vient d'EBP, jamais d'ici : il se recopie à la main, une fois la
 *  facture réellement établie là-bas. */
async function marquerReportee(ecran, f) {
  const numero = await demander({
    titre: f.ebp ? 'Numéro EBP' : 'Facture saisie dans EBP',
    etiquette: 'Numéro donné par EBP à la facture ' + (f.numero || ''),
    valeur: f.numeroEbp || '',
    exemple: 'FA00123',
    aide: 'Laissez vide pour marquer seulement la facture comme reportée.',
    ok: f.ebp ? 'Enregistrer' : 'Marquer reportée'
  });
  if (numero === null) return;

  act.reporterDansEbp('facture', f.id, String(numero).trim());
  message('Facture marquée reportée dans EBP', { ton: 'ok' });
  ecran.refaireTout();
}

/* ==========================================================================
   LE FIL — l'histoire de la facture
   ========================================================================== */

function panneauHistoire(e, f) {
  const t = totauxDe(e, f);
  const evenements = [
    { quand: f.cree, icone: 'facture', texte: 'Facture préparée' + (f.numero ? ' — ' + f.numero : '') }
  ];

  if (f.emiseLe) {
    evenements.push({
      quand: f.emiseLe, icone: 'partage',
      texte: 'Émise pour ' + fmt.euros(t.ttc) + ' TTC'
        + (f.echeanceLe ? ', à payer avant le ' + fmt.date(f.echeanceLe, 'normal') : '')
    });
  }
  if (f.ebp) {
    evenements.push({
      quand: f.ebp, icone: 'presse',
      texte: 'Reportée dans EBP' + (f.numeroEbp ? ' sous le n° ' + f.numeroEbp : '')
    });
  }

  const regles = (f.reglements || []).slice().sort((a, b) => (a.quand || 0) - (b.quand || 0));
  for (const r of regles) {
    const u = r.qui ? lit.utilisateur(e, r.qui) : null;
    evenements.push({
      quand: r.quand, icone: 'euro',
      texte: fmt.euros(r.montant) + ' — ' + (MODES_REGLEMENT[r.mode] || r.mode || 'autre'),
      qui: u ? lit.nomUtilisateur(u) : null
    });
  }

  /* « Soldée » n'est pas un geste : c'est la conséquence du dernier règlement.
     On la pose donc à sa date, pas à celle d'aujourd'hui. */
  if (f.statut === 'reglee' && regles.length) {
    evenements.push({
      quand: regles[regles.length - 1].quand, icone: 'cocheRonde',
      texte: 'Facture soldée'
    });
  }

  evenements.sort((a, b) => (a.quand || 0) - (b.quand || 0));

  return h('div.panneau', [
    h('div.panneau__tete', [icone('horloge', { taille: 16 }), h('h2.grandit', 'Le fil')]),
    h('div.panneau__corps', fil(evenements))
  ]);
}

/* ==========================================================================
   LES GESTES LOURDS
   ========================================================================== */

/** Émettre, c'est figer. On le dit avant, pas après. */
async function emettre(ecran, f) {
  const e = ecran.etat;
  const verif = verifierDocument(f, lit.prixDe(e, f.clientId));

  if (verif.bloquant) {
    const bloquant = verif.soucis.find(s => s.gravite === 'bloquant');
    messageErreur(bloquant ? bloquant.texte : 'Cette facture n’est pas prête à être émise.');
    return;
  }

  const ok = await confirmer({
    titre: 'Émettre la facture ' + (f.numero || '') + ' ?',
    texte: 'Elle passera à ' + fmt.euros(verif.total.ttc) + ' TTC et ses lignes seront '
      + 'figées. Une facture émise ne se corrige plus : cela se fait par un avoir dans EBP.',
    detail: verif.soucis.length ? 'À vérifier : ' + verif.soucis.map(s => s.texte).join(' ') : null,
    ok: 'Émettre'
  });
  if (!ok) return;

  act.emettreFacture(f.id);
  message('Facture ' + (f.numero || '') + ' émise', { ton: 'ok' });
  ecran.refaireTout();
}

/**
 * Supprimer une facture émise, c'est faire disparaître un papier qui existe
 * chez le client et peut-être déjà dans EBP. On ne l'interdit pas — le
 * garagiste sait ce qu'il fait de ses factures d'essai — mais on prévient de
 * ce qui ne se rattrape pas.
 */
async function supprimer(ecran, f) {
  const e = ecran.etat;
  const t = totauxDe(e, f);
  const encaisse = t.regle > 0.005;

  const ok = await confirmer({
    titre: 'Supprimer la facture ' + (f.numero || '') + ' ?',
    texte: f.statut === 'attente'
      ? 'Elle n’a jamais été émise : le dossier redeviendra « à facturer ».'
      : 'Cette facture a été émise le ' + fmt.date(f.emiseLe || f.cree, 'normal') + '.',
    detail: 'Son numéro ne sera pas réattribué : le suivant prendra le suivant.',
    avertissement: [
      f.ebp ? 'Elle est déjà reportée dans EBP : la supprimer ici ne la supprime pas là-bas.' : '',
      encaisse ? fmt.euros(t.regle) + ' de règlements seront perdus avec elle.' : ''
    ].filter(Boolean).join(' ') || null,
    danger: true,
    ok: 'Supprimer'
  });
  if (!ok) return;

  const dossierId = f.dossierId;
  maj('Facture supprimée', (etat) => {
    const i = (etat.factures || []).findIndex(x => x.id === f.id);
    if (i >= 0) etat.factures.splice(i, 1);
    /* Sans ça le dossier garde un lien mort et ne ressort jamais dans
       « à facturer » : on ne pourrait plus jamais le facturer. */
    const d = lit.dossier(etat, dossierId);
    if (d && d.factureId === f.id) d.factureId = null;
  });

  message('Facture supprimée');
  ecran.ctx.aller(dossierId ? '/dossier/' + dossierId : '/factures');
}
