# Déploiement du site Smart Route (smartroute.yolea.ai)

Site statique (HTML, CSS, un fichier JavaScript) servi par un Worker `smart-route-site` : les pages sont des fichiers statiques, et un petit script (`deploy/worker.js`) sert seulement `/dl/*`, les installeurs copiés dans un seau R2 privé. Le domaine `smartroute.yolea.ai` est un Custom Domain du Worker. Rien ne se déploie depuis l'intégration continue : le déploiement est un geste manuel, après relecture.

## Ce qu'il y a dans le dossier `site/`

| Chemin | Rôle |
|---|---|
| `public/` | Les pages à la main : `index.html` (FR), `en/index.html` (EN), `site.css`, `site.js`, `_headers`, `404.html`, `robots.txt`, `sitemap.xml`. Les pages légales (4 FR, 4 EN) sont écrites par `scripts/gen-legal.py` |
| `kit/` | Copie du sous-ensemble du kit Sogoma que le site charge. Écrite par `scripts/sync-kit.sh`, jamais à la main |
| `build.sh` | Assemble `dist/` : `public/` + `kit/` + les logos que les pages nomment, avec `?v=<empreinte>` sur les feuilles et scripts |
| `dist/`, `dist.stamp` | Le résultat, et sa fiche (empreinte des sources, commit). Non versionnés |
| `deploy/wrangler.jsonc` | Worker, Custom Domain, seau R2 `smart-route-downloads` (liaison `DL`), `run_worker_first: ["/dl/*"]`, `workers_dev: false`, `preview_urls: false` |
| `deploy/worker.js` | Sert `/dl/latest.json` et `/dl/v<version>/<fichier>` depuis R2 (plages d'octets, ETag, 206/304/416) ; tout le reste va aux fichiers statiques. Testé par `site/tests/worker.test.mjs` |
| `deploy/guard-fresh-build.sh` | Refuse de déployer une construction absente, incomplète, plus ancienne que ses sources, ou issue d'un autre commit |

## Une fois, avant le premier déploiement

1. Compte Cloudflare du propriétaire, zone `yolea.ai` dans ce compte. Connexion de wrangler : `pnpm exec wrangler login` (geste du propriétaire).
2. Le Custom Domain `smartroute.yolea.ai` crée seul l'enregistrement DNS et le certificat. Aucun enregistrement `smartroute` ne doit exister avant : sinon le premier déploiement échoue, supprimer l'ancien enregistrement.
3. Les Releases GitHub publiques du dépôt `Yolea-Hub/smart-route` restent la source. Le seau R2 privé `smart-route-downloads` (`pnpm exec wrangler r2 bucket create smart-route-downloads`) en reçoit une copie, servie par le Worker sous `smartroute.yolea.ai/dl/` (même origine, pas de nouveau domaine, pas de changement de CSP). Si le seau est vide ou absent, la page se rabat sur l'API publique de GitHub (la CSP l'autorise : `connect-src`). Une release est publiée par le workflow `release.yml` (étiquette `v*`) ; tant qu'il n'y en a pas, le site affiche « Bientôt disponible ».
4. Dépendances du déploiement : `cd site/deploy && pnpm install --ignore-workspace`.

## Comment la page trouve les téléchargements

`site.js` lit d'abord `/dl/latest.json` (même origine : version, date, et pour chaque fichier nom, taille, SHA-256 et lien `/dl/v<version>/<nom>`). Le fichier est strictement validé ; absent ou invalide, la page lit `https://api.github.com/repos/Yolea-Hub/smart-route/releases/latest` (sans jeton, sans cookie). Il reconnaît les fichiers par les noms qu'écrit electron-builder (`artifactName` : `Smart-Route-<version>-<os>-<arch>.<ext>`) :

| Fichier | Système |
|---|---|
| `Smart-Route-0.1.0-linux-x86_64.AppImage` | Linux, toutes distributions |
| `Smart-Route-0.1.0-linux-amd64.deb` | Debian, Ubuntu |
| `Smart-Route-0.1.0-win-x64.exe` | Windows 64 bits |
| `Smart-Route-0.1.0-mac-arm64.dmg`, `Smart-Route-0.1.0-mac-x64.dmg` | macOS Apple Silicon, Intel |

- Avec le miroir, taille et SHA-256 viennent de `latest.json` et la page ne contacte aucun tiers. Avec le repli GitHub, la taille vient du champ `size` de l'API. L'empreinte SHA-256 vient du fichier `SHA256SUMS` de la release, lu par son `browser_download_url` ; si le navigateur refuse (CORS), la page montre un lien vers `SHA256SUMS`.
- Seuls sont acceptés les liens `https://github.com/Yolea-Hub/smart-route/releases/download/...` (sans paramètres), un nom conforme au motif ci-dessus et une taille plausible. Brouillons et préversions sont ignorés.
- Aucune release (404) : « Bientôt disponible ». Limite de débit de l'API (403/429, 60 requêtes par heure et par adresse) : même message, avec un lien vers la page des versions.
- Contrôle du comportement sans navigateur : `node --test site/tests/site-downloads.test.mjs`.
- La CSP (`public/_headers`) autorise `connect-src 'self' https://api.github.com https://github.com https://objects.githubusercontent.com https://release-assets.githubusercontent.com` : l'API, la redirection de téléchargement de `SHA256SUMS` et son hébergement.

