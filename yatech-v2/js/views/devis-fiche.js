/* ==========================================================================
   YATECH — la fiche d'un devis
   --------------------------------------------------------------------------
   Une règle tient tout l'écran : un devis en brouillon se travaille, un devis
   parti au client est FIGÉ. Ni les lignes, ni les prix, ni le mot au client ne
   bougent plus. C'est ce qui permet, six mois après, de remontrer au client
   exactement le papier qu'il a reçu — et de ne pas se retrouver à défendre un
   chiffre que l'outil a réécrit entre-temps.

   Changer un devis envoyé n'existe donc pas : on en fait une NOUVELLE VERSION,
   qui reprend le dossier et repart à zéro en brouillon. L'ancienne reste, avec
   son numéro, son statut et sa date.

   Comme dans la fiche dossier, rien ne s'enregistre par un bouton : chaque
   champ s'écrit quand on le quitte, et l'on repeint la plus petite zone
   possible pour ne pas faire sauter le curseur en pleine saisie.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, demander, menu, message, messageErreur, vide } from '../core/ui.js';
import { maj } from '../core/store.js';
import { copier } from '../core/fichiers.js';
import * as fmt from '../core/fmt.js';
import { nombre, plaqueJolie } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import * as ebp from '../domain/ebp.js';
import { totaux, figerLignes, verifierDocument } from '../domain/calculs.js';
import { STATUTS_DEVIS } from '../domain/schema.js';
import { editeurLignes } from '../ui/lignes.js';
import {
  champ, pastilleDevis, plaque, lienTel, lienMail, menuEnvoi, fil
} from '../ui/widgets.js';
import { imprimer, documentImprimable } from './impression.js';

export function peindre(ctx) {
  const e = ctx.etat;
  const identifiant = ctx.params.id;

  if (!lit.devis(e, identifiant)) {
    return vide({
      icone: 'question',
      titre: 'Devis introuvable',
      texte: 'Ce devis a été supprimé, ou le lien ne pointe plus sur rien.',
      action: { texte: 'Voir tous les devis', faire: () => ctx.aller('/devis') }
    });
  }

  const zoneTete = h('div.pile');
  const zoneLignes = h('div');
  const zoneCote = h('div.pile');

  const racine = h('div.pile', [
    zoneTete,
    h('div.deux-colonnes', [zoneLignes, zoneCote])
  ]);

  /* Toutes les zones relisent le devis dans l'état plutôt que de garder l'objet
     capturé à la peinture : après un geste (envoi, accord, refus), c'est la
     version fraîche qu'il faut dessiner. */
  const ecran = {
    etat: e,
    ctx,
    devis: () => lit.devis(e, identifiant),
    refaireTete() {
      const dv = ecran.devis();
      if (dv) poser(zoneTete, [ficheTete(ecran, dv), bandeauFige(ecran, dv)]);
    },
    refaireLignes() {
      const dv = ecran.devis();
      if (dv) poser(zoneLignes, panneauLignes(ecran, dv));
    },
    refaireCote() {
      const dv = ecran.devis();
      if (!dv) return;
      poser(zoneCote, [
        panneauDetails(ecran, dv),
        panneauSignature(dv),
        panneauVersions(ecran, dv),
        panneauEbp(ecran, dv),
        panneauHistoire(dv)
      ]);
    },
    refaireTout() { ecran.refaireTete(); ecran.refaireLignes(); ecran.refaireCote(); }
  };

  ecran.refaireTout();
  return racine;
}

/* ==========================================================================
   L'EN-TÊTE — qui, quoi, pour quand, et le geste du moment
   ========================================================================== */

