/* ==========================================================================
   YATECH — la fiche d'un véhicule
   --------------------------------------------------------------------------
   C'est le carnet d'entretien du garage. Un véhicule revient tous les deux
   ans, et la question posée au comptoir est toujours la même : « qu'est-ce
   qu'on lui a fait la dernière fois, et à combien de kilomètres ? ».

   Deux informations passent avant les autres :
     • la plaque, parce qu'on arrive ici en la lisant sur le pare-brise ;
     • le calculateur, parce que le garage fait de l'électronique et qu'un
       type d'ECU mal noté, c'est une heure perdue et parfois un crédit brûlé.

   Le reste — historique, photos, notes — se lit du plus récent au plus vieux.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message, menu, vide } from '../core/ui.js';
import { maj, change, retire } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { id, nombre, JOUR, nu, tronque, plaqueJolie } from '../core/util.js';
import { choisirFichier, reduireImage, copier } from '../core/fichiers.js';
import * as lit from '../domain/selecteurs.js';
import {
  ETAPES_OUVERTES, PROTOCOLES, OPERATIONS_ELECTRO, ETATS_INTERVENTION, OUTILS_ELECTRO
} from '../domain/schema.js';
import {
  plaque, champ, grilleChamps, lienTel, pastilleEtape, choixClient
} from '../ui/widgets.js';
import { nouveauDossierModale } from './dossier-nouveau.js';
import { modaleVehicule } from './vehicules.js';

/* Le modèle ne porte aucune date de contrôle technique : on ne l'invente pas.
   Le seul rappel honnête qu'on sache calculer est kilométrique, à partir de la
   dernière révision retrouvée dans l'historique. Cet intervalle est celui d'un
   entretien courant ; il vaut ce qu'il vaut, et le bloc le dit. */
const KM_ENTRE_REVISIONS = 15000;
const MOTS_REVISION = ['revision', 'vidange', 'entretien', 'filtre a huile'];

/* Les vocabulaires que le schéma décrit en commentaire sans les figer : on les
   écrit ici pour l'affichage et pour les listes de saisie, sans rien ajouter à
   ce que le modèle prévoit. */
const ENERGIES = {
  diesel: 'Diesel', essence: 'Essence', hybride: 'Hybride',
  electrique: 'Électrique', gpl: 'GPL'
};
const BOITES = { manuelle: 'Manuelle', automatique: 'Automatique' };

/* ==========================================================================
   L'ÉCRAN
   ========================================================================== */

export function peindre(ctx) {
  const e = ctx.etat;
  const racine = h('div.pile');

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    /* On relit le véhicule à chaque peinture : après un changement de
       propriétaire ou une photo ajoutée, l'objet a bougé dans l'état. */
    const v = lit.vehicule(e, ctx.params.id);
    if (!v) return introuvable();

    return [
      ficheTete(e, v, ctx, refaire),
      bandeauArchive(v),
      bandeauAuGarage(e, v),
      carteIdentite(e, v),
      h('div.deux-colonnes', [
        h('div.pile', [
          blocCalculateur(e, v),
          blocInterventions(e, v),
          blocHistorique(e, v)
        ]),
        h('div.pile', [
          blocEcheances(e, v),
          blocPhotos(e, v, refaire),
          blocNotes(e, v)
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
      icone: 'vehicule',
      titre: 'Ce véhicule n’existe plus',
      texte: 'La fiche a peut-être été supprimée, ou le lien est ancien.'
    }),
    h('div.centre', h('a.bt.bt--contour', { href: '#/vehicules' },
      [icone('retour'), h('span', 'Tous les véhicules')]))
  ]);
}

/* ==========================================================================
   L'EN-TÊTE — la plaque, le propriétaire, le compteur
   ========================================================================== */

function ficheTete(e, v, ctx, refaire) {
  const proprietaire = lit.client(e, v.clientId);

  return h('div.fiche-tete', [
    h('div.fiche-tete__identite', [
      plaque(v.immat, true),
      h('h1', { style: { marginTop: 'var(--e-2)' } }, lit.nomVehicule(v)),
      v.motorisation ? h('div.faible', v.motorisation) : null,
      h('div.fiche-tete__lignes', [
        proprietaire
          ? h('a.rang-s', { href: '#/client/' + proprietaire.id }, [
              icone('clients', { taille: 14 }),
              h('span', lit.nomClient(proprietaire))
            ])
          : h('span.rang-s', [icone('question', { taille: 14 }), h('span', 'Sans propriétaire')]),
        proprietaire ? lienTel(proprietaire.tel) : null,
        v.km
          ? h('span.rang-s', [
              icone('jauge', { taille: 14 }),
              h('span', fmt.km(v.km) + (v.kmReleveLe ? ' relevés ' + fmt.quand(v.kmReleveLe, { avecHeure: false }) : ''))
            ])
          : h('span.rang-s.tres-faible', [icone('jauge', { taille: 14 }), h('span', 'Kilométrage inconnu')])
      ])
    ]),
    h('div.fiche-tete__actions', [
      h('button.bt.bt--fort', {
        type: 'button',
        onclick: () => nouveauDossierModale(e, (d) => {
          if (d) ctx.aller('/dossier/' + d.id); else refaire();
        }, { vehiculeId: v.id, clientId: v.clientId })
      }, [icone('plus'), h('span', 'Nouveau dossier')]),
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: () => modaleVehicule(e, v, refaire)
      }, [icone('crayon'), h('span', 'Modifier')]),
      h('button.bt.bt--contour.bt--icone', {
        type: 'button',
        'aria-label': 'Autres actions',
        onclick: (ev) => menuFiche(ev.currentTarget, e, v, ctx, refaire)
      }, icone('points'))
    ])
  ]);
}

