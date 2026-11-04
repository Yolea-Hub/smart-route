"""Rules S01 to S10 of sogoma-check (foundation). S11 to S24 are added by phase B in their own rules_*.py files."""
from __future__ import annotations

import json
import re
from typing import Iterator

from sg_core import CODE_EXT, FileCtx, Finding, RepoCtx, glob_any, is_code, rule, under

# ---- shared scopes ---------------------------------------------------------------------------------------------------

# Verbatim or governed elsewhere: raw colours are legitimate there (planner decision of 30 Oct 2026).
COLOUR_ALLOW_PREFIXES = ("kit/og/", "kit/charts/", "kit/app-icons/", "kit/illustrations/", "kit/icons/templates/",
                         "kit/tokens/", "charte/", "docs/", "migration/", "kit/mail/", "kit/marks/fil.svg")
DAWN_HEX = ("#F0A437", "#F4B557")  # the `dawn` token, Day and Night
DAWN_FILE_WORDS = ("sky", "fil", "logo", "rafiq")


def in_rafiq(rel: str) -> bool:
    return rel.startswith("rafiq/") or "/rafiq/" in rel


def line_findings(ctx: FileCtx, text: str, regex: re.Pattern, rid: str, sev: str, message: str) -> Iterator[Finding]:
    for m in regex.finditer(text):
        yield Finding(rid, sev, ctx.rel, ctx.line_of(m.start(), text), message % {"hit": m.group(0)[:60].strip()})


# ---- S01 Dawn hex outside the sky / fil / logo / rafiq files ----------------------------------------------------------------

_DAWN = re.compile("|".join(re.escape(h) for h in DAWN_HEX), re.I)


@rule("S01", scope=lambda rel: is_code(rel) and not under(rel, *COLOUR_ALLOW_PREFIXES))
def s01(ctx: FileCtx):
    base = ctx.rel.rsplit("/", 1)[-1].lower()
    if any(w in base for w in DAWN_FILE_WORDS):
        return
    yield from line_findings(ctx, ctx.stripped, _DAWN, "S01", "error",
                             "Dawn hex %(hit)s outside the sky, fil, logo and rafiq files: use var(--dawn) in the Sky disc only")


# ---- S02 infinite animation outside rafiq/ ------------------------------------------------------------------------------------

# `.repeat(` loops only in an animation context: Flutter's controller.repeat() and its named arguments, or a repeat(-1) timeline.
# JavaScript's "a".repeat(32) is a string with a count, not an animation.
_INFINITE = re.compile(r"animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b|repeatCount\s*=\s*[\"']indefinite[\"']|"
                       r"\.repeat\s*\(\s*(?:\)|-1\b|reverse\s*:|period\s*:|min\s*:|max\s*:)|iterations\s*:\s*Infinity|iteration-count\s*:\s*infinite", re.I)


@rule("S02", scope=lambda rel: (is_code(rel) or rel.endswith(".svg")) and not in_rafiq(rel))
def s02(ctx: FileCtx):
    yield from line_findings(ctx, ctx.stripped, _INFINITE, "S02", "error", "infinite animation (%(hit)s): nothing loops outside rafiq/")


# ---- S03 badge with digits -------------------------------------------------------------------------------------------------------

_BADGE_MARKUP = re.compile(r"<[a-zA-Z][^>]*\b(?:class|className)\s*=\s*[\"'{`][^>]*badge[^>]*>\s*(?:<[^>]+>\s*)*\d", re.I)
_BADGE_DART = re.compile(r"\bBadge\s*\([^;]{0,120}?\d")
_BADGE_CSS = re.compile(r"badge[^{}]*\{[^}]*content\s*:\s*[\"']?\d", re.I)


@rule("S03", scope=is_code)
def s03(ctx: FileCtx):
    for rx in (_BADGE_MARKUP, _BADGE_DART, _BADGE_CSS):
        yield from line_findings(ctx, ctx.stripped, rx, "S03", "error", "badge with digits (%(hit)s): a badge never counts")