function ficheTete(ecran, dv) {
  const e = ecran.etat;
  const c = lit.client(e, dv.clientId);
  const v = lit.vehicule(e, dv.vehiculeId);
  const d = dv.dossierId ? lit.dossier(e, dv.dossierId) : null;
  const perime = !!(dv.valableJusquau && dv.valableJusquau < Date.now());

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      h('div.rang-s.enroule', [
        pastilleDevis(dv.statut),
        h('span.etiq', 'version ' + (dv.version || 1)),
        dv.ebp ? h('span.etiq', 'saisi dans EBP') : null
      ]),
      h('h1.num', dv.numero || 'Devis'),
      dv.objet ? h('div.faible.coupe-2', dv.objet) : null,
      h('div.fiche-tete__lignes', [
        c ? h('a.rang-s', { href: '#/client/' + c.id }, [
          icone('clients', { taille: 14 }), h('span.coupe', lit.nomClient(c))
        ]) : null,
        v ? h('a.rang-s', { href: '#/vehicule/' + v.id }, [
          plaque(v.immat), h('span.coupe', lit.nomVehicule(v))
        ]) : null,
        h('span.rang-s', [
          icone('horloge', { taille: 14 }),
          h('span', 'émis le ' + fmt.date(dv.emisLe || dv.cree, 'normal'))
        ]),
        h('span.rang-s', { classe: perime ? 'tres-faible' : '' }, [
          icone('sablier', { taille: 14 }),
          h('span', dv.valableJusquau
            ? (perime ? 'périmé depuis le ' : 'valable jusqu’au ') + fmt.date(dv.valableJusquau, 'normal')
            : 'sans date de validité')
        ]),
        d ? h('a.rang-s', { href: '#/dossier/' + d.id }, [
          icone('dossier', { taille: 14 }),
          h('span.coupe', 'dossier ' + (d.numero || lit.titreDossier(e, d)))
        ]) : null,
        c ? lienTel(c.tel) : null,
        c ? lienMail(c.email) : null
      ])
    ]),
    h('div.fiche-tete__actions', actionsDuStatut(ecran, dv))
  ]);
}

/**
 * Les boutons dépendent du statut, parce qu'à chaque statut il n'y a qu'un
 * petit nombre de gestes qui aient un sens — et un seul qui soit évident.
 */
function actionsDuStatut(ecran, dv) {
  const e = ecran.etat;
  const d = dv.dossierId ? lit.dossier(e, dv.dossierId) : null;
  const liste = [];

  const btImprimer = h('button.bt.bt--contour', {
    type: 'button', onclick: () => imprimer(e, dv, 'devis')
  }, [icone('imprimer'), h('span', 'Imprimer / PDF')]);

  const btApercu = h('button.bt.bt--nu', {
    type: 'button', onclick: () => ouvrirApercu(e, dv)
  }, [icone('oeil'), h('span', 'Aperçu')]);

  const btNouvelleVersion = (fort) => h('button.bt' + (fort ? '.bt--fort' : '.bt--contour'), {
    type: 'button', onclick: () => nouvelleVersion(ecran, dv, false)
  }, [icone('plus'), h('span', 'Nouvelle version')]);

  const btDossier = d ? h('a.bt.bt--contour', { href: '#/dossier/' + d.id },
    [icone('dossier'), h('span', 'Voir le dossier')]) : null;

  switch (dv.statut) {
    case 'brouillon':
      liste.push(h('button.bt.bt--fort', {
        type: 'button', onclick: (ev) => envoyerAuClient(ecran, dv, ev.currentTarget)
      }, [icone('partage'), h('span', 'Envoyer au client')]));
      liste.push(btImprimer, btApercu);
      liste.push(h('button.bt.bt--contour.bt--icone', {
        type: 'button', 'aria-label': 'Autres actions',
        onclick: (ev) => menuBrouillon(ecran, dv, ev.currentTarget)
      }, icone('points')));
      break;

    case 'envoye':
      liste.push(h('button.bt.bt--fort', {
        type: 'button', onclick: () => modaleAccord(ecran, dv)
      }, [icone('coche'), h('span', 'Accepté par le client')]));
      liste.push(h('button.bt.bt--contour', {
        type: 'button', onclick: () => modaleRefus(ecran, dv)
      }, [icone('croix'), h('span', 'Refusé')]));
      liste.push(h('button.bt.bt--contour', {
        type: 'button', onclick: (ev) => relancer(ecran, dv, ev.currentTarget)
      }, [icone('cloche'), h('span', 'Relancer')]));
      liste.push(btImprimer, btApercu, btNouvelleVersion(false));
      break;

    case 'accepte':
      if (d && !d.factureId) {
        liste.push(h('button.bt.bt--fort', {
          type: 'button', onclick: () => preparerFacture(ecran, d)
        }, [icone('facture'), h('span', 'Préparer la facture')]));
      } else if (d && d.factureId) {
        liste.push(h('a.bt.bt--contour', { href: '#/facture/' + d.factureId },
          [icone('facture'), h('span', 'Voir la facture')]));
      }
      liste.push(btImprimer, btApercu);
      if (btDossier) liste.push(btDossier);
      break;

    default:
      /* Refusé ou périmé : il n'y a plus rien à en tirer, sinon repartir. */
      liste.push(btNouvelleVersion(true), btImprimer, btApercu);
      if (btDossier) liste.push(btDossier);
  }

  return liste;
}

