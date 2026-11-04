"""S24: one clock and honest fiscal words (extension §3.4.13, §6.5 formats).

- A clock written « 18 h 05 » (digits, a plain or no-break space, h, a space, two digits) outside the `voice/` string tables:
  the screen clock is « 18:05 ». A duration is composed with U+202F (« 2 h 05 ») and is not matched.
- « DGI » outside fiscal screens, Receipts and the FNE connection screen (files or string keys named fiscal, receipt,
  recu, fne).
- « due » or « à payer » beside a VAT figure: the honest word is « collectée ».
Markdown: inline code spans and fenced blocks are quotations and are not judged; in `.fr-en.md` string tables only the FR
and EN cells are judged (the note column may quote the forbidden form).
"""
from __future__ import annotations

import json
import re

from sg_core import FileCtx, Finding, rule, under
from sg_extra import MARKUP_EXT, mask_markdown_code

_CLOCK = re.compile(r"(?<![\w:.,])\d{1,2}[  ]h[  ]\d{2}(?![\w:])")
_DGI = re.compile(r"(?<![\w])DGI(?![\w])")
_VAT_DUE = re.compile(r"\b(?:TVA|VAT)\b[^.;\n|]{0,40}?(?<![\w])(?:due|à payer|payable)(?![\w])|"
                      r"(?<![\w])(?:due|à payer)(?![\w])[^.;\n|]{0,20}?\b(?:TVA|VAT)\b", re.I)
FISCAL = re.compile(r"fiscal|receipt|recu|reçu|fne", re.I)
EXEMPT = ("docs/", "migration/", "rafiq/", "voice/")
CODE = MARKUP_EXT + (".js", ".ts", ".mjs", ".dart", ".json")


def _in_voice(rel: str) -> bool:
    return rel.startswith("voice/") or "/voice/" in rel


def _scope(rel: str) -> bool:
    if under(rel, *EXEMPT) or _in_voice(rel):
        return False
    return rel.endswith((".fr.md", ".en.md", ".fr-en.md")) or rel.endswith(CODE)


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


@rule("S24", scope=_scope)
def s24(ctx: FileCtx):
    rel = ctx.rel
    fiscal_file = bool(FISCAL.search(rel.rsplit("/", 1)[-1]))
    if rel.endswith(".fr-en.md"):
        masked = mask_markdown_code(ctx.text)
        for n, line in enumerate(masked.split("\n"), 1):
            if not line.startswith("|"):
                continue
            raw = _cells(ctx.text.split("\n")[n - 1])
            cells = _cells(line)
            if len(cells) < 3:
                continue
            key = raw[0].strip("`")
            judged = " | ".join(cells[1:3])
            # a row without a backticked dot.case key documents, it is not a UI string: only the clock is judged
            is_string = raw[0].startswith("`")
            yield from _judge(ctx, n, judged, fiscal_file or bool(FISCAL.search(key)), prose=not is_string)
        return
    if rel.endswith(".json"):
        yield from _json(ctx, fiscal_file)
        return
    text = mask_markdown_code(ctx.text) if rel.endswith(".md") else ctx.stripped
    for n, line in enumerate(text.split("\n"), 1):
        yield from _judge(ctx, n, line, fiscal_file, prose=rel.endswith(".md"))


PROSE_KEYS = {"note", "notes", "description", "comment", "why", "rule"}


def _json(ctx: FileCtx, fiscal: bool):
    """JSON: judge the string values, not the explanatory notes that quote the forbidden forms."""
    try:
        data = json.loads(ctx.text)
    except ValueError:
        return
    lines = ctx.text.split("\n")

    def walk(node, key, keypath):
        if isinstance(node, dict):
            for k, v in node.items():
                yield from walk(v, k, f"{keypath}.{k}")
        elif isinstance(node, list):
            for v in node:
                yield from walk(v, key, keypath)
        elif isinstance(node, str) and str(key).lower() not in PROSE_KEYS:
            n = next((i for i, l in enumerate(lines, 1) if json.dumps(node, ensure_ascii=False)[1:-1][:40] in l), 1)
            yield from _judge(ctx, n, node, fiscal or bool(FISCAL.search(keypath)))
    yield from walk(data, "", "")


def _judge(ctx: FileCtx, n: int, s: str, fiscal: bool, prose: bool = False):
    for m in _CLOCK.finditer(s):
        yield Finding("S24", "error", ctx.rel, n, f"clock « {m.group(0)} »: screens write 18:05; 18 h 05 lives only in voice/ tables")
    if not prose and not fiscal:
        for m in _DGI.finditer(s):
            yield Finding("S24", "error", ctx.rel, n, "« DGI » outside a fiscal screen, a Receipt or the FNE connection screen")
    for m in _VAT_DUE.finditer(s):
        yield Finding("S24", "error", ctx.rel, n, f"« {m.group(0).strip()} »: VAT shown by Sougou is « collectée », never due or to pay")
