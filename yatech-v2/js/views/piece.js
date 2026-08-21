/* ==========================================================================
   YATECH — la fiche d'une pièce
   --------------------------------------------------------------------------
   Deux questions amènent ici, et une seule à la fois :

     1. « Où est-elle ? » — on est debout devant les rayonnages, le téléphone
        à la main. L'emplacement passe donc avant tout le reste, en gros, avec
        ce qu'il y a d'autre dans le même bac : on va chercher un bac, pas une
        référence.

     2. « Où sont passées les trois que j'avais ? » — c'est l'historique des
        mouvements qui répond, et lui seul. D'où la règle tenue partout dans
        cet écran : la quantité ne se corrige jamais à la main. Elle bouge par
        une entrée, une sortie ou un inventaire, et chaque geste laisse une
        ligne datée. Un stock qu'on rectifie en douce ne vaut rien.

   Le reste — prix, marge, fournisseur — se lit, se corrige, mais ne presse
   pas. Pas de graphique : trois personnes qui connaissent leur stock n'ont
   rien à apprendre d'une courbe.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, menu, vide } from '../core/ui.js';
import { change, retire, ajoute } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { nombre, unique, compareTexte, id as idUnique } from '../core/util.js';
import { choisirFichier, reduireImage } from '../core/fichiers.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { SENS_MOUVEMENT, ETAPES_OUVERTES, nouvellePiece } from '../domain/schema.js';
import { marge, prixConseille } from '../domain/calculs.js';
import { champ, grilleChamps, lienTel } from '../ui/widgets.js';
import { imprimerEtiquettes } from './impression.js';

/* Le schéma laisse `etat` en texte libre avec trois valeurs en commentaire :
   on les nomme ici pour l'affichage et pour la liste de saisie, sans rien
   ajouter au modèle. */
const ETATS_PIECE = {
  neuf: 'Neuve',
  occasion: 'Occasion',
  reconditionne: 'Reconditionnée'
};

/* Les deux sens qu'on pose d'un doigt depuis la fiche. Les deux autres
   (perte, retour) restent accessibles depuis la même modale. */
const SENS_DIRECTS = ['entree', 'sortie'];

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    /* On relit la pièce à chaque peinture : après un mouvement de stock ou une
       photo ajoutée, l'objet a été remplacé dans l'état. */
    const p = lit.piece(e, ctx.params.id);
    if (!p) return introuvable();

    return [
      ficheTete(e, p, ctx, refaire),
      bandeauArchive(p, refaire),
      blocOuLaTrouver(e, p, refaire),
      h('div.deux-colonnes', [
        h('div.pile', [
          blocChiffres(e, p),
          blocCompatible(p),
          blocMouvements(e, p)
        ]),
        h('div.pile', [
          blocPhoto(e, p, refaire),
          blocUtiliseeDans(e, p)
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
      icone: 'boite',
      titre: 'Cette pièce n’existe plus',
      texte: 'La fiche a peut-être été supprimée, ou le lien est ancien.'
    }),
    h('div.centre', h('a.bt.bt--contour', { href: '#/stock' },
      [icone('retour'), h('span', 'Tout le stock')]))
  ]);
}

/* ==========================================================================
   L'EN-TÊTE
   ========================================================================== */

function ficheTete(e, p, ctx, refaire) {
  const em = lit.lireEmplacement(p.emplacement);

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      h('div.rang-s.enroule', [
        pastilleQte(e, p),
        p.ref ? h('span.etiq.num', p.ref) : null,
        h('span.pastille.pastille--sans-point'
          + (p.etat === 'neuf' ? '.pastille--ok' : '.pastille--info'),
          ETATS_PIECE[p.etat] || 'État inconnu')
      ]),
      h('h1', { style: { marginTop: 'var(--e-2)' } }, p.libelle || 'Pièce sans désignation'),
      h('div.fiche-tete__lignes', [
        em.code
          ? h('span.rang-s', [icone('entrepot', { taille: 14 }), h('span.gras', em.code)])
          : h('span.rang-s.tres-faible', [icone('question', { taille: 14 }), h('span', 'Pas rangée')]),
        p.famille ? h('span.rang-s', [icone('etiquette', { taille: 14 }), h('span', p.famille)]) : null,
        p.marque ? h('span.rang-s', [icone('boite', { taille: 14 }), h('span', p.marque)]) : null,
        p.refFabricant
          ? h('span.rang-s', [icone('document', { taille: 14 }), h('span', 'réf. fabricant ' + p.refFabricant)])
          : null
      ])
    ]),
    h('div.fiche-tete__actions', SENS_DIRECTS.map(sens =>
      h('button.bt' + (sens === 'entree' ? '.bt--fort' : '.bt--contour'), {
        type: 'button',
        onclick: () => modaleMouvement(e, p, sens, refaire)
      }, [icone(SENS_MOUVEMENT[sens].icone), h('span', SENS_MOUVEMENT[sens].nom)])
    ).concat([
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: () => modalePiece(e, p, refaire)
      }, [icone('crayon'), h('span', 'Modifier')]),
      h('button.bt.bt--contour.bt--icone', {
        type: 'button',
        'aria-label': 'Autres actions',
        onclick: (ev) => menuFiche(ev.currentTarget, e, p, ctx, refaire)
      }, icone('points'))
    ]))
  ]);
}

