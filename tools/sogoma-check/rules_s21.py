"""S21: forbidden icon identifiers (spinner, sparkle, bell, star…), each replaced by a doctrine object (extension §4.5)."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule, under

FORBIDDEN = ("sparkle", "sparkles", "magic", "wand", "ai", "robot", "bot", "spinner", "loader", "badge", "star", "heart",
             "favorite", "flame", "fire", "trophy", "medal", "megaphone", "campaign", "timer", "hourglass", "countdown",
             "confetti", "rocket", "bell")
_ALT = "|".join(sorted(FORBIDDEN, key=len, reverse=True))
_ID = r"(?:" + _ALT + r")(?:-off)?"
_PASCAL = "|".join(sorted({w.capitalize() for w in FORBIDDEN}, key=len, reverse=True))
_REFS = re.compile(
    r"(?<![\w-])(?:sg-icon-|lucide-|#sg-icon-)(" + _ID + r")(?![\w-])"
    r"|(?<![\w])SogomaIcons\.(" + _ID.replace("-", "") + r")(?![\w])"
    r"|(?<![\w-])(?:data-icon|icon|name)\s*=\s*[\"'](" + _ID + r")[\"']"
    r"|\"id\"\s*:\s*\"(" + _ID + r")\""
    r"|import\s*\{[^}]*\b(" + _PASCAL + r")(?:Icon)?\b[^}]*\}\s*from\s*['\"]lucide")
_FILE = re.compile(r"(?:^|/)kit/icons/src/[^/]+/(" + _ID + r")\.svg$")
EXEMPT = ("docs/", "charte/", "migration/")


def _scope(rel: str) -> bool:
    return not under(rel, *EXEMPT) and rel.endswith((".html", ".svelte", ".vue", ".jsx", ".tsx", ".js", ".ts", ".mjs",
                                                     ".dart", ".css", ".svg", ".json"))


@rule("S21", scope=_scope)
def s21(ctx: FileCtx):
    m = _FILE.search(ctx.rel)
    if m:
        yield Finding("S21", "error", ctx.rel, 1, f"forbidden icon id « {m.group(1)} »")
    t = ctx.stripped
    for m in _REFS.finditer(t):
        name = next(g for g in m.groups() if g)
        yield Finding("S21", "error", ctx.rel, ctx.line_of(m.start(), t),
                      f"forbidden icon id « {name} »: the Edge replaces the spinner, Rafiq's face the sparkle, `pin` the star, `notice` the bell")
