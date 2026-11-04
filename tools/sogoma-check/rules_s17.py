"""S17: motion durations only 120, 200, 320, 800 ms (0 and 1 ms are « off » under reduced motion); the only curves are
`ease-held` and the leave curve; rafiq/ is exempt (its blink and float are the blueprint's)."""
from __future__ import annotations

import re

from sg_core import FileCtx, Finding, rule, under

ALLOWED_MS = {0, 1, 120, 200, 320, 800}
DURATION_VARS = {"--duration-micro", "--duration-state", "--duration-sheet", "--duration-sun"}
CURVE_VARS = {"--ease-held", "--ease-leave"}
CURVES = {(0.0, 0.5, 0.25, 0.78), (0.4, 0.0, 1.0, 1.0)}
KEYWORDS = {"ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end"}
EXEMPT = ("rafiq/", "kit/tokens/", "docs/", "charte/", "migration/")
_DECL = re.compile(r"(?<![\w-])(transition|animation)(-duration|-timing-function|-delay)?\s*:\s*([^;}\"]+)", re.I)
_TIME = re.compile(r"(?<![\w.-])(\d*\.?\d+)(ms|s)\b")
_BEZIER = re.compile(r"cubic-bezier\(([^)]*)\)")
_VAR = re.compile(r"var\(\s*(--[\w-]+)")


def _ms(num: str, unit: str) -> float:
    v = float(num)
    return v * 1000 if unit == "s" else v


def _scan(value: str, part: str | None):
    """Yield problems for one declaration value."""
    v = value.strip()
    if part in (None, "-duration"):
        for m in _TIME.finditer(_BEZIER.sub("", v)):
            ms = _ms(m.group(1), m.group(2))
            if ms not in ALLOWED_MS:
                yield f"duration {m.group(0)} outside 120 / 200 / 320 / 800 ms"
                if part is None:
                    break  # the delay of a shorthand is not judged after the first time
    for name in _VAR.findall(v):
        if name.startswith("--duration") and name not in DURATION_VARS:
            yield f"duration token {name} is not a Sogoma motion token"
        if name.startswith("--ease") and name not in CURVE_VARS:
            yield f"curve token {name} is not ease-held or the leave curve"
    if part in (None, "-timing-function"):
        for m in _BEZIER.finditer(v):
            try:
                pts = tuple(round(float(x), 2) for x in m.group(1).split(","))
            except ValueError:
                pts = ()
            if pts not in CURVES:
                yield f"curve {m.group(0)} is not ease-held or the leave curve"
        words = re.findall(r"(?<![\w-])(ease(?:-in(?:-out)?|-out)?|linear|step-start|step-end|steps\()", _VAR.sub("", v))
        for w in words:
            yield f"timing function « {w.rstrip('(')} »: use var(--ease-held) or var(--ease-leave)"


@rule("S17", scope=lambda rel: rel.endswith((".css", ".html", ".svelte", ".vue", ".jsx", ".tsx", ".js")) and not under(rel, *EXEMPT))
def s17(ctx: FileCtx):
    t = ctx.stripped
    for m in _DECL.finditer(t):
        part = (m.group(2) or "").lower() or None
        if part == "-delay":
            continue
        for problem in _scan(m.group(3), part):
            yield Finding("S17", "error", ctx.rel, ctx.line_of(m.start(), t), problem)