/** La pastille d'état de stock : le chiffre, et ce qu'il faut en penser. */
function pastilleQte(e, p) {
  const seuil = lit.seuilBas(e, p);
  const reserve = nombre(lit.reservations(e).get(p.id), 0);
  const classe = p.qte <= 0 ? '.qte--zero' : (p.qte <= seuil ? '.qte--bas' : '');
  return h('span.rang-s', [
    h('span.qte' + classe + (reserve > 0 ? '.qte--reserve' : ''), {
      title: reserve > 0
        ? reserve + ' déjà promise(s) à un dossier en cours'
        : 'Seuil d’alerte : ' + seuil
    }, nombre(p.qte, 0) + ' ' + (p.unite || 'u')),
    reserve > 0 ? h('span.minus.tres-faible', 'dont ' + reserve + ' promise(s)') : null
  ]);
}

function menuFiche(ancre, e, p, ctx, refaire) {
  menu(ancre, [
    {
      texte: 'Dupliquer cette fiche', icone: 'copier',
      faire: () => dupliquer(e, p, ctx)
    },
    {
      texte: 'Imprimer l’étiquette du bac', icone: 'imprimer',
      faire: () => imprimerEtiquetteBac(e, p)
    },
    null,
    {
      texte: p.archive ? 'Sortir de l’archive' : 'Archiver cette pièce', icone: 'archive',
      faire: () => basculerArchive(p, refaire)
    },
    {
      texte: 'Supprimer définitivement', icone: 'poubelle', danger: true,
      faire: () => supprimer(e, p, ctx)
    }
  ], { titre: p.libelle || p.ref || 'Pièce' });
}

/** Une pièce dupliquée repart à zéro : ni quantité, ni historique. Recopier le
 *  stock d'une autre référence, c'est inventer des pièces qui n'existent pas. */
function dupliquer(e, p, ctx) {
  const modele = Object.assign({}, p, {
    ref: p.ref ? p.ref + '-BIS' : '',
    qte: 0,
    photo: p.photo,
    inventorieLe: null
  });
  modalePiece(e, null, (creee) => {
    if (creee) ctx.aller('/stock/' + creee.id);
  }, modele);
}

function imprimerEtiquetteBac(e, p) {
  const code = codeEmplacement(p);
  if (!code) {
    message('Cette pièce n’a pas d’emplacement : rangez-la d’abord.', { ton: 'alerte' });
    return;
  }
  const voisines = voisinesDuBac(e, p);
  imprimerEtiquettes([{
    code,
    libelle: p.libelle || p.ref || '',
    detail: [p.ref, voisines.length
      ? '+ ' + voisines.length + (voisines.length > 1 ? ' autres références' : ' autre référence')
      : null].filter(Boolean).join(' · ')
  }]);
}

function basculerArchive(p, refaire) {
  change('pieces', p.id, { archive: !p.archive },
    p.archive ? 'Pièce sortie de l’archive' : 'Pièce archivée');
  message(p.archive ? 'Pièce réactivée' : 'Pièce archivée', { ton: 'ok' });
  refaire();
}

/** Une pièce qui a bougé ou qui figure sur un dossier ne se supprime pas :
 *  l'effacer trouerait un historique de stock et des lignes déjà chiffrées,
 *  parfois déjà facturées. On propose l'archive, qui la sort des listes. */
async function supprimer(e, p, ctx) {
  const mouvements = lit.mouvementsDePiece(e, p.id);
  const dossiers = dossiersQuiUtilisent(e, p, true);

  if (mouvements.length || dossiers.length) {
    const attaches = [
      mouvements.length
        ? mouvements.length + (mouvements.length > 1 ? ' mouvements' : ' mouvement')
        : '',
      dossiers.length
        ? dossiers.length + (dossiers.length > 1 ? ' dossiers' : ' dossier')
        : ''
    ].filter(Boolean).join(' et ');
    await confirmer({
      titre: 'Suppression impossible',
      texte: 'Cette pièce porte ' + attaches + '. Les effacer laisserait un '
        + 'historique de stock troué et des lignes de dossier sans référence.',
      detail: 'Archivez-la plutôt : elle disparaît des listes et reste consultable.',
      ok: 'J’ai compris',
      annuler: 'Fermer'
    });
    return;
  }

  const oui = await confirmer({
    titre: 'Supprimer cette pièce ?',
    texte: (p.libelle || 'Pièce sans désignation') + (p.ref ? ' — ' + p.ref : ''),
    avertissement: 'Cette fiche ne pourra pas être retrouvée.',
    ok: 'Supprimer', danger: true
  });
  if (!oui) return;
  retire('pieces', p.id, 'Pièce supprimée');
  message('Pièce supprimée', { ton: 'ok' });
  ctx.aller('/stock');
}

