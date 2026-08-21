/* ==========================================================================
   YATECH — ouvrir un dossier
   --------------------------------------------------------------------------
   Le geste le plus fréquent de la journée, et celui qui doit coûter le moins.
   Un véhicule arrive : on veut l'avoir enregistré avant qu'il ait fini de se
   garer. Tout ce qui n'est pas indispensable attend.

   Trois cas, et un seul écran :
     • le client existe et son véhicule aussi — deux touches ;
     • le client existe, véhicule inconnu — on ajoute la plaque ;
     • personne ne connaît personne — on crée les deux à la volée.

   Cette fenêtre est partagée : le tableau de bord, l'atelier, la fiche client
   et la fiche véhicule l'appellent tous. Une seule façon d'ouvrir un dossier.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, message } from '../core/ui.js';
import { maj } from '../core/store.js';
import { plaqueNue, plaqueJolie, attend, score, telJoli, nombre } from '../core/util.js';
import { nouveauClient, nouveauVehicule, NATURES, apercuNumero } from '../domain/schema.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { champ, grilleChamps, plaque } from '../ui/widgets.js';

/**
 * @param {object} e        l'état
 * @param {function} apres  rappelé avec le dossier créé, AVANT d'y naviguer
 * @param {object} [depart] { clientId, vehiculeId } pour pré-remplir
 */
