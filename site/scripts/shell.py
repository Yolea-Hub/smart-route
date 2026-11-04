"""The product shell of the Smart Route site, as on yolea.ai (docs/IDENTITE-PRODUIT.fr.md): the Sky and the footer, FR and EN.
Used by gen-legal.py (legal pages) and apply-shell.py (every other page). One place, so that all pages carry the same shell."""
import html

YOLEA_URL = {"fr": "https://yolea.ai/", "en": "https://yolea.ai/en/"}
SUPPORT = {"fr": "/soutenir/", "en": "/en/support/"}
LEGAL = {
    "fr": [("/mentions-legales/", "Mentions légales"), ("/confidentialite/", "Confidentialité"), ("/accessibilite/", "Déclaration d'accessibilité"), ("/licences/", "Licences")],
    "en": [("/en/legal-notice/", "Legal notice"), ("/en/privacy/", "Privacy"), ("/en/accessibility/", "Accessibility statement"), ("/en/licences/", "Licences")],
}
HOME = {"fr": "/", "en": "/en/"}
T = {
    "fr": dict(
        by="par Yolea", yolea_alt="Yolea, site yolea.ai", product_alt="Smart Route, accueil", menu="Menu", nav_label="Navigation principale",
        nav=[("#how", "Comment ça marche"), ("#download", "Télécharger"), ("#web", "Version web"), ("#about", "À propos"), ("#faq", "Questions")],
        other="EN", other_lang="en", other_label="EN Read this page in English", theme=("Thème : Auto", "Thème : Jour", "Thème : Nuit"),
        foot="Pied de page", langs="Langues", line="Yolea, depuis Abidjan.", support="Soutenir Smart Route", improve="Aidez-nous à améliorer cette page : contact@yolea.ai",
        legal="Yolea, Abidjan.", updated="Dernière mise à jour"),
    "en": dict(
        by="by Yolea", yolea_alt="Yolea, yolea.ai website", product_alt="Smart Route, home", menu="Menu", nav_label="Main navigation",
        nav=[("#how", "How it works"), ("#download", "Download"), ("#web", "Web version"), ("#about", "About"), ("#faq", "Questions")],
        other="FR", other_lang="fr", other_label="FR Lire cette page en français", theme=("Theme: Auto", "Theme: Day", "Theme: Night"),
        foot="Footer", langs="Languages", line="Yolea, from Abidjan.", support="Support Smart Route", improve="Help us improve this page: contact@yolea.ai",
        legal="Yolea, Abidjan.", updated="Last updated"),
}


def _theme(c: dict) -> str:
    a, d, n = c["theme"]
    return f'<button type="button" class="sg-theme" hidden data-auto="{a}" data-day="{d}" data-night="{n}">{a}</button>'


def header(lang: str, home: bool, twin: str) -> str:
    c = T[lang]
    nav = "".join(f'<li><a href="{h}">{html.escape(l)}</a></li>' for h, l in c["nav"]) if home else ""
    links = f'<nav class="sr-links" aria-label="{c["nav_label"]}"><ul>{nav}</ul></nav>\n' if home else ""
    menu = (f'<details class="sr-menu"><summary>{c["menu"]}</summary><nav aria-label="{c["menu"]}"><ul>{nav}</ul>{_theme(c)}</nav></details>\n') if home else ""
    cls = "sg-sky sr-sky sr-sky--home" if home else "sg-sky sr-sky"
    return f"""<header class="{cls}">
<a class="sr-logo" href="{YOLEA_URL[lang]}"><img src="/kit/logos/yolea-lockup-on-sky.svg" alt="{c["yolea_alt"]}" width="100" height="28"></a>
<span class="sr-divider" aria-hidden="true"></span>
<a class="sr-product" href="{HOME[lang]}"><img class="sr-mark" src="/assets/brand/smart-route-mark-reversed.svg" alt="" width="28" height="28"><span class="sr-product-text"><span class="sr-product-name">Smart Route</span><span class="sr-by">{c["by"]}</span></span></a>
{links}<a class="sr-lang" href="{twin}" hreflang="{c["other_lang"]}" lang="{c["other_lang"]}" aria-label="{c["other_label"]}">{c["other"]}</a>
{_theme(c)}
{menu}</header>"""


def footer(lang: str, fr_href: str, en_href: str, updated: str | None = None) -> str:
    c = T[lang]
    links = [(SUPPORT[lang], c["support"])] + LEGAL[lang]
    li = "".join(f'<li><a class="sg-link" href="{h}">{html.escape(l)}</a></li>' for h, l in links)
    langs = "".join(
        f'<li><span aria-current="true">{n}</span></li>' if code == lang else f'<li><a class="sg-link" lang="{code}" hreflang="{code}" href="{h}">{n}</a></li>'
        for code, n, h in (("fr", "Français", fr_href), ("en", "English", en_href))
    )
    upd = f'<p>{c["updated"]}{" :" if lang == "fr" else ":"} {updated}</p>\n' if updated else ""
    return f"""<footer class="sr-footer"><div class="sr-grid"><div class="sr-wide">
<div class="sr-foot-top"><img class="sr-foot-logo sr-day" src="/kit/logos/yolea-lockup.svg" alt="Yolea" height="36"><img class="sr-foot-logo sr-night" src="/kit/logos/yolea-lockup-reversed.svg" alt="Yolea" height="36"><p class="sr-footer-line">{c["line"]}</p></div>
<div class="sr-footer-nav"><nav aria-label="{c["foot"]}"><ul class="sr-footlinks">{li}</ul></nav>
<nav aria-label="{c["langs"]}"><ul class="sr-footlinks">{langs}</ul></nav></div>
<p><a class="sg-link" href="mailto:contact@yolea.ai?subject=/">{c["improve"]}</a></p>
{upd}<p class="sr-legal">{c["legal"]}</p>
</div></div></footer>"""
