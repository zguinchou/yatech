/* ==========================================================================
   YATECH — la fiche d'un client
   --------------------------------------------------------------------------
   Tout ce qu'on veut savoir d'une personne avant de décrocher, sur un seul
   écran. L'ordre suit celui de la conversation au comptoir :

     1. qui c'est, et comment on le joint ;
     2. est-ce qu'il nous doit de l'argent — la réponse change le ton ;
     3. quelles voitures il a chez nous, et lesquelles sont au garage ;
     4. le papier : dossiers, devis, factures.

   L'espace professionnel n'apparaît que pour les confrères. C'est le seul
   endroit de l'outil qui fabrique un accès extérieur : le lien porte un jeton,
   l'entrée demande un code court, et ce code n'est montré qu'une fois — on
   n'en garde que l'empreinte, pas le code lui-même.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { confirmer, message, menu, vide } from '../core/ui.js';
import { maj, change } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { id, telNu, telJoli, pluriel, plaqueJolie } from '../core/util.js';
import { copier } from '../core/fichiers.js';
import { codeLisible, verrou } from '../core/crypto.js';
import { lienGrille } from '../domain/grille.js';
import { adresseComplete } from '../core/routeur.js';
import * as lit from '../domain/selecteurs.js';
import { totaux } from '../domain/calculs.js';
import { ETAPES_OUVERTES } from '../domain/schema.js';
import { codeEbp } from '../domain/ebp.js';
import {
  champ, plaque, lienTel, lienMail, menuEnvoi, indic,
  pastilleEtape, pastilleDevis, pastilleFacture
} from '../ui/widgets.js';
import { nouveauDossierModale } from './dossier-nouveau.js';
import { modaleClient } from './clients.js';
import { modaleVehicule } from './vehicules.js';

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  /* Le code du portail vit ici, dans la peinture de l'écran, et nulle part
     ailleurs : ni dans l'état, ni dans la base. Quitter la fiche l'efface pour
     de bon, ce qui est exactement la promesse faite à l'écran. */
  let codeMontre = null;

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    /* On relit la fiche à chaque peinture : après une modification ou l'ajout
       d'un véhicule, l'objet a bougé dans l'état. */
    const c = lit.client(e, ctx.params.id);
    if (!c) return introuvable();

    return [
      ficheTete(e, c, ctx, refaire),
      bandeauArchive(c),
      bandeauImpaye(e, c),
      indicateurs(e, c),
      h('div.deux-colonnes', [
        h('div.pile', [
          blocVehicules(e, c, refaire),
          blocDossiers(e, c)
        ]),
        h('div.pile', [
          blocPro(e, c, codeMontre, {
            montrer: (code) => { codeMontre = code; refaire(); },
            oublier: () => { codeMontre = null; refaire(); },
            refaire
          }),
          blocDevis(e, c),
          blocFactures(e, c),
          blocNotes(e, c)
        ])
      ])
    ];
  }

  poser(racine, contenu());
  return racine;
}

function introuvable() {
  return h('div.pile', [
    vide({
      icone: 'clients',
      titre: 'Cette fiche n’existe plus',
      texte: 'Elle a peut-être été supprimée, ou le lien est ancien.'
    }),
    h('div.centre', h('a.bt.bt--contour', { href: '#/clients' },
      [icone('retour'), h('span', 'Tous les clients')]))
  ]);
}

/* ==========================================================================
   L'EN-TÊTE — qui c'est, et comment on le joint
   ========================================================================== */

