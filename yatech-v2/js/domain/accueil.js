/* ==========================================================================
   YATECH — l'accueil de chacun
   --------------------------------------------------------------------------
   Trois personnes ne regardent pas les mêmes choses le matin. La secrétaire
   veut les appels et ce qui reste à facturer ; le technicien veut sa journée
   et les pièces qui manquent ; le responsable veut ce qui traîne.

   Un écran d'accueil qui montre la même chose à tout le monde oblige chacun
   à sauter deux blocs pour trouver le sien. On laisse donc chacun ranger le
   sien — l'ordre et ce qu'il masque — et on garde le reste identique.

   Ce module ne connaît pas les écrans : il ne manipule que des clés. C'est
   l'écran d'accueil qui sait dessiner ce qu'il y a derrière.
   ========================================================================== */

/* Les blocs pleine largeur, en haut. L'ordre ne se change pas : au-dessus de
   tout, ce qui presse ; en dessous, ce qu'on fait. Inverser les deux ferait
   passer les alertes sous la pliure. */
export const BLOCS_HAUT = [
  { cle: 'raccourcis',  nom: 'Les raccourcis' },
  { cle: 'alertes',     nom: 'Ce qui presse' },
  { cle: 'indicateurs', nom: 'Les chiffres du jour' }
];

/* Les panneaux, sur deux colonnes. Ceux-là se rangent comme on veut. */
export const BLOCS_COLONNES = [
  { cle: 'journee',   nom: 'Ma journée' },
  { cle: 'rendre',    nom: 'À rendre aujourd’hui' },
  { cle: 'commandes', nom: 'Les pièces qu’on attend' },
  { cle: 'attente',   nom: 'Ce qui attend quelqu’un d’autre' },
  { cle: 'appels',    nom: 'Les appels' },
  { cle: 'pensebetes',nom: 'Les pense-bêtes' }
];

const TOUS = BLOCS_HAUT.concat(BLOCS_COLONNES);
const CLES = TOUS.map(b => b.cle);

/* L'accueil d'origine n'est pas le même selon l'écran, et c'est voulu.

   Sur un écran de bureau les panneaux se rangent en colonnes : on montre tout,
   c'est justement l'intérêt d'avoir la place. Sur un téléphone, chaque panneau
   coûte un tiers d'écran de défilement, alors on retire celui qui redit les
   alertes — « ce qui attend quelqu'un d'autre ».

   Dès que la personne range son accueil, c'est son choix qui vaut, sur les
   deux écrans : elle a décidé, on n'y revient pas. */
export const CACHES_DORIGINE = { grand: [], telephone: ['attente'] };

/**
 * Les préférences d'accueil d'une personne, jamais nulles.
 * @param {object} moi
 * @param {string[]} [defaut]  ce qui est masqué tant qu'elle n'a rien rangé
 */
function prefs(moi, defaut) {
  const p = (moi && moi.preferences && moi.preferences.accueil) || null;
  if (!p) return { ordre: [], caches: (defaut || []).slice() };
  return {
    ordre: Array.isArray(p.ordre) ? p.ordre : [],
    caches: Array.isArray(p.caches) ? p.caches : []
  };
}

/**
 * L'ordre des panneaux à deux colonnes, pour cette personne.
 *
 * On se méfie de ce qui est enregistré : une sauvegarde d'une version
 * antérieure, un bloc disparu depuis, un doublon. Sans ce filtre, le même
 * panneau s'afficherait deux fois et un autre jamais.
 */
export function ordreColonnes(moi) {
  const voulu = prefs(moi).ordre;
  const defaut = BLOCS_COLONNES.map(b => b.cle);
  const garde = [];
  for (const k of voulu) if (defaut.includes(k) && !garde.includes(k)) garde.push(k);
  /* Un bloc ajouté par une mise à jour se range à sa place d'origine plutôt
     que d'atterrir à la fin, où personne ne le verrait. */
  /* Un panneau ajouté par une mise à jour se range à la fin, jamais au
     milieu : on ne bouscule pas ce que la personne a arrangé pour lui faire
     de la place. Elle le remontera si elle le veut. */
  return garde.concat(defaut.filter(k => !garde.includes(k)));
}

/** Ce bloc est-il visible pour cette personne ? */
export function blocVisible(moi, cle, defaut) {
  return !prefs(moi, defaut).caches.includes(cle);
}

