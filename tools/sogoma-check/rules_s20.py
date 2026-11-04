"""S20: the invented legal form, the brand followed by « SA », is refused anywhere in the tree or in a built site.

The literal is assembled at run time so that this file does not carry it. Allow-list (planner, 30 Oct 2026): the two
blueprints, which record the finding, and migration/COPIES.md, whose rows quote the v3 `legal.json` (chosen: allow-list
the file rather than rewrite a quotation). migration/v3-reference/** is outside the discovery already.
"""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, glob_any, rule

FORBIDDEN = "Yolea" + " " + "SA"
_RX = re.compile(r"(?<![\w])" + re.escape(FORBIDDEN) + r"(?![\w])")
ALLOW = ["docs/BLUEPRINT-*", "migration/v3-reference/*", "migration/COPIES.md"]
EXT = (".md", ".html", ".htm", ".json", ".txt", ".js", ".mjs", ".ts", ".css", ".svg", ".dart", ".py", ".sh", ".yml",
       ".yaml", ".xml", ".svelte", ".vue", ".jsx", ".tsx", ".toml", ".jsonc", ".webmanifest", ".csv")


@rule("S20", scope=lambda rel: rel.endswith(EXT) and not any(glob_any(rel, [p]) or rel.startswith(p.rstrip("*")) for p in ALLOW))
def s20(ctx: FileCtx):
    for m in _RX.finditer(ctx.text):
        yield Finding("S20", "error", ctx.rel, ctx.line_of(m.start()),
                      "invented legal form after the brand: the legal sentence is « Yolea, Abidjan. » until the new RCCM and registered form (legal.sentence in CHAINES)")
