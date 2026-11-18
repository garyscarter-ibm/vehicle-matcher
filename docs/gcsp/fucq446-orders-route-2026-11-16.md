# FUCQ-446 orders route checkpoint — 16 November 2026

**PARTIAL; HOLD for parent publication/integration.** Same Bertie on
`dev/DEV-2026-11-13-014`, verified clean starting commit
`cbcd0aac5672968ba89b9cb93cb59b8a4392f3ee`. No new claim, Story, child or settings change.
The parent published the earlier lifecycle source increment at
`57e66de11c1a0083ba0cc7dfd4594a8e789dfab8` through merge `58224a0c5`.

## Bounded change

Only the orders entry in `apps/gcsp-web/src/app/routes.ts` changes: the feature placeholder
now lazily loads the existing `OrdersComponent`, with the same `sessionGuard`, title
`Order progress` and employee role. An exact string substitution check preserves every
other route byte, including stock/offers/help/Greg entries, guards and titles. Existing
`/orders` links and optional `?orderUuid=...` use the component's existing behavior.

`COMPONENTS.md` gains only an additive `gcsp-orders` entry: source/selector, routed usage,
no component inputs/outputs, existing kit composition and client/controller/action ownership.
There is no wrapper, gallery expansion, shared primitive or lifecycle implementation change.
The only other source file is new `orders/orders.route.spec.ts`. The Story and delivery
records receive appendices plus this note. All other files remain read-only.

## Selected current checks

One finite native Angular check ran on **16 November 2026, 07:55:12–07:55:49 UTC**:
**15 PASS, three files, rc0, zero failures/skips**. The five new checks exercise real
`RouterTestingHarness` navigation through the production route array: native default
entry, exact order queries on direct/same-route navigation, safe signed-out return, and
Greg-only/presenter-only rejection before lifecycle reads. Ten existing guard/policy
checks cover the shared authority boundary. Services/auth are explicit local test doubles;
no external request or provider command occurs. The selected bundle compiled in 3.598 s;
Vitest reported 1.03 s. The new route spec took 244 ms.

The local supervisor invoked private copied Node/Angular CLI with:

```text
ng test gcsp-web --watch=false
 --include=src/app/orders/orders.route.spec.ts
 --include=src/app/auth/route.guards.spec.ts
 --include=src/app/auth/route-policy.spec.ts
 --reporters=json --reporters=default
 --output-file=<local receipt>/test-report.json --coverage=false --progress=false
```

Exact consumed supervisor invocation:
`/usr/bin/python3 -I -B <root>/.claude/test-runs/fucq446/route-local/run.py native-1`.
All **144** selected source/config/reference inputs still match its retained manifest.
The route test compiles the actual lazy route graph. It emitted an existing stock-template
NG8107 optional-chain warning at `stock.component.html:23`; that unrelated source is unchanged.
This is selected fixture/compiler evidence, not a full application/production build or
rendered browser acceptance. No current attempt failed or skipped.

### Matching earlier evidence and open checks

The reviewed 14 November result remains **116 PASS/eight files**, with its original failed
attempt history and resource correction retained in
[the lifecycle record](fucq446-lifecycle-screen-2026-11-14.md). The nine frozen lifecycle
files and existing controller/projection/read port remain unchanged. Direct manifest
comparison finds 131/136 earlier inputs identical; the five changed paths are routes,
gallery component and media-gallery TS/HTML/CSS, reflecting the disjoint stock/gallery
integration and this route binding. Therefore the old result is reused only for its
unchanged lifecycle/account behavior, not claimed as a current whole-tree 116-test run.
The current route/guard check covers the changed composition. Parent comparison receipt
`.claude/integrated-increments-20261116-0016.json` independently recorded the frozen
lifecycle file match at 06:52:42 UTC on 16 November.

No 116-test replay, full suite, browser retry or framework repair campaign was run. The
earlier browser preview built but timed out after 90 seconds with zero checks/captures;
no causal correction authorises treating that as resolved. Desktop/narrow/Safari/private/
keyboard/focus/CSP/accessibility, real Java/OIDC/native PostgreSQL, transaction/restart/
concurrency, email/provider and hosted acceptance remain open/unrun. Default unavailable
providers remain unavailable. No full Story, In Review, Done or acceptance claim follows.