function ficheTete(e, c, ctx, refaire) {
  const prix = lit.prixDe(e, c.id);
  const adresse = [c.adresse, [c.cp, c.ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      h('div.rang-s', [
        h('h1', lit.nomClient(c)),
        c.type === 'pro' ? h('span.etiq.etiq--accent', 'PRO') : null
      ]),
      h('div.faible.petit', [
        icone(prix.pro ? 'pro' : 'clients', { taille: 13 }),
        ' ' + (prix.pro ? 'Grille confrère' : 'Grille particulier')
        + ' — ' + fmt.euros(prix.taux, { sansCentimes: true }) + ' HT de l’heure'
        + (prix.remiseClient ? ', remise habituelle ' + fmt.pourcent(prix.remiseClient) : '')
      ]),
      h('div.fiche-tete__lignes', [
        lienTel(c.tel),
        lienTel(c.tel2),
        lienMail(c.email),
        adresse ? h('span.rang-s', [icone('carte', { taille: 14 }), h('span', adresse)]) : null,
        c.siret ? h('span.rang-s', [icone('document', { taille: 14 }), h('span', 'SIRET ' + c.siret)]) : null,
        h('span.rang-s.tres-faible', [
          icone('etiquette', { taille: 14 }),
          h('span', 'EBP ' + codeEbp(e, c))
        ])
      ])
    ]),
    h('div.fiche-tete__actions', [
      h('button.bt.bt--fort', {
        type: 'button',
        onclick: () => nouveauDossierModale(e, (d) => {
          if (d) ctx.aller('/dossier/' + d.id); else refaire();
        }, { clientId: c.id })
      }, [icone('plus'), h('span', 'Nouveau dossier')]),
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: () => modaleClient(e, c, refaire)
      }, [icone('crayon'), h('span', 'Modifier')]),
      h('button.bt.bt--contour.bt--icone', {
        type: 'button',
        'aria-label': 'Autres actions',
        onclick: (ev) => menuFiche(ev.currentTarget, e, c, ctx, refaire)
      }, icone('points'))
    ])
  ]);
}

function menuFiche(ancre, e, c, ctx, refaire) {
  const entrees = [];

  if (c.tel) {
    entrees.push({
      texte: 'Appeler ' + telJoli(c.tel), icone: 'telephone',
      faire: () => { window.location.href = 'tel:' + telNu(c.tel); }
    });
  }
  if (c.tel || c.email) {
    entrees.push({
      texte: 'Envoyer un message', icone: 'partage',
      faire: () => menuEnvoi(ancre, {
        tel: c.tel, email: c.email,
        sujet: nomGarage(e),
        texte: 'Bonjour ' + prenomDe(c) + ',\n\n'
      })
    });
  }

  /* `menu()` prend un `null` pour un trait de séparation : on n'en glisse donc
     pas un à la place d'une entrée absente, sinon deux traits se collent. */
  if (entrees.length) entrees.push(null);

  menu(ancre, entrees.concat([
    {
      texte: c.archive ? 'Sortir de l’archive' : 'Archiver cette fiche', icone: 'archive',
      faire: () => {
        change('clients', c.id, { archive: !c.archive },
          c.archive ? 'Client sorti de l’archive' : 'Client archivé');
        message(c.archive ? 'Fiche réactivée' : 'Fiche archivée', { ton: 'ok' });
        refaire();
      }
    },
    {
      texte: 'Supprimer définitivement', icone: 'poubelle', danger: true,
      faire: () => supprimer(e, c, ctx)
    }
  ]), { titre: lit.nomClient(c) });
}

/** Un client qui porte des dossiers, des devis ou des factures ne se supprime
 *  pas : ces documents perdraient leur destinataire, et une facture doit rester
 *  lisible dix ans — y compris celles déjà reportées dans EBP. */
