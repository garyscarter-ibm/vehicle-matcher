# FUCQ-95 isolated backend checkpoint

Run: `fucq95-20261105-activity`. Worktree: `.claude/worktrees/DEV-2026-11-04-083`; branch `dev/DEV-2026-11-04-083`. The dispatcher retains integration and shared-seam authority. This checkpoint cannot complete the UI story.

## Scope and plan

1. Add only `server/gcsp/brief/activity.js` and `server/test/gcsp-activity.test.js`, plus this evidence and the story progress/result.
2. Project the trusted employee/current run's latest confirmed brief, permission, real `brief:changes` receipts and actual offer rows. No write or new receipt producer. A mere tick, evaluation, command receipt or storage timestamp never proves a successful search check.
3. Unknown/unimplemented check evidence stays explicit. The present base has no release/allocation/search-check producer. Last successful check, calculated outcomes and actual source delay cannot be invented. Preserve actual offer states and pause effects through existing BriefService.
4. Review the diff and callers, run scoped regression and reviewed boundaries, then commit/push the checkpoint. Request the specific remaining seams from the dispatcher.

## Validation selection

Changed code: new activity module and tests only. Boundaries: repository scoped `query`/persistence; identity trusted employee/current-run guard; DemoClock; BriefService version and pause/resume receipts. First iteration: `node --test server/test/gcsp-activity.test.js`. Final checkpoint: the same regression plus `server/test/gcsp-brief.test.js`, `server/test/gcsp-repository-contract.test.js`, `server/test/gcsp-identity.test.js`, `server/test/gcsp-clock-reset.test.js`, one Node test worker. The selector's strict targeted dry run refused unsupported `language unspecified`, so explicit commands and reviewed ownership are required. No automatic full fallback. No full suite, UI ratchet or browser work in this checkpoint; `npm test` and desktop/375px keyboard state evidence remain required at integration.

Tests distinguish legitimate real data from unsupported inference, check cross-employee/current-run rejection and reopening, ensure no writes, and exercise permission/offer changes through existing services. No second suite is run solely for coverage data. Where supported, capture coverage during the required scoped run.

## Resources and ownership

Shared scratch: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/scratch/fucq95-20261105-activity/`.
External ownership manifest and registered finalizer: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq95-20261105-activity.json` and `fucq95-20261105-activity-supervisor.py`. Each child scratch manifest is also under that shared ownership directory. The supervisor reserves HostBudget, provides TMPDIR/TMP/TEMP, bounds a command to 120s/256MiB scratch/512MiB recursive RSS, stops/joins its owned process group, removes its scratch and releases the reservation in finalizers. Start with one actual test worker. Expected first module <2min, <256MiB scratch, <512MiB recursive RSS; checkpoint actual measurements and replan on resource pressure.

Retained logs/receipts: shared `.claude/test-runs/fucq95-20261105-activity/`; compact identity-keyed impact map under shared `.claude/test-runs/impact/`. Retain concise failure evidence, prune successful verbose logs after summary. Large files/archives, if any, must go directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq95-20261105-activity/`; none expected. No compatibility exception expected. Verify roots, processes and reservations absent before reporting.

## Remaining integration and component plan

Held paths needed later: `server/index.js` for trusted service composition; route registration in the brief HTTP seam or additive activity route file; `blocks/gcsp/activity/*` and the employee navigation entry; shared activityTimeline, relevant kit stylesheet/index, `COMPONENTS.md`, gallery files and `server/test/ui-ratchet.json` together. Existing BriefService, repository, identity and clock files remain read-only in this checkpoint. Existing check/offer/decision producers must be reconciled before choosing their read contract.

UI plan: reuse `portalShell`, `screenIntro`, `button`, `statusScreen`, `factList`, `mediaWell` and the exact decision-card contract. New shared `activityTimeline`, because no listed component presents dated activity. Follow `docs/gcsp/experience-quality.md`, shell reference `docs/gcsp/screens/`, body reference `docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178`, approved Gary 5 November.

Agents: lead requested/selected `gpt-6.1-sol/high`; implementer requested/selected `gpt-6.1-sol/medium`, no fallback. Lead and implementer runtime model/effort confirmed by dispatcher from turn_context. Capacity advisory reported 0, but explicit human override permits measured concurrency; 10.1GB available, swap0, disk67GiB and one implementation child only.
