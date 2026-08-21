/* ==========================================================================
   YATECH — écran « Atelier »
   --------------------------------------------------------------------------
   Le tableau du mur, en verre. Une colonne par étape, une fiche par véhicule,
   et le geste qui compte : prendre une fiche et la poser plus loin. Tout le
   reste (recherche, filtres, vue en liste) n'est là que pour retrouver une
   fiche quand il y en a quarante.

   Deux règles tenues ailleurs, qu'on ne refait pas ici :
   — l'ordre d'une colonne, c'est `lit.triDossiers` (urgent d'abord, puis le
     plus ancien) ;
   — passer un dossier en « Rendu » libère sa place de parc, et c'est
     `act.changerEtape` qui s'en occupe.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { message } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { JOUR, pluriel, correspond, compareTexte, plaqueJolie } from '../core/util.js';
import * as lit from '../domain/selecteurs.js';
import * as act from '../domain/actions.js';
import { ETAPES, CLES_ETAPES, NATURES } from '../domain/schema.js';
import {
  enTete, barreRecherche, filtres, carteDossier, pastilleEtape, plaque, tetes, vide
} from '../ui/widgets.js';
import { nouveauDossierModale } from './dossier-nouveau.js';

/* Un véhicule rendu il y a trois semaines n'a plus rien à faire sur le mur :
   la colonne « Rendu » ne garde que le passé récent, celui qu'on peut encore
   avoir à rouvrir ou à facturer. Le compteur de la colonne, lui, dit la
   vérité entière (« 3/57 »). */
const JOURS_RENDUS = 14;

/* La largeur en dessous de laquelle une seule colonne tient à l'écran. */
const TELEPHONE = '(max-width: 900px)';

/* Comment on regarde le tableau n'est pas du travail : ça ne va pas dans
   l'état enregistré, mais ça survit d'une visite à l'autre — on passe par cet
   écran vingt fois par jour et personne n'a envie de rechoisir sa vue à
   chaque fois. Tous ces réglages restent lisibles à l'écran (puces enfoncées,
   texte dans la loupe) : rien ne filtre en cachette. */
const pref = {
  vue: null,            // 'colonnes' | 'liste' — décidé à la première visite
  nature: 'tout',
  miens: false,
  urgents: false,
  etapeSeule: 'tout',   // sur téléphone : ne voir qu'une colonne
  requete: '',
  tri: null,            // vue liste : null = l'ordre métier
  sens: 'asc'
};

/* Un seul écouteur de largeur pour toute la vie de l'onglet : l'écran n'a pas
   de fonction de démontage, un écouteur par visite finirait par s'empiler. */
const veille = window.matchMedia(TELEPHONE);
let vivant = null;
brancherLargeur();