async function supprimer(e, c, ctx) {
  const dossiers = lit.dossiersDe(e, c.id);
  const factures = lit.facturesDe(e, c.id);
  const devis = devisDe(e, c.id);

  if (dossiers.length || factures.length || devis.length) {
    const attaches = [
      dossiers.length ? pluriel(dossiers.length, 'dossier') : '',
      devis.length ? pluriel(devis.length, 'devis', 'devis') : '',
      factures.length ? pluriel(factures.length, 'facture') : ''
    ].filter(Boolean).join(', ');
    await confirmer({
      titre: 'Suppression impossible',
      texte: 'Cette fiche porte ' + attaches + '. Les effacer laisserait des '
        + 'documents sans destinataire — dont, peut-être, des factures déjà '
        + 'transmises à EBP et des pièces comptables à conserver.',
      detail: 'Archivez-la plutôt : elle disparaît des listes et reste consultable.',
      ok: 'J’ai compris',
      annuler: 'Fermer'
    });
    return;
  }

  const vehicules = lit.vehiculesDe(e, c.id);
  const ok = await confirmer({
    titre: 'Supprimer ' + lit.nomClient(c) + ' ?',
    texte: vehicules.length
      ? 'La fiche partira avec ' + pluriel(vehicules.length, 'véhicule')
        + ' : ' + vehicules.map(v => v.immat).join(', ') + '.'
      : 'La fiche ne porte aucun document : rien d’autre ne sera touché.',
    detail: 'Cette suppression s’annule avec Ctrl+Z tant que l’outil est ouvert.',
    ok: 'Supprimer',
    danger: true
  });
  if (!ok) return;

  /* Fiche et véhicules partent dans le même geste : sans ça, une annulation
     rendrait le client sans ses voitures, ou l'inverse. */
  maj('Client supprimé', (etat) => {
    etat.vehicules = (etat.vehicules || []).filter(v => v.clientId !== c.id);
    etat.clients = (etat.clients || []).filter(x => x.id !== c.id);
  });
  message('Fiche supprimée', { ton: 'ok' });
  ctx.aller('/clients');
}

/* ==========================================================================
   LES BANDEAUX
   ========================================================================== */

function bandeauArchive(c) {
  if (!c.archive) return null;
  return h('div.bandeau', [
    icone('archive'),
    h('span', 'Cette fiche est archivée : elle n’apparaît plus dans l’annuaire '
      + 'ni dans les listes de choix.')
  ]);
}

/** Ce que le client doit. Il passe avant le reste parce qu'il change la façon
 *  dont on prend l'appel : on ne relance pas quelqu'un après lui avoir promis
 *  un rendez-vous. */
function bandeauImpaye(e, c) {
  const du = lit.duPar(e, c.id);
  if (du.total <= 0.005) return null;

  const maintenant = Date.now();
  const enRetard = du.factures.filter(x => x.facture.echeanceLe && x.facture.echeanceLe < maintenant);
  const montantRetard = enRetard.reduce((t, x) => t + x.reste, 0);

  return h('div.bandeau.bandeau--' + (enRetard.length ? 'danger' : 'alerte'), [
    icone('euro'),
    h('div.grandit', [
      h('div.gras', fmt.euros(du.total) + ' à encaisser'),
      h('div.petit', [
        pluriel(du.factures.length, 'facture non soldée', 'factures non soldées'),
        enRetard.length
          ? ' · dont ' + fmt.euros(montantRetard) + ' en retard sur '
            + pluriel(enRetard.length, 'facture', 'factures')
          : ' · aucune échéance dépassée'
      ].join(''))
    ]),
    h('button.bt.bt--contour.bt--s', {
      type: 'button',
      onclick: (ev) => menuEnvoi(ev.currentTarget, {
        tel: c.tel, email: c.email,
        sujet: 'Facture en attente de règlement',
        texte: messageImpaye(e, c, (enRetard[0] || du.factures[0]))
      })
    }, [icone('partage', { taille: 14 }), h('span', 'Relancer')])
  ]);
}