/* ==========================================================================
   LE BANDEAU « CE DEVIS EST FIGÉ »
   Il ne suffit pas de griser les champs : il faut dire pourquoi, sinon on
   croit à une panne et on cherche le bouton modifier pendant dix minutes.
   ========================================================================== */

function bandeauFige(ecran, dv) {
  if (dv.statut === 'brouillon') return null;

  const s = STATUTS_DEVIS[dv.statut] || {};
  const ton = dv.statut === 'accepte' ? 'ok' : (dv.statut === 'refuse' ? 'danger' : 'alerte');
  const le = (t) => (t ? ' le ' + fmt.date(t, 'normal') : '');
  const pourquoi = {
    envoye: 'Il est parti au client' + le(dv.envoyeLe) + ', on attend sa réponse.',
    accepte: 'Le client l’a accepté' + le(dv.repondeLe) + ' : c’est ce document qui fait foi.',
    refuse: 'Le client l’a refusé' + le(dv.repondeLe) + '.',
    expire: 'Il a passé sa date de validité' + le(dv.valableJusquau) + ' sans réponse.'
  }[dv.statut] || '';

  return h('div.bandeau.bandeau--' + ton, [
    icone('cadenas'),
    h('div.grandit', [
      h('b', 'Devis figé — ' + (s.nom || dv.statut)),
      h('div', pourquoi + ' On ne le modifie plus : c’est la pièce qu’on doit pouvoir '
        + 'remontrer telle quelle. Pour changer un prix ou une ligne, faites une nouvelle version.')
    ]),
    dv.dossierId ? h('button.bt.bt--contour.bt--s', {
      type: 'button', onclick: () => nouvelleVersion(ecran, dv, false)
    }, [icone('plus'), h('span', 'Nouvelle version')]) : null
  ]);
}

/* ==========================================================================
   LES LIGNES
   ========================================================================== */

function panneauLignes(ecran, dv) {
  const e = ecran.etat;
  const brouillon = dv.statut === 'brouillon';

  const editeur = editeurLignes({
    etat: e,
    lignes: dv.lignes,
    ctx: lit.prixDe(e, dv.clientId),
    remise: dv.remiseGlobale,
    acompte: dv.acompte,
    lecture: !brouillon,
    /* L'éditeur prévient à chaque frappe. On enregistre sans journaliser :
       sinon taper une désignation écrit trente lignes dans l'historique et
       remplit la pile d'annulation de demi-mots. */
    surChangement: (lignes, remise) => {
      maj(null, (etat) => {
        const x = lit.devis(etat, dv.id);
        if (!x) return;
        x.lignes = lignes;
        x.remiseGlobale = remise;
        x.maj = Date.now();
      }, { journal: false });
    }
  });

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('devis', { taille: 16 }),
      h('h2.grandit', brouillon ? 'Le chiffrage' : 'Ce que le client a reçu'),
      brouillon ? null : h('span.rang-s.petit.faible', [
        icone('cadenas', { taille: 14 }), h('span', 'lecture seule')
      ])
    ]),
    h('div.panneau__corps', editeur.noeud)
  ]);
}

/* ==========================================================================
   LE DEVIS LUI-MÊME — objet, mot au client, validité, acompte
   ========================================================================== */

function panneauDetails(ecran, dv) {
  const brouillon = dv.statut === 'brouillon';
  return h('div.panneau', [
    h('div.panneau__tete', [icone('document', { taille: 16 }), h('h2.grandit', 'Le devis')]),
    h('div.panneau__corps', brouillon ? champsModifiables(ecran, dv) : detailsFiges(dv))
  ]);
}