## Publier une version dans le miroir R2

Après chaque release GitHub (le workflow `release.yml` a publié les installeurs et `SHA256SUMS`), depuis la racine du dépôt :

```bash
scripts/mirror-release.sh --dry-run v0.2.1   # télécharge (16 plages par fichier), vérifie les SHA-256, prépare latest.json ; n'envoie rien
scripts/mirror-release.sh v0.2.1             # idem, puis envoie v0.2.1/<fichiers> dans R2, et latest.json EN DERNIER
scripts/mirror-release.sh --from-dir <dossier> v0.2.1   # sans téléchargement : réutilise des fichiers déjà là (ils sont revérifiés)
```

Le script refuse une étiquette dont une somme de contrôle ne correspond pas, ou qui n'a pas de `SHA256SUMS`. Il est rejouable sans risque. Il faut la connexion de wrangler (`pnpm exec wrangler login`) ou `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

Automatique, plus tard : `release.yml` a une étape « Mirror to Cloudflare R2 » qui ne tourne que si le secret `CLOUDFLARE_API_TOKEN` existe (sinon elle laisse une note). Pour l'activer, le propriétaire crée un jeton d'API avec la permission *Workers R2 Storage : Edit* sur le compte Yolea, puis `gh secret set CLOUDFLARE_API_TOKEN` et `gh secret set CLOUDFLARE_ACCOUNT_ID`.

Contrôle après un envoi : `curl -sI https://smartroute.yolea.ai/dl/latest.json` répond 200 (JSON) ; `curl -sI .../dl/v0.2.1/Smart-Route-0.2.1-linux-amd64.deb` répond 200 avec `content-length` et `accept-ranges: bytes` ; avec `-H 'Range: bytes=0-99'` il répond 206.

## Déployer

Depuis le dossier du dépôt :

```bash
# 1. Régénérer ce qui se génère, puis contrôler
python3 -I site/scripts/gen-legal.py && python3 -I site/scripts/fr-typo.py
python3 -I tools/sogoma-check/sogoma_check.py site/public --root site
# 2. Construire, garder, déployer (le dépôt doit être propre et sur le bon commit)
cd site/deploy
pnpm run dry           # à blanc : ne construit rien, ne déploie rien, lit la configuration
pnpm run deploy:site   # build.sh, guard-fresh-build.sh, puis wrangler deploy
```

Le gardien refuse : un `dist/` absent ou incomplet, un `robots.txt` qui interdit tout, des sources changées depuis la construction, `site/kit` différent de `kit/`, un arbre git non propre sous `site/` ou `assets/`, une construction issue d'un autre commit que HEAD. Wrangler le relance seul avant tout déploiement (`build.command`), donc un `wrangler deploy` direct est gardé aussi.

Contrôle après déploiement : `curl -sI https://smartroute.yolea.ai/` doit montrer `content-security-policy`, `strict-transport-security` et `x-content-type-options` ; `https://smartroute.yolea.ai/en/` et les huit pages légales répondent 200 ; `https://smartroute.yolea.ai/inexistant` répond 404 avec la page bilingue.

## Revenir en arrière

1. Une version précédente du Worker : `cd site/deploy && pnpm run rollback` (liste les versions, choisir la précédente). Le Custom Domain ne bouge pas.
2. Un mauvais contenu seulement : corriger, reconstruire, redéployer.
3. Retirer le site : supprimer l'entrée `routes` de `wrangler.jsonc` puis déployer, ou supprimer le Custom Domain dans le tableau de bord Cloudflare (Workers & Pages, `smart-route-site`, Settings, Domains). L'enregistrement DNS créé par le Custom Domain disparaît avec lui.

## Mettre à jour le kit ou les logos

- Kit : `bash site/scripts/sync-kit.sh` (copie depuis `kit/` à la racine, obligatoire : le script s'arrête avec un message clair s'il manque), puis `bash site/build.sh`. `sync-kit.sh --check` dit si la copie s'est écartée.
- Logos OpenAI : ils existent (pack officiel, conditions acceptées le 4 novembre 2026) dans `assets/brands/openai/` ; voir `SOURCE.md` du dossier. Pour les changer, remplacer les fichiers et vérifier que `public/index.html` et `public/en/index.html` les nomment.

## Écarts à Sogoma, documentés

Noms et logos officiels de tiers ; couleurs des éditeurs (`--vc-claude`, `--vc-openai`, `--vc-google` dans `site.css`) et lueur sur le conteneur du nœud d'un outil, seulement pendant son tour dans le schéma. Voir `YOLEA.md`. Avertissements `sogoma-check` attendus : S08 pour ces trois couleurs, et pour la couleur de `meta theme-color`.
