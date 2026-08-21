/* ==========================================================================
   YATECH — documents imprimables
   --------------------------------------------------------------------------
   Un devis part en PDF par le navigateur : Imprimer → « Enregistrer en PDF ».
   Pas de bibliothèque, pas de service : le navigateur sait déjà le faire, et
   le résultat est un vrai PDF, sélectionnable, léger, qui s'imprime bien.

   Ce module remplit le bloc `#impression`, invisible à l'écran, seul visible
   au moment d'imprimer (voir css/impression.css).

   Les mentions légales ne sont pas décoratives : la validité du devis, le
   droit du client de récupérer ses pièces, les pénalités de retard, la TVA.
   Elles se règlent dans les paramètres, et elles s'écrivent ici.
   ========================================================================== */

import { h, poser } from '../core/dom.js';
import * as fmt from '../core/fmt.js';
import { nombre, plaqueJolie } from '../core/util.js';
import { totaux, contexte, ligneChiffree } from '../domain/calculs.js';
import * as lit from '../domain/selecteurs.js';
import { TYPES_LIGNE } from '../domain/schema.js';

/**
 * Prépare le document puis lance l'impression.
 * @param {object} e     l'état
 * @param {object} doc   le devis ou la facture
 * @param {string} type  'devis' | 'facture'
 */
export function imprimer(e, doc, type) {
  const zone = document.getElementById('impression');
  if (!zone) return;
  poser(zone, documentImprimable(e, doc, type));
  /* On laisse un souffle au navigateur pour poser la mise en page avant
     d'ouvrir la fenêtre d'impression : sans ça, Safari imprime une page
     à moitié construite. */
  setTimeout(() => {
    window.print();
    /* On vide après coup : le bloc reste dans la page tant qu'on ne l'efface
       pas, et il ressortirait sur la prochaine impression d'un autre écran. */
    setTimeout(() => poser(zone, []), 800);
  }, 120);
}

/** Le document complet, en nœuds. Exporté pour l'aperçu à l'écran.
 *  Surtout pas nommé `document` : il masquerait le document de la page. */