Both original criteria remain exact and unchecked:

- [ ] Supported approval, document, readiness, appointment and return states/actions reflect the provider and employee authority.
- [ ] Ownership, pending/refused work and current-car relationships remain accurate through reload and supported transitions.

The five existing slice IDs/weights remain progress-read (3), employee-actions (3),
view-parity (3), review-proof (2), java-integration (2). This route binding does not start
Java integration or complete an acceptance slice. The entire `.product-map/work.json`
is unchanged, preserving every foreign raw row/order and native/historical observation.
Historical Low FUCQ-499 and Medium FUCQ-501 remain separate/unfixed; rebooking observation
3629452 remains unresolved. No new actionable product defect was found in this allocation.

## Corrected local resource execution

The new ignored route-local runner was written from the reviewed canonical helper; no
historical runner was executed/imported. It explicitly uses both
`local_scratch_reason` citing the human OneDrive prohibition and `output_root=/private/tmp`.
The planned ownership manifest and supervisor finalizer precede scratch/dependency copies.
Canonical HostBudget acquisition plus locked JSON readback grants **768 MiB disk +
1280 MiB RAM = 2 GiB total**, with separate bounds and a combined sum guard. This corrects
the earlier runner's 2 GiB plus 2 GiB allocation; raw earlier receipts remain untouched.

One worker, 480 s work/600 s total/120 s cleanup, 5 GiB reserve, 2 MiB retained log cap,
owned HOME/TMP/config/cache/npm files and private regular dependency/Node copies were used.
Serial execution and the small selected graph preserve bounded work under reduced free-space
headroom. No installs/downloads or worker dependency links were created. The only borrowed
installation is the authorised worker007 Node/dependency tree; no other peer worktree was read.

Measured total was **36.665 s**, with sampled peak disk **440,676,736 B**, aggregate RSS
**1,051,574,272 B**, and simultaneous disk+RSS **1,483,329,408 B**. Disk includes retained
logs/receipts. The in-process sampler is included in supervisor RSS; 67 snapshots track
recursive ancestry, owned groups and inherited unique-token discovery for detached
processes. Strict test/resource/cleanup flags passed. These are sampled OS observations:
`continuous_detached_peak_proven=false`, not a continuous/kernel-contained peak proof.

The run records no owned process/group ports, removed scratch/ownership state and locked
token absence, with cleanup errors `[]`. Independent local readback at **07:56:34 UTC**
confirmed the supervisor and all 71 observed process identities absent, group 47760 absent,
the exact owned scratch absent, manifest removed and canonical token absent. No unrelated
reservation existed at the before/after observations; no foreign cleanup was attempted.
All 23,008 selected borrowed file identities/hashes, full metadata and Node pins match
before/after. Whole borrowed-tree bytes beyond that closure remain unproven. No OneDrive
location was read, written, checked or cleaned.

Closure manifest SHA256:
`5dc8e9635f79c56dea71255a3db9e8376b949f40f52bf0b448e261718530a271`;
Node SHA256 `ba7073582822078d8c90bca3facacc46690bc5366fab4b815aeef9148cd6e854`.

Local evidence root: `.claude/test-runs/fucq446/route-local/`. The nine-file index is
`evidence-index.json`, SHA256
`1db2d4db50b53dd1d182396a31c0cd4ca836519e59e3f98fcec95daabafd1c1d`.

| Evidence | SHA256 |
| --- | --- |
| native-1/receipt.json | `e85bb8a8f0206ac7a071537b2cc2985c574f07c24a98997083a96d91a5f73882` |
| native-1/project-inputs.json | `7210ba6b64b283537f1cc6fa0ba0c12db53b53dbf2975ceaebf440c4fcec3051` |
| native-1/test-report.json | `32da008ad620f383019765f08f19139a4d5bae412372881273395de2f393d830` |
| native-1/tests.log | `4d7caa6dea7c06a04daea6fa9101d6428416972867c9136b555bc3228f3ea2b9` |
| native-1/ownership/7440229c5a0a41cb95d1c6e0cda6f785.json | `4324b705aa59717cb737b0f8e4c6050f9ee7ee03488e5aa1719ed6b4dacf3642` |
| cleanup-audit.json | `83df1682ff202b8eac0b9497d445b322de1c2df159ded0b286a031fd8117564f` |
| run.py / native-1/run-source.py | `30434532c591a5da7f2771c9a5025d32e819fac906021fcd0f52f3214fcd9512` |