function bandeauArchive(p, refaire) {
  if (!p.archive) return null;
  return h('div.bandeau.bandeau--alerte', [
    icone('archive'),
    h('div.grandit', 'Cette pièce est archivée : elle ne sort plus dans les recherches ni dans le stock.'),
    h('button.bt.bt--nu.bt--s', {
      type: 'button', onclick: () => basculerArchive(p, refaire)
    }, 'Sortir de l’archive')
  ]);
}

/* ==========================================================================
   OÙ LA TROUVER — le bloc qu'on vient lire debout dans l'atelier
   ========================================================================== */

/** La clé du bac telle que `lit.emplacements` la construit : sans quoi on ne
 *  retrouve pas les voisines dans la table. */
function codeEmplacement(p) {
  return String(p.emplacement || '').trim().toUpperCase();
}

function voisinesDuBac(e, p) {
  const code = codeEmplacement(p);
  if (!code) return [];
  return (lit.emplacements(e).get(code) || []).filter(x => x.id !== p.id);
}

function blocOuLaTrouver(e, p, refaire) {
  const em = lit.lireEmplacement(p.emplacement);
  const voisines = voisinesDuBac(e, p);

  if (!em.code) {
    return h('div.panneau', [
      h('div.panneau__tete', [icone('entrepot', { taille: 16 }), h('h2.grandit', 'Où la trouver')]),
      h('div.panneau__corps', h('div.pile-s', [
        h('div.faible', 'Aucun emplacement noté. Une pièce qu’on ne retrouve pas '
          + 'est une pièce qu’on rachète.'),
        h('div', h('button.bt.bt--fort', {
          type: 'button', onclick: () => modalePiece(e, p, refaire)
        }, [icone('crayon'), h('span', 'Lui donner un bac')]))
      ]))
    ]);
  }

  const niveau = (nom, valeur) => h('div.piece-ou__niveau', [
    h('div.piece-ou__nom', nom),
    h('div.piece-ou__val', valeur || '—')
  ]);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('entrepot', { taille: 16 }),
      h('h2.grandit', 'Où la trouver'),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Imprimer l’étiquette du bac',
        onclick: () => imprimerEtiquetteBac(e, p)
      }, icone('imprimer'))
    ]),
    h('div.panneau__corps', h('div.pile', [
      h('div.piece-ou', [
        niveau('Rayon', em.rayon),
        h('span.piece-ou__fleche', icone('droite', { taille: 18 })),
        niveau('Travée', em.travee),
        h('span.piece-ou__fleche', icone('droite', { taille: 18 })),
        niveau('Bac', em.bac)
      ]),
      voisines.length
        ? h('div.pile-s', [
            h('div.majuscule', 'Dans le même bac'),
            h('div.liste', voisines.map(x => {
              const seuil = lit.seuilBas(e, x);
              return h('a.liste__ligne', { href: '#/stock/' + x.id }, [
                h('span.qte' + (x.qte <= 0 ? '.qte--zero' : (x.qte <= seuil ? '.qte--bas' : '')),
                  nombre(x.qte, 0)),
                h('div.grandit.coupe', [
                  h('div.coupe', x.libelle || 'Sans désignation'),
                  h('div.petit.faible.coupe', [x.ref, x.marque].filter(Boolean).join(' · '))
                ]),
                icone('droite', { taille: 15, classe: 'tres-faible' })
              ]);
            }))
          ])
        : h('div.petit.faible', 'Elle est seule dans ce bac.')
    ]))
  ]);
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function blocChiffres(e, p) {
  const f = p.fournisseurId ? lit.fournisseur(e, p.fournisseurId) : null;
  const m = marge(p.prixVente, p.prixAchat);
  const mPro = marge(p.prixVentePro, p.prixAchat);
  const seuil = lit.seuilBas(e, p);
  const rappel = nombre(e.reglages.inventaireRappel, 180);
  const inventaireVieux = p.inventorieLe
    ? fmt.joursDepuis(p.inventorieLe) > rappel
    : true;

  const paire = (nom, valeur, ton) => h('div.paire', [
    h('dt', nom),
    h('dd', { style: ton ? { color: 'var(--' + ton + ')' } : null }, valeur)
  ]);

  return h('div.panneau', [
    h('div.panneau__tete', [icone('euro', { taille: 16 }), h('h2.grandit', 'Le détail')]),
    h('div.panneau__corps', h('dl.paires', [
      paire('Quantité', nombre(p.qte, 0) + ' ' + (p.unite || 'u'),
        p.qte <= 0 ? 'danger' : (p.qte <= seuil ? 'alerte' : null)),
      paire('Seuil d’alerte', seuil + ' ' + (p.unite || 'u')
        + (p.qteMin === null || p.qteMin === undefined ? ' (seuil général)' : '')),
      paire('Unité', p.unite || 'u'),
      paire('Prix d’achat', fmt.euros(p.prixAchat)),
      paire('Prix de vente', nombre(p.prixVente) > 0 ? fmt.euros(p.prixVente) : 'non fixé'),
      paire('Prix de vente pro', nombre(p.prixVentePro) > 0
        ? fmt.euros(p.prixVentePro)
        : 'suit la remise confrère'),
      paire('Marge', nombre(p.prixVente) > 0
        ? fmt.euros(m.euros) + ' · ' + fmt.pourcent(m.taux)
        : '—', nombre(p.prixVente) > 0 && m.euros <= 0 ? 'danger' : null),
      paire('Marge pro', nombre(p.prixVentePro) > 0
        ? fmt.euros(mPro.euros) + ' · ' + fmt.pourcent(mPro.taux)
        : '—', nombre(p.prixVentePro) > 0 && mPro.euros <= 0 ? 'danger' : null),
      h('div.paire', [
        h('dt', 'Fournisseur'),
        h('dd', f
          ? h('div.pile-s', [
              h('div', f.nom || 'Sans nom'),
              lienTel(f.tel),
              h('div.petit.faible', 'livré sous ' + nombre(f.delaiJours, 1)
                + (nombre(f.delaiJours, 1) > 1 ? ' jours' : ' jour')
                + (f.compte ? ' · compte ' + f.compte : ''))
            ])
          : 'aucun')
      ]),
      paire('État', ETATS_PIECE[p.etat] || 'non précisé'),
      paire('Dernier inventaire', p.inventorieLe
        ? fmt.date(p.inventorieLe, 'court') + ' (' + fmt.quand(p.inventorieLe, { avecHeure: false }) + ')'
        : 'jamais compté', inventaireVieux ? 'alerte' : null),
      paire('Créée le', fmt.date(p.cree, 'court')),
      paire('Dernière modification', fmt.quand(p.maj, { avecHeure: true }))
    ])),
    p.notes ? h('div.panneau__pied', h('div.petit.faible', p.notes)) : null
  ]);
}

