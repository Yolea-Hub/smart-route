#!/usr/bin/env python3
"""sogoma-check: the Sogoma lints.

    python3 -I tools/sogoma-check/sogoma_check.py [paths ...] [--fix] [--root DIR] [--exclude GLOB] [--include-kit] [--rules S01,S05] [--list-rules]

Without paths the whole tree under --root (default: the current directory) is examined. A repository with a
SOURCE.sha256 at its root is a product repository: its vendored kit/ and tools/sogoma-check/ are skipped unless
--include-kit is passed. --exclude takes a folder, a path glob or a file name glob, and can be repeated.
Exit 0 when there is no error (warnings are printed), 1 otherwise, 2 on a wrong path. --fix applies the autofix of the
rules that have one (S09, on Markdown and string tables only; HTML is check-only and is corrected by hand) and then
checks again. See sg_core.py for how phase B adds S11 to S24.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ to commit in a product repository
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:  # python3 -I removes the script directory from sys.path
    sys.path.insert(0, str(HERE))

import sg_core  # noqa: E402
from sg_core import FileCtx, Finding, RepoCtx  # noqa: E402


def load_rules() -> None:
    for p in sorted(HERE.glob("rules_*.py")):
        spec = importlib.util.spec_from_file_location(p.stem, p)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[p.stem] = mod
        spec.loader.exec_module(mod)


def run(root: Path, paths: list[Path] | None = None, only: set[str] | None = None, fix: bool = False,
        exclude: tuple[str, ...] = (), include_kit: bool = False) -> list[Finding]:
    load_rules()
    root = root.resolve()
    files = sg_core.discover(root, paths, exclude, include_kit)
    if fix:
        for r in sg_core.REGISTRY.values():
            if r.fix is None or (only and r.id not in only):
                continue
            for rel in files:
                if r.scope(rel):
                    p = root / rel
                    old = p.read_text(encoding="utf-8", errors="replace")
                    new = r.fix(old, rel)
                    if new != old:
                        p.write_text(new, encoding="utf-8")
    findings: list[Finding] = []
    full_tree = not paths
    repo = RepoCtx(root, files if full_tree else sg_core.discover(root, None, exclude, include_kit))
    for r in sorted(sg_core.REGISTRY.values(), key=lambda x: x.id):
        if only and r.id not in only:
            continue
        if r.kind == "repo":
            found = list(r.check(repo))
            if not full_tree:
                keep = set(files)
                found = [f for f in found if f.path in keep]
            findings += found
            continue
        for rel in files:
            if not r.scope(rel):
                continue
            try:
                text = (root / rel).read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            findings += list(r.check(FileCtx(root, rel, text)))
    return sorted(set(findings), key=lambda f: (f.path, f.line, f.rule))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="*", type=Path)
    ap.add_argument("--root", type=Path, default=Path.cwd())
    ap.add_argument("--exclude", action="append", default=[], metavar="GLOB", help="a folder, path glob or file name glob to skip (repeatable)")
    ap.add_argument("--include-kit", action="store_true", help="in a product repository, also read the vendored kit/ and tools/sogoma-check/")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--rules", default="", help="comma-separated rule ids to run")
    ap.add_argument("--list-rules", action="store_true")
    args = ap.parse_args(argv)
    if args.list_rules:
        load_rules()
        for r in sorted(sg_core.REGISTRY.values(), key=lambda x: x.id):
            print(f"{r.id}\t{r.severity}\t{r.kind}\t{'fix' if r.fix else ''}")
        return 0
    only = {x.strip() for x in args.rules.split(",") if x.strip()} or None
    paths = [p if p.is_absolute() else Path.cwd() / p for p in args.paths] or None
    root = args.root.resolve()
    if not root.is_dir():
        print(f"sogoma-check: --root {args.root} is not a folder", file=sys.stderr)
        return 2
    for p in paths or []:
        if not p.exists():
            print(f"sogoma-check: {p} does not exist", file=sys.stderr)
            return 2
        if not p.resolve().is_relative_to(root):
            print(f"sogoma-check: {p} is outside the root {root}: pass --root, or run from the repository root", file=sys.stderr)
            return 2
    sg_core.NOTES.clear()
    findings = run(root, paths, only, args.fix, tuple(args.exclude), args.include_kit)
    for f in findings:
        print(f)
    for n in sg_core.NOTES:
        print(f"note: {n}")
    if args.fix and any(f.rule == "S09" and f.path.endswith(".html") for f in findings):
        print("note: --fix ne réécrit pas le HTML, à corriger à la main avec U+202F (--fix does not rewrite HTML: type U+202F by hand)")
    errors = sum(1 for f in findings if f.severity == "error")
    warns = len(findings) - errors
    print(f"sogoma-check: {errors} error(s), {warns} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
