# Handover: why FUCQ items were created without an epic (16 November 2026)

## Goal

Find out why so many FUCQ work items were created with no Jira parent, and change the process so every
item is parented when it's created: Stories and Tasks under an Epic, and Bugs linked to their originating
Story and placed under that Story's Epic. Use the `diagnose-and-fix` skill. Trace each gap to the skill,
tool or instruction responsible, and test the fix before saving it.

## What happened today (already done, don't redo it)

- 205 non-epic items in FUCQ had no parent (158 Bugs, 47 Stories and Tasks). All 205 now have one, read
  back from Jira by key. Every Bug also has a native `Relates` link to one originating Story.
- Two Epics were created for groups that fitted nowhere: FUCQ-511 (demo UI and UX polish, home of the
  FUCQ-248 review and its findings) and FUCQ-512 (demo speed, home of the FUCQ-247 review and its findings).
- For about 70 Bugs the origin was recorded as `unresolved` in both Jira and `_dev`. I chose a Story from
  where the Bug was found, its cause and its files. Those links are judgement, not confirmed facts.
- Left alone: FUCQ-76 and FUCQ-407, both rejected test items.
- The local `_dev` records were not edited. Many still say `epic: none` and
  `related_story: unresolved: ...` until the next Jira sync.

## Patterns seen (leads, not conclusions)

1. **Every orphaned item's `_dev` record says `epic: none`.** `_tools/defect_report.py` defaults `epic` to
   `none` (around line 280), and `_tools/jira_sync.py` writes `epic:` from the Jira parent (line 554). Nothing
   seems to require a parent before an item is created.
2. **Bugs with a known origin still got no parent.** About 85 records named their Story in `related_story`,
   or had a Jira `Relates` link, but the Bug had no Epic. Defect intake records the origin, but nothing copies
   that Story's Epic onto the Bug. Read `agent-scaffolding/plugin/skills/defects/SKILL.md` lines 20-31 (the
   "`epic`/Jira parent keeps the established Epic" rule) and check whether any tool acts on it.
3. **84 Bug records say `related_story: unresolved: originating Story not established`.** `bug_origin()` in
   `_tools/jira_sync.py` (around line 518) accepts only a native `Relates` link to a Story. Many Bugs said in
   their description where they were found ("Found while building FUCQ-198"), but no link was ever created.
4. **Bulk intake runs produced whole unparented batches:** the FUCQ-248 review findings and proposals
   (labels `found-in-FUCQ-248`, `review-2026-11-09`), the FUCQ-247 performance findings, the presenter revamp
   stories (`presenter-revamp-20261110`), the 10 November UX revamp proposals (FUCQ-350 to 357), and the
   Java port Bugs (FUCQ-485 to 510, which were linked to a Story but had no parent).
5. Several creators are involved: Gary's poller (labels `agent:claude-code`, `host:garys-macbook-pro`),
   Codex (`agent:codex`), Cowork story authors and direct Jira entry. The fix has to cover every path.

## Where to look first

- `AGENTS.md`, especially "Claimed Story scope" and "Shared dispatcher learnings", and
  `docs/gcsp/dispatcher-learnings.md`.
- Project tools: `_tools/jira_sync.py`, `_tools/defect_report.py`, `_tools/dev_mail.py`, and
  `.claude/scaffolding.json` (it holds the backlog record).
- Shared skills, in the `agent-scaffolding` repo: `plugin/skills/backlog/SKILL.md` and
  `references/jira.md`, `plugin/skills/defects/SKILL.md`, and `plugin/skills/dev-inbox/`. A fix to a shared
  skill belongs in that repo, in a worktree of its own.

## Done means

- Every creation path is named, with the instruction or code that let it skip a parent.
- The agreed fix makes each path set the parent when the item is created (Story or Task to an Epic; Bug to
  a Story link plus that Story's Epic). Where the origin genuinely isn't known, the fix says what happens
  then, instead of leaving the item silently unparented.
- A check (a test, a lint, or a sync-time report) catches unparented items in future, and it has been tested.