/** Le modèle de relance des réglages, rempli avec la facture la plus urgente. */
function messageImpaye(e, c, entree) {
  const f = entree ? entree.facture : null;
  return String((e.reglages && e.reglages.messageImpaye) || '')
    .replace('{prenom}', prenomDe(c))
    .replace('{numero}', f ? (f.numero || '') : '')
    .replace('{date}', f ? fmt.date(f.emiseLe || f.cree, 'court') : '')
    .replace('{montant}', fmt.euros(entree ? entree.reste : 0))
    .replace('{garage}', nomGarage(e));
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function indicateurs(e, c) {
  const vehicules = lit.vehiculesDe(e, c.id);
  const dossiers = lit.dossiersDe(e, c.id);
  const ouverts = dossiers.filter(d => !d.archive && ETAPES_OUVERTES.includes(d.etape));
  const du = lit.duPar(e, c.id);

  /* « Tout temps » se lit sur les factures, jamais sur les dossiers : un
     dossier non facturé n'est pas du chiffre d'affaires, et une facture reprise
     d'un ancien logiciel n'a pas forcément de dossier derrière. */
  const prix = lit.prixDe(e, c.id);
  const emises = lit.facturesDe(e, c.id).filter(f => f.statut !== 'attente');
  const facture = emises.reduce((t, f) => t + totaux(f, prix).ttc, 0);

  return h('div.grille-indics', [
    indic({
      nom: 'Véhicules', valeur: vehicules.length,
      detail: vehicules.length ? vehicules.slice(0, 2).map(v => v.immat).join(' · ') : 'aucun enregistré'
    }),
    indic({
      nom: 'Dossiers ouverts', valeur: ouverts.length,
      ton: ouverts.length ? 'accent' : null,
      detail: pluriel(dossiers.length, 'dossier en tout', 'dossiers en tout')
    }),
    indic({
      nom: 'Facturé, tout temps', valeur: fmt.euros(facture, { sansCentimes: true }),
      detail: pluriel(emises.length, 'facture', 'factures')
    }),
    indic({
      nom: 'Reste dû', valeur: fmt.euros(du.total, { sansCentimes: true }),
      ton: du.total > 0.005 ? 'danger' : null,
      detail: du.total > 0.005 ? pluriel(du.factures.length, 'facture', 'factures') : 'rien en attente'
    })
  ]);
}

/* ==========================================================================
   SES VÉHICULES
   ========================================================================== */

function blocVehicules(e, c, refaire) {
  const liste = lit.vehiculesDe(e, c.id);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('vehicule', { taille: 16 }),
      h('h2.grandit', 'Ses véhicules'),
      liste.length ? h('span.compte', String(liste.length)) : null,
      h('button.bt.bt--nu.bt--s', {
        type: 'button',
        onclick: () => modaleVehicule(e, null, refaire, c.id)
      }, [icone('plus', { taille: 14 }), h('span', 'Ajouter')])
    ]),
    liste.length
      ? h('div.panneau__corps', h('div.client-vehicules', liste.map(v => {
          const passages = lit.dossiersDuVehicule(e, v.id).length;
          return h('button.carte.pile-s', {
            type: 'button',
            onclick: () => { location.hash = '#/vehicule/' + v.id; }
          }, [
            h('div.rang', [
              plaque(v.immat),
              h('span.pousse'),
              icone('droite', { taille: 14, classe: 'tres-faible' })
            ]),
            h('div', [
              h('div.gras.coupe', lit.nomVehicule(v)),
              v.motorisation ? h('div.petit.faible.coupe', v.motorisation) : null
            ]),
            h('div.minus.tres-faible', [
              v.km
                ? fmt.km(v.km) + (v.kmReleveLe ? ' le ' + fmt.date(v.kmReleveLe, 'court') : '')
                : 'kilométrage inconnu',
              ' · ',
              passages ? pluriel(passages, 'passage') : 'jamais venu'
            ].join(''))
          ]);
        })))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Aucun véhicule rattaché à cette fiche.'))
  ]);
}

/* ==========================================================================
   SES DOSSIERS
   Les ouverts d'abord : ce sont les seuls sur lesquels on peut encore agir.
   ========================================================================== */

