# Hand-over: epic FUCQ-358 run, final, 11 November 2026

Written by the resume dispatcher (session ae5e311a, started from local_d672ebbd at 10:48 GMT). It replaces the 12:50
checkpoint `docs/HANDOVER-2026-11-11-EPIC358-RESUME.md` and follows `docs/HANDOVER-2026-11-11-EPIC358-CUTOFF.md`. For
the goal and decisions, read `docs/HANDOVER-2026-11-10-EPIC358-POLLER.md`.

## Where it stands
- All six epic stories are merged into `gcsp-poc`, closed, and In Review in Jira. None is set to Done. The run is stopped.
- FUCQ-371 was merged at 17:38 GMT on Russell's instruction ("just merge it"), with AC7, AC8 and AC10 partly met. See its row and FUCQ-399.
- Russell's verdict on the day: far too slow, with complexity and testing well beyond what these stories needed. He thinks the launch session's Extra effort setting contributed. A successor should cut ceremony hard: fewer re-captures and critiques, no repeated full suites, and merge as soon as the ACs are met.

## Russell's instructions this session
- 10:48 GMT: he resumed the run by starting this session. The top of the directive is ACTIVE, recorded at 10:55Z.
- 11:05 GMT: "check every couple of minutes on stanley tiger. I want to start 370 and 371 asap".
- 11:06 GMT: "you have permission to ignore capacity limits in this session". One full suite at a time still applies.
- About 14:20 GMT: "Pick one buddy indicator or the other, not both. Say sorry from GC and me, we both did the same
  work." It was relayed word for word to Edna. FUCQ-370 kept one indicator; see its row below.
- 15:57 GMT: "push as hard as you can, this has taken ALL DAY to do a small number of stories." FUCQ-371's slice 4
  started straight from FUCQ-370's built branch, without waiting for it to merge.

## The epic

| Story | Jira | Points | Merged | Closed | Jira status |
| --- | --- | --- | --- | --- | --- |
| DEV-2026-11-10-GC-036, Account layout | FUCQ-359 | 8 | b3341032 | db596e21, cleanup 784df762 | In Review |
| DEV-2026-11-10-010, compact preferences | FUCQ-368 | 13 | 2b025aa8 | d69d48c5, cleanup ec94ece2 | In Review |
| DEV-2026-11-10-009, star rating | FUCQ-367 | 8 | eff70d42 | bac7cd68, cleanup baeb946b | In Review |
| DEV-2026-11-10-011, Same again and Buddy understanding | FUCQ-369 | 8 | 8cc2c123 | 7ec2bf48 and 30854454, cleanup 450d8878 | In Review, comment 3628805 |
| DEV-2026-11-10-012, Engage Buddy | FUCQ-370 | 13 | 59920edc | c169466d and dfb2d358, cleanup 6f496149 | In Review, comment 3628869 |
| DEV-2026-11-10-013, feedback-aware recommendations | FUCQ-371 | 13 | 0c783261 | bd433bab and b092c246, cleanup 92838a36 | In Review, comment 3628876 |

### FUCQ-370, story-lead Edna
- **What it does.**
  - Engage and Disengage run through the existing search/hold consent, and success shows only after authoritative
    readback.
  - The server gate is three considered categories or Same again.
  - A minimum-loss edit disengages in the same save.
- **One indicator** (Russell, about 14:20).
  - Gary's FUCQ-389 (2cca8930, merged fd395ec1 at 13:57) had added a `kit/buddy-status` with the same file names.
  - Edna kept the FUCQ-370 lamp as the prominent variant of Gary's `buddyStatus` (718053eb).
  - Gary's compact Your cars Buddy link and Account's activity read were removed, and 4 of his Account assertions
    rewritten.
  - His Buddy activity header (dot plus named Pause search / Resume search) is unchanged.
- **Tests.**
  - My scoped rerun on the merged tree b06ed2f4: 581 tests, 577 pass. All 4 failures also fail on base cb445745:
    `gcsp-brief` retained fixtures, the 2 FUCQ-387 presenter caps, and `gcsp-live-regions` "pending offer stays
    quiet". I proved the last one on a detached cb445745 worktree.
  - One full suite at a84865a0: 5019 tests, 4959 pass, 17 fail. 16 of those also fail on base 770538da, and the 17th
    (`launcher-employee-entry`) was fixed after the run.
