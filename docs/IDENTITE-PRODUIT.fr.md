# Identité produit Yolea : comment un produit montre Yolea et son nom

Règles réutilisables pour tout produit Yolea (application de bureau, application web, site). Modèle : le site de la maison, yolea.ai (`yolea-landing`, classes `m-sky`, `m-footer`, `m-founder`), sur Sogoma 4.0.2. Exemple complet : Smart Route (ce dépôt). Version anglaise : `IDENTITE-PRODUIT.en.md`.

## 1. Ce qui est de la maison, ce qui est du produit

| Niveau | Contenu | Où il vit |
|---|---|---|
| Maison (Yolea) | Le logo Yolea, la phrase « Yolea, depuis Abidjan. », « Yolea, Abidjan. », la bio du fondateur (texte approuvé), les jetons, les polices, le Ciel, la grille | `kit/` (copié, jamais retouché), clés de contenu de yolea.ai |
| Produit | Le nom, sa marque (symbole), son message, ses pages, ses couleurs de fournisseurs tiers, son lien « Soutenir » | Le dépôt du produit |

Un produit ne redessine jamais le logo Yolea et ne crée pas de couleur de marque : il emploie les jetons Sogoma.

## 2. Le Ciel (en-tête)

De gauche à droite, sur la bande Oasis profond :

1. **Le logo Yolea fait pour le Ciel** : `kit/logos/yolea-lockup-on-sky.svg`, 28 px de haut (environ 100 px de large), tel que fourni. Sur le site, il mène à yolea.ai ; dans une application, il n'est pas un lien.
2. **Un séparateur fin** : 1 px, couleur `--on-oasis-deep`, opacité 0,5, sur la hauteur de la bande moins `--space-12` de chaque côté.
3. **Le produit** : son symbole en version pour fond sombre (28 px, caché sous 480 px de large), puis deux lignes de **texte HTML** : le nom (Inter 600, `max(--floor-act, 1.0625rem)`) et, dessous, **« par Yolea » / « by Yolea »** (Inter 400, 13 px, `--on-oasis-deep`). Ce texte est **toujours du texte tiré des fichiers de langue**, jamais dessiné dans une image : il se traduit avec la langue, reste lisible et sélectionnable. Les fichiers `*-lockup*.svg` du produit ne contiennent donc que le symbole et le nom.
4. **Le nom de la section** (application seulement, caché sous 600 px).
5. **À droite** : le commutateur de langue et le bouton de thème.
   - Langue : **un seul contrôle qui nomme l'autre langue** (FR ou EN), comme sur yolea.ai ; `aria-label` explicite (« EN Use … in English »).
   - Thème : le bouton Sogoma (`sg-theme`) en disque à demi éclairé (anneau, moitié pleine, anneau vide en Jour, disque plein en Nuit) ; les mots restent pour le lecteur d'écran, le script du kit les écrit. Taille tactile minimale `--size-touch`.
6. En Nuit, le Ciel passe à `--oasis-900` (plus sombre que la page), comme sur la maison.
7. La Ligne (`sg-line`) ferme le Ciel. Sur les écrans de travail d'une application, le disque du soleil peut rester ; sur un site compact, il est absent.

Téléphone (360 px) : le logo Yolea, le séparateur, le nom et « par Yolea », la langue et le menu tiennent sur une ligne ; le symbole du produit se cache sous 480 px.

## 3. Le nom du produit

- Le nom ne se traduit pas et garde la même écriture dans les deux langues (« Smart Route »).
- Format de la signature : **nom du produit, puis « par Yolea » en FR / « by Yolea » en EN** (clé de langue `shell.by`). Seule forme légale : « Yolea, Abidjan. »
- Le titre de la page : « Nom · accroche courte ». La balise Open Graph porte le nom, « par Yolea » et l'adresse (image cuite : le texte « par Yolea » y est écrit par le script de rendu, c'est une image).

## 4. Le pied de page

Calqué sur `m-footer` :

1. **Le logo Yolea** : `yolea-lockup.svg` en Jour, `yolea-lockup-reversed.svg` en Nuit (deux images, une cachée par thème, comme les logos de la charte : on ne recolore jamais un fichier de Jour), 36 px de haut.
2. **La phrase** : « Yolea, depuis Abidjan. » / "Yolea, from Abidjan." (Newsreader, 1,375 rem).
3. **Les liens** : **Soutenir le produit** (« Soutenir Smart Route » / "Support Smart Route") en tête, puis mentions légales, confidentialité, accessibilité, licences. Un seul lien calme : pas de fenêtre, pas de relance.
4. **Les langues** : liste « Français / English », la langue courante marquée `aria-current`.
5. Le lien « Aidez-nous à améliorer cette page » (site), la mention des marques de tiers (application et page de licences), puis **« Yolea, Abidjan. »**.

Dans une application de bureau, un lien du pied ouvre le navigateur par un identifiant du catalogue (`src/core/siteLinks.ts`, canal `link:open`), jamais par une chaîne venue de la page. Dans le navigateur, c'est un lien ordinaire (`rel="noopener noreferrer"`).

## 5. Le fondateur

- Site : section « À propos / About » vers la fin, copiée du bloc `m-founder` : portrait rond (`thierry-memel.200.webp` et `.400.webp`, droits confirmés le 1er novembre 2026), nom, titre, **texte approuvé** (clés `home.founder.*` de yolea.ai, copié mot pour mot), lien LinkedIn, plus une phrase sur la raison d'être du produit.
- Application : même texte, **sans photo** (règle des images : jamais de personne sur un écran de travail), dans Réglages, rubrique « À propos », avec le lien « Soutenir ».
- On ne copie pas la citation ni le paragraphe « bio » de la maison quand ils renvoient à un contexte absent du produit (« ces formations »).

## 6. Les logos de tiers

- Dossier `assets/brands/<fournisseur>/`, un `SOURCE.md` (URL, date, sha256, conditions), jamais redessiné, jamais recoloré, aucun filtre ni halo sur le logo : le halo d'un outil au travail est sur son conteneur.
- Un logo en encre noire sur fond transparent (OpenAI, la fleur) se pose sur une tuile claire (`--oasis-100`) en Nuit.
- Le logo d'un tiers n'est pas la marque du produit : il nomme un outil avec lequel le produit travaille, jamais avec le mot-symbole du tiers.

## 7. Couleurs et typographie

Jetons Sogoma uniquement. Exceptions déclarées dans `YOLEA.md` (couleurs de fournisseurs pendant que leur outil travaille). Polices servies par le produit lui-même. Français d'abord, anglais complet dans la même livraison ; ponctuation française (espace fine insécable U+202F avant `; : ! ?` et dans « »).

## 8. Liste de contrôle pour un nouveau produit

1. `kit/` copié, `YOLEA.md` à la racine, `sogoma-check` vert.
2. Ciel : logo Yolea, séparateur, symbole + nom + « par Yolea » en texte, langue, thème.
3. Pied : logo Yolea (Jour et Nuit), phrase, liens dont « Soutenir », langues, « Yolea, Abidjan. ».
4. Fondateur : texte approuvé copié (site), sans photo dans l'application.
5. Parité FR / EN des clés (`tests/core/i18n.test.ts`) ; 360 px, clavier seul, Nuit regardés.
