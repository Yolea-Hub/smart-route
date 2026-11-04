"""Core of sogoma-check: findings, the rule registry, file discovery, comment stripping.

Extending the registry (phase B adds S11-S24): create a file `rules_<anything>.py` next to this one, import
`rule` and `Finding` from `sg_core`, and decorate a function:

    @rule("S11", severity="error", scope=lambda rel: rel.endswith(".md"))
    def s11(ctx):                      # kind="file": ctx is a FileCtx
        yield Finding("S11", "error", ctx.rel, 1, "message")

    @rule("S07", kind="repo")          # kind="repo": ctx is a RepoCtx (every file of the run)
    def s07(repo): ...

A rule may carry `fix=callable(text, rel) -> text`; `--fix` applies it, then the run is repeated.
Every rules_*.py next to this file is loaded by sogoma_check.py in alphabetical order.
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

CODE_EXT = (".css", ".svelte", ".tsx", ".jsx", ".vue", ".html", ".dart", ".js")
TEXT_EXT = CODE_EXT + (".md", ".json", ".svg", ".txt", ".py", ".sh", ".yml", ".yaml", ".ts", ".mjs", ".cjs")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv", ".github-cache"}
SKIP_PREFIXES = ("docs-site/dist/", "docs-site/dist-draft/", "migration/v3-reference/")
# What tools/vendor.sh copies into a product repository. SOURCE.sha256 at the root marks such a repository. The copy is
# not the product's code and is pinned by that file, so the lints do not read it unless --include-kit is passed.
PRODUCT_MARKER = "SOURCE.sha256"
VENDORED_PREFIXES = ("kit/", "tools/sogoma-check/")
NOTES: list[str] = []  # printed once by sogoma_check.py after the findings; they are not findings


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str  # "error" | "warn"
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule} [{self.severity}] {self.message}"


@dataclass
class Rule:
    id: str
    severity: str
    kind: str
    scope: Callable[[str], bool]
    check: Callable
    fix: Callable[[str, str], str] | None = None


REGISTRY: dict[str, Rule] = {}


def rule(rule_id: str, *, severity: str = "error", kind: str = "file",
         scope: Callable[[str], bool] | None = None, fix: Callable[[str, str], str] | None = None):
    def deco(fn):
        REGISTRY[rule_id] = Rule(rule_id, severity, kind, scope or (lambda rel: True), fn, fix)
        return fn
    return deco


def is_code(rel: str) -> bool:
    return rel.endswith(CODE_EXT)


@dataclass
class FileCtx:
    root: Path
    rel: str
    text: str
    _stripped: str | None = field(default=None, repr=False)

    @property
    def stripped(self) -> str:
        """The text with comments blanked (line numbers preserved)."""
        if self._stripped is None:
            self._stripped = strip_comments(self.text, self.rel)
        return self._stripped

    def line_of(self, index: int, text: str | None = None) -> int:
        return (text if text is not None else self.text).count("\n", 0, index) + 1


@dataclass
class RepoCtx:
    root: Path
    files: list[str]  # every relative path of the run (all kinds)

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8", errors="replace")


def _blank(m: re.Match) -> str:
    return re.sub(r"[^\n]", " ", m.group(0))


def strip_comments(text: str, rel: str = "") -> str:
    """Blank HTML, block and line comments. A line comment needs whitespace or line start before the slashes (URLs survive)."""
    if rel.endswith((".md", ".json")):
        return text
    out = re.sub(r"<!--.*?-->", _blank, text, flags=re.S)
    if rel.endswith(".svg"):
        return out
    out = re.sub(r"/\*.*?\*/", _blank, out, flags=re.S)
    if not rel.endswith(".css"):
        out = re.sub(r"(?m)(?:^|(?<=\s))//[^\n]*", _blank, out)
    return out


def under(rel: str, *prefixes: str) -> bool:
    return any(rel.startswith(p) for p in prefixes)


def is_product_repo(root: Path) -> bool:
    return (root / PRODUCT_MARKER).is_file()


def note(text: str) -> None:
    if text not in NOTES:
        NOTES.append(text)


def excluded(rel: str, patterns: Iterable[str]) -> bool:
    """A pattern is a folder (`vendor/` or `vendor`), a path glob or a file name glob."""
    for pat in patterns:
        if rel.startswith(pat.rstrip("/") + "/") or glob_any(rel, (pat,)):
            return True
    return False


def discover(root: Path, paths: list[Path] | None = None, exclude: Iterable[str] = (), include_kit: bool = False) -> list[str]:
    """Relative POSIX paths of the files to examine."""
    root = root.resolve()
    skip_vendored = is_product_repo(root) and not include_kit
    if skip_vendored:
        note("dépôt produit : kit/ et tools/sogoma-check/ copiés ne sont pas lus, --include-kit pour les lire (product repository: vendored kit/ and tools/sogoma-check/ are not read)")
    keep = lambda rel: not excluded(rel, exclude) and not (skip_vendored and rel.startswith(VENDORED_PREFIXES))  # noqa: E731
    starts = [p.resolve() for p in paths] if paths else [root]
    out: list[str] = []
    for s in starts:
        if s.is_file():
            rel = s.relative_to(root).as_posix()
            if keep(rel):
                out.append(rel)
            continue
        for p in sorted(s.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            parts = rel.split("/")
            if any(d in SKIP_DIRS or d.startswith(".") and d not in (".github",) for d in parts[:-1]):
                continue
            if rel.startswith(SKIP_PREFIXES) or rel.startswith("_archive") or "/tests/fixtures/" in "/" + rel:
                continue
            if keep(rel):
                out.append(rel)
    return sorted(set(out))


def glob_any(rel: str, patterns: Iterable[str]) -> bool:
    base = rel.rsplit("/", 1)[-1]
    return any(fnmatch.fnmatchcase(rel, p) or fnmatch.fnmatchcase(base, p) for p in patterns)
