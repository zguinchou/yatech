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
  { cle: 'attente',   nom: 'Ce qui attend quelqu’un d’autre' },
  { cle: 'appels',    nom: 'Les appels' },
  { cle: 'pensebetes',nom: 'Les pense-bêtes' }
];

const TOUS = BLOCS_HAUT.concat(BLOCS_COLONNES);
const CLES = TOUS.map(b => b.cle);

/** Les préférences d'accueil d'une personne, jamais nulles. */
function prefs(moi) {
  const p = (moi && moi.preferences && moi.preferences.accueil) || {};
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
export function blocVisible(moi, cle) {
  return !prefs(moi).caches.includes(cle);
}

/** Les blocs du haut qui restent affichés. */
export const hautVisible = (moi) => BLOCS_HAUT.filter(b => blocVisible(moi, b.cle));

/** Les panneaux visibles, dans l'ordre choisi. */
export const colonnesVisibles = (moi) =>
  ordreColonnes(moi).filter(k => blocVisible(moi, k));

/**
 * Répartit les panneaux sur deux colonnes : la première moitié à gauche.
 * Monter un panneau le fait monter, et rien d'autre — c'est la seule règle
 * qu'on peut expliquer debout devant l'écran.
 */
export function deuxColonnes(cles) {
  const gauche = Math.ceil(cles.length / 2);
  return [cles.slice(0, gauche), cles.slice(gauche)];
}

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