# ---- S04 countdown / infinite scroll ---------------------------------------------------------------------------------------------

_COUNTDOWN = re.compile(r"count-?down|infinite[-_ ]?scroll|InfiniteScroll|setInterval\s*\([^)]*(?:remaining|timeLeft|secondsLeft)", re.I)


@rule("S04", scope=is_code)
def s04(ctx: FileCtx):
    yield from line_findings(ctx, ctx.stripped, _COUNTDOWN, "S04", "error", "countdown or infinite scroll (%(hit)s): forbidden")


# ---- S05 more than one primary action per file ---------------------------------------------------------------------------------------

_PRIMARY_ATTR = re.compile(r"(?<=\s)data-primary(?=[\s=>/])")
_PRIMARY_DART = re.compile(r"\bPrimaryButton\s*\(")


@rule("S05", scope=lambda rel: rel.endswith((".html", ".svelte", ".vue", ".jsx", ".tsx", ".dart")))
def s05(ctx: FileCtx):
    rx = _PRIMARY_DART if ctx.rel.endswith(".dart") else _PRIMARY_ATTR
    hits = list(rx.finditer(ctx.stripped))
    if len(hits) > 1:
        yield Finding("S05", "error", ctx.rel, ctx.line_of(hits[1].start(), ctx.stripped),
                      f"{len(hits)} primary actions in one file: one per screen")


# ---- S06 forbidden words ----------------------------------------------------------------------------------------------------------------

FORBIDDEN_FR = ["urgent", "simplement", "juste", "facile", "vite", "dépêchez-vous", "dernière chance", "offre limitée", "ne manquez pas"]
FORBIDDEN_EN = ["urgent", "simply", "just", "easy", "hurry", "last chance", "limited offer", "don't miss"]
_FORBIDDEN = re.compile(r"(?<!\w)(" + "|".join(re.escape(w) for w in sorted(set(FORBIDDEN_FR + FORBIDDEN_EN), key=len, reverse=True)) + r")(?!\w)", re.I)
KEY_EXEMPT = re.compile(r"^alerte\.|(^|\.)morning\.nothing_urgent$")


def _forbidden_in(text: str) -> list[str]:
    return [m.group(1) for m in _FORBIDDEN.finditer(text.replace("’", "'"))]


def _html_strings(text: str) -> Iterator[tuple[int, str]]:
    body = re.sub(r"<!--.*?-->", _blank_keep, text, flags=re.S)
    body = re.sub(r"<(script|style)\b.*?</\1>", _blank_keep, body, flags=re.S | re.I)
    for m in re.finditer(r"(?:\b(?:alt|title|aria-label|placeholder|content)\s*=\s*\"([^\"]*)\")|>([^<>]+)<", body):
        s = m.group(1) or m.group(2) or ""
        if s.strip():
            yield body.count("\n", 0, m.start()) + 1, s


def _blank_keep(m: re.Match) -> str:
    return re.sub(r"[^\n]", " ", m.group(0))