function blocDossiers(e, c) {
  const tous = lit.dossiersDe(e, c.id);
  const ouverts = tous.filter(d => !d.archive && ETAPES_OUVERTES.includes(d.etape));
  const termines = tous.filter(d => d.archive || !ETAPES_OUVERTES.includes(d.etape));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('dossier', { taille: 16 }),
      h('h2.grandit', 'Ses dossiers'),
      tous.length ? h('span.compte', String(tous.length)) : null
    ]),
    tous.length ? h('div.liste', [
      ouverts.length ? h('div.liste__ligne.liste__ligne--muette', [
        h('span.petit.faible.majuscule.grandit', 'En cours')
      ]) : null,
      ...ouverts.map(d => ligneDossier(e, d)),
      termines.length ? h('div.liste__ligne.liste__ligne--muette', [
        h('span.petit.faible.majuscule.grandit', 'Terminés')
      ]) : null,
      ...termines.map(d => ligneDossier(e, d))
    ]) : h('div.panneau__corps', h('div.petit.faible.centre',
        'Aucun dossier pour ce client.'))
  ]);
}

function ligneDossier(e, d) {
  const v = lit.vehicule(e, d.vehiculeId);
  const t = lit.totauxDossier(e, d);
  const clos = d.archive || !ETAPES_OUVERTES.includes(d.etape);

  return h('a.liste__ligne', {
    href: '#/dossier/' + d.id,
    style: clos ? { opacity: '.7' } : null
  }, [
    h('div.grandit.coupe', [
      h('div.rang-s', [
        h('span.minus.tres-faible.num', d.numero || '—'),
        h('span.gras.coupe', lit.titreDossier(e, d))
      ]),
      h('div.petit.faible.coupe', [
        v ? plaqueJolie(v.immat) : 'sans véhicule',
        fmt.date(d.entree || d.cree, 'court')
      ].join(' · '))
    ]),
    pastilleEtape(d.etape),
    h('span.gras.num', fmt.euros(t.ttc, { sansCentimes: true }))
  ]);
}

/* ==========================================================================
   SES DEVIS ET SES FACTURES — deux listes compactes
   ========================================================================== */

