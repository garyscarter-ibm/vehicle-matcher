<!-- BEGIN agent-scaffolding -->
<!-- Written by project-scaffolding (scaffold.py agents-md). Edits inside these markers are replaced on update; put your own text outside them. -->
## Codex and the IBM gateway (agent-scaffolding)

Rules for Codex working in this project. The scaffolding clone is the `repo` value in
`~/.config/agent-scaffolding/machine.json`; below it is written `<repo>`.

- **Gateway rule.** At the start of a session, run `<repo>/tools/gateway-check --harness codex`. If it prints FAIL,
  don't work on this project: tell the user which endpoint Codex is using and wait until it runs through the IBM
  gateway. PASS or UNKNOWN: carry on.
- **Before every spawn,** run `<repo>/tools/tiers spawn <agent> --harness codex`. It prints, as JSON, the `model`, the
  `effort`, the turn cap, the tools and the agent's brief. Pass that `model` and `effort` to the spawn, and begin the
  child's brief with that brief. Don't map tiers from memory. `tiers spawn` is authoritative; as of 2026-10-30 on
  Global it gives Sol with `medium` effort for implementers and Sol with `high` effort for story-leads and reviewers.
- **Use `fork_turns: "none"`** and a self-contained brief (task, working directory, files, scope, acceptance criteria,
  permission limits). A full-history fork keeps the parent's model, so the model override would be ignored.
- **One fallback.** If the spawn tool doesn't offer the pair `tiers spawn` gave, or refuses it as a model error, make
  one attempt with the `fallback` pair it printed (the top tier). If that fails too, do the work in the parent or
  report it blocked. Never loop on fallbacks.
- **Auth and credit errors aren't model errors.** Don't fall back on them: stop and report the error.
- **Every child brief says to re-read this section** (this project's `AGENTS.md`) before it spawns anything, at every
  depth. A story-lead maps each of its implementers itself with `tiers spawn`; none inherits its parent's model.
- **Record the choice** for every agent at every depth, in the progress report or the story result (the `agents:`
  line): the model and effort requested, the pair selected, and the reason for any fallback. Recording only the model
  is not enough; the effort is part of the choice.
- **Dev inbox.** When the inbox piece is on (see `.claude/scaffolding.json`), the procedure is `references/code-poller.md`
  in the plugin's dev-inbox skill, section Adapters, Codex.
- **Commit trailer** for commits Codex makes: `Co-Authored-By: Codex <noreply@openai.com>`.
<!-- END agent-scaffolding -->

## Commit and push during sessions

- Commit and push each coherent, validated chunk of work during the session, including documentation changes.
  Break longer tasks into reviewable checkpoints and push each checkpoint as soon as it is ready.
- This is standing authorization to commit and push without waiting for the session to end or for another
  user instruction or confirmation. Push promptly after each commit to the branch's configured remote.
- Stage only changes belonging to the current task, run the relevant checks, and respect branch protection.
  If a check or push fails, preserve the work and report the blocker. Force pushes need explicit authorization.

## GCSP discovery and Jira

For GCSP discovery, story authoring, design, implementation or review, first read `docs/gcsp/README.md`
and the binding purpose and adapter boundaries in `docs/gcsp/demo-brief.md`. The index distinguishes
authorised backlog items from proposals. Capture further discussion in `docs/gcsp/` and agree additional
backlog scope with Russell before discussion-driven Jira changes. This takes precedence over automatic
backlog capture. FUCQ-1 remains discovery context. All scaffolding remains on.

Use bounded feature capabilities for backlog items, including changes that span views and services.
Keep the broad demo hills in the brief; Jira's Epic issue type does not determine item size.

## GCSP experience quality

Every GCSP role reads `docs/gcsp/experience-quality.md`. Apply its acceptance and visual-review gates to
every change affecting a screen or user-visible behaviour, including code/backend stories. Follow the
agreed visual reference and `COMPONENTS.md`; extend shared components and tokens to preserve consistency.

Before every GCSP spawn, include the experience-contract path, applicable visual reference and relevant
acceptance criteria in the self-contained brief. Require each child to read them and propagate the same
obligations to its descendants. Story authors use the existing `decided`, `acceptance` and `validate`
sections, including Jira-authored stories; reviewers require the corresponding evidence in the result.
