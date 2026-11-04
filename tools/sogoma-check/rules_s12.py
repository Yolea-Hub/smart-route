"""S12: every Figure carries `source_ref` and `computed_at`; one figure, one source and one value across routes (R1, R8)."""
from __future__ import annotations

import re

from sg_core import Finding, RepoCtx, rule, strip_comments
from sg_extra import MARKUP_EXT

ELEMENTS = ("sg-figure", "sg-amount", "sg-watch-tile", "sg-chart")
WIDGETS = ("Figure", "AmountCard", "WatchTile")
_SRC = r"(?:source_ref|source-ref|sourceRef|data-source-ref)"
_AT = r"(?:computed_at|computed-at|computedAt|data-computed-at)"
_EL = re.compile(r"<(" + "|".join(ELEMENTS) + r")\b([^>]*)>", re.S)
_WIDGET = re.compile(r"(?<![\w.])(?:const\s+|new\s+)?(" + "|".join(WIDGETS) + r")\s*\(")
_ATTR = re.compile(r"([\w:-]+)\s*=\s*(\"[^\"]*\"|'[^']*'|\{[^}]*\})")
CODE = MARKUP_EXT + (".js", ".ts", ".mjs", ".dart")


def _call_args(text: str, start: int) -> str:
    """The text between the parenthesis at `start` and its match."""
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return text[start + 1:]


def _clause_one(rel: str, t: str):
    def line_of(i: int) -> int:
        return t.count("\n", 0, i) + 1
    for m in _EL.finditer(t):
        attrs = m.group(2)
        missing = [n for n, rx in (("source_ref", _SRC), ("computed_at", _AT)) if not re.search(r"(?<![\w-])" + rx + r"\s*=", attrs)]
        if missing:
            yield Finding("S12", "error", rel, line_of(m.start()),
                          f"<{m.group(1)}> without {' and '.join(missing)}: a figure is a sentence with its source (R1)")
    if rel.endswith((".dart", ".jsx", ".tsx")):
        for m in _WIDGET.finditer(t):
            args = _call_args(t, m.end() - 1)
            missing = [n for n, rx in (("sourceRef", _SRC), ("computedAt", _AT)) if not re.search(r"(?<![\w-])" + rx + r"\s*[:=]", args)]
            if missing:
                yield Finding("S12", "error", rel, line_of(m.start()),
                              f"{m.group(1)}( without {' and '.join(missing)} (R1)")


@rule("S12", kind="repo")
def s12(repo: RepoCtx):
    """Clause 1 on every code file; clause 2: a named figure (`name` or `data-figure`) shown on two routes of one
    product (the first path segment) carries the same `source_ref` and the same `value` everywhere."""
    seen: dict[tuple[str, str], tuple[str, int, str, str]] = {}
    for rel in repo.files:
        if not rel.endswith(CODE):
            continue
        text = strip_comments(repo.read(rel), rel)
        yield from _clause_one(rel, text)
        if not rel.endswith(MARKUP_EXT):
            continue
        for m in _EL.finditer(text):
            if m.group(1) not in ("sg-figure", "sg-amount"):
                continue
            attrs = {k: v.strip("\"'{}") for k, v in _ATTR.findall(m.group(2))}
            name = attrs.get("name") or attrs.get("data-figure")
            if not name:
                continue
            src = next((attrs[k] for k in ("source_ref", "source-ref", "data-source-ref") if k in attrs), "")
            val = attrs.get("value", attrs.get("data-value", ""))
            product = rel.split("/", 1)[0]
            line = text.count("\n", 0, m.start()) + 1
            key = (product, name)
            if key in seen:
                prel, pline, psrc, pval = seen[key]
                if prel != rel and (psrc != src or pval != val):
                    yield Finding("S12", "error", rel, line,
                                  f"figure « {name} » differs from {prel}:{pline} (source_ref or value): one source per figure (R8)")
            else:
                seen[key] = (rel, line, src, val)
