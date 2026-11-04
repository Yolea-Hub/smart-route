"""S13: no Figure, chart or table on the Morning register or on a home route listed in YOLEA.md (R2)."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule
from sg_extra import MARKUP_EXT, yolea_lines

_FIGURES = re.compile(r"<(?:sg-figure|sg-amount|sg-chart|sg-bar|sg-line|sg-table|sg-watch-tile|table)\b"
                      r"|(?<![\w.])(?:Figure|AmountCard|BarChart|LineChart|DataTable|SogomaTable|WatchTile)\s*\(")
_MORNING = re.compile(r"data-register\s*=\s*[\"']morning[\"']")
CODE = MARKUP_EXT + (".dart", ".js", ".ts")


@rule("S13", scope=lambda rel: rel.endswith(CODE))
def s13(ctx: FileCtx):
    t = ctx.stripped
    why = None
    if _MORNING.search(t):
        why = 'data-register="morning"'
    else:
        base = ctx.rel.rsplit("/", 1)[-1]
        routes = yolea_lines(ctx.root).home_routes
        if ctx.rel in routes and not base.startswith("index."):
            why = "a home route listed under home_routes: in YOLEA.md"
    if not why:
        return
    for m in _FIGURES.finditer(t):
        yield Finding("S13", "error", ctx.rel, ctx.line_of(m.start(), t),
                      f"{m.group(0).strip('(').strip()} on {why}: no dashboard on the home (R2)")
