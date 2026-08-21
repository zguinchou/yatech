/* ==========================================================================
   YATECH — empreintes
   --------------------------------------------------------------------------
   Les codes d'accès ne sont jamais rangés en clair : on garde leur empreinte,
   salée, de sorte qu'ouvrir la base ne donne pas les codes de l'équipe.

   Deux avertissements honnêtes :
     • ce qui vit dans un navigateur reste lisible par qui a la main sur
       l'appareil. Le code d'accès sépare les rôles, il ne protège pas d'un vol
       de téléphone. Le vrai verrou, c'est celui du téléphone.
     • SHA-256 est écrit ici plutôt qu'emprunté à `crypto.subtle`, qui n'existe
       qu'en page sécurisée : l'outil doit aussi tourner depuis un fichier local
       ou un réseau interne en http.
   ========================================================================== */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8(texte) {
  const octets = [];
  for (const car of String(texte)) {
    const c = car.codePointAt(0);
    if (c < 0x80) octets.push(c);
    else if (c < 0x800) octets.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) octets.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else octets.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return octets;
}

export function sha256(message) {
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
           0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const o = utf8(message);

  /* La longueur se termine sur 64 bits, poids fort d'abord. Les deux moitiés
     s'écrivent séparément : décaler de plus de 31 bits n'a pas de sens en
     JavaScript, et l'empreinte serait fausse dès le premier caractère. */
  const bits = o.length * 8;
  const haut = Math.floor(bits / 4294967296), bas = bits >>> 0;
  o.push(0x80);
  while (o.length % 64 !== 56) o.push(0);
  for (let i = 3; i >= 0; i--) o.push((haut >>> (8 * i)) & 255);
  for (let i = 3; i >= 0; i--) o.push((bas >>> (8 * i)) & 255);

  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  const W = new Array(64);

  for (let bloc = 0; bloc < o.length; bloc += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = (o[bloc + i * 4] << 24) | (o[bloc + i * 4 + 1] << 16)
           | (o[bloc + i * 4 + 2] << 8) | o[bloc + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const bloc8 = [a, b, c, d, e, f, g, hh];
    H = H.map((x, i) => (x + bloc8[i]) | 0);
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Un grain de sel par personne : deux codes identiques donnent deux
 *  empreintes différentes, et une table pré-calculée ne sert à rien. */
export function sel() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const t = new Uint8Array(12);
    crypto.getRandomValues(t);
    return Array.from(t, b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* Le code passe plusieurs fois dans la moulinette. Un code à quatre chiffres
   se devine en un instant si l'empreinte se calcule d'un coup ; le répéter
   rend chaque essai coûteux. Le compte est modeste — il tourne aussi sur un
   vieux téléphone — mais il change l'échelle d'une attaque au hasard. */
const TOURS = 6000;

export function empreinte(code, grain) {
  let x = grain + '::' + String(code);
  for (let i = 0; i < TOURS; i++) x = sha256(x);
  return x;
}

/** Fabrique le verrou à ranger dans la fiche. */
export function verrou(code) {
  const grain = sel();
  return { sel: grain, emp: empreinte(code, grain), provisoire: false };
}

/** Vérifie un code contre un verrou. Tolère les anciens verrous en un tour. */
export function verifier(code, v) {
  if (!v || !v.emp) return false;
  if (v.tours === 1) return sha256(v.sel + '::' + String(code)) === v.emp;
  return empreinte(code, v.sel) === v.emp;
}

/** Un code court, lisible au téléphone : ni O ni 0, ni I ni 1. */
export function codeLisible(longueur) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const n = longueur || 6;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const t = new Uint8Array(n);
    crypto.getRandomValues(t);
    for (let i = 0; i < n; i++) s += alpha[t[i] % alpha.length];
  } else {
    for (let i = 0; i < n; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  }
  return s;
}
