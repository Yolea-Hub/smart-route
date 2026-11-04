# Avant de rendre le dépôt public / Before the repository goes public

Le dépôt `Yolea-Hub/smart-route` est créé **privé** (décision du propriétaire, 4 novembre 2026). Il ne s'ouvre au public que lorsque le propriétaire dit que le produit est prêt pour la production.
The repository `Yolea-Hub/smart-route` is created **private** (owner decision, 4 November 2026). It opens to the public only when the owner says the product is production-ready.

## Français

À faire, dans cet ordre, avant l'ouverture :

- [x] **a. Réduire le kit Sogoma au sous-ensemble utilisé.** Remplacer `kit/` complet par : les 3 logos (`logos/yolea-lockup*.svg`), `tokens/`, `css/base.css`, `css/components.css`, `css/icons*`, `fonts/` avec `fonts/LICENCES`, `web/sg-theme.js`, et `tools/sogoma-check/`. Supprimer le reste : brouillons et prompts d'illustrations, briefs internes (`kit/illustrations/**/PROMPTS*`, `BRIEF-ARTISTE.*`, `DEMANDES.md`, `labo/`), photos, modèles, e-mails, Flutter, WhatsApp. Régénérer `SOURCE.sha256` (`sha256sum -c SOURCE.sha256` doit passer) et relancer `bash site/build.sh`.
- [x] **Chemins locaux dans le kit.** Retirer ou réécrire les fichiers de `kit/` qui contiennent un chemin de la machine du propriétaire (au 4 novembre 2026 : `kit/illustrations/people/PROMPTS.fr-en.md`, `kit/illustrations/labo/d-fil/render.mjs`, `kit/fonts/SOURCES.md`). Vérifier avec `grep -rn "/home/\|YOLEA SA" .` (hors `node_modules`).
- [x] **b. NOTICE.** Écrire que Sogoma, les illustrations et les photos restent la propriété de Yolea (non couverts par la licence Apache 2.0), et nommer la licence des polices : SIL Open Font License 1.1 (Inter, Newsreader), avec renvoi à `kit/fonts/LICENCES`. Reporter la même phrase dans `README.md`.
- [ ] **c. Déployer le site** `smartroute.yolea.ai` (voir `site/deploy/README-DEPLOIEMENT.fr.md`), puis vérifier les pages Licences, Confidentialité et Mentions légales.
- [ ] **d. Activer Sponsors / Chariow** (boutons de soutien, `SUPPORTERS.md`, page Soutenir) et vérifier les liens.
- [ ] **e. Tout élément ci-dessous marqué « avant public ».** Aucun pour l'instant ; ajouter ici ce que les revues futures marquent ainsi.
- [ ] Relire `SECURITY.md` (adresse de contact, signalement privé GitHub activé sur le dépôt) et lancer `gitleaks dir . --config .gitleaks.toml`.

## English

To do, in this order, before opening:

- [x] **a. Reduce the Sogoma kit to the subset in use.** Replace the full `kit/` with: the 3 logos (`logos/yolea-lockup*.svg`), `tokens/`, `css/base.css`, `css/components.css`, `css/icons*`, `fonts/` with `fonts/LICENCES`, `web/sg-theme.js`, and `tools/sogoma-check/`. Remove the rest: illustration drafts and prompts, internal briefs (`kit/illustrations/**/PROMPTS*`, `BRIEF-ARTISTE.*`, `DEMANDES.md`, `labo/`), photos, templates, mail, Flutter, WhatsApp. Regenerate `SOURCE.sha256` (`sha256sum -c SOURCE.sha256` must pass) and run `bash site/build.sh` again.
- [x] **Local paths in the kit.** Remove or rewrite the `kit/` files that contain a path from the owner's machine (on 4 November 2026: `kit/illustrations/people/PROMPTS.fr-en.md`, `kit/illustrations/labo/d-fil/render.mjs`, `kit/fonts/SOURCES.md`). Check with `grep -rn "/home/\|YOLEA SA" .` (outside `node_modules`).
- [x] **b. NOTICE.** State that Sogoma, the illustrations and the photos stay Yolea property (not covered by the Apache 2.0 licence), and name the font licence: SIL Open Font License 1.1 (Inter, Newsreader), pointing to `kit/fonts/LICENCES`. Repeat the same sentence in `README.md`.
- [ ] **c. Deploy the site** `smartroute.yolea.ai` (see `site/deploy/README-DEPLOIEMENT.en.md`), then check the Licences, Privacy and Legal notice pages.
- [ ] **d. Enable Sponsors / Chariow** (support buttons, `SUPPORTERS.md`, the Support page) and check the links.
- [ ] **e. Any item below marked "before public".** None for now; add here whatever future reviews mark that way.
- [ ] Re-read `SECURITY.md` (contact address, GitHub private reporting enabled on the repository) and run `gitleaks dir . --config .gitleaks.toml`.