export function documentImprimable(e, doc, type) {
  const r = e.reglages;
  const c = lit.client(e, doc.clientId);
  const v = lit.vehicule(e, doc.vehiculeId);
  const dossier = doc.dossierId ? lit.dossier(e, doc.dossierId) : null;
  const ctx = contexte(r, c);
  const t = totaux(doc, ctx);
  const estFacture = type === 'facture';
  const quand = estFacture ? (doc.emiseLe || doc.cree) : (doc.emisLe || doc.cree);

  return h('div.doc', [
    /* --- en-tête ---------------------------------------------------------- */
    h('div.doc__tete', [
      h('div.doc__emetteur', [
        h('strong', r.raisonSociale || r.nomOutil || 'Garage'),
        r.adresse ? h('div', r.adresse) : null,
        (r.cp || r.ville) ? h('div', [r.cp, r.ville].filter(Boolean).join(' ')) : null,
        r.tel ? h('div', 'Tél. ' + r.tel) : null,
        r.email ? h('div', r.email) : null,
        r.siret ? h('div', 'SIRET ' + r.siret) : null,
        r.tvaIntra ? h('div', 'TVA ' + r.tvaIntra) : null
      ]),
      h('div.doc__type', [
        h('b', estFacture ? 'Facture' : 'Devis'),
        h('span', doc.numero || ''),
        h('span', { style: { display: 'block' } }, 'du ' + fmt.date(quand, 'normal')),
        estFacture && doc.echeanceLe
          ? h('span', { style: { display: 'block' } }, 'Échéance : ' + fmt.date(doc.echeanceLe, 'normal'))
          : null,
        !estFacture && doc.valableJusquau
          ? h('span', { style: { display: 'block' } }, 'Valable jusqu’au ' + fmt.date(doc.valableJusquau, 'normal'))
          : null
      ])
    ]),

    /* --- client et véhicule ------------------------------------------------ */
    h('div.doc__parties', [
      h('div.doc__bloc', [
        h('h4', estFacture ? 'Facturé à' : 'Devis établi pour'),
        h('div', { style: { fontWeight: '700' } }, lit.nomClient(c)),
        c && c.adresse ? h('div', c.adresse) : null,
        c && (c.cp || c.ville) ? h('div', [c.cp, c.ville].filter(Boolean).join(' ')) : null,
        c && c.tel ? h('div', 'Tél. ' + c.tel) : null,
        c && c.siret ? h('div', 'SIRET ' + c.siret) : null,
        c && c.tvaIntra ? h('div', 'TVA ' + c.tvaIntra) : null
      ]),
      h('div.doc__bloc', [
        h('h4', 'Véhicule'),
        v ? h('div', { style: { fontWeight: '700' } }, lit.nomVehiculeLong(v)) : h('div', '—'),
        v && v.immat ? h('div', 'Immatriculation : ' + plaqueJolie(v.immat)) : null,
        v && v.vin ? h('div', 'VIN : ' + v.vin) : null,
        v && v.dateMec ? h('div', '1re mise en circulation : ' + fmt.date(v.dateMec, 'normal')) : null,
        dossier && (dossier.kmSortie || dossier.kmEntree)
          ? h('div', 'Kilométrage : ' + fmt.km(dossier.kmSortie || dossier.kmEntree))
          : (v && v.km ? h('div', 'Kilométrage : ' + fmt.km(v.km)) : null),
        dossier && dossier.numero ? h('div', 'Dossier ' + dossier.numero) : null
      ])
    ]),

    doc.objet ? h('p', { style: { fontWeight: '700', marginBottom: '4mm' } }, doc.objet) : null,

    /* --- le tableau -------------------------------------------------------- */
    tableau(doc, ctx),

    /* --- les totaux -------------------------------------------------------- */
    h('div.doc__totaux', [
      t.remiseTotale > 0 ? h('div', [h('span', 'Total brut HT'), h('span', fmt.euros(t.brut))]) : null,
      t.remiseLignes > 0 ? h('div', [h('span', 'Remises'), h('span', '−' + fmt.euros(t.remiseLignes))]) : null,
      t.remiseGlobale > 0
        ? h('div', [h('span', 'Remise globale ' + nombre(doc.remiseGlobale) + ' %'),
                    h('span', '−' + fmt.euros(t.remiseGlobale))])
        : null,
      h('div', [h('span', 'Total HT'), h('span', fmt.euros(t.ht))]),
      ...t.detailTva.map(d => h('div', [
        h('span', 'TVA ' + fmt.nb(d.taux, 1) + ' % sur ' + fmt.euros(d.base)),
        h('span', fmt.euros(d.tva))
      ])),
      h('div.ttc', [h('span', 'TOTAL TTC'), h('span', fmt.euros(t.ttc))]),
      t.acompte > 0 ? h('div', [h('span', 'Acompte versé'), h('span', '−' + fmt.euros(t.acompte))]) : null,
      t.regle > 0 ? h('div', [h('span', 'Déjà réglé'), h('span', '−' + fmt.euros(t.regle))]) : null,
      (t.acompte > 0 || t.regle > 0)
        ? h('div', { style: { fontWeight: '700' } }, [h('span', 'Reste à payer'), h('span', fmt.euros(t.reste))])
        : null
    ]),

    /* --- règlement --------------------------------------------------------- */
    estFacture && (r.iban || r.delaiPaiement) ? h('div', {
      style: { marginTop: '6mm', fontSize: '9pt', border: '.5pt solid #000', padding: '3mm' }
    }, [
      h('div', { style: { fontWeight: '700', marginBottom: '1mm' } }, 'Règlement'),
      r.delaiPaiement ? h('div', 'À ' + r.delaiPaiement + ' jours à compter de la date de facture.') : null,
      r.iban ? h('div', 'IBAN : ' + r.iban + (r.bic ? '   BIC : ' + r.bic : '')) : null
    ]) : null,

    /* --- mentions ---------------------------------------------------------- */
    h('div.doc__mentions', [
      h('div', mentions(r, estFacture)),
      contientElectronique(doc) && r.mentionElectronique
        ? h('div', { style: { marginTop: '2mm' } }, r.mentionElectronique) : null,
      r.tvaApplicable === false
        ? h('div', { style: { marginTop: '2mm', fontWeight: '700' } }, r.mentionFranchiseTva) : null
    ]),

    /* --- signature --------------------------------------------------------- */
    !estFacture ? h('div.doc__signature', [
      h('div', [
        h('div', { style: { fontSize: '8.5pt' } },
          'Le client reconnaît avoir pris connaissance du présent devis et des conditions ci-dessus.'),
        doc.signature && doc.signature.nom ? h('div', {
          style: { marginTop: '3mm', fontSize: '9pt' }
        }, 'Accepté par ' + doc.signature.nom + ' le ' + fmt.date(doc.signature.quand, 'normal')) : null
      ]),
      h('div.doc__cadre-signature', [
        h('div', 'Bon pour accord'),
        h('div', { style: { fontSize: '7.5pt', color: '#555' } }, 'Date et signature')
      ])
    ]) : null,

    /* --- pied de page ------------------------------------------------------- */
    h('div.doc__pied', [
      [r.raisonSociale, r.formeJuridique, r.capital ? 'Capital ' + r.capital : '',
       r.siret ? 'SIRET ' + r.siret : '', r.rcs ? 'RCS ' + r.rcs : '',
       r.ape ? 'APE ' + r.ape : ''].filter(Boolean).join(' — ')
    ])
  ]);
}