/* ==========================================================================
   COMPATIBLE AVEC — le texte qu'on relit dans six mois
   ========================================================================== */

function blocCompatible(p) {
  if (!String(p.compatible || '').trim()) return null;
  return h('div.panneau', [
    h('div.panneau__tete', [icone('vehicule', { taille: 16 }), h('h2.grandit', 'Compatible avec')]),
    h('div.panneau__corps', h('div.piece-compatible', p.compatible))
  ]);
}

/* ==========================================================================
   LA PHOTO
   ========================================================================== */

function blocPhoto(e, p, refaire) {
  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('camera', { taille: 16 }),
      h('h2.grandit', 'Photo'),
      p.photo ? h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Retirer la photo',
        onclick: () => retirerPhoto(p, refaire)
      }, icone('poubelle')) : null
    ]),
    h('div.panneau__corps', p.photo
      ? h('div.pile-s', [
          h('img.piece-photo', {
            src: p.photo,
            alt: 'Photo de ' + (p.libelle || 'la pièce'),
            loading: 'lazy'
          }),
          h('button.bt.bt--contour.bt--plein', {
            type: 'button', onclick: () => ajouterPhoto(p, refaire)
          }, [icone('camera'), h('span', 'Remplacer')])
        ])
      : h('div.pile-s', [
          h('div.petit.faible',
            'Une photo évite de redescendre au bac pour vérifier qu’on parle bien '
            + 'de la même pièce.'),
          h('button.bt.bt--contour.bt--plein.bt--pouce', {
            type: 'button', onclick: () => ajouterPhoto(p, refaire)
          }, [icone('camera'), h('span', 'Prendre une photo')])
        ]))
  ]);
}

async function ajouterPhoto(p, refaire) {
  const fichiers = await choisirFichier({ accepte: 'image/*', appareilPhoto: true });
  if (!fichiers.length) return;
  let reduite;
  try {
    reduite = await reduireImage(fichiers[0], { maxi: 1000 });
  } catch (err) {
    message('Cette image n’a pas pu être lue.', { ton: 'danger' });
    return;
  }
  change('pieces', p.id, { photo: reduite.donnee }, 'Photo de pièce');
  message('Photo enregistrée (' + fmt.octets(reduite.poids) + ')', { ton: 'ok' });
  refaire();
}

async function retirerPhoto(p, refaire) {
  if (!await confirmer({
    titre: 'Retirer la photo ?', texte: p.libelle || '', ok: 'Retirer', danger: true
  })) return;
  change('pieces', p.id, { photo: null }, 'Photo retirée');
  refaire();
}