function champsModifiables(ecran, dv) {
  const enregistrer = (champs) => maj('Devis modifié', (etat) => {
    const x = lit.devis(etat, dv.id);
    if (!x) return null;
    Object.assign(x, champs);
    x.maj = Date.now();
    return x;
  }, { cible: { type: 'devis', id: dv.id } });

  const objet = champ({
    etiquette: 'Objet', valeur: dv.objet, exemple: 'Distribution + pompe à eau',
    aide: 'La ligne qui dit de quoi il s’agit ; elle s’imprime en tête du document.',
    surChangement: (v) => { enregistrer({ objet: v }); ecran.refaireTete(); }
  });

  const mot = champ({
    etiquette: 'Mot pour le client', type: 'zone', lignes: 4, valeur: dv.motDuJour,
    exemple: 'Le prix des pièces est donné sous réserve de disponibilité…',
    surChangement: (v) => enregistrer({ motDuJour: v })
  });

  const validite = champ({
    etiquette: 'Valable jusqu’au', type: 'date', valeur: dv.valableJusquau,
    aide: 'Passée cette date sans réponse, le devis se marque périmé tout seul.',
    surChangement: (v) => { enregistrer({ valableJusquau: v }); ecran.refaireTete(); }
  });

  /* L'acompte change les totaux, qui vivent dans l'éditeur de lignes : on
     refait cette zone-là, jamais celle du champ qu'on vient de quitter. */
  const acompte = champ({
    etiquette: 'Acompte demandé', type: 'euros', unite: '€',
    valeur: dv.acompte ? dv.acompte : '',
    aide: 'Il se déduit du total sur le document.',
    surChangement: (v) => { enregistrer({ acompte: nombre(v, 0) }); ecran.refaireLignes(); }
  });

  return h('div.pile', [objet.noeud, mot.noeud, validite.noeud, acompte.noeud]);
}

function detailsFiges(dv) {
  /* Le domaine range le motif de refus dans le même champ que le mot au
     client (`motDuJour`) : on l'affiche donc sous son vrai nom du moment. */
  const titreDuMot = dv.statut === 'refuse' ? 'Motif du refus' : 'Mot pour le client';
  return h('dl.paires', [
    paire('Objet', dv.objet || '—'),
    paire(titreDuMot, dv.motDuJour || '—'),
    paire('Valable jusqu’au', dv.valableJusquau ? fmt.date(dv.valableJusquau, 'normal') : 'sans limite'),
    paire('Envoyé le', dv.envoyeLe ? fmt.date(dv.envoyeLe, 'normal') : 'jamais'),
    dv.repondeLe ? paire('Réponse du client', fmt.date(dv.repondeLe, 'normal')) : null,
    nombre(dv.acompte) > 0 ? paire('Acompte demandé', fmt.euros(dv.acompte)) : null
  ]);
}

function paire(nom, valeur) {
  return h('div.paire', [
    h('dt', nom),
    /* Le mot au client tient sur plusieurs lignes : on garde ses retours. */
    h('dd', { style: { whiteSpace: 'pre-line' } }, valeur)
  ]);
}

/* ==========================================================================
   LA SIGNATURE
   ========================================================================== */

function panneauSignature(dv) {
  if (!dv.signature || !dv.signature.nom) return null;
  return h('div.panneau', [
    h('div.panneau__tete', [icone('signature', { taille: 16 }), h('h2.grandit', 'Bon pour accord')]),
    h('div.panneau__corps.pile-s', [
      h('div.gras', dv.signature.nom),
      h('div.petit.faible', 'le ' + fmt.date(dv.signature.quand, 'lettre')
        + ' · ' + fmt.quand(dv.signature.quand))
    ])
  ]);
}

/* ==========================================================================
   LES AUTRES VERSIONS
   Un devis renégocié trois fois, ce sont trois papiers différents chez le
   client. Pouvoir sauter de l'un à l'autre évite de discuter dans le vide.
   ========================================================================== */