function menuFiche(ancre, e, v, ctx, refaire) {
  const dossiers = lit.dossiersDuVehicule(e, v.id);
  const interventions = lit.interventionsDuVehicule(e, v.id);

  /* `menu()` prend un `null` pour un trait de séparation : on n'en glisse donc
     pas un à la place d'une entrée absente, sinon deux traits se collent. */
  const entrees = [{
    texte: 'Changer de propriétaire', icone: 'clients',
    faire: () => modaleProprietaire(e, v, refaire)
  }];
  if (v.clientId) {
    entrees.push({
      texte: 'Ouvrir la fiche du propriétaire', icone: 'ouvrir',
      faire: () => ctx.aller('/client/' + v.clientId)
    });
  }

  menu(ancre, entrees.concat([
    null,
    {
      texte: v.archive ? 'Sortir de l’archive' : 'Archiver ce véhicule', icone: 'archive',
      faire: () => {
        change('vehicules', v.id, { archive: !v.archive },
          v.archive ? 'Véhicule sorti de l’archive' : 'Véhicule archivé');
        message(v.archive ? 'Véhicule réactivé' : 'Véhicule archivé', { ton: 'ok' });
        refaire();
      }
    },
    {
      texte: 'Supprimer définitivement', icone: 'poubelle', danger: true,
      faire: () => supprimer(e, v, ctx, dossiers, interventions)
    }
  ]), { titre: lit.nomVehicule(v) });
}

/** Un véhicule qui a des dossiers ou des interventions ne se supprime pas :
 *  ces documents perdraient leur objet, et une facture doit rester lisible dix
 *  ans. On propose l'archive à la place. */
async function supprimer(e, v, ctx, dossiers, interventions) {
  if (dossiers.length || interventions.length) {
    const attaches = [
      dossiers.length ? dossiers.length + (dossiers.length > 1 ? ' dossiers' : ' dossier') : '',
      interventions.length ? interventions.length + (interventions.length > 1 ? ' interventions' : ' intervention') : ''
    ].filter(Boolean).join(' et ');
    await confirmer({
      titre: 'Suppression impossible',
      texte: 'Ce véhicule porte ' + attaches + '. Les effacer laisserait des documents '
        + 'sans objet — dont, peut-être, des factures déjà transmises à EBP.',
      detail: 'Archivez-le plutôt : il disparaît des listes et reste consultable.',
      ok: 'J’ai compris',
      annuler: 'Fermer'
    });
    return;
  }
  const oui = await confirmer({
    titre: 'Supprimer ce véhicule ?',
    texte: lit.nomVehiculeLong(v) + ' — ' + (plaqueJolie(v.immat) || 'sans plaque'),
    avertissement: 'Cette fiche ne pourra pas être retrouvée.',
    ok: 'Supprimer', danger: true
  });
  if (!oui) return;
  retire('vehicules', v.id, 'Véhicule supprimé');
  message('Véhicule supprimé', { ton: 'ok' });
  ctx.aller('/vehicules');
}