function blocDevis(e, c) {
  const liste = devisDe(e, c.id);
  const prix = lit.prixDe(e, c.id);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('devis', { taille: 16 }),
      h('h2.grandit', 'Ses devis'),
      liste.length ? h('span.compte', String(liste.length)) : null
    ]),
    liste.length
      ? h('div.liste', liste.map(d => {
          const t = totaux(d, prix);
          return h('a.liste__ligne', { href: '#/devis/' + d.id }, [
            h('div.grandit.coupe', [
              h('div.rang-s', [
                h('span.gras.num.coupe', d.numero || 'brouillon'),
                pastilleDevis(d.statut)
              ]),
              h('div.minus.tres-faible', fmt.date(d.emisLe || d.cree, 'court'))
            ]),
            h('span.gras.num', fmt.euros(t.ttc, { sansCentimes: true }))
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre', 'Aucun devis.'))
  ]);
}

function blocFactures(e, c) {
  const liste = lit.facturesDe(e, c.id);
  const prix = lit.prixDe(e, c.id);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('facture', { taille: 16 }),
      h('h2.grandit', 'Ses factures'),
      liste.length ? h('span.compte', String(liste.length)) : null
    ]),
    liste.length
      ? h('div.liste', liste.map(f => {
          const t = totaux(f, prix);
          return h('a.liste__ligne', { href: '#/facture/' + f.id }, [
            h('div.grandit.coupe', [
              h('div.rang-s', [
                h('span.gras.num.coupe', f.numero || 'à établir'),
                pastilleFacture(f.statut)
              ]),
              h('div.minus.tres-faible', fmt.date(f.emiseLe || f.cree, 'court'))
            ]),
            h('div.droite', [
              h('div.gras.num', fmt.euros(t.ttc, { sansCentimes: true })),
              t.reste > 0.005
                ? h('div.minus.num', { style: { color: 'var(--danger)' } },
                    'reste ' + fmt.euros(t.reste, { sansCentimes: true }))
                : null
            ])
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre', 'Aucune facture.'))
  ]);
}

/* ==========================================================================
   L'ESPACE PROFESSIONNEL
   --------------------------------------------------------------------------
   Un confrère qui sous-traite chez nous doit pouvoir suivre ses véhicules
   sans nous appeler. On lui ouvre une porte étroite : un lien qui porte un
   jeton, et un code court à taper en arrivant.

   Le code n'est rangé nulle part — seule son empreinte l'est (core/crypto.js).
   C'est pour ça qu'il ne s'affiche qu'à sa création : personne, nous compris,
   ne peut le relire ensuite. En perdre un ne casse rien, on en regénère un.
   ========================================================================== */

function blocPro(e, c, codeMontre, gestes) {
  const prix = lit.prixDe(e, c.id);
  /* La grille prime sur le type : un ancien collègue peut travailler au tarif
     confrère sans être une société, et il a les mêmes besoins de suivi. */
  if (c.type !== 'pro' && !prix.pro) return null;

  /* Un portail sans jeton est une fiche à moitié écrite (import d'une ancienne
     base, écriture interrompue) : on le traite comme fermé plutôt que de
     fabriquer un lien qui ne mène nulle part. */
  const p = c.portail && c.portail.jeton ? c.portail : null;

  return h('div.pile', [
    blocGrilleTarifaire(e, c),
    h('div.panneau', [
      h('div.panneau__tete', [
        icone('portail', { taille: 16 }),
        h('h2.grandit', 'Suivi en ligne'),
        p ? h('span.pastille.pastille--ok', 'ouvert') : null
      ]),
      h('div.panneau__corps.pile-s',
        p ? accesOuvert(e, c, p, codeMontre, gestes) : accesFerme(c, gestes))
    ])
  ]);
}

/* ==========================================================================
   LA GRILLE TARIFAIRE QUI VOYAGE
   --------------------------------------------------------------------------
   C'est CE lien-là qu'on envoie à un confrère. Il porte la grille avec lui :
   il s'ouvre sur n'importe quel téléphone, sans réseau et sans compte, parce
   qu'il ne va rien chercher dans l'appareil.
   ========================================================================== */

function blocGrilleTarifaire(e, c) {
  const zone = h('div.pile-s');
  let lien = null;

  const fabriquer = async () => {
    if (lien) return lien;
    lien = await lienGrille(e, c);
    return lien;
  };

  const peindre = () => poser(zone, [
    h('p.petit.faible', 'Le lien contient la grille : il s’ouvre sur le téléphone du '
      + 'confrère, sans réseau et sans code. Il donne une photographie de vos tarifs '
      + 'du jour — après un changement de prix, renvoyez-en un.'),
    h('div.rang.enroule', [
      h('button.bt.bt--fort', {
        type: 'button',
        onclick: async (ev) => {
          const l = await fabriquer();
          const ok = await copier(l);
          message(ok ? 'Lien de la grille copié' : 'Copie impossible',
            { ton: ok ? 'ok' : 'danger' });
        }
      }, [icone('copier'), h('span', 'Copier le lien de la grille')]),
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: async (ev) => {
          const l = await fabriquer();
          menuEnvoi(ev.currentTarget, {
            tel: c.tel, email: c.email,
            sujet: 'Votre grille tarifaire — ' + (e.reglages.raisonSociale || e.reglages.nomOutil || ''),
            texte: (e.reglages.messageGrille
              || 'Bonjour,\n\nVoici votre grille tarifaire :\n{lien}\n\nElle s’ouvre '
                 + 'directement, sans code. Gardez le lien.').replace('{lien}', l)
          });
        }
      }, [icone('partage'), h('span', 'Envoyer')]),
      h('button.bt.bt--nu', {
        type: 'button',
        onclick: async () => { const l = await fabriquer(); window.open(l, '_blank', 'noopener'); }
      }, [icone('oeil'), h('span', 'Voir ce qu’il verra')])
    ])
  ]);

  peindre();

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('tarifs', { taille: 16 }),
      h('h2.grandit', 'Sa grille tarifaire'),
      h('span.pastille.pastille--ok.pastille--sans-point', 'marche partout')
    ]),
    h('div.panneau__corps', zone)
  ]);
}

