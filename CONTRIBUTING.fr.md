# Contribuer à Smart Route

Merci de vouloir aider. Smart Route est libre (licence Apache 2.0) et gratuit. [English version](CONTRIBUTING.en.md).

En participant, vous acceptez le [code de conduite](CODE_OF_CONDUCT.fr.md).

## Avant de commencer

- Une question ? Ouvrez un ticket « Question » ou écrivez à contact@yolea.ai.
- Un bogue ? Ouvrez un ticket « Bogue », avec votre système, la version de Smart Route et les étapes pour le reproduire.
- Une faille de sécurité ? Ne la publiez pas : lisez [SECURITY.md](SECURITY.md).
- Une idée ? Ouvrez un ticket « Fonction à financer ». Les fonctions soutenues par la communauté sont listées sur [la page Soutenir](https://smartroute.yolea.ai/soutenir/).
- Un changement important ? Parlons-en dans un ticket avant d'écrire le code, pour ne pas vous faire perdre de temps.

## Mettre en place

Prérequis : Node.js récent et pnpm (la version est dans `package.json`, champ `packageManager`).

```
pnpm install --frozen-lockfile
pnpm dev          # lance l'application
pnpm test         # tests
pnpm typecheck    # types
pnpm build        # application + version web
```

## Règles du projet

- **Bilingue.** Tout texte visible (interface, messages d'erreur, documentation, site) existe en français et en anglais, le français d'abord. Un écran ou une page en une seule langue ne sera pas accepté.
- **Typographie française.** Espace fine insécable (U+202F) avant `;` `:` `!` `?` et à l'intérieur des guillemets « ».
- **Sogoma.** L'interface suit le système de design Sogoma. Lancez `python3 -I tools/sogoma-check/sogoma_check.py` ; il ne doit signaler aucune erreur. Ne modifiez pas `kit/` ni `tools/sogoma-check/` à la main : ils sont copiés depuis le dépôt Sogoma.
- **Tests.** Tout changement de comportement arrive avec un test. `pnpm test` et `pnpm typecheck` doivent passer.
- **Sécurité par défaut.** Pas de secret dans le code, entrées validées, pas de shell avec des données non fiables. Les exécutions lancées depuis le navigateur restent en lecture seule.
- **Pas de télémétrie.** Smart Route n'envoie rien à Yolea. Aucune contribution ne doit ajouter de suivi ou d'appel réseau non demandé.
- **Marques.** Les noms et logos de Yolea, de Smart Route et des éditeurs tiers ne sont pas sous licence Apache : voir [NOTICE](NOTICE).

## Proposer un changement

1. Dupliquez le dépôt (fork), puis créez une branche courte et descriptive.
2. Faites des commits petits, avec un message en anglais qui dit ce qui change et pourquoi.
3. Lancez les tests, le contrôle de types et sogoma-check.
4. Ouvrez une demande de fusion (pull request) avec le modèle fourni ; liez le ticket concerné.
5. Une personne de l'équipe relit. Nous répondons en général sous quelques jours ; relancez-nous poliment si besoin.

## Licence de vos contributions

Sauf mention contraire de votre part, toute contribution que vous soumettez est publiée sous licence Apache 2.0, comme le reste du projet (article 5 de la licence).
