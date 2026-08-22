/* ==========================================================================
   YATECH — écran « Aujourd'hui »
   --------------------------------------------------------------------------
   Le premier écran du matin. Il ne montre pas des statistiques : il montre ce
   qu'il y a à faire, dans l'ordre où ça presse, avec de quoi y aller d'un
   geste. Un tableau de bord qui se contemple ne sert à rien ; celui-ci se
   vide au fil de la journée.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, confirmer, message } from '../core/ui.js';
import { maj } from '../core/store.js';
import * as fmt from '../core/fmt.js';
import { jour0, telJoli, nombre, plaqueJolie } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import {
  enTete, indic, plaque, champ, pastilleEtape, menuEnvoi
} from '../ui/widgets.js';
import { nouveauDossierModale } from './dossier-nouveau.js';

export function peindre(ctx) {
  const e = ctx.etat;
  const moi = ctx.moi;
  const racine = h('div.pile');

  function refaire() { poser(racine, contenu()); }

  function contenu() {
    return [
      salutation(e, moi),
      raccourcis(e, refaire),
      bandeAlertes(e),
      indicateurs(e),
      h('div.deux-colonnes', [
        h('div.pile', [
          maJournee(e, moi, refaire),
          aRendre(e),
          enAttente(e)
        ]),
        h('div.pile', [
          appels(e, refaire),
          penseBetes(e, moi, refaire)
        ])
      ])
    ];
  }

  poser(racine, contenu());
  return racine;
}

/* ==========================================================================
   L'EN-TÊTE
   ========================================================================== */

function salutation(e, moi) {
  const heure = new Date().getHours();
  const bonjour = heure < 12 ? 'Bonjour' : (heure < 18 ? 'Bon après-midi' : 'Bonsoir');
  return enTete({
    titre: bonjour + (moi && moi.prenom ? ', ' + moi.prenom : ''),
    sous: fmt.date(Date.now(), 'complet')
  });
}

/* ==========================================================================
   LES RACCOURCIS — ce qu'on fait dix fois par jour
   ========================================================================== */

function raccourcis(e, refaire) {
  const bt = (texte, ico, action, fort) => h('button.bt' + (fort ? '.bt--fort' : '.bt--contour'), {
    type: 'button', onclick: action
  }, [icone(ico), h('span', texte)]);

  return h('div.rang.enroule', [
    bt('Nouveau dossier', 'plus', () => nouveauDossierModale(e, refaire), true),
    bt('Appel reçu', 'telephone', () => modaleAppel(e, refaire)),
    bt('Pense-bête', 'epingle', () => modaleTache(e, refaire)),
    h('a.bt.bt--contour', { href: '#/planning' }, [icone('planning'), h('span', 'Planning')])
  ]);
}

/* ==========================================================================
   CE QUI PRESSE
   ========================================================================== */

function bandeAlertes(e) {
  const liste = lit.alertes(e).slice(0, 5);
  if (!liste.length) {
    return h('div.bandeau.bandeau--ok', [
      icone('cocheRonde'),
      h('span', 'Rien ne traîne : pas de devis en souffrance, pas d’impayé, pas de véhicule oublié.')
    ]);
  }
  return h('div.pile-s', liste.map(a =>
    h('a.carte.rang', { href: '#' + a.vers }, [
      h('span', {
        style: {
          width: '30px', height: '30px', borderRadius: 'var(--r-m)', flex: 'none',
          display: 'grid', placeItems: 'center',
          background: 'var(--' + a.ton + '-voile)', color: 'var(--' + a.ton + ')'
        }
      }, icone(a.icone, { taille: 16 })),
      h('div.grandit.coupe', [
        h('div.gras.coupe', a.titre),
        a.detail ? h('div.petit.faible.coupe', a.detail) : null
      ]),
      icone('droite', { taille: 15, classe: 'tres-faible' })
    ])
  ));
}

/* ==========================================================================
   LES CHIFFRES
   ========================================================================== */

function indicateurs(e) {
  const ouverts = lit.dossiersOuverts(e);
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const ca = lit.chiffreAffaires(e, debutMois);
  const du = lit.encours(e);
  const solde = lit.soldeCredits(e);
  const libres = lit.placesLibres(e).length;

  return h('div.grille-indics', [
    indic({
      nom: 'À l’atelier', valeur: ouverts.length, vers: '/atelier',
      detail: ouverts.filter(d => d.priorite === 'urgent').length
        ? ouverts.filter(d => d.priorite === 'urgent').length + ' urgent(s)'
        : libres + ' places libres'
    }),
    indic({
      nom: 'Facturé ce mois', valeur: fmt.euros(ca.ht, { sansCentimes: true }),
      detail: ca.nb + (ca.nb > 1 ? ' factures' : ' facture'), vers: '/factures'
    }),
    indic({
      nom: 'Reste à encaisser', valeur: fmt.euros(du.total, { sansCentimes: true }),
      ton: du.retard > 0 ? 'danger' : null,
      detail: du.retard > 0 ? fmt.euros(du.retard, { sansCentimes: true }) + ' en retard' : 'rien en retard',
      vers: '/factures'
    }),
    indic({
      nom: 'Crédits Autotuner', valeur: solde,
      ton: solde <= nombre(e.reglages.creditsAlerte, 5) ? 'alerte' : null,
      detail: 'consommés ce mois : ' + lit.creditsConsommes(e, debutMois),
      vers: '/electronique'
    })
  ]);
}