/* Le propriétaire change (revente, reprise). Les dossiers déjà écrits gardent
   leur client : la facture de l'ancien propriétaire reste la sienne. */
function modaleProprietaire(e, v, refaire) {
  const choix = choixClient({
    etat: e, valeur: v.clientId, etiquette: 'Nouveau propriétaire'
  });

  modale({
    titre: 'Changer de propriétaire',
    corps: h('div.pile', [
      h('div.bandeau', [
        icone('info'),
        h('span', 'Les dossiers et factures déjà établis restent au nom de l’ancien '
          + 'propriétaire. Seuls les prochains suivront le nouveau.')
      ]),
      choix.noeud
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: () => {
          const nouveau = choix.lire();
          if (!nouveau) { message('Choisissez un client.', { ton: 'alerte' }); return false; }
          change('vehicules', v.id, { clientId: nouveau }, 'Véhicule changé de propriétaire');
          message('Propriétaire mis à jour', { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}

/* ==========================================================================
   LES BANDEAUX DE CONTEXTE
   ========================================================================== */

function bandeauArchive(v) {
  if (!v.archive) return null;
  return h('div.bandeau.bandeau--alerte', [
    icone('archive'),
    h('span', 'Ce véhicule est archivé : il n’apparaît plus dans les listes ni dans les recherches.')
  ]);
}

/** Le véhicule est-il chez nous en ce moment ? C'est la première chose qu'on
 *  veut savoir quand le client téléphone. */
function bandeauAuGarage(e, v) {
  const encours = lit.dossiersDuVehicule(e, v.id)
    .filter(d => !d.archive && ETAPES_OUVERTES.includes(d.etape))
    .sort(lit.triDossiers)[0];
  if (!encours) return null;

  const jours = lit.joursDansAtelier(encours);
  return h('a.carte.rang', { href: '#/dossier/' + encours.id }, [
    icone('atelier', { taille: 18 }),
    h('div.grandit.coupe', [
      h('div.gras.coupe', 'Au garage en ce moment — ' + lit.titreDossier(e, encours)),
      h('div.petit.faible.coupe', [
        encours.numero,
        encours.place ? 'place ' + encours.place : 'sans place attribuée',
        jours === 0 ? 'entré aujourd’hui' : 'depuis ' + jours + ' jours'
      ].filter(Boolean).join(' · '))
    ]),
    pastilleEtape(encours.etape),
    icone('droite', { taille: 15, classe: 'tres-faible' })
  ]);
}

/* ==========================================================================
   LA CARTE D'IDENTITÉ
   ========================================================================== */

function carteIdentite(e, v) {
  const ans = ageAnnees(v);
  const moyenne = moyenneKmParAn(v);

  const lignes = [
    paire('Immatriculation', v.immat ? plaque(v.immat) : null),
    paire('VIN', v.vin ? h('span.num', v.vin) : null),
    paire('Énergie', ENERGIES[v.energie] || v.energie),
    paire('Motorisation', v.motorisation),
    paire('Cylindrée', v.cylindree),
    paire('Puissance', [
      v.puissanceCh ? fmt.nb(v.puissanceCh) + ' ch' : '',
      v.puissanceFisc ? v.puissanceFisc + ' CV' : ''
    ].filter(Boolean).join(' · ')),
    paire('Boîte', BOITES[v.boite] || v.boite),
    paire('Couleur', v.couleur),
    paire('1re mise en circulation', dateMec(v)
      ? fmt.date(dateMec(v), 'lettre') + (ans ? ' · ' + fmt.nb(ans, 0) + ' ans' : '')
      : null),
    paire('Kilométrage', v.km
      ? h('div', [
          h('b.num', fmt.km(v.km)),
          v.kmReleveLe ? h('div.minus.tres-faible', 'relevé le ' + fmt.date(v.kmReleveLe)) : null
        ])
      : null),
    paire('Moyenne annuelle', moyenne ? fmt.km(moyenne) + ' / an' : null),
    paire('Repère des clés', v.clefs ? h('span.etiq', [icone('cle', { taille: 12 }), h('span', v.clefs)]) : null)
  ].filter(Boolean);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('vehicule', { taille: 16 }),
      h('h2.grandit', 'Le véhicule'),
      h('span.petit.faible', lit.nomVehiculeLong(v))
    ]),
    h('div.panneau__corps', lignes.length
      ? h('dl.paires', lignes)
      : h('div.petit.faible.centre', 'Aucune caractéristique renseignée pour l’instant.'))
  ]);
}

/** Une paire étiquette / valeur. Rend `null` si la valeur est vide : une fiche
 *  criblée de tirets se lit moins bien qu'une fiche courte. */
function paire(etiquette, valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return h('div.paire', [
    h('dt', etiquette),
    h('dd', valeur)
  ]);
}

/* ==========================================================================
   LE CALCULATEUR — ce qu'on vient chercher ici en premier
   ========================================================================== */

function blocCalculateur(e, v) {
  const zone = h('div.panneau.vehicule-ecu');

  function lecture() {
    const c = v.ecu || {};
    const rempli = !!(c.marque || c.type || c.hw || c.sw || c.protocole);
    const proto = PROTOCOLES[c.protocole];

    poser(zone, [
      h('div.panneau__tete', [
        icone('puce', { taille: 16 }),
        h('h2.grandit', 'Calculateur'),
        h('button.bt.bt--contour.bt--s', {
          type: 'button', onclick: edition
        }, [icone('crayon', { taille: 14 }), h('span', rempli ? 'Modifier' : 'Renseigner')])
      ]),
      h('div.panneau__corps', rempli
        ? h('div.pile', [
            h('dl.paires', [
              paire('Marque', c.marque),
              paire('Type', c.type ? h('b.num', c.type) : null),
              paire('Hardware', c.hw ? h('span.num', c.hw) : null),
              paire('Software', c.sw ? h('span.num', c.sw) : null),
              paire('Protocole qui passe', proto
                ? h('span.pastille.pastille--info.pastille--sans-point', { title: proto.aide }, proto.nom)
                : c.protocole)
            ].filter(Boolean)),
            h('div.rang.enroule', [
              h('button.bt.bt--nu.bt--s', {
                type: 'button',
                onclick: async () => {
                  const ok = await copier(resumeEcu(v));
                  message(ok ? 'Repères du calculateur copiés' : 'Copie impossible',
                    { ton: ok ? 'ok' : 'danger' });
                }
              }, [icone('copier', { taille: 14 }), h('span', 'Copier les repères')])
            ])
          ])
        : h('div.pile-s', [
            h('div.petit.faible', 'Rien de noté sur le calculateur de ce véhicule. '
              + 'Le renseigner une fois évite de rouvrir le capot la prochaine fois.'),
            h('button.bt.bt--contour.bt--s', {
              type: 'button', onclick: edition
            }, [icone('plus', { taille: 14 }), h('span', 'Noter le calculateur')])
          ]))
    ]);
  }

  function edition() {
    const c = v.ecu || {};
    const marque = champ({ etiquette: 'Marque', valeur: c.marque, exemple: 'Bosch, Delphi, Continental…', autofocus: true });
    const type = champ({ etiquette: 'Type', valeur: c.type, exemple: 'EDC17C60' });
    const hw = champ({ etiquette: 'Hardware', valeur: c.hw, exemple: '0281031234' });
    const sw = champ({ etiquette: 'Software', valeur: c.sw, exemple: '1037551234' });
    const protocole = champ({
      etiquette: 'Protocole qui a fonctionné', type: 'liste', valeur: c.protocole || '',
      options: [{ valeur: '', texte: '— pas encore établi —' }].concat(
        Object.keys(PROTOCOLES).map(k => ({ valeur: k, texte: PROTOCOLES[k].nom }))),
      aide: 'Celui par lequel on a réussi à communiquer la dernière fois.'
    });

    poser(zone, [
      h('div.panneau__tete', [
        icone('puce', { taille: 16 }),
        h('h2.grandit', 'Calculateur')
      ]),
      h('div.panneau__corps', h('div.pile', [
        grilleChamps([marque, type, hw, sw, protocole]),
        h('div.rang.rang-fin.enroule', [
          h('button.bt.bt--contour', { type: 'button', onclick: lecture }, 'Annuler'),
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => {
              change('vehicules', v.id, {
                ecu: {
                  marque: marque.lire(), type: type.lire(), hw: hw.lire(),
                  sw: sw.lire(), protocole: protocole.lire()
                }
              }, 'Calculateur du véhicule mis à jour');
              message('Calculateur enregistré', { ton: 'ok' });
              lecture();
            }
          }, [icone('coche'), h('span', 'Enregistrer')])
        ])
      ]))
    ]);
  }

  lecture();
  return zone;
}

/** La ligne qu'on colle dans un forum ou qu'on dicte au téléphone. */
function resumeEcu(v) {
  const c = v.ecu || {};
  const proto = PROTOCOLES[c.protocole];
  return [
    lit.nomVehiculeLong(v),
    plaqueJolie(v.immat),
    [c.marque, c.type].filter(Boolean).join(' '),
    c.hw ? 'HW ' + c.hw : '',
    c.sw ? 'SW ' + c.sw : '',
    proto ? 'protocole ' + proto.nom : ''
  ].filter(Boolean).join(' — ');
}

/* ==========================================================================
   LES INTERVENTIONS ÉLECTRONIQUES
   ========================================================================== */

function blocInterventions(e, v) {
  const liste = lit.interventionsDuVehicule(e, v.id);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('electro', { taille: 16 }),
      h('h2.grandit', 'Interventions électroniques'),
      liste.length ? h('span.compte', String(liste.length)) : null,
      h('a.bt.bt--nu.bt--s', { href: '#/electronique' }, 'L’atelier électronique')
    ]),
    liste.length
      ? h('div.panneau__corps', h('div.pile', [
          bandeauSauvegardes(e, liste),
          tableauInterventions(e, liste)
        ].filter(Boolean)))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Aucune lecture ni écriture enregistrée sur ce véhicule.'))
  ]);
}