function tableau(doc, ctx) {
  const corps = [];
  for (const l of doc.lignes || []) {
    if (!l) continue;
    if (l.type === 'titre') {
      corps.push(h('tr.sous-titre', h('td', { colspan: 6 }, l.libelle || '')));
      continue;
    }
    const x = ligneChiffree(l, ctx);
    corps.push(h('tr', [
      h('td', { style: { width: '18mm' } }, l.ref || ''),
      h('td', [
        h('div', l.libelle || ''),
        l.detail ? h('div', { style: { fontSize: '8pt', color: '#444' } }, l.detail) : null
      ]),
      h('td.num', { style: { width: '16mm' } },
        fmt.nb(l.qte, 2) + (l.unite ? ' ' + l.unite : '')),
      h('td.num', { style: { width: '20mm' } }, fmt.montant(l.prixHT)),
      h('td.num', { style: { width: '14mm' } }, nombre(l.remise) ? nombre(l.remise) + ' %' : ''),
      h('td.num', { style: { width: '22mm' } }, fmt.montant(x.ht))
    ]));
  }
  if (!corps.length) corps.push(h('tr', h('td', { colspan: 6 }, 'Aucune ligne.')));

  return h('table', [
    h('thead', h('tr', [
      h('th', 'Réf.'), h('th', 'Désignation'), h('th.num', 'Qté'),
      h('th.num', 'P.U. HT'), h('th.num', 'Rem.'), h('th.num', 'Total HT')
    ])),
    h('tbody', corps)
  ]);
}

function mentions(r, estFacture) {
  let texte = estFacture ? (r.mentionsFacture || '') : (r.mentionsDevis || '');
  return texte
    .replace('{validite}', String(r.validiteDevis || 30))
    .replace('{delai}', String(r.delaiPaiement || 30))
    .replace('{penalites}', r.penalitesRetard || '');
}

const contientElectronique = (doc) =>
  (doc.lignes || []).some(l => l && l.type === 'electro');

/* ==========================================================================
   ÉTIQUETTES DE BACS
   Une planche à imprimer, à coller sur les bacs du stock. C'est ce qui fait
   qu'on retrouve une pièce trois ans plus tard.
   ========================================================================== */