/* ==========================================================================
   MA JOURNÉE
   ========================================================================== */

function maJournee(e, moi, refaire) {
  const mien = moi ? lit.creneauxDuJour(e, Date.now(), moi.id) : lit.creneauxDuJour(e, Date.now());
  const maintenant = Date.now();

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('planning', { taille: 16 }),
      h('h2.grandit', 'Ma journée'),
      h('a.bt.bt--nu.bt--s', { href: '#/planning' }, 'Le planning')
    ]),
    mien.length
      ? h('div.liste', mien.map(c => {
          const d = c.dossierId ? lit.dossier(e, c.dossierId) : null;
          const v = d ? lit.vehicule(e, d.vehiculeId) : null;
          const passe = c.fin < maintenant;
          const encours = c.debut <= maintenant && c.fin > maintenant;
          /* Une div plutôt qu'un bouton : la ligne contient déjà un bouton
             « fait », et un bouton dans un bouton n'est ni valide ni navigable
             au clavier. */
          return h('div.liste__ligne', {
            role: 'link',
            tabindex: 0,
            style: encours ? { background: 'var(--accent-voile)' } : null,
            onclick: () => { location.hash = d ? '#/dossier/' + d.id : '#/planning'; },
            onkeydown: (ev) => {
              if (ev.key !== 'Enter' && ev.key !== ' ') return;
              ev.preventDefault();
              location.hash = d ? '#/dossier/' + d.id : '#/planning';
            }
          }, [
            h('div', { style: { minWidth: '52px' } }, [
              h('div.gras.num', fmt.heure(c.debut)),
              h('div.minus.tres-faible', fmt.duree(c.fin - c.debut))
            ]),
            h('div.grandit.coupe', {
              style: passe && c.fait ? { opacity: '.55', textDecoration: 'line-through' } : null
            }, [
              h('div.coupe', c.titre || (d ? lit.titreDossier(e, d) : 'Créneau')),
              v ? h('div.petit.faible.coupe', v.immat) : null
            ]),
            encours ? h('span.pastille.pastille--accent', 'en cours') : null,
            h('button.bt.bt--nu.bt--icone.bt--s', {
              type: 'button',
              'aria-label': c.fait ? 'Rouvrir' : 'Marquer fait',
              onclick: (ev) => {
                ev.stopPropagation();
                maj(c.fait ? 'Créneau rouvert' : 'Créneau terminé', (etat) => {
                  const x = etat.creneaux.find(y => y.id === c.id);
                  if (x) x.fait = !x.fait;
                });
                refaire();
              }
            }, icone(c.fait ? 'cocheRonde' : 'coche'))
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre',
          'Rien de posé au planning pour aujourd’hui.'))
  ]);
}

/* ==========================================================================
   LES VÉHICULES PRÊTS — le client attend qu'on l'appelle
   ========================================================================== */

function aRendre(e) {
  const prets = lit.dossiersParEtape(e, 'pret');
  if (!prets.length) return null;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('cocheRonde', { taille: 16 }),
      h('h2.grandit', 'Prêts à rendre'),
      h('span.compte.compte--accent', String(prets.length))
    ]),
    h('div.liste', prets.map(d => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      const t = lit.totauxDossier(e, d);
      return h('div.liste__ligne.liste__ligne--muette', [
        h('div.grandit.coupe', {
          onclick: () => { location.hash = '#/dossier/' + d.id; },
          style: { cursor: 'pointer' }
        }, [
          h('div.rang-s', [v ? plaque(v.immat) : null, h('span.gras.coupe', lit.nomClient(c))]),
          h('div.petit.faible.coupe', lit.titreDossier(e, d) + ' · ' + fmt.euros(t.ttc) + ' TTC')
        ]),
        c && (c.tel || c.email) ? h('button.bt.bt--contour.bt--s', {
          type: 'button',
          onclick: (ev) => menuEnvoi(ev.currentTarget, {
            tel: c.tel, email: c.email,
            sujet: 'Votre véhicule est prêt',
            texte: messagePret(e, d, c, v, t)
          })
        }, [icone('telephone', { taille: 14 }), h('span', 'Prévenir')]) : null
      ]);
    }))
  ]);
}

