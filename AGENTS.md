<!-- BEGIN agent-scaffolding -->
<!-- Written by project-scaffolding (scaffold.py agents-md). Edits inside these markers are replaced on update; put your own text outside them. -->
## Codex and the IBM gateway (agent-scaffolding)

Rules for Codex working in this project. The scaffolding clone is the `repo` value in
`~/.config/agent-scaffolding/machine.json`; below it is written `<repo>`.

- **Gateway rule.** At the start of a session, run `<repo>/tools/gateway-check --harness codex`. If it prints FAIL,
  don't work on this project: tell the user which endpoint Codex is using and wait until it runs through the IBM
  gateway. PASS or UNKNOWN: carry on.
- **Every launching session owns test resources.** Direct tests at Ultra or any other effort obey the same
  lifecycle, resource, output and proportional-validation contract as delegated work, even with the inbox off.
  Apply the global `Test resources and large generated outputs` section; if absent, read that section of
  `<repo>/managed/CLAUDE.md.tmpl`. Pass selected checks, owned scratch, output path, chunk limits, checkpoint and
  teardown duties in every child brief, at every depth. Keep the parent responsible for the final receipt.
- **Before every spawn,** run `<repo>/tools/tiers spawn <agent> --harness codex`. It prints, as JSON, the `model`, the
  `effort`, the turn cap, the tools and the agent's brief. Pass that `model` and `effort` to the spawn, and begin the
  child's brief with that brief. Don't map tiers from memory. `tiers spawn` is authoritative; as of 2026-10-30 on
  Global it gives Sol with `medium` effort for implementers and Sol with `high` effort for story-leads and reviewers.
- **Cartoon names.** Use the returned `task_name` in the spawn and `name` in progress reports. The child's brief
  tells it to set its own desktop chat title to `name`; verify that title before reporting sidebar naming as fixed.
  Pass the returned `naming_session` as `--session` on descendant `tiers spawn` calls, at every depth.
- **Before each batch of spawns,** run `/usr/bin/python3 -I <repo>/tools/capacity --line` and start no more than its
  `can_start`. It counts the Claude and Codex agents already working on this machine, so there is no fixed number.
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
- **Bugs.** Before intake, triage, repair or review, read `<repo>/plugin/skills/defects/SKILL.md`; give children its
  absolute path and current diagnosis note.
- **Product map.** When `pieces.product-map` is on, follow the product-map skill. Keep stable product
  components and story associations in `.product-map/components.json`, and durable story/slice plans,
  states and observed worker claims in `.product-map/work.json`. Use `_tools/product_map.py`; include
  required integration slices. Complete slices count 1, in-progress .5, blocked/not-started 0; average
  story fractions. In Review is 100% developed (green), Done is accepted (blue). Preserve observation
  times, expire worker claims, and commit facts with the work. The map never infers acceptance or
  active workers from commits. Follow the configured publishing mode; local hooks must be installed
  in each contributing clone, and IBM Pages serves the committed static files from main.
- **Commit trailer** for commits Codex makes: `Co-Authored-By: Codex <noreply@openai.com>`.
<!-- END agent-scaffolding -->
