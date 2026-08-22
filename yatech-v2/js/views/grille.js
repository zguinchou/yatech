/* ==========================================================================
   YATECH — la grille tarifaire reçue par un confrère
   --------------------------------------------------------------------------
   Cette page ne lit RIEN dans l'appareil : tout ce qu'elle affiche voyage dans
   l'adresse. Elle s'ouvre donc sur le téléphone du confrère, sans réseau, sans
   compte, et sans qu'un octet parte chez l'hébergeur — ce qui suit le # d'une
   adresse n'est jamais envoyé au serveur.

   Elle dit deux choses sans détour : de quand date la grille, et que les prix
   sont hors taxes. Un tarif dont on ne sait pas s'il est à jour ne sert à rien.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { message } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { attend, nu, telNu, nombre } from '../core/util.js';
import { copier } from '../core/fichiers.js';
import { deballer, compteGrille } from '../domain/grille.js';

export function peindre(ctx) {
  const racine = h('div.portail');
  const cadre = h('div.portail__cadre', patienter());
  racine.appendChild(cadre);

  /* Le déballage est asynchrone (décompression) : on peint l'attente d'abord,
     et on remplace dès qu'on sait. */
  const charge = ctx.params.charge || (ctx.params.reste || '');
  deballer(charge).then((g) => {
    poser(cadre, g ? contenu(g) : illisible());
    if (g) document.title = 'Tarifs — ' + (g.g && g.g.n ? g.g.n : 'Garage');
  }).catch(() => poser(cadre, illisible()));

  return racine;
}

function patienter() {
  return h('div.vide', [
    icone('tarifs', { taille: 34 }),
    h('h3', 'Ouverture de la grille…')
  ]);
}

function illisible() {
  return h('div.vide', [
    icone('alerte', { taille: 38 }),
    h('h3', 'Ce lien ne peut pas être lu'),
    h('p', 'Il a peut-être été coupé en chemin — les messageries tronquent parfois '
      + 'les adresses longues. Demandez au garage de vous le renvoyer, de préférence '
      + 'par e-mail où rien n’est coupé.')
  ]);
}

/* ==========================================================================
   LA PAGE
   ========================================================================== */

function contenu(g) {
  const garage = g.g || {};
  let requete = '';
  const zone = h('div.pile');

  function peindreListe() {
    const familles = (g.f || [])
      .map(([nom, lignes]) => [nom, lignes.filter(l => !requete
        || nu([l[0], l[1], nom].join(' ')).includes(nu(requete)))])
      .filter(([, lignes]) => lignes.length);

    if (!familles.length) {
      poser(zone, h('div.vide', [
        icone('chercher', { taille: 32 }),
        h('h3', 'Aucune prestation ne correspond'),
        h('p', 'Essayez un mot plus court, ou effacez la recherche.')
      ]));
      return;
    }

    poser(zone, familles.map(([nom, lignes]) => h('div.panneau', [
      h('div.panneau__tete', [
        h('h2.grandit', nom),
        h('span.compte', String(lignes.length))
      ]),
      h('div.liste', lignes.map(([code, libelle, prix, temps]) =>
        h('div.liste__ligne.liste__ligne--muette', [
          h('div.grandit', [
            h('div', libelle),
            h('div.minus.tres-faible', [
              code || '',
              temps ? fmt.heuresMO(temps) : ''
            ].filter(Boolean).join(' · '))
          ]),
          h('div.droite', [
            h('div.gras.num', fmt.euros(prix)),
            h('div.minus.tres-faible', 'HT')
          ])
        ])
      ))
    ])));
  }

  peindreListe();

  return [
    /* --- qui envoie ------------------------------------------------------ */
    h('div.portail__tete', [
      h('img', { src: 'assets/icone.svg', alt: '', width: 34, height: 34 }),
      h('div.grandit', [
        h('div.gras', garage.n || 'Garage'),
        h('div.petit.faible', [garage.a, [garage.c, garage.vi].filter(Boolean).join(' ')]
          .filter(Boolean).join(' · '))
      ]),
      garage.t ? h('a.bt.bt--fort.bt--s', { href: 'tel:' + telNu(garage.t) },
        [icone('telephone', { taille: 14 }), h('span', 'Appeler')]) : null
    ]),

    h('div.tete-ecran', [
      h('div.grandit', [
        h('h1', 'Vos tarifs'),
        g.c ? h('div.tete-ecran__sous', g.c) : null
      ])
    ]),

    /* --- ce qui vous est appliqué ----------------------------------------- */
    h('div.grille-indics', [
      h('div.indic', [
        h('div.indic__nom', 'Votre taux horaire'),
        h('div.indic__val', { style: { color: 'var(--accent)' } }, fmt.euros(g.th)),
        h('div.indic__pied', 'de main-d’œuvre, hors taxes')
      ]),
      nombre(g.rem, 0) ? h('div.indic', [
        h('div.indic__nom', 'Remise confrère'),
        h('div.indic__val', g.rem + ' %'),
        h('div.indic__pied', 'déjà comprise dans les prix ci-dessous')
      ]) : null,
      h('div.indic', [
        h('div.indic__nom', 'Prestations'),
        h('div.indic__val', String(compteGrille(g))),
        h('div.indic__pied', (g.f || []).length + ' familles')
      ])
    ]),

    /* --- l'honnêteté sur la fraîcheur -------------------------------------- */
    h('div.bandeau', [
      icone('info'),
      h('div', [
        h('b', 'Grille arrêtée au ' + fmt.date(g.d, 'lettre') + '.'),
        h('div', 'Elle est enregistrée dans ce lien : elle s’ouvre sans réseau, mais elle '
          + 'ne se met pas à jour toute seule. Après un changement de tarif, le garage vous '
          + 'en enverra un nouveau. En cas de doute, un appel tranche.')
      ])
    ]),

    /* --- la recherche ------------------------------------------------------ */
    h('div.recherche', [
      icone('chercher'),
      h('input.saisie', {
        type: 'search',
        placeholder: 'Chercher une prestation…',
        autocomplete: 'off',
        oninput: attend(function () { requete = this.value.trim(); peindreListe(); }, 180)
      })
    ]),

    zone,

    /* --- de quoi la garder sous la main -------------------------------------- */
    h('div.rang.enroule', { style: { justifyContent: 'center', marginTop: 'var(--e-4)' } }, [
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: async () => {
          const ok = await copier(location.href);
          message(ok ? 'Lien copié' : 'Copie impossible', { ton: ok ? 'ok' : 'danger' });
        }
      }, [icone('copier'), h('span', 'Copier le lien')]),
      h('button.bt.bt--contour', {
        type: 'button', onclick: () => window.print()
      }, [icone('imprimer'), h('span', 'Imprimer')])
    ]),

    h('p.petit.tres-faible.centre', { style: { marginTop: 'var(--e-4)' } },
      'Tous les montants sont hors taxes'
      + (nombre(g.tva, 0) ? '. La TVA de ' + fmt.nb(g.tva, 1) + ' % s’ajoute sur la facture.' : '.')
      + ' Ajoutez cette page à votre écran d’accueil pour la retrouver sans réseau.')
  ];
}
