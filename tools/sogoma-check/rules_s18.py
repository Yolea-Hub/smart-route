"""S18 (warn): an `available` docs page whose `updated` date is older than 180 days."""
from __future__ import annotations

import datetime as dt

from sg_core import FileCtx, Finding, rule
from sg_extra import front_matter

MAX_AGE_DAYS = 180
TODAY: dt.date | None = None  # tests pin the date; None means the machine's date


@rule("S18", severity="warn", scope=lambda rel: rel.endswith(".md"))
def s18(ctx: FileCtx):
    if not ctx.text.startswith("---"):
        return
    fm = front_matter(ctx.text)
    if fm is None or fm.data.get("status") != "available":
        return
    try:
        updated = dt.date.fromisoformat(str(fm.data.get("updated")))
    except ValueError:
        return
    today = TODAY or dt.date.today()
    age = (today - updated).days
    if age > MAX_AGE_DAYS:
        yield Finding("S18", "warn", ctx.rel, fm.lines.get("updated", 1),
                      f"available page last updated {age} days ago (more than {MAX_AGE_DAYS}): review it or change its status")