/* ==========================================================================
   L'HISTORIQUE DES MOUVEMENTS
   « Où sont passées les trois que j'avais ? » — c'est ici, et nulle part
   ailleurs, que la réponse existe.
   ========================================================================== */

function blocMouvements(e, p) {
  const mouvements = lit.mouvementsDePiece(e, p.id);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('historique', { taille: 16 }),
      h('h2.grandit', 'Mouvements'),
      mouvements.length ? h('span.compte', String(mouvements.length)) : null
    ]),
    mouvements.length
      ? h('div.tableau-cadre', h('table.grille.repliable', [
          h('thead', h('tr', [
            h('th', 'Date'),
            h('th', 'Sens'),
            h('th.num', 'Quantité'),
            h('th.num', 'Avant → après'),
            h('th', 'Motif'),
            h('th', 'Dossier'),
            h('th', 'Qui')
          ])),
          h('tbody', mouvements.map(m => ligneMouvement(e, p, m)))
        ]))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Aucun mouvement : cette pièce n’est jamais entrée ni sortie.'))
  ]);
}

function ligneMouvement(e, p, m) {
  const s = SENS_MOUVEMENT[m.sens] || SENS_MOUVEMENT.sortie;
  const d = m.dossierId ? lit.dossier(e, m.dossierId) : null;
  const qui = m.qui ? lit.utilisateur(e, m.qui) : null;
  const unite = p.unite || 'u';

  /* L'inventaire n'ajoute ni ne retire : il pose la vérité comptée. Sa
     quantité est donc un écart, qui peut être négatif — on le montre signé,
     sinon on lit « 2 » là où il manquait deux pièces. */
  const q = nombre(m.qte, 0);
  const texteQte = m.sens === 'inventaire'
    ? (q > 0 ? '+' : '') + q + ' ' + unite
    : (s.signe < 0 ? '−' : '+') + Math.abs(q) + ' ' + unite;

  return h('tr', [
    h('td.serre', { donnees: { col: 'Date' } }, [
      h('div', fmt.date(m.quand, 'court')),
      h('div.minus.tres-faible', fmt.heure(m.quand))
    ]),
    h('td.serre', { donnees: { col: 'Sens' } },
      h('span.pastille.pastille--' + s.ton, s.nom)),
    h('td.num.serre', { donnees: { col: 'Quantité' } },
      h('span.gras', texteQte)),
    h('td.num.serre', { donnees: { col: 'Avant → après' } },
      h('span.tab-num', nombre(m.avant, 0) + ' → ' + nombre(m.apres, 0))),
    h('td', { donnees: { col: 'Motif' } },
      m.motif ? h('span', m.motif) : h('span.tres-faible', '—')),
    h('td.serre', { donnees: { col: 'Dossier' } }, d
      ? h('a.rang-s', { href: '#/dossier/' + d.id }, [
          icone('dossier', { taille: 14 }),
          h('span', d.numero || lit.titreDossier(e, d))
        ])
      : h('span.tres-faible', '—')),
    h('td.serre', { donnees: { col: 'Qui' } },
      qui ? (qui.prenom || lit.nomUtilisateur(qui)) : h('span.tres-faible', '—'))
  ]);
}

/* ==========================================================================
   UTILISÉE DANS — les dossiers ouverts qui l'ont déjà réservée
   ========================================================================== */

/** Les dossiers dont une ligne pointe cette pièce. `tous` inclut les dossiers
 *  clos et archivés : c'est ce qu'il faut savoir avant de supprimer. */
function dossiersQuiUtilisent(e, p, tous) {
  const sortie = [];
  for (const d of e.dossiers || []) {
    if (!tous && (d.archive || !ETAPES_OUVERTES.includes(d.etape))) continue;
    const lignes = (d.lignes || []).filter(l => l.type === 'piece' && l.pieceId === p.id);
    if (lignes.length) sortie.push({ dossier: d, lignes });
  }
  return sortie;
}

function blocUtiliseeDans(e, p) {
  const usages = dossiersQuiUtilisent(e, p, false);
  if (!usages.length) return null;

  const promis = usages.reduce((t, u) =>
    t + u.lignes.filter(l => !l.sortieFaite).reduce((s, l) => s + nombre(l.qte, 0), 0), 0);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('dossier', { taille: 16 }),
      h('h2.grandit', 'Utilisée dans'),
      h('span.compte', String(usages.length))
    ]),
    h('div.liste', usages.map(u => {
      const d = u.dossier;
      const v = lit.vehicule(e, d.vehiculeId);
      const qte = u.lignes.reduce((s, l) => s + nombre(l.qte, 0), 0);
      const sortie = u.lignes.every(l => l.sortieFaite);
      return h('a.liste__ligne', { href: '#/dossier/' + d.id }, [
        h('span.qte', nombre(qte, 0)),
        h('div.grandit.coupe', [
          h('div.coupe', lit.titreDossier(e, d)),
          h('div.petit.faible.coupe', [d.numero, v ? v.immat : null].filter(Boolean).join(' · '))
        ]),
        sortie
          ? h('span.pastille.pastille--ok', 'sortie faite')
          : h('span.pastille.pastille--alerte', 'à sortir')
      ]);
    })),
    promis > 0
      ? h('div.panneau__pied', h('div.petit.faible',
          promis + ' ' + (p.unite || 'u') + ' promise(s) mais pas encore décomptée(s) : '
          + 'le stock affiché est donc plus optimiste que la réalité.'))
      : null
  ]);
}

