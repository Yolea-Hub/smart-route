#!/usr/bin/env python3
"""Writes the eight legal pages of the site (FR and EN: legal notice, privacy, accessibility, licences) into site/public/.
Texts adapted from kit/pages/legal/*.{fr,en}.html for Smart Route: no cookie, no analytics, no third-party script.
The licence texts of the two fonts the site loads (Inter, Newsreader) are copied from kit/pages/licences.{fr,en}.html.
Run: python3 -I site/scripts/gen-legal.py   (then scripts/fr-typo.py for the French typography)."""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shell

SITE = Path(__file__).resolve().parent.parent
ROOT = SITE.parent
KIT = ROOT / "kit"
if not (KIT / "pages").is_dir():
    sys.exit(f"gen-legal: the repository-root kit/ is missing ({KIT / 'pages'} not found). Restore kit/ (the Sogoma kit) at the repository root.")
UPDATED = {"fr": "4 novembre 2026", "en": "4 November 2026"}

TRADEMARK = {
    "fr": "Claude et Claude Code sont des marques d'Anthropic, PBC. ChatGPT et Codex sont des marques d'OpenAI. Gemini et Antigravity sont des marques de Google LLC. Smart Route est un produit indépendant de Yolea, sans lien avec ces sociétés.",
    "en": "Claude and Claude Code are trademarks of Anthropic, PBC. ChatGPT and Codex are trademarks of OpenAI. Gemini and Antigravity are trademarks of Google LLC. Smart Route is an independent Yolea product, not affiliated with these companies.",
}

PATHS = {
    "fr": {"legal": "/mentions-legales/", "privacy": "/confidentialite/", "access": "/accessibilite/", "licences": "/licences/", "home": "/"},
    "en": {"legal": "/en/legal-notice/", "privacy": "/en/privacy/", "access": "/en/accessibility/", "licences": "/en/licences/", "home": "/en/"},
}


def licence_block(lang: str, name: str) -> str:
    text = (KIT / "pages" / f"licences.{lang}.html").read_text(encoding="utf-8")
    main = re.search(r"<main>(.*)</main>", text, re.S).group(1)
    m = re.search(r"<h3>%s</h3>\s*(<pre>.*?</pre>)" % re.escape(name), main, re.S)
    if not m:
        sys.exit(f"licence block {name} not found in kit/pages/licences.{lang}.html")
    return f"<h3>{name}</h3>\n{m.group(1)}"


DEPS_FILE = SITE / "licences-deps.json"
if not DEPS_FILE.is_file():
    sys.exit("gen-legal: site/licences-deps.json is missing. Run: node scripts/export-licences.mjs")
DEPS = json.loads(DEPS_FILE.read_text(encoding="utf-8"))
if not DEPS:
    sys.exit("gen-legal: site/licences-deps.json is empty")


def deps_section(lang: str) -> str:
    items = [
        f'<a class="sg-link" href="{html.escape(d["url"])}" rel="noopener noreferrer">{html.escape(d["name"])}</a> {html.escape(d["version"])} · {html.escape(d["licence"])}'
        for d in DEPS
    ]
    if lang == "fr":
        return sec(
            "Logiciels tiers du programme",
            p("Le programme Smart Route embarque les bibliothèques suivantes (liste générée depuis les dépendances de production du projet, avec le nom, la version et la licence de chacune) :"),
            ul(*items),
            p("Le programme est livré avec Electron, qui contient Chromium et Node.js. Leurs licences et celles des composants qu'ils incluent sont fournies avec le programme, dans les fichiers LICENSE.electron.txt et LICENSES.chromium.html placés à côté de l'exécutable."),
        )
    return sec(
        "Third-party software in the program",
        p("The Smart Route program ships the following libraries (list generated from the project's production dependencies, with the name, version and licence of each):"),
        ul(*items),
        p("The program is delivered with Electron, which contains Chromium and Node.js. Their licences, and those of the components they include, are provided with the program, in the LICENSE.electron.txt and LICENSES.chromium.html files placed next to the executable."),
    )


def sec(title: str, *body: str) -> str:
    return f'<section class="sr-text"><h2>{title}</h2>{"".join(body)}</section>'


def p(t: str) -> str:
    return f"<p>{t}</p>"


def ul(*items: str) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