## Dispatcher learning and next boundary

**16 November 2026, 07:55:49–07:56:34 UTC, Bertie/GC Codex,
DL-20261114-GC-009 mitigation:** parent review identified the earlier separate 2 GiB
grants and incomplete descendant accounting. The current necessary route check used
the corrected split/sum guard, supervisor-inclusive recursive/group/token sampling and
strict result flags. Its recorded simultaneous peak stayed below the inclusive grant;
independent owned cleanup passed. Retain the sampled/continuous-peak limitation and the
earlier raw receipts. Proposed framework improvement remains canonical inclusive
supervision with explicit sampling limits; no shared framework change or redundant test
run was introduced. DL-20261114-GC-006 browser evidence remains unresolved and was not replayed.

Same requested/selected/effective `gpt-6.1-sol/high`, parent verified, no fallback/settings
change/children. Gateway PASS. Equal collaborator authority, resumed Jira policy within
scope and the false-child-422 rule remain binding. Parent owns publication, shared native
operations and integration. Commit only the six named task paths through scaffold_git
under the checkout mutex with the Codex trailer, freeze/HOLD and release write lanes.
No worker push/sync/merge/rebase/Jira/lease/deployment/email/service/database operation.
Next original-scope work is actual rendered and connected lifecycle acceptance, after a
concrete browser capability/correction and an authorised composed environment are available.

## Parent integration — 16 November 2026

Parent reviewed frozen `529eb07ea8e954ca61e790efb9f7c8e4e3b68d0f` and independently verified the nine indexed evidence files, 144 tested inputs, current owned resource absence and the 36.654-second realtime ownership span. All 142 unchanged tested Angular inputs matched the integration root; the two route additions were reviewed separately. The six-path increment was published, merged at `141dda1bfd80c7aaf0fe7d2bdf77a6935c16bfed` and pushed to `gcsp-poc-dev`. No repeated runtime was needed for matching inputs. The sampled-process limitation remains explicit. Both original criteria remain unchecked, native Jira stays In Progress, and the reserved lead is held after this finite increment. Rendered and connected lifecycle acceptance remain open.


## Connected recovery evidence — 18 November 2026

At9ef2eda5dc4def98a533446a404bc174f439ab76 the composed production Angular/Java/nativePG17/
local signed OIDC proof passed128 assertions in four scenarios; focused Orders105 and
Java371 checks plus production builds passed. Final C1/C2/C3 strict receipts and cleanup
passed. Full details, retained attempt failures, source hashes, all16 PNGs and limitations
are in `docs/gcsp/fucq446-delivery.md`, Connected lifecycle result.

**PARTIAL / CHANGES REQUIRED:** visual review proves the terminal Returned panel also
renders stale proposal text `Not booked yet` from historical proposedSlot. Original
accurate-state criteria remain unmet/unchecked; no product repair or acceptance switch
occurred. Booked stages nextStep is preserved producer semantics and needs a bounded
contract decision before precedence changes. Safari/hosted/real IdP/email/live BMW and
full accessibility/CSP remain unrun; full suite deferred to covering batch.


Dispatcher reconciliation at02:38 UTC: the terminal return rendering fault is native
**FUCQ-522 (Medium)**, related to FUCQ-446 under FUCQ-432; both actual terminal PNGs
are attached as937958/937959 (151257bytes each). The booked-handover stale nextStep is
already described by **FUCQ-299** and remains existing related evidence, with no duplicate
Bug or silent producer precedence change. FUCQ-521 is unchanged. Parent independently
audited all five runtime allocations,1792 observed identities and nine ports: cleanup
PASS, lane released. Overall review stays CHANGES REQUIRED; the proof/tooling source
has a scoped pass for the128 exercised assertions and bounded validation only.
