# Yatech — gestion d'atelier

Outil de gestion pour un garage automobile : mécanique et électronique embarquée.
Clients, dossiers, devis, facturation (avec passerelle EBP), parc de véhicules,
stock de pièces, planning, tarifs particuliers et professionnels, interventions
Autotuner.

Il tourne dans un navigateur, sur téléphone comme sur ordinateur, et continue de
fonctionner sans réseau.

---

## Mettre en ligne

Il n'y a **rien à construire** : ni `npm install`, ni compilation, ni serveur.
Le dossier `yatech-v2/` est le site.

**Cloudflare Pages** (ce qui est utilisé aujourd'hui)
1. Déposer le contenu de `yatech-v2/` à la racine du projet Pages.
2. Laisser la commande de build vide et le dossier de sortie à la racine.
3. Les fichiers `_headers` et `_redirects` sont déjà là et font le nécessaire.

**Autre hébergeur statique** (Netlify, GitHub Pages, un simple Apache)
Copier le dossier. Une seule exigence : le site doit être servi en **https**
(ou en `http://localhost`), sinon le navigateur refuse d'installer l'application
et de garder les données de façon durable.

**En local, pour essayer**
```
cd yatech-v2
npx http-server -p 8080 -c-1
```
puis ouvrir `http://localhost:8080`.
Ouvrir le fichier directement (`file://`) ne marche pas : les modules
JavaScript ont besoin d'un vrai serveur.

**Installer sur le téléphone**
Ouvrir le site, puis « Ajouter à l'écran d'accueil ». L'outil s'ouvre alors en
plein écran, comme une application, et fonctionne sans réseau.

---

## Où sont les données

**Dans le navigateur de chaque appareil**, dans une base IndexedDB. Elles ne
partent nulle part : aucun serveur, aucun compte, aucun abonnement.

Conséquences, à connaître :

- **Deux appareils = deux bases.** Le téléphone de l'atelier et le PC du bureau
  ne se parlent pas tout seuls. Pour transporter les données : Réglages →
  Données → Sauvegarder, puis Restaurer sur l'autre appareil.
- **Faites des sauvegardes.** L'outil affiche un avertissement quand la dernière
  remonte à plus d'une semaine. Une sauvegarde est un fichier `.json` : gardez-le
  sur un disque, un cloud, une clé — pas seulement sur l'appareil.
- Vider les données du navigateur efface tout. L'outil demande au navigateur de
  rendre le stockage persistant, ce qui protège d'un effacement automatique,
  mais pas d'un effacement volontaire.

Si le partage entre postes devient nécessaire, c'est le seul morceau à écrire :
tout passe par `js/core/db.js`, et le reste de l'outil n'a pas à changer.

---

## Comment c'est fait

Pas de framework, pas de dépendance, pas d'outil de build. Des modules
JavaScript natifs que le navigateur charge directement. C'est un choix : dans
cinq ans, ce code s'ouvrira encore et se modifiera encore, sans avoir à
ressusciter une chaîne d'outils.

Une seule chose vient de l'extérieur : deux polices, chargées depuis Google
Fonts. Sans elles, l'outil n'a pas le même visage d'une machine à l'autre — un
Mac affiche DIN Condensed, un PC Bahnschrift, un Linux rien du tout. La pile de
repli est complète et le chargement ne bloque jamais : hors ligne, la page
s'affiche immédiatement avec les polices du système. Pour couper ce dernier
lien, il suffit de retirer les trois `<link>` en tête de `index.html`.

```
yatech-v2/
  index.html            la coquille, une vingtaine de lignes
  manifest.webmanifest  ce qui fait de la page une application installable
  sw.js                 le cache qui permet de travailler sans réseau
  _headers _redirects   la configuration de l'hébergeur

  css/
    jetons.css          couleurs, espaces, typographies — TOUT part d'ici
    base.css            remise à zéro et réglages typographiques
    composants.css      boutons, champs, cartes, pastilles, modales, tableaux
    coque.css           le menu, la barre du haut, les onglets du bas
    ecrans.css          ce qui n'appartient qu'à un écran (parc, planning…)
    utilitaires.css     .rang, .pile, .coupe — chargés en dernier, exprès
    impression.css      les documents papier et PDF

  js/
    main.js             démarrage, routes, session, raccourcis clavier
    coque.js            menu, recherche générale, thème, état du réseau

    core/               la mécanique, sans rien connaître du métier
      dom.js            h() : construire des éléments sans innerHTML
      store.js          l'état, maj(), l'annulation, le journal
      db.js             IndexedDB, avec repli localStorage
      routeur.js        les adresses (#/dossier/42)
      ui.js             messages, modales, confirmations, menus
      icones.js         les icônes, dessinées ici
      fmt.js            euros, dates, durées, kilomètres
      util.js           dates, plaques, téléphones, recherche floue
      fichiers.js       CSV, téléchargements, photos
      crypto.js         empreintes des codes d'accès

    domain/             le métier, sans rien connaître de l'affichage
      schema.js         la forme des données, les vocabulaires, les migrations
      calculs.js        LE moteur de prix : grilles, remises, TVA, totaux
      selecteurs.js     les questions qu'on pose aux données
      actions.js        les gestes qui modifient (le seul chemin autorisé)
      ebp.js            la passerelle EBP
      grille.js         la grille tarifaire qui voyage dans un lien
      demo.js           le jeu de démonstration

    ui/                 les briques partagées entre écrans
      widgets.js        champs, pastilles, cartes, sélecteurs
      lignes.js         l'éditeur de lignes de devis

    views/              un fichier par écran
  tests/
    verifs.mjs          les calculs, les formats, les données
    metier.mjs          les règles du métier (stock, parc, devis, crédits)
  outils/
    empaqueter.mjs      tout l'outil en un seul fichier HTML
```

### Tout l'outil en un seul fichier

```
node outils/empaqueter.mjs
```

Produit un `yatech-un-seul-fichier.html` qui s'ouvre en double-cliquant dessus :
styles, code et icône rassemblés, aucun serveur nécessaire. Pratique pour le
montrer à quelqu'un, l'envoyer en pièce jointe ou le poser sur une clé.

Ce fichier charge le jeu de démonstration au premier lancement : c'est une
vitrine, pas un poste de travail. Pour travailler pour de vrai, c'est le site
qu'il faut — avec ses sauvegardes.

---

## Modifier quelque chose

**Changer une couleur, une taille, un espacement**
→ `css/jetons.css`, tout en haut. Rien d'autre n'écrit de couleur en dur.

**Changer un taux horaire, une mention légale, un modèle de message**
→ dans l'outil : Réglages. Rien à toucher dans le code.

**Renommer une colonne de l'atelier** (« Attente accord » → « Attente client »)
→ dans l'outil : Réglages → Atelier.

**Ajouter un champ à une fiche**
→ `js/domain/schema.js` : l'ajouter dans la fabrique concernée
(`nouveauVehicule`, `nouvellePiece`…) et dans `normaliser()` pour que les
sauvegardes anciennes le reçoivent. Puis l'afficher dans l'écran concerné.

**Ajouter un écran**
→ créer `js/views/mon-ecran.js` qui exporte `peindre(ctx)` et rend un nœud,
l'enregistrer dans `ECRANS` et `ROUTES` de `js/main.js`, et l'ajouter au `MENU`
de `js/coque.js`.

**Changer un calcul de prix**
→ `js/domain/calculs.js`, et nulle part ailleurs. Puis relancer
`node tests/verifs.mjs`.

Trois règles à tenir si vous modifiez :
1. Jamais `innerHTML` avec une donnée saisie — on construit avec `h()`.
2. Jamais une couleur en dur — toujours `var(--quelque-chose)`.
3. Jamais modifier l'état directement — toujours `maj()` ou `domain/actions.js`.

---

## Comment le prix se forme

Trois étages, pas un de plus, pour qu'un montant soit toujours explicable :

1. **Le prix de base** vient du catalogue, à la grille du client
   (particulier ou confrère).
2. **La remise de ligne**, en pourcentage, se voit sur le document.
3. **La remise globale**, en pourcentage, s'applique au total hors taxes.

La remise inscrite sur la fiche d'un client *pré-remplit* l'étage 2 quand on
ajoute une ligne. Elle ne s'applique jamais toute seule au total : une remise
invisible est une remise qu'on accorde deux fois.

Une prestation dont le prix est à 0 dans le catalogue se calcule au temps
(heures × taux horaire de la grille).

---

## La passerelle EBP

EBP tient la facturation officielle : les numéros légaux, la comptabilité,
l'export au comptable. Yatech capte au téléphone, chiffre, suit l'atelier, puis
repasse à EBP ce qu'il lui faut.

Le lien tient à **une seule chose** : le même code client des deux côtés.

- Écran EBP → « À reporter » : ce qui attend d'être passé dans EBP.
- Export en CSV français (point-virgule, accents corrects) que le module
  d'import d'EBP sait lire.
- Ou « Copier la fiche » : le résumé à recopier à la main, souvent plus rapide.
- Import des clients depuis un fichier EBP, avec repérage des doublons et
  **aperçu obligatoire** avant que quoi que ce soit ne soit écrit.

Les intitulés de colonnes attendus par EBP varient d'une version à l'autre :
ils sont affichés dans l'écran EBP, à vérifier au premier import.

---

## Le poste électronique

C'est la partie la plus travaillée de l'outil, parce que c'est celle où une
information manquante coûte le plus cher.

### Ce qu'une intervention retient

| | |
|---|---|
| **Le calculateur** | marque, type, HW, SW — repris de la fiche du véhicule, corrigés ici si le boîtier dit autre chose |
| **L'accès** | OBD, bench, boot, JTAG, CAN |
| **Le programme** | ce qu'on a changé dans le fichier : Stage 1/2, sur mesure, E85, EGR, FAP, AdBlue, Start & Stop, DTC, immo, injecteurs… en pastilles qu'on coche du pouce |
| **Le déroulé** | six cases, dont deux clés : original sauvegardé et maintien de charge |
| **Les fichiers** | leur nom, leur rôle, et **où ils sont rangés** |
| **Le reste** | outil, slave, crédits, durée, résultat, notes |

### Le garde-fou

Déclarer *réussie* une écriture sans original sauvegardé ni maintien de charge,
c'est ce qui transforme une prestation en litige six mois plus tard. L'outil ne
bloque pas — c'est l'atelier qui sait — mais il redemande, et il nomme ce qui
manque. Les cases secondaires (checksum, relecture, défauts, essai) renseignent
sans jamais interrompre.

Les contrôles ne se recopient **jamais** d'une intervention à l'autre : cocher
« original sauvegardé » sur une voiture qu'on n'a pas encore lue serait un
mensonge qui coûte cher.

### Refaire la même

Sur la fiche d'un calculateur, chaque tentative passée porte un bouton
**Refaire** : le boîtier, l'opération, l'accès et les programmes sont recopiés
dans une fiche neuve. Le véhicule, le résultat et le déroulé, non — c'est une
autre voiture et une autre journée.

### La fiche papier

Une intervention enregistrée s'imprime : calculateur, accès, ce qui a été
programmé, le déroulé coché, les fichiers conservés et où, l'intervenant, la
durée, et un cadre de signature. Quand le programme comporte quelque chose qui
n'est pas homologué pour la route, la fiche porte la mention correspondante et
la fait signer. C'est ce papier-là qui règle une discussion deux ans plus tard.

### Chercher

Un seul champ, au-dessus de la liste : plaque, client, boîtier, programme, nom
de fichier, note. On se souvient d'un mot, pas d'une colonne.

### Sur la fiche du véhicule

Une voiture déjà touchée porte son histoire électronique : la sauvegarde
d'origine est mise en évidence **avec l'endroit où elle est rangée**, et le
tableau des interventions montre l'accès et le programme appliqué. C'est ce
qu'on regarde en premier quand elle revient.

---

## La mémoire des calculateurs

Le temps perdu en électronique, ce n'est pas la lecture : c'est la demi-heure
passée à chercher par où entrer. Un EDC17 qui se lit par la prise mais ne
s'écrit qu'au bench, on ne le découvre qu'en essayant — une fois.

L'outil ne contient **aucune base de données** de calculateurs, et n'en
inventera jamais une : tout ce qu'il affiche sort des interventions que le
garage a lui-même enregistrées. Ce qu'il sait, il le sait parce que vous
l'avez fait.

Ce qu'il retient, c'est le couple **opération + accès** — pas le boîtier tout
seul. Savoir qu'un EDC17C64 « se fait par OBD » ne sert à rien si c'est vrai en
lecture et faux en écriture. Pour chaque type de calculateur, l'écran
Électronique affiche donc, par opération :

- l'accès qui a marché, et combien de fois (`OBD ✓3`, `Bench ✓2`) ;
- celui qui a échoué, et combien de fois (`OBD ✗2`) — c'est le quart d'heure
  qu'on ne repasse pas dessus ;
- le temps typique et les crédits typiques, en médiane ;
- la note laissée la dernière fois que ça a marché — souvent le vrai piège de
  branchement ;
- ce qu'on programme sur ce boîtier, et combien de fois.

Pendant la saisie d'une intervention, dès que le type du calculateur est
renseigné, tout ça s'affiche dans la fiche, et **l'accès se pose tout seul sur
celui qui a fait ses preuves** pour l'opération choisie. Le choisir à la main
reprend la main : l'outil ne réécrit jamais par-dessus une décision.

Pour que ça marche, une seule discipline : renseigner le type du calculateur,
l'opération et l'accès — y compris sur les échecs. Un échec enregistré vaut
plus qu'une réussite : c'est lui qui fait gagner du temps la fois d'après.
Une intervention seulement *prévue* ou *annulée* n'apprend rien et n'entre pas
dans le compte. Les orthographes se rejoignent : `EDC17 C64`, `edc17-c64` et
`EDC17C64` sont le même boîtier.

---

## Les crédits Autotuner

Autotuner vend l'accès aux protocoles au crédit : c'est la seule chose, dans
une reprogrammation, qui s'épuise et bloque un travail en plein après-midi.
D'où le compteur.

Si votre outil est sous abonnement, ou déjà débloqué sur ce que vous faites,
le compteur ne sert à rien : **éteignez « Suivre les crédits »** dans
*Réglages → Électronique*. Le solde, l'historique des recharges, la colonne du
tableau, le champ de saisie et l'alerte de solde bas disparaissent partout ;
les interventions et leur historique ne bougent pas. Rallumé, le compteur
reprend là où il en était.

Compteur allumé, l'outil tient le compte :

- le solde est affiché en permanence sur l'écran Électronique et sur l'accueil ;
- une intervention marquée « réussie » débite ses crédits automatiquement,
  une seule fois ;
- « Recharger » ajoute des crédits et enregistre leur coût, ce qui donne le
  prix moyen d'un crédit ;
- « Corriger le solde » aligne l'outil sur ce qu'affiche l'appareil — c'est
  l'appareil qui fait foi.

Les fichiers binaires (lectures d'origine, fichiers modifiés) ne sont **pas**
stockés ici : ils restent sur le PC de l'atelier. L'outil garde la trace de ce
qui a été lu et écrit, ce qui suffit à retrouver une sauvegarde.

---

## Ce qu'on programme le plus

À côté de la mémoire des calculateurs, un panneau classe les programmes par
fréquence, avec leur durée typique. Cliquer sur l'un d'eux filtre la liste des
interventions : « montre-moi tous les Stage 1 ». Sur le tableau de bord du
mois, un compteur dit combien de programmes sont sortis, et lequel domine.

Un programme, ici, c'est une **écriture réussie qui a changé quelque chose au
fichier**. Une lecture n'en est pas un, une tentative ratée non plus — c'est
bien ce qu'on veut compter quand on se demande ce qu'on a vendu.

Les retraits de dépollution portent la mention **hors route**, partout où ils
apparaissent : dans la liste, dans la fiche de saisie, et sur le document remis
au client. C'est lui qui roule avec.

---

## Ce qu'on envoie à un confrère

Deux choses différentes, sur la fiche d'un client professionnel.

**Sa grille tarifaire — c'est celle-ci qu'on envoie.**
« Copier le lien de la grille » fabrique un lien qui **contient** ses tarifs.
Il s'ouvre sur le téléphone du confrère, sans réseau, sans code, sans compte :
la grille voyage dans l'adresse elle-même (environ 1 500 caractères, ça tient
dans un SMS). Il y trouve son taux horaire, sa remise, et le prix qui lui est
appliqué sur chaque prestation — cherchable, imprimable.

C'est une **photographie**, pas un direct : la page affiche la date de la
grille, et après un changement de tarif il faut renvoyer un lien. C'est écrit
sur la page qu'il reçoit, il ne peut pas s'y tromper.

Ni les marges, ni les prix d'achat, ni les autres clients n'y figurent : le
lien ne contient que ce qui le concerne.

**Le suivi en ligne — seulement sur un appareil du garage.**
« Ouvrir un accès » crée un lien avec code qui montre au confrère l'avancement
de ses véhicules, ses factures, et lui permet de *demander* un créneau (une
demande, pas un rendez-vous : rien n'entre au planning sans acceptation).

Mais ce suivi-là lit les données de l'outil, et ces données vivent dans le
navigateur du garage : **le lien ne montre rien depuis le téléphone du
confrère**, dont la base est vide. Il sert sur la tablette du comptoir, pas
à distance. L'écran le dit clairement à l'endroit où on crée l'accès.

Le jour où une base partagée existe (voir « Où sont les données »), ce lien
fonctionnera de partout sans qu'il y ait une ligne à changer.

---

## Ce que l'outil ne fait pas

Dit franchement, pour éviter les mauvaises surprises :

- **Il n'envoie ni SMS, ni e-mail, ni WhatsApp tout seul.** Une page hébergée
  ne le peut pas sans un service payant. Il *prépare* le message et l'ouvre
  dans l'application du téléphone : l'envoi part de la personne, en un geste.
- **Il n'est pas un logiciel de comptabilité.** C'est EBP qui l'est.
- **Il ne partage pas les données entre appareils** (voir plus haut).
- **Le code d'accès n'est pas un coffre-fort.** Il est éteint par défaut :
  l'outil s'ouvre directement, sur la première personne active. On l'allume
  dans *Réglages → Équipe* si plusieurs personnes se partagent le poste. Il
  sépare alors les rôles et évite qu'un client au comptoir lise les chiffres
  par-dessus l'épaule — rien de plus. Ce qui vit dans un navigateur reste
  lisible par qui a la main sur l'appareil : le vrai verrou, c'est celui du
  téléphone. C'est pour ça qu'un code oublié se retire depuis l'écran de
  connexion : il ne garde pas un secret, il n'a pas à enfermer quelqu'un
  dehors de son propre atelier.

---

## Vérifier que tout va bien

```
node tests/verifs.mjs    # les calculs, les formats, les données
node tests/metier.mjs    # les règles du métier
```

`verifs.mjs` vérifie les montants, la TVA à plusieurs taux, les remises, les
arrondis au centime, les dates (changement d'heure, fin de mois), les plaques,
le CSV, la numérotation qui ne recule jamais, les empreintes des codes d'accès,
la reconnaissance d'une vraie sauvegarde, et la grille tarifaire transportable.

`metier.mjs` vérifie ce qui coûte de l'argent quand ça cède : le stock sorti
deux fois, la place de parc occupée par deux voitures, le devis accepté qui
écrase le travail en cours, les crédits Autotuner débités en double, le ménage
qui emporterait un dossier encore ouvert.
