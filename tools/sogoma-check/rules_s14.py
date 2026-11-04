"""S14: an icon is `aria-hidden="true"` and sits beside a visible word in the same parent; Dart `SogomaIcon` takes a non-empty `word:`, never `size: 16`."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule
from sg_extra import MARKUP_EXT, html_tree

_ICON_CALL = re.compile(r"(?<![\w.])SogomaIcon\s*\(")
_JSX_ICON = re.compile(r"<(?:svg|span|i)\b[^>]*(?:className|class)\s*=\s*[\"'{`][^>]*\bsg-icon\b[^>]*>", re.S)


def _is_icon(node) -> bool:
    cls = node.attrs.get("class", "").split()
    if "sg-icon" in cls:
        return True
    if node.tag == "svg":
        for d in node.iter():
            if d.tag == "use" and "#sg-icon-" in d.attrs.get("href", "") + d.attrs.get("xlink:href", ""):
                return True
    return False


def _visible_word(node, icon) -> bool:
    for c in node.children:
        if c is icon:
            continue
        if isinstance(c, str):
            if re.search(r"\w", c):
                return True
        elif c.attrs.get("aria-hidden") != "true" and c.tag not in ("svg", "script", "style") and "sg-icon" not in c.attrs.get("class", "").split():
            if re.search(r"\w", c.text()):
                return True
    return False


def _call_args(text: str, start: int) -> str:
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return text[start + 1:]


@rule("S14", scope=lambda rel: rel.endswith(MARKUP_EXT + (".dart",)))
def s14(ctx: FileCtx):
    t = ctx.stripped
    if ctx.rel.endswith(".dart"):
        for m in _ICON_CALL.finditer(t):
            args = _call_args(t, m.end() - 1)
            if "this." in args:  # the constructor declaration itself (`required this.word`)
                continue
            if not re.search(r"(?<![\w])word\s*:", args):
                yield Finding("S14", "error", ctx.rel, ctx.line_of(m.start(), t), "SogomaIcon( without word: an icon never speaks alone; add word: 'Reçu'")
            elif re.search(r"(?<![\w])word\s*:\s*(?:''|\"\"|r''|r\"\")", args):
                yield Finding("S14", "error", ctx.rel, ctx.line_of(m.start(), t), "SogomaIcon( with an empty word: an icon never speaks alone; write the word the icon sits beside")
            if re.search(r"(?<![\w])size\s*:\s*16(?:\.0+)?\b", args):
                yield Finding("S14", "error", ctx.rel, ctx.line_of(m.start(), t), "SogomaIcon( with size: 16: the drawing does not hold at 16; use 24 (default) or 20")
        return
    if ctx.rel.endswith((".jsx", ".tsx")):
        for m in _JSX_ICON.finditer(t):
            if not re.search(r"aria-hidden\s*=\s*[\"'{]?true", m.group(0)):
                yield Finding("S14", "error", ctx.rel, ctx.line_of(m.start(), t), 'icon without aria-hidden="true"')
        return
    root = html_tree(t)
    seen = set()
    for node in root.iter():
        if node is root or not _is_icon(node) or id(node) in seen:
            continue
        for d in node.iter():
            seen.add(id(d))
        if node.attrs.get("aria-hidden") != "true":
            yield Finding("S14", "error", ctx.rel, node.line, 'icon without aria-hidden="true"')
        parent = node.parent
        if parent is None or not _visible_word(parent, node):
            yield Finding("S14", "error", ctx.rel, node.line, "icon without a visible word in the same parent: an icon never speaks alone")