def _json_strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _json_strings(v, f"{path}.{k}" if path else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _json_strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def _s06_scope(rel: str) -> bool:
    if rel.endswith(".fr-en.md") and "CHAINES" in rel:
        return True
    if rel.endswith(".json"):
        return rel.endswith(".fr-en.json")
    return rel.endswith(CODE_EXT) and not rel.endswith(".css")


@rule("S06", scope=_s06_scope)
def s06(ctx: FileCtx):
    rel = ctx.rel
    if rel.endswith(".md"):
        for n, line in enumerate(ctx.text.splitlines(), 1):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not line.startswith("|") or len(cells) < 3:
                continue
            key = cells[0].strip("`")
            if KEY_EXEMPT.search(key):
                continue
            for w in _forbidden_in(" ".join(cells[1:3])):
                yield Finding("S06", "error", rel, n, f"forbidden word « {w} » in string {key}")
        return
    if rel.endswith(".json"):
        try:
            data = json.loads(ctx.text)
        except ValueError:
            return
        for path, s in _json_strings(data):
            if KEY_EXEMPT.search(path):
                continue
            for w in _forbidden_in(s):
                yield Finding("S06", "error", rel, 1, f"forbidden word « {w} » in {path}")
        return
    if rel.endswith(".html"):
        for n, s in _html_strings(ctx.text):
            for w in _forbidden_in(s):
                yield Finding("S06", "error", rel, n, f"forbidden word « {w} » in the page text")
        return
    for m in re.finditer(r"'([^'\n]{4,})'|\"([^\"\n]{4,})\"", ctx.stripped):
        s = m.group(1) or m.group(2)
        if " " not in s:
            continue
        for w in _forbidden_in(s):
            yield Finding("S06", "error", rel, ctx.line_of(m.start(), ctx.stripped), f"forbidden word « {w} » in a string")


# ---- S07 FR / EN parity ---------------------------------------------------------------------------------------------------------------------

S07_DIRS = ("charte/", "kit/", "docs/", "docs-site/", "guide/")
S07_ALLOW = ["JOURNAL.md", "baseline-*", "CHECKSUMS.sha256", "SOURCES.md", "RFN.md", "DEMANDES.md", "CREDITS.md", "RETRAITS.md",
             "COPIES.md", "DEVIATIONS.md", "*.fr-en.md", "docs/BLUEPRINT-2026-10-30.md", "kit/flutter/yolea_sogoma/README.md", "tests/fixtures/*",
             # recorded deviation: the deletion record is one file, French then English (plan 4.1)
             "charte/SUPPRIME-v2-v3.md"]
_ANCHOR = re.compile(r"\{#([^}\s]+)\}")


def _anchors(text: str) -> list[str]:
    return _ANCHOR.findall(text)


@rule("S07", kind="repo")
def s07(repo: RepoCtx):
    md = [f for f in repo.files if f.endswith(".md")]
    fr = {f[:-6] for f in md if f.endswith(".fr.md")}
    en = {f[:-6] for f in md if f.endswith(".en.md")}
    for stem in sorted(fr | en):
        if stem not in en:
            yield Finding("S07", "error", stem + ".fr.md", 1, "no English twin " + stem.rsplit("/", 1)[-1] + ".en.md")
        elif stem not in fr:
            yield Finding("S07", "error", stem + ".en.md", 1, "no French twin " + stem.rsplit("/", 1)[-1] + ".fr.md")
        else:
            a, b = _anchors(repo.read(stem + ".fr.md")), _anchors(repo.read(stem + ".en.md"))
            if a != b:
                only_fr = [x for x in a if x not in b]
                only_en = [x for x in b if x not in a]
                why = f"only in FR {only_fr}, only in EN {only_en}" if (only_fr or only_en) else "same anchors in a different order"
                yield Finding("S07", "error", stem + ".fr.md", 1, "ordered {#anchor} lists differ: " + why)
    for f in md:
        if f.endswith((".fr.md", ".en.md")) or not under(f, *S07_DIRS) or glob_any(f, S07_ALLOW):
            continue
        yield Finding("S07", "error", f, 1, "Markdown page without a language suffix and not on the allow-list: .fr.md + .en.md or .fr-en.md")
    for f in md:
        if "CHAINES" in f and f.endswith(".fr-en.md"):
            for n, line in enumerate(repo.read(f).splitlines(), 1):
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if line.startswith("|") and len(cells) >= 3 and cells[0].startswith("`"):
                    if not cells[1] or not cells[2]:
                        yield Finding("S07", "error", f, n, f"string {cells[0]} has an empty FR or EN cell")


# ---- S08 raw hex outside the token files (warning) ----------------------------------------------------------------------------------------------

_HEX = re.compile(r"(?<![\w&])#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b(?!-)")


@rule("S08", severity="warn", scope=lambda rel: is_code(rel) and not under(rel, *COLOUR_ALLOW_PREFIXES))
def s08(ctx: FileCtx):
    for m in _HEX.finditer(ctx.stripped):
        txt = ctx.stripped
        # skip CSS id selectors and anchors: a hex colour sits after ':' ',' '(' or a quote
        before = txt[max(0, m.start() - 2):m.start()].rstrip()
        if before[-1:] not in (":", ",", "(", '"', "'", "="):
            continue
        yield Finding("S08", "warn", ctx.rel, ctx.line_of(m.start(), txt), f"raw hex {m.group(0)}: use var(--token)")


# ---- S09 French composition (autofix on Markdown and string tables, check-only on code) -----------------------------------------------------------

NN = " "
_PROTECT = re.compile(r"```.*?```|`[^`\n]*`|https?://\S+|\]\([^)\n]*\)|\{#[^}\n]*\}|<[^>\n]+>", re.S)
_TABLE_RULE = re.compile(r"^\s*\|[\s:|\-]+\|\s*$")


def _fr_prose(s: str, clock: bool = True) -> str:
    """Apply the French composition rules to one prose string (protected spans are skipped).
    The clock is written 18:05 (CHAINES, S24), never « 18 h 05 », except in voice/ (spoken text): clock=False there.
    Only two-digit hours are rewritten: « 2 h 05 » is a duration and stays."""
    holes: list[str] = []

    def keep(m: re.Match) -> str:
        holes.append(m.group(0))
        return f"\x00{len(holes) - 1}\x00"

    t = _PROTECT.sub(keep, s)
    t = re.sub(r"«[  ]+", "«" + NN, t)
    t = re.sub(r"(?<=[^\s\x00])[  ]+(?=»)", NN, t)
    t = re.sub(r"(?<=[^\s|])[  ]+(?=[;:!?])(?!::)", NN, t)
    # thousands grouping: a run of 3-digit groups separated by spaces, or 5 to 9 plain digits
    t = re.sub(r"(?<![\w.,/#+\-:\x00])(\d{1,3})((?:[   ]\d{3})+)(?![\w.,]?\d)",
               lambda m: m.group(1) + re.sub(r"[  ]", NN, m.group(2)), t)

    def group(m: re.Match) -> str:
        d = m.group(1)
        parts = []
        while len(d) > 3:
            parts.insert(0, d[-3:])
            d = d[:-3]
        return NN.join([d] + parts)

    t = re.sub(r"(?<![\w.,/#+\-:\x00])([1-9]\d{4,8})(?![\w\-]|[.,]\d)", group, t)
    if clock:
        t = re.sub(r"(?<![\w:.\-\x00])([01]\d|2[0-3])(?:[ \u00a0\u202f]?h[ \u00a0\u202f]?)([0-5]\d)(?![\w:])", lambda m: f"{m.group(1)}:{m.group(2)}", t)
        # what is left with one digit is a duration: « 2 h 05 » with U+202F on both sides of « h »
        t = re.sub(r"(?<![\w:.,\x00])(\d)[ \u00a0]h[ \u00a0]([0-5]\d)(?![\w:])", lambda m: f"{m.group(1)}{NN}h{NN}{m.group(2)}", t)
    # U+202F before a unit (formats table): percent, F CFA, the technical units
    t = re.sub(r"(?<=\d)[ \u00a0](?=(?:%|F[ \u00a0]CFA|°C|kW|Mo|Go|Ko|ko|km|min)(?![\w]))", NN, t)
    return re.sub(r"\x00(\d+)\x00", lambda m: holes[int(m.group(1))], t)


def s09_fix(text: str, rel: str) -> str:
    clock = "voice/" not in rel
    if rel.endswith(".fr.md"):
        out, fence = [], False
        for line in text.split("\n"):
            if line.lstrip().startswith("```"):
                fence = not fence
                out.append(line)
            elif fence or _TABLE_RULE.match(line):
                out.append(line)
            else:
                out.append(_fr_prose(line, clock))
        return "\n".join(out)
    if rel.endswith(".fr-en.md"):
        out, fr_col = [], None
        for line in text.split("\n"):
            if line.startswith("|") and not _TABLE_RULE.match(line):
                cells = line.strip().strip("|").split("|")
                heads = [c.strip().upper() for c in cells]
                if "FR" in heads and "EN" in heads:
                    fr_col = heads.index("FR")
                elif fr_col is not None and fr_col < len(cells):
                    cells[fr_col] = " " + _fr_prose(cells[fr_col].strip(), clock) + " "
                    line = "|" + "|".join(cells) + "|"
            out.append(line)
        return "\n".join(out)
    return text


def _s09_scope(rel: str) -> bool:
    return rel.endswith((".fr.md", ".fr-en.md")) or rel.endswith(".html")


# Promoted to "error" by step B1 after `sogoma-check --fix` ran over the tree (Markdown and string tables only).
@rule("S09", severity="error", scope=_s09_scope, fix=s09_fix)
def s09(ctx: FileCtx):
    if ctx.rel.endswith(".md"):
        fixed = s09_fix(ctx.text, ctx.rel)
        if fixed != ctx.text:
            for n, (a, b) in enumerate(zip(ctx.text.split("\n"), fixed.split("\n")), 1):
                if a != b:
                    yield Finding("S09", "error", ctx.rel, n, "French composition (narrow no-break space, grouping, clock written 18:05): run sogoma-check --fix")
        return
    # HTML: check-only, text nodes of French pages
    if 'lang="fr"' not in ctx.text:
        return
    for n, s in _html_strings(ctx.text):
        # A regular space or a no-break space (U+00A0) after « is wrong; U+202F is right and is also `\s`, so `\s` must not be used here.
        if re.search(r"(?<=\S) (?=[;:!?»])|«[ \u00a0]", s) and not re.search(r"https?:", s):
            yield Finding("S09", "error", ctx.rel, n, "regular space before ; : ! ? » or after «: type U+202F by hand (--fix does not rewrite HTML)")


# ---- S10 a Palaver always carries its Rafiq label ------------------------------------------------------------------------------------------------------

_PALAVER = re.compile(r"class\s*=\s*\"[^\"]*(?<![\w-])(?:sg-)?palaver(?![\w-])[^\"]*\"|<Palaver\b|<sg-palaver\b|\bPalaver\s*\(")


RAFIQ_OPENER = "Ici Rafiq, l'assistant de Yolea"


def _first_contact(rel: str) -> bool:
    """Extension §2.3: the first-contact surfaces carry the disclosure even without a Palaver."""
    base = rel.rsplit("/", 1)[-1]
    return (rel.startswith("kit/whatsapp/") and "accueil" in base and base.endswith(".txt")) or \
        (rel.startswith("kit/mail/") and "/" not in rel[len("kit/mail/"):] and base.endswith(".html"))


@rule("S10", scope=lambda rel: is_code(rel) or _first_contact(rel))
def s10(ctx: FileCtx):
    if _first_contact(ctx.rel):
        if RAFIQ_OPENER not in ctx.text.replace("’", "'") and "Rafiq · IA · " not in ctx.text:
            yield Finding("S10", "error", ctx.rel, 1,
                          "first-contact template without « Ici Rafiq, l'assistant de Yolea » or the « Rafiq · IA · » label")
        return
    m = _PALAVER.search(ctx.stripped)
    if m and "Rafiq · IA · " not in ctx.text:
        yield Finding("S10", "error", ctx.rel, ctx.line_of(m.start(), ctx.stripped),
                      "a Palaver without the literal « Rafiq · IA · <role> » label")
