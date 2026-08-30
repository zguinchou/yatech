/* ==========================================================================
   YATECH — l'espace du confrère
   --------------------------------------------------------------------------
   Cette page ne lit RIEN dans l'appareil : tout ce qu'elle affiche voyage dans
   l'adresse. Elle s'ouvre donc sur le téléphone du confrère, sans réseau, sans
   compte, et sans qu'un octet parte chez l'hébergeur — ce qui suit le # d'une
   adresse n'est jamais envoyé au serveur.

   Elle dit deux choses sans détour : de quand date la grille, et que les prix
   sont hors taxes. Un tarif dont on ne sait pas s'il est à jour ne sert à rien.

   Elle fait deux choses : montrer les tarifs, et préparer une demande de
   rendez-vous. Le confrère coche ce qu'il veut, choisit un jour, et la page
   fabrique un message à envoyer d'un geste — avec un code que le garage colle
   pour créer la demande sans rien retaper. Le message reste lisible sans le
   code : personne n'est prisonnier du raccourci.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { message } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { attend, nu, telNu, nombre, jour0, plusJours, isoJour, minutesEnHeure,
  heureEnMinutes, cts } from '../core/util.js';
import { copier } from '../core/fichiers.js';
import { deballer, compteGrille } from '../domain/grille.js';
import { emballerDemande, messageDemande } from '../domain/demandePro.js';

export function peindre(ctx) {
  const racine = h('div.portail');
  const cadre = h('div.portail__cadre', patienter());
  racine.appendChild(cadre);

  /* Le déballage est asynchrone (décompression) : on peint l'attente d'abord,
     et on remplace dès qu'on sait. */
  const charge = ctx.params.charge || (ctx.params.reste || '');
  deballer(charge).then((g) => {
    poser(cadre, g ? contenu(g) : illisible());
    if (g) document.title = 'Espace pro — ' + (g.g && g.g.n ? g.g.n : 'Garage');
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
  let onglet = 'tarifs';
  const zone = h('div.pile');
  const zoneOnglet = h('div');

  /* Ce que le confrère a coché. La clé est le code, à défaut le libellé :
     un catalogue sans codes reste utilisable. */
  const panier = new Map();
  const cle = (code, libelle) => code || libelle;

  function basculer(code, libelle, prix) {
    const k = cle(code, libelle);
    if (panier.has(k)) panier.delete(k);
    else panier.set(k, { code, libelle, prix });
    peindreListe();
    majBarre();
  }

  const totalPanier = () =>
    cts(Array.from(panier.values()).reduce((n, x) => n + nombre(x.prix, 0), 0));

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
      h('div.liste', lignes.map(([code, libelle, prix, temps, horsRoute]) => {
        const pris = panier.has(cle(code, libelle));
        return h('div.liste__ligne' + (pris ? '' : '.liste__ligne--muette'),
          pris ? { style: { background: 'var(--accent-voile)' } } : null, [
          h('div.grandit', [
            h('div.rang-s.enroule', [
              h('span', libelle),
              horsRoute
                ? h('span.pastille.pastille--alerte.pastille--sans-point', 'hors route')
                : null
            ]),
            h('div.minus.tres-faible', [
              code || '',
              temps ? fmt.heuresMO(temps) : ''
            ].filter(Boolean).join(' · '))
          ]),
          h('div.droite', [
            h('div.gras.num', fmt.euros(prix)),
            h('div.minus.tres-faible', 'HT')
          ]),
          /* Cocher ici, c'est préparer sa demande : on ne fait pas remplir un
             formulaire à quelqu'un qui a le tarif sous les yeux. */
          h('button.bt.bt--s' + (pris ? '.bt--fort' : '.bt--contour'), {
            type: 'button',
            'aria-pressed': pris ? 'true' : 'false',
            'aria-label': (pris ? 'Retirer ' : 'Ajouter ') + libelle,
            onclick: () => basculer(code, libelle, prix)
          }, pris ? icone('coche', { taille: 15 }) : icone('plus', { taille: 15 }))
        ]);
      }))
    ])));
  }

  /* ==========================================================================
     LA DEMANDE DE RENDEZ-VOUS
     ========================================================================== */

  const chVehicule = h('input.saisie', { placeholder: 'Golf VII 2.0 TDI 150' });
  const chImmat = h('input.saisie', {
    placeholder: 'AB-123-CD', autocapitalize: 'characters', spellcheck: false
  });
  const chJour = h('input.saisie', { type: 'date', value: isoJour(prochainJour(g)) });
  const chHeure = h('input.saisie', { type: 'time', step: 900, value: '09:00' });
  const chTel = h('input.saisie', { type: 'tel', placeholder: 'Votre numéro' });
  const chTexte = h('textarea.saisie', {
    rows: 4,
    placeholder: 'Le défaut, ce que vous avez déjà fait, ce que le client demande…'
  });

  const zoneChoix = h('div.pile-s');
  const zoneEnvoi = h('div.pile-s');

  function peindreChoix() {
    const l = Array.from(panier.values());
    poser(zoneChoix, l.length
      ? [
          h('div.liste', l.map(x => h('div.liste__ligne.liste__ligne--muette', [
            h('span.grandit.coupe', x.libelle),
            h('span.num.gras', fmt.euros(x.prix)),
            h('button.bt.bt--nu.bt--icone.bt--s', {
              type: 'button', 'aria-label': 'Retirer ' + x.libelle,
              onclick: () => { panier.delete(cle(x.code, x.libelle)); peindreListe(); peindreChoix(); majBarre(); }
            }, icone('croix'))
          ]))),
          h('div.rang', [
            h('span.grandit.gras', 'Total indicatif'),
            h('span.num.gras', fmt.euros(totalPanier()) + ' HT')
          ])
        ]
      : h('div.bandeau', [
          icone('info'),
          h('span', 'Rien de coché. Revenez à « Vos tarifs » et touchez le + '
            + 'devant ce que vous voulez : le prix part avec la demande, et personne '
            + 'ne le retape.')
        ]));
  }

  /** Le message et le code, refaits à chaque changement. */
  async function preparerEnvoi() {
    const l = Array.from(panier.values());
    const jour = chJour.value ? new Date(chJour.value + 'T00:00:00').getTime() : 0;
    const heure = heureEnMinutes(chHeure.value);
    const brut = {
      clientId: g.ci || '', confrere: g.c || '',
      vehicule: chVehicule.value.trim(), immat: chImmat.value.trim(),
      jour, heure, tel: chTel.value.trim(), texte: chTexte.value.trim(),
      prestations: l.map(x => ({ code: x.code, libelle: x.libelle, prix: x.prix }))
    };
    const code = await emballerDemande(brut);
    const lisible = messageDemande(Object.assign({}, brut, {
      jourTexte: jour ? fmt.date(jour, 'lettre') + (heure ? ', ' + minutesEnHeure(heure) : '') : '',
      total: l.length ? fmt.euros(totalPanier()) + ' HT' : '',
      prestations: l.map(x => ({ libelle: x.libelle, prix: fmt.euros(x.prix) }))
    }), code);
    return { lisible, code };
  }

  function manque() {
    if (!chVehicule.value.trim()) return 'Dites-nous au moins quel véhicule.';
    if (!chTexte.value.trim() && !panier.size) {
      return 'Cochez une prestation, ou expliquez ce qu’il faut faire.';
    }
    return null;
  }

  function peindreEnvoi() {
    poser(zoneEnvoi, [
      h('div.rang.enroule', [
        garage.t ? h('a.bt.bt--fort.grandit', {
          href: '#', onclick: async (ev) => {
            ev.preventDefault();
            const quoi = manque();
            if (quoi) { message(quoi, { ton: 'alerte' }); return; }
            const { lisible } = await preparerEnvoi();
            location.href = 'https://wa.me/' + telNu(garage.t).replace('+', '')
              + '?text=' + encodeURIComponent(lisible);
          }
        }, [icone('partage'), h('span', 'Envoyer par WhatsApp')]) : null,
        garage.t ? h('a.bt.bt--contour', {
          href: '#', onclick: async (ev) => {
            ev.preventDefault();
            const quoi = manque();
            if (quoi) { message(quoi, { ton: 'alerte' }); return; }
            const { lisible } = await preparerEnvoi();
            location.href = 'sms:' + telNu(garage.t) + '?body=' + encodeURIComponent(lisible);
          }
        }, [icone('telephone'), h('span', 'SMS')]) : null,
        garage.e ? h('a.bt.bt--contour', {
          href: '#', onclick: async (ev) => {
            ev.preventDefault();
            const quoi = manque();
            if (quoi) { message(quoi, { ton: 'alerte' }); return; }
            const { lisible } = await preparerEnvoi();
            location.href = 'mailto:' + encodeURIComponent(garage.e)
              + '?subject=' + encodeURIComponent('Demande de rendez-vous — ' + (g.c || ''))
              + '&body=' + encodeURIComponent(lisible);
          }
        }, [icone('courriel'), h('span', 'E-mail')]) : null,
        h('button.bt.bt--contour', {
          type: 'button',
          onclick: async () => {
            const quoi = manque();
            if (quoi) { message(quoi, { ton: 'alerte' }); return; }
            const { lisible } = await preparerEnvoi();
            const ok = await copier(lisible);
            message(ok ? 'Demande copiée : collez-la où vous voulez'
              : 'Copie impossible sur cet appareil', { ton: ok ? 'ok' : 'danger' });
          }
        }, [icone('copier'), h('span', 'Copier')])
      ]),
      h('p.petit.tres-faible',
        'Le message part de VOTRE téléphone : cette page n’envoie rien toute seule '
        + 'et ne garde rien. Tant que le garage n’a pas répondu, ce n’est pas un '
        + 'rendez-vous — c’est une demande.')
    ]);
  }

  function ongletDemande() {
    peindreChoix();
    peindreEnvoi();
    return h('div.pile', [
      h('div.panneau', [
        h('div.panneau__tete', [icone('planning', { taille: 16 }), h('h2.grandit', 'Le véhicule')]),
        h('div.panneau__corps.pile-s', [
          h('div.champ', [h('label', 'Véhicule'), chVehicule]),
          h('div.champ', [h('label', 'Immatriculation'), chImmat]),
          h('div.champ', [h('label', 'Votre téléphone'), chTel])
        ])
      ]),
      h('div.panneau', [
        h('div.panneau__tete', [icone('horloge', { taille: 16 }), h('h2.grandit', 'Quand')]),
        h('div.panneau__corps.pile-s', [
          h('div.rang.enroule', [
            h('div.champ.grandit', [h('label', 'Jour souhaité'), chJour]),
            h('div.champ', [h('label', 'Vers'), chHeure])
          ]),
          h('p.petit.faible', 'C’est un souhait, pas une réservation : le garage '
            + 'confirme, décale ou vous rappelle.')
        ])
      ]),
      h('div.panneau', [
        h('div.panneau__tete', [
          icone('tarifs', { taille: 16 }),
          h('h2.grandit', 'Ce que vous demandez'),
          panier.size ? h('span.compte.compte--accent', String(panier.size)) : null
        ]),
        h('div.panneau__corps.pile-s', [zoneChoix])
      ]),
      h('div.panneau', [
        h('div.panneau__tete', [icone('document', { taille: 16 }), h('h2.grandit', 'Le détail')]),
        h('div.panneau__corps.pile-s', [chTexte])
      ]),
      h('div.panneau', [
        h('div.panneau__tete', [icone('partage', { taille: 16 }), h('h2.grandit', 'Envoyer')]),
        h('div.panneau__corps.pile-s', [zoneEnvoi])
      ])
    ]);
  }

  /* --- la barre qui suit le panier ---------------------------------------- */
  const barre = h('div');
  function majBarre() {
    poser(barre, panier.size
      ? h('div.barre-panier', [
          h('div.grandit', [
            h('div.gras', panier.size + (panier.size > 1 ? ' prestations' : ' prestation')),
            h('div.minus.tres-faible', fmt.euros(totalPanier()) + ' HT indicatif')
          ]),
          h('button.bt.bt--fort', {
            type: 'button',
            onclick: () => { allerA('demande'); }
          }, [icone('planning'), h('span', 'Demander un rendez-vous')])
        ])
      : null);
  }

  /* --- les deux pages ------------------------------------------------------ */
  const ONGLETS = [
    { cle: 'tarifs', texte: 'Vos tarifs', icone: 'tarifs' },
    { cle: 'demande', texte: 'Demander un rendez-vous', icone: 'planning' }
  ];
  const barreOnglets = h('div.onglets', { role: 'tablist' }, ONGLETS.map(o =>
    h('button', {
      type: 'button', role: 'tab',
      'aria-selected': o.cle === onglet ? 'true' : 'false',
      onclick: () => allerA(o.cle)
    }, [icone(o.icone, { taille: 15 }), h('span', o.texte)])));

  function allerA(cle) {
    onglet = cle;
    Array.from(barreOnglets.children).forEach((b, i) =>
      b.setAttribute('aria-selected', ONGLETS[i].cle === onglet ? 'true' : 'false'));
    poser(zoneOnglet, onglet === 'tarifs' ? pageTarifs() : ongletDemande());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  peindreListe();
  majBarre();

  function pageTarifs() {
    return h('div.pile', [
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
    ]);
  }

  poser(zoneOnglet, pageTarifs());

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

    h('div.tete-ecran.tete-ecran--compacte', [
      h('div.grandit', [
        h('h1', 'Votre espace'),
        g.c ? h('div.tete-ecran__sous', g.c) : null
      ])
    ]),

    barreOnglets,
    zoneOnglet,
    barre
  ];
}

/* Le premier jour ouvré à venir, d'après les jours d'ouverture du garage —
   proposer un dimanche à quelqu'un qui prend rendez-vous est une petite
   négligence qui se voit tout de suite. */
function prochainJour(g) {
  const ouverts = Array.isArray(g.jo) && g.jo.length ? g.jo : [1, 2, 3, 4, 5];
  let j = plusJours(jour0(), 1);
  for (let i = 0; i < 14; i++) {
    if (ouverts.includes(new Date(j).getDay())) return j;
    j = plusJours(j, 1);
  }
  return plusJours(jour0(), 1);
}