function panneauVersions(ecran, dv) {
  const e = ecran.etat;
  if (!dv.dossierId) return null;
  const tous = lit.devisDuDossier(e, dv.dossierId)
    .slice()
    .sort((a, b) => (a.version || 0) - (b.version || 0));
  if (tous.length < 2) return null;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('historique', { taille: 16 }),
      h('h2.grandit', 'Versions'),
      h('span.compte', String(tous.length))
    ]),
    h('div.liste', tous.map(x => x.id === dv.id
      ? h('div.liste__ligne.liste__ligne--muette', [
          h('div.grandit.coupe', [
            h('div.gras', 'Version ' + (x.version || 1)),
            h('div.minus.tres-faible', 'celle que vous regardez')
          ]),
          pastilleDevis(x.statut)
        ])
      : h('a.liste__ligne', { href: '#/devis/' + x.id }, [
          h('div.grandit.coupe', [
            h('div', 'Version ' + (x.version || 1)),
            h('div.minus.tres-faible.coupe', x.numero || '')
          ]),
          pastilleDevis(x.statut)
        ]))
    )
  ]);
}

/* ==========================================================================
   EBP — la facturation officielle se fait là-bas
   ========================================================================== */

function panneauEbp(ecran, dv) {
  const e = ecran.etat;
  return h('div.panneau', [
    h('div.panneau__tete', [icone('presse', { taille: 16 }), h('h2.grandit', 'EBP')]),
    h('div.panneau__corps.pile-s', [
      h('div.petit.faible', 'De quoi remplir EBP sans retaper : le résumé à coller, '
        + 'ou un fichier à importer.'),
      dv.ebp ? h('div.rang-s.petit', [
        icone('coche', { taille: 14 }),
        h('span', 'Repris dans EBP le ' + fmt.date(dv.ebp, 'normal')
          + (dv.numeroEbp ? ' sous le n° ' + dv.numeroEbp : ''))
      ]) : null,
      h('div.rang.enroule', [
        h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: async () => {
            const ok = await copier(ebp.ficheASaisir(e, dv));
            message(ok ? 'Fiche copiée : collez-la dans EBP' : 'Copie impossible',
              { ton: ok ? 'ok' : 'danger' });
          }
        }, [icone('copier'), h('span', 'Copier pour EBP')]),
        h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: () => {
            ebp.telechargerDevis(e, [dv]);
            message('Fichier CSV prêt pour l’import EBP', { ton: 'ok' });
          }
        }, [icone('telecharger'), h('span', 'Exporter en CSV EBP')])
      ])
    ])
  ]);
}

/* ==========================================================================
   L'HISTOIRE DU DEVIS
   ========================================================================== */

function panneauHistoire(dv) {
  const evenements = [{
    quand: dv.cree,
    icone: 'devis',
    texte: 'Devis établi' + ((dv.version || 1) > 1 ? ' en version ' + dv.version : '')
  }];

  if (dv.envoyeLe) evenements.push({ quand: dv.envoyeLe, icone: 'partage', texte: 'Envoyé au client' });
  if (dv.statut === 'expire' && dv.valableJusquau) {
    evenements.push({ quand: dv.valableJusquau, icone: 'sablier', texte: 'Périmé, sans réponse du client' });
  }
  if (dv.repondeLe) {
    evenements.push({
      quand: dv.repondeLe,
      icone: dv.statut === 'accepte' ? 'coche' : 'croix',
      texte: dv.statut === 'accepte'
        ? 'Accepté' + (dv.signature && dv.signature.nom ? ' par ' + dv.signature.nom : '')
        : 'Refusé' + (dv.motDuJour ? ' — ' + dv.motDuJour : '')
    });
  }
  if (dv.ebp) evenements.push({ quand: dv.ebp, icone: 'presse', texte: 'Repris dans EBP' });

  evenements.sort((a, b) => (a.quand || 0) - (b.quand || 0));

  return h('div.panneau', [
    h('div.panneau__tete', [icone('horloge', { taille: 16 }), h('h2.grandit', 'Le fil')]),
    h('div.panneau__corps', fil(evenements))
  ]);
}

/* ==========================================================================
   L'APERÇU DU DOCUMENT
   ========================================================================== */

function ouvrirApercu(e, dv) {
  modale({
    titre: 'Aperçu du devis ' + (dv.numero || ''),
    taille: 'immense',
    corps: h('div.pile', [
      h('div.bandeau', [
        icone('info'),
        h('span', 'Aperçu approximatif : il montre le contenu et l’ordre, pas la mise en '
          + 'page exacte. La vraie feuille A4 sort par « Imprimer / PDF ».')
      ]),
      /* Le document est dessiné pour le papier : à l'écran il n'a aucun style.
         On force le thème clair sur ce bloc — le papier reste blanc même quand
         l'outil est en sombre — et on lui donne de quoi se relire. */
      h('div.devis-apercu', { donnees: { theme: 'clair' } }, documentImprimable(e, dv, 'devis'))
    ]),
    actions: [
      { texte: 'Fermer', ton: 'contour' },
      {
        texte: 'Imprimer / PDF', ton: 'fort',
        faire: () => { imprimer(e, dv, 'devis'); return false; }
      }
    ]
  });
}