/** Le fichier d'origine est ce qu'on cherche en catastrophe quand une écriture
 *  tourne mal : il remonte tout en haut du bloc, jamais enfoui dans le
 *  tableau. L'outil ne stocke que son repère — le binaire reste rangé avec
 *  l'appareil qui l'a lu. */
function bandeauSauvegardes(e, interventions) {
  const trouves = [];
  for (const i of interventions) {
    for (const f of i.fichiers || []) {
      if (f.role !== 'origine' && f.role !== 'sauvegarde') continue;
      trouves.push({ fichier: f, intervention: i });
    }
  }
  if (!trouves.length) return null;

  return h('div.bandeau.bandeau--ok', [
    icone('cadenas'),
    h('div.grandit', [
      h('div.gras', trouves.length > 1
        ? trouves.length + ' sauvegardes d’origine archivées'
        : 'Sauvegarde d’origine archivée'),
      h('div.pile-s', { style: { marginTop: 'var(--e-1)' } }, trouves.map(t =>
        h('div.petit', [
          h('b.num', t.fichier.nom || 'fichier sans nom'),
          h('span.faible', ' — ' + [
            operationNom(t.intervention.operation),
            protocoleNom(t.intervention.protocole),
            fmt.date(t.fichier.quand || t.intervention.quand)
          ].filter(Boolean).join(' · '))
        ])
      )),
      h('div.minus.tres-faible', { style: { marginTop: 'var(--e-1)' } },
        'Repère seulement : le fichier lui-même est rangé avec l’outil qui l’a lu.')
    ])
  ]);
}

