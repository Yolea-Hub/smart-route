# YOLEA.md

<!-- Modèle à déposer à la racine de chaque dépôt produit Yolea. Template dropped at the root of every Yolea product repository. -->

**Le guide Yolea, à lire avant ce fichier : https://docs.yolea.ai/guide/** (édition complète : `guide/GUIDE-YOLEA.fr.md` dans le dépôt Sogoma). / **The Yolea guide, to read before this file: https://docs.yolea.ai/en/guide/** (full edition: `guide/GUIDE-YOLEA.en.md` in the Sogoma repository).

## Français

Ce dépôt applique Sogoma, le langage de design de Yolea v4 « Matin neuf ». Ce fichier dit aux personnes et aux agents dans quel ordre lire les règles et quelles exceptions ce dépôt déclare.

### Ordre de lecture

1. Le guide Yolea, `https://docs.yolea.ai/guide/` : les règles de tous les projets Yolea.
2. Ce fichier, `YOLEA.md`.
3. La charte Sogoma en ligne : `https://docs.yolea.ai/sogoma/4.0/`. Si le site ne répond pas, le `kit/` copié dans ce dépôt fait foi : les fiches `kit/components/*.spec.fr.md`, les jetons `kit/tokens/`, la doctrine des icônes `kit/icons/ICONES.fr.md`. La charte elle-même n'est pas copiée.
4. Le `CLAUDE.md` de ce dépôt.

### Copier le kit

Depuis le dépôt Sogoma : `tools/vendor.sh <dossier du produit>`. Le script copie `kit/` et `tools/sogoma-check/`, sans caches, tests ni fixtures, dépose ce fichier et écrit `SOURCE.sha256`, qui fixe la copie et marque le dépôt comme dépôt produit. Vérifier une copie : `sha256sum -c --quiet SOURCE.sha256`. L'empreinte de la version : `sha256sum SOURCE.sha256`. Pour mettre à jour, relancer le script. Dans ce dépôt, `kit/` est un sous-ensemble de Sogoma 4.0.2 (les fichiers que ce produit emploie), 4 novembre 2026 ; les fiches de composants et la doctrine des icônes citées ci-dessus restent dans le dépôt Sogoma et sur `https://docs.yolea.ai/sogoma/4.0/`.

### Charger le kit dans une page

Les feuilles de style, dans cet ordre :

```html
<link rel="stylesheet" href="kit/tokens/tokens.css">
<link rel="stylesheet" href="kit/fonts/fallbacks.css">
<link rel="stylesheet" href="kit/css/base.css">
<link rel="stylesheet" href="kit/css/icons.css">
<link rel="stylesheet" href="kit/css/components.css">
```

Le Relevé ajoute `kit/css/statement.css` à la fin et ce script, sans lequel `<sg-amount>` et les autres éléments restent vides :

```html
<script type="module" src="kit/web/sg-statement.js"></script>
```

Les chemins sont à adapter au dossier servi par le produit. Les fichiers `base.css` et `sg-statement.js` cherchent leurs voisins par chemin relatif : gardez l'arborescence de `kit/`. La route du matin met `data-register="morning"` sur `<html>`.

### Contrôler

`python3 -I tools/sogoma-check/sogoma_check.py`, depuis la racine, en pré-commit et en intégration continue. Le crochet s'installe avec `ln -s ../../tools/sogoma-check/pre-commit-hook.sh .git/hooks/pre-commit`. Aucune fusion tant qu'il signale une erreur. Le `kit/` copié n'est pas lu (`--include-kit` pour le lire) ; `--exclude` écarte un autre dossier. S23 ne s'applique pas dans un dépôt produit : son outil reste dans le dépôt Sogoma, et une note le dit.

`--fix` corrige la composition française (S09) dans le Markdown et les tables de chaînes. Sur le HTML, S09 ne fait que signaler : on tape U+202F à la main.

### Ce qui l'emporte

