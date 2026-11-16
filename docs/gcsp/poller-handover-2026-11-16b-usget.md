# Dev poller hand-over, 16 November 2026, evening (Russell's machine, usget)

Scope set by Russell: finish FUCQ-507 first, then pick up the next stories. Capacity limits were ignored at his
request. The run was paused at 19:30 for a machine restart. Nothing new was claimed.

## FUCQ-507 (DEV-2026-11-16-026): paused, claimed by usget, Jira In Progress
- **Branch:** `dev/DEV-2026-11-16-026`, tip `fa5f87d58`, pushed. The story file's "Checkpoint, paused 2026-11-16 (2)"
  section has the detail.
- **Built:** the buddy route (`7e1b85395`), job wiring with RouteReplay as the CDI default (`d8a7a09d9`, merged at
  `aa7503b6e`), the env-gated full-size test (`ed8cf8723`), and the `ReplayConnection` plan fix (`fa5f87d58`). The plan
  fix uses `prepareThreshold=0`, async commit, and ANALYZE every 500 commits. The taken-check dropped from 154 ms to
  0.47 ms. No allocation code was changed.
- **Seed b at full size:** the Java current and buddy records equal the fresh Node records on every field except
  `codeRevision`. Current takes 9.4 s and buddy 913 s.
- **Settled bound:** the oracle is a fresh Node run on the same base. Integer measures must match exactly. Fractional
  measures must match at Node's display rounding, and the per-record allocation and order outcomes must agree. The
  retained `process-only.json` is no longer reproducible for buddy, so it isn't used for buddy.
- **Left:**
  1. Rerun `gcsp.api.comparison.**`.
  2. Run seeds a and c at full size.
  3. Settle the job timeout. A full job is about 46 min, past the 1,800 s policy timeout. Choose between raising the
     timeout through the existing config and making it faster, and keep FUCQ-480's lifecycle unchanged.
  4. Run one end-to-end job through the real HTTP start route.
  5. Merge the base and write the Result block.
- **Ticking ACs:** tick an AC only when the startup composition does it. If a gap remains, use `status: partial`.
- **Evidence:** `.claude/poller/fucq507-evidence/` (5.9 MB, git-ignored) holds the fresh Node records for a, b and c,
  the Java records for b, the scripts and the logs. Scratch and PG clusters have been removed.
- **Resume:** start a fresh story-lead on the same branch with the shared brief `.claude/poller/brief-2026-11-16.md`.
  Use a private PG cluster with a `gcsp_test_dev` database. `LC_ALL` must be set for `pg_ctl`.

## Java merge audit and Jira correction (DL-20261116-RG-002)
- Gary's claim that Java stories were merged incomplete was mostly accurate. See
  `.claude/poller/java-merge-audit-2026-11-16.md` (local).
- At Russell's direction, 24 stories were moved back to In Progress in Jira, each with a comment naming the gap. All 24
  were read back as In Progress.
- Their archived Results are now `status: partial` (`62e9f938e`). The project's `jira_sync.py` keeps partial stories
  In Progress (`0cc8c4a3d`). A push dry run proposes In Progress for all 24.
- Still In Review, and complete: FUCQ-457, 459, 461 and 470.
- Upstream agent-scaffolding: `551291d` (partial status, 0.7.8) and `ed08678` (backfire-check rule, 0.7.9). Russell
  still needs to run the staged `sudo .../tools/apply.sh` and `tools/pin-marketplace`, because Desktop's pin is still
  0.7.7.

## Next, in order, unclaimed
FUCQ-437 (DEV-2026-11-13-005), FUCQ-481 (DEV-2026-11-13-049, needs 507), then FUCQ-438 (DEV-2026-11-13-006) and
FUCQ-482 (DEV-2026-11-13-050). `queue` lists six Bugs from today's Jira import ahead of these. Russell hasn't said
whether they go first.

## Notes
- **Jira pull (Pinky, about 14:40):** 25 imported and 25 updated. 18 "missing headings" comments were posted, FUCQ-508
  among them. 13 Bug screenshots were not downloaded, because the download tool isn't available here.
- **FUCQ-507 `jira_changed` line:** this is a false positive. The Jira description lacks the sections that were filled
  in locally, and no edit was made in Jira after the claim.
- **Agent naming:** a SendMessage to the implementer Goopy-Geer reached Barney McGrew instead. The names were reused
  across resumes.