function tableauInterventions(e, liste) {
  return h('div.tableau-cadre', h('table.grille.repliable', [
    h('thead', h('tr', [
      h('th', 'Date'),
      h('th', 'Opération'),
      h('th', 'Protocole'),
      h('th', 'État'),
      h('th.num', 'Crédits'),
      h('th', 'Résultat')
    ])),
    h('tbody', liste.map(i => {
      const etat = ETATS_INTERVENTION[i.etat];
      return h('tr', [
        h('td', { donnees: { col: 'Date' } }, h('span.num', fmt.date(i.quand, 'court'))),
        h('td', { donnees: { col: 'Opération' } }, [
          h('span', operationNom(i.operation)),
          i.outil && OUTILS_ELECTRO[i.outil]
            ? h('div.minus.tres-faible', OUTILS_ELECTRO[i.outil])
            : null
        ]),
        h('td', { donnees: { col: 'Protocole' } }, protocoleNom(i.protocole)),
        h('td', { donnees: { col: 'État' } },
          h('span.pastille.pastille--' + (etat ? etat.ton : 'neutre'), etat ? etat.nom : i.etat)),
        h('td.num', { donnees: { col: 'Crédits' } }, i.credits ? String(i.credits) : '—'),
        h('td', { donnees: { col: 'Résultat' } },
          h('span.petit', i.resultat || i.notes || '—'))
      ]);
    }))
  ]));
}

