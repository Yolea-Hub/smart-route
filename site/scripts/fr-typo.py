#!/usr/bin/env python3
"""French typography for the HTML of site/public (S09): U+202F (narrow no-break space) before ; : ! ? and inside « ».
Touches only text nodes and the alt/title/aria-label/content attributes of French pages; idempotent.
Run: python3 -I site/scripts/fr-typo.py"""
import re
from pathlib import Path

NNBSP = " "
PUB = Path(__file__).resolve().parent.parent / "public"


def fix(t: str) -> str:
    t = re.sub(r"[  ]+([;:!?])", NNBSP + r"\1", t)
    t = re.sub(r"«[  ]+", "«" + NNBSP, t)
    t = re.sub(r"[  ]+»", NNBSP + "»", t)
    return t


def fix_html(src: str) -> str:
    out, pos = [], 0
    # skip <script>, <style>, <pre> and comments untouched
    for m in re.finditer(r"<(script|style|pre)\b.*?</\1>|<!--.*?-->", src, re.S):
        out.append(process(src[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(process(src[pos:]))
    return "".join(out)


def process(chunk: str) -> str:
    def tag(m):
        return re.sub(r'((?:alt|title|aria-label|content|data-auto|data-day|data-night)=")([^"]*)(")', lambda a: a.group(1) + fix(a.group(2)) + a.group(3), m.group(0))
    chunk = re.sub(r"<[^>]+>", tag, chunk)
    return re.sub(r"(>)([^<]+)", lambda m: m.group(1) + fix(m.group(2)), chunk)


def main() -> None:
    for f in PUB.rglob("*.html"):
        rel = f.relative_to(PUB).as_posix()
        if rel.startswith("en/"):
            continue
        src = f.read_text(encoding="utf-8")
        new = fix_html(src) if 'lang="fr"' in src[:200] else src
        if new != src:
            f.write_text(new, encoding="utf-8")
            print("fixed", rel)


if __name__ == "__main__":
    main()
