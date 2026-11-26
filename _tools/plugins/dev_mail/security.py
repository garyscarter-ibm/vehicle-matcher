"""dev_mail kit check: a design-impact story names its threat ids and controls when pieces.spbd is on. Moved out of dev_mail.py
(SCAF-72), unchanged. A kit default plugin (ALWAYS_ON): runs in every project; dev_mail reports a problem if it cannot load, so a
story is never passed unchecked."""
import json, os, re

ALWAYS_ON = True
PROVIDES = ("story_check",)


def security_problem(fields, root):
    """SPbD explicitly opts design-impact stories into substantive threat/control metadata.

    This checks presence, including common draft placeholders, not threat policy or mitigation proof.
    """
    if fields.get("design_impact", "").strip().lower() != "yes":
        return None
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            enabled = json.load(f)["pieces"]["spbd"] == "on"
    except (OSError, ValueError, KeyError, TypeError):
        enabled = False
    if not enabled:
        return None
    placeholders = ("", "none", "n/a", "na", "tbd", "todo", "...", "-", "[ ]", "|", ">")
    for line in fields.get("security", "").splitlines():
        value = line.strip()
        if value.startswith("#"):
            continue
        value = re.sub(r"^[-*+]\s+(?:\[[ xX]\]\s*)?", "", value).strip()
        if value.casefold() not in placeholders and not re.fullmatch(r"<[^>]*>", value):
            return None
    return ("security: name the threat ids and controls to prove; a design-impact story needs this "
            "when pieces.spbd is on (replace empty or placeholder text)")


def story_check(root, stage, fields, sid, text):
    """check-story only: the story's `security:` field."""
    if stage != "check":
        return []
    problem = security_problem(fields, root)
    return [problem] if problem else []