const operationNom = (cle) => (OPERATIONS_ELECTRO[cle] ? OPERATIONS_ELECTRO[cle].nom : (cle || '—'));
const protocoleNom = (cle) => (PROTOCOLES[cle] ? PROTOCOLES[cle].nom : (cle || '—'));

/* ==========================================================================
   L'HISTORIQUE — le carnet d'entretien proprement dit
   ========================================================================== */

function blocHistorique(e, v) {
  const dossiers = lit.dossiersDuVehicule(e, v.id);
  if (!dossiers.length) {
    return h('div.panneau', [
      h('div.panneau__tete', [icone('historique', { taille: 16 }), h('h2.grandit', 'Historique')]),
      h('div.panneau__corps', h('div.petit.faible.centre',
        'Ce véhicule n’est jamais passé à l’atelier.'))
    ]);
  }

  const cumul = dossiers.reduce((t, d) => t + lit.totauxDossier(e, d).ttc, 0);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('historique', { taille: 16 }),
      h('h2.grandit', 'Historique'),
      h('span.petit.faible', dossiers.length + (dossiers.length > 1 ? ' passages · ' : ' passage · ')
        + fmt.euros(cumul, { sansCentimes: true }) + ' TTC en tout')
    ]),
    h('div.panneau__corps', dossiers.map(d => passage(e, d)))
  ]);
}

function passage(e, d) {
  const t = lit.totauxDossier(e, d);
  const km = d.kmSortie || d.kmEntree;
  const travaux = (d.lignes || []).filter(l => l.libelle);

  return h('details.vehicule-passage', [
    h('summary', [
      h('span.num.gras', d.numero || '—'),
      h('span.petit.faible.num', fmt.date(d.entree || d.cree, 'court')),
      h('span.grandit.coupe', lit.titreDossier(e, d)),
      km ? h('span.etiq.num', fmt.km(km)) : null,
      pastilleEtape(d.etape),
      h('span.num.gras', fmt.euros(t.ttc))
    ]),
    h('div.vehicule-passage__corps.pile-s', [
      d.demande ? h('div.petit', [h('span.majuscule', 'Demande '), h('span.faible', d.demande)]) : null,
      travaux.length
        ? h('ul', { style: { margin: '0', paddingLeft: 'var(--e-5)' } }, travaux.map(l =>
            h('li.petit', { style: { marginBottom: '3px' } }, [
              h('span', l.libelle),
              nombre(l.qte, 1) !== 1 ? h('span.tres-faible.num', ' ×' + fmt.nb(l.qte, 2)) : null
            ])
          ))
        : h('div.petit.tres-faible', 'Aucune ligne de travaux sur ce dossier.'),
      d.travaux ? h('div.petit.faible', d.travaux) : null,
      h('div.rang.enroule', [
        h('a.bt.bt--contour.bt--s', { href: '#/dossier/' + d.id },
          [icone('ouvrir', { taille: 14 }), h('span', 'Ouvrir le dossier')]),
        d.factureId ? h('a.bt.bt--nu.bt--s', { href: '#/facture/' + d.factureId },
          [icone('facture', { taille: 14 }), h('span', 'La facture')]) : null
      ])
    ])
  ]);
}

/* ==========================================================================
   PROCHAINES ÉCHÉANCES
   Pas de contrôle technique dans le modèle : on ne l'invente pas. Le seul
   rappel qu'on sache calculer honnêtement est le kilométrage parcouru depuis
   la dernière révision retrouvée dans l'historique.
   ========================================================================== */

