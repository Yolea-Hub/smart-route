#!/usr/bin/env python3
"""Fills the « Pour chaque métier / For every role » and « Atlas » sections of the home pages in a built site (called by site/build.sh).
Reads site/recipes.json, the export of src/core/recipes.ts and src/core/atlas.ts (`pnpm export:recipes`), so the site shows the same
recipes as the application; rewrites what sits between <!--sr:roles:start--> and <!--sr:roles:end--> in dist/index.html (fr)
and dist/en/index.html (en). Logos are the official files already used by the page (OpenAI: Black on Day, White on Night).
Run: python3 -I site/scripts/render-roles.py <dist-dir>"""
import html
import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
NNBSP = "\u202f"
B = "/assets/brands"
# tool id -> (day file, night file or None, extra class)
LOGO = {
    "claude-code": (f"{B}/anthropic/ClaudeIcon-Rounded.svg", None),
    "cowork": (f"{B}/anthropic/ClaudeIcon-Rounded.svg", None),
    "codex": (f"{B}/openai/OAI_OpenAI-Blossom_Black.svg", f"{B}/openai/OAI_OpenAI-Blossom_White.svg"),
    "chatgpt-work": (f"{B}/openai/OAI_OpenAI-Blossom_Black.svg", f"{B}/openai/OAI_OpenAI-Blossom_White.svg"),
    "agy": (f"{B}/google/antigravity-logo-276.png", None),
    "gemini-tasks": (f"{B}/google/gemini-sparkle.svg", None),
}
T = {
    "fr": {
        "kicker": "Pour chaque métier", "title": "Une recette pour votre métier.",
        "lead": "Smart Route enchaîne les bons outils pour une tâche de votre métier, et vous montre le plan avant de lancer quoi que ce soit. Voici une recette par métier ; l'application en propose d'autres pour chacun.",
        "route": "Les outils de cette recette, dans l'ordre", "steps": "Étapes",
        "a_kicker": "Atlas", "a_title": "Ce que chaque outil sait bien faire.",
        "a_lead": "L'atlas de l'application décrit, en termes modestes, les points forts de chaque outil. Après chaque tâche, une ligne « Le saviez-vous ? » vous en fait découvrir un autre.",
    },
    "en": {
        "kicker": "For every role", "title": "A recipe for your job.",
        "lead": "Smart Route chains the right tools for a task from your job, and shows you the plan before it starts anything. Here is one recipe per job; the app has more for each.",
        "route": "The tools of this recipe, in order", "steps": "Steps",
        "a_kicker": "Atlas", "a_title": "What each tool is good at.",
        "a_lead": "The app's atlas describes, in modest terms, what each tool is good at. After each task, a “Did you know?” line shows you another one.",
    },
}


def fr_typo(t: str) -> str:
    t = re.sub(r"[ \u00a0\u202f]+([;:!?])", NNBSP + r"\1", t)
    t = re.sub(r"«[ \u00a0\u202f]+", "«" + NNBSP, t)
    t = re.sub(r"[ \u00a0\u202f]+»", NNBSP + "»", t)
    return t


def esc(s: str, lang: str) -> str:
    s = html.escape(str(s), quote=True)
    return fr_typo(s) if lang == "fr" else s


def logo(tool: str, size: int) -> str:
    day, night = LOGO[tool]
    img = lambda src, cls: f'<img class="sr-route-logo{cls}" src="{src}" alt="" width="{size}" height="{size}">'
    return img(day, " sr-day") + img(night, " sr-night") if night else img(day, "")


def route(steps: list, tools: dict, lang: str) -> str:
    names = [tools[s["tool"]][lang] for s in steps]
    items = []
    for i, s in enumerate(steps):
        if i:
            items.append('<li class="sr-route-link" aria-hidden="true"></li>')
        items.append(f'<li class="sr-route-node">{logo(s["tool"], 28)}<span class="sr-route-name">{esc(names[i], lang)}</span></li>')
    label = esc(T[lang]["route"].format(tools=", ".join(names)), lang)
    return f'<ol class="sr-route" aria-label="{label}">' + "".join(items) + "</ol>"


def render_page(data: dict, lang: str) -> str:
    t, tools = T[lang], data["tools"]
    cards = []
    for role in data["roles"]:
        recipe = next((r for r in data["recipes"] if r["role"] == role["id"]), None)
        if recipe is None:
            raise SystemExit(f"render-roles: no recipe for the role {role['id']!r}")
        cards.append(
            f'<li class="sr-role" id="role-{re.sub(r"[^a-z0-9-]", "", role["id"])}">'
            f'<h3>{esc(role["name"][lang], lang)}</h3><p class="sr-role-hint">{esc(role["hint"][lang], lang)}</p>'
            f'<p class="sr-role-recipe">{esc(recipe["title"][lang], lang)}</p>{route(recipe["steps"], tools, lang)}</li>')
    roles = (
        f'<section class="sr-section" id="roles" aria-labelledby="roles-title"><div class="sr-grid"><div class="sr-col">'
        f'<p class="sr-kicker">{esc(t["kicker"], lang)}</p><h2 id="roles-title">{esc(t["title"], lang)}</h2><p>{esc(t["lead"], lang)}</p></div>'
        f'<div class="sr-wide"><ul class="sr-roles">{"".join(cards)}</ul></div></div></section>')
    atlas = []
    for e in data["atlas"]:
        atlas.append(
            f'<li class="sr-atlas-item">{logo(e["tool"], 28)}<div><h3>{esc(tools[e["tool"]][lang], lang)}</h3>'
            f'<p>{esc(e["strengths"][0][lang], lang)}</p></div></li>')
    teaser = (
        f'<section class="sr-section" id="atlas" aria-labelledby="atlas-title"><div class="sr-grid"><div class="sr-col">'
        f'<p class="sr-kicker">{esc(t["a_kicker"], lang)}</p><h2 id="atlas-title">{esc(t["a_title"], lang)}</h2><p>{esc(t["a_lead"], lang)}</p></div>'
        f'<div class="sr-wide"><ul class="sr-atlas">{"".join(atlas)}</ul></div></div></section>')
    return roles + "\n" + teaser


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    dist = Path(sys.argv[1]).resolve()
    data = json.loads((SITE / "recipes.json").read_text(encoding="utf-8"))
    for rel, lang in (("index.html", "fr"), ("en/index.html", "en")):
        page = dist / rel
        src = page.read_text(encoding="utf-8")
        pat = re.compile(r"(<!--sr:roles:start-->).*?(<!--sr:roles:end-->)", re.S)
        if not pat.search(src):
            raise SystemExit(f"render-roles: markers missing in {page}")
        body = render_page(data, lang)
        page.write_text(pat.sub(lambda m: m.group(1) + body + m.group(2), src, count=1), encoding="utf-8")
    print(f"render-roles ok: {len(data['roles'])} roles, {len(data['atlas'])} tools")


if __name__ == "__main__":
    main()
