/* ==========================================================================
   YATECH — l'éditeur de lignes
   --------------------------------------------------------------------------
   Le cœur d'un devis. Il sert au dossier, au devis et à la facture : trois
   écrans, un seul composant, parce qu'un total qui se calcule différemment
   d'un écran à l'autre est la pire chose qui puisse arriver à un garage.

   Ce qu'il sait faire :
     • ajouter depuis le catalogue, depuis le stock, ou à la main ;
     • réordonner par glisser-déposer, y compris au doigt ;
     • poser des sous-titres pour séparer « Mécanique » de « Électronique » ;
     • recalculer le total à chaque frappe, sans repeindre le champ qu'on
       est en train de remplir — sinon le curseur saute et on retape.

   Il ne décide de rien : il rend les lignes modifiées par un rappel, et
   l'écran qui l'héberge décide où les ranger.
   ========================================================================== */

import { h, poser, vider } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { modale, menu, message, confirmer } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { nombre, cts, attend, id, score } from '../core/util.js';
import { TYPES_LIGNE, nouvelleLigne } from '../domain/schema.js';
import { ligneChiffree, totaux, prixPrestation, prixPiece } from '../domain/calculs.js';
import * as lit from '../domain/selecteurs.js';
import { champ, grilleChamps, blocTotaux, plaque } from './widgets.js';

/**
 * @param {object} o
 *   etat        l'état complet
 *   lignes      le tableau à éditer (modifié sur place)
 *   ctx         le contexte de prix (grille du client)
 *   remise      la remise globale, en %
 *   lecture     true : on regarde sans toucher (devis envoyé, facture émise)
 *   surChangement(lignes, remiseGlobale)  appelé après chaque modification
 *   surTotal(t) appelé avec les totaux recalculés
 */
