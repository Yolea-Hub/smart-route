"""S23: every component identifier used in the tree has a row in the component matrix, accepted or refused.

When tools/build_matrix.py exists (step B4) the check is delegated to `build_matrix.py --check`; otherwise the rule
reads kit/components/MATRICE.fr.md directly. With no matrix at all it reports one warning, never an error.
In a product repository (SOURCE.sha256 at the root) the tool is not vendored: the rule stays silent and prints a note.
"""
from __future__ import annotations

import re
import subprocess
import sys

from sg_core import Finding, RepoCtx, is_product_repo, note, rule, strip_comments, under
from sg_extra import MARKUP_EXT

MATRIX = "kit/components/MATRICE.fr.md"
BUILDER = "tools/build_matrix.py"
_ELEMENT = re.compile(r"<(sg-[a-z][a-z0-9-]*)\b")
_JS_DEFINE = re.compile(r"customElements\.define\(\s*['\"](sg-[a-z0-9-]+)['\"]")
_WIDGET = re.compile(r"(?<![\w.])(Sogoma[A-Z]\w*)\s*\(")
NOT_COMPONENTS = {"SogomaTheme", "SogomaTokens", "SogomaColors", "SogomaIcons", "SogomaType", "SogomaSpace"}
CODE = MARKUP_EXT + (".js", ".mjs", ".ts", ".dart")


def _pascal(element: str) -> str:
    return "".join(p.capitalize() for p in element[3:].split("-"))


def _template_names(repo: RepoCtx) -> list[tuple[str, str, int]]:
    out = []
    for rel in repo.files:
        if under(rel, "kit/templates/") and rel.endswith(".md"):
            for n, line in enumerate(repo.read(rel).split("\n"), 1):
                for m in re.finditer(r"`<?(sg-[a-z0-9-]+)>?`|`([A-Z][A-Za-z]+)`", line):
                    out.append((m.group(1) or m.group(2), rel, n))
    return out


@rule("S23", kind="repo")
def s23(repo: RepoCtx):
    if (repo.root / BUILDER).is_file():
        proc = subprocess.run([sys.executable, "-I", str(repo.root / BUILDER), "--check"], cwd=repo.root,
                              capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            msg = (proc.stdout + proc.stderr).strip().splitlines()[-1:] or ["build_matrix.py --check failed"]
            yield Finding("S23", "error", BUILDER, 1, "component without a matrix row: " + msg[0][:200])
        return
    if is_product_repo(repo.root):
        note("S23 ne s'applique pas ici : l'outil de la matrice, tools/build_matrix.py, reste dans le dépôt Sogoma (S23 does not run here: the matrix tool stays in the Sogoma repository)")
        return
    mp = repo.root / MATRIX
    if not mp.is_file():
        yield Finding("S23", "warn", MATRIX, 1, "component matrix absent: S23 cannot check the component identifiers yet")
        return
    rows = "\n".join(l for l in mp.read_text(encoding="utf-8").split("\n") if l.startswith("|"))
    used: list[tuple[str, str, int]] = []
    for rel in repo.files:
        if not rel.endswith(CODE) or under(rel, "docs/", "charte/", "migration/"):
            continue
        text = strip_comments(repo.read(rel), rel)
        for rx in (_ELEMENT, _JS_DEFINE):
            for m in rx.finditer(text):
                used.append((m.group(1), rel, text.count("\n", 0, m.start()) + 1))
        if rel.endswith(".dart"):
            for m in _WIDGET.finditer(text):
                if m.group(1) not in NOT_COMPONENTS:
                    used.append((m.group(1), rel, text.count("\n", 0, m.start()) + 1))
    used += _template_names(repo)
    reported = set()
    for name, rel, line in used:
        candidates = {name}
        if name.startswith("sg-"):
            candidates.add(_pascal(name))
        if name.startswith("Sogoma"):
            candidates.add(name[len("Sogoma"):])
        if any(re.search(r"(?<![\w-])" + re.escape(c) + r"(?![\w-])", rows) for c in candidates):
            continue
        if (name, rel) in reported:
            continue
        reported.add((name, rel))
        yield Finding("S23", "error", rel, line, f"component « {name} » has no row in {MATRIX} (accepted or refused)")
