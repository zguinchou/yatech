/* ==========================================================================
   YATECH — stockage
   --------------------------------------------------------------------------
   Tout tient dans l'appareil. Pas de serveur, pas d'abonnement, rien à
   maintenir : l'outil s'ouvre et fonctionne, y compris sans réseau.

   Trois tiroirs :
     • « etat »    — un seul document JSON : tout le garage. Une écriture, une
                     seule, donc jamais un dossier enregistré sans son client.
     • « fichiers »— les photos et les pièces jointes, en binaire. Séparées,
                     parce qu'un état de 40 Mo serait relu à chaque sauvegarde.
     • « bulletin »— l'entrepôt de secours quand IndexedDB est refusé.

   Ce que ça n'est pas : un partage entre postes. Deux téléphones, deux bases.
   La passerelle de synchronisation (js/core/sync.js) s'occupe de ça, quand
   elle est configurée ; sans elle, on échange par fichier de sauvegarde.
   ========================================================================== */

const NOM_BASE = 'yatech';
const VERSION_BASE = 1;
const TIROIR_ETAT = 'etat';
const TIROIR_FICHIERS = 'fichiers';
const CLE_ETAT = 'document';
const CLE_SECOURS = 'yatech.etat';

let base = null;          // la connexion IndexedDB, une fois ouverte
let modeSecours = false;  // vrai si on écrit dans localStorage

/* --------------------------------------------------------------------------
   Ouverture
   -------------------------------------------------------------------------- */

function ouvrirBase() {
  return new Promise((ok, non) => {
    if (typeof indexedDB === 'undefined') return non(new Error('IndexedDB absent'));

    let demande;
    try { demande = indexedDB.open(NOM_BASE, VERSION_BASE); }
    catch (e) { return non(e); }

    demande.onupgradeneeded = () => {
      const b = demande.result;
      if (!b.objectStoreNames.contains(TIROIR_ETAT)) b.createObjectStore(TIROIR_ETAT);
      if (!b.objectStoreNames.contains(TIROIR_FICHIERS)) b.createObjectStore(TIROIR_FICHIERS);
    };
    demande.onsuccess = () => {
      const b = demande.result;
      /* Un autre onglet demande une montée de version : on lâche la connexion,
         sinon il reste bloqué indéfiniment. */
      b.onversionchange = () => { try { b.close(); } catch (e) {} base = null; };
      ok(b);
    };
    demande.onerror = () => non(demande.error || new Error('ouverture refusée'));
    demande.onblocked = () => non(new Error('base bloquée par un autre onglet'));
  });
}

/** Prépare le stockage. Rend le mode retenu : 'base' ou 'secours'. */
export async function demarrer() {
  try {
    base = await ouvrirBase();
    modeSecours = false;
    return 'base';
  } catch (e) {
    /* Navigation privée, cookies bloqués, page embarquée : IndexedDB peut être
       refusé. On continue en localStorage — moins de place, mais l'outil
       s'ouvre, et c'est tout ce qui compte à cet instant. */
    modeSecours = true;
    return 'secours';
  }
}

export const enSecours = () => modeSecours;

/* --------------------------------------------------------------------------
   Lecture / écriture d'un tiroir
   -------------------------------------------------------------------------- */

function transaction(tiroir, mode) {
  return new Promise((ok, non) => {
    if (!base) return non(new Error('base fermée'));
    let t;
    try { t = base.transaction(tiroir, mode); }
    catch (e) { return non(e); }
    const magasin = t.objectStore(tiroir);
    ok({ t, magasin });
  });
}

function attendre(requete) {
  return new Promise((ok, non) => {
    requete.onsuccess = () => ok(requete.result);
    requete.onerror = () => non(requete.error);
  });
}

/* --------------------------------------------------------------------------
   L'état du garage
   -------------------------------------------------------------------------- */

/** Relit le document complet. Rend null si rien n'a jamais été enregistré. */
export async function lireEtat() {
  if (!modeSecours && base) {
    try {
      const { magasin } = await transaction(TIROIR_ETAT, 'readonly');
      const doc = await attendre(magasin.get(CLE_ETAT));
      if (doc) return doc;
    } catch (e) {
      /* Base illisible en cours de route : on ne perd pas la main, on va voir
         s'il reste quelque chose dans le tiroir de secours. */
    }
  }
  try {
    const brut = localStorage.getItem(CLE_SECOURS);
    return brut ? JSON.parse(brut) : null;
  } catch (e) { return null; }
}