- Le kit l'emporte sur la marque : couleurs, typographie, logos, visages de Rafiq, icônes, mouvements, chaînes canoniques.
- Le dépôt l'emporte sur la technique et la sécurité : pile, architecture, tests, déploiement.
- Ne jamais redessiner le logo, Rafiq ou une marque ; ne jamais retoucher un fichier de `kit/` copié. Une demande s'ouvre en issue sur le dépôt GitHub `Yolea-Hub/sogoma` (privé), avec l'un de ses trois formulaires ; sans accès au dépôt, par courriel à contact@yolea.ai (`mailto:contact@yolea.ai`).
- Ne jamais écrire une valeur qui n'est pas un jeton : pas de couleur, de taille ou de durée en dur. Le contrôle ne suffit pas : S08 avertit sur un hexadécimal et S17 refuse une durée, mais une couleur nommée ou une taille de police en dur ne sont pas détectées. Cela reste à la revue.
- Dire ce qui n'a pas été vérifié, dans la demande de fusion et dans le rapport.

### Les images

Règle du propriétaire du 31 octobre 2026 : les lieux et les objets emploient le moteur de lumière de `kit/illustrations/lumiere/`, avec ses exports cuits pour le courriel, le PDF et Open Graph. Les personnes emploient des images approuvées une par une par le propriétaire, sur les sites, les magasins et les présentations, jamais sur un écran de travail. Détail : `charte/IMAGES.fr.md`, dans le dépôt Sogoma.

### Les trois lignes machine

Elles sont lues par `sogoma-check`, ici même, hors de tout bloc de code. Remplacez les exemples ci-dessous par ceux de ce dépôt ; supprimez `icons_cap:` et `icon_pending:` s'ils ne servent pas. Leur forme est fixe, une ligne par entrée, date ISO obligatoire. Une ligne mal formée est une erreur S15.

home_routes: src/renderer/src/views/TaskView.tsx

- `home_routes:` les fichiers des routes d'accueil du produit. Aucun Chiffre, graphique ou table n'y est permis (règle S13) ; les fichiers `index.*` ne sont pas visés par défaut.
- `icons_cap:` le plafond d'icônes distinctes de ce dépôt. Sans cette ligne, le plafond est 12 (règle S15) ; une valeur supérieure n'est valable qu'avec sa date et sa raison, et devient une exception publiée.
- `icon_pending:` une icône manquante, rendue par le mot seul en attendant le dessin, avec sa date et le mot affiché. S15 la compte dans le plafond.

### Identité produit

Les règles du Ciel, du nom du produit, du pied de page, des logos et du fondateur, réutilisables par tout produit Yolea : `docs/IDENTITE-PRODUIT.fr.md`. Le site les applique par `site/scripts/shell.py` (puis `python3 -I site/scripts/apply-shell.py`), l'application par `SkyBand`, `ShellFooter` et `AboutPanel`.

### Les shims

Une icône Lucide de repli s'écrit ici, en texte libre, avec le mot voisin ; S15 la compte d'après son id `lucide-<nom>`. Exemple complet et origine des symboles : `kit/icons/MIGRATION-ICONES.fr.md`, section « Le wrapper et le shim ».

Yolea, Abidjan.

## English

This repository applies Sogoma, the design language of Yolea v4 "New Morning". This file tells people and agents in which order to read the rules and which exceptions this repository declares.

### Read order

1. The Yolea guide, `https://docs.yolea.ai/en/guide/`: the rules of every Yolea project.
2. This file, `YOLEA.md`.
3. The Sogoma charter online: `https://docs.yolea.ai/sogoma/4.0/`. If the site does not answer, the `kit/` vendored in this repository is authoritative for what it contains: the tokens `kit/tokens/`, the style sheets `kit/css/`, the fonts `kit/fonts/`. The component specs and the icon doctrine are not vendored.
4. This repository's `CLAUDE.md`.

### Vendoring the kit