/** Les blocs du haut qui restent affichés. */
export const hautVisible = (moi, defaut) =>
  BLOCS_HAUT.filter(b => blocVisible(moi, b.cle, defaut));

/** Les panneaux visibles, dans l'ordre choisi. */
export const colonnesVisibles = (moi, defaut) =>
  ordreColonnes(moi).filter(k => blocVisible(moi, k, defaut));

/**
 * Répartit les panneaux en colonnes, dans l'ordre : on remplit la première,
 * puis la deuxième. Monter un panneau le fait monter, et rien d'autre —
 * c'est la seule règle qu'on peut expliquer debout devant l'écran.
 *
 * Le nombre de colonnes vient de l'écran, donc de l'appelant : ce module ne
 * regarde pas la fenêtre, c'est ce qui le rend vérifiable.
 *
 * @param {string[]} cles
 * @param {number} [combien]  2 par défaut
 * @returns {string[][]} toujours `combien` colonnes, éventuellement vides
 */
export function colonnes(cles, combien) {
  const n = Math.max(1, combien || 2);
  /* On répartit au plus juste : quatre panneaux sur trois colonnes donnent
     2-1-1, pas 2-2-0. Découper bêtement en tranches de `ceil(4/3)` laissait
     la troisième colonne vide et un grand blanc à droite de l'écran. */
  const base = Math.floor(cles.length / n);
  const reste = cles.length % n;
  const sortie = [];
  let i = 0;
  for (let c = 0; c < n; c++) {
    const combienIci = base + (c < reste ? 1 : 0);
    sortie.push(cles.slice(i, i + combienIci));
    i += combienIci;
  }
  return sortie;
}

/** Le cas courant : deux colonnes. */
export const deuxColonnes = (cles) => colonnes(cles, 2);

/** Le nom lisible d'un bloc. */
export const nomBloc = (cle) => (TOUS.find(b => b.cle === cle) || {}).nom || cle;

/**
 * Range les préférences après un geste de l'écran de réglage.
 * Rend un objet prêt à écrire dans `preferences.accueil`.
 */
export function rangees(ordre, caches) {
  return {
    ordre: (ordre || []).filter(k => BLOCS_COLONNES.some(b => b.cle === k)),
    caches: (caches || []).filter(k => CLES.includes(k))
  };
}

/* ==========================================================================
   LES RACCOURCIS
   Ce qu'on fait dix fois par jour. Pas la même chose selon qui on est.
   ========================================================================== */

export const RACCOURCIS = {
  dossier:  { nom: 'Nouveau dossier', icone: 'plus',      fort: true },
  appel:    { nom: 'Appel reçu',      icone: 'telephone' },
  pensebete:{ nom: 'Pense-bête',      icone: 'epingle' },
  planning: { nom: 'Planning',        icone: 'planning',  vers: '/planning' },
  atelier:  { nom: 'Atelier',         icone: 'atelier',   vers: '/atelier' },
  parc:     { nom: 'Parc',            icone: 'parc',      vers: '/parc' },
  devis:    { nom: 'Devis',           icone: 'devis',     vers: '/devis' },
  factures: { nom: 'Factures',        icone: 'facture',   vers: '/factures' },
  clients:  { nom: 'Clients',         icone: 'clients',   vers: '/clients' },
  stock:    { nom: 'Stock',           icone: 'stock',     vers: '/stock' },
  electro:  { nom: 'Électronique',    icone: 'puce',      vers: '/electronique' },
  tarifs:   { nom: 'Tarifs',          icone: 'euro',      vers: '/tarifs' }
};

export const RACCOURCIS_DEFAUT = ['dossier', 'appel', 'pensebete', 'planning'];

/** Les raccourcis de cette personne, nettoyés de ce qui n'existe plus. */
export function raccourcisDe(moi) {
  const p = moi && moi.preferences ? moi.preferences.raccourcis : null;
  const voulu = Array.isArray(p) ? p : null;
  const liste = (voulu || RACCOURCIS_DEFAUT).filter(k => RACCOURCIS[k]);
  /* Tout masquer laisserait une barre vide et aucun moyen d'en remettre :
     on garde au moins le geste principal. */
  return liste.length ? liste : ['dossier'];
}
