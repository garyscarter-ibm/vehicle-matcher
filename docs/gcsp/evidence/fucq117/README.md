# FUCQ-117 independent planner checkpoint — 6 November 2026

Story `DEV-2026-11-04-090`, branch `dev/DEV-2026-11-04-090`. This checkpoint implements the independent planner, trusted saved-demand reader and dedicated future-choice evaluator. The story remains in progress: accepted configuration/cost/terms sources, canonical policy activation, actual runtime composition and final full validation remain open.

## Reviewed behaviour

The pure JavaScript solver exhaustively evaluates a declared bounded integer domain. Capacity matching respects exact effective deadlines, substitution, one employee/slot once, visibility, reserved holds and exact declined-stock exclusions. Hard constraints cover complete model/derivative bounds, budget and new-order lead time. Existing stock and only the unreleased remainder of confirmed supply count. Infeasible results recommend no partial quantities; effort/dimension exhaustion returns unsupported without an optimum claim.

Feasible output explains coverage, unmatched supply, unmet gates, integer binding constraints, objective terms, the zero-order baseline, a distinct feasible runner-up when available, and Greg's draft. Version pins and deterministic IDs are retained. Three panel fixtures cover feasible/alternative, infeasible and unmet/binding shapes. An independent tiny brute-force assignment oracle checks matching/objective results.

The read-only service fences trusted identity, clock, catalog/currency and producer versions. The supply converter joins published F104 request/confirmation shapes, checks per-supply release receipts, retains confirmed dates/source provenance and refuses guessed configuration links. Its query-port fixtures do not establish actual composed F104/F92 runtime acceptance.

The saved-demand provider reads actual F99 authoritative confirmed briefs without inverting public privacy suppression. An unspecified saved `renewalId:null` resolves through the exact employee/slot link; explicit conflict fails closed. Known renewal dates use the current contract's strict UTC end-of-day semantics. The new plan-owned evaluator reuses real PolicyService and shared pure employee gates over explicit versioned configuration facts and future terms. It creates no exact-stock or current-availability fiction, and changes no public F99/shared employee implementation.

All represented configurations must pass hard gates before a derivative-only quantity can cover that employee. Preferences are advisory, without invented acceptance thresholds/probabilities. Actual decline history excludes the exact unchanged car; relevant confirmed business changes reopen reevaluation, metadata/inferred changes do not, and expiry is not dislike. A confirmed earlier required-by date narrows matching while the exact renewal fact remains intact; late inbound cannot satisfy that earlier deadline.

## Scope and evidence

- Current selected command: `node --test --test-concurrency=1 server/test/gcsp-order-plan.test.js server/test/gcsp-order-plan-future.test.js`: **42 total, 42 passed, zero failures/skips**, 7.229 seconds. It exercises actual PolicyService, identity, BriefService and memory repository with explicitly injected synthetic versioned catalog/terms ports. `future-evaluator-receipt.json` pins the tested source/test hashes and source/environment identity. Later documentation/map updates do not change those tested bytes.
- Unchanged affected-boundary evidence is reused: policy service, Greg demand and repository contract selection76 total, 74 passed, two native PostgreSQL skips, zero failures. Shared implementations/inputs were unchanged. No JavaScript affected selector exists; reviewed `test_stamp --affected gcsp-poc --dry-run` would fall back to `npm test`, which was not executed.
- Strict targeted stamping used one worker, 128 MiB scratch/384 MiB RAM/300-second chunk targets. External run plans, identity/checkpoints, useful TDD failures and concise summaries are retained under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-restart-20261105/lead117/`. The shared `.claude/test-runs/impact/fucq117.json` records source/test hashes, reviewed function/boundary edges and timings. No Node per-test coverage-context collector is configured; unobserved paths remain unknown.
- Final filesystem audit found21 owned scratch roots absent, 21 process groups stopped, reservations released and the temporary dependency symlink absent. Latest peak RSS237, 338, 624 bytes; all owned chunks peaked at261, 160, 960 bytes; scratch peak0 bytes. This slice removed9, 088 bytes of successful verbose logs after summarisation. Useful failure logs remain bounded. No large output, OneDrive allocation or leftover exists. The compatibility exception was a temporary read-only symlink to the existing DEV069 dependency installation; no install/copy.
- Backend-only: no changed screen, browser, native SQL, credentials, live BMW write, stock write or order submission. Presentation fixtures remain the UI handoff.

## Remaining acceptance and source handoff

The dedicated policy proposal contains pending synthetic values and placeholder catalog IDs and is never imported at runtime. Canonical PolicyService/F103 activation and an actual central one-key-change proof remain open. Explicit fixture-provider tests establish independent behaviour only.

F104's published source/runtime handoff at `bb908a702c46d64fe060ecc717d9e925f340b6d8` requires immutable production sourceVersion/publication mappings to explicit planner/configuration IDs, canonical PolicyService configuration price pins and actual source-backed release provenance. Its present production choice DTO supplies only `{model, derivative}` plus provenance. The active lookup artifact has two configurations and historical receipts mention three; neither establishes accepted F77 coverage. The implemented future evaluator still needs accepted catalog/facts, canonical costs and a trusted future employee-terms source. F78 supplies configuration/corpus identity, not points prices; exact `configurationId` prices remain canonical PolicyService responsibility. Actual default forecast/F104/F92/runtime composition and authored final `npm test` remain gates.

## Earlier repair and interruption

Published repair `718bd69ec095fb982ac0f4a5ba5dffe37f86cd74` passed31/31 and corrected actual F99 null-renewal mapping while preserving strict explicit conflict failures. `resume-receipt.json` retains that distinct earlier evidence. The current42/42 selection supersedes its current-count claim, not its historical identity.

The interrupted 00:41UTC prototype previously passed28/30 and preserved both forecast failures. Historical child HTTP422 was a diagnostic, not verified exhausted credits. The shared AGENTS correction and explicit human resume supersede the former key-refresh prerequisite; credentials and IBM Global gateway were preserved.

Lead: Doug the Dog (they/them), thread `01a1ae41-b758-7521-b89f-8cf6c6afd1ed`. Requested/selected/runtime-verified `gpt-6.1-sol/high`; no fallback or descendants. Parent owns merging, acceptance and lease release. No story-completion claim.