/** Enregistre le document complet. Rend true si l'écriture a bien eu lieu. */
export async function ecrireEtat(doc) {
  if (!modeSecours && base) {
    try {
      const { t, magasin } = await transaction(TIROIR_ETAT, 'readwrite');
      magasin.put(doc, CLE_ETAT);
      await new Promise((ok, non) => {
        t.oncomplete = ok;
        t.onerror = () => non(t.error);
        t.onabort = () => non(t.error || new Error('écriture abandonnée'));
      });
      return true;
    } catch (e) {
      /* Quota dépassé, base fermée par le navigateur : on bascule en secours
         plutôt que de perdre la saisie en cours. */
      modeSecours = true;
    }
  }
  try {
    localStorage.setItem(CLE_SECOURS, JSON.stringify(doc));
    return true;
  } catch (e) {
    return false;   // plus de place nulle part : l'appelant doit le dire
  }
}

/** Efface tout. Utilisé par « repartir de zéro », jamais tout seul. */
export async function effacerTout() {
  if (base) {
    try {
      const { t, magasin } = await transaction(TIROIR_ETAT, 'readwrite');
      magasin.delete(CLE_ETAT);
      await new Promise((ok) => { t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
    } catch (e) { /* rien de plus à faire */ }
    try {
      const { t, magasin } = await transaction(TIROIR_FICHIERS, 'readwrite');
      magasin.clear();
      await new Promise((ok) => { t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
    } catch (e) { /* idem */ }
  }
  try { localStorage.removeItem(CLE_SECOURS); } catch (e) {}
}

/* --------------------------------------------------------------------------
   Les fichiers : photos de véhicules, pièces jointes
   Ils ne rentrent pas dans l'état — un dossier avec dix photos pèserait plus
   lourd que tout le reste du garage réuni.
   -------------------------------------------------------------------------- */

/** Range un fichier et rend sa clé. `donnee` : Blob, ou texte en base64. */
export async function ecrireFichier(cle, donnee) {
  if (modeSecours || !base) {
    /* Sans IndexedDB, on refuse les fichiers plutôt que de faire exploser
       localStorage : cinq mégaoctets, c'est deux photos de téléphone. */
    return null;
  }
  try {
    const { t, magasin } = await transaction(TIROIR_FICHIERS, 'readwrite');
    magasin.put(donnee, cle);
    await new Promise((ok, non) => {
      t.oncomplete = ok;
      t.onerror = () => non(t.error);
      t.onabort = () => non(t.error || new Error('abandon'));
    });
    return cle;
  } catch (e) { return null; }
}

export async function lireFichier(cle) {
  if (modeSecours || !base) return null;
  try {
    const { magasin } = await transaction(TIROIR_FICHIERS, 'readonly');
    return await attendre(magasin.get(cle));
  } catch (e) { return null; }
}

export async function effacerFichier(cle) {
  if (modeSecours || !base) return;
  try {
    const { magasin } = await transaction(TIROIR_FICHIERS, 'readwrite');
    magasin.delete(cle);
  } catch (e) { /* rien à faire */ }
}

/** Toutes les clés rangées : sert au ménage des fichiers orphelins. */
export async function clesFichiers() {
  if (modeSecours || !base) return [];
  try {
    const { magasin } = await transaction(TIROIR_FICHIERS, 'readonly');
    return await attendre(magasin.getAllKeys());
  } catch (e) { return []; }
}

/* --------------------------------------------------------------------------
   Place disponible
   Le navigateur ne promet rien, mais il sait dire combien il a déjà consommé.
   On s'en sert pour prévenir AVANT que la sauvegarde échoue.
   -------------------------------------------------------------------------- */
export async function place() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { utilise: e.usage || 0, total: e.quota || 0 };
    }
  } catch (err) { /* pas d'estimation : on ne dira rien */ }
  return { utilise: 0, total: 0 };
}

/** Demande au navigateur de ne pas effacer nos données sous la pression.
 *  Sans ça, un navigateur à court de place peut vider la base sans prévenir. */
export async function rendrePersistant() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* refusé : ce n'est pas bloquant */ }
  return false;
}