PAGES = {
    "fr": {
        "legal": ("Mentions légales", "Mentions légales du site smartroute.yolea.ai.", [
            sec("Éditeur du site", p("Yolea, Abidjan, Côte d'Ivoire."), p("Contact : contact@yolea.ai.")),
            sec("Directeur de la publication", p("Thierry Memel, fondateur de Yolea.")),
            sec("Hébergement", p("Les pages de ce site sont servies par Cloudflare, Inc., États-Unis. Les fichiers à télécharger sont publiés sur GitHub (GitHub Releases, GitHub, Inc., États-Unis).")),
            sec("Marques", p(TRADEMARK["fr"])),
            sec("Vos données", p("Ce que nous faisons de vos données est décrit sur la page Confidentialité.")),
        ]),
        "privacy": ("Confidentialité", "Ce que ce site et le programme Smart Route font de vos données.", [
            sec("Sur ce site", p("Aucun cookie, aucun traceur, aucune statistique de visite, aucune publicité, aucun script d'un tiers (la seule requête vers un tiers est celle décrite ci-dessous). Votre choix de thème reste dans votre navigateur ; il n'est envoyé nulle part."),
                p("La section de téléchargement interroge api.github.com pour connaître la dernière version publiée (sans cookie, sans identifiant), et lit ensuite automatiquement le fichier SHA256SUMS sur github.com, quand votre navigateur l'autorise. Ces requêtes partent de votre navigateur vers GitHub, qui les traite selon sa propre politique ; nous n'en recevons rien. Les fichiers eux-mêmes se téléchargent depuis GitHub."),
                p("Cloudflare, qui sert le site, tient aussi ses propres journaux techniques. Nous n'avons pas vérifié ce qu'ils contiennent ni combien de temps ils sont gardés.")),
            sec("Dans le programme Smart Route", p("Smart Route tourne sur votre ordinateur. Vos demandes, vos résultats, votre historique et vos réglages restent sur votre ordinateur : Yolea ne les reçoit pas, et il n'existe pas de compte Yolea."),
                p("Le programme lance les outils installés chez vous (Claude Code, Codex, Antigravity), avec vos connexions. Ce que vous envoyez à un outil est traité par son éditeur, selon vos conditions avec lui."),
                p("La version web est servie par le programme lui-même, à l'adresse 127.0.0.1 de votre ordinateur : elle n'est pas joignable depuis un autre appareil.")),
            sec("Ce que nous ne faisons jamais", p("Nous ne vendons jamais vos données personnelles et nous n'affichons pas de publicité.")),
            sec("Qui y a accès", p("Pour ce site : Cloudflare, qui sert les pages, et GitHub, qui publie les fichiers. Pour le programme : personne chez Yolea, puisque rien ne nous est envoyé.")),
            sec("Vos droits", p("Vous pouvez nous écrire à contact@yolea.ai pour toute question sur vos données. Les données de Smart Route sont sur votre ordinateur : vous les supprimez en supprimant le dossier de données du programme.")),
            sec("Responsable", p("Yolea, Abidjan.")),
        ]),
        "access": ("Déclaration d'accessibilité", "Déclaration d'accessibilité du site smartroute.yolea.ai.", [
            sec("Portée", p("Cette déclaration vise le site smartroute.yolea.ai, en français et en anglais.")),
            sec("Norme visée", p("WCAG 2.2, niveau AA. Le corps de texte vise le niveau AAA en thème Jour."), p("Statut : « partiellement conforme »."), p("Date de l'état des lieux : 4 novembre 2026.")),
            sec("Ce qui est contrôlé", ul("Audit automatique axe-core 4.14 sur chaque écran de l'application, en thème Jour et en thème Nuit, et sur les pages du site à 1280, 360 et 320 px : 0 violation.", "Parcours au clavier seul : le focus est visible, il passe au titre de chaque écran, F6 revient des volets web à l'application, Échap ferme les confirmations.", "Revue de l'arbre d'accessibilité : repères, noms et zones dynamiques.", "Reflow à 320 px sans défilement horizontal.", "Les règles automatiques du kit Sogoma (sogoma-check) : mots, jetons, durées de mouvement, parité français et anglais.", "Le schéma animé a une alternative en texte, et il reste fixe quand votre système demande de réduire les animations.", "Le site se lit sans JavaScript : seuls le choix du téléchargement et le schéma animé en dépendent.")),
            sec("Manques connus", ul("Pas encore fait : tests avec les lecteurs d'écran NVDA, JAWS et VoiceOver ; zoom du navigateur à 200 à 400 %.", "Les pages web affichées dans les volets (claude.ai, chatgpt.com, gemini.google.com) sont éditées par des tiers : leur accessibilité échappe à notre contrôle.", "Les logos des éditeurs d'outils sont montrés tels que fournis : leur contraste n'est pas le nôtre.")),
            sec("Contact", p("Un obstacle sur une page ? Écrivez à contact@yolea.ai. Éditeur : Yolea, Abidjan.")),
            sec("Date", p(f"Déclaration établie le {UPDATED['fr']}.")),
        ]),
    },
    "en": {
        "legal": ("Legal notice", "Legal notice of the smartroute.yolea.ai site.", [
            sec("Publisher", p("Yolea, Abidjan, Côte d'Ivoire."), p("Contact: contact@yolea.ai.")),
            sec("Publication director", p("Thierry Memel, founder of Yolea.")),
            sec("Hosting", p("The pages of this site are served by Cloudflare, Inc., United States. The files to download are published on GitHub (GitHub Releases, GitHub, Inc., United States).")),
            sec("Trademarks", p(TRADEMARK["en"])),
            sec("Your data", p("What we do with your data is described on the Privacy page.")),
        ]),
        "privacy": ("Privacy", "What this site and the Smart Route program do with your data.", [
            sec("On this site", p("No cookie, no tracker, no visit statistics, no advertising, no third-party script (the only request to a third party is the one described below). Your theme choice stays in your browser; it is sent nowhere."),
                p("The download section asks api.github.com for the latest published version (no cookie, no sign-in), and then automatically reads the SHA256SUMS file on github.com, when your browser allows it. These requests go from your browser to GitHub, which handles them under its own policy; we receive nothing from them. The files themselves are downloaded from GitHub."),
                p("Cloudflare, which serves the site, also keeps its own technical logs. We have not yet checked what they contain or how long they are kept.")),
            sec("In the Smart Route program", p("Smart Route runs on your computer. Your requests, your results, your history and your settings stay on your computer: Yolea does not receive them, and there is no Yolea account."),
                p("The program starts the tools installed on your machine (Claude Code, Codex, Antigravity), with your sign-ins. What you send to a tool is handled by its publisher, under your terms with them."),
                p("The web version is served by the program itself, at the 127.0.0.1 address of your computer: it cannot be reached from another device.")),
            sec("What we never do", p("We never sell your personal data and we show no advertising.")),
            sec("Who has access", p("For this site: Cloudflare, which serves the pages, and GitHub, which publishes the files. For the program: nobody at Yolea, since nothing is sent to us.")),
            sec("Your rights", p("You can write to contact@yolea.ai with any question about your data. Smart Route's data is on your computer: you delete it by deleting the program's data folder.")),
            sec("Controller", p("Yolea, Abidjan.")),
        ]),
        "access": ("Accessibility statement", "Accessibility statement of the smartroute.yolea.ai site.", [
            sec("Scope", p("This statement covers the smartroute.yolea.ai site, in French and in English.")),
            sec("Target standard", p("WCAG 2.2, level AA. Body text aims at level AAA in the Day theme."), p("Status: “partially conformant”."), p("Assessment date: 4 November 2026.")),
            sec("What is checked", ul("Automated axe-core 4.14 audit on every application screen, in Day and Night theme, and on the site pages at 1280, 360 and 320 px: 0 violations.", "Keyboard-only walk-through: focus is visible, it moves to each screen's title, F6 returns from the web panels to the application, Escape closes confirmations.", "Accessibility tree review: landmarks, names and live regions.", "Reflow at 320 px without horizontal scrolling.", "The automatic rules of the Sogoma kit (sogoma-check): words, tokens, motion durations, French and English parity.", "The animated diagram has a text alternative, and it stays still when your system asks to reduce animations.", "The site reads without JavaScript: only the choice of download and the animated diagram depend on it.")),
            sec("Known gaps", ul("Not done yet: tests with the NVDA, JAWS and VoiceOver screen readers; browser zoom at 200 to 400 %.", "The web pages shown in the panels (claude.ai, chatgpt.com, gemini.google.com) are run by third parties: their accessibility is outside our control.", "The logos of the tool publishers are shown as supplied: their contrast is not ours.")),
            sec("Contact", p("An obstacle on a page? Write to contact@yolea.ai. Publisher: Yolea, Abidjan.")),
            sec("Date", p(f"Statement drawn up on {UPDATED['en']}.")),
        ]),
    },
}