/* ==========================================================================
   LA PETITE MODALE DE MOUVEMENT
   Deux champs et un compte à rebours visible : c'est ce qu'on tape debout,
   d'une main, avec l'autre sur le carton.
   ========================================================================== */

function modaleMouvement(e, p, sensInitial, apres) {
  const unite = p.unite || 'u';

  const sens = champ({
    etiquette: 'Sens', type: 'liste', valeur: sensInitial,
    options: Object.keys(SENS_MOUVEMENT).map(k => ({ valeur: k, texte: SENS_MOUVEMENT[k].nom }))
  });
  const qte = champ({
    etiquette: 'Quantité', type: 'nombre', unite, valeur: 1, autofocus: true
  });
  const motif = champ({
    etiquette: 'Motif', valeur: '',
    exemple: sensInitial === 'entree' ? 'Livraison Autodis' : 'Montée sur la 308 de M. Roux'
  });

  const apercu = h('div.bandeau');

  function rafraichirApercu() {
    const cle = sens.lire();
    const s = SENS_MOUVEMENT[cle] || SENS_MOUVEMENT.sortie;
    const avant = nombre(p.qte, 0);
    const q = Math.abs(nombre(qte.lire(), 0));
    const apresQte = cle === 'inventaire' ? nombre(qte.lire(), avant) : avant + s.signe * q;

    /* L'inventaire ne compte pas ce qui entre : il dit ce qu'il y a. Le champ
       change donc de sens sous les doigts, et l'étiquette doit suivre. */
    const etiquette = qte.noeud.querySelector('label');
    if (etiquette) etiquette.textContent = cle === 'inventaire' ? 'Quantité comptée' : 'Quantité';

    poser(apercu, [
      icone(apresQte < 0 ? 'alerte' : 'balance'),
      h('span.grandit', apresQte < 0
        ? 'Il n’y en a que ' + avant + ' : on ne peut pas en sortir ' + q + '.'
        : avant + ' ' + unite + ' → ' + apresQte + ' ' + unite)
    ]);
    apercu.classList.toggle('bandeau--danger', apresQte < 0);
    apercu.classList.toggle('bandeau--ok', apresQte >= 0 && s.signe > 0);
  }

  sens.entree.addEventListener('change', rafraichirApercu);
  qte.entree.addEventListener('input', rafraichirApercu);
  rafraichirApercu();

  modale({
    titre: SENS_MOUVEMENT[sensInitial].nom + ' — ' + (p.libelle || p.ref || 'pièce'),
    corps: h('div.pile', [
      h('div.rang-s.enroule', [
        h('span.qte', nombre(p.qte, 0) + ' ' + unite),
        p.emplacement ? h('span.etiq.num', lit.lireEmplacement(p.emplacement).code) : null
      ]),
      sens.noeud,
      qte.noeud,
      motif.noeud,
      apercu
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: () => {
          const cle = sens.lire();
          const q = nombre(qte.lire(), 0);
          if (cle !== 'inventaire' && q <= 0) {
            qte.erreur('Une quantité, et supérieure à zéro.');
            return false;
          }
          const m = act.mouvementStock({
            pieceId: p.id, sens: cle, qte: q,
            prixUnit: nombre(p.prixAchat),
            fournisseurId: cle === 'entree' ? (p.fournisseurId || null) : null,
            motif: motif.lire()
          });
          /* `mouvementStock` rend null quand il refuse : stock qui passerait
             sous zéro. On garde alors la fenêtre ouverte, la saisie intacte. */
          if (!m) {
            qte.erreur('Refusé : le stock passerait sous zéro.');
            return false;
          }
          message(SENS_MOUVEMENT[cle].nom + ' enregistrée — il en reste ' + m.apres + ' ' + unite,
            { ton: 'ok' });
          if (apres) apres();
        }
      }
    ]
  });
}

/* ==========================================================================
   LA MODALE DE FICHE
   Partagée avec l'écran /stock : c'est la même pièce qu'on décrit, qu'on
   arrive de la liste ou de la fiche. `modele` sert à la duplication.
   ========================================================================== */

