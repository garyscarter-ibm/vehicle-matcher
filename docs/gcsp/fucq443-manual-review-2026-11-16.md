# FUCQ-443 manual review checkpoint — 16 November 2026

This is an incomplete Angular checkpoint for DEV-2026-11-13-011, against base
`17c44d860a83dd70d8bcecacce43e30b7254e445` and frozen implementation reference
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. Both original acceptance criteria remain open.

## Implemented boundary

The allocated `apps/gcsp-web/src/app/manual/` files add the actual principal-scoped
Java claim/review/release/terms/order client, DTO validation, in-memory command lane,
selected-car review and order-summary compositions. The route reads an existing
order before a claim and never automatically claims, reviews or submits. Quote facts
replace the stock navigation snapshot after a claim. Commands retain server-issued
hold, quote, draft, stock and terms pins. Successful write responses must also match
the requested car/hold/quote and applicable draft/context/terms pins.

Pending and lost-response states block further writes. Reconciliation uses GET;
an absent read does not erase an uncertain attempt. Command IDs remain stable for
unchanged requests within the authenticated subject/environment/run/employee scope.
Recovery requires an explicit unfinished-selection confirmation and fresh required
declarations. Scope changes, logout and route disposal discard late responses.
Release must complete before edit/change navigation is permitted. An acknowledged
order is shown as received and awaiting approval, never approved.

The parent owns the separate guarded router, stock handoff and catalogue changes.
Stock passes the exact supplied selection through `ManualStore.enter(selection)`
before navigation. Browser history and queries carry no quote or command authority.

## Missing producer authority

The current Java claim supplies a flat quote. It does not supply the frozen
contact phone/email, replacement expected-return mileage and versioned review-details
authority. The current six-field submit contract also has no
`expectedReviewDetailsVersion`. See `blocks/gcsp/manual-review/review-model.js`
and `blocks/gcsp/manual-summary/summary-model.js` at the frozen reference.

The summary therefore displays a truthful unavailable-details state. Its final
Place order control remains disabled and native form submission is prevented.
No contact/return values, constraints, review version or successful order are
synthesized. Restoring this original capability needs the separately owned actual
Java producer and validation contract, followed by the original integrated proof.

## Components and scope

Reuse the current shared screen intro, status, button, media and fact components,
native field/declaration semantics and GCSP tokens. The review and summary are
feature compositions, with no shared-kit primitive or visual redesign. Parent
integration changes only the reserved router, stock-route/spec and catalogue files.
No Java, authentication, package, lockfile, build or toolchain source is changed by
this checkpoint. Product-map changes concern only the FUCQ-443 row.

## Validation record

Evidence is retained locally under
`.claude/test-runs/fucq443/manual-local-20261116/` in the primary checkout.
The selected checks are six new manual specs plus the directly affected stock-route
spec; the existing actual-source boundary checker runs only after their successful
completion. These are targeted checks, not a full-suite or connected acceptance stamp.

- Attempt 01 ran no tests. Before copying or starting a test command, exact Node
  identity comparison failed. A subsequent source-only audit checked all 23,008
  pinned dependency files and Node: every content hash matched, and all identity
  fields except `st_dev` matched. The observed device value changed from 16777232
  to 16777229; its cause is unproven. The old combined
  `borrowed_hashes_unchanged=false` field also included metadata equality and does
  not establish changed file contents. Preserve the original failed receipt.
- The new FUCQ-443-owned manifest preserves dependency graph, paths, sizes and
  content hashes, refreshes only those device fields, and records the exact audit
  provenance. Its SHA256 is
  `46b8f50701fa50001bc6daab7182466eabaf2d18ab1231c5e5c9ea581dbba771`.
- Attempt 02 failed Angular test compilation before Vitest: typed ElementRef
  injection, a partial order test DTO and two optional order-result reads produced
  four diagnostics. Those exact issues were corrected. No tests or boundary check
  ran. Elapsed 34.153 seconds; sampled peaks were disk 439,589,568 B, aggregate RSS
  956,268,544 B and disk plus RSS 1,395,858,112 B. Input and cleanup audits passed.
- Attempt 03 compiled the seven specs, then enforcement stopped the run when
  aggregate RSS reached 1,351,680,000 B, exceeding the 1,342,177,280 B RAM grant.
  The log recorded manual-store 17 and stock-route 14 tests passing before the stop;
  no complete test report exists, so this is not a seven-spec pass. Boundary checking
  did not run. Elapsed 28.231 seconds; sampled disk peak 432,419,712 B and disk plus
  RSS peak 1,784,099,712 B. All source/borrowed content and metadata audits passed;
  all owned processes/groups, scratch, output and canonical reservation were removed.
  No cleanup error remained. The RAM-limit failure is retained.

