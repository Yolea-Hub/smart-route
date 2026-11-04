"""S16: red is an incident. The `error` token or its hex only in incident and failure states, `alerte.*`, `status.incident`
and the watch register (R6)."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, is_code, rule, under

ERROR_HEX = ("#A33A2B", "#E59A8E")  # `error`, Day and Night
_USE_CSS = re.compile(r"var\(\s*--error\s*[,)]|" + "|".join(re.escape(h) for h in ERROR_HEX), re.I)
_USE_DART = re.compile(r"\b(?:SogomaColors|SogomaTokens|tokens)\.error\b(?!Soft)|0x[Ff]{2}(?:A33A2B|E59A8E)", re.I)
_ALLOWED_CTX = re.compile(r"data-state\s*=?\s*[\"']?(?:incident|failure)|incident|failure|alerte|status[.-]incident|"
                          r"data-register\s*=\s*[\"']?watch", re.I)
EXEMPT = ("kit/tokens/", "charte/", "docs/", "migration/", "kit/icons/templates/", "rafiq/")
_WATCH_FILE = re.compile(r"data-register\s*=\s*[\"']watch[\"']")


def _css_rules(text: str):
    """(selector, body, body start index) for every flat CSS rule (at-rule wrappers are walked through)."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        yield m.group(1), m.group(2), m.start(2)


@rule("S16", scope=lambda rel: (is_code(rel) or rel.endswith(".svg")) and not under(rel, *EXEMPT))
def s16(ctx: FileCtx):
    base = ctx.rel.rsplit("/", 1)[-1]
    if re.match(r"(?:\w+_)?tokens\.\w+$", base):  # token definition files (tokens.css, sogoma_tokens.dart)
        return
    t = ctx.stripped
    if _WATCH_FILE.search(t):
        return
    if ctx.rel.endswith(".dart"):
        for m in _USE_DART.finditer(t):
            ctx_line = t[t.rfind("\n", 0, m.start()) + 1:t.find("\n", m.end())]
            if not _ALLOWED_CTX.search(ctx_line):
                yield Finding("S16", "error", ctx.rel, ctx.line_of(m.start(), t), "the error colour outside an incident, a failure or alerte (R6)")
        return
    if ctx.rel.endswith(".css"):
        blocks = [(t, 0)]
    elif ctx.rel.endswith((".html", ".svelte", ".vue", ".svg")):
        blocks = [(m.group(1), m.start(1)) for m in re.finditer(r"<style\b[^>]*>(.*?)</style>", t, re.S | re.I)]
    else:  # script files: the line must name the incident / failure / alerte context
        for m in _USE_CSS.finditer(t):
            line = t[t.rfind("\n", 0, m.start()) + 1:t.find("\n", m.end()) if t.find("\n", m.end()) >= 0 else len(t)]
            if not _ALLOWED_CTX.search(line):
                yield Finding("S16", "error", ctx.rel, ctx.line_of(m.start(), t), "the error colour outside an incident, a failure or alerte (R6)")
        return
    for css, offset in blocks:
        for sel, body, start in _css_rules(css):
            for m in _USE_CSS.finditer(body):
                if not _ALLOWED_CTX.search(sel):
                    yield Finding("S16", "error", ctx.rel, ctx.line_of(offset + start + m.start(), t),
                                  f"the error colour in « {sel.strip()[-60:]} »: red only in incident, failure, alerte or watch (R6)")
    if ctx.rel.endswith(".css"):
        return
    # inline styles and attributes in markup: the element itself must carry the incident / failure context
    for m in re.finditer(r"<[a-zA-Z][^>]*>", t):
        tag = m.group(0)
        if _USE_CSS.search(tag) and not _ALLOWED_CTX.search(tag):
            yield Finding("S16", "error", ctx.rel, ctx.line_of(m.start(), t), "the error colour on an element outside incident / failure (R6)")