export function modalePiece(e, piece, apres, modele) {
  const edition = !!piece;
  const p = piece || modele || {};

  const propositions = listesConnues(e);
  const libelle = champ({
    etiquette: 'Désignation', valeur: p.libelle || '', obligatoire: true,
    autofocus: !edition, exemple: 'Filtre à huile Purflux LS932'
  });
  const ref = champ({
    etiquette: 'Référence', valeur: p.ref || '', exemple: 'MOT-F-001',
    aide: 'La vôtre, celle qui est écrite sur le bac.'
  });
  const refFabricant = champ({
    etiquette: 'Référence fabricant', valeur: p.refFabricant || '', exemple: 'LS932'
  });
  const ean = champ({ etiquette: 'Code-barres', valeur: p.ean || '', exemple: '3286064009328' });
  const famille = champ({ etiquette: 'Famille', valeur: p.famille || '', exemple: 'Moteur' });
  const marqueChamp = champ({ etiquette: 'Marque', valeur: p.marque || '', exemple: 'Purflux' });
  const fournisseurChamp = champ({
    etiquette: 'Fournisseur', type: 'liste', valeur: p.fournisseurId || '',
    options: [{ valeur: '', texte: 'Aucun' }].concat(
      (e.fournisseurs || []).filter(f => !f.archive)
        .map(f => ({ valeur: f.id, texte: f.nom || 'Sans nom' })))
  });
  const emplacement = champ({
    etiquette: 'Emplacement', valeur: p.emplacement || '', exemple: 'R3-C-02',
    aide: aideEmplacement(p.emplacement)
  });
  const etat = champ({
    etiquette: 'État', type: 'liste', valeur: p.etat || 'neuf',
    options: Object.keys(ETATS_PIECE).map(k => ({ valeur: k, texte: ETATS_PIECE[k] }))
  });
  const unite = champ({
    etiquette: 'Unité', valeur: p.unite || 'u', exemple: 'u',
    aide: 'u, L, m, kg… ce qu’on compte.'
  });
  const qteInitiale = champ({
    etiquette: 'Quantité de départ', type: 'nombre', valeur: edition ? nombre(p.qte, 0) : 0,
    bloque: edition,
    aide: edition
      ? 'Elle ne se corrige pas ici : passez par Entrée, Sortie ou Inventaire, sinon l’historique ment.'
      : 'Elle sera enregistrée comme une première entrée en stock.'
  });
  const qteMin = champ({
    etiquette: 'Seuil d’alerte', type: 'nombre',
    valeur: p.qteMin === null || p.qteMin === undefined ? '' : p.qteMin,
    aide: 'Vide : on suit le seuil général (' + nombre(e.reglages.stockAlerteDefaut, 1) + ').'
  });
  const prixAchat = champ({ etiquette: 'Prix d’achat', type: 'euros', unite: '€', valeur: p.prixAchat || 0 });
  const prixVente = champ({ etiquette: 'Prix de vente', type: 'euros', unite: '€', valeur: p.prixVente || 0 });
  const prixVentePro = champ({
    etiquette: 'Prix de vente pro', type: 'euros', unite: '€', valeur: p.prixVentePro || 0,
    aide: 'Vide ou zéro : la remise confrère s’applique au prix public.'
  });
  const compatible = champ({
    etiquette: 'Compatible avec', type: 'zone', lignes: 2, valeur: p.compatible || '',
    exemple: 'PSA 1.6 HDi 8V — 308 II, 3008, Berlingo',
    aide: 'En clair. C’est ce qu’on relira dans six mois.'
  });
  const notes = champ({
    etiquette: 'Notes', type: 'zone', lignes: 2, valeur: p.notes || '',
    exemple: 'Attention : joint fourni à part.'
  });

  brancherPropositions(famille, propositions.familles);
  brancherPropositions(marqueChamp, propositions.marques);
  brancherPropositions(emplacement, propositions.rayons);

  /* L'emplacement se décompose sous les doigts : on voit tout de suite si
     « R3C02 » a bien été compris comme rayon 3, travée C, bac 02. */
  emplacement.entree.addEventListener('input', () => {
    const bulle = emplacement.noeud.querySelector('.champ__aide');
    if (bulle) bulle.textContent = aideEmplacement(emplacement.lire());
  });

  const bulleMarge = h('div.petit.faible');
  function rafraichirMarge() {
    const achat = nombre(prixAchat.lire(), 0);
    const vente = nombre(prixVente.lire(), 0);
    if (achat <= 0 && vente <= 0) { bulleMarge.textContent = ''; return; }
    const m = marge(vente, achat);
    bulleMarge.textContent = vente > 0
      ? 'Marge : ' + fmt.euros(m.euros) + ' soit ' + fmt.pourcent(m.taux) + ' du prix de vente.'
      : 'Prix conseillé à ' + nombre(e.reglages.margeDefaut, 30) + ' % de marge : '
        + fmt.euros(prixConseille(achat, e.reglages.margeDefaut)) + '.';
  }
  prixAchat.entree.addEventListener('input', rafraichirMarge);
  prixVente.entree.addEventListener('input', rafraichirMarge);
  rafraichirMarge();

  /* Un prix de vente vide alors qu'on vient de saisir un achat, c'est une
     pièce qu'on facturera à zéro. On propose, on n'impose pas. */
  prixAchat.entree.addEventListener('change', () => {
    if (nombre(prixVente.lire(), 0) > 0) return;
    const conseille = prixConseille(prixAchat.lire(), e.reglages.margeDefaut);
    if (conseille > 0) { prixVente.ecrire(conseille); rafraichirMarge(); }
  });

  const bloc = (titre, champs) => h('div.pile-s', [h('div.majuscule', titre), grilleChamps(champs)]);

  modale({
    titre: edition ? 'Modifier la pièce' : 'Nouvelle pièce',
    taille: 'large',
    corps: h('div.pile', [
      libelle.noeud,
      bloc('Identification', [ref, refFabricant, ean]),
      bloc('Classement', [famille, marqueChamp, fournisseurChamp, etat]),
      emplacement.noeud,
      bloc('Le compte', [qteInitiale, qteMin, unite]),
      h('div.pile-s', [
        h('div.majuscule', 'Les prix'),
        grilleChamps([prixAchat, prixVente, prixVentePro]),
        bulleMarge
      ]),
      compatible.noeud,
      notes.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: edition ? 'Enregistrer' : 'Créer la pièce', ton: 'fort',
        faire: () => {
          if (!libelle.lire()) {
            libelle.erreur('Une désignation, au minimum : c’est ce qu’on lit sur le bac.');
            return false;
          }
          libelle.erreur('');

          const champs = {
            libelle: libelle.lire(),
            ref: ref.lire(),
            refFabricant: refFabricant.lire(),
            ean: ean.lire(),
            famille: famille.lire(),
            marque: marqueChamp.lire(),
            fournisseurId: fournisseurChamp.lire() || null,
            emplacement: emplacement.lire().toUpperCase(),
            etat: etat.lire(),
            unite: unite.lire() || 'u',
            qteMin: valeurOuRien(qteMin),
            prixAchat: nombre(prixAchat.lire(), 0),
            prixVente: nombre(prixVente.lire(), 0),
            prixVentePro: nombre(prixVentePro.lire(), 0),
            compatible: compatible.lire(),
            notes: notes.lire()
          };

          if (edition) {
            const modifiee = change('pieces', p.id, champs, 'Pièce modifiée');
            message('Pièce enregistrée', { ton: 'ok' });
            if (apres) apres(modifiee);
            return;
          }

          /* La photo suit la duplication : c'est la même pièce en rayon. */
          const creee = ajoute('pieces', nouvellePiece(Object.assign({}, champs, {
            qte: 0, photo: modele ? modele.photo || null : null
          })), 'Pièce créée');

          /* La quantité de départ entre par un mouvement, pas par le champ :
             une pièce dont le stock apparaît sans trace est une pièce dont on
             ne saura jamais d'où elle vient. */
          const depart = nombre(qteInitiale.lire(), 0);
          if (creee && depart > 0) {
            act.mouvementStock({
              pieceId: creee.id, sens: 'entree', qte: depart,
              prixUnit: champs.prixAchat, fournisseurId: champs.fournisseurId,
              motif: 'Stock de départ'
            });
          }
          message('Pièce créée', { ton: 'ok' });
          if (apres) apres(creee);
        }
      }
    ]
  });
}

