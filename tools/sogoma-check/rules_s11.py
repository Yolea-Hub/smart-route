"""S11: docs front-matter complete, footer with the four fixed items, English machine values (extension §2.2, §2.3)."""
from __future__ import annotations

import json
import re

from sg_core import FileCtx, Finding, rule, under
from sg_extra import MARKUP_EXT, TOKENS_SOURCE, front_matter

DOCS_DIRS = ("docs-site/",)
REQUIRED = ("title_fr", "title_en", "status", "updated", "owner", "tabs", "platforms", "tokens", "spec")
STATUS = ("available", "in-progress", "todo", "beta", "deprecated")
LABEL_KEYS = ("title_fr", "title_en", "owner")  # labels may carry any language
# accent-stripped French words that must not be machine values (French is the label, English the value)
FRENCH_MACHINE = {"matin", "atelier", "veille", "maison", "disponible", "en-cours", "a-faire", "retire", "sans-objet",
                  "demande", "vide", "echec", "hors-ligne", "attente", "erreur", "jour", "nuit", "contraste", "succes",
                  "reussi", "annule", "termine", "brouillon", "valide", "refuse", "telephone", "ordinateur", "tablette",
                  "apercu", "conception", "developper", "accessibilite", "vue-d-ensemble"}
# the four fixed footer items, FR or EN page (the version and date are written by the build)
FOOTER = (
    (("Aidez-nous à améliorer", "Help us improve"), "the « Aidez-nous à améliorer » link"),
    (("Précédent", "Previous"), "Précédent / Suivant"),
    (("Déclaration d'accessibilité", "Accessibility statement"), "the « Déclaration d'accessibilité » link"),
    (("Yolea, Abidjan.",), "the legal sentence « Yolea, Abidjan. »"),
)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATA_ATTR = re.compile(r"\bdata-[a-z][a-z0-9-]*\s*=\s*\"([^\"]*)\"")
# The theme button keeps its three visible labels in data-auto, data-day and data-night: labels, not machine values. Only there.
_THEME_LABELS = re.compile(r"(?<=<button )[^>]*\bclass=\"sg-theme\"[^>]*(?=>)")


def _token_names(root) -> set[str]:
    p = root / TOKENS_SOURCE
    names: set[str] = set()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return names

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                q = f"{path}.{k}" if path else k
                names.add(q)
                walk(v, q)
    walk(data, "")
    # the colour tokens are also named by their CSS name (« oasis », « ink-muted »)
    for theme in ("day", "night", "contrast"):
        names.update(data.get("color", {}).get(theme, {}).keys())
    return names


def _bad_machine_value(v: str) -> bool:
    if not isinstance(v, str) or not v:
        return False
    if any(ord(c) > 127 for c in v):
        return True
    return v.strip().lower() in FRENCH_MACHINE


def _s11_scope(rel: str) -> bool:
    return (under(rel, *DOCS_DIRS) and rel.endswith((".md", ".html"))) or rel.endswith(MARKUP_EXT)


@rule("S11", scope=_s11_scope)
def s11(ctx: FileCtx):
    rel = ctx.rel
    if rel.endswith(MARKUP_EXT):
        # Blanked at the same length, so that the line numbers of the other findings stay right.
        text = _THEME_LABELS.sub(lambda t: re.sub(r"\bdata-(auto|day|night)=\"[^\"]*\"", lambda a: " " * len(a.group(0)), t.group(0)), ctx.stripped)
        for m in _DATA_ATTR.finditer(text):
            if _bad_machine_value(m.group(1)):
                yield Finding("S11", "error", rel, ctx.line_of(m.start(), ctx.stripped),
                              f"data-* value « {m.group(1)} » is French or non-ASCII: the machine value is English, French is the label")
        if under(rel, *DOCS_DIRS) and rel.endswith(".html"):
            for needles, what in FOOTER:
                if not any(n in ctx.text for n in needles):
                    yield Finding("S11", "error", rel, 1, f"docs page footer without {what}")
        return
    if not rel.endswith(".md"):
        return
    fm = front_matter(ctx.text)
    if fm is None:
        yield Finding("S11", "error", rel, 1, "docs page without a front-matter block (--- … ---)")
        return
    for k in REQUIRED:
        if k not in fm.data:
            yield Finding("S11", "error", rel, 1, f"front-matter key `{k}` missing")
    st = fm.data.get("status")
    if "status" in fm.data and st not in STATUS:
        yield Finding("S11", "error", rel, fm.lines.get("status", 1), f"status « {st} » not in {'|'.join(STATUS)}")
    up = fm.data.get("updated")
    if "updated" in fm.data and not (isinstance(up, str) and _DATE.match(up)):
        yield Finding("S11", "error", rel, fm.lines.get("updated", 1), f"updated « {up} » is not an ISO date")
    toks = fm.data.get("tokens")
    if isinstance(toks, list) and toks:
        known = _token_names(ctx.root)
        for t in toks:
            if isinstance(t, str) and t and t not in known:
                yield Finding("S11", "error", rel, fm.lines.get("tokens", 1), f"token `{t}` does not exist in {TOKENS_SOURCE}")
    for k, v in fm.data.items():
        if k in LABEL_KEYS:
            continue
        for x in (v if isinstance(v, list) else [v]):
            if _bad_machine_value(x):
                yield Finding("S11", "error", rel, fm.lines.get(k, 1),
                              f"front-matter `{k}` value « {x} » is French or non-ASCII: machine values are English")