From the Sogoma repository: `tools/vendor.sh <product folder>`. The script copies `kit/` and `tools/sogoma-check/`, without caches, tests or fixtures, drops this file and writes `SOURCE.sha256`, which pins the copy and marks the repository as a product repository. Verify a copy: `sha256sum -c --quiet SOURCE.sha256`. The fingerprint of the version: `sha256sum SOURCE.sha256`. To update, run the script again. In this repository, `kit/` is a subset of Sogoma 4.0.2 (the files this product uses), 4 November 2026; the component specs and the icon doctrine named above stay in the Sogoma repository and at `https://docs.yolea.ai/sogoma/4.0/`.

### Loading the kit in a page

The style sheets, in this order:

```html
<link rel="stylesheet" href="kit/tokens/tokens.css">
<link rel="stylesheet" href="kit/fonts/fallbacks.css">
<link rel="stylesheet" href="kit/css/base.css">
<link rel="stylesheet" href="kit/css/icons.css">
<link rel="stylesheet" href="kit/css/components.css">
```

The Statement adds `kit/css/statement.css` last and this script, without which `<sg-amount>` and the other elements stay blank:

```html
<script type="module" src="kit/web/sg-statement.js"></script>
```

Adapt the paths to the folder the product serves. `base.css` and `sg-statement.js` find their neighbours by relative path: keep the `kit/` tree as it is. The morning route puts `data-register="morning"` on `<html>`.

### Checking

`python3 -I tools/sogoma-check/sogoma_check.py`, from the root, in pre-commit and in CI. Install the hook with `ln -s ../../tools/sogoma-check/pre-commit-hook.sh .git/hooks/pre-commit`. No merge while it reports an error. The vendored `kit/` is not read (`--include-kit` reads it); `--exclude` skips another folder. S23 does not run in a product repository: its tool stays in the Sogoma repository, and a note says so.

`--fix` corrects French composition (S09) in Markdown and string tables. On HTML, S09 only reports: type U+202F by hand.

### What wins

- The kit wins on brand: colours, typography, logos, Rafiq's faces, icons, motion, canonical strings.
- The repository wins on technique and security: stack, architecture, tests, deployment.
- Never redraw the logo, Rafiq or a mark; never edit a vendored `kit/` file. A request is opened as an issue on the GitHub repository `Yolea-Hub/sogoma` (private), with one of its three forms; without access to the repository, by email to contact@yolea.ai (`mailto:contact@yolea.ai`).
- Never write a value that is not a token: no hard-coded colour, size or duration. The check is not enough: S08 warns on a hex value and S17 refuses a duration, but a named colour or a hard-coded font size go undetected. That stays with the review.
- Say what was not verified, in the pull request and in the report.

### Images

Owner rule of 31 October 2026: places and objects use the light engine of `kit/illustrations/lumiere/`, with its baked exports for e-mail, PDF and Open Graph. People use images approved one by one by the owner, on sites, stores and presentations, never on a working screen. Detail: `charte/IMAGES.en.md`, in the Sogoma repository.

### The three machine lines

They are read by `sogoma-check` from the French section above, outside any code block, and they appear only once. Replace the examples with this repository's own; delete `icons_cap:` and `icon_pending:` if unused. Their form is fixed, one line per entry, ISO date required. A malformed line is an S15 error.

- `home_routes:` the product's home route files. No Figure, chart or table is allowed there (rule S13); `index.*` files are not matched by default.
- `icons_cap:` the cap of distinct icons in this repository. Without this line the cap is 12 (rule S15); a higher value is valid only with its date and its reason, and becomes a published exception.
- `icon_pending:` a missing icon, rendered as the word alone until it is drawn, with its date and the displayed word. S15 counts it in the cap.

### Product identity

The rules for the Sky, the product name, the footer, logos and the founder, reusable by any Yolea product: `docs/IDENTITE-PRODUIT.en.md`. The site applies them through `site/scripts/shell.py` (then `python3 -I site/scripts/apply-shell.py`), the application through `SkyBand`, `ShellFooter` and `AboutPanel`.

### Shims

A Lucide fallback icon is written here, as free text, with the word beside it; S15 counts it from its id `lucide-<name>`. Complete example and the origin of the symbols: `kit/icons/MIGRATION-ICONES.en.md`, section "The wrapper and the shim".

Yolea, Abidjan.

