"""S22: drawings and photographs stay off the working surfaces (extension §5.3, §5.5).

Errors: a scene, spot or photograph (`sc-NN`, `sp-NN`, `ph-NN`) referenced from a Read-back or Receipt template, from a
table or a form of the workshop register, or in an e-mail before its first line of text; a page that carries both the
Line (`fil`) and the Sun mark (`mark-sun`: one sun per surface).
"""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule, under
from sg_extra import MARKUP_EXT

_IMG = re.compile(r"(?<![\w-])(sc|sp|ph)-\d{2}(?:-[a-z0-9-]+)?(?![\w])")
_TEMPLATE = re.compile(r"<sg-read-?back\b|<sg-receipt\b|class\s*=\s*[\"'][^\"']*\bsg-(?:read-?back|receipt)\b|"
                       r"(?<![\w.])(?:ReadBack|Receipt)\s*\(", re.I)
_WORKSHOP = re.compile(r"data-register\s*=\s*[\"']workshop[\"']")
_FIL = re.compile(r"(?<![\w-])(?:fil\.svg|sg-fil|#fil\b|id\s*=\s*[\"']fil[\"'])")
_SUN = re.compile(r"(?<![\w-])mark-sun(?![\w-])")
CODE = MARKUP_EXT + (".dart", ".js")


def _is_template(rel: str, text: str) -> bool:
    base = rel.rsplit("/", 1)[-1].lower()
    return bool(re.search(r"read-?back|receipt|recu|lecture", base)) or bool(_TEMPLATE.search(text))


@rule("S22", scope=lambda rel: rel.endswith(CODE) and not under(rel, "docs/", "charte/", "migration/", "kit/illustrations/", "kit/photos/"))
def s22(ctx: FileCtx):
    t = ctx.stripped
    rel = ctx.rel
    if _is_template(rel, t):
        for m in _IMG.finditer(t):
            yield Finding("S22", "error", rel, ctx.line_of(m.start(), t), f"image {m.group(0)} in a Read-back or Receipt template")
    elif _WORKSHOP.search(t):
        for blk in re.finditer(r"<(table|form)\b.*?</\1>", t, re.S | re.I):
            for m in _IMG.finditer(blk.group(0)):
                yield Finding("S22", "error", rel, ctx.line_of(blk.start() + m.start(), t),
                              f"image {m.group(0)} inside a workshop {blk.group(1)}")
    if under(rel, "kit/mail/") and rel.endswith(".html"):
        body = re.search(r"<body\b[^>]*>", t, re.I)
        start = body.end() if body else 0
        first_text = None
        for m in re.finditer(r">([^<>]*\w[^<>]*)<", t[start:]):
            first_text = start + m.start()
            break
        if first_text is not None:
            for m in _IMG.finditer(t, start, first_text):
                yield Finding("S22", "error", rel, ctx.line_of(m.start(), t), f"image {m.group(0)} above the e-mail's first line of text")
    f, s = _FIL.search(t), _SUN.search(t)
    if f and s:
        yield Finding("S22", "error", rel, ctx.line_of(s.start(), t), "the Line (fil) and the Sun mark on one page: one sun per surface")