- **Evidence.** Capture 707/707 checks; walkthrough 32/32 steps; Opus critique and a re-critique after the merge into
  one indicator. Images: OneDrive `_agent-output/fucq370-2026-11-11/`. I inspected `1440-selected`, `375-engaged`
  and `1440-validation` against 193cbf07 myself.

### FUCQ-371, story-lead Mr Troop
- **What it does.**
  - Adds the `employee.currentCarFeedback.v1` policy: 4-5 positive, 1-2 negative, 3 or unset neutral.
  - Similarity is the same model line, body and fuel. A positive rating offers only similar cars or a proven improvement.
  - Gates come first, then Same again, then the rating.
  - The real consumers get the saved feedback and the server-resolved baseline. The Offer explains the result.
  - Paula's baseline now has `sizeClass` and `tags`, sourced from `demo-provider.js:27-28` (5a504b53).
- **Tests on 5a504b53:** 10 files, 285 tests, all pass. No full suite was run.
- **Evidence.**
  - Account strict capture on the integrated tree: 707/707.
  - Six-story Opus critique by Cool Cat.
  - OneDrive `_agent-output/fucq371-2026-11-11/`.
- **Partial.**
  - AC8: no positive offer was shown on real services. The evaluator does prove Body Hatchback (high), Petrol and Comfort an improvement on the F70 120, X1 and X2.
  - AC7 and AC10: the Offer reason is not yet seen on the live FUCQ-383 layout.
- **Russell's decision, 17:21:** "Keep strict, file a Bug". Filed as FUCQ-399, High.

## For Russell
- **FUCQ-370, needs a decision.** Pause/Resume and Engage/Disengage act on the same Buddy record. Engage Buddy on a
  paused Buddy unpauses it, which is a second way to Resume, and no test covers it. Should Engage be refused while
  paused, or should it say that it resumes?
- **FUCQ-370, for Gary.** Russell's one-indicator decision partly reverses Gary's approved FUCQ-389 Option A on Account.
  His compact link is gone; his Activity controls stay. The reason and the rewritten assertions are in the FUCQ-370
  Result.
- **FUCQ-369.** Should "No Motorcycle Choices orders." come back?
- **FUCQ-371.** Check that a positive rating hides cars that are neither similar nor a proven improvement.
- **Proposed Low Bugs** (not filed): at 320px the Offer header truncates "Paula …". The FUCQ-387 presenter CSS caps
  are already Gary's FUCQ-387. From the six-story critique: the FUCQ-359 "YOUR CARS" heading is smaller than the reference; the empty-history line is missing; FUCQ-368 and 369 have minor evidence gaps; and the negative-rating behaviour is a product question. **Filed:** FUCQ-399 (High), generated stock lacks `zeroTo62` and `mpg`, related to FUCQ-371, for the stock owners (Gary, Codex FUCQ-384).
- **Questions still open from earlier stories** (on their tickets):
  - FUCQ-359: the four-icon rail, Registration "Not supplied", and the doubled "320i".
  - FUCQ-367: no visible cue while a rating is pending.

## Leftovers and resources
- Worktrees: none left for FUCQ-369 or FUCQ-370, since drop-branch removed both. FUCQ-371's worktree was dropped too.
- The `.claude/dev-poller-20261110-claude/` receipts are kept (lead briefs, scoped and full-suite logs).
- Archived cleanups DEV-2026-11-04-035 and -036 are still `cleanup: pending`: the helper refuses their dirty worktrees.
- `jira_sync.py push --json` lists only Gary's operations, which his own poller pushes.

## A successor reads first
1. This file.
2. `docs/HANDOVER-2026-11-10-EPIC358-POLLER.md`.
3. The top of `.claude/dev-poller-directive.md`.
4. `_dev/done/2026-11/DEV-2026-11-10-01{1,2,3}.md`, the Result blocks.
5. The shared notes log `epic358-resume-log.md` in the local_d672ebbd side-session notes folder.