export function imprimerEtiquettes(emplacements) {
  const zone = document.getElementById('impression');
  if (!zone) return;
  poser(zone, h('div.planche', emplacements.map(em =>
    h('div.et', [
      h('b', em.code),
      h('span', em.libelle || ''),
      em.detail ? h('span', { style: { fontSize: '7pt', color: '#555' } }, em.detail) : null
    ])
  )));
  setTimeout(() => {
    window.print();
    setTimeout(() => poser(zone, []), 800);
  }, 120);
}

/* ==========================================================================
   ORDRE DE RÉPARATION — la feuille qui suit le véhicule dans l'atelier
   ========================================================================== */

export function imprimerOrdre(e, d) {
  const zone = document.getElementById('impression');
  if (!zone) return;
  const c = lit.client(e, d.clientId);
  const v = lit.vehicule(e, d.vehiculeId);
  const r = e.reglages;

  poser(zone, h('div.doc', [
    h('div.doc__tete', [
      h('div.doc__emetteur', [
        h('strong', r.raisonSociale || r.nomOutil || 'Garage'),
        h('div', [r.adresse, r.cp, r.ville].filter(Boolean).join(' — ')),
        r.tel ? h('div', 'Tél. ' + r.tel) : null
      ]),
      h('div.doc__type', [
        h('b', 'Ordre de réparation'),
        h('span', d.numero || ''),
        h('span', { style: { display: 'block' } }, 'du ' + fmt.date(d.entree || d.cree, 'normal'))
      ])
    ]),
    h('div.doc__parties', [
      h('div.doc__bloc', [
        h('h4', 'Client'),
        h('div', { style: { fontWeight: '700' } }, lit.nomClient(c)),
        c && c.tel ? h('div', 'Tél. ' + c.tel) : null
      ]),
      h('div.doc__bloc', [
        h('h4', 'Véhicule'),
        h('div', { style: { fontWeight: '700' } }, v ? lit.nomVehiculeLong(v) : '—'),
        v ? h('div', plaqueJolie(v.immat)) : null,
        d.kmEntree ? h('div', 'Km entrée : ' + fmt.km(d.kmEntree)) : null,
        d.place ? h('div', 'Place : ' + d.place) : null
      ])
    ]),
    d.demande ? h('div', { style: { marginBottom: '4mm' } }, [
      h('div', { style: { fontWeight: '700', fontSize: '9pt' } }, 'Demande du client'),
      h('div', d.demande)
    ]) : null,
    d.constat ? h('div', { style: { marginBottom: '4mm' } }, [
      h('div', { style: { fontWeight: '700', fontSize: '9pt' } }, 'Constat'),
      h('div', d.constat)
    ]) : null,
    h('div', { style: { fontWeight: '700', fontSize: '9pt', marginBottom: '2mm' } }, 'Travaux à réaliser'),
    h('table', [
      h('thead', h('tr', [h('th', 'Fait'), h('th', 'Désignation'), h('th.num', 'Qté')])),
      h('tbody', (d.lignes || []).filter(l => l && l.type !== 'titre').map(l => h('tr', [
        h('td', { style: { width: '12mm', textAlign: 'center' } }, l.fait ? '☑' : '☐'),
        h('td', l.libelle || ''),
        h('td.num', { style: { width: '18mm' } }, fmt.nb(l.qte, 2) + (l.unite ? ' ' + l.unite : ''))
      ])))
    ]),
    h('div', { style: { marginTop: '8mm' } }, [
      h('div', { style: { fontWeight: '700', fontSize: '9pt' } }, 'Observations de l’atelier'),
      h('div', { style: { border: '.5pt solid #000', height: '32mm', marginTop: '2mm' } })
    ]),
    h('div.doc__signature', [
      h('div', h('div', { style: { fontSize: '8.5pt' } },
        'Le client autorise la réalisation des travaux ci-dessus et l’essai du véhicule sur route.')),
      h('div.doc__cadre-signature', [h('div', 'Signature du client')])
    ])
  ]));
  setTimeout(() => {
    window.print();
    setTimeout(() => poser(zone, []), 800);
  }, 120);
}