/* ==========================================================================
   LES GESTES
   ========================================================================== */

/** Envoyer, c'est figer. On le dit avant, pas après. */
async function envoyerAuClient(ecran, dv, ancre) {
  const e = ecran.etat;
  const verif = verifierDocument(dv, lit.prixDe(e, dv.clientId));

  if (verif.bloquant) {
    const bloquant = verif.soucis.find(s => s.gravite === 'bloquant');
    messageErreur(bloquant ? bloquant.texte : 'Ce devis n’est pas prêt à partir.');
    return;
  }

  const ok = await confirmer({
    titre: 'Envoyer le devis ' + (dv.numero || '') + ' ?',
    texte: 'Une fois parti, il est figé : pour changer un prix ou une ligne, '
      + 'il faudra en faire une nouvelle version.',
    detail: verif.soucis.length ? 'À vérifier : ' + verif.soucis.map(s => s.texte).join(' ') : null,
    ok: 'Envoyer au client'
  });
  if (!ok) return;

  act.envoyerDevis(dv.id);
  message('Devis ' + (dv.numero || '') + ' envoyé, et figé', { ton: 'ok' });

  /* Le menu se place d'après le bouton : on l'ouvre AVANT de repeindre, sinon
     l'ancre a déjà quitté la page et le menu atterrit dans un coin de l'écran. */
  ouvrirEnvoi(ecran, dv, ancre, 'messageDevis', 'Votre devis ' + (dv.numero || ''));
  ecran.refaireTout();
}

function relancer(ecran, dv, ancre) {
  ouvrirEnvoi(ecran, dv, ancre, 'messageRelance', 'Votre devis ' + (dv.numero || ''));
}

/** Ouvre WhatsApp, les SMS ou le courriel avec le message du garage déjà écrit. */
function ouvrirEnvoi(ecran, dv, ancre, cleModele, sujet) {
  const e = ecran.etat;
  const c = lit.client(e, dv.clientId);
  menuEnvoi(ancre, {
    tel: c && c.tel,
    email: c && c.email,
    sujet,
    texte: messagePourClient(e, dv, cleModele)
  });
}

/** Les modèles de messages vivent dans les réglages, avec leurs {trous}. */
function messagePourClient(e, dv, cleModele) {
  const c = lit.client(e, dv.clientId);
  const v = lit.vehicule(e, dv.vehiculeId);
  const t = totaux(dv, lit.prixDe(e, dv.clientId));
  return String(e.reglages[cleModele] || '')
    .replace('{prenom}', (c && c.prenom) || lit.nomClient(c))
    .replace('{numero}', dv.numero || '')
    .replace('{vehicule}', v ? lit.nomVehicule(v) : 'votre véhicule')
    .replace('{immat}', v ? plaqueJolie(v.immat) : '')
    .replace('{montant}', fmt.euros(t.ttc))
    .replace('{garage}', e.reglages.raisonSociale || e.reglages.nomOutil || '');
}

/** L'accord du client : qui a dit oui, et quand. C'est ce qui autorise les
 *  travaux, donc ça se note nommément. */
function modaleAccord(ecran, dv) {
  const e = ecran.etat;
  const c = lit.client(e, dv.clientId);

  const nom = champ({
    etiquette: 'Nom du signataire', valeur: c ? lit.nomClient(c) : '',
    exemple: 'Qui a donné son accord', autofocus: true
  });
  const quand = champ({
    etiquette: 'Date de l’accord', type: 'date', valeur: Date.now(),
    aide: 'Un accord donné hier au téléphone se date d’hier.'
  });

  modale({
    titre: 'Accord du client',
    corps: h('div.pile', [
      h('div.bandeau.bandeau--ok', [
        icone('info'),
        h('span', 'Les lignes acceptées redeviennent celles du dossier, et les travaux '
          + 'peuvent commencer.')
      ]),
      nom.noeud,
      quand.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer l’accord', ton: 'fort',
        faire: () => {
          if (!nom.lire()) { nom.erreur('Qui a donné son accord ?'); return false; }
          act.accepterDevis(dv.id, { nom: nom.lire(), quand: quand.lire() || Date.now() });
          message('Devis accepté : le dossier passe en atelier', { ton: 'ok' });
          ecran.refaireTout();
        }
      }
    ]
  });
}

