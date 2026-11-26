"""jira_sync default plugin (SCAF-70), opt-in: enable with .claude/scaffolding.json "extensions": {"jira_sync": ["ui"]}.
Imports an explicit `ui:` line of a Jira description as the story's top-level `ui:` field (the component plan that
dev_mail's component-intake gate reads for a kind:ui story). Without it, a plan written under `## Decided` is kept inside
that section but the story has no `ui:` line and fails intake. Behaviour of vehicle-matcher's fork commit 223779ac0.

The field is Jira-owned (owned=True): it is rewritten on every pull of a waiting story, removed when the plan is deleted in
Jira, and reported as a change on a claimed story, like the core Jira-owned fields. The first `ui:` line wins; an empty one
gives no field."""
import re

PROVIDES = ("story_field_defs", "story_fields")
UI_RE = re.compile(r"(?m)^[ \t]*ui:[ \t]*([^\n]*)$")


def story_field_defs(root):
    return [{"name": "ui", "after": "design_impact", "owned": True}]


def story_fields(root, issue, ctx):
    found = UI_RE.search(issue["description"])
    if found and found.group(1).strip():
        return {"ui": found.group(1).strip()}
    return {}