function blocEcheances(e, v) {
  if (!v.km) return null;
  const derniere = derniereRevision(e, v);
  if (!derniere || !derniere.km) return null;

  const parcourus = Math.max(0, v.km - derniere.km);
  const restant = KM_ENTRE_REVISIONS - parcourus;
  const part = Math.min(100, Math.round((parcourus / KM_ENTRE_REVISIONS) * 100));
  const ton = restant <= 0 ? 'danger' : (restant <= 2000 ? 'alerte' : 'ok');

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('horloge', { taille: 16 }),
      h('h2.grandit', 'Prochaine révision')
    ]),
    h('div.panneau__corps', h('div.pile-s', [
      h('div.rang.entre', [
        h('span.petit.faible', 'Depuis la dernière révision'),
        h('b.num', fmt.km(parcourus))
      ]),
      h('div.jauge.jauge--' + ton, h('i', { style: { width: part + '%' } })),
      h('div.petit', { style: { color: 'var(--' + ton + ')' } },
        restant <= 0
          ? 'Dépassé de ' + fmt.km(-restant) + ' sur un intervalle de ' + fmt.km(KM_ENTRE_REVISIONS) + '.'
          : 'Encore ' + fmt.km(restant) + ' avant ' + fmt.km(KM_ENTRE_REVISIONS) + '.'),
      h('div.minus.tres-faible',
        'Repère calculé sur « ' + tronque(derniere.titre, 40) + ' » du '
        + fmt.date(derniere.quand) + ', à ' + fmt.km(derniere.km) + '. '
        + 'L’outil ne suit pas le contrôle technique : rien n’est promis ici sur ce point.')
    ]))
  ]);
}

/** Le dernier passage dont le libellé parle d'entretien. On regarde le titre
 *  du dossier et les libellés de ses lignes : « Révision 15 000 » peut n'être
 *  écrit qu'à l'un des deux endroits. */
function derniereRevision(e, v) {
  for (const d of lit.dossiersDuVehicule(e, v.id)) {
    const texte = nu([d.titre, d.travaux]
      .concat((d.lignes || []).map(l => l.libelle))
      .filter(Boolean).join(' '));
    if (!MOTS_REVISION.some(m => texte.includes(m))) continue;
    const km = d.kmSortie || d.kmEntree;
    if (!km) continue;
    return { km, quand: d.entree || d.cree, titre: lit.titreDossier(e, d) };
  }
  return null;
}

/* ==========================================================================
   LES PHOTOS
   ========================================================================== */

function blocPhotos(e, v, refaire) {
  const photos = Array.isArray(v.photos) ? v.photos : [];

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('camera', { taille: 16 }),
      h('h2.grandit', 'Photos'),
      photos.length ? h('span.compte', String(photos.length)) : null,
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Ajouter une photo',
        onclick: () => ajouterPhoto(v, refaire)
      }, icone('plus'))
    ]),
    h('div.panneau__corps', photos.length
      ? h('div.vehicule-photos', photos.map(p =>
          h('button.vehicule-photo', {
            type: 'button',
            'aria-label': p.legende || ('Photo du ' + fmt.date(p.quand)),
            onclick: () => agrandirPhoto(v, p, refaire)
          }, [
            h('img', { src: p.donnee, alt: p.legende || '', loading: 'lazy' }),
            p.legende ? h('span.vehicule-photo__legende.coupe', p.legende) : null
          ])
        ))
      : h('div.pile-s', [
          h('div.petit.faible.centre', 'Aucune photo. Une rayure constatée à l’accueil '
            + 'évite une discussion à la restitution.'),
          h('button.bt.bt--contour.bt--plein', {
            type: 'button', onclick: () => ajouterPhoto(v, refaire)
          }, [icone('camera'), h('span', 'Prendre une photo')])
        ]))
  ]);
}

