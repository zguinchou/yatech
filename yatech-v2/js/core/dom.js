/* ==========================================================================
   YATECH — fabrique d'éléments
   --------------------------------------------------------------------------
   Pas de moteur de gabarits, pas de dépendance : une seule fonction qui
   construit de vrais nœuds du document. Écrire l'interface en JavaScript plutôt
   qu'en chaînes de caractères ferme la porte à l'injection de code : le texte
   d'un client passe par `textContent`, jamais par `innerHTML`.

       h('div.carte', { onclick: f }, [ h('b', 'Titre'), 'du texte' ])

   Le sélecteur accepte les raccourcis CSS : `div.a.b#id`.
   ========================================================================== */

/** Construit un élément. `sel` : balise + classes + identifiant. */
export function h(sel, props, enfants) {
  /* Deuxième argument omis : `h('div', [...])` ou `h('b', 'texte')`.

     Mais si un TROISIÈME argument est là, les enfants sont déjà à leur place :
     `h('div', condition ? { style } : null, [...])` — des attributs
     conditionnels qui retombent sur null — ne doit pas les faire disparaître.
     Ça a coûté un panneau entier qui se peignait vide une ligne sur deux. */
  const pasDesProps = props !== undefined && (Array.isArray(props)
    || typeof props !== 'object' || props === null || props instanceof Node);
  if (pasDesProps) {
    if (enfants === undefined) enfants = props;
    props = null;
  }

  const parts = String(sel).split(/(?=[.#])/);
  const balise = parts[0] && !/^[.#]/.test(parts[0]) ? parts[0] : 'div';
  const noeud = document.createElement(balise);

  for (let i = (balise === parts[0] ? 1 : 0); i < parts.length; i++) {
    const p = parts[i];
    if (p[0] === '.') noeud.classList.add(p.slice(1));
    else if (p[0] === '#') noeud.id = p.slice(1);
  }

  if (props) appliquer(noeud, props);
  if (enfants !== undefined && enfants !== null) ajouter(noeud, enfants);
  return noeud;
}

/** Pose les propriétés sur un nœud existant. */
export function appliquer(noeud, props) {
  /* `type` passe en premier : changer le type d'un champ APRÈS lui avoir donné
     sa valeur peut la faire effacer par le navigateur. */
  if (props.type !== undefined && noeud.tagName === 'INPUT') {
    try { noeud.type = props.type; } catch (e) { noeud.setAttribute('type', props.type); }
  }

  for (const cle in props) {
    if (cle === 'type' && noeud.tagName === 'INPUT') continue;
    const val = props[cle];
    if (val === null || val === undefined || val === false) continue;

    if (cle === 'class' || cle === 'classe') {
      classes(noeud, val);
    } else if (cle === 'style') {
      if (typeof val === 'string') noeud.setAttribute('style', val);
      else for (const k in val) {
        if (val[k] === null || val[k] === undefined) continue;
        /* Les propriétés personnalisées (--x) ne passent pas par `style.x`. */
        if (k.startsWith('--')) noeud.style.setProperty(k, val[k]);
        else noeud.style[k] = val[k];
      }
    } else if (cle === 'dataset' || cle === 'donnees') {
      for (const k in val) if (val[k] !== null && val[k] !== undefined) noeud.dataset[k] = val[k];
    } else if (cle === 'texte') {
      noeud.textContent = val === true ? '' : String(val);
    } else if (cle === 'html') {
      /* Réservé aux fragments que NOUS fabriquons (surlignage de recherche,
         icônes). Jamais de texte venant d'un client ou d'un fichier importé. */
      noeud.innerHTML = val;
    } else if (cle.startsWith('on') && typeof val === 'function') {
      noeud.addEventListener(cle.slice(2), val);
    } else if (cle === 'ref' && typeof val === 'function') {
      val(noeud);
    } else if (cle in noeud && !ATTRIBUTS_TOUJOURS.has(cle)) {
      let v = val;
      /* Un attribut booléen reçu sous forme de texte : écrire
         `spellcheck: 'false'` mettrait la propriété à VRAI, puisque toute
         chaîne non vide l'est. C'est le genre de piège qui fait qu'un champ
         reste souligné en rouge sans qu'on comprenne pourquoi. */
      if (typeof noeud[cle] === 'boolean' && typeof v === 'string') {
        v = v !== 'false' && v !== '';
      }
      try { noeud[cle] = v; } catch (e) { noeud.setAttribute(cle, v); }
    } else {
      noeud.setAttribute(cle, val === true ? '' : val);
    }
  }
  return noeud;
}

/* `value`, `checked` et compagnie doivent passer par la propriété ; en
   revanche `list`, `form` et les `aria-*` n'existent pas comme propriété
   utilisable et doivent rester des attributs. */
const ATTRIBUTS_TOUJOURS = new Set(['list', 'form', 'role', 'download', 'target']);

function classes(noeud, val) {
  if (typeof val === 'string') { if (val.trim()) noeud.className += (noeud.className ? ' ' : '') + val.trim(); return; }
  if (Array.isArray(val)) { val.filter(Boolean).forEach(c => classes(noeud, c)); return; }
  for (const k in val) if (val[k]) noeud.classList.add(k);
}

/** Ajoute des enfants : texte, nœud, tableau, ou rien. */
export function ajouter(parent, enfants) {
  if (enfants === null || enfants === undefined || enfants === false || enfants === true) return parent;
  if (Array.isArray(enfants)) { enfants.forEach(e => ajouter(parent, e)); return parent; }
  if (enfants instanceof Node) { parent.appendChild(enfants); return parent; }
  parent.appendChild(document.createTextNode(String(enfants)));
  return parent;
}

/**
 * Vide un nœud de tous ses enfants.
 *
 * Retirer un champ qui a le focus déclenche son `blur`, et le gestionnaire de
 * `blur` — un réglage qui s'enregistre, par exemple — peut repeindre ce même
 * parent avant que la boucle ait fini. La boucle se retrouvait alors à retirer
 * un enfant qui n'était déjà plus là, et le rendu s'arrêtait sur une erreur au
 * milieu de l'écran. `replaceChildren` fait le ménage d'un coup, sans
 * parcourir une liste qui bouge sous ses pieds.
 */
export function vider(noeud) {
  if (typeof noeud.replaceChildren === 'function') {
    try { noeud.replaceChildren(); return noeud; } catch (e) { /* on repasse en douceur */ }
  }
  /* Sans `replaceChildren`, on se protège autrement : on ne retire que ce qui
     nous appartient encore. */
  while (noeud.firstChild) {
    const enfant = noeud.firstChild;
    if (enfant.parentNode !== noeud) break;
    noeud.removeChild(enfant);
  }
  return noeud;
}

/** Remplace le contenu d'un nœud. */
export function poser(parent, enfants) {
  vider(parent);
  ajouter(parent, enfants);
  return parent;
}

/** Un morceau de document sans enveloppe : pour rendre plusieurs nœuds. */
export function frag(enfants) {
  const f = document.createDocumentFragment();
  ajouter(f, enfants);
  return f;
}

/* --- raccourcis de sélection --------------------------------------------- */
export const q  = (sel, dans) => (dans || document).querySelector(sel);
export const qq = (sel, dans) => Array.from((dans || document).querySelectorAll(sel));

/** Écoute un événement sur un ancêtre et ne réagit qu'aux descendants visés.
 *  Indispensable quand le contenu est repeint : plus rien à réattacher. */
export function delegue(racine, evt, sel, fn) {
  racine.addEventListener(evt, (e) => {
    const cible = e.target.closest(sel);
    if (cible && racine.contains(cible)) fn(e, cible);
  });
}

/** Empêche l'action par défaut puis appelle la fonction. */
export const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); return fn(e); };

/** Attend la prochaine peinture : pour mesurer, ou animer une entrée. */
export const apres = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
