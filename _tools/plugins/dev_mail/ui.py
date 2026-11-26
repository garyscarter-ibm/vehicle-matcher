"""dev_mail kit check: a ui story names the kit components it uses (`ui:` line). Moved out of dev_mail.py (SCAF-72), unchanged.
A kit default plugin (ALWAYS_ON): runs in every project; dev_mail reports a problem if it cannot load, so a story is never
passed unchecked."""
import json, os, re

ALWAYS_ON = True
PROVIDES = ("story_check",)

# A UI story names the kit components it uses (the project's COMPONENTS.md, see the component-kit skill), so the build
# reuses them rather than building its own: `ui:` lists the kit's components, and any new one as
# "new: <name>, because <why none fits>". A story needs the line only when the project has the components piece on
# (`pieces.components` is "on" in .claude/scaffolding.json), or sets `inbox.require_ui: true` there because its kit lives
# in another repo (a site the project's stories build); a line that is there is checked either way. Stories written
# before the field existed (ids dated before UI_FROM) are left as they were; their story-lead still makes the component
# plan the poller brief's component-plan step asks for.
UI_KINDS = ("ui", "dashboard")   # `dashboard` is the older name for kind `ui`
UI_FROM = "2026-10-26"


def components_on(root):
    """True if <root>/.claude/scaffolding.json has pieces.components == "on"; False if off, unset, or the file or JSON is bad."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            return json.load(f)["pieces"]["components"] == "on"
    except (OSError, ValueError, KeyError, TypeError):
        return False


def ui_required(root):
    """True if a ui story here must carry a `ui:` line: the components piece is on, or `inbox.require_ui` is true (the
    kit is in another repo, so the piece stays off). False if neither, or the file or JSON is bad."""
    if components_on(root):
        return True
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            return json.load(f)["inbox"]["require_ui"] is True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def ui_problem(text, sid=None, components=False):
    """None if the story's `ui:` field is fine, else why not. A story of kind ui (or the older dashboard) needs one when the
    project's components piece is on (`components`); with it off, a `ui:` line that is there is still checked."""
    top = text.split("\n## Result")[0]
    kind = re.search(r"(?m)^kind:[ \t]*(\S+)", top)
    if not kind or kind.group(1) not in UI_KINDS:
        return None
    day = re.match(r"DEV-(\d{4}-\d{2}-\d{2})-", sid or "")
    if day and day.group(1) < UI_FROM:
        return None
    ui = re.search(r"(?m)^ui:[ \t]*(.*)$", top)
    if not ui or not ui.group(1).strip():
        if not components:
            return None
        return ("a ui story needs a `ui:` line naming the kit components it uses, from the project's COMPONENTS.md "
                "(e.g. `ui: pageHead, card, dataTable, emptyState`), or `ui: none` when it changes no screen")
    for part in re.findall(r"new:([^;\n]*)", ui.group(1)):
        if "because" not in part:
            return f"`ui:` asks for a new component ({part.strip()}) without saying why no existing one fits: 'new: <name>, because <why>'"
    return None


def story_check(root, stage, fields, sid, text):
    """check-story only: the story's `ui:` line."""
    if stage != "check":
        return []
    problem = ui_problem(text, sid, ui_required(root))
    return [problem] if problem else []
