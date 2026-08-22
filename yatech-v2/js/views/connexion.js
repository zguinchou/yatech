/* ==========================================================================
   YATECH — écran de connexion
   --------------------------------------------------------------------------
   Par défaut, il n'y a pas de code : on choisit qui travaille, on entre. Un
   code ne rendrait pas l'outil inviolable — tout ce qui vit dans un navigateur
   est lisible par qui a la main sur l'appareil — et il enfermait dehors ceux
   qui l'oubliaient.

   Le garage qui veut séparer les rôles allume « Demander un code » dans
   Réglages → Équipe. Alors seulement le pavé apparaît. Il est fait pour le
   pouce : on tape son code d'une main, avec des gants, sans regarder. Et il
   garde toujours une porte de sortie : un code oublié se retire.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import { icone } from '../core/icones.js';
import { message, confirmer } from '../core/ui.js';
import { S, maj } from '../core/store.js';
import { verifier } from '../core/crypto.js';
import { ROLES, nouvelUtilisateur } from '../domain/schema.js';
import { nomUtilisateur } from '../domain/selecteurs.js';
import { ouvrirSession } from '../main.js';
import { tete } from '../ui/widgets.js';

const LONGUEUR = 4;

export function peindre(ctx) {
  const e = ctx.etat;
  const equipe = (e.utilisateurs || []).filter(u => u.actif);

  /* Le réglage du garage décide. Sans code demandé, l'écran n'est plus qu'un
     sélecteur de personne — utile quand on se passe le téléphone à l'atelier. */
  const codeDemande = e.reglages.demanderCode !== false;

  let choisi = (equipe.length === 1 && codeDemande) ? equipe[0] : null;
  let code = '';
  let etape = choisi ? 'code' : 'qui';

  const zone = h('div.connexion__boite');

  /* ---------------------------------------------------------------------- */
  function peindreTout() {
    poser(zone, [
      h('div.connexion__marque', [
        h('img', { src: 'assets/icone.svg', alt: '', width: 52, height: 52 }),
        h('strong', e.reglages.nomOutil || 'Yatech'),
        h('div.petit.faible', e.reglages.raisonSociale || 'Gestion d’atelier')
      ]),
      etape === 'qui' ? choixPersonne() : saisieCode()
    ]);
  }

  function entrer(u) {
    ouvrirSession(u);
    const p = u.preferences || {};
    location.hash = '#' + (p.ecranAccueil || e.reglages.ecranAccueil || '/');
  }

  /* --- première étape : qui êtes-vous ? ---------------------------------- */
  function choixPersonne() {
    if (!equipe.length) {
      return h('div.pile', [
        h('div.bandeau.bandeau--alerte', [
          icone('alerte'),
          h('div', 'Aucun compte actif. Créez la première personne pour commencer.')
        ]),
        h('button.bt.bt--fort.bt--plein.bt--pouce', {
          type: 'button', onclick: creerPremierCompte
        }, 'Créer mon compte')
      ]);
    }
    return h('div.pile', [
      h('div.majuscule', 'Qui travaille ?'),
      h('div.connexion__equipe', equipe.map(u =>
        h('button.connexion__qui', {
          type: 'button',
          onclick: () => {
            choisi = u;
            code = '';
            /* Sans code demandé — ou pour quelqu'un qui n'en a pas posé — un
               clic suffit. On ne fait pas taper quatre chiffres pour rien. */
            if (!codeDemande || !u.verrou) { entrer(u); return; }
            etape = 'code';
            peindreTout();
          }
        }, [
          tete(u, 'l'),
          h('div.grandit', [
            h('div.gras', nomUtilisateur(u)),
            h('div.petit.faible', ROLES[u.role] ? ROLES[u.role].nom : '')
          ]),
          icone('droite', { taille: 16 })
        ])
      )),
      codeDemande ? null : h('div.petit.tres-faible',
        'Aucun code n’est demandé. Pour en exiger un : Réglages → Équipe.')
    ]);
  }

  /* --- deuxième étape : le code ------------------------------------------- */
  function saisieCode() {
    const points = h('div.points', Array.from({ length: LONGUEUR }, (_, i) =>
      h('i' + (i < code.length ? '.plein' : ''))));

    /* Un champ caché reçoit le clavier physique : au comptoir, on tape son
       code sans toucher l'écran. */
    const cache = h('input', {
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': 'Code',
      style: { position: 'absolute', opacity: 0, width: '1px', height: '1px', pointerEvents: 'none' },
      oninput: (ev) => {
        code = String(ev.target.value || '').replace(/\D/g, '').slice(0, LONGUEUR);
        majPoints();
        if (code.length === LONGUEUR) valider();
      },
      onkeydown: (ev) => { if (ev.key === 'Enter' && code.length) valider(); }
    });

    function majPoints() {
      poser(points, Array.from({ length: LONGUEUR }, (_, i) =>
        h('i' + (i < code.length ? '.plein' : ''))));
      cache.value = code;
    }

    function taper(chiffre) {
      if (code.length >= LONGUEUR) return;
      code += chiffre;
      majPoints();
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
      if (code.length === LONGUEUR) setTimeout(valider, 90);
    }

    function effacer() {
      code = code.slice(0, -1);
      majPoints();
    }

    function refuser(texte) {
      code = '';
      majPoints();
      points.classList.add('points--faux');
      setTimeout(() => points.classList.remove('points--faux'), 340);
      if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (err) {} }
      message(texte, { ton: 'danger', duree: 1800 });
    }

    function valider() {
      if (!choisi || !choisi.verrou) return;
      if (verifier(code, choisi.verrou)) { entrer(choisi); return; }
      refuser('Code incorrect');
    }

    /* Un code oublié n'enferme personne dehors. Ce n'est pas une faille qu'on
       ouvre : les données sont déjà en clair dans cet appareil, celui qui l'a
       en main peut les lire de dix façons. Le code sépare les rôles, il ne
       garde pas un coffre. */
    async function oublie() {
      const ok = await confirmer({
        titre: 'Code oublié ?',
        texte: 'Le code de ' + nomUtilisateur(choisi) + ' va être retiré.',
        detail: 'L’outil s’ouvrira sans rien demander. Vous pourrez en poser un '
          + 'nouveau quand vous voudrez, dans Réglages → Équipe.',
        avertissement: 'Faites-le depuis l’appareil du garage : n’importe qui '
          + 'ayant ce téléphone en main pourra ensuite entrer.',
        ok: 'Retirer le code'
      });
      if (!ok) return;
      maj('Code de ' + nomUtilisateur(choisi) + ' retiré', (etat) => {
        const u = etat.utilisateurs.find(x => x.id === choisi.id);
        if (u) u.verrou = null;
      });
      choisi = (S.etat.utilisateurs || []).find(x => x.id === choisi.id) || choisi;
      entrer(choisi);
      message('Code retiré. Posez-en un nouveau dans Réglages → Équipe si besoin.',
        { ton: 'ok', duree: 6000 });
    }

    const touche = (t, action, classe) => h('button' + (classe || ''), {
      type: 'button', onclick: action
    }, t);

    setTimeout(() => { try { cache.focus({ preventScroll: true }); } catch (err) {} }, 60);

    return h('div.pile', [
      h('div.rang', [
        equipe.length > 1 ? h('button.bt.bt--nu.bt--icone.bt--s', {
          type: 'button', 'aria-label': 'Changer de personne',
          onclick: () => { etape = 'qui'; code = ''; peindreTout(); }
        }, icone('gauche')) : null,
        tete(choisi),
        h('div.grandit', [
          h('div.gras', nomUtilisateur(choisi)),
          h('div.petit.faible', 'Entrez votre code')
        ])
      ]),
      cache,
      points,
      h('div.pave', [
        touche('1', () => taper('1')), touche('2', () => taper('2')), touche('3', () => taper('3')),
        touche('4', () => taper('4')), touche('5', () => taper('5')), touche('6', () => taper('6')),
        touche('7', () => taper('7')), touche('8', () => taper('8')), touche('9', () => taper('9')),
        touche('', () => {}, '.pave--nu'),
        touche('0', () => taper('0')),
        h('button.pave--nu', {
          type: 'button', 'aria-label': 'Effacer', onclick: effacer
        }, icone('gauche', { taille: 20 }))
      ]),
      h('button.bt.bt--nu.bt--s.centre', {
        type: 'button', style: { alignSelf: 'center' }, onclick: oublie
      }, 'Code oublié ?')
    ]);
  }

  /* --- créer le premier compte, quand l'équipe est vide -------------------- */
  function creerPremierCompte() {
    const prenom = h('input.saisie', { placeholder: 'Prénom', autofocus: true });
    const nom = h('input.saisie', { placeholder: 'Nom' });
    poser(zone, [
      h('div.connexion__marque', [
        h('img', { src: 'assets/icone.svg', alt: '', width: 52, height: 52 }),
        h('strong', e.reglages.nomOutil || 'Yatech')
      ]),
      h('div.champ', [h('label', 'Votre prénom'), prenom]),
      h('div.champ', [h('label', 'Votre nom'), nom]),
      h('button.bt.bt--fort.bt--plein.bt--pouce', {
        type: 'button',
        onclick: () => {
          const p = prenom.value.trim();
          if (!p) { prenom.setAttribute('aria-invalid', 'true'); prenom.focus(); return; }
          const cree = maj('Premier compte créé', (etat) => {
            const u = nouvelUtilisateur({
              prenom: p, nom: nom.value.trim(), role: 'patron', couleur: 38
            });
            etat.utilisateurs.push(u);
            return u;
          });
          /* Le compte vient de naître : il n'a pas de code, on entre. */
          if (cree) entrer(cree);
        }
      }, 'Continuer')
    ]);
  }

  peindreTout();

  return h('div.connexion', [
    zone,
    h('div.petit.tres-faible.centre', { style: { marginTop: 'var(--e-4)' } },
      'Les données restent sur cet appareil.')
  ]);
}