/* Le suivi en ligne lit les données de l'outil, et ces données vivent dans CE
   navigateur : le lien ne montre donc quelque chose que sur un appareil qui les
   possède — le vôtre, la tablette du comptoir. Tant qu'il n'y a pas de base
   partagée, il faut le dire ici plutôt que laisser le confrère tomber sur une
   page vide. */
function avertissementSuivi() {
  return h('div.bandeau.bandeau--alerte', [
    icone('alerte'),
    h('div', [
      h('b', 'Ce lien-ci ne fonctionne que sur un appareil qui a déjà les données du garage.'),
      h('div', 'Le suivi des véhicules et les demandes de créneau se lisent dans la base '
        + 'locale, et le téléphone du confrère n’en a pas. Utilisez-le sur la tablette de '
        + 'l’atelier ; pour ce qu’il consulte de chez lui, envoyez-lui la grille ci-dessus.')
    ])
  ]);
}

function accesFerme(c, gestes) {
  return [
    avertissementSuivi(),
    h('p.petit.faible', 'Un accès permet à ce confrère de suivre ses véhicules '
      + 'et de demander des créneaux, sans voir le reste du garage.'),
    h('button.bt.bt--contour.bt--plein', {
      type: 'button',
      onclick: () => ouvrirAcces(c, gestes)
    }, [icone('cle'), h('span', 'Ouvrir un accès')])
  ];
}

function accesOuvert(e, c, p, codeMontre, gestes) {
  const lien = adresseComplete('/pro/' + p.jeton);

  return [
    codeMontre ? boiteCode(codeMontre, gestes) : null,
    avertissementSuivi(),

    h('div.champ', [
      h('label', 'Lien à donner au confrère'),
      h('div.carte.carte--muette.num.petit', { style: { wordBreak: 'break-all' } }, lien),
      h('div.rang-s', { style: { marginTop: 'var(--e-2)' } }, [
        h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: async () => {
            const ok = await copier(lien);
            message(ok ? 'Lien copié' : 'Copie impossible', { ton: ok ? 'ok' : 'danger' });
          }
        }, [icone('copier', { taille: 14 }), h('span', 'Copier le lien')]),
        h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: (ev) => menuEnvoi(ev.currentTarget, {
            tel: c.tel, email: c.email,
            sujet: 'Votre accès à notre espace professionnel',
            /* Le lien part, jamais le code : les deux dans le même message et
               un téléphone égaré donne l'accès complet. Le code se dit de vive
               voix. */
            texte: 'Bonjour ' + prenomDe(c) + ',\n\nVoici votre accès à notre espace '
              + 'professionnel :\n' + lien + '\n\nLe code d’entrée vous est '
              + 'communiqué à part.\n\n' + nomGarage(e)
          })
        }, [icone('partage', { taille: 14 }), h('span', 'Envoyer')])
      ])
    ]),

    h('div.minus.tres-faible', [
      'Ouvert ' + fmt.quand(p.ouvertLe, { avecHeure: false }),
      p.dernierAcces
        ? ' · dernière visite ' + fmt.quand(p.dernierAcces)
        : ' · jamais utilisé pour l’instant'
    ].join('')),

    h('div.rang-s.enroule', [
      h('button.bt.bt--contour.bt--s', {
        type: 'button',
        onclick: () => regenererCode(c, gestes)
      }, [icone('rafraichir', { taille: 14 }), h('span', 'Regénérer un code')]),
      h('button.bt.bt--danger.bt--s', {
        type: 'button',
        onclick: () => fermerAcces(c, gestes)
      }, [icone('cadenas', { taille: 14 }), h('span', 'Fermer l’accès')])
    ])
  ];
}

/** La seule et unique fois où le code est lisible. */
function boiteCode(code, gestes) {
  return h('div.bandeau.bandeau--alerte', { role: 'status' }, [
    icone('alerte'),
    h('div.grandit.pile-s', [
      h('b', 'Notez ce code maintenant'),
      h('div.client-code', code),
      h('div.petit', 'Il ne sera plus jamais affiché : l’outil n’en garde que '
        + 'l’empreinte, pas le code. Si vous le perdez, regénérez-en un autre.'),
      h('div', h('button.bt.bt--contour.bt--s', {
        type: 'button', onclick: () => gestes.oublier()
      }, [icone('coche', { taille: 14 }), h('span', 'C’est noté')]))
    ])
  ]);
}

