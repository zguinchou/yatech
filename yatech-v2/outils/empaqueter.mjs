/* ==========================================================================
   YATECH — tout l'outil en un seul fichier
   --------------------------------------------------------------------------
   À lancer avec :   node outils/empaqueter.mjs [fichier-de-sortie.html]

   Le site normal charge quarante-cinq modules : parfait sur un hébergeur,
   impossible ailleurs. Ce script rassemble tout — styles, code, icône — dans
   un seul fichier HTML qui s'ouvre en double-cliquant dessus. Utile pour le
   montrer sans réseau, l'envoyer en pièce jointe, ou le poser sur une clé.

   Le principe : chaque module devient une fonction, et un petit registre
   remplace le chargeur du navigateur. C'est sûr parce que le projet n'a aucune
   dépendance circulaire et aucun export par défaut — le script s'arrête net
   s'il rencontre une forme d'import ou d'export qu'il ne sait pas traduire,
   plutôt que de produire un fichier à moitié juste.

   Le fichier produit charge le jeu de démonstration au premier lancement :
   c'est une vitrine, pas un poste de travail. Pour travailler pour de vrai,
   c'est le site qu'il faut, avec ses sauvegardes.
   ========================================================================== */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le projet est le dossier au-dessus de celui-ci : le script se déplace avec
   lui, on ne code aucun chemin en dur. */
const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = process.argv[2] || join(R, 'yatech-un-seul-fichier.html');

/* --- l'ordre de chargement n'importe pas : le registre est paresseux ------ */
function fichiers(d, out = []) {
  for (const e of readdirSync(join(R, d), { withFileTypes: true })) {
    const c = d + '/' + e.name;
    if (e.isDirectory()) fichiers(c, out); else if (e.name.endsWith('.js')) out.push(c);
  }
  return out;
}
const modules = fichiers('js');

const cle = (depuis, spec) => resolve('/' + dirname(depuis), spec).slice(1);