## Écarts décidés par le propriétaire / Owner deviations (3 Nov 2026)

### Français

Sogoma 4.0.2 s'applique à tout le reste : jetons, Ciel, Fil et soleil, sol de la cour, Newsreader et Inter, grille 600 et 1024, durées 120, 200, 320 et 800 ms, Jour et Nuit généré, Bord à la place des roues d'attente, ni toast ni pastille chiffrée, parité FR et EN, polices servies par l'application elle-même. Les cinq écarts ci-dessous sont les seuls.

1. **Noms et logos officiels de tiers.** Claude, Claude Code, ChatGPT, Codex, Gemini et Antigravity sont nommés et leurs logos officiels sont montrés, tels que fournis (dossier `assets/brands/<fournisseur>/`, un `SOURCE.md` par fournisseur), jamais redessinés ni recolorés (le logo d'OpenAI est le pack officiel de la fleur, noire en Jour et blanche en Nuit, jamais le mot-symbole ; le propriétaire a accepté les conditions d'usage des marques d'OpenAI le 4 nov. 2026 ; voir `assets/brands/openai/SOURCE.md`). Raison : Smart Route est un routeur entre ces outils, la personne doit les reconnaître au premier regard. Le propriétaire a été informé que les conditions d'Anthropic demandent une autorisation écrite pour ses logos et accepte ce risque (3 nov. 2026). Pas de persona Rafiq dans ce produit. Mention de marques, texte complet : « Claude et Claude Code sont des marques d'Anthropic, PBC. ChatGPT et Codex sont des marques d'OpenAI. Gemini et Antigravity sont des marques de Google LLC. Smart Route est un produit indépendant de Yolea, sans lien avec ces sociétés. » (clé `legal.trademarks`, pied de l'application).
2. **Couleur du fournisseur et halo, seulement pendant que son outil travaille.** Trois propriétés personnalisées supplémentaires, dans `src/renderer/src/vendor.css` : `--vendor-anthropic` #D97757, `--vendor-openai` #10A37F, `--vendor-google` #4285F4. Elles servent à l'anneau et au halo du conteneur du nœud actif (`.rc-node.is-live`, `box-shadow`), aux particules qui courent sur l'arête entrante, et à la bordure de la puce de repli quand un fichier de logo manque. Jamais sur un logo (aucun filtre, aucun halo sur l'élément du logo), nulle part ailleurs : le reste de l'interface est sans halo. Raison : voir d'un coup quel outil travaille. Sous « réduire les animations » : anneau fixe, ni halo ni particules.
3. **Logo et icône propres à Smart Route** (`assets/brand/smart-route-*.svg`, ancre `build/icon.png`), à côté du logo Yolea et non à sa place (mise à jour du 4 nov. 2026) : le Ciel et le pied de page suivent l'identité produit de la maison, `docs/IDENTITE-PRODUIT.fr.md` (logo Yolea du Ciel à gauche, séparateur, symbole + nom + « par Yolea » en texte, pied avec le logo Yolea, lien « Soutenir Smart Route », fondateur). Les fichiers `smart-route-lockup*.svg` ne contiennent que le symbole et le nom. Raison : le produit est un outil à part, installé seul sur l'ordinateur, et il reste signé Yolea.
4. **Nom anglais en deux mots, « Smart Route »**, gardé dans les deux langues. Raison : c'est le nom du produit, il ne se traduit pas.
5. **Pas de Vega.** Ce produit n'utilise aucun moteur d'IA propre à Yolea : il lance les outils que la personne a déjà installés et payés.

Exclusions de `sogoma-check` (les seules autorisées) :

Les particules de l'arête qui mène au nœud actif ne bouclent plus : elles font 3 passes de 1,3 s (4,7 s au total), puis s'arrêtent ; elles repartent seulement quand l'arête active change. Elles ne sont pas affichées sous « réduire les animations ».

- `src/renderer/src/vendor.css` : règle S08 (avertissement, hexadécimal brut). Les trois couleurs de l'écart 2 ne sont pas des jetons Sogoma.
- `out/` et `node_modules/` : sorties de compilation et dépendances, pas des sources.
- Revue hors outil : le `box-shadow` de `.rc-node.is-live` dans `src/renderer/src/styles.css` (charte, couleur, interdit 6, « ombre, halo, contour autour d'un contour »). Il est voulu, uniquement par l'écart 2.

Commande, aussi en intégration continue : `python3 -I tools/sogoma-check/sogoma_check.py src --root . --exclude src/renderer/src/vendor.css`.

### English

Sogoma 4.0.2 applies to everything else: tokens, Sky, Line and sun, courtyard ground, Newsreader and Inter, grid 600 and 1024, durations 120, 200, 320 and 800 ms, Day and generated Night, the Edge instead of spinners, no toasts or digit badges, FR and EN parity, fonts served by the application itself. The five deviations below are the only ones.

1. **Third-party names and official logos.** Claude, Claude Code, ChatGPT, Codex, Gemini and Antigravity are named and their official logos are shown, as supplied (folder `assets/brands/<vendor>/`, one `SOURCE.md` per vendor), never redrawn or recoloured (the OpenAI logo is the official Blossom pack, Black on Day and White on Night, never the wordmark; the owner accepted OpenAI's marks usage terms on 4 Nov 2026; see `assets/brands/openai/SOURCE.md`). Reason: Smart Route is a router between these tools, the person must recognise them at first sight. The owner was told that Anthropic's terms ask for written permission for its logos and accepts that risk (3 Nov 2026). No Rafiq persona in this product. Trademark line, full text: "Claude and Claude Code are trademarks of Anthropic, PBC. ChatGPT and Codex are trademarks of OpenAI. Gemini and Antigravity are trademarks of Google LLC. Smart Route is an independent Yolea product, not affiliated with these companies." (key `legal.trademarks`, footer of the application).
2. **Vendor colour and glow, only while its tool works.** Three extra custom properties, in `src/renderer/src/vendor.css`: `--vendor-anthropic` #D97757, `--vendor-openai` #10A37F, `--vendor-google` #4285F4. They are used for the ring and glow of the working node's container (`.rc-node.is-live`, `box-shadow`), for the particles that run along the incoming edge, and for the border of the fallback chip when a logo file is missing. Never on a logo (no filter, no glow on the logo element), nowhere else: the rest of the interface has no glow. Reason: see at a glance which tool is working. Under reduced motion: a static ring, no glow and no particles.
3. **Smart Route's own logo and app icon** (`assets/brand/smart-route-*.svg`, source of `build/icon.png`), beside the Yolea logo and not instead of it (updated 4 Nov 2026): the Sky and the footer follow the house's product identity, `docs/IDENTITE-PRODUIT.en.md` (Yolea Sky logo on the left, divider, symbol + name + "by Yolea" as text, footer with the Yolea logo, "Support Smart Route" link, founder). The `smart-route-lockup*.svg` files carry only the symbol and the name. Reason: the product is a separate tool, installed on its own on the computer, and it stays signed Yolea.
4. **The two-word English name "Smart Route"** is kept in both languages. Reason: it is the product's name, it is not translated.
5. **No Vega.** This product uses no Yolea AI engine: it launches the tools the person has already installed and pays for.

`sogoma-check` exclusions (the only ones allowed):

The particles on the edge leading to the active node no longer loop: they make 3 passes of 1.3 s (4.7 s in total), then stop; they restart only when the active edge changes. They are not shown under reduced motion.

- `src/renderer/src/vendor.css`: rule S08 (warning, raw hex). The three colours of deviation 2 are not Sogoma tokens.
- `out/` and `node_modules/`: build output and dependencies, not sources.
- Held by review, outside the tool: the `box-shadow` of `.rc-node.is-live` in `src/renderer/src/styles.css` (charter, colour, numbered don't 6, "shadow, glow, outline around an outline"). It is intended, by deviation 2 only.

Command, also in continuous integration: `python3 -I tools/sogoma-check/sogoma_check.py src --root . --exclude src/renderer/src/vendor.css`.

Yolea, Abidjan.