function ouvrirAcces(c, gestes) {
  const code = codeLisible(6);
  change('clients', c.id, {
    portail: {
      jeton: id('jt'),
      verrou: verrou(code),
      ouvertLe: Date.now(),
      dernierAcces: null
    }
  }, 'Accès professionnel ouvert');
  gestes.montrer(code);
}

async function regenererCode(c, gestes) {
  const ok = await confirmer({
    titre: 'Regénérer le code ?',
    texte: 'L’ancien code cessera de fonctionner immédiatement.',
    detail: 'Le lien, lui, ne change pas : inutile de le renvoyer.',
    ok: 'Regénérer'
  });
  if (!ok) return;

  const code = codeLisible(6);
  /* L'empreinte se calcule AVANT d'entrer dans la modification : ses milliers
     de tours de hachage bloqueraient l'écran au milieu d'un geste annulable. */
  const nouveauVerrou = verrou(code);
  /* On garde le jeton : c'est le lien déjà partagé, parfois enregistré dans
     les favoris du confrère. Seul le code change. */
  change('clients', c.id, (x) => ({
    portail: Object.assign({}, x.portail, { verrou: nouveauVerrou })
  }), 'Code professionnel regénéré');
  gestes.montrer(code);
}

async function fermerAcces(c, gestes) {
  const ok = await confirmer({
    titre: 'Fermer l’accès ?',
    texte: 'Le lien ne mènera plus à rien. Les demandes déjà envoyées par ce '
      + 'confrère restent dans le planning.',
    ok: 'Fermer l’accès',
    danger: true
  });
  if (!ok) return;
  change('clients', c.id, { portail: null }, 'Accès professionnel fermé');
  message('Accès fermé', { ton: 'ok' });
  gestes.oublier();
}

/* ==========================================================================
   SES NOTES
   ========================================================================== */

function blocNotes(e, c) {
  /* Enregistrement à la sortie du champ, sans bouton : une note qu'on oublie
     de valider est une note perdue. On ne repeint pas l'écran derrière, sinon
     le curseur saute au milieu d'une phrase. */
  const note = champ({
    type: 'zone', lignes: 5, valeur: c.notes,
    exemple: 'Ce qu’il faut savoir avant de l’appeler : paie toujours en '
      + 'espèces, veut être prévenu avant toute pièce, travaille de nuit…',
    surChangement: (texte) => {
      if (texte === (c.notes || '')) return;
      change('clients', c.id, { notes: texte }, 'Note de client modifiée');
      message('Note enregistrée', { ton: 'ok', duree: 1600 });
    }
  });

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('epingle', { taille: 16 }),
      h('h2.grandit', 'Notes')
    ]),
    h('div.panneau__corps', note.noeud)
  ]);
}

/* ==========================================================================
   PETITES LECTURES
   ========================================================================== */

/** Les devis d'un client. Le schéma porte `clientId` sur le devis, mais un
 *  devis ancien peut n'avoir que son dossier : on remonte alors par lui. */
function devisDe(e, clientId) {
  return (e.devis || [])
    .filter(d => d.clientId === clientId
      || (!d.clientId && d.dossierId && (lit.dossier(e, d.dossierId) || {}).clientId === clientId))
    .sort((a, b) => (b.emisLe || b.cree || 0) - (a.emisLe || a.cree || 0));
}

/** De quoi commencer un message sans écrire « Bonjour Client sans nom ». */
function prenomDe(c) {
  if (!c) return '';
  if (c.type === 'pro') return c.prenom || c.societe || lit.nomClient(c);
  return c.prenom || c.nom || lit.nomClient(c);
}

function nomGarage(e) {
  const r = (e && e.reglages) || {};
  return r.raisonSociale || r.nomOutil || '';
}