export function peindre(ctx) {
  const e = ctx.etat;
  const moi = ctx.moi;
  const racine = h('div.pile');

  if (!pref.vue) pref.vue = veille.matches ? 'liste' : 'colonnes';

  const zoneEnTete = h('div');
  const zoneBandeau = h('div');
  const zoneVue = h('div');
  const zoneFiltres = h('div.pile-s');
  const zone = h('div');

  /* Les colonnes vivantes, pour n'en repeindre que deux après un déplacement
     au lieu de refaire tout le mur sous les doigts de la personne. */
  const colonnes = new Map();

  /* ======================================================================
     LE PÉRIMÈTRE ET LES FILTRES
     ====================================================================== */

  function dansLePerimetre(d) {
    if (!d || d.archive || !CLES_ETAPES.includes(d.etape)) return false;
    if (d.etape === 'livre') {
      return (d.sortie || d.maj || d.cree || 0) > Date.now() - JOURS_RENDUS * JOUR;
    }
    return true;
  }

  function texteCherchable(d) {
    const v = lit.vehicule(e, d.vehiculeId);
    const c = lit.client(e, d.clientId);
    return [
      d.numero, d.titre, lit.titreDossier(e, d),
      v ? v.immat : '', v ? plaqueJolie(v.immat) : '', v ? lit.nomVehicule(v) : '',
      c ? lit.nomClient(c) : ''
    ].filter(Boolean).join(' ');
  }

  function retenu(d) {
    if (pref.nature !== 'tout' && d.nature !== pref.nature) return false;
    if (pref.miens && !(moi && (d.assignes || []).includes(moi.id))) return false;
    if (pref.urgents && d.priorite !== 'urgent') return false;
    if (pref.requete && !correspond(texteCherchable(d), pref.requete)) return false;
    return true;
  }

  const perimetre = () => (e.dossiers || []).filter(dansLePerimetre);
  const filtreActif = () => pref.nature !== 'tout' || pref.miens || pref.urgents || !!pref.requete;

  function dossiersDeLEtape(cle) {
    return (e.dossiers || [])
      .filter(d => d.etape === cle && dansLePerimetre(d) && retenu(d))
      .sort(lit.triDossiers);
  }

  function tousLesDossiers() {
    return perimetre().filter(retenu);
  }

  /* ======================================================================
     L'EN-TÊTE
     ====================================================================== */

  function majEnTete() {
    const ouverts = lit.dossiersOuverts(e);
    const libres = lit.placesLibres(e).length;
    poser(zoneEnTete, enTete({
      titre: 'Atelier',
      sous: pluriel(ouverts.length, 'dossier ouvert', 'dossiers ouverts')
        + ' · ' + pluriel(libres, 'place libre', 'places libres'),
      actions: [
        h('button.bt.bt--fort', {
          type: 'button',
          onclick: () => nouveauDossierModale(e, () => ctx.repeindre())
        }, [icone('plus'), h('span', 'Nouveau dossier')])
      ]
    }));
  }

  function majBandeau() {
    const conflits = lit.conflitsParc(e);
    if (!conflits.length) { poser(zoneBandeau, []); return; }
    const places = conflits.map(c => c.place).join(', ');
    poser(zoneBandeau, h('div.bandeau.bandeau--danger', [
      icone('alerte'),
      h('span.grandit', [
        h('b', pluriel(conflits.length, 'place annoncée deux fois', 'places annoncées deux fois')),
        h('span', ' : ' + places + '. Deux véhicules ne tiennent pas au même endroit.')
      ]),
      h('a.bt.bt--contour.bt--s', { href: '#/parc' }, 'Voir le parc')
    ]));
  }

  /* ======================================================================
     LA BARRE D'OUTILS
     ====================================================================== */

  const recherche = barreRecherche({
    valeur: pref.requete,
    exemple: 'Numéro, plaque, client…',
    surChangement: (v) => { pref.requete = v; majFiltres(); refaireZone(); }
  });

  /* Vider le champ depuis l'extérieur : sa croix ne réapparaît que sur
     frappe, il faut la ranger nous-mêmes. */
  function viderRecherche() {
    const saisie = recherche.querySelector('input');
    const croix = recherche.querySelector('.recherche__vider');
    if (saisie) saisie.value = '';
    if (croix) croix.hidden = true;
  }

  function majVue() {
    const bouton = (cle, texte) => h('button', {
      type: 'button',
      'aria-pressed': pref.vue === cle ? 'true' : 'false',
      onclick: () => { pref.vue = cle; majVue(); majFiltres(); refaireZone(); }
    }, texte);
    poser(zoneVue, h('div.segments', [
      bouton('colonnes', 'Colonnes'),
      bouton('liste', 'Liste')
    ]));
  }

  function majFiltres() {
    const base = perimetre();
    const compteNature = (cle) => base.filter(d => d.nature === cle).length;

    const naturesChoix = [{ cle: 'tout', texte: 'Tout', compte: base.length }].concat(
      Object.keys(NATURES).map(cle => ({
        cle, texte: NATURES[cle].nom, icone: NATURES[cle].icone, compte: compteNature(cle)
      }))
    );

    const bascule = (actif, texte, ico, compte, surClic) => h('button.filtre', {
      type: 'button',
      'aria-pressed': actif ? 'true' : 'false',
      onclick: surClic
    }, [
      icone(ico, { taille: 14 }),
      h('span', texte),
      h('span.compte', String(compte))
    ]);

    const miens = moi ? base.filter(d => (d.assignes || []).includes(moi.id)).length : 0;
    const urgents = base.filter(d => d.priorite === 'urgent').length;

    const drapeaux = h('div.filtres', [
      moi ? bascule(pref.miens, 'Mes dossiers', 'pro', miens, () => {
        pref.miens = !pref.miens; majFiltres(); refaireZone();
      }) : null,
      bascule(pref.urgents, 'Urgents', 'alerte', urgents, () => {
        pref.urgents = !pref.urgents; majFiltres(); refaireZone();
      }),
      filtreActif() ? h('button.filtre', {
        type: 'button', onclick: () => {
          pref.nature = 'tout'; pref.miens = false; pref.urgents = false; pref.requete = '';
          viderRecherche();
          majFiltres(); refaireZone();
        }
      }, [icone('croix', { taille: 14 }), h('span', 'Tout afficher')]) : null
    ]);

    /* Le choix d'une colonne unique ne sert que là où elles ne tiennent pas
       toutes à l'écran ; la feuille de style le cache sur grand écran. */
    const comptes = lit.compteParEtape(e);
    const etapesChoix = [{ cle: 'tout', texte: 'Toutes' }].concat(
      ETAPES.map(et => ({ cle: et.cle, texte: et.court, compte: comptes[et.cle] }))
    );
    let rangEtapes = null;
    if (pref.vue === 'colonnes') {
      rangEtapes = filtres(etapesChoix, pref.etapeSeule, (cle) => {
        pref.etapeSeule = cle; majFiltres(); refaireZone();
      });
      rangEtapes.classList.add('atelier-etapes');
    }

    /* Repeindre la barre détruit le bouton qu'on vient d'actionner : au
       clavier, le focus repartirait en haut de la page. On le remet où il
       était. */
    const puces = () => Array.from(zoneFiltres.querySelectorAll('button'));
    const rang = puces().indexOf(document.activeElement);

    poser(zoneFiltres, [
      filtres(naturesChoix, pref.nature, (cle) => { pref.nature = cle; majFiltres(); refaireZone(); }),
      drapeaux,
      rangEtapes
    ]);

    if (rang >= 0) {
      const apres = puces();
      const cible = apres[rang] || apres[apres.length - 1];
      if (cible) cible.focus();
    }
  }

  /* ======================================================================
     LE CONTENU
     ====================================================================== */

  function refaireZone() {
    colonnes.clear();
    const liste = tousLesDossiers();

    if (!liste.length) {
      poser(zone, filtreActif()
        ? h('div.carte.centre.pile-s', [
            h('div.gras', 'Aucun dossier ne correspond'),
            h('div.petit.faible', 'Les filtres du dessus mettent tout le reste de côté.')
          ])
        : vide({
            icone: 'atelier',
            titre: 'L’atelier est vide',
            texte: 'Aucun véhicule en cours. Ouvrez un dossier dès qu’un client dépose sa voiture.',
            action: { texte: 'Nouveau dossier', faire: () => nouveauDossierModale(e, () => ctx.repeindre()) }
          }));
      return;
    }

    poser(zone, pref.vue === 'liste' ? vueListe(liste) : vueColonnes());
  }

  /* ======================================================================
     VUE COLONNES
     ====================================================================== */

  function vueColonnes() {
    const tableau = h('div.tableau-atelier');
    const visibles = pref.etapeSeule === 'tout'
      ? ETAPES
      : ETAPES.filter(et => et.cle === pref.etapeSeule);

    visibles.forEach(et => tableau.appendChild(batirColonne(et)));
    brancherGlisser(tableau);

    return h('div.pile-s', [
      tableau,
      h('div.minus.tres-faible',
        'Glissez une fiche vers une autre colonne. Au doigt : appuyez une seconde '
        + 'avant de la porter. Au clavier : ← et → déplacent la fiche sélectionnée.')
    ]);
  }

  function batirColonne(et) {
    const corps = h('div.colonne__corps', { donnees: { etape: et.cle } });
    const compte = h('span.compte');
    const noeud = h('div.colonne', { donnees: { etape: et.cle } }, [
      h('div.colonne__tete', [
        h('span.colonne__pion', { style: { background: 'var(--' + et.ton + ')' } }),
        h('span.colonne__nom', { title: et.aide }, et.nom),
        compte
      ]),
      corps
    ]);
    colonnes.set(et.cle, { noeud, corps, compte, etape: et });
    remplirColonne(et.cle);
    return noeud;
  }

  function remplirColonne(cle) {
    const c = colonnes.get(cle);
    if (!c) return;
    const liste = dossiersDeLEtape(cle);
    const total = lit.compteParEtape(e)[cle] || 0;

    /* « 3/57 » : ce qu'on voit sur ce qu'il y a. Sans ça, un filtre oublié
       fait croire que la colonne s'est vidée toute seule. */
    c.compte.textContent = liste.length === total ? String(total) : liste.length + '/' + total;
    c.compte.classList.toggle('compte--alerte', cle !== 'livre' && liste.some(d => d.priorite === 'urgent'));

    poser(c.corps, liste.length
      ? liste.map(d => carteDossier(e, d))
      : h('div.colonne__vide', c.etape.aide));
  }

  /* ======================================================================
     DÉPLACER UNE FICHE
     ====================================================================== */

  function deplacer(id, versEtape) {
    const d = lit.dossier(e, id);
    if (!d || !versEtape || d.etape === versEtape) return;
    const depuis = d.etape;
    const placeAvant = d.place;

    act.changerEtape(id, versEtape);

    const et = ETAPES.find(x => x.cle === versEtape);
    /* Le passage en « Rendu » libère la place de parc tout seul : on le dit,
       sinon personne ne comprend pourquoi le plan du parc a changé. */
    message(versEtape === 'livre' && placeAvant
      ? 'Rendu — la place ' + placeAvant + ' est libérée'
      : 'Déplacé en « ' + (et ? et.nom : versEtape) + ' »', { ton: 'ok' });

    rafraichir([depuis, versEtape], id);
  }

  function rafraichir(cles, idASuivre) {
    majEnTete();
    majBandeau();
    majFiltres();

    if (pref.vue !== 'colonnes' || cles.some(c => !colonnes.has(c))) refaireZone();
    else cles.forEach(remplirColonne);

    if (idASuivre) {
      const carte = Array.from(zone.querySelectorAll('.dossier'))
        .find(n => n.dataset.dossier === idASuivre);
      if (carte) carte.focus();
    }
  }

  /* ======================================================================
     GLISSER-DÉPOSER — à la souris et au doigt
     Le doigt n'a pas d'événement `drag` : on le suit à la main, et on attend
     un appui long avant de prendre la fiche, sinon on ne pourrait plus faire
     défiler le mur du bout du doigt.
     ====================================================================== */

  function brancherGlisser(tableau) {
    let emporte = null;
    let touche = null;
    let avaleClic = false;

    const oublierCible = () => tableau.querySelectorAll('.colonne--cible')
      .forEach(n => n.classList.remove('colonne--cible'));

    const viser = (corps) => {
      oublierCible();
      const col = corps ? corps.closest('.colonne') : null;
      if (col) col.classList.add('colonne--cible');
    };

    const nettoyer = () => {
      oublierCible();
      tableau.querySelectorAll('.dossier--emporte').forEach(n => n.classList.remove('dossier--emporte'));
    };

    /* --- souris ---------------------------------------------------------- */
    tableau.addEventListener('dragstart', (ev) => {
      const carte = ev.target.closest('.dossier');
      if (!carte) return;
      emporte = carte.dataset.dossier;
      carte.classList.add('dossier--emporte');
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', emporte); } catch (err) {}
      }
    });

    tableau.addEventListener('dragend', () => { emporte = null; nettoyer(); });

    tableau.addEventListener('dragover', (ev) => {
      if (!emporte) return;
      /* Sans ce refus du comportement par défaut, le navigateur n'accepte
         aucun dépôt : c'est le piège classique du glisser-déposer. */
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      viser(ev.target.closest('.colonne__corps'));
    });

    /* Sortir du tableau éteint la colonne visée, mais la fiche reste « en
       main » : le glissement, lui, n'est pas terminé. */
    tableau.addEventListener('dragleave', (ev) => {
      if (emporte && !tableau.contains(ev.relatedTarget)) oublierCible();
    });

    tableau.addEventListener('drop', (ev) => {
      const corps = ev.target.closest('.colonne__corps');
      const id = emporte || (ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '');
      ev.preventDefault();
      emporte = null;
      nettoyer();
      if (corps && id) deplacer(id, corps.dataset.etape);
    });

    /* --- doigt ----------------------------------------------------------- */
    const lacher = () => {
      if (touche && touche.minuteur) clearTimeout(touche.minuteur);
      touche = null;
      nettoyer();
    };

    tableau.addEventListener('touchstart', (ev) => {
      if (ev.touches.length > 1) { lacher(); return; }
      const carte = ev.target.closest('.dossier');
      if (!carte) return;
      const t = ev.touches[0];
      touche = { id: carte.dataset.dossier, carte, x: t.clientX, y: t.clientY, prise: false };
      touche.minuteur = setTimeout(() => {
        touche.prise = true;
        carte.classList.add('dossier--emporte');
        if (navigator.vibrate) navigator.vibrate(12);
      }, 320);
    }, { passive: true });

    tableau.addEventListener('touchmove', (ev) => {
      if (!touche) return;
      const t = ev.touches[0];
      if (!touche.prise) {
        /* Le doigt bouge avant la fin de l'appui long : la personne fait
           défiler, elle ne déménage pas une fiche. On lui laisse la main. */
        if (Math.abs(t.clientX - touche.x) > 8 || Math.abs(t.clientY - touche.y) > 8) lacher();
        return;
      }
      ev.preventDefault();
      const sous = document.elementFromPoint(t.clientX, t.clientY);
      viser(sous ? sous.closest('.colonne__corps') : null);
    }, { passive: false });

    tableau.addEventListener('touchend', (ev) => {
      if (!touche) return;
      const prise = touche.prise;
      const id = touche.id;
      const cible = tableau.querySelector('.colonne--cible');
      lacher();
      if (!prise) return;
      /* Le relâchement d'un appui long produit encore un clic : sans ce
         garde-fou, la fiche déposée ouvrirait le dossier dans la foulée. */
      ev.preventDefault();
      avaleClic = true;
      setTimeout(() => { avaleClic = false; }, 400);
      if (cible && id) deplacer(id, cible.dataset.etape);
    });

    tableau.addEventListener('touchcancel', lacher);

    tableau.addEventListener('click', (ev) => {
      if (!avaleClic) return;
      avaleClic = false;
      ev.preventDefault();
      ev.stopPropagation();
    }, true);

    /* --- clavier --------------------------------------------------------- */
    tableau.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      const carte = ev.target.closest('.dossier');
      if (!carte) return;
      const d = lit.dossier(e, carte.dataset.dossier);
      if (!d) return;
      const i = CLES_ETAPES.indexOf(d.etape);
      const vers = CLES_ETAPES[i + (ev.key === 'ArrowRight' ? 1 : -1)];
      if (!vers) return;
      ev.preventDefault();
      deplacer(d.id, vers);
    });
  }

  /* ======================================================================
     VUE LISTE
     ====================================================================== */

  const COLONNES_LISTE = [
    { cle: 'etape', nom: 'Étape', valeur: (d) => CLES_ETAPES.indexOf(d.etape) },
    { cle: 'dossier', nom: 'Dossier', valeur: (d) => d.numero || lit.titreDossier(e, d) },
    { cle: 'vehicule', nom: 'Véhicule', valeur: (d) => {
        const v = lit.vehicule(e, d.vehiculeId); return v ? v.immat : '';
      } },
    { cle: 'client', nom: 'Client', valeur: (d) => lit.nomClientTri(lit.client(e, d.clientId)) },
    /* Les dossiers sans place se rangent après les autres, jamais entre. */
    { cle: 'place', nom: 'Place', valeur: (d) => d.place || '￿' },
    { cle: 'depuis', nom: 'Depuis', num: true, valeur: (d) => d.entree || d.cree || 0 },
    { cle: 'assigne', nom: 'Assigné', valeur: (d) => (d.assignes || [])
        .map(i => lit.nomUtilisateur(lit.utilisateur(e, i))).join(' ') },
    { cle: 'total', nom: 'Total', num: true, valeur: (d) => lit.totauxDossier(e, d).ttc }
  ];

  function trierListe(liste) {
    if (!pref.tri) return liste.slice().sort(lit.triDossiers);
    const col = COLONNES_LISTE.find(c => c.cle === pref.tri);
    if (!col) return liste.slice().sort(lit.triDossiers);
    const signe = pref.sens === 'desc' ? -1 : 1;
    return liste.slice().sort((a, b) => {
      const va = col.valeur(a);
      const vb = col.valeur(b);
      const c = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : compareTexte(va, vb);
      return c * signe || lit.triDossiers(a, b);
    });
  }

  function vueListe(liste) {
    const rangs = trierListe(liste);

    const teteColonne = (col) => {
      const actif = pref.tri === col.cle;
      return h('th' + (col.num ? '.num' : ''), h('button.atelier-tri', {
        type: 'button',
        'aria-label': 'Trier par ' + col.nom,
        onclick: () => {
          if (actif) pref.sens = pref.sens === 'asc' ? 'desc' : 'asc';
          else { pref.tri = col.cle; pref.sens = 'asc'; }
          refaireZone();
        }
      }, [
        h('span', col.nom),
        actif ? icone(pref.sens === 'asc' ? 'haut' : 'bas', { taille: 12 }) : null
      ]));
    };

    const ligne = (d) => {
      const v = lit.vehicule(e, d.vehiculeId);
      const c = lit.client(e, d.clientId);
      const jours = lit.joursDansAtelier(d);
      const t = lit.totauxDossier(e, d);
      const ouvrir = () => { location.hash = '#/dossier/' + d.id; };

      return h('tr.cliquable', {
        tabindex: 0,
        onclick: ouvrir,
        onkeydown: (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrir(); }
        }
      }, [
        h('td', { donnees: { col: 'Étape' } }, pastilleEtape(d.etape)),
        h('td', { donnees: { col: 'Dossier' } }, [
          h('div.gras.num', d.numero || '—'),
          h('div.petit.faible.coupe', lit.titreDossier(e, d))
        ]),
        /* Une cellule laissée vraiment vide disparaît sur téléphone, où
           chaque ligne se replie en fiche : pas de « Place : — » inutile. */
        h('td', { donnees: { col: 'Véhicule' } }, v
          ? [plaque(v.immat), h('div.petit.faible.coupe', lit.nomVehicule(v))]
          : null),
        h('td', { donnees: { col: 'Client' } }, c ? lit.nomClient(c) : null),
        h('td', { donnees: { col: 'Place' } },
          d.place ? h('span.etiq', [icone('parc', { taille: 12 }), h('span', d.place)]) : null),
        h('td.num', {
          donnees: { col: 'Depuis' },
          title: 'Entré le ' + fmt.date(d.entree || d.cree, 'normal')
        }, jours === 0 ? 'aujourd’hui' : pluriel(jours, 'jour')),
        h('td', { donnees: { col: 'Assigné' } }, tetes(e, d.assignes)),
        h('td.num', { donnees: { col: 'Total' } }, fmt.euros(t.ttc))
      ]);
    };

    return h('div.tableau-cadre', h('table.grille.repliable', [
      h('thead', h('tr', COLONNES_LISTE.map(teteColonne))),
      h('tbody', rangs.map(ligne))
    ]));
  }

  /* ======================================================================
     MISE EN PLACE
     ====================================================================== */

  majEnTete();
  majBandeau();
  majVue();
  majFiltres();
  refaireZone();

  poser(racine, [
    zoneEnTete,
    zoneBandeau,
    h('div.rang.enroule', [h('div.grandit', recherche), zoneVue]),
    zoneFiltres,
    zone
  ]);

  /* L'écran garde la main sur les changements de largeur : la colonne unique
     n'a plus de sens quand le mur entier tient à l'écran, et son sélecteur
     disparaît. */
  vivant = {
    racine,
    surLargeur: (etroit) => {
      if (etroit || pref.etapeSeule === 'tout') return;
      pref.etapeSeule = 'tout';
      majFiltres();
      refaireZone();
    }
  };

  return racine;
}

/* ==========================================================================
   LARGEUR D'ÉCRAN
   ========================================================================== */

function brancherLargeur() {
  const reagir = () => {
    if (!vivant) return;
    /* L'écran précédent a pu être remplacé sans prévenir : s'il n'est plus
       dans le document, on oublie. */
    if (!document.body.contains(vivant.racine)) { vivant = null; return; }
    vivant.surLargeur(veille.matches);
  };
  /* Safari n'a longtemps connu que `addListener` sur les requêtes de média. */
  if (veille.addEventListener) veille.addEventListener('change', reagir);
  else if (veille.addListener) veille.addListener(reagir);
}