function messagePret(e, d, c, v, t) {
  return (e.reglages.messagePret || '')
    .replace('{prenom}', (c && c.prenom) || lit.nomClient(c))
    .replace('{vehicule}', v ? lit.nomVehicule(v) : 'votre véhicule')
    .replace('{immat}', v ? plaqueJolie(v.immat) : '')
    .replace('{montant}', fmt.euros(t.ttc))
    .replace('{garage}', e.reglages.raisonSociale || e.reglages.nomOutil || '');
}

/* ==========================================================================
   CE QUI ATTEND QUELQU'UN D'AUTRE
   ========================================================================== */

function enAttente(e) {
  const liste = lit.dossiersOuverts(e)
    .filter(d => d.etape === 'accord' || d.etape === 'piece')
    .sort(lit.triDossiers);
  if (!liste.length) return null;

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('sablier', { taille: 16 }),
      h('h2.grandit', 'En attente'),
      h('span.petit.faible', 'accord client ou pièce')
    ]),
    h('div.liste', liste.map(d => {
      const v = lit.vehicule(e, d.vehiculeId);
      const jours = lit.joursDansAtelier(d);
      return h('a.liste__ligne', { href: '#/dossier/' + d.id }, [
        pastilleEtape(d.etape),
        h('div.grandit.coupe', [
          h('div.coupe', lit.titreDossier(e, d)),
          h('div.petit.faible.coupe', [v ? plaqueJolie(v.immat) : '', d.place ? 'place ' + d.place : '']
            .filter(Boolean).join(' · '))
        ]),
        h('span.minus.tres-faible', jours + ' j')
      ]);
    }))
  ]);
}

/* ==========================================================================
   LES APPELS
   ========================================================================== */