/** Les valeurs déjà saisies ailleurs : on les propose plutôt que de laisser
 *  cinq orthographes de « Électricité » cohabiter dans le stock. */
function listesConnues(e) {
  const pieces = (e.pieces || []);
  return {
    familles: unique(pieces.map(x => x.famille).filter(Boolean)).sort(compareTexte),
    marques: unique(pieces.map(x => x.marque).filter(Boolean)).sort(compareTexte),
    rayons: unique(pieces.map(x => x.emplacement).filter(Boolean)).sort(compareTexte)
  };
}

/** Branche une liste de suggestions sur un champ texte. `datalist` laisse la
 *  saisie libre — on suggère sans enfermer. */
function brancherPropositions(c, valeurs) {
  if (!valeurs.length) return;
  const cle = idUnique('lst');
  const liste = h('datalist', { id: cle }, valeurs.map(v => h('option', { value: v })));
  c.entree.setAttribute('list', cle);
  c.noeud.appendChild(liste);
}

function aideEmplacement(code) {
  const em = lit.lireEmplacement(code);
  if (!em.code) return 'Rayon, travée, bac — séparés par des tirets. Exemple : R3-C-02.';
  return 'Rayon ' + (em.rayon || '?') + ' · travée ' + (em.travee || '?')
    + ' · bac ' + (em.bac || '?');
}

/** Un champ nombre laissé vide vaut « rien de fixé », pas zéro : le seuil
 *  d'alerte suit alors le réglage général du garage. */
function valeurOuRien(c) {
  return String(c.entree.value || '').trim() === '' ? null : nombre(c.lire(), null);
}
