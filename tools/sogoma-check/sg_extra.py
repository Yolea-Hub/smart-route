"""Helpers shared by the rules S11 to S24 (front-matter, YOLEA.md machine lines, Markdown masking, a light HTML tree).

Not a rules_*.py file: sogoma_check.py does not load it as a rule module; the rule modules import it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

MARKUP_EXT = (".html", ".svelte", ".vue", ".jsx", ".tsx")
TOKENS_SOURCE = "kit/tokens/tokens.source.json"


# ---- Markdown -------------------------------------------------------------------------------------------------------------------

_FENCE = re.compile(r"^(\s*)(```|~~~)")


def mask_markdown_code(text: str) -> str:
    """Blank fenced blocks and inline code spans (line numbers and offsets preserved)."""
    out, fence = [], False
    for line in text.split("\n"):
        if _FENCE.match(line):
            fence = not fence
            out.append(" " * len(line))
        elif fence:
            out.append(" " * len(line))
        else:
            out.append(re.sub(r"`[^`\n]*`", lambda m: " " * len(m.group(0)), line))
    return "\n".join(out)


def lines_outside_fences(text: str):
    """(line number, line) for every line that is not inside a fenced code block."""
    fence = False
    for n, line in enumerate(text.split("\n"), 1):
        if _FENCE.match(line):
            fence = not fence
            continue
        if not fence:
            yield n, line


# ---- Front-matter ---------------------------------------------------------------------------------------------------------------


@dataclass
class FrontMatter:
    data: dict
    lines: dict  # key -> line number
    end_line: int


def _scalar(v: str):
    v = v.strip()
    if v in ("null", "~", ""):
        return None if v != "" else ""
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [_scalar(x) for x in inner.split(",")] if inner else []
    return v


def front_matter(text: str) -> FrontMatter | None:
    """A minimal reader of the `---` front-matter used by the docs pages: `key: value`, `key: [a, b]` and `- item` lists."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    data: dict = {}
    where: dict = {}
    key = None
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            return FrontMatter(data, where, i + 1)
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if m and not line.startswith((" ", "\t")):
            key = m.group(1)
            where[key] = i + 1
            data[key] = _scalar(m.group(2)) if m.group(2).strip() else []
            continue
        m = re.match(r"^\s+-\s*(.*)$", line)
        if m and key is not None:
            if not isinstance(data.get(key), list):
                data[key] = []
            data[key].append(_scalar(m.group(1)))
    return None  # unterminated


# ---- YOLEA.md machine lines ----------------------------------------------------------------------------------------------------

_ISO = r"\d{4}-\d{2}-\d{2}"


@dataclass
class YoleaLines:
    home_routes: list[str] = field(default_factory=list)
    icons_cap: int | None = None
    icon_pending: list[str] = field(default_factory=list)
    errors: list[tuple[int, str]] = field(default_factory=list)  # (line, message): a malformed machine line


def yolea_lines(root: Path) -> YoleaLines:
    """Read the three machine lines of the repository's YOLEA.md, ignoring fenced examples; a malformed line is recorded."""
    out = YoleaLines()
    p = root / "YOLEA.md"
    if not p.is_file():
        return out
    text = p.read_text(encoding="utf-8", errors="replace")
    for n, line in lines_outside_fences(text):
        m = re.match(r"^home_routes:\s*(.+)$", line)
        if m:
            out.home_routes += [x.strip() for x in m.group(1).split(",") if x.strip()]
            continue
        m = re.match(r"^icons_cap:\s*(\d+)\s+" + _ISO + r"\s+\S", line)
        if m:
            out.icons_cap = int(m.group(1))
            continue
        if line.startswith("icons_cap:"):
            out.errors.append((n, "malformed icons_cap: line, expected: icons_cap: 14 2026-10-30 « raison »"))
            continue
        m = re.match(r"^icon_pending:\s*([a-z][a-z0-9-]*)\s+" + _ISO + r"\s+\S", line)
        if m:
            out.icon_pending.append(m.group(1))
            continue
        if line.startswith("icon_pending:"):
            out.errors.append((n, "malformed icon_pending: line, expected: icon_pending: receipt-off 2026-10-30 « Reçu annulé »"))
            continue
        if re.match(r"^home_routes:\s*$", line):
            out.errors.append((n, "empty home_routes: line, expected: home_routes: src/routes/+page.svelte, lib/home/home_screen.dart"))
    return out


# ---- A light HTML tree ---------------------------------------------------------------------------------------------------------

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "use", "path",
        "circle", "line", "rect", "polyline", "polygon", "ellipse"}


@dataclass
class Node:
    tag: str
    attrs: dict
    line: int
    parent: "Node | None" = None
    children: list = field(default_factory=list)  # Node or str

    def text(self) -> str:
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)

    def iter(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.iter()


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {}, 1)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.getpos()[0], self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.getpos()[0], self.cur)
        self.cur.children.append(node)

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def html_tree(text: str) -> Node:
    b = _Builder()
    try:
        b.feed(text)
        b.close()
    except Exception:  # malformed markup: return what was parsed
        pass
    return b.root
