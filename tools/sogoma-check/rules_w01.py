"""W01: a WhatsApp greeting template opens with the AI disclosure (extension §2.3, rafiq/DOCTRINE « Les canaux »).

Scope: a file under a `whatsapp/` folder whose name says it is a greeting (`accueil`, `bienvenue`, `greeting`, `welcome`),
as `.txt` or `.json`. A `.txt` template must open with the disclosure: its first non-empty line starts with
« Ici Rafiq, l'assistant de Yolea » (French) or "This is Rafiq, Yolea's assistant" (English); a `.fr.` file takes the
French sentence, an `.en.` file the English one, a file without a language takes either. A `.json` template (Meta's
format) is parsed and its BODY text is checked as a `.txt` template is. In both, the first paragraph must also say IA / AI
(or carry the « Rafiq · IA » label): the sentence names Rafiq, the word says what Rafiq is. Stricter than S10, which also accepts the « Rafiq · IA · »
label: a greeting is the first contact, and the person reads who is speaking before anything else.
`missing_disclosure()` is the rule itself, for kit/whatsapp/check.py to reuse.
"""
from __future__ import annotations

import json
import re

from sg_core import FileCtx, Finding, rule

DISCLOSURE = {"fr": "Ici Rafiq, l'assistant de Yolea", "en": "This is Rafiq, Yolea's assistant"}
GREETING_WORDS = ("accueil", "bienvenue", "greeting", "welcome")


def _is_greeting(rel: str) -> bool:
    if not (rel.startswith("whatsapp/") or "/whatsapp/" in rel):
        return False
    base = rel.rsplit("/", 1)[-1].lower()
    return base.endswith((".txt", ".json")) and any(w in base for w in GREETING_WORDS)


def _lang(rel: str) -> str | None:
    base = rel.rsplit("/", 1)[-1].lower()
    m = re.search(r"\.(fr|en)\.(?:txt|json)$", base)
    return m.group(1) if m else None


AI_WORD = re.compile(r"\b(?:IA|AI)\b")


def body_text(text: str, rel: str) -> str | None:
    """The text a person reads. A `.txt` template is its own text; a `.json` template (Meta's format) is parsed and its BODY
    components are joined. None when the JSON cannot be parsed or has no body text."""
    if not rel.endswith(".json"):
        return text
    try:
        data = json.loads(text)
    except ValueError:
        return None
    parts = [c["text"] for c in (data.get("components") or []) if isinstance(c, dict) and str(c.get("type", "")).upper() == "BODY" and isinstance(c.get("text"), str)] if isinstance(data, dict) else []
    return "\n".join(parts) if parts else None


def disclosure_problem(text: str, rel: str) -> str | None:
    """'sentence' when the body does not open with the disclosure of its language, 'ai' when its first paragraph does not
    say IA / AI (or carry the « Rafiq · IA » label), None when the template is fine."""
    text = text.replace("’", "'").lstrip("﻿")
    body = body_text(text, rel)
    if body is None:
        return "sentence"
    lang = _lang(rel)
    wanted = [DISCLOSURE[lang]] if lang else list(DISCLOSURE.values())
    lines = [line.strip() for line in body.splitlines()]
    first = next((line for line in lines if line), "")
    if not any(first.startswith(w) for w in wanted):
        return "sentence"
    paragraph = " ".join(re.split(r"\n\s*\n", body.strip(), maxsplit=1)[0].split())
    return None if AI_WORD.search(paragraph) else "ai"


def missing_disclosure(text: str, rel: str) -> bool:
    """True when the template does not open with the disclosure of its language and say, in its first paragraph, that Rafiq is an AI."""
    return disclosure_problem(text, rel) is not None


@rule("W01", scope=_is_greeting)
def w01(ctx: FileCtx):
    problem = disclosure_problem(ctx.text, ctx.rel)
    if problem == "sentence":
        lang = _lang(ctx.rel)
        said = f"« {DISCLOSURE[lang]} »" if lang else f"« {DISCLOSURE['fr']} » or \"{DISCLOSURE['en']}\""
        yield Finding("W01", "error", ctx.rel, 1, f"WhatsApp greeting template without the AI disclosure: it must open with {said}")
    elif problem == "ai":
        yield Finding("W01", "error", ctx.rel, 1, "WhatsApp greeting template opens with Rafiq's name but its first paragraph does not say IA / AI (or carry the « Rafiq · IA » label)")