The authorised adaptive retry changed runtime selection and Node heap allowance
only: three sequential fresh chunks, heap 640 MiB instead of 896 MiB, under the
same disk/RAM/time/output limits. Repository source and configuration stayed frozen.

| Chunk | Selected specs | Passed tests | Elapsed seconds | Peak disk B | Peak aggregate RSS B | Peak disk plus RSS B |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | client 23, projection 10, store 17 | 50/50 | 25.377 | 434,543,456 | 973,864,960 | 1,408,408,416 |
| B | review 4, summary 6, route 6 | 16/16 | 23.510 | 434,297,152 | 1,039,319,040 | 1,473,616,192 |
| C | stock-route 14 | 14/14 | 26.984 | 440,783,616 | 1,341,243,392 | 1,772,630,016 |

All **80 tests across seven specs passed** on frozen input manifest
`adaptive-frozen-source.json`, SHA256
`c2fd5167fedd240edc897357163b869216447912373ce200c9a5b51ba9e9a7e3`.
Each chunk's source/borrowed content and metadata, Node, resource/deadline and
process/group/scratch/output/reservation teardown checks passed. A and B have
strict successful receipts. C's tests passed, then the actual-source boundary
checker returned 1:

```text
AssertionError [ERR_ASSERTION]: apps/gcsp-web/src/app/cases/case-queue.component.html: on-screen em dash
```

The failing HTML's SHA256
`5fbde6d6ef71834b457294509b768832796fe1d2db57d315a5bdb087c283e776`
and checker's SHA256
`e0438d660d764de5ad495aa88bbab29a75e0edf0957a414288e8315b887449b8`
are each byte-identical to pickup base `17c44d860a83dd70d8bcecacce43e30b7254e445`.
Visible em dashes occur at lines 40–43. This is source identity evidence for an
inherited failure; no base runtime rerun occurred. No later boundary assertion
was proved, and the **combined strict validation did not pass**. The unrelated
case screen and checker remain unchanged; this does not expand FUCQ-443's gates.

Receipts: `chunk-a-04/receipt.json`, `chunk-b-04/receipt.json`,
`chunk-c-04/receipt.json`, the latter's `boundaries.log`, and
`adaptive-summary-04.json` (SHA256
`9f79dd66e4da540e05ddd241d89157e3c17038a2dd4b4389696d74826860241d`).
The exact `ng test gcsp-web --watch=false --include=... --reporters=json
--reporters=default --output-file=... --coverage=false --progress=false` commands,
owned toolchain paths, harness hashes and per-input content identities are retained
in the receipts and `project-inputs.json` files. The boundary command was the owned
Node executable plus the actual worktree's `apps/gcsp-web/tools/check-boundaries.mjs`.

The parent independently observed all 212 frozen hashes matching and all adaptive
owned scratch/output, recorded PID identities/groups and canonical reservations
absent at 15:00:08 UTC on 16 November 2026, in
`.claude/fucq443-adaptive04-parent-audit-20261116-1447.json`. After that audit,
the only captured file changed was `.product-map/work.json`, for this Story's
status/evidence. The delivery note and Story Result were also updated. Product
source, tests and configuration remained identical; no runtime was repeated for
documentation.

Every runtime uses a fresh owned copy of the pinned closure and Node, one worker,
768 MiB disk plus 1280 MiB aggregate RAM, inclusive at most 2 GiB, 480 seconds work
and 600 seconds total on realtime and monotonic clocks including 120 seconds cleanup,
at least 5 GiB free reserve, and a 2 MiB runtime-output cap. Resource peaks are sampled;
continuous peaks are not proven. Borrowed dependencies and toolchain are read-only.
OneDrive was not accessed; no OneDrive cleanup or verification was attempted.

## Remaining original work

Actual Java/PostgreSQL/OIDC claim-to-order replay, stale-quote/declaration-failure and
lost-response/recovery proof remain unrun. The required desktop/narrow,
Safari/private-browsing, keyboard/focus and relevant CSP/accessibility rendered proof
also remains open. No production build, full suite, hosted deployment or live BMW
integration was run for this increment. Fixtures and compilation do not satisfy
these original acceptance requirements. No In Review, Done or accepted claim is made.

Agents: Edna 2 lead requested/selected `gpt-6.1-sol/high`; Miss Prissy 2 source worker
requested/selected `gpt-6.1-sol/medium`; Melissa Duck 2 runner requested/selected
`gpt-6-luna/high`. No fallback. Desktop titles were verified. The lead owns the
corrected source-only audit and attempts 02/03; no new worker was started for retries.
The lead also ran the three adaptive chunks. No independent reviewer was spawned
for this checkpoint; the parent owns subsequent review and integration.
