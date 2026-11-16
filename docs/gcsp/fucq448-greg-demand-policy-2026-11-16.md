# FUCQ-448: Greg demand and policy migration checkpoint

Observed 16 November 2026. Story `DEV-2026-11-13-016`, branch `dev/DEV-2026-11-13-016`.
Original acceptance and native In Progress status remain open. This record does not establish delivery.

## Fixed contract and allocation

Greg must see computed demand/evidence and perform implemented preview/publication with current version checks.
Stale/unavailable publication must be explicit, existing active offers must retain pinned terms, and dashboard
totals must come from the server. Original validation replays changed inputs, privacy, preview/publication,
active-offer pins and denied employee/presenter commands against Java.

The dispatcher allocation is `.claude/fucq448-pickup-allocation-20261116-1508.json` in the source checkout.
All ten pinned source hashes matched this Story worktree at pickup. This lead owns only its 17 new
`apps/gcsp-web/src/app/greg-demand-policy/` files, this record, its Story Result and the FUCQ-448 map row.
Dispatcher owns the `greg` route and catalogue/gallery integration. No Java, business-rule, authentication,
shared-kit, dependencies, build configuration or deployment edits are allocated.

Existing Java reads use trusted bearer scope and reject all query parameters. Policy preview currently returns
HTTP 422 `unsupported` / `preview-unavailable`; no successful preview may be invented. Policy fields supply
values, labels, ranges and provenance. Policy read has no clock version, and held-offer count is unknown.
The Angular layer may map server results and preserve reviewed command identity; it owns no demand/policy
calculation or policy/clock/count authority.

## Stable slice plan

1. `frontend-core`: typed bearer transport, faithful demand/policy projections and a session-scoped store.
   Tests cover band privacy, authoritative metadata, denial, stale/malformed/unavailable results, abort and
   account/run changes, edit invalidation and immutable reviewed command/retry binding.
2. `frontend-screens`: demand evidence and policy editor plus routed composition. Preserve frozen
   `blocks/gcsp/greg/demand-view.js` and `blocks/gcsp/greg/publish/panel.js` semantics; reuse Angular
   button, screen-intro, status, labelled-field and error-summary primitives, shared tokens and semantic
   read-only tables. The current Angular data-table is case-action-specific; dispatcher explicitly admits
   semantic read-only table composition here, without a new primitive or shared-kit changes.
3. `integration`: required Java connected preview/publication and active-offer pin proof plus affected
   rendered desktop/narrow, Safari/private, keyboard/focus and CSP/accessibility development evidence.
   Producer limitations and unrun proof remain original Story work; frontend fixtures cannot close this gate.

Shell/palette references: `docs/gcsp/screens/README.md`. Body: frozen Greg implementation and COMPONENTS;
13 November Greg concepts are unapproved. Apply the relevant original experience gates without broadening scope.

## Resource selection

Source/plan only initially. No test, build, service or browser runtime has been admitted or started.
The dispatcher must admit a finite selected command/input/scratch/output/teardown plan before runtime.
No install; OneDrive is forbidden for all access. Use bounded owned local scratch only, preserve the host
reservation, 2 GiB inclusive RAM plus disk, 5 GiB free reserve, 2 MiB retained output and 480/600 second
work/total limits including cleanup. Retain actual failures and sampled-resource limitations.

## Agents and coordination

Mulan 2, thread `01a1e4ee-7d46-78a0-a272-c459bccdd75b`: requested/selected `gpt-6.1-sol` / `high`, no fallback;
confirmed title. Gateway check PASS at `api.servicesessentials.ibm.com`.
Shared delivery issues are reported to dispatcher for `docs/gcsp/dispatcher-learnings.md`.
