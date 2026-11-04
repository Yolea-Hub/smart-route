"""S15: at most 12 distinct icon ids per repository beyond the kit chrome set, marks, faces and the logo.

The cap is raised only by a dated `icons_cap:` line in YOLEA.md; each `icon_pending:` line counts as one icon.
A malformed machine line is an error, never a silent default; a product repository without YOLEA.md gets a warning.
The kit's own catalogue and generated icon files (kit/icons/**, the Flutter icon constants, the icon CSS) are the
supply, not a use, and are not counted.

Lucide in code (Addendum 7, Track B step 2): a package name such as `lucide-react` is never an icon; each icon imported
from `@lucide/svelte` (or `lucide-svelte`) counts, and each icon imported from `lucide-react` (or `@lucide/react`) counts
once it is used as a JSX component (`<Check />`). Icon ids follow Lucide's kebab names (`ArrowRight` -> `arrow-right`).
"""
from __future__ import annotations

import re

from sg_core import Finding, RepoCtx, is_product_repo, rule, strip_comments, under
from sg_extra import MARKUP_EXT, yolea_lines

CHROME = {"morning", "work", "jar", "gate", "back", "close", "search", "add", "edit", "undo", "done", "send", "export", "question"}
DEFAULT_CAP = 12
_IDS = re.compile(r"(?<![\w-])(?:sg-icon-([a-z][a-z0-9-]*)|lucide-([a-z][a-z0-9-]*)|SogomaIcons\.([a-zA-Z][a-zA-Z0-9]*))")
CODE = MARKUP_EXT + (".js", ".ts", ".mjs", ".dart", ".css")
SUPPLY = ("kit/icons/", "kit/marks/", "kit/flutter/", "kit/css/icons.css", "rafiq/", "kit/logos/")
SVELTE_PACKAGES = ("@lucide/svelte", "lucide-svelte")
REACT_PACKAGES = ("lucide-react", "@lucide/react")
_PKG = "|".join(re.escape(p) for p in SVELTE_PACKAGES + REACT_PACKAGES)
# A quoted module specifier of a Lucide package, with or without a sub-path: blanked before the id scan.
_SPECIFIER = re.compile(r"""(['"])(?:@lucide/[a-z-]+|lucide-(?:react-native|react|svelte|vue-next|vue|preact|solid|angular|static))(?:/[^'"\n]*)?\1""")
_NAMED_IMPORT = re.compile(r"""\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](""" + _PKG + r""")(?:/[^'"]*)?['"]""")
_PATH_IMPORT = re.compile(r"""\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"](""" + _PKG + r""")/(?:dist/esm/)?icons/([a-z0-9-]+)(?:\.(?:svelte|js|mjs))?['"]""")
_NOT_ICON = {"Icon", "LucideIcon", "LucideProps", "IconNode", "IconProps", "SVGAttributes"}


def _kebab(name: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", r"-\1", name).lower()


def _lucide_id(name: str) -> str:
    """`ArrowRightIcon`, `LucideArrowRight` and `ArrowRight` are all `arrow-right`; `Clock3` is `clock-3`."""
    if name.startswith("Lucide") and len(name) > 6:
        name = name[6:]
    if name.endswith("Icon") and len(name) > 4:
        name = name[:-4]
    return re.sub(r"(?<!^)(?=[A-Z])|(?<=[A-Za-z])(?=\d)", "-", name).lower()


def lucide_uses(text: str) -> list[tuple[str, int]]:
    """The Lucide icons a file uses, as (icon id, offset): Svelte imports, and React imports used as JSX components."""
    found: list[tuple[str, int]] = []
    imports: list[tuple[str, str, str, int]] = []  # (package, icon name, local name, offset)
    for m in _NAMED_IMPORT.finditer(text):
        for part in m.group(1).split(","):
            bits = part.split()
            if not bits or bits[0] == "type":
                continue
            name, local = bits[0], bits[2] if len(bits) == 3 and bits[1] == "as" else bits[0]
            if name[:1].isupper() and name not in _NOT_ICON:
                imports.append((m.group(2), name, local, m.start()))
    for m in _PATH_IMPORT.finditer(text):
        imports.append((m.group(2), m.group(3), m.group(1), m.start()))
    for package, name, local, offset in imports:
        icon_id = name if "-" in name or name.islower() else _lucide_id(name)
        if package in SVELTE_PACKAGES:
            found.append((icon_id, offset))
            continue
        jsx = re.search(r"<" + re.escape(local) + r"(?=[\s/>])", text)
        if jsx:
            found.append((icon_id, jsx.start()))
    return found


def _exempt(icon_id: str) -> bool:
    return icon_id in CHROME or icon_id.startswith(("mark-", "face-", "logo", "yolea-"))


@rule("S15", kind="repo")
def s15(repo: RepoCtx):
    used: dict[str, tuple[str, int]] = {}
    for rel in repo.files:
        if not rel.endswith(CODE) or under(rel, *SUPPLY):
            continue
        text = strip_comments(repo.read(rel), rel)
        for icon_id, offset in lucide_uses(text):
            if not _exempt(icon_id):
                used.setdefault(icon_id, (rel, text.count("\n", 0, offset) + 1))
        text = _SPECIFIER.sub(lambda s: " " * len(s.group(0)), text)
        for m in _IDS.finditer(text):
            icon_id = m.group(1) or m.group(2) or _kebab(m.group(3))
            if not _exempt(icon_id):
                used.setdefault(icon_id, (rel, text.count("\n", 0, m.start()) + 1))
    lines = yolea_lines(repo.root)
    for n, message in lines.errors:
        yield Finding("S15", "error", "YOLEA.md", n, message)
    if is_product_repo(repo.root) and not (repo.root / "YOLEA.md").is_file():
        yield Finding("S15", "warn", "YOLEA.md", 1, "no YOLEA.md: the cap falls back to 12 and no home route is checked; copy the template (tools/vendor.sh does it)")
    pending = [p for p in lines.icon_pending if p not in used]
    cap = lines.icons_cap if lines.icons_cap is not None else DEFAULT_CAP
    count = len(used) + len(pending)
    if count > cap:
        rel, line = sorted(used.values())[-1] if used else ("YOLEA.md", 1)
        yield Finding("S15", "error", rel, line,
                      f"{count} distinct icons ({len(used)} drawn or shimmed, {len(pending)} pending) above the cap of {cap}: "
                      f"add a dated icons_cap: line to YOLEA.md or remove icons")
