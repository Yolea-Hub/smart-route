# Sécurité

## Français

### Signaler une faille

N'ouvrez pas de ticket public pour une faille. Écrivez à **contact@yolea.ai** avec l'objet « Sécurité Smart Route » : décrivez le problème, la version, le système et, si possible, les étapes pour le reproduire. Nous accusons réception sous 5 jours ouvrés, vous tenons au courant, et vous citons dans les notes de version si vous le souhaitez. Vous pouvez aussi utiliser le signalement privé de GitHub (onglet Security du dépôt, « Report a vulnerability »).

Versions prises en charge : la dernière version publiée.

### Ce que Smart Route fait et ne fait pas

Smart Route tourne sur votre ordinateur. Il lance les outils installés chez vous (Claude Code, Codex, Antigravity) avec vos connexions ; il ne garde aucune clé et n'envoie rien à Yolea. Aucune télémétrie.

### Modèle de menace de l'accès depuis le navigateur

L'application peut servir une version web d'elle-même, désactivée à chaque démarrage.

- Le serveur écoute sur `127.0.0.1` uniquement ; seule la machine y accède.
- L'en-tête `Host` doit être exactement `127.0.0.1:<port>` (contre le rebond DNS) et `Origin` exactement `http://127.0.0.1:<port>`, vérifiés avant la mise à niveau WebSocket. Cela arrête les autres pages web ouvertes dans le même navigateur.
- Cela n'arrête pas un autre programme de la machine, qui peut écrire l'en-tête qu'il veut : le code d'appairage, puis la clé de session, l'arrêtent. Le code (8 caractères, 40 bits, valable 5 minutes, un seul navigateur) est limité à 5 essais par minute pour toute l'application et annulé après 10 échecs. La clé de session fait 256 bits, seule son empreinte SHA-256 est gardée, elle expire après 12 h sans usage.
- N'importe quel programme local peut joindre `127.0.0.1:<port>` : seuls le code d'appairage et la clé de session protègent l'accès. Le serveur accepte au plus 8 connexions à la fois et 20 mises à niveau WebSocket par minute, pour qu'un programme local ne puisse pas occuper toutes les places ; au plus 3 exécutions tournent en même temps (application et navigateur ensemble).
- Les exécutions lancées depuis le navigateur sont en lecture seule. Ce navigateur peut utiliser, en lecture seule, les dossiers déjà choisis dans l'application. Le navigateur ne peut ni choisir un dossier, ni connecter un compte, ni vider l'historique, ni changer un réglage autre que la langue.
- Le trafic local n'est pas chiffré : n'activez pas l'accès sur un ordinateur partagé avec des personnes qui n'ont pas votre confiance.
- Lecture du web par Antigravity : une instruction cachée dans un texte ou un fichier pourrait pousser l'outil à lire vos fichiers puis à les envoyer à une adresse web. Pour l'éviter, Smart Route n'autorise la lecture d'adresses web (`read_url`) que lorsque l'étape tourne **sans** dossier de votre part (dossier de travail temporaire et vide). Quand vous choisissez un dossier, les étapes en lecture seule d'Antigravity n'ont pas cette permission : elles répondent avec leurs connaissances, et le brief leur dit que la lecture du web est indisponible, par confidentialité.
- Hors périmètre : un attaquant qui a déjà le contrôle de votre session utilisateur, ou les failles des outils tiers lancés (à signaler à leurs éditeurs).

### Vérifier un téléchargement

Chaque version publie un fichier `SHA256SUMS`. Comparez l'empreinte : `sha256sum fichier` (Linux), `shasum -a 256 fichier` (macOS), `Get-FileHash fichier` (Windows PowerShell). Les installeurs Windows et macOS ne sont pas encore signés.

## English

### Report a vulnerability

Do not open a public issue for a vulnerability. Write to **contact@yolea.ai** with the subject "Smart Route security": describe the problem, the version, the system and, if possible, the steps to reproduce it. We acknowledge within 5 working days, keep you informed, and credit you in the release notes if you wish. You can also use GitHub's private reporting (the repository's Security tab, "Report a vulnerability").

Supported versions: the latest published release.

### What Smart Route does and does not do

Smart Route runs on your computer. It launches the tools installed there (Claude Code, Codex, Antigravity) with your logins; it stores no key and sends nothing to Yolea. No telemetry.

### Threat model of browser access

The app can serve a web version of itself, switched off at every start.

- The server listens on `127.0.0.1` only; only this machine reaches it.
- The `Host` header must be exactly `127.0.0.1:<port>` (against DNS rebinding) and `Origin` exactly `http://127.0.0.1:<port>`, both checked before the WebSocket upgrade. This stops other web pages open in the same browser.
- This does not stop another program on the machine, which can write any header it likes: the pairing code, then the session key, stop it. The code (8 characters, 40 bits, valid 5 minutes, one browser) is limited to 5 tries a minute for the whole app and cancelled after 10 failures. The session key is 256 bits, only its SHA-256 is kept, and it expires after 12 h without use.
- Any local program can reach `127.0.0.1:<port>`: only the pairing code and the session key protect it. The server accepts at most 8 connections at once and 20 WebSocket upgrades per minute, so a local program cannot take all the slots; at most 3 runs are active at the same time (app and browser together).
- Runs started from the browser are read-only. This browser can use, read-only, the folders already chosen in the app. The browser cannot pick a folder, connect an account, clear the history, or change any setting other than the language.
- Local traffic is not encrypted: do not turn access on for a computer shared with people you do not trust.
- Web reading by Antigravity: an instruction hidden in a text or a file could push the tool to read your files and then send them to a web address. To prevent this, Smart Route allows reading web addresses (`read_url`) only when the step runs **without** a folder from you (the empty temporary work folder). When you choose a folder, Antigravity's read-only steps do not have that permission: they answer from their knowledge, and the brief tells them web reading is unavailable, for privacy.
- Out of scope: an attacker who already controls your user session, or flaws in the third-party tools Smart Route launches (report those to their vendors).

### Verify a download

Each release publishes a `SHA256SUMS` file. Compare the hash: `sha256sum file` (Linux), `shasum -a 256 file` (macOS), `Get-FileHash file` (Windows PowerShell). The Windows and macOS installers are not signed yet.