async function ajouterPhoto(v, refaire) {
  const fichiers = await choisirFichier({ accepte: 'image/*', appareilPhoto: true });
  if (!fichiers || !fichiers.length) return;

  let reduite;
  try {
    reduite = await reduireImage(fichiers[0], { maxi: 1400 });
  } catch (err) {
    message('Cette image n’a pas pu être lue.', { ton: 'danger' });
    return;
  }

  maj('Photo ajoutée au véhicule', (etat) => {
    const x = (etat.vehicules || []).find(y => y.id === v.id);
    if (!x) return;
    if (!Array.isArray(x.photos)) x.photos = [];
    x.photos.push({ id: id('pho'), donnee: reduite.donnee, quand: Date.now(), legende: '' });
    x.maj = Date.now();
  }, { cible: { type: 'vehicules', id: v.id } });

  message('Photo ajoutée (' + fmt.octets(reduite.poids) + ')', { ton: 'ok' });
  refaire();
}

function agrandirPhoto(v, photo, refaire) {
  const legende = champ({
    etiquette: 'Légende', valeur: photo.legende,
    exemple: 'Rayure aile avant droite, à l’arrivée'
  });

  const fenetre = modale({
    titre: 'Photo du ' + fmt.date(photo.quand, 'lettre'),
    taille: 'large',
    corps: h('div.pile', [
      h('img', {
        src: photo.donnee,
        alt: photo.legende || 'Photo du véhicule',
        style: { width: '100%', height: 'auto', maxHeight: '68vh', objectFit: 'contain', borderRadius: 'var(--r-m)' }
      }),
      legende.noeud
    ]),
    actions: [
      {
        texte: 'Supprimer', ton: 'danger',
        faire: async () => {
          const oui = await confirmer({
            titre: 'Supprimer cette photo ?', ok: 'Supprimer', danger: true,
            texte: photo.legende || 'Photo du ' + fmt.date(photo.quand, 'lettre')
          });
          if (!oui) return false;
          maj('Photo de véhicule supprimée', (etat) => {
            const x = (etat.vehicules || []).find(y => y.id === v.id);
            if (!x || !Array.isArray(x.photos)) return;
            const i = x.photos.findIndex(p => p.id === photo.id);
            if (i >= 0) x.photos.splice(i, 1);
            x.maj = Date.now();
          }, { cible: { type: 'vehicules', id: v.id } });
          refaire();
        }
      },
      { texte: 'Fermer', ton: 'contour' },
      {
        texte: 'Enregistrer la légende', ton: 'fort',
        faire: () => {
          maj('Légende de photo modifiée', (etat) => {
            const x = (etat.vehicules || []).find(y => y.id === v.id);
            if (!x || !Array.isArray(x.photos)) return;
            const p = x.photos.find(o => o.id === photo.id);
            if (p) p.legende = legende.lire();
            x.maj = Date.now();
          }, { cible: { type: 'vehicules', id: v.id } });
          refaire();
        }
      }
    ]
  });
  return fenetre;
}

/* ==========================================================================
   LES NOTES
   ========================================================================== */

function blocNotes(e, v) {
  /* Enregistrement à la sortie du champ, sans bouton : une note qu'on oublie
     de valider est une note perdue. On ne repeint pas l'écran derrière, sinon
     le curseur saute au milieu d'une phrase. */
  const note = champ({
    type: 'zone', lignes: 5, valeur: v.notes,
    exemple: 'Ce qu’il faut savoir avant d’y toucher : écrous grippés, batterie '
      + 'faible, client pressé, historique douteux…',
    surChangement: (texte) => {
      if (texte === (v.notes || '')) return;
      change('vehicules', v.id, { notes: texte }, 'Note de véhicule modifiée');
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
   PETITS CALCULS
   ========================================================================== */

/** La date de première mise en circulation, ou à défaut le 1er janvier de
 *  l'année si la fiche ne porte que celle-ci : faux de six mois au pire, et
 *  bien assez juste pour une moyenne annuelle. */
function dateMec(v) {
  if (v.dateMec) return v.dateMec;
  const annee = nombre(v.annee, 0);
  if (annee > 1900 && annee < 2200) return new Date(annee, 0, 1).getTime();
  return null;
}

function ageAnnees(v) {
  const t = dateMec(v);
  if (!t) return null;
  const ans = (Date.now() - t) / (365.25 * JOUR);
  return ans > 0.08 ? ans : null;
}

function moyenneKmParAn(v) {
  const ans = ageAnnees(v);
  if (!ans || ans < 0.5 || !v.km) return null;
  return Math.round(v.km / ans);
}
