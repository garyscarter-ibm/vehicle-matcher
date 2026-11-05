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

## Explicit Codex commit attribution

On 5 November, the dispatcher verified that `scaffold_git.commit_paths` stores
the supplied message verbatim. Setting `scaffold_git.ATTRIBUTION` alone does not
append the required trailer to ordinary commits. Each Codex commit message must
explicitly end with a blank line and:

```text
Co-Authored-By: Codex <noreply@openai.com>
```

Verify the resulting commit body through the Git adapter before pushing. This
also applies to generated claim and sync checkpoints: use a calling wrapper
that appends the trailer to messages passed to `commit_paths` and the claim
helper `_commit_two` when needed.
Pass this requirement to every worker and descendant.

The claim helper commits directly through `git`; wrapping `commit_paths`
alone does not cover it. Set `ATTRIBUTION` as well for generated pull/merge
messages, and verify the actual body at each entry point. Keep adaptations in
the calling process rather than replacing the project-owned helper.

Known published Codex checkpoints missing the trailer include the dispatcher
claim/readiness/mail commits `1c527ae`, `2b79601`, `2ca4818` and the FUCQ-102
checkpoints `a3fdcdf` and `17074a3`. Their code and evidence identities remain
unchanged. Preserve published history; include explicit Codex attribution in
subsequent implementation and integration commits.

Restart merge `c0d6a08` retained the helper's default Claude Code trailer, and
claim `7dd5988` omitted the trailer because the dispatcher did not wrap
`_commit_two`. This follow-up records Codex responsibility for both checkpoints
without rewriting their published identities.