LICENCES = {
    "fr": ("Licences", "Ce que ce site doit aux autres, et sous quelles conditions.", [
        sec("Polices", p("Ce site charge deux polices, servies depuis son propre domaine : Inter et Newsreader. Chacune est publiée sous la licence SIL Open Font License 1.1, copiée ci-dessous."),
            licence_block("fr", "Inter"), licence_block("fr", "Newsreader")),
        deps_section("fr"),
        sec("Marques et logos", p(TRADEMARK["fr"]),
            p("Les logos d'Anthropic (Claude, Claude Code) viennent du dossier de presse d'Anthropic ; celui d'OpenAI (la fleur, pour ChatGPT et Codex) vient du pack officiel de logos d'OpenAI, utilisé tel que fourni selon ses conditions d'usage des marques ; ceux de Google (Gemini, Antigravity) viennent des pages de ces produits. Ils sont montrés tels que fournis, sans retouche, pour dire avec quels outils Smart Route fonctionne. Le logo de Smart Route est celui de Yolea.")),
    ]),
    "en": ("Licences", "What this site owes to others, and under which terms.", [
        sec("Fonts", p("This site loads two fonts, served from its own domain: Inter and Newsreader. Each is published under the SIL Open Font License 1.1, copied below."),
            licence_block("en", "Inter"), licence_block("en", "Newsreader")),
        deps_section("en"),
        sec("Trademarks and logos", p(TRADEMARK["en"]),
            p("The Anthropic logos (Claude, Claude Code) come from Anthropic's press kit; the OpenAI logo (the blossom, for ChatGPT and Codex) comes from OpenAI's official logo pack, used as provided under its marks usage terms; the Google logos (Gemini, Antigravity) come from those products' pages. They are shown as supplied, unaltered, to say which tools Smart Route works with. The Smart Route logo is Yolea's.")),
    ]),
}

