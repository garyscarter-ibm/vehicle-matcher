# FUCQ-79 · GCSP foundation stories

**Published and verified on 4 November 2026.** Six native Jira Stories, FUCQ-80 to FUCQ-85, sit under [FUCQ-79](https://ibm-consulting.atlassian.net/browse/FUCQ-79), "Run GCSP transactions, policy and demo control on a shared foundation".
- All six are To Do and unassigned, at High (P2, `due 2026-11-12: GCSP demo`). No Story Points were authored.
- FUCQ-79 is In Progress under the backlog procedure, with Start date 2026-11-04.
- [Publication verification](evidence/fucq-79/story-publication.json) records the native read-back.

Gary approved the Epic, the Story titles and the dependency order on 4 November 2026, under the equal-authority rule (`AGENTS.md`). That approval covered three structural choices:
- PolicyService is split into a read story (FUCQ-82) and a dated-tables story (FUCQ-83), so FUCQ-29 can start before PostgreSQL exists.
- FUCQ-85 waits on FUCQ-84, because reset needs the presenter role and run scope.
- FUCQ-65 waits on FUCQ-84, so manual context uses the shared `DemoIdentityAdapter` instead of a resolver of its own.

Source of the scope: [section C handover](../design/handover-section-c-2026-11-04.md) and [HLD story readiness](../design/hld-story-readiness-2026-11-04.md), section C1. Template: [_dev/story-template.md](../../_dev/story-template.md). Only stories were authored: no implementation, poller, provisioning or deployment was started.

| Story | Outcome | Kind, size | Depends on |
|---|---|---|---|
| [FUCQ-80](https://ibm-consulting.atlassian.net/browse/FUCQ-80) | Record the shared GCSP contracts that parallel stories build on | docs, S | none |
| [FUCQ-81](https://ibm-consulting.atlassian.net/browse/FUCQ-81) | Store GCSP transactions in managed PostgreSQL behind a repository port | code, L | FUCQ-80 |
| [FUCQ-82](https://ibm-consulting.atlassian.net/browse/FUCQ-82) | Read every GCSP rule and assumption through one PolicyService | code, M | FUCQ-80 |
| [FUCQ-83](https://ibm-consulting.atlassian.net/browse/FUCQ-83) | Publish dated policy versions to PostgreSQL tables | code, M | FUCQ-81, FUCQ-82 |
| [FUCQ-84](https://ibm-consulting.atlassian.net/browse/FUCQ-84) | Resolve demo employees, Greg and the presenter with server-owned run scope | code, M | FUCQ-81 |
| [FUCQ-85](https://ibm-consulting.atlassian.net/browse/FUCQ-85) | Drive demo time with presenter ticks and reset a run cleanly | code, M | FUCQ-81, FUCQ-84 |

**Order:**
1. FUCQ-80.
2. FUCQ-81 and FUCQ-82, in parallel.
3. FUCQ-83 and FUCQ-84, in parallel.
4. FUCQ-85.

**Existing Stories re-pointed to the foundation.** Each change is a native Blocks link plus an edit to the Story's description: its `depends_on`, and a "Foundation, 4 November 2026" paragraph in Decided.

| Story | Now also depends on | What changed |
|---|---|---|
| [FUCQ-29](https://ibm-consulting.atlassian.net/browse/FUCQ-29) | FUCQ-82 | Policy reads go through FUCQ-82's `PolicyService`, with no separate fixture loader |
| [FUCQ-65](https://ibm-consulting.atlassian.net/browse/FUCQ-65) | FUCQ-84 | Principal and run come from `DemoIdentityAdapter`; contract tests use FUCQ-81's in-memory double |
| [FUCQ-66](https://ibm-consulting.atlassian.net/browse/FUCQ-66) | FUCQ-81, FUCQ-85 | The manual claim slice is built on FUCQ-81's repository, not a repository of its own. Expiry is a tick handler on FUCQ-85's clock |

**Shared decisions.** Every Story's Decided section cites:
- `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md` and `experience-quality.md`;
- the relevant `docs/design/gcsp-high-level-design.md` sections;
- the HLD review decisions it relies on (`docs/design/hld-review-gc.md`: Q2, Q3, Q4, Q6, Q13, Q15, Q16, Q19, and the round-1 to round-3 findings).

All six Stories are backend or docs. Each Validate section says why there are no screenshots, and names the response-shape fixtures that consuming UI stories need.

**Still open, not part of this set:**
- Four stale Blocks links still need deleting in the Jira UI: FUCQ-27→29, FUCQ-28→29, FUCQ-28→30 and FUCQ-28→31. The connector cannot delete links.
- Gary is to provision the GCSP Render Postgres. FUCQ-81 and FUCQ-83 skip their PostgreSQL runs, and report them as skipped, until `GCSP_DATABASE_URL` is set.
- The critical-path Epics C2–C6 are not yet authored.

The Story bodies below are the Jira descriptions as read back, with `id` and `title` added to each header. The only other changes are the bullet marker and escaped checkboxes, which are normalised.

---

### [FUCQ-80](https://ibm-consulting.atlassian.net/browse/FUCQ-80) · Record the shared GCSP contracts that parallel stories build on

```text
id: FUCQ-80
title: Record the shared GCSP contracts that parallel stories build on
kind: docs
design_impact: no
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: none
```

#### Goal

As an implementer of a parallel GCSP story, I want the shared schemas, state machines and port interfaces written down once, so that my story and its neighbours agree without each inventing their own.

#### Acceptance criteria

- [ ] `docs/gcsp/shared-contracts.md` exists, carries a contract version and date, and is linked from `docs/gcsp/README.md` and from the "Transaction and event invariants" section of `docs/design/gcsp-high-level-design.md`.
- [ ] **Brief schema:** versioned fields for preference slider values and their separate importance weights, essentials, buddy on/off and pause, and the single post-decline preference change (Q16). Mark which fields are confirmed and which are draft or inferred.
- [ ] **Offer and hold state machine:** covers both hold types (the manual cart hold of about two minutes and the buddy offer hold of about two hours, Q15). It names every state and transition, including pending for an uncertain remote operation, who may trigger each one, and which transitions a presenter tick can cause. Post-selection states are referenced by the target platform's names (Q19), not redefined.
- [ ] **Policy key catalogue:** a naming convention (for example `hold.cart.durationSeconds`) and every key the foundation seeds, each with its unit, assumed or verified status and basis.
- [ ] **Repository schema:**

    - the table list with keys and the `runId` scoping rule on every mutable row;
    - `orderUuid` as the exact-stock key, with the 7-digit `orderNumber` and the target-format `configurationId`;
    - the idempotency keys for the outbox and for event receipts;
    - the migration naming and additive-only rule.

- [ ] **Port interfaces:** `TransactionRepository`, `PolicyService`, `DemoIdentityAdapter` and `DemoClock`, each with method names, inputs and outcomes. Outcomes include unavailable, conflict, stale version and pending.
- [ ] **Ownership:** a table naming which story implements each part: the stories under FUCQ-79, FUCQ-66 (manual claims), FUCQ-29 (employee policy reads) and FUCQ-65 (manual context). It also says how later stories extend the contracts: an additive change plus an entry in this file.

#### Files or areas

- `docs/gcsp/shared-contracts.md (new)`
- `docs/gcsp/README.md`
- `docs/design/gcsp-high-level-design.md (link only)`

#### Decided

Gary approved this foundation on 4 November 2026 (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`; `docs/design/hld-story-readiness-2026-11-04.md`, section C1, "one owner for the shared contracts"). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` and `docs/design/gcsp-high-level-design.md`: Responsibilities, Demo access and offer links, Transaction and event invariants, and Technical deployment. Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q2, Q4: managed PostgreSQL behind the repository port, with `pg` as the one runtime dependency.
- Q3: presenter ticks only.
- Q6: dated policy tables shaped like the target model, seeded from a reviewed repo file and read through one PolicyService.
- Q13: stock keyed by synthetic `orderUuid`; VIN only on delivered cars.
- Q15: two hold types.
- Q16: a single preference change after a decline.
- Q19: target lifecycle names.

This is the docs-kind contracts story the readiness review asked for. It writes the shapes the other foundation stories implement. It does not decide new behaviour: where the HLD is silent, it records a keyed assumption and says so.

#### Out of scope

Application code; details of C2–C6 beyond the shapes they share; changing any HLD review decision.

#### Validate

- Read-through by the claiming session: every table named in FUCQ-81's acceptance and every key named in FUCQ-82's acceptance appears in `docs/gcsp/shared-contracts.md`. Every relative link in it resolves.
- `npm test` passes; no code changed.
- No screen or user-visible behaviour changes, so no visual checks apply (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-81](https://ibm-consulting.atlassian.net/browse/FUCQ-81) · Store GCSP transactions in managed PostgreSQL behind a repository port

```text
id: FUCQ-81
title: Store GCSP transactions in managed PostgreSQL behind a repository port
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-80
preconditions: none for building. Integration completion needs the GCSP Render Postgres instance and its connection string, which Gary provisions; this story does not provision anything.
```

#### Goal

As every GCSP journey, I want one durable, transactional store for briefs, stock, holds, offers and the outbox, so that state survives a restart and two people can never hold the same car.

#### Acceptance criteria

- [ ] **Repository port:** a `TransactionRepository` with the interface recorded in `docs/gcsp/shared-contracts.md` (FUCQ-80) and two implementations:

    - a PostgreSQL adapter using `pg`, configured from a backend-only `GCSP_DATABASE_URL`;
    - an in-memory test double with the same semantics, including transactions and conditional writes.

    The connection string and other secrets never reach the browser or the logs.

- [ ] **Migrations:** a migration runner applies numbered, additive SQL migrations idempotently and records the applied versions. The first migration creates tables for:

    - runs; employees and their entitlement slots; versioned briefs;
    - exact stock keyed by `orderUuid`, carrying `orderNumber` and `configurationId`;
    - holds and claims, with the hold type, holder, expiry timestamp and pinned policy version;
    - offers; decisions; pending operations; event receipts; the notification outbox; forecast and plan snapshots.

    Every mutable row carries `runId`.

- [ ] **Exclusive holds:** a database constraint enforces at most one active hold per exact car per run. A conditional claim returns success, conflict or stale-version, never a silent second holder. Hold + offer + outbox job commit in one transaction (HLD invariant), and a failure rolls all three back.
- [ ] **Idempotency:** idempotency keys on outbox jobs and event receipts make replayed commands return the original outcome.
- [ ] **Clear outcomes:** an unavailable database returns `unavailable` to callers and never a fake success. Startup reports whether migrations are current.
- [ ] **Contract tests:** one suite runs against both the in-memory double and PostgreSQL. It proves persistence across repository reopen, rollback, concurrent claim uniqueness, idempotent replay and run isolation. The PostgreSQL run is skipped, and reported as skipped, only when `GCSP_DATABASE_URL` is unset.
- [ ] **Dependency:** `pg` is added as the only runtime dependency, in `server/package.json` with a lockfile entry. The retail routes and the existing test suite are unaffected when `GCSP_DATABASE_URL` is unset.

#### Files or areas

- `server/gcsp/repository/ (proposed: port, pg adapter, memory adapter)`
- `server/gcsp/migrations/ (proposed)`
- `server/package.json`, `server/package-lock.json`
- `server/test/gcsp-repository-contract.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this foundation on 4 November 2026 (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: Responsibilities, "Durable transaction repository" and Transaction and event invariants. Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q2: managed PostgreSQL, with synthetic data only.
- Q4: `pg` is the one permitted runtime dependency; anything else needs Gary's approval.
- Q13: exact stock keyed by synthetic `orderUuid`; stock has no VIN.
- Q15: two hold types share one authority.
- Round-1 finding: saving turns a hold into an allocation of the existing stock order in one transaction.

This story owns the shared repository. FUCQ-66 consumes it for the manual claim slice rather than building its own, and the buddy and offer Epics consume the same tables. Schema changes stay additive until recovery is proved (HLD, Technical deployment).

#### Out of scope

Provisioning Render Postgres; the claim and expiry business rules (FUCQ-66, buddy allocation); PolicyService (FUCQ-82, FUCQ-83); identity (FUCQ-84); ticks and reset (FUCQ-85); mail transport.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-repository-contract.test.js`: passes against the in-memory double. With `GCSP_DATABASE_URL` set to a local or provisioned PostgreSQL, it passes there too. The output says which providers ran.
- `npm test` passes with `GCSP_DATABASE_URL` unset. Retail API behaviour is unchanged.
- `cd server && npm ls --omit=dev` lists `pg` as the only runtime dependency.
- Backend-only: no new screen. Record the unavailable, conflict and stale-version response shapes in the test fixtures for the consuming UI stories (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-82](https://ibm-consulting.atlassian.net/browse/FUCQ-82) · Read every GCSP rule and assumption through one PolicyService

```text
id: FUCQ-82
title: Read every GCSP rule and assumption through one PolicyService
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-80
```

#### Goal

As any GCSP consumer (the employee policy, the manual and buddy journeys, Greg's views, generators and tests), I want one interface that gives me the active rules and keyed assumptions, so that changing a value in one place changes every calculation consistently.

#### Acceptance criteria

- [ ] **Seed file:** a reviewed, machine-readable seed at a single repo location (for example `server/gcsp/policy/seed-v1.json`), shaped like the target model:

    - dated scheme-rule links;
    - include/exclude eligibility rules matching on a keyed field;
    - a per-scheme dated price plan (the monthly points cost per car);
    - a company/grade allowance;
    - keyed assumptions.

    The October 2024 Choices matrices (`docs/gcsp/sources/choices-eligibility-matrices-2024-10.md`) supply the BMW rules.

- [ ] **Keyed assumptions:** every assumption has a stable key, value, unit, `assumed` or `verified` status, a short basis and its source and date. The seed includes at least:

    - the cart hold of about 2 minutes;
    - the order-review phase;
    - the buddy offer hold of about 2 hours;
    - the allocation tie-break rule;
    - the declined-car exclusion;
    - the unused £1 per point top-up;
    - the home-charging rule, labelled a demo assumption, not a BMW rule;
    - synthetic release sizes and lead times.

- [ ] **One read interface:** a `PolicyService` with the interface recorded in `docs/gcsp/shared-contracts.md` (FUCQ-80). It returns the active policy version and typed reads: eligibility for a context and car, allowance, points cost, and named assumption values. Every result carries the policy version it came from. An unknown key, scheme or grade fails explicitly, with no fallback default.
- [ ] **Read-only first:** this story serves the seed through a file-backed provider. FUCQ-83 adds the dated PostgreSQL tables behind the same interface, and consumers do not change when it does.
- [ ] **Tests read the source:** tests read their defaults through `PolicyService` and may pass explicit alternatives. A test proves that changing one seed entry changes the value every consumer receives.
- [ ] **build-rules.md updated:** `docs/gcsp/build-rules.md`, "Plausible assumptions in one shared source", rule 2, records the source's repository location and the access interface, as that file requires of the first such story.

#### Files or areas

- `server/gcsp/policy/ (proposed: PolicyService, file provider, seed-v1)`
- `server/test/gcsp-policy-service.test.js (proposed)`
- `docs/gcsp/build-rules.md`
- `docs/gcsp/shared-contracts.md (key catalogue, update if a key changes)`
- `docs/gcsp/sources/choices-eligibility-matrices-2024-10.md (read)`

#### Decided

Gary approved this foundation on 4 November 2026, including splitting PolicyService into this read story and FUCQ-83's dated tables, so that FUCQ-29 can start without waiting for PostgreSQL (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` (binding: one canonical source, keyed assumptions, one-place correction), `docs/gcsp/experience-quality.md` and `docs/gcsp/shared-contracts.md`. Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q6: policy as dated tables shaped like the target model, seeded from a reviewed repo file, read through one PolicyService; Greg's publish writes a new dated row.
- Q15: both hold durations are keyed values.
- Q16 and the round-2 findings: Choices is points-based. The allowance against the monthly points cost is the affordability gate, and the cash top-up is an unused keyed assumption.
- Round-2 findings: no rule requires home charging; release sizes and lead times are undocumented, so they are plausible keyed assumptions.
- Round-3 findings: the code that rules match on is undefined, so rules match on a keyed field.

October 2024 is the accepted eligibility baseline. BMW only at first.

#### Out of scope

Dated PostgreSQL tables and publishing (FUCQ-83); Greg's publish screen (C6); the employee ranking itself (FUCQ-29); learned-model artefacts (FUCQ-74).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-policy-service.test.js`: typed reads, version on every result, explicit failure for unknown keys, schemes and grades, and the one-entry-change test all pass.
- `npm test` passes. Retail behaviour is unchanged.
- Backend-only: no screen. The policy projection the client will receive is recorded in a fixture (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-83](https://ibm-consulting.atlassian.net/browse/FUCQ-83) · Publish dated policy versions to PostgreSQL tables

```text
id: FUCQ-83
title: Publish dated policy versions to PostgreSQL tables
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-81, FUCQ-82
preconditions: integration completion needs the GCSP Render Postgres instance, which Gary provisions.
```

#### Goal

As Greg, and as every consumer of policy, I want policy versions held as dated rows, so that a published change governs new work while pinned offers and past calculations stay explainable.

#### Acceptance criteria

- [ ] An additive migration (FUCQ-81's runner) creates dated policy tables matching FUCQ-82's seed shape: scheme-rule links, include/exclude rules, the per-scheme price plan, the company/grade allowance and keyed assumptions. Each row carries a policy version and an effective-from date.
- [ ] Seeding loads the reviewed repo seed into the tables idempotently: re-running it creates no duplicate version. The seed file stays the reviewed origin of version 1.
- [ ] A PostgreSQL-backed provider sits behind the same `PolicyService` interface as FUCQ-82's file provider. With `GCSP_DATABASE_URL` set, the service reads the active version from the tables. Consumers and their tests change nothing.
- [ ] A `publishPolicyVersion` operation writes a new dated version from a validated change set and records who published it and when. The previous version is never mutated. Publishing requires a principal with the Greg role, which the route layer enforces once FUCQ-84 is in. This story exposes it as a service operation, plus a test.
- [ ] A read can name a pinned version: it returns that version's values rather than the active ones, so a held offer is not silently repriced (HLD invariant). An effective date in the future does not govern current reads until the demo clock reaches it. The clock is injected; FUCQ-85 supplies the presenter clock.
- [ ] Tests prove:

    - one published entry changes the affected reads for new work;
    - a pinned read returns the old value;
    - an invalid change set is rejected without writing;
    - the in-memory and PostgreSQL providers agree.

#### Files or areas

- `server/gcsp/policy/ (PostgreSQL provider, publish operation)`
- `server/gcsp/migrations/ (additive policy migration)`
- `server/test/gcsp-policy-versions.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this foundation on 4 November 2026, including the PolicyService split (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` (rule 5: preserve coherent versions), `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" and Transaction and event invariants. Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q6: dated tables, with Greg's publish writing a new dated row. There is no extra infrastructure beyond the agreed PostgreSQL.
- Q2, Q4: managed PostgreSQL and `pg` only.
- HLD: stable active-offer terms are the demo policy, and a new points version does not reprice a held offer.

#### Out of scope

Greg's publish screen and its what-if preview (C6, Greg's dashboard); learned-model activation (FUCQ-74); provisioning.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-policy-versions.test.js`: passes on the in-memory provider, and on PostgreSQL when `GCSP_DATABASE_URL` is set. The output says which providers ran.
- `node --test server/test/gcsp-policy-service.test.js` still passes unchanged.
- `npm test` passes.
- Backend-only: no screen. Record the publish outcome shapes (accepted, rejected with reasons) in fixtures for C6 (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-84](https://ibm-consulting.atlassian.net/browse/FUCQ-84) · Resolve demo employees, Greg and the presenter with server-owned run scope

```text
id: FUCQ-84
title: Resolve demo employees, Greg and the presenter with server-owned run scope
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-81
```

#### Goal

As the presenter, I want every GCSP request to act as a known fictional person within the current demo run, so that nobody can act for another employee or gain Greg's powers by changing an ID.

#### Acceptance criteria

- [ ] **The adapter:** a `DemoIdentityAdapter` (interface in `docs/gcsp/shared-contracts.md`) resolves only configured fictional principals:

    - employees, for example Paula, plus competing employees, each with a scheme, company, grade and entitlement slot;
    - Greg, the scheme and ordering lead;
    - the presenter.

    Principals are seeded into FUCQ-81's employee tables per run, with no real names, contact details or licence data.

- [ ] **The gate:** the adapter sits behind the existing demo access gate (`DEMO_ACCESS_KEY`, `isAuthorized` in `server/index.js`). The shared password alone is not a principal. The presenter picks or switches the acting principal through a server-issued session the backend owns. Use an HttpOnly cookie or an equivalent, with no token in URLs or logs.
- [ ] **Server-owned context:** each `/api/gcsp` route receives one context object (principal, roles, scheme context, `runId`) through shared middleware. A route without it rejects the request. Employee ID, grade, scheme, role or run supplied by the browser is ignored or rejected, never trusted.
- [ ] **Role checks:** policy publish, order requests and other Greg operations require the Greg role, and reset and ticks require the presenter role. An employee cannot read another employee's brief, holds or offers. Tests cover each refusal.
- [ ] **Run isolation:** each run has a `runId`. Every repository read and write is scoped to the context's run, and a command whose objects belong to another run is rejected as stale.
- [ ] **Replaceable:** the adapter can be swapped for sanctioned BMW identity and roles later, with no route changes. This is recorded in the contracts file.
- [ ] **Outcomes:** unknown, missing and expired sessions return distinct outcomes, and the retail routes are unaffected.

#### Files or areas

- `server/gcsp/identity/ (proposed: DemoIdentityAdapter, context middleware)`
- `server/gcsp/fixtures/principals (proposed, fictional)`
- `server/index.js (mount middleware for /api/gcsp only)`
- `server/test/gcsp-identity.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this foundation on 4 November 2026, including that FUCQ-65 resolves its employee context through this adapter rather than its own (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md`, `docs/gcsp/personas/` and `docs/design/gcsp-high-level-design.md`, "Demo access and offer links". Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q1: GCSP has its own Render environment, so the GCSP backend's `DEMO_ACCESS_KEY` is set there; GC-001 facts stay with Gary.
- Round-1 finding: employee and driver data is stored locally in GCSP's own database, which matches seeding principals into PostgreSQL.
- Q2, Q4: PostgreSQL and `pg` only.

Offer-link tokens (hashed, run-bound) belong to the offer-page Epic and consume this context. They are not built here.

#### Out of scope

Offer-link tokens; production identity or BMW SSO; presenter navigation UI; ticks and reset (FUCQ-85).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-identity.test.js`: principal resolution, the ignored or rejected browser IDs, role refusals, cross-employee refusals, cross-run staleness and the missing or expired session outcomes all pass.
- `npm test` passes. Retail routes and the existing gate behaviour are unchanged.
- Backend-only: no new screen. Record the context and refusal response shapes in fixtures for the GCSP blocks (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-85](https://ibm-consulting.atlassian.net/browse/FUCQ-85) · Drive demo time with presenter ticks and reset a run cleanly

```text
id: FUCQ-85
title: Drive demo time with presenter ticks and reset a run cleanly
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-79, foundation from HLD readiness section C1)
epic: FUCQ-79
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-81, FUCQ-84
```

#### Goal

As the presenter, I want to move demo time forward on purpose and start a clean run whenever I need to, so that releases, expiries and second offers happen on cue and an old email link can never act on the new run.

#### Acceptance criteria

- [ ] **Demo clock:** a `DemoClock` port (interface in `docs/gcsp/shared-contracts.md`), stored per run in the repository. Every GCSP service reads time through it, never `Date.now()` directly. Tests inject it.
- [ ] **Advance:** the presenter can advance time by a step or to a named time, using the presenter role from FUCQ-84.
- [ ] **Ticks:** each tick has an event ID, and replaying the same tick ID is a no-op that returns the original outcome. A tick runs the registered handlers in a fixed, recorded order, including:

    - release (stock appearing on the next pull, per the round-1 finding);
    - hold and offer expiry;
    - reconciliation of pending operations.

    This story provides the registry and an ordering test. Each handler is registered by the story that owns it: FUCQ-66 for manual expiry, and the later buddy, release and offer Epics.

- [ ] **Startup:** backend startup runs reconciliation once, so outstanding work recovers without a browser. Nothing claims unattended scheduling on a sleeping host.
- [ ] **Reset:** reset is a presenter-only operation. It creates a new `runId` and makes it current. It regenerates the synthetic order identifiers (`orderUuid`, `orderNumber`) and the employee state from the versioned fixtures, and restores the clock to the scenario's start.

    It does not touch the immutable corpus (configurations and images) or any operational provider. The previous run's rows stay as history and can't be acted on.

- [ ] **Stale-run guard:** after a reset, the old run's offer reads, decision commands and outbox jobs are refused or no-op as stale. A test proves an old offer ID and an old outbox job cannot change the new run.
- [ ] **Read-back:** the current run ID, clock time and last tick outcome are readable by the presenter.

#### Files or areas

- `server/gcsp/clock/ (proposed: DemoClock, tick registry, reset)`
- `server/gcsp/fixtures/ (versioned scenario start state)`
- `server/index.js (presenter routes under /api/gcsp)`
- `server/test/gcsp-clock-reset.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md (note reset and tick steps)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this foundation on 4 November 2026, including that this story depends on FUCQ-84 for the presenter role and run scope (FUCQ-79; `docs/design/handover-section-c-2026-11-04.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md`, `docs/gcsp/manual-acceptance-scenarios.md` and `docs/design/gcsp-high-level-design.md`, Transaction and event invariants (reset, ticks, replay). Carry these decisions and acceptance criteria into every child-agent brief.

HLD review, 4 November 2026 (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks, with no unattended runner.
- Round-1 finding: release is stock appearing on the next pull.
- Q13: identifiers never change within a run (keyed assumption); reset makes new ones.
- Q15: both hold durations come from PolicyService.

FUCQ-75 owns shared scenario replay and its click-through scenarios. This story supplies the reset and tick mechanics they use. A presenter control screen, if one is wanted, belongs to FUCQ-75 or the presenter navigation work.

#### Out of scope

The release, allocation, expiry and offer business rules themselves (other Epics register their handlers); a presenter UI; any scheduled or background runner.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-clock-reset.test.js`: injected-clock advance, tick idempotency, handler order, startup reconciliation, presenter-only refusals, reset regenerating identifiers but not corpus, and the stale-run guard all pass.
- `npm test` passes.
- Backend-only: no screen. Record the tick, reset and stale-run response shapes in fixtures for FUCQ-75 and the offer page (`docs/gcsp/experience-quality.md`).
