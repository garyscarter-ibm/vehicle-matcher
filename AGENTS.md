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
