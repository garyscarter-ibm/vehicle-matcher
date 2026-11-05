"""Jira UI plans must survive import and the real component-intake gate."""
import importlib.util
from pathlib import Path
import unittest


TOOLS = Path(__file__).resolve().parents[1]


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


JS = load_tool("jira_sync")
MAIL = load_tool("dev_mail")
STORY = "DEV-2026-11-04-051"
DESCRIPTION = """## Goal
Render shared employee controls.

## Acceptance criteria
- Render the declared shared components.

## Files or areas
blocks/gcsp/

## Decided
{plan}
Use the agreed shared kit.

## Out of scope
Live integrations.

## Validate
Check the rendered controls.
"""


def imported_blocks(plan):
    issue = JS.parse_issue({"key": "FUCQ-31", "fields": {
        "summary": "Render shared controls", "issuetype": {"name": "Story"},
        "description": DESCRIPTION.format(plan=plan), "labels": ["kind:ui"],
        "created": "2026-11-04T08:00:00Z", "updated": "2026-11-05T08:00:00Z",
    }})
    return JS.issue_blocks(issue, {"project": "FUCQ"}, {})


class JiraUiPlanTests(unittest.TestCase):
    def test_authored_plan_in_decided_passes_component_intake_after_import(self):
        text = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: matchCard, mediaWell"))
        self.assertIn("\nui: matchCard, mediaWell\n", text)
        self.assertIsNone(MAIL.ui_problem(text, STORY, components=True))

    def test_indented_new_component_reason_is_preserved(self):
        plan = "el; new: portalShell, because no existing component supplies portal landmarks"
        text = JS.render_new("FUCQ-31", STORY, imported_blocks("  ui: " + plan))
        self.assertIn("\nui: " + plan + "\n", text)
        self.assertIsNone(MAIL.ui_problem(text, STORY, components=True))

    def test_updated_plan_replaces_waiting_metadata_without_losing_git_fields(self):
        old = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: matchCard"))
        old += "story_points: 8\npaused: human review\n\n## Result\n- status: blocked\n"
        replacement = imported_blocks("ui: mediaWell, el")
        updated = JS.merge_owned(old, replacement)
        self.assertIn("\nui: mediaWell, el\n", updated)
        self.assertNotIn("\nui: matchCard\n", updated)
        self.assertIn("story_points: 8\npaused: human review\n\n## Result\n- status: blocked\n", updated)
        self.assertEqual(JS.merge_owned(updated, replacement), updated)

    def test_changed_plan_is_visible_to_claimed_story_change_detection(self):
        old = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: matchCard"))
        self.assertIn("ui", JS.differing(old, imported_blocks("ui: mediaWell")))

    def test_missing_or_removed_plan_still_fails_required_intake(self):
        old = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: matchCard"))
        blocks = imported_blocks("No component plan was authored.")
        for text in (JS.render_new("FUCQ-31", STORY, blocks), JS.merge_owned(old, blocks)):
            self.assertIsNotNone(MAIL.ui_problem(text, STORY, components=True))

    def test_invalid_new_component_plan_is_not_silently_accepted(self):
        text = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: new: bespokeCard"))
        self.assertIn("without saying why", MAIL.ui_problem(text, STORY, components=True))

    def test_explicit_no_screen_plan_is_preserved(self):
        text = JS.render_new("FUCQ-31", STORY, imported_blocks("ui: none"))
        self.assertIn("\nui: none\n", text)
        self.assertIsNone(MAIL.ui_problem(text, STORY, components=True))


if __name__ == "__main__":
    unittest.main()