export function nouveauDossierModale(e, apres, depart) {
  const d = depart || {};
  let clientId = d.clientId || null;
  let vehiculeId = d.vehiculeId || null;

  /* Si on part d'un véhicule, son propriétaire suit. */
  if (vehiculeId && !clientId) {
    const v = lit.vehicule(e, vehiculeId);
    if (v) clientId = v.clientId;
  }

  const zoneQui = h('div.pile-s');
  const zoneQuoi = h('div.pile');
  let fenetre = null;

  /* --- les champs du dossier, construits une fois ------------------------- */
  const titre = champ({ etiquette: 'Objet', exemple: 'Ce qui amène le client' });
  const demande = champ({
    etiquette: 'Ce que dit le client', type: 'zone', lignes: 3,
    exemple: 'Ses mots à lui : « ça broute à froid », « voyant orange »…'
  });
  const nature = champ({
    etiquette: 'Nature', type: 'liste', valeur: 'meca',
    options: Object.keys(NATURES).map(k => ({ valeur: k, texte: NATURES[k].nom }))
  });
  const priorite = champ({
    etiquette: 'Priorité', type: 'liste', valeur: 'normale',
    options: [
      { valeur: 'basse', texte: 'Peut attendre' },
      { valeur: 'normale', texte: 'Normale' },
      { valeur: 'urgent', texte: 'Urgent' }
    ]
  });
  const km = champ({ etiquette: 'Kilométrage à l’entrée', type: 'km', unite: 'km' });
  const place = champ({
    etiquette: 'Place au parc', type: 'liste',
    options: [{ valeur: '', texte: 'Pas de place attribuée' }]
      .concat(lit.placesLibres(e).map(p => ({ valeur: p.code, texte: p.code + (p.nomRangee ? ' — ' + p.nomRangee : '') })))
  });

  /* --- qui : le client ---------------------------------------------------- */
  function peindreQui() {
    if (clientId) {
      const c = lit.client(e, clientId);
      poser(zoneQui, [
        h('div.carte.carte--muette.rang', [
          h('span.tete', { style: { background: 'var(--accent-voile)', color: 'var(--accent)' } },
            c && c.type === 'pro' ? 'PRO' : icone('clients', { taille: 15 })),
          h('div.grandit.coupe', [
            h('div.gras.coupe', lit.nomClient(c)),
            h('div.petit.faible.coupe', [c && c.tel ? telJoli(c.tel) : '', c && c.ville].filter(Boolean).join(' · '))
          ]),
          h('button.bt.bt--nu.bt--s', {
            type: 'button',
            onclick: () => { clientId = null; vehiculeId = null; peindreQui(); peindreQuoi(); }
          }, 'Changer')
        ])
      ]);
      return;
    }

    const recherche = h('input.saisie', {
      type: 'search', placeholder: 'Nom, téléphone ou plaque…', autocomplete: 'off', autofocus: true
    });
    const resultats = h('div.pile-s', { style: { maxHeight: '230px', overflowY: 'auto' } });

    function chercher() {
      const q = recherche.value.trim();
      const sortie = [];

      if (q) {
        /* Une plaque tapée dans ce champ doit tomber sur le bon véhicule :
           c'est ce qu'on a sous les yeux quand la voiture est devant nous. */
        const parPlaque = (e.vehicules || []).filter(v => !v.archive
          && plaqueNue(v.immat).includes(plaqueNue(q))).slice(0, 4);
        for (const v of parPlaque) {
          const prop = lit.client(e, v.clientId);
          sortie.push(h('button.carte.rang', {
            type: 'button',
            onclick: () => { clientId = v.clientId; vehiculeId = v.id; peindreQui(); peindreQuoi(); }
          }, [
            plaque(v.immat),
            h('div.grandit.coupe', [
              h('div.gras.coupe', lit.nomVehicule(v)),
              h('div.petit.faible.coupe', prop ? lit.nomClient(prop) : 'sans propriétaire')
            ])
          ]));
        }
      }

      const clients = (e.clients || []).filter(c => !c.archive);
      const trouves = (q
        ? clients.map(c => ({ c, n: score([lit.nomClient(c), c.tel, c.tel2, c.email, c.ville]
            .filter(Boolean).join(' '), q) })).filter(x => x.n >= 0)
            .sort((a, b) => b.n - a.n).map(x => x.c)
        : clients.slice().sort((a, b) => (b.maj || 0) - (a.maj || 0))
      ).slice(0, 6);

      for (const c of trouves) {
        sortie.push(h('button.carte.rang', {
          type: 'button',
          onclick: () => { clientId = c.id; vehiculeId = null; peindreQui(); peindreQuoi(); }
        }, [
          h('div.grandit.coupe', [
            h('div.gras.coupe', lit.nomClient(c)),
            h('div.petit.faible.coupe', [c.tel ? telJoli(c.tel) : '', c.ville].filter(Boolean).join(' · '))
          ]),
          c.type === 'pro' ? h('span.etiq', 'PRO') : null
        ]));
      }

      poser(resultats, sortie.length ? sortie
        : h('div.petit.faible.centre', { style: { padding: 'var(--e-3)' } },
            q ? 'Personne ne correspond.' : 'Aucun client enregistré.'));
    }

    recherche.addEventListener('input', attend(chercher, 150));

    poser(zoneQui, [
      recherche,
      resultats,
      h('button.bt.bt--contour.bt--plein', {
        type: 'button', onclick: () => nouveauClientRapide(recherche.value.trim())
      }, [icone('plus'), h('span', 'Nouveau client')])
    ]);
    chercher();
  }

  function nouveauClientRapide(pre) {
    const estPro = champ({ type: 'coche', etiquette: 'C’est un professionnel (confrère, société)' });
    const nom = champ({ etiquette: 'Nom', valeur: pre || '', autofocus: true, obligatoire: true });
    const prenom = champ({ etiquette: 'Prénom' });
    const tel = champ({ etiquette: 'Téléphone', type: 'tel' });
    const email = champ({ etiquette: 'E-mail', type: 'email' });

    /* Un professionnel n'a pas de prénom, il a une raison sociale. */
    estPro.entree.addEventListener('change', () => {
      const pro = estPro.lire();
      prenom.noeud.style.display = pro ? 'none' : '';
      nom.noeud.querySelector('label').textContent = pro ? 'Raison sociale' : 'Nom';
    });

    modale({
      titre: 'Nouveau client',
      corps: h('div.pile', [
        estPro.noeud,
        grilleChamps([nom, prenom]),
        grilleChamps([tel, email])
      ]),
      actions: [
        { texte: 'Annuler', ton: 'contour' },
        {
          texte: 'Créer', ton: 'fort',
          faire: () => {
            if (!nom.lire()) { nom.erreur('Un nom, au minimum.'); return false; }
            const pro = estPro.lire();
            const c = maj('Client créé', (etat) => {
              const x = nouveauClient({
                type: pro ? 'pro' : 'part',
                grille: pro ? 'pro' : 'part',
                nom: pro ? nom.lire() : nom.lire(),
                societe: pro ? nom.lire() : '',
                prenom: pro ? '' : prenom.lire(),
                tel: tel.lire(), email: email.lire()
              });
              etat.clients.push(x);
              return x;
            });
            clientId = c.id;
            vehiculeId = null;
            peindreQui();
            peindreQuoi();
          }
        }
      ]
    });
  }

  /* --- quoi : le véhicule -------------------------------------------------- */
  function peindreQuoi() {
    if (!clientId) { poser(zoneQuoi, h('div.petit.faible', 'Choisissez d’abord le client.')); return; }

    const liste = lit.vehiculesDe(e, clientId);
    const cartes = liste.map(v => h('button.carte.rang', {
      type: 'button',
      style: vehiculeId === v.id ? { borderColor: 'var(--accent)', background: 'var(--accent-voile)' } : null,
      onclick: () => { vehiculeId = v.id; peindreQuoi(); }
    }, [
      plaque(v.immat),
      h('div.grandit.coupe', [
        h('div.gras.coupe', lit.nomVehicule(v)),
        h('div.petit.faible.coupe', [v.motorisation, v.km ? Math.round(v.km / 1000) + ' Mkm' : '']
          .filter(Boolean).join(' · '))
      ]),
      vehiculeId === v.id ? icone('coche', { taille: 16 }) : null
    ]));

    poser(zoneQuoi, [
      h('div.champ', [
        h('label', 'Véhicule'),
        cartes.length ? h('div.pile-s', cartes) : h('div.petit.faible', 'Aucun véhicule enregistré.'),
        h('button.bt.bt--contour.bt--plein', {
          type: 'button', onclick: nouveauVehiculeRapide, style: { marginTop: 'var(--e-2)' }
        }, [icone('plus'), h('span', 'Nouveau véhicule')])
      ]),
      titre.noeud,
      demande.noeud,
      grilleChamps([nature, priorite]),
      grilleChamps([km, place])
    ]);

    /* Le kilométrage connu du véhicule sert de point de départ : on corrige au
       compteur plutôt que de tout retaper. */
    const v = vehiculeId ? lit.vehicule(e, vehiculeId) : null;
    if (v && v.km && !km.lire()) km.ecrire(v.km);
  }

  function nouveauVehiculeRapide() {
    const immat = champ({ etiquette: 'Immatriculation', type: 'plaque', autofocus: true, obligatoire: true });
    const marque = champ({ etiquette: 'Marque', exemple: 'Peugeot' });
    const modele = champ({ etiquette: 'Modèle', exemple: '308' });
    const motorisation = champ({ etiquette: 'Motorisation', exemple: '1.6 BlueHDi 120' });
    const kmv = champ({ etiquette: 'Kilométrage', type: 'km', unite: 'km' });
    const doublon = h('div');

    immat.entree.addEventListener('input', attend(() => {
      const p = plaqueNue(immat.lire());
      const deja = p.length >= 5 ? (e.vehicules || []).find(x => plaqueNue(x.immat) === p) : null;
      poser(doublon, deja ? h('div.bandeau.bandeau--alerte', [
        icone('alerte'),
        h('span', 'Cette plaque existe déjà : ' + lit.nomVehicule(deja)
          + ' (' + lit.nomClient(lit.client(e, deja.clientId)) + ').')
      ]) : []);
    }, 250));

    modale({
      titre: 'Nouveau véhicule',
      corps: h('div.pile', [
        immat.noeud, doublon,
        grilleChamps([marque, modele]),
        grilleChamps([motorisation, kmv])
      ]),
      actions: [
        { texte: 'Annuler', ton: 'contour' },
        {
          texte: 'Créer', ton: 'fort',
          faire: () => {
            if (!immat.lire()) { immat.erreur('Une plaque, au minimum.'); return false; }
            const v = maj('Véhicule créé', (etat) => {
              const x = nouveauVehicule({
                clientId,
                immat: immat.lire(),
                marque: marque.lire(), modele: modele.lire(),
                motorisation: motorisation.lire(),
                km: kmv.lire() || null,
                kmReleveLe: kmv.lire() ? Date.now() : null
              });
              etat.vehicules.push(x);
              return x;
            });
            vehiculeId = v.id;
            peindreQuoi();
          }
        }
      ]
    });
  }

  /* --- la fenêtre ---------------------------------------------------------- */
  peindreQui();
  peindreQuoi();

  fenetre = modale({
    titre: 'Nouveau dossier',
    taille: 'large',
    corps: h('div.pile', [
      h('div.rang.entre', [
        h('span.majuscule', 'Client'),
        h('span.minus.tres-faible', apercuNumero(e, 'dossier'))
      ]),
      zoneQui,
      h('hr'),
      zoneQuoi
    ]),
    actions: [
      { texte: 'Annuler', ton: 'contour' },
      {
        texte: 'Ouvrir le dossier', ton: 'fort',
        faire: () => {
          if (!clientId) { message('Choisissez un client', { ton: 'alerte' }); return false; }
          if (!vehiculeId) { message('Choisissez ou créez le véhicule', { ton: 'alerte' }); return false; }

          const dossier = act.ouvrirDossier({
            clientId, vehiculeId,
            titre: titre.lire(),
            demande: demande.lire(),
            nature: nature.lire(),
            priorite: priorite.lire(),
            kmEntree: km.lire() || null,
            place: place.lire() || null,
            entree: Date.now()
          });

          /* Le compteur relevé à l'entrée met le véhicule à jour : c'est le
             chiffre le plus frais qu'on ait. */
          const kmLu = km.lire();
          if (kmLu) {
            maj(null, (etat) => {
              const v = etat.vehicules.find(x => x.id === vehiculeId);
              if (v && kmLu > (v.km || 0)) { v.km = kmLu; v.kmReleveLe = Date.now(); }
            }, { journal: false });
          }

          message('Dossier ' + dossier.numero + ' ouvert', { ton: 'ok' });
          if (apres) apres(dossier);
          /* On emmène TOUJOURS sur le dossier neuf. La suite du geste, c'est
             d'y écrire ce que dit le client et de chiffrer : rester sur
             l'écran d'où l'on vient oblige à retrouver le dossier à la main,
             et on ne sait même pas où il est parti. L'écran appelant garde le
             droit de se rafraîchir au passage, d'où le rappel juste au-dessus. */
          location.hash = '#/dossier/' + dossier.id;
        }
      }
    ]
  });

  return fenetre;
}