L = {
    "fr": dict(
        lang="fr", skip="Aller au contenu", home_alt="Smart Route par Yolea, accueil", other_lang="EN", other_href="en", other_label="EN Read this page in English",
        theme=("Thème : Auto", "Thème : Jour", "Thème : Nuit"), back="Retour à l'accueil", foot="Pied de page", improve="Aidez-nous à améliorer cette page : contact@yolea.ai",
        nav=[("legal", "Mentions légales"), ("privacy", "Confidentialité"), ("access", "Déclaration d'accessibilité"), ("licences", "Licences")], legal="Smart Route, par Yolea, Abidjan.", updated="Dernière mise à jour"),
    "en": dict(
        lang="en", skip="Skip to content", home_alt="Smart Route by Yolea, home", other_lang="FR", other_href="fr", other_label="FR Lire cette page en français",
        theme=("Theme: Auto", "Theme: Day", "Theme: Night"), back="Back to the home page", foot="Footer", improve="Help us improve this page: contact@yolea.ai",
        nav=[("legal", "Legal notice"), ("privacy", "Privacy"), ("access", "Accessibility statement"), ("licences", "Licences")], legal="Smart Route, by Yolea, Abidjan.", updated="Last updated"),
}
EQUIV = {"legal": "legal", "privacy": "privacy", "access": "access", "licences": "licences"}


def render(lang: str, key: str, title: str, desc: str, sections: list[str]) -> str:
    c = L[lang]
    other = "en" if lang == "fr" else "fr"
    here = PATHS[lang][key]
    twin = PATHS[other][key]
    page_title = f"{title} · Smart Route"
    fr_href = here if lang == "fr" else twin
    en_href = here if lang == "en" else twin
    return f"""<!DOCTYPE html>
<html lang="{lang}" data-register="site">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(page_title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#0A3F3B">
<link rel="canonical" href="https://smartroute.yolea.ai{here}">
<link rel="alternate" hreflang="fr" href="https://smartroute.yolea.ai{fr_href}">
<link rel="alternate" hreflang="en" href="https://smartroute.yolea.ai{en_href}">
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-180.png">
<link rel="stylesheet" href="/kit/tokens/tokens.css">
<link rel="stylesheet" href="/kit/fonts/fallbacks.css">
<link rel="stylesheet" href="/kit/css/base.css">
<link rel="stylesheet" href="/kit/css/components.css">
<link rel="stylesheet" href="/site.css">
<script src="/kit/web/sg-theme.js"></script>
</head>
<body>
<a class="sg-skip" href="#contenu">{c["skip"]}</a>
{shell.header(lang, False, twin)}
<div class="sg-line"></div>
<main id="contenu"><div class="sr-local">
<p><a class="sg-link sr-back" href="{PATHS[lang]['home']}">{c["back"]}</a></p>
<h1>{html.escape(title)}</h1>
<div class="sr-col">
{chr(10).join(sections)}
</div></div></main>
{shell.footer(lang, fr_href, en_href, UPDATED[lang])}
</body>
</html>
"""


def write(rel: str, text: str) -> None:
    out = SITE / "public" / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print("wrote", out.relative_to(SITE))


for lang in ("fr", "en"):
    for key, (title, desc, sections) in PAGES[lang].items():
        write(PATHS[lang][key].strip("/") + "/index.html", render(lang, key, title, desc, sections))
    title, desc, sections = LICENCES[lang]
    write(PATHS[lang]["licences"].strip("/") + "/index.html", render(lang, "licences", title, desc, sections))
