/* ==========================================================================
   YATECH — emballer, déballer
   --------------------------------------------------------------------------
   Mettre un objet dans une adresse, ou dans un message qu'on colle.

   Base64 « sûr pour une adresse » : ni +, ni /, ni =. Compressé quand le
   navigateur sait le faire — une grille tarifaire passe alors de deux
   kilo-octets à sept cents, ce qui la garde collable dans un SMS.

   La lettre de tête dit comment déballer : « z » compressé, « p » tel quel.
   Sans elle, un navigateur qui ne sait pas compresser produirait un lien
   qu'un autre ne saurait pas relire.

   Ce n'est PAS du chiffrement. Ce qui voyage dans un lien est lisible par qui
   tient le lien : c'est écrit sur les écrans qui s'en servent.
   ========================================================================== */

export const enB64url = (octets) => {
  let s = '';
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const deB64url = (texte) => {
  const t = String(texte).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(t + '==='.slice((t.length + 3) % 4));
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
};

async function comprimer(octets) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const flux = new Blob([octets]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  } catch (e) { return null; }
}

async function decomprimer(octets) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  } catch (e) { return null; }
}

/** Emballe un objet en une chaîne transportable. */
export async function emballer(objet) {
  const brut = new TextEncoder().encode(JSON.stringify(objet));
  const serre = await comprimer(brut);
  return serre && serre.length < brut.length
    ? 'z' + enB64url(serre)
    : 'p' + enB64url(brut);
}

/** Déballe ce qu'`emballer` a produit. Rend null si ce n'en est pas. */
export async function deballer(charge) {
  const t = String(charge || '').trim();
  if (t.length < 2) return null;
  try {
    const octets = deB64url(t.slice(1));
    const brut = t[0] === 'z' ? await decomprimer(octets) : octets;
    if (!brut) return null;
    return JSON.parse(new TextDecoder().decode(brut));
  } catch (e) { return null; }
}