function appels(e, refaire) {
  const liste = (e.appels || []).filter(a => !a.traite)
    .sort((a, b) => b.quand - a.quand).slice(0, 8);

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('telephone', { taille: 16 }),
      h('h2.grandit', 'Appels'),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Nouvel appel', onclick: () => modaleAppel(e, refaire)
      }, icone('plus'))
    ]),
    liste.length
      ? h('div.liste', liste.map(a => {
          const c = a.clientId ? lit.client(e, a.clientId) : null;
          return h('div.liste__ligne.liste__ligne--muette', [
            a.aRappeler ? h('span.pastille.pastille--alerte.pastille--sans-point', 'rappeler') : null,
            h('div.grandit.coupe', [
              h('div.gras.coupe', a.nom || (c ? lit.nomClient(c) : telJoli(a.tel))),
              h('div.petit.faible.coupe-2', a.objet || ''),
              h('div.minus.tres-faible', fmt.quand(a.quand))
            ]),
            h('div.pile-s', [
              a.tel ? h('a.bt.bt--nu.bt--icone.bt--s', {
                href: 'tel:' + a.tel, 'aria-label': 'Appeler'
              }, icone('telephone')) : null,
              h('button.bt.bt--nu.bt--icone.bt--s', {
                type: 'button', 'aria-label': 'Traité',
                onclick: () => {
                  maj('Appel traité', (etat) => {
                    const x = etat.appels.find(y => y.id === a.id);
                    if (x) { x.traite = true; x.aRappeler = false; }
                  });
                  refaire();
                }
              }, icone('coche'))
            ])
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre', 'Aucun appel en attente.'))
  ]);
}

function modaleAppel(e, refaire) {
  const tel = champ({ etiquette: 'Numéro', type: 'tel', exemple: '06 12 34 56 78' });
  const nom = champ({ etiquette: 'Nom', exemple: 'Qui appelle ?' });
  const objet = champ({ etiquette: 'Objet', type: 'zone', lignes: 3, exemple: 'Ce qu’il ou elle demande' });
  const rappeler = champ({ type: 'coche', etiquette: 'À rappeler' });
  const trouve = h('div.pile-s');
  let clientId = null;

  /* On reconnaît le client pendant qu'il est encore au téléphone : quelques
     chiffres du numéro suffisent à remonter sa fiche et ses véhicules. */
  tel.entree.addEventListener('input', () => {
    const q = tel.lire().replace(/\D/g, '');
    if (q.length < 4) { poser(trouve, []); clientId = null; return; }
    const candidats = (e.clients || []).filter(c => !c.archive
      && [c.tel, c.tel2].filter(Boolean).some(t => String(t).replace(/\D/g, '').includes(q)))
      .slice(0, 4);
    poser(trouve, candidats.map(c => {
      const vs = lit.vehiculesDe(e, c.id);
      return h('button.carte.rang', {
        type: 'button',
        onclick: () => {
          clientId = c.id;
          nom.ecrire(lit.nomClient(c));
          poser(trouve, h('div.bandeau.bandeau--ok', [
            icone('cocheRonde'), h('span', 'Fiche reconnue : ' + lit.nomClient(c))
          ]));
        }
      }, [
        h('div.grandit.coupe', [
          h('div.gras.coupe', lit.nomClient(c)),
          h('div.petit.faible.coupe', vs.map(v => v.immat).join(' · ') || 'aucun véhicule')
        ]),
        icone('droite', { taille: 14 })
      ]);
    }));
  });

  modale({
    titre: 'Appel reçu',
    corps: h('div.pile', [tel.noeud, trouve, nom.noeud, objet.noeud, rappeler.noeud]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Enregistrer', ton: 'fort',
        faire: () => {
          if (!tel.lire() && !nom.lire()) { tel.erreur('Un numéro ou un nom, au moins.'); return false; }
          act.enregistrerAppel({
            tel: tel.lire(), nom: nom.lire(), objet: objet.lire(),
            aRappeler: rappeler.lire(), clientId
          });
          message('Appel enregistré', { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}

/* ==========================================================================
   LES PENSE-BÊTES
   ========================================================================== */

function penseBetes(e, moi, refaire) {
  const miennes = (e.taches || []).filter(t => !t.faite
    && (!t.pour || (moi && t.pour === moi.id)))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.echeance || Infinity) - (b.echeance || Infinity));

  return h('div.panneau', [
    h('div.panneau__tete', [
      icone('epingle', { taille: 16 }),
      h('h2.grandit', 'Pense-bêtes'),
      h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Nouveau', onclick: () => modaleTache(e, refaire)
      }, icone('plus'))
    ]),
    miennes.length
      ? h('div.liste', miennes.slice(0, 10).map(t => {
          const par = t.par ? lit.utilisateur(e, t.par) : null;
          const enRetard = t.echeance && t.echeance < jour0();
          return h('div.liste__ligne.liste__ligne--muette', [
            h('input', {
              type: 'checkbox',
              style: { accentColor: 'var(--accent)', flex: 'none' },
              'aria-label': 'Fait',
              onchange: () => { act.cocherTache(t.id, true); refaire(); }
            }),
            h('div.grandit', [
              h('div.coupe-2', t.texte),
              h('div.minus.tres-faible', [
                par ? 'de ' + par.prenom : '',
                t.echeance ? (enRetard ? '⚠ ' : '') + fmt.quand(t.echeance, { avecHeure: false }) : ''
              ].filter(Boolean).join(' · '))
            ]),
            t.urgent ? h('span.pastille.pastille--danger.pastille--sans-point', '!') : null,
            h('button.bt.bt--nu.bt--icone.bt--s', {
              type: 'button', 'aria-label': 'Supprimer',
              onclick: async () => {
                if (!await confirmer({ titre: 'Supprimer ce pense-bête ?', texte: t.texte, danger: true, ok: 'Supprimer' })) return;
                maj('Pense-bête supprimé', (etat) => {
                  const i = etat.taches.findIndex(x => x.id === t.id);
                  if (i >= 0) etat.taches.splice(i, 1);
                });
                refaire();
              }
            }, icone('croix'))
          ]);
        }))
      : h('div.panneau__corps', h('div.petit.faible.centre', 'Rien à faire de noté.'))
  ]);
}

function modaleTache(e, refaire) {
  const texte = champ({ etiquette: 'Quoi ?', type: 'zone', lignes: 3, autofocus: true });
  const pour = champ({
    etiquette: 'Pour qui',
    type: 'liste',
    options: [{ valeur: '', texte: 'Tout le monde' }]
      .concat((e.utilisateurs || []).filter(u => u.actif)
        .map(u => ({ valeur: u.id, texte: lit.nomUtilisateur(u) })))
  });
  const echeance = champ({ etiquette: 'Pour quand (facultatif)', type: 'date' });
  const urgent = champ({ type: 'coche', etiquette: 'Urgent' });

  modale({
    titre: 'Nouveau pense-bête',
    corps: h('div.pile', [texte.noeud, pour.noeud, echeance.noeud, urgent.noeud]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Poser', ton: 'fort',
        faire: () => {
          if (!texte.lire()) { texte.erreur('Écrivez ce qu’il y a à faire.'); return false; }
          act.poserTache({
            texte: texte.lire(),
            pour: pour.lire() || null,
            echeance: echeance.lire(),
            urgent: urgent.lire()
          });
          message('Pense-bête posé', { ton: 'ok' });
          refaire();
        }
      }
    ]
  });
}
