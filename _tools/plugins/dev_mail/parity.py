"""dev_mail kit check: a parity criterion names its screen, states, scenario and viewport. Moved out of dev_mail.py (SCAF-72),
unchanged. A kit default plugin (ALWAYS_ON): runs in every project; dev_mail reports a problem if it cannot load, so a story is
never passed unchecked. It warns (check-story prints the lines, exit 0); it never refuses."""
import re

ALWAYS_ON = True
PROVIDES = ("story_warnings",)

# Parity criteria (1.14.0; SCAF-40, Russell 2026-11-20; plugin/skills/backlog/references/migration-parity.md, "Parity
# definition"). A criterion that claims parity with another implementation names the screen, states, scenario and viewport
# its screenshot pair is taken in. check-story warns, never refuses: API, data and JSON parity are out of scope.
PARITY_CLAIM = re.compile(r"\bparity\b|same as the old (?:version|implementation|screen|app)|"
                          r"preserv\w* (?:the )?(?:current |existing )?visual design", re.I)
NOT_UI_PARITY = re.compile(r"\b(?:api|data|json|schema|backend|database)\s+parity\b", re.I)
PARITY_PARTS = (("screen", re.compile(r"\bscreens?\b", re.I)), ("state", re.compile(r"\bstates?\b", re.I)),
                ("scenario", re.compile(r"\bscenarios?\b", re.I)),
                ("viewport", re.compile(r"\bviewports?\b|\b\d{3,4}x\d{3,4}\b", re.I)))


def acceptance_items(value):
    """The items of an `acceptance` value: each `- ...`, `* ...` or `1. ...` line, with its continuation lines joined."""
    items, cur = [], None
    for line in (value or "").split("\n"):
        if re.match(r"^\s*(?:[-*]|\d+[.)])\s+", line):
            if cur is not None:
                items.append(cur)
            cur = line.strip()
        elif line.strip():
            cur = line.strip() if cur is None else cur + " " + line.strip()
    if cur is not None:
        items.append(cur)
    return items


def parity_warnings(fields):
    out = []
    for n, item in enumerate(acceptance_items(fields.get("acceptance")), 1):
        if not PARITY_CLAIM.search(NOT_UI_PARITY.sub("", item)):
            continue
        missing = [name for name, rx in PARITY_PARTS if not rx.search(item)]
        if missing:
            out.append(f"acceptance item {n} claims parity but names no {', '.join(missing)}: a parity criterion names "
                       "the screen, states, scenario and viewport (backlog skill, references/migration-parity.md)")
    return out


def story_warnings(root, fields):
    return parity_warnings(fields)
