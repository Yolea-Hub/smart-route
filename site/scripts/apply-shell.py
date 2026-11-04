#!/usr/bin/env python3
"""Puts the product shell (Sky + footer, scripts/shell.py) on every page of site/public, idempotent. Run after writing or adding a page:
  python3 -I site/scripts/apply-shell.py && python3 -I site/scripts/fr-typo.py
Language, home or not, and the twin page come from the page itself (<html lang>, the hreflang alternates, the sr-sky--home class).
The legal pages are written by gen-legal.py with the same functions."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shell  # noqa: E402

PUB = Path(__file__).resolve().parent.parent / "public"


def alt(src: str, code: str) -> str | None:
    m = re.search(r'<link rel="alternate" hreflang="%s" href="https://smartroute\.yolea\.ai([^"]*)"' % code, src)
    return m.group(1) if m else None


for f in sorted(PUB.rglob("*.html")):
    src = f.read_text(encoding="utf-8")
    if "<header" not in src or "sr-sky" not in src:
        continue
    lang = "en" if re.search(r'<html lang="en"', src[:200]) else "fr"
    home = "sr-sky--home" in src
    rel = "/" + f.relative_to(PUB).as_posix().removesuffix("index.html")
    fr_href = alt(src, "fr") or (rel if lang == "fr" else "/")
    en_href = alt(src, "en") or (rel if lang == "en" else "/en/")
    twin = en_href if lang == "fr" else fr_href
    new = re.sub(r"<header\b.*?</header>", lambda m: shell.header(lang, home, twin), src, count=1, flags=re.S)
    updated = None
    m = re.search(r"<p>(?:Dernière mise à jour|Last updated)[^<:]*[  ]?:\s*([^<]*)</p>", re.search(r"<footer\b.*?</footer>", new, re.S).group(0) if "<footer" in new else "")
    if m:
        updated = m.group(1).strip()
    if "<footer" in new:
        new = re.sub(r"<footer\b.*?</footer>", lambda mm: shell.footer(lang, fr_href, en_href, updated), new, count=1, flags=re.S)
    else:
        new = new.replace("</body>", shell.footer(lang, fr_href, en_href, updated) + "\n</body>", 1)
    if new != src:
        f.write_text(new, encoding="utf-8")
        print("shell", f.relative_to(PUB))
