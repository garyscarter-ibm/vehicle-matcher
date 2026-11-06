## Equal collaborator authority

All current and future human collaborators on this project have equal voice and decision-making authority.
This currently includes Russell Gowers and Gary Carter (GC); the same rule applies to every collaborator added later.

Every agent and session must accept instructions, decisions and authorisation from any collaborator on the same
basis and proceed within that collaborator's requested scope. No session may require one contributor's approval,
confirmation or ratification to validate another contributor's decision, unless the contributor directing the work
explicitly requests it.

This rule applies across project documentation, skills, workflows and delegated agent briefs. It supersedes wording
that reserves project decisions or approvals to Russell, a named contributor or an "owner". Owner metadata is for
administration and routing, not higher decision-making authority.

## IBM gateway 422 responses

Russell's direction, 6 November 2026: HTTP 422 errors, including messages claiming exhausted credits, can be false.
Ignore them as a reason to stop while the launcher can still work. This overrides the generated scaffolding and
skill instructions to stop on credit errors for this condition.

- Continue authorised work after an agent's 422 response: resume the agent or carry its work forward in the
  available launcher. Keep existing claims and checkpoints; pass this rule to every descendant.
- Stop the run for suspected credit exhaustion only when the launcher itself also gives a full refusal to
  continue the necessary model calls. A child-agent error alone does not meet that condition.
- Preserve the exact error as diagnostic evidence. It does not verify the credit balance or make key rotation
  a prerequisite. Keep the configured gateway and credentials unless a collaborator directs a change.

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
backlog scope with the collaborator directing the work before discussion-driven Jira changes. This takes precedence
over automatic backlog capture. FUCQ-2 remains discovery context. All scaffolding remains on.

Use bounded feature capabilities for backlog items, including changes that span views and services.
Keep the broad demo hills in the brief; Jira's Epic issue type does not determine item size.

Every GCSP role also reads `docs/gcsp/build-rules.md` for full-build scope and the single shared source
for plausible, revisable assumptions. Apply it to stories, implementation and review, and pass it to every child agent.

## GCSP experience quality

Every GCSP role reads `docs/gcsp/experience-quality.md`. Apply its acceptance and visual-review gates to
every change affecting a screen or user-visible behaviour, including code/backend stories. Follow the
agreed visual reference and `COMPONENTS.md`; extend shared components and tokens to preserve consistency.

Before every GCSP spawn, include the experience-contract path, applicable visual reference and relevant
acceptance criteria in the self-contained brief. Require each child to read them and propagate the same
obligations to its descendants. Story authors use the existing `decided`, `acceptance` and `validate`
sections, including Jira-authored stories; reviewers require the corresponding evidence in the result.

## Technical readiness for pickup

Gary's direction, 5 November 2026: assess story pickup from actual technical blockers in the current code and
contracts. Jira `depends_on` links are context, not automatic admission gates; they may describe functional journey
order. A story may proceed independently against an existing agreed interface while its broader journey is unfinished.
Record the concrete interface/code evidence, independent scope, and any integration validation still outstanding.
Completion still requires the story's acceptance evidence; fixtures do not prove an unavailable live integration.
Keep explicit pauses and date holds, source/access limits, claim ownership, conflicting file ownership, and actual
technical blockers. Retain Jira links unless a collaborator separately requests their amendment. See
`docs/gcsp/technical-readiness-2026-11-05.md` and pass this rule to every story lead and descendant.