async function modaleRefus(ecran, dv) {
  const motif = await demander({
    titre: 'Devis refusé',
    etiquette: 'Motif (facultatif)',
    lignes: 3,
    exemple: 'Trop cher, il fait faire ailleurs, véhicule revendu…',
    aide: 'Le motif reste sur le devis : c’est ce qu’on relit avant de le rechiffrer.',
    ok: 'Enregistrer le refus'
  });
  if (motif === null) return;

  act.refuserDevis(dv.id, motif);
  message('Devis noté refusé');
  ecran.refaireTout();
}

/**
 * Une nouvelle version repart du dossier — c'est là que vit la vérité des
 * travaux. Depuis un brouillon, on préfère recopier le brouillon lui-même :
 * on est en train de le travailler, ce serait perdre son chiffrage.
 */
function nouvelleVersion(ecran, dv, depuisCeDevis) {
  const e = ecran.etat;
  const d = dv.dossierId ? lit.dossier(e, dv.dossierId) : null;
  if (!d) {
    messageErreur('Le dossier d’origine n’existe plus : impossible d’en tirer une nouvelle version.');
    return;
  }

  const champs = depuisCeDevis ? {
    lignes: figerLignes(dv.lignes),
    remiseGlobale: dv.remiseGlobale,
    objet: dv.objet,
    motDuJour: dv.motDuJour,
    acompte: dv.acompte
  } : {};

  const suivant = act.creerDevis(d.id, champs);
  if (!suivant) { messageErreur('Le devis n’a pas pu être créé.'); return; }
  message('Devis ' + suivant.numero + ' créé en version ' + suivant.version, { ton: 'ok' });
  ecran.ctx.aller('/devis/' + suivant.id);
}

function preparerFacture(ecran, d) {
  const f = act.creerFacture(d.id);
  if (!f) { messageErreur('La facture n’a pas pu être préparée.'); return; }
  message('Facture ' + f.numero + ' préparée', { ton: 'ok' });
  ecran.ctx.aller('/facture/' + f.id);
}

function menuBrouillon(ecran, dv, ancre) {
  const items = [
    { titre: dv.numero || 'Devis' },
    {
      texte: 'Dupliquer en nouvelle version', icone: 'copier',
      faire: () => nouvelleVersion(ecran, dv, true)
    }
  ];
  if (dv.dossierId) {
    items.push({
      texte: 'Voir le dossier', icone: 'dossier',
      faire: () => ecran.ctx.aller('/dossier/' + dv.dossierId)
    });
  }
  items.push(null);
  items.push({
    texte: 'Supprimer ce brouillon', icone: 'poubelle', danger: true,
    faire: () => supprimerBrouillon(ecran, dv)
  });
  menu(ancre, items);
}

/** On ne supprime qu'un brouillon : un devis parti au client a une existence
 *  hors de l'outil, et le faire disparaître d'un clic serait un mensonge. */
async function supprimerBrouillon(ecran, dv) {
  if (dv.statut !== 'brouillon') return;

  const ok = await confirmer({
    titre: 'Supprimer ce brouillon ?',
    texte: (dv.numero || 'Ce devis') + ' n’a jamais été montré au client.',
    detail: 'Son numéro ne sera pas réattribué : le suivant prendra le suivant.',
    danger: true,
    ok: 'Supprimer'
  });
  if (!ok) return;

  const dossierId = dv.dossierId;
  maj('Devis supprimé', (etat) => {
    const i = (etat.devis || []).findIndex(x => x.id === dv.id);
    if (i >= 0) etat.devis.splice(i, 1);
    const d = lit.dossier(etat, dossierId);
    if (d && Array.isArray(d.devisIds)) d.devisIds = d.devisIds.filter(x => x !== dv.id);
  });

  message('Brouillon supprimé');
  ecran.ctx.aller(dossierId ? '/dossier/' + dossierId : '/devis');
}
