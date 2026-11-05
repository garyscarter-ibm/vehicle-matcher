# Presenter controls backend scope and impact

Base: `a083e28609172a83bbe3d8de31feec48a183f909`, 5 November 2026.

The existing clock, identity and named-scenario HTTP contracts permit this independent slice.
It adds presenter-only configuration and composed advance/tick routes. The canonical policy step
is a dated, explicitly assumed one-minute value. Real release producers and journey preparation
remain unavailable and cannot be proved by synthetic handler results.

Changed paths and selected checks:

| Paths / functions | Scoped proof and boundary |
| --- | --- |
| presenter-controls commands/service/http; server registration | `gcsp-presenter-controls.test.js`: configured readback, safe principals, guards, modes, duplicate/reopening replay, lost advance/tick responses, pending/refused/missing-handler states |
| clock controls/advanceAndTick/interruption; fixture config | `gcsp-clock-reset.test.js`: existing advance/tick/reset/stale/startup and durable handler behavior |
| identity readPresenterPrincipals | `gcsp-identity.test.js`: existing cookies, role/context ownership and issuance conflict |
| canonical seed / scenario fixture | `gcsp-scenarios.test.js`: current catalogue, missing-capability refusal, reset selection/version and trusted preparation |

`test_stamp.py --affected <base> --dry-run` reports no affected plugin for this unspecified
language and proposes `npm test`. That fallback is not executed: the parent owns the serial
full-suite lane. These explicit scoped modules cover the actual changed callers and boundaries.
No dependency installation, browser, live PostgreSQL, external sending or BMW source calls are allocated.
The parent authorised exact read-only adoption of the existing matching `pg` dependency tree;
the ownership receipt records the worktree symlink for final removal.
No full-suite or whole-story-built claim is made.

## Clock interruption diagnosis

Related existing origin: FUCQ-85 / DEV-2026-11-04-055, confirmed by its archived Story, DemoClock implementation
and shared-contracts clock binding. Feature acceptance FUCQ-126 requires truthful refused reasons.
Reproduction: register a release-pull handler returning a typed `forbidden` reason, then tick.
Cause: `DemoClock.#interrupted` overwrote that outcome with generic unavailable in `tick_runs`
and returned only a generic retry message. Correct handler input/response is established by
the injected real registry path; this is independent of unavailable business producers.
Affected writer/readers: interrupted clock ticks, clock readState and the new presenter projection.
No existing saved row is rewritten; earlier generic historical outcomes remain generic.
Small correction: persist the actual handler outcome and expose it additively as `handlerOutcome`,
retaining top-level unavailable/retry semantics. Regression proof is the typed-refusal/readback
case in the new scoped test. No screenshot was supplied or needed for this backend-only fault.
The parent read the defects skill and confirmed this narrow repair scope; no new Jira write.

## Resources

Each named module runs separately with a fresh HostBudget reservation and supervisor finalizer:
120 seconds, 768 MiB RSS, 128 MiB scratch, 2 MiB logs and one Node test-file worker. The helper's
owned `/private/tmp/test-stamp-shard-*` scratch root is used for macOS IPC compatibility; ownership
manifests and receipts remain outside scratch in `.claude/test-runs/fucq126-backend-20261105/`.
All database URL aliases and PG connection variables are removed before child launch. No secret
file is read. V8 function contexts are collected in the same test execution, compacted into
impact evidence, then removed with owned scratch. Successful verbose logs are removed; useful
failure logs remain bounded. The unavailable OneDrive destination is unnecessary for these small
allocations, all below 256 MiB. Exact per-chunk cleanup appears in the JSON receipts.

## Presenter policy compatibility correction

Diagnosis (5 November 2026): the first presenter checkpoint added its new step prerequisite to
`loadClockConfiguration`, an existing core clock reader. An older immutable policy snapshot lacks
that key, so this accidentally prevented core runtime bootstrap and existing clock operations.
The shared clock still has all three of its original assumptions. Validation now belongs only to
`readPresenterClockConfiguration`; missing/invalid step returns `presenter-step-unavailable`.
Regression exercises runtime initialization, control refusal, clock read and actual advance with
missing, zero, negative, fractional and string values. Presenter 8, clock 18 and scenario 10 checks
pass after the correction. Stored policy adoption remains an integration gate documented in the
contract; no existing snapshot is rewritten and no released integration lane is touched.
