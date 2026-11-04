# Smart Route

*Arrêtez de comparer les IA. Découvrez tout ce qu'elles savent faire pour vous.*

[![Licence Apache 2.0](https://img.shields.io/badge/licence-Apache%202.0-blue.svg)](LICENSE)

## Français

Smart Route est une application de bureau, libre et gratuite, faite par Yolea à Abidjan. Elle lit ce que vous voulez faire, choisit pour chaque étape l'outil et le modèle qui conviennent parmi vos abonnements (Claude, ChatGPT/Codex, Gemini/Antigravity), vous montre son plan, et ne lance rien sans votre accord. Tout tourne sur votre ordinateur, avec vos comptes.

### Ce qu'elle fait

- **Choisit, combine, explique.** Elle classe la tâche, propose un plan en mots (quel outil, quel modèle, quel effort), puis exécute et relit. Pour le code, un second outil, d'un autre éditeur, relit le travail du premier.
- **Profils.** Au premier lancement, vous indiquez votre métier (développement, gestion, marketing, images, vidéo, recherche, études, entreprise). Les exemples et les recettes s'y adaptent.
- **Recettes.** Des enchaînements d'outils prêts à l'emploi pour chaque métier, lancés comme n'importe quel plan : même validation, mêmes règles de sécurité.
- **Atlas des outils.** Pour chaque outil, ce qu'il fait le mieux, avec des exemples, pour que vous découvriez ce que vos abonnements savent déjà faire.
- **Images et vidéo.** Ces tâches sont passées au bon outil web (ChatGPT, Gemini) avec le texte prêt à coller.
- **Bilingue.** Français et anglais, jour et nuit.
- **Version web locale.** Voir « Accès depuis le navigateur » plus bas.

### Installer

Téléchargez le fichier de votre système sur la [page Releases](https://github.com/Yolea-Hub/smart-route/releases/latest) ou sur [smartroute.yolea.ai](https://smartroute.yolea.ai/). Chaque version publie un fichier `SHA256SUMS` pour vérifier les téléchargements.

Prérequis : au moins un outil connecté sur votre ordinateur : Claude Code (compte Claude), Codex (compte ChatGPT) ou Antigravity (compte Google).

**Linux**
- AppImage : `chmod +x Smart-Route-*.AppImage && ./Smart-Route-*.AppImage`. Si elle ne s'ouvre pas sur Ubuntu 22.04 ou plus récent, installez `libfuse2` (`libfuse2t64` sur Ubuntu 24.04).
- Debian, Ubuntu : `sudo apt install ./smart-route_*.deb`.

**Windows** (64 bits). Ouvrez le fichier `.exe`. Le programme n'est pas encore signé : Windows affiche « Windows a protégé votre ordinateur ». Choisissez Informations complémentaires, puis Exécuter quand même.

**macOS** (Apple Silicon et Intel). Ouvrez le `.dmg` et glissez Smart Route dans Applications. Le programme n'est pas encore signé : au premier lancement, macOS refuse de l'ouvrir. Sous macOS 15 ou plus récent : Réglages Système, Confidentialité et sécurité, puis Ouvrir quand même. Sous macOS 14 ou plus ancien : clic droit sur Smart Route, puis Ouvrir.

### Accès depuis le navigateur

L'application de bureau peut servir une version web d'elle-même, visible de cet ordinateur seulement. Rien n'est hébergé ailleurs.

1. Dans l'application : Réglages, carte « Accès depuis le navigateur », cochez la case. L'adresse (`http://127.0.0.1:47821`, ou 47822 à 47824 si le port est pris) et un code de 8 caractères, valable 5 minutes et pour un seul navigateur, s'affichent.
2. Ouvrez l'adresse dans un navigateur de cet ordinateur et saisissez le code. « Nouveau code » en génère un autre.
3. Le navigateur garde une clé de session dans `sessionStorage` (fermer l'onglet l'oublie). Elle expire après 12 h sans usage ; redémarrer l'application oblige à s'appairer de nouveau.
4. « Révoquer l'accès » ferme toutes les connexions et efface toutes les clés. L'accès est désactivé à chaque démarrage de l'application.

Ce que le navigateur peut faire : poser une tâche, approuver le plan, suivre l'exécution, consulter et exporter l'historique (le navigateur télécharge le fichier). Les exécutions lancées depuis le navigateur sont toujours en lecture seule. Il ne peut pas : choisir un dossier, connecter ou déconnecter un compte, ouvrir les panneaux web, vider l'historique, ni changer un réglage autre que la langue.

**Modèle de menace.** Le serveur écoute sur `127.0.0.1` uniquement ; la machine seule y accède. L'en-tête `Host` doit être exactement `127.0.0.1:<port>` (contre le rebond DNS) et `Origin` exactement `http://127.0.0.1:<port>`, vérifiés avant la mise à niveau WebSocket : cela arrête les autres pages web ouvertes dans le même navigateur. Cela n'arrête pas un autre programme de cet ordinateur, qui peut écrire l'en-tête qu'il veut : c'est le code d'appairage, puis la clé de session (256 bits, seule son empreinte SHA-256 est gardée), qui l'arrêtent. Le code ne se devine pas (40 bits, 5 essais par minute pour toute l'application, annulé après 10 échecs). Le trafic local n'est pas chiffré : n'activez pas l'accès sur un ordinateur partagé avec des personnes qui n'ont pas votre confiance.

### Panneaux web et connexion Google

Les panneaux web (Claude, ChatGPT, Gemini) sont des fenêtres intégrées. Google refuse volontairement la connexion « Continuer avec Google » dans une fenêtre intégrée à une application, et Smart Route ne contourne pas cette règle (aucune usurpation du navigateur). Dans ce cas la navigation est annulée et l'application vous propose : vous connecter avec votre adresse e-mail (un code vous est envoyé), ou ouvrir le site dans votre navigateur habituel.

### Construire depuis les sources

Prérequis : Node.js récent et pnpm (version dans `package.json`).

```
pnpm install --frozen-lockfile
pnpm dev          # lance l'application
pnpm test         # tests
pnpm typecheck    # types
pnpm build        # application (out/main, out/preload, out/renderer) puis version web (out/web)
```

Paquets : `pnpm dist:linux`, `pnpm dist:win`, `pnpm dist:mac` (chacun sur son système).

### Vie privée

Aucune télémétrie, aucun compte Yolea, aucune statistique. Vos demandes, résultats, historique et réglages restent sur votre ordinateur. Les outils que vous choisissez reçoivent ce que vous leur envoyez et le traitent selon leurs propres conditions, comme si vous les aviez lancés vous-même. Voir [SECURITY.md](SECURITY.md) pour le modèle de menace.

### Licence et marques

Le code est sous [licence Apache 2.0](LICENSE). Les noms et logos « Yolea » et « Smart Route » ne sont pas couverts par la licence, pas plus que les marques de tiers (Claude et Claude Code, © Anthropic, PBC ; ChatGPT, Codex et OpenAI, © OpenAI ; Gemini et Antigravity, © Google LLC), utilisées selon les conditions de leurs propriétaires. Smart Route est un produit indépendant, sans lien avec ces sociétés. Sogoma (le système de design de Yolea, ses logos, illustrations et photos) reste la propriété de Yolea et n'est pas couvert par la licence Apache 2.0. Les polices (Inter, Newsreader, JetBrains Mono) sont sous SIL Open Font License 1.1, voir `kit/fonts/LICENCES/`. Voir [NOTICE](NOTICE).

### Contribuer et soutenir

Smart Route reste gratuit grâce à celles et ceux qui le soutiennent, et ce sont eux qui décident des prochaines fonctions.

- Soutenir et voir les fonctions à financer : [smartroute.yolea.ai/soutenir](https://smartroute.yolea.ai/soutenir/) (Mobile Money et carte en F CFA, ou GitHub Sponsors). Les noms de ceux qui l'acceptent sont dans [SUPPORTERS.md](SUPPORTERS.md).
- Contribuer : [CONTRIBUTING.fr.md](CONTRIBUTING.fr.md), [code de conduite](CODE_OF_CONDUCT.fr.md).
- Question, bogue, idée : [les tickets](https://github.com/Yolea-Hub/smart-route/issues). Contact : contact@yolea.ai.

## English

Smart Route is a free, open-source desktop app made by Yolea in Abidjan. It reads what you want to do, picks for each step the right tool and model among your subscriptions (Claude, ChatGPT/Codex, Gemini/Antigravity), shows you its plan, and starts nothing without your approval. Everything runs on your computer, with your accounts.

*Stop comparing AI tools. Discover everything they can do for you.*

### What it does

- **Picks, combines, explains.** It classifies the task, proposes a plan in words (which tool, which model, how much effort), then runs and reviews. For code, a second tool, from another vendor, reviews the first one's work.
- **Roles.** On first launch you say what you do (development, management, marketing, images, video, research, study, business). Examples and recipes adapt.
- **Recipes.** Ready-made tool sequences for each role, run like any other plan: same approval, same safety rules.
- **Capability atlas.** For each tool, what it does best, with examples, so you discover what your subscriptions can already do.
- **Images and video.** These tasks are handed to the right web tool (ChatGPT, Gemini) with the text ready to paste.
- **Bilingual.** French and English, day and night.
- **Local web version.** See "Browser access" below.

### Install

Download the file for your system from the [Releases page](https://github.com/Yolea-Hub/smart-route/releases/latest) or from [smartroute.yolea.ai](https://smartroute.yolea.ai/en/). Each release publishes a `SHA256SUMS` file to verify downloads.

Requirement: at least one tool signed in on your computer: Claude Code (Claude account), Codex (ChatGPT account) or Antigravity (Google account).

**Linux**
- AppImage: `chmod +x Smart-Route-*.AppImage && ./Smart-Route-*.AppImage`. If it does not open on Ubuntu 22.04 or later, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04).
- Debian, Ubuntu: `sudo apt install ./smart-route_*.deb`.

**Windows** (64-bit). Open the `.exe` file. The program is not signed yet: Windows shows "Windows protected your PC". Choose More info, then Run anyway.

**macOS** (Apple Silicon and Intel). Open the `.dmg` and drag Smart Route into Applications. The program is not signed yet: on first launch, macOS refuses to open it. On macOS 15 or later: System Settings, Privacy & Security, then Open Anyway. On macOS 14 or earlier: right-click Smart Route, then Open.

### Browser access

The desktop app can serve a web version of itself, visible from this computer only. Nothing is hosted elsewhere.

1. In the app: Settings, "Browser access" card, tick the box. The address (`http://127.0.0.1:47821`, or 47822 to 47824 if the port is taken) and an 8-character code, valid for 5 minutes and for one browser, appear.
2. Open the address in a browser on this computer and type the code. "New code" makes another one.
3. The browser keeps a session key in `sessionStorage` (closing the tab forgets it). It expires after 12 h without use; restarting the app means pairing again.
4. "Revoke all" closes every connection and erases every key. Access is off at every app start.

What the browser can do: ask for a task, approve the plan, follow the run, read and export the history (the browser downloads the file). Runs started from the browser are always read-only. It cannot: pick a folder, connect or disconnect an account, open the web panels, clear the history, or change any setting other than the language.

**Threat model.** The server listens on `127.0.0.1` only; only this machine reaches it. The `Host` header must be exactly `127.0.0.1:<port>` (against DNS rebinding) and `Origin` exactly `http://127.0.0.1:<port>`, both checked before the WebSocket upgrade: this stops other web pages open in the same browser. It does not stop another program on this computer, which can write any header it likes: the pairing code, then the session key (256 bits, only its SHA-256 is kept), stop it. The code cannot be guessed (40 bits, 5 tries a minute for the whole app, cancelled after 10 failures). Local traffic is not encrypted: do not turn access on for a computer shared with people you do not trust.

### Web panels and Google sign-in

The web panels (Claude, ChatGPT, Gemini) are embedded windows. Google deliberately refuses "Continue with Google" inside a window embedded in an app, and Smart Route does not work around that rule (no browser spoofing). The navigation is cancelled and the app offers two ways forward: sign in with your e-mail address (a code is sent to you), or open the site in your usual browser.

### Build from source

Requirements: a recent Node.js and pnpm (version in `package.json`).

```
pnpm install --frozen-lockfile
pnpm dev          # run the app
pnpm test         # tests
pnpm typecheck    # types
pnpm build        # app (out/main, out/preload, out/renderer) then web version (out/web)
```

Packages: `pnpm dist:linux`, `pnpm dist:win`, `pnpm dist:mac` (each on its own system).

### Privacy

No telemetry, no Yolea account, no statistics. Your requests, results, history and settings stay on your computer. The tools you choose receive what you send them and process it under their own terms, as if you had launched them yourself. See [SECURITY.md](SECURITY.md) for the threat model.

### Licence and trademarks

The code is under the [Apache 2.0 licence](LICENSE). The names and logos "Yolea" and "Smart Route" are not covered by the licence, nor are third-party marks (Claude and Claude Code, © Anthropic, PBC; ChatGPT, Codex and OpenAI, © OpenAI; Gemini and Antigravity, © Google LLC), which are used under their owners' terms. Smart Route is an independent product, not affiliated with these companies. Sogoma (Yolea's design system, its logos, illustrations and photos) remains the property of Yolea and is not covered by the Apache 2.0 licence. The fonts (Inter, Newsreader, JetBrains Mono) are under the SIL Open Font License 1.1, see `kit/fonts/LICENCES/`. See [NOTICE](NOTICE).

### Contribute and support

Smart Route stays free thanks to the people who support it, and they decide which features come next.

- Support and see the features to fund: [smartroute.yolea.ai/en/support](https://smartroute.yolea.ai/en/support/) (Mobile Money and card in F CFA, or GitHub Sponsors). The names of those who agree are in [SUPPORTERS.md](SUPPORTERS.md).
- Contribute: [CONTRIBUTING.en.md](CONTRIBUTING.en.md), [code of conduct](CODE_OF_CONDUCT.en.md).
- Question, bug, idea: [issues](https://github.com/Yolea-Hub/smart-route/issues). Contact: contact@yolea.ai.
