# Migration and performance poller coordination

Gary confirmed on 13 November 2026 that Russ's poller is running too and instructed the pollers to share the load. This record coordinates the existing 66-Story run; it adds no scope or acceptance. Current claims and remote leases govern actual pickup. Jira writes resumed under `AGENTS.md`; other collaborators' live claims and Story-specific holds remain binding.

## Shared integration boundary

All four Epics, FUCQ-408/431/432/433, integrate into **`gcsp-poc-dev`**. GC verified that claim, worktree, merge, push and Jira helpers resolve the configured base, then pushed the dev-only `base_branch` change in `ff7ad0c4e`. Automatic merging remains enabled. Each poller must verify its own clone's actual helper target before claiming. Neither poller merges or pushes this run into `gcsp-poc`, `main` or the running deployment. Gary reviews the completed hosted dev build and performs the final merge. The dev-only helper setting needs explicit restoration in that handover.

The product source at kickoff is `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. Claim and configuration commits are later coordination metadata. GC owns FUCQ-434 / `DEV-2026-11-13-GC-001`, claimed at `ef21d7cb51b89293afc701784583e37e28cbbc0f`; Woody is preparing the inventory, canonical HLD reconciliation and replacement contracts. No Angular or Java application work is part of that claim.

## Proposed delivery split

This proposal was sent to Russ's poller in FUCQ-434 comment `3629351`. Its acknowledgement and any adjustment must be recorded before treating the split as agreed; it does not assign or claim work for another member.

| Lane | Proposed poller | First contract and ownership boundary |
| --- | --- | --- |
| Angular and frontend Buddy journey | GC | FUCQ-439 in `apps/gcsp-web/`, then sign-in/account, preferences/activity/offer and order/status views against the Java contracts. |
| Java and backend Buddy journey | Russ | FUCQ-454 in `services/gcsp-api/`, early FUCQ-456 persistence design, then actual identity/account, matching, mail, owned decisions and ordering. |
| Native Node performance | Both | Divide FUCQ-409–425 by actual source files, interfaces and live leases. Record the baseline revision used by Java parity checks. |
| Shared build, composition and deployment | GC initially | One writer for `render.gcsp.yaml`, root package/build files, `scripts/assemble-site.mjs`, launcher/shared kit and machine-readable API schema. Transfer named files explicitly before another writer changes them. |

FUCQ-434's replacement contract establishes the initial authenticated `/api/gcsp/v1/context` boundary and route-family mapping. Foundations may proceed against a published relevant contract without waiting for prose polish or completion of all Node performance work. Real OIDC, browser/API and hosted checks remain the respective Stories' acceptance obligations.

## Operating rules

- Before pickup, fetch native current description/status/ownership, pull the dev integration branch and inspect leases. Import leases prevent duplicate Jira intake; Story leases prevent duplicate implementation. Never alter another member's claim, Result, status, branch or lease.
- Keep frontend, backend and performance work in parallel only where contracts, files and current host capacity permit. Run scaffold capacity/tier checks before every spawn, use its exact model and effort and preserve shared-file ownership. Shared integration merges and full suites stay serialized. Coordinate an integration window in this record or Jira before either poller starts one.
- Keep persistence design early and prioritize sign-in/account → Buddy matching → actual test email → signed-in employee-owned acceptance → order/status. PostgreSQL transactions, competing instances, replay, uncertain outcomes/restart and isolated reset require native evidence.
- All 17 performance Stories retain their original Node acceptance and eight-point cap. Preserve chains 417→418, 419→420, 422→423 and 422+423→424; 421 and 425 are independent of that mutation chain. Java implementation does not close Node obligations. Preserve the Node runtime paths needed to validate them before retirement.
- Continue without interim human checkpoints. Each poller commits/pushes coherent validated increments, reports actual failed/skipped/unrun checks and keeps accepted scope fixed. Follow `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `COMPONENTS.md` and technical-readiness guidance. Lower-than-High defects become linked backlog Bugs; Critical/High require resolution or explicit collaborator deferral. In Review means developed, never inferred acceptance or Done.
- Both collaborators have equal authority. Preserve the configured IBM gateway and continue after a child-only false HTTP 422 while the launcher can work. Apply the project resource/output/cleanup duties at every descendant level. Local polling schedules and personal coordination state stay local.

## Latest observed coordination

At initial publication, GC had FUCQ-434 active and the full 66-Story native intake underway. The split above awaited Russ's poller's response. No Java application files were claimed by GC, and no new work or acceptance was attributed to Russ from Gary's notification alone.
