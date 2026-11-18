# Why FUCQ items were created without a parent (diagnosis, 16 November 2026)

Follows the [handover](epic-parenting-handover-2026-11-16.md). No Jira item was edited by this work: the evidence is
read-only Jira searches (all 469 non-Epic FUCQ items, with reporter, created date, labels and parent), the local
`_dev` records, git history and the publication receipts in `docs/gcsp/`.

## The numbers

180 of the 205 items have a local `_dev` record, and every one of them says `epic: none`. The other 25 were never
imported. Of the 180, 153 were reported by Gary (all on 7–11 Nov), 27 by Russell. Every orphan was created between
7 and 14 November. The 3–6 November items (126, created through the backlog and publication flows) all had parents.

| Creation path | Orphans (of 180) | What let it skip the parent | Kind |
|---|---|---|---|
| Gary's poller (`agent:claude-code`, `host:garys-macbook-pro`): Bugs found while building, the FUCQ-247/248 review findings, the 10 Nov UX and presenter revamp Stories | 121 Bugs, 32 Stories | No rule said to set one. The `defects` skill said "`epic`/Jira parent keeps the established Epic", which describes, rather than directs. Its Jira create step listed every field but `parent`. The backlog skill only covered creating Epics, so nothing covered Stories or Tasks. | Missing / ambiguous rule |
| Russell's poller (Claude Code, 13–14 Nov): FUCQ-483 to 510 | 11 Bugs, 1 Story | Same gap. The handover records each Bug as "filed and linked Relates": the origin link was made and the parent was not, because "parent remains the Epic" read as "leave it alone". | Ambiguous rule |
| Codex defect batch, 7 Nov: FUCQ-156 to 166 | 11 Bugs | The payload asked for `parent: FUCQ-20`, but the Bugs had none until today's clean-up. The receipt's read-back checked type, status, priority and links, not the parent, so the miss went unseen. The exact cause of the dropped parent isn't recoverable. | One-off slip, plus a missing read-back check |
| Bulk review intake (the 9 Nov review tickets, the 10 Nov revamps) | inside the poller numbers above | The batch plans had no `parent` column. The 10 Nov review-meeting publication and the 13 Nov Java migration publication had one, and checked it on read-back, and every item they created is parented. The difference was the author's own plan, not a shared rule. | Missing rule |
| Cowork story authors | 0 seen | `dev-inbox/references/cowork.md` allowed "A one-off fix can stay `epic: none`", with no Jira-mode exception. Latent. | Wrong rule for Jira mode |
| `_tools/defect_report.py` | 0 | It refuses to create anything in a Jira project, so it made none of these. In file mode it defaulted `epic` to `none` even when the origin Story it checks has an Epic. Latent. | Missing rule |
| Direct Jira entry | 0 open (FUCQ-407 is a rejected test) | Jira itself doesn't require a parent. `jira_sync.py pull` imported any unparented item as `epic: none` without comment, so no check ever reported it. | No check |

**Why Bugs with a known origin still had no Epic:** nothing copied the origin Story's Epic onto the Bug. A second
fault: `bug_origin()` in `jira_sync.py` rejected a Related story heading written as prose ("FUCQ-59; established Epic
FUCQ-20"), so 21 Bugs that had both the heading and the native link were read as `unresolved` origin.

**Why 84 Bug records said `unresolved: originating Story not established`:** the Bug named its Story in prose ("Found
while building FUCQ-198"), but nobody made the native link, and the importer accepts only the link. That rule is
deliberate: the origin needs confirming. What was missing was a rule for where an unconfirmed Bug sits meanwhile.

## The fix

All of it is in `agent-scaffolding` (branch `fix/jira-parenting`). The project copy of `jira_sync.py` carries the same
change on this branch, keeping its own `ui:` fix.

1. **Every item is parented when it's created.** The backlog skill's Jira reference gains "Every other item needs a
   parent", for any route: a skill, a bulk script, review findings, poller leftovers or a hand-made item. A batch
   payload names each item's `parent`, and its read-back checks it.
2. **Bugs:** the `defects` skill now says the parent is the origin Story's Epic. The Jira create step passes `parent`,
   linking the origin moves a parked Bug to that Story's Epic, and the read-back checks the parent.
3. **Origin genuinely unknown:** the Bug goes under the Epic of the Story or work it was found in, labelled
   `origin-unknown`. Failing that, it goes under the record's `backlog.triage_epic`, when set. It is never created
   unparented. FUCQ sets no `triage_epic` (Russell, 16 Nov), so here such a Bug is reported for a person to place.
   The audit lists such Bugs as `origin_unknown` (tracked, not a failure), and when a native link is
   added later it moves them to the right Epic.
4. **Cowork:** `epic: none` is allowed for a one-off fix in file mode only.
5. **`defect_report.py` 1.1.0:** a file-mode Bug inherits its origin Story's `epic` unless one is given.
6. **The check, `jira_sync.py` 1.4.0:**
   - `jql` now prints an `audit` query: unparented non-Epics, plus open Bugs.
   - `pull` reports an `unparented` list on every pass.
   - `audit --issues FILE [--origins FILE] [--check]` reports `needs_epic`, `parent_mismatch` and `set_parent`. Each
     `set_parent` is a parent derived from the origin Story, which the poller may apply. Exit 1 unless clean.
   - The code poller runs the audit when `unparented` is non-empty, and at least daily.
   - `bug_origin()` now reads an origin named in prose when it names a single key, or a single native-linked key.

## Evidence that the check works

- **On today's FUCQ** (the audit query, 215 items over 3 pages): 206 checked, clean, exit 0. 21 Bugs are
  `origin_unknown` but parented. 9 are exempt (rejected or wont-do).
- **On the state before the clean-up:** I removed the parents the clean-up added, then ran the check. It exits 1 and
  flags 177 of the 180 orphans. The other three (FUCQ-250, 274, 306) are rejected or wont-do, which the check exempts.
  It proposes 133 `set_parent` ops, and all 133 match the parent the clean-up chose by hand. 45 go to a person as
  `needs_epic`: 31 Stories, 12 Bugs whose origin Story itself had no Epic, and 2 with no usable origin.
- **Tests:** 13 new tests in `tests/test_jira_sync.py` and 1 in `tests/test_defect_report.py` (agent-scaffolding).
  The full `test_jira_sync.py` ran 160 tests, 158 passing; the two failures expected the old version and an empty
  pull report, and those tests are updated. After the update, the parenting, defect, version and done-story tests
  pass (scoped run). `test_defect_report.py` passed 21/21, `test_inbox_setup.py`, `test_poller_references.py`,
  `test_backlog_skill.py` and `test_plugin_layout.py` passed, and so did the project's `test_jira_sync_ui.py` (7/7).
  The scaffolding full suite was not run.

## Decisions (16 November 2026)

- Russell approved the fixes.
- FUCQ has no `triage_epic`: a Bug with no origin and no found-in Story is reported (`needs_epic`) for a person to
  place, never parked automatically.

## Open

- The local `_dev` records still say `epic: none` until the next `jira_sync.py pull` rewrites them from Jira.
