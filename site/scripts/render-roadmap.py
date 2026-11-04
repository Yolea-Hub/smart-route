#!/usr/bin/env python3
"""Fills the dynamic blocks of the Support pages in a built site (called by site/build.sh, on site/dist).
Reads site/roadmap.json and SUPPORTERS.md; rewrites what sits between <!--sr:NAME:start--> and <!--sr:NAME:end-->
in dist/soutenir/index.html (fr) and dist/en/support/index.html (en). Blocks: chariow, sponsors, board, supporters.
Run: python3 -I site/scripts/render-roadmap.py <dist-dir>"""
import html
import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
ROOT = SITE.parent
NNBSP = " "
STATUS = {  # roadmap status -> (fr, en)
    "idée": ("Idée", "Idea"),
    "à financer": ("À financer", "To fund"),
    "financée": ("Financée", "Funded"),
    "en cours": ("En cours", "In progress"),
    "livrée": ("Livrée", "Delivered"),
}
T = {
    "fr": {
        "chariow": "Soutenir avec Chariow", "sponsors": "Soutenir avec GitHub Sponsors", "soon": "Bientôt disponible",
        "issue": "Voir le ticket et donner votre avis", "none": "Aucun nom pour l'instant. Le vôtre peut figurer ici si vous le souhaitez.",
        "empty": "Aucune fonction n'est proposée pour l'instant.", "dir": "/soutenir/",
    },
    "en": {
        "chariow": "Support with Chariow", "sponsors": "Support with GitHub Sponsors", "soon": "Coming soon",
        "issue": "See the issue and give your view", "none": "No names yet. Yours can appear here if you wish.",
        "empty": "No feature is proposed for now.", "dir": "/en/support/",
    },
}


def fr_typo(t: str) -> str:
    t = re.sub(r"[  ]+([;:!?])", NNBSP + r"\1", t)
    t = re.sub(r"«[  ]+", "«" + NNBSP, t)
    t = re.sub(r"[  ]+»", NNBSP + "»", t)
    return t


def esc(s: str, lang: str) -> str:
    s = html.escape(str(s), quote=True)
    return fr_typo(s) if lang == "fr" else s


def https_url(u: str, prefix: str = "https://") -> str:
    u = str(u or "").strip()
    return u if u.startswith(prefix) and not re.search(r"[\s\"'<>]", u) else ""


def button(label: str, url: str, lang: str) -> str:
    return f'<a class="sg-button" href="{html.escape(url, quote=True)}" rel="noopener">{esc(label, lang)}</a>'


def block_chariow(d, lang):
    url = https_url(d.get("chariowUrl", ""))
    return f"<p>{button(T[lang]['chariow'], url, lang)}</p>" if url else f'<p class="sr-soon">{esc(T[lang]["soon"], lang)}</p>'


def block_sponsors(d, lang):
    url = https_url(d.get("sponsorsUrl", ""), "https://github.com/sponsors/")
    if d.get("sponsorsEnabled") is True and url:
        return f"<p>{button(T[lang]['sponsors'], url, lang)}</p>"
    return f'<p class="sr-soon">{esc(T[lang]["soon"], lang)}</p>'


def block_board(d, lang):
    out = []
    for it in d.get("items", []):
        st = STATUS.get(it.get("status"))
        if not st:
            raise SystemExit(f"render-roadmap: unknown status {it.get('status')!r} in item {it.get('id')!r}")
        title, why, goal = (it.get(f"{k}_{lang}", "") for k in ("title", "why", "goal_label"))
        if not (title and why):
            raise SystemExit(f"render-roadmap: item {it.get('id')!r} lacks title/why in '{lang}'")
        issue = https_url(it.get("issue", ""), "https://github.com/Yolea-Hub/")
        a = f'<p><a class="sg-link" href="{html.escape(issue, quote=True)}" rel="noopener">{esc(T[lang]["issue"], lang)}</a></p>' if issue else ""
        iid = re.sub(r"[^a-z0-9-]", "", str(it.get("id", "")).lower())
        out.append(
            f'<article class="sr-os" id="fund-{iid}"><div class="sr-os-head"><h3>{esc(title, lang)}</h3><span class="sr-os-tag">{esc(st[0 if lang == "fr" else 1], lang)}</span></div>'
            f'<p>{esc(why, lang)}</p>' + (f'<p class="sr-note">{esc(goal, lang)}</p>' if goal else "") + a + "</article>")
    return '<div class="sr-os-grid">' + "".join(out) + "</div>" if out else f"<p>{esc(T[lang]['empty'], lang)}</p>"


def block_supporters(d, lang):
    txt = (ROOT / "SUPPORTERS.md").read_text(encoding="utf-8")
    m = re.search(r"<!-- supporters:start -->(.*?)<!-- supporters:end -->", txt, re.S)
    names = [l[2:].strip() for l in (m.group(1) if m else "").splitlines() if l.startswith("- ") and l[2:].strip()]
    if not names:
        return f"<p>{esc(T[lang]['none'], lang)}</p>"
    return '<ul class="sr-plain sr-plain--marked">' + "".join(f"<li>{esc(n, lang)}</li>" for n in names) + "</ul>"


BLOCKS = {"chariow": block_chariow, "sponsors": block_sponsors, "board": block_board, "supporters": block_supporters}


def render(page: Path, lang: str, data: dict) -> None:
    src = page.read_text(encoding="utf-8")
    for name, fn in BLOCKS.items():
        pat = re.compile(rf"(<!--sr:{name}:start-->).*?(<!--sr:{name}:end-->)", re.S)
        if not pat.search(src):
            raise SystemExit(f"render-roadmap: block '{name}' missing in {page}")
        body = fn(data, lang)
        src = pat.sub(lambda m: m.group(1) + body + m.group(2), src, count=1)
    page.write_text(src, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    dist = Path(sys.argv[1]).resolve()
    data = json.loads((SITE / "roadmap.json").read_text(encoding="utf-8"))
    for rel, lang in (("soutenir/index.html", "fr"), ("en/support/index.html", "en")):
        render(dist / rel, lang, data)
    print(f"render-roadmap ok: {len(data.get('items', []))} items")


if __name__ == "__main__":
    main()
