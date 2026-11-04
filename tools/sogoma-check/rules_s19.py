"""S19: four series, then a table (R3). A literal series array longer than 4, or `maxSeries` above 4, in chart code."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule, under

MAX = 4
_SERIES = re.compile(r"(?<![\w-])(?:series|data-series)\s*[:=]\s*['\"]?\[")
_MAXSERIES = re.compile(r"(?<![\w-])(?:maxSeries|max_series|max-series|data-max-series)\s*[:=]\s*['\"]?(\d+)")
_CHART_HINT = re.compile(r"sg-chart|sg-bar|sg-line|BarChart|LineChart|chart", re.I)


def _top_level_items(text: str, start: int) -> int:
    """Count the top-level items of the array whose `[` is at `start` (strings and nested brackets respected)."""
    depth, items, has, quote, i = 0, 0, False, None, start
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote, has = c, True
        elif c in "[{(":
            depth += 1
            if depth > 1:
                has = True
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return items + (1 if has else 0)
        elif c == "," and depth == 1:
            items += 1 if has else 0
            has = False
        elif not c.isspace() and depth >= 1:
            has = True
        i += 1
    return items


def _scope(rel: str) -> bool:
    return rel.endswith((".js", ".ts", ".mjs", ".jsx", ".tsx", ".svelte", ".vue", ".html", ".dart", ".json")) and \
        not under(rel, "docs/", "charte/", "migration/", "kit/tokens/")


@rule("S19", scope=_scope)
def s19(ctx: FileCtx):
    t = ctx.stripped
    if not (under(ctx.rel, "kit/charts/") or _CHART_HINT.search(t)):
        return
    for m in _SERIES.finditer(t):
        n = _top_level_items(t, m.end() - 1)
        if n > MAX:
            yield Finding("S19", "error", ctx.rel, ctx.line_of(m.start(), t), f"{n} series in one chart: four at most, then a table (R3)")
    for m in _MAXSERIES.finditer(t):
        if int(m.group(1)) > MAX:
            yield Finding("S19", "error", ctx.rel, ctx.line_of(m.start(), t), f"maxSeries {m.group(1)}: four at most (R3)")
