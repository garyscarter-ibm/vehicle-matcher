# Preserve Jira-authored UI component plans

The Jira importer previously kept an authored `ui:` line inside the indented
`decided` section, but omitted the top-level field that the component-intake gate
requires. This caused valid UI stories to fail intake after import. The manual
repairs for FUCQ-64, FUCQ-31 and FUCQ-33 remain valid; this change fixes subsequent
imports without changing their scope or active claims.

`_tools/jira_sync.py` now imports an explicit `ui:` line from the Jira description
as Jira-owned story metadata. Waiting stories receive later edits, while the
existing claimed-story path reports changed metadata without replacing the
worker's content. The original description and component-intake checks remain in
place. Missing plans and new components without a reason still fail intake.

The tool is marked `1.3.1+vehicle-matcher.1`, a project-owned fork of scaffolding
1.3.1, so automatic vendoring cannot overwrite this repair. Reconcile future
upstream importer changes manually. Return to a numeric upstream version when it
contains this behaviour and the local regression checks pass. Other scaffolding
tools retain their normal automatic update behaviour.

Run the retained regression checks from the repository root:

```sh
/usr/bin/python3 -I -B -m unittest discover -s _tools/tests -p test_jira_sync_ui.py
```

The seven checks exercise import-to-intake behaviour, component reasons, updates,
claimed-story change detection, idempotence, preserved Git-owned fields and
missing/invalid plans. Six failed against the original importer and all seven
pass after the repair. A further 22 existing upstream import/edit, Markdown and
defect-mapping checks passed against this project's patched importer: **29 checks
passed in total**. The isolated Git test repositories were empty after their
cleanup handlers ran, and their enclosing scratch directory was removed and
verified absent. No raw logs or generated outputs were retained.
No application code or screen changes require a backend suite or browser review.

This maintenance was performed in a separate worktree alongside the active
Claude FUCQ-64 build. No child agents were spawned. Live Jira synchronisation is
unverified in this Codex session until its Atlassian connection is available;
the checks use offline issue fixtures and isolated temporary Git repositories.