export function editeurLignes(o) {
  const opts = o || {};
  const e = opts.etat;
  const ctx = opts.ctx;
  const lecture = !!opts.lecture;
  let lignes = opts.lignes || [];
  let remiseGlobale = nombre(opts.remise, 0);

  const corps = h('div.lignes');
  const pied = h('div');
  const racine = h('div.pile');

  /* --- ce qu'on renvoie à l'écran hôte ------------------------------------ */
  function prevenir() {
    if (opts.surChangement) opts.surChangement(lignes, remiseGlobale);
    majTotaux();
  }

  function majTotaux() {
    const t = totaux({ lignes, remiseGlobale, acompte: opts.acompte, reglements: opts.reglements }, ctx);
    poser(pied, blocTotaux(t, {
      pied: lecture ? null : h('button.bt.bt--nu.bt--s', {
        type: 'button', style: { marginTop: 'var(--e-2)', alignSelf: 'flex-end' },
        onclick: modaleRemiseGlobale
      }, remiseGlobale > 0 ? 'Modifier la remise globale' : 'Ajouter une remise globale')
    }));
    if (opts.surTotal) opts.surTotal(t);
  }

  function modaleRemiseGlobale() {
    const r = champ({
      etiquette: 'Remise sur le total', type: 'nombre', unite: '%',
      valeur: remiseGlobale, autofocus: true,
      aide: 'Elle s’applique après les remises de ligne, et se voit sur le document.'
    });
    modale({
      titre: 'Remise globale',
      corps: r.noeud,
      actions: [
        { texte: 'Annuler', ton: 'contour' },
        {
          texte: 'Appliquer', ton: 'fort',
          faire: () => {
            remiseGlobale = Math.min(100, Math.max(0, nombre(r.lire(), 0)));
            prevenir();
          }
        }
      ]
    });
  }

  /* ======================================================================
     UNE LIGNE
     ====================================================================== */

  function peindreLigne(l, index) {
    if (l.type === 'titre') return peindreTitre(l, index);

    const chiffres = ligneChiffree(l, ctx);
    const total = h('div.ligne__total', fmt.euros(chiffres.ht));

    /* Chaque champ met à jour la ligne sans repeindre l'éditeur : seul le
       total de la ligne et le récapitulatif bougent. C'est ce qui permet de
       taper un prix sans perdre le curseur. */
    const recalcule = () => {
      const x = ligneChiffree(l, ctx);
      total.textContent = fmt.euros(x.ht);
      majTotaux();
      if (opts.surChangement) opts.surChangement(lignes, remiseGlobale);
    };

    const design = h('div.ligne__design.pile-s', [
      lecture
        ? h('div', [
            h('div.gras', l.libelle || '—'),
            l.ref ? h('div.minus.tres-faible', l.ref) : null,
            l.detail ? h('div.petit.faible', l.detail) : null
          ])
        : h('input.saisie', {
            value: l.libelle || '',
            placeholder: 'Désignation',
            oninput: (ev) => { l.libelle = ev.target.value; if (opts.surChangement) opts.surChangement(lignes, remiseGlobale); }
          }),
      !lecture && (l.ref || l.detail) ? h('div.minus.tres-faible.coupe',
        [l.ref, l.detail].filter(Boolean).join(' — ')) : null
    ]);

    const num = (valeur, surSaisie, suffixe) => lecture
      ? h('div.num.droite', valeur)
      : h('div.champ-unite', [
          h('input.saisie.saisie--num', {
            value: valeur,
            inputmode: 'decimal',
            onfocus: (ev) => ev.target.select(),
            oninput: attend((ev) => surSaisie(ev.target.value), 180),
            onchange: (ev) => { surSaisie(ev.target.value); ev.target.value = lireChamp(ev.target); }
          }),
          suffixe ? h('span.champ-unite__unite', suffixe) : null
        ]);

    const lireChamp = () => '';   // remplacé plus bas selon le champ

    const champQte = lecture
      ? h('div.num.droite', fmt.nb(l.qte, 2) + (l.unite ? ' ' + l.unite : ''))
      : h('input.saisie.saisie--num', {
          value: l.qte, inputmode: 'decimal', 'aria-label': 'Quantité',
          onfocus: (ev) => ev.target.select(),
          oninput: (ev) => { l.qte = nombre(ev.target.value, 0); recalcule(); }
        });

    const champPrix = lecture
      ? h('div.num.droite', fmt.montant(l.prixHT))
      : h('input.saisie.saisie--num', {
          value: l.prixHT, inputmode: 'decimal', 'aria-label': 'Prix unitaire HT',
          onfocus: (ev) => ev.target.select(),
          oninput: (ev) => { l.prixHT = nombre(ev.target.value, 0); recalcule(); }
        });

    const champRemise = lecture
      ? h('div.num.droite', l.remise ? l.remise + ' %' : '—')
      : h('input.saisie.saisie--num', {
          value: l.remise || '', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Remise %',
          onfocus: (ev) => ev.target.select(),
          oninput: (ev) => { l.remise = nombre(ev.target.value, 0); recalcule(); }
        });

    const noeud = h('div.ligne', {
      donnees: { ligne: l.id, index: String(index) },
      style: { borderLeft: '3px solid var(--' + tonType(l.type) + ')' }
    }, [
      lecture ? h('div.ligne__poignee', icone(TYPES_LIGNE[l.type] ? TYPES_LIGNE[l.type].icone : 'document', { taille: 14 }))
        : h('div.ligne__poignee', {
            title: 'Déplacer', draggable: true, donnees: { poignee: l.id }
          }, icone('poignee', { taille: 14 })),
      design,
      h('div.ligne__chiffres', [champQte, champPrix, champRemise, total]),
      h('div.ligne__menu', lecture ? null : h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Options de la ligne',
        onclick: (ev) => menuLigne(ev.currentTarget, l, index)
      }, icone('points')))
    ]);

    return noeud;
  }

  function peindreTitre(l, index) {
    return h('div.ligne.ligne--titre', { donnees: { ligne: l.id, index: String(index) } }, [
      lecture ? h('div.ligne__poignee', icone('etiquette', { taille: 14 }))
        : h('div.ligne__poignee', { title: 'Déplacer', draggable: true, donnees: { poignee: l.id } },
            icone('poignee', { taille: 14 })),
      lecture
        ? h('div.majuscule', { style: { fontSize: 'var(--t-s)' } }, l.libelle || '')
        : h('input.saisie', {
            value: l.libelle || '', placeholder: 'Titre de section',
            style: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.05em' },
            oninput: (ev) => { l.libelle = ev.target.value; if (opts.surChangement) opts.surChangement(lignes, remiseGlobale); }
          }),
      h('div', lecture ? null : h('button.bt.bt--nu.bt--icone.bt--s', {
        type: 'button', 'aria-label': 'Options',
        onclick: (ev) => menuLigne(ev.currentTarget, l, index)
      }, icone('points')))
    ]);
  }

  const TONS = { mo: 'accent', piece: 'info', forfait: 'ok', electro: 'violet', sous: 'neutre', frais: 'neutre' };
  const tonType = (t) => TONS[t] || 'neutre';

  function menuLigne(ancre, l, index) {
    menu(ancre, [
      { titre: TYPES_LIGNE[l.type] ? TYPES_LIGNE[l.type].nom : 'Ligne' },
      l.type !== 'titre' ? {
        texte: 'Changer de nature', icone: 'etiquette',
        faire: () => modaleNature(l)
      } : null,
      l.type !== 'titre' ? {
        texte: 'Détail / commentaire', icone: 'document',
        faire: () => modaleDetail(l)
      } : null,
      index > 0 ? { texte: 'Monter', icone: 'haut', faire: () => bouger(index, index - 1) } : null,
      index < lignes.length - 1 ? { texte: 'Descendre', icone: 'bas', faire: () => bouger(index, index + 1) } : null,
      { texte: 'Dupliquer', icone: 'copier', faire: () => {
        lignes.splice(index + 1, 0, Object.assign({}, l, { id: id('lig'), sortieFaite: false }));
        peindre(); prevenir();
      } },
      null,
      { texte: 'Supprimer', icone: 'poubelle', danger: true, faire: () => {
        lignes.splice(index, 1); peindre(); prevenir();
      } }
    ]);
  }

  function modaleNature(l) {
    const options = Object.keys(TYPES_LIGNE).filter(k => k !== 'titre')
      .map(k => ({ valeur: k, texte: TYPES_LIGNE[k].nom }));
    const c = champ({ etiquette: 'Nature de la ligne', type: 'liste', valeur: l.type, options });
    modale({
      titre: 'Nature de la ligne',
      corps: c.noeud,
      actions: [
        { texte: 'Annuler', ton: 'contour' },
        { texte: 'Appliquer', ton: 'fort', faire: () => { l.type = c.lire(); peindre(); prevenir(); } }
      ]
    });
  }

  function modaleDetail(l) {
    const ref = champ({ etiquette: 'Référence', valeur: l.ref || '' });
    const det = champ({ etiquette: 'Détail (visible sur le document)', type: 'zone', lignes: 3, valeur: l.detail || '' });
    const unite = champ({ etiquette: 'Unité', valeur: l.unite || '', exemple: 'h, u, L…' });
    modale({
      titre: 'Détail de la ligne',
      corps: h('div.pile', [ref.noeud, det.noeud, unite.noeud]),
      actions: [
        { texte: 'Annuler', ton: 'contour' },
        { texte: 'Enregistrer', ton: 'fort', faire: () => {
          l.ref = ref.lire(); l.detail = det.lire(); l.unite = unite.lire();
          peindre(); prevenir();
        } }
      ]
    });
  }

  function bouger(de, vers) {
    if (vers < 0 || vers >= lignes.length) return;
    const [l] = lignes.splice(de, 1);
    lignes.splice(vers, 0, l);
    peindre();
    prevenir();
  }

  /* ======================================================================
     GLISSER-DÉPOSER
     Souris ET doigt. Sur téléphone, l'événement `drag` n'existe pas : on
     suit le toucher à la main.
     ====================================================================== */

  let emportee = null;

  function brancherGlisser() {
    corps.addEventListener('dragstart', (ev) => {
      const poignee = ev.target.closest('[data-poignee]');
      if (!poignee) { ev.preventDefault(); return; }
      const ligne = poignee.closest('.ligne');
      emportee = ligne.dataset.ligne;
      ligne.classList.add('ligne--emportee');
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', emportee); } catch (e) {}
    });

    corps.addEventListener('dragend', () => {
      emportee = null;
      corps.querySelectorAll('.ligne').forEach(n => {
        n.classList.remove('ligne--emportee', 'ligne--survolee');
      });
    });

    corps.addEventListener('dragover', (ev) => {
      if (!emportee) return;
      ev.preventDefault();
      const sur = ev.target.closest('.ligne');
      corps.querySelectorAll('.ligne').forEach(n => n.classList.remove('ligne--survolee'));
      if (sur && sur.dataset.ligne !== emportee) sur.classList.add('ligne--survolee');
    });

    corps.addEventListener('drop', (ev) => {
      if (!emportee) return;
      ev.preventDefault();
      const sur = ev.target.closest('.ligne');
      if (!sur) return;
      const de = lignes.findIndex(l => l.id === emportee);
      const vers = lignes.findIndex(l => l.id === sur.dataset.ligne);
      if (de < 0 || vers < 0 || de === vers) return;
      bouger(de, vers);
    });

    /* --- au doigt --------------------------------------------------------- */
    let depart = null;
    corps.addEventListener('touchstart', (ev) => {
      const poignee = ev.target.closest('[data-poignee]');
      if (!poignee) return;
      const ligne = poignee.closest('.ligne');
      depart = { id: ligne.dataset.ligne, y: ev.touches[0].clientY, noeud: ligne };
      ligne.classList.add('ligne--emportee');
    }, { passive: true });

    corps.addEventListener('touchmove', (ev) => {
      if (!depart) return;
      ev.preventDefault();
      const y = ev.touches[0].clientY;
      const sous = document.elementFromPoint(ev.touches[0].clientX, y);
      const ligne = sous ? sous.closest('.ligne') : null;
      corps.querySelectorAll('.ligne').forEach(n => n.classList.remove('ligne--survolee'));
      if (ligne && ligne.dataset.ligne !== depart.id) ligne.classList.add('ligne--survolee');
    }, { passive: false });

    const finTouche = (ev) => {
      if (!depart) return;
      const cible = corps.querySelector('.ligne--survolee');
      if (cible) {
        const de = lignes.findIndex(l => l.id === depart.id);
        const vers = lignes.findIndex(l => l.id === cible.dataset.ligne);
        if (de >= 0 && vers >= 0 && de !== vers) bouger(de, vers);
      }
      corps.querySelectorAll('.ligne').forEach(n =>
        n.classList.remove('ligne--emportee', 'ligne--survolee'));
      depart = null;
    };
    corps.addEventListener('touchend', finTouche);
    corps.addEventListener('touchcancel', finTouche);
  }

  /* ======================================================================
     AJOUTER
     ====================================================================== */

  function ajouter(l) {
    lignes.push(l);
    peindre();
    prevenir();
    /* On amène la nouvelle ligne sous les yeux et on met le curseur dedans :
       neuf fois sur dix, la suite du geste est d'écrire sa désignation. */
    requestAnimationFrame(() => {
      const noeud = corps.querySelector('[data-ligne="' + l.id + '"]');
      if (!noeud) return;
      noeud.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const premier = noeud.querySelector('input.saisie');
      if (premier && !premier.value) premier.focus();
    });
  }

  function boutonsAjout() {
    if (lecture) return null;
    return h('div.rang.enroule', [
      h('button.bt.bt--fort', { type: 'button', onclick: choisirCatalogue },
        [icone('tarifs'), h('span', 'Du catalogue')]),
      h('button.bt.bt--contour', { type: 'button', onclick: choisirPiece },
        [icone('stock'), h('span', 'Du stock')]),
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: () => ajouter(nouvelleLigne({ type: 'mo', qte: 1, unite: 'h', prixHT: ctx.taux }))
      }, [icone('atelier'), h('span', 'Main-d’œuvre')]),
      h('button.bt.bt--contour', {
        type: 'button',
        onclick: () => ajouter(nouvelleLigne({ type: 'piece', qte: 1, prixHT: 0 }))
      }, [icone('plus'), h('span', 'Ligne libre')]),
      h('button.bt.bt--nu', {
        type: 'button',
        onclick: () => ajouter(nouvelleLigne({ type: 'titre', libelle: '' }))
      }, [icone('etiquette'), h('span', 'Sous-titre')])
    ]);
  }

  /* --- choisir dans le catalogue ------------------------------------------ */
  function choisirCatalogue() {
    const actives = (e.prestations || []).filter(p => p.actif);
    const familles = Array.from(new Set(actives.map(p => p.famille || 'Divers')));
    let famille = null;
    let requete = '';

    const liste = h('div.pile-s', { style: { maxHeight: '46vh', overflowY: 'auto' } });

    function peindreListe() {
      let trouves = actives;
      if (famille) trouves = trouves.filter(p => (p.famille || 'Divers') === famille);
      if (requete) {
        trouves = trouves.map(p => ({ p, n: score([p.code, p.libelle, p.famille].filter(Boolean).join(' '), requete) }))
          .filter(x => x.n >= 0).sort((a, b) => b.n - a.n).map(x => x.p);
      }
      poser(liste, trouves.length ? trouves.slice(0, 60).map(p => {
        const prix = prixPrestation(p, ctx);
        return h('button.carte.rang', {
          type: 'button',
          onclick: () => {
            const type = p.type === 'piece' ? 'piece'
              : (p.type === 'electro' ? 'electro' : (p.type === 'forfait' ? 'forfait' : 'mo'));
            const l = nouvelleLigne({
              type, ref: p.code, libelle: p.libelle, detail: p.detail || '',
              prestationId: p.id, unite: type === 'mo' ? 'h' : 'u'
            });
            /* Une main-d'œuvre sans prix fixé se facture au temps : la quantité
               est le nombre d'heures, le prix unitaire le taux horaire. */
            if (p.type === 'mo' && nombre(p.prixHT) === 0 && nombre(p.temps) > 0) {
              l.qte = p.temps;
              l.prixHT = ctx.taux;
            } else {
              l.qte = 1;
              l.prixHT = prix;
            }
            fenetre.fermer();
            ajouter(l);
          }
        }, [
          h('div.grandit.coupe', [
            h('div.gras.coupe', p.libelle),
            h('div.minus.tres-faible.coupe',
              [p.code, p.famille, p.temps ? fmt.heuresMO(p.temps) : ''].filter(Boolean).join(' · '))
          ]),
          h('div.droite', [
            h('div.gras.num', fmt.euros(prix)),
            ctx.pro ? h('div.minus.tres-faible', 'grille pro') : null
          ])
        ]);
      }) : h('div.vide', [
        icone('chercher', { taille: 30 }),
        h('p', 'Aucune prestation ne correspond.')
      ]));
    }

    const recherche = h('input.saisie', {
      type: 'search', placeholder: 'Chercher une prestation…', autofocus: true,
      oninput: attend((ev) => { requete = ev.target.value.trim(); peindreListe(); }, 160)
    });

    const filtres = h('div.filtres', [
      h('button.filtre', {
        type: 'button', 'aria-pressed': 'true',
        onclick: (ev) => { famille = null; marquer(ev.currentTarget); peindreListe(); }
      }, 'Tout')
    ].concat(familles.map(f =>
      h('button.filtre', {
        type: 'button', 'aria-pressed': 'false',
        onclick: (ev) => { famille = f; marquer(ev.currentTarget); peindreListe(); }
      }, f)
    )));

    function marquer(actif) {
      filtres.querySelectorAll('.filtre').forEach(b =>
        b.setAttribute('aria-pressed', b === actif ? 'true' : 'false'));
    }

    peindreListe();
    const fenetre = modale({
      titre: 'Catalogue',
      taille: 'large',
      corps: h('div.pile', [recherche, filtres, liste]),
      actions: [{ texte: 'Fermer', ton: 'contour' }]
    });
  }

  /* --- choisir dans le stock ---------------------------------------------- */
  function choisirPiece() {
    const dispo = (e.pieces || []).filter(p => !p.archive);
    const liste = h('div.pile-s', { style: { maxHeight: '46vh', overflowY: 'auto' } });
    let requete = '';

    function peindreListe() {
      let trouves = dispo;
      if (requete) {
        trouves = trouves.map(p => ({
          p, n: score([p.ref, p.refFabricant, p.libelle, p.emplacement, p.compatible, p.marque]
            .filter(Boolean).join(' '), requete)
        })).filter(x => x.n >= 0).sort((a, b) => b.n - a.n).map(x => x.p);
      } else {
        trouves = trouves.slice().sort((a, b) => (b.maj || 0) - (a.maj || 0));
      }
      poser(liste, trouves.length ? trouves.slice(0, 60).map(p =>
        h('button.carte.rang', {
          type: 'button',
          onclick: () => {
            fenetre.fermer();
            ajouter(nouvelleLigne({
              type: 'piece', ref: p.ref || p.refFabricant, libelle: p.libelle,
              qte: 1, unite: p.unite || 'u', prixHT: prixPiece(p, ctx), pieceId: p.id
            }));
          }
        }, [
          h('span.qte' + (p.qte <= 0 ? '.qte--zero' : (p.qte <= lit.seuilBas(e, p) ? '.qte--bas' : '')),
            String(p.qte)),
          h('div.grandit.coupe', [
            h('div.gras.coupe', p.libelle),
            h('div.minus.tres-faible.coupe',
              [p.ref, p.emplacement, p.compatible].filter(Boolean).join(' · '))
          ]),
          h('div.gras.num', fmt.euros(prixPiece(p, ctx)))
        ])
      ) : h('div.vide', [icone('stock', { taille: 30 }), h('p', 'Aucune pièce ne correspond.')]));
    }

    peindreListe();
    const fenetre = modale({
      titre: 'Stock',
      taille: 'large',
      corps: h('div.pile', [
        h('input.saisie', {
          type: 'search', placeholder: 'Référence, désignation, emplacement…', autofocus: true,
          oninput: attend((ev) => { requete = ev.target.value.trim(); peindreListe(); }, 160)
        }),
        liste
      ]),
      actions: [{ texte: 'Fermer', ton: 'contour' }]
    });
  }

  /* ======================================================================
     PEINTURE
     ====================================================================== */

  function peindre() {
    if (!lignes.length) {
      poser(corps, h('div.vide', { style: { padding: 'var(--e-5) var(--e-3)' } }, [
        icone('devis', { taille: 34 }),
        h('h3', 'Aucune ligne'),
        h('p', lecture ? 'Ce document est vide.'
          : 'Ajoutez une prestation du catalogue, une pièce du stock, ou tapez une ligne libre.')
      ]));
      majTotaux();
      return;
    }
    poser(corps, lignes.map((l, i) => peindreLigne(l, i)));
    majTotaux();
  }

  poser(racine, [
    lignes.length || lecture ? h('div.lignes__entetes', [
      h('span', ''), h('span', 'Désignation'), h('span', 'Qté'),
      h('span', 'P.U. HT'), h('span', 'Rem.'), h('span', 'Total HT'), h('span', '')
    ]) : null,
    corps,
    boutonsAjout(),
    h('hr'),
    pied
  ]);

  peindre();
  if (!lecture) brancherGlisser();

  return {
    noeud: racine,
    lire: () => ({ lignes, remiseGlobale }),
    ecrire: (nouvelles, remise) => {
      lignes = nouvelles || [];
      if (remise !== undefined) remiseGlobale = nombre(remise, 0);
      peindre();
    },
    totaux: () => totaux({ lignes, remiseGlobale, acompte: opts.acompte, reglements: opts.reglements }, ctx),
    ajouter,
    repeindre: peindre
  };
}