/* --- traduction d'un module ---------------------------------------------- */
function traduire(chemin) {
  let s = readFileSync(join(R, chemin), 'utf8');
  const exportes = new Set();
  const lignes = [];

  /* export { x } from './y.js'  → réexport */
  s = s.replace(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, liste, spec) => {
    const cible = cle(chemin, spec);
    /* Un réexport n'a pas de liaison locale : on l'assigne ici, et surtout on
       ne l'ajoute PAS à la liste des exports, sinon on émettrait plus bas un
       « __e.vide = vide » qui ne désigne rien. */
    const bouts = liste.split(',').map(x => x.trim()).filter(Boolean).map(x => {
      const [de, vers] = x.split(/\s+as\s+/).map(y => y.trim());
      return '__e[' + JSON.stringify(vers || de) + '] = __req(' + JSON.stringify(cible) + ')[' + JSON.stringify(de) + '];';
    });
    return bouts.join(' ');
  });

  /* import * as ns from './x.js' */
  s = s.replace(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (_, ns, spec) => 'const ' + ns + ' = __req(' + JSON.stringify(cle(chemin, spec)) + ');');

  /* import { a, b as c } from './x.js'   (éventuellement sur plusieurs lignes) */
  s = s.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, liste, spec) => {
    const bouts = liste.split(',').map(x => x.trim()).filter(Boolean).map(x => {
      const [de, vers] = x.split(/\s+as\s+/).map(y => y.trim());
      return vers ? de + ': ' + vers : de;
    });
    return 'const { ' + bouts.join(', ') + ' } = __req(' + JSON.stringify(cle(chemin, spec)) + ');';
  });

  /* import './x.js'  (pour l'effet de bord seul) */
  s = s.replace(/^\s*import\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_, spec) => '__req(' + JSON.stringify(cle(chemin, spec)) + ');');

  /* import('./x.js')  → le registre, enveloppé dans une promesse */
  s = s.replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g,
    (_, spec) => 'Promise.resolve(__req(' + JSON.stringify(cle(chemin, spec)) + '))');

  /* export function / class / const / let / var */
  s = s.replace(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, (m, a, nom) => {
    exportes.add(nom); return (a || '') + 'function ' + nom;
  });
  s = s.replace(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, (m, nom) => {
    exportes.add(nom); return 'class ' + nom;
  });
  s = s.replace(/^export\s+(const|let|var)\s+([\s\S]*?)(?==)/gm, (m, mot, reste) => {
    /* « export const a = … » et « export const a = 1, b = 2 » : on ne retient
       que le premier nom déclaré ici, les suivants sont pris plus bas. */
    const nom = reste.trim().split(/[\s,=:]/)[0];
    if (nom) exportes.add(nom);
    return mot + ' ' + reste;
  });

  /* export { a, b as c }  (autonome) */
  s = s.replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, (_, liste) => {
    liste.split(',').map(x => x.trim()).filter(Boolean).forEach(x => {
      const [de, vers] = x.split(/\s+as\s+/).map(y => y.trim());
      lignes.push('__e[' + JSON.stringify(vers || de) + '] = ' + de + ';');
    });
    return '';
  });

  if (/^\s*export\s/m.test(s)) {
    const reste = s.match(/^\s*export\s.*/m);
    throw new Error('export non traduit dans ' + chemin + ' : ' + (reste ? reste[0].slice(0, 80) : ''));
  }
  if (/^\s*import[\s{*'"]/m.test(s)) {
    const reste = s.match(/^\s*import[\s{*'"].*/m);
    throw new Error('import non traduit dans ' + chemin + ' : ' + (reste ? reste[0].slice(0, 80) : ''));
  }

  for (const nom of exportes) lignes.push('__e[' + JSON.stringify(nom) + '] = ' + nom + ';');
  return s + '\n' + lignes.join('\n') + '\n';
}

/* --- l'icône, en ligne ---------------------------------------------------- */
const svg = readFileSync(join(R, 'assets/icone.svg'), 'utf8');
const iconeUri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');

/* --- les modules ----------------------------------------------------------- */
let corps = '';
for (const m of modules) {
  let code = traduire(m);
  code = code.split("'assets/icone.svg'").join(JSON.stringify(iconeUri));
  /* Pas de service worker dans un fichier isolé : rien à mettre en cache. */
  if (m === 'js/main.js') {
    code = code.replace("if (!('serviceWorker' in navigator)) return;",
      "return; /* fichier isolé : pas de service worker */");
  }
  corps += '\n__mods[' + JSON.stringify(m) + '] = function (__e, __req) {\n' + code + '\n};\n';
}

/* --- les feuilles de style -------------------------------------------------- */
const CSS = ['jetons', 'base', 'composants', 'coque', 'ecrans', 'utilitaires', 'impression']
  .map(n => '/* ===== ' + n + '.css ===== */\n' + readFileSync(join(R, 'css/' + n + '.css'), 'utf8'))
  .join('\n');

/* --- l'enveloppe -------------------------------------------------------------- */
const html = `<meta charset="utf-8">
<title>Yatech Atelier</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${iconeUri}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
${CSS}

/* --- propre à la version d'un seul fichier -------------------------------- */
html, body { height: 100%; }
.essai-bandeau {
  position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%);
  z-index: 8000; display: flex; align-items: center; gap: var(--e-2);
  padding: 6px 12px; border-radius: var(--r-rond);
  background: var(--plan); border: 1px solid var(--trait);
  box-shadow: var(--ombre-2); font: 500 var(--t-xs)/1 var(--f-texte);
  color: var(--encre-2); pointer-events: none;
}
@media (max-width: 900px) { .essai-bandeau { bottom: calc(var(--onglets-h) + 8px); } }
</style>

<div id="amorce" class="amorce">
  <div class="amorce__marque">YATECH</div>
  <div class="amorce__barre"><i></i></div>
</div>
<div id="app" hidden></div>
<div id="calque-modales"></div>
<div id="calque-messages" class="messages" aria-live="polite"></div>
<div id="impression" class="impression"></div>
<div class="essai-bandeau">Démonstration · les données restent dans votre navigateur</div>

<script type="module">
/* ==========================================================================
   YATECH — version d'un seul fichier
   Le même code que le site, rassemblé pour s'ouvrir n'importe où. Un petit
   registre remplace le chargeur de modules du navigateur.
   ========================================================================== */
const __mods = {};
const __cache = {};
function __req(id) {
  if (__cache[id]) return __cache[id];
  const __e = {};
  __cache[id] = __e;
  const f = __mods[id];
  if (!f) throw new Error('module absent : ' + id);
  f(__e, __req);
  return __e;
}
${corps}

/* Un garage vide ne montre rien : au premier passage, on charge la
   démonstration. Ensuite, ce sont vos données — on n'y retouche plus. */
(async function demarrerLaDemonstration() {
  const base = __req('js/core/db.js');
  const schema = __req('js/domain/schema.js');
  const demo = __req('js/domain/demo.js');

  /* La page d'accueil peut avoir posé son propre thème sur la racine, en
     anglais. On le traduit une fois, pour ouvrir dans le thème que la
     personne a choisi plutôt que dans celui de son système. */
  const stamp = document.documentElement.dataset.theme;
  const theme = stamp === 'dark' ? 'sombre' : (stamp === 'light' ? 'clair' : null);

  try {
    await base.demarrer();
    let doc = await base.lireEtat();
    /* Un garage vide ne montre rien : au premier passage, on charge la
       démonstration. Ensuite ce sont vos données, on n'y retouche plus. */
    if (!doc || !Array.isArray(doc.dossiers) || !doc.dossiers.length) {
      doc = schema.normaliser(demo.jeuDemo());
    }
    if (theme) { doc.reglages = doc.reglages || {}; doc.reglages.theme = theme; }
    await base.ecrireEtat(doc);
  } catch (e) { /* stockage refusé : l'outil démarrera sur un garage neuf */ }

  __req('js/main.js');
})();
</script>`;

writeFileSync(sortie, html);
console.log('écrit : ' + sortie);
console.log('poids : ' + Math.round(html.length / 1024) + ' Ko  ('
  + modules.length + ' modules, ' + Math.round(CSS.length / 1024) + ' Ko de styles)');
