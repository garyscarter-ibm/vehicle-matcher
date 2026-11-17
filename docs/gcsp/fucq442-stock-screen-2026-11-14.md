# FUCQ-442 stock screen checkpoint — 14 November 2026

Source checkpoint: `7f764575df52579aec74333163a23d0971783652`, based on dispatcher-admitted `8cbcfe7580785dacf77cb7b8ddff598d712756ae`. Emmet requested/selected/effective `gpt-6.1-sol` / `high`, no fallback or new descendants. This finite release adds the original stock screen, the minimal shared vehicle card and compact presentation of existing media. It is held for dispatcher publication and serial host/catalogue integration; it is not whole-Story acceptance.

## Original contract and delivered boundary

Both original acceptance criteria remain unchecked:

- Existing filters, paging/history and vehicle detail views use actual released-stock/API projections and preserve the selected exact car.
- Missing facts/images, empty stock, source failure and stale/unavailable selections have the existing meaningful outcomes.

The implementation uses existing StockStore, projectStock, stockFactRows, stockFilterOptions and AccountClient contracts. Component-scoped StockStore owns cancellation and teardown. It initializes viewport width before the first load, retains expansion on resize, shows six desktop or three narrow cards, and focuses the first added exact card. Counted series/body choices, search/sort, allowance, release history and all/eligible/matching counts use the existing projected source. Filters remain available during in-page details.

Exact selection retains orderUuid identity even when configurationId is shared. Detail arrival and return focus are explicit; unavailable/stale selections never substitute another car. Details retain prominent monthly points/allowance, exact/reference/unclassified facts, configured equipment, specifications, history, terms and source/image metadata. Missing values and images remain explicit; source-selected primary media stays first. Loading, no-match, empty, source failure, denied and stale/unavailable outcomes remain meaningful. Review emits the source-issued descriptor only when existing authority permits it; the screen performs no claim or policy calculation.

VehicleCard is a presentation-only shared component using existing ButtonDirective, FactList and MediaGallery. It accepts exact member identity, provided facts/media/cost/eligibility and disabled reason, and emits typed exact member/action pairs. Source text is rendered as text, missing/zero/false survive, native Car facts is collapsed, and disabled reasons are linked with unique accessible IDs. Numeric emphasis uses existing `--gcsp-font-size-figure`.

MediaGallery's new `compact` input defaults false, preserving offer presentation. Compact cards use a 180px cover/fallback without thumbnails/caption/enlarge controls. Entering compact mode closes a viewer, resets the selected image and guards programmatic opening. No provider/media framework or duplicated media family was added.

## Selected checks and visual evidence

`npm --prefix apps/gcsp-web test -- --include=src/app/stock/stock.component.spec.ts --include=src/app/kit/vehicle-card.component.spec.ts --include=src/app/kit/media-gallery.component.spec.ts`

Final `verified` run: **33 passed, 0 failed, 0 skipped** (screen 13, card 4, media 16 including 14 existing regressions). Scoped Angular compilation passed. Nonfatal NG8107 warns about optional `message()?.join` because the declared Record infers a value for every key; runtime missing-state handling still returns null. No selected test failure occurred. Earlier selected runs passed 32 and 33 before the final source revisions. No unchanged full-suite or boundary-checker rerun was added.

Final actual-source isolated browser run `browser6` passed **17 checks** in installed system Chrome with no page exceptions or failed requests: desktop 1440, narrow 375/320, fresh three-card narrow state, no horizontal overflow, native Enter/Space, show-more/detail/back/clear-filter focus, exact review output, navigation snapshot shape, stale/empty/failure/denied and reduced motion. Nine retained screenshots were visually inspected; final desktop/320 captures were inspected again during checkpoint audit. Shared local CSS/fonts and authored source were used. Authored source was ngc compiled; a fixture-only Angular compiler import supports partially compiled framework libraries. This does not establish a production CSP/AOT bundle, application router/history integration or full accessibility acceptance.

Evidence is retained locally under root `.claude/test-runs/fucq442/stock-screen/`: `verified-receipt.json`, `verified-tests.log`, `browser6-receipt.json`, `browser6-results.json`, `browser-summary.json` and `lead-stock-input-resource-audit.json`. Captures: `stock-desktop.png`, `stock-detail-desktop.png`, `stock-narrow-375.png`, `stock-narrow-320.png`, `stock-detail-narrow.png`, `stock-stale.png`, `stock-empty.png`, `stock-failure.png`, `stock-denied.png`. Both final receipts pin 167 inputs; every current hash independently matched at 17:08:58 UTC on 14 November 2026. Source has not changed since those runs.

Retained harness failures: first browser fixture compilation incorrectly treated ApplicationRef as ComponentRef (TS2339/TS7006); second invoked native esbuild via Node; third lacked compiler support for partial Angular libraries, then timed out waiting for the fixture. Corrected installed-tool invocation and fixture bootstrap produced successful runs 4–6. Browser4's scrolled 320px full-page capture had compositor stitching repetition; the harness now scrolls to top before capture, and the original remains `browser4-narrow-320.png`. These establish local fixture issues, not a new product defect. Earlier browser resource samples followed parent groups only; final browser6 accounts recursive descendants and detached Chrome groups.

## Resources and local teardown

All allocations used the neutral helper with explicit `local_scratch_reason=Gary explicit OneDrive prohibition14Nov2026`, `output_root=/private/tmp`, canonical HostBudget grant/readback, external manifest and atexit/finally/SIGTERM cleanup before allocation. Limits: one worker; 768MiB scratch plus 1280MiB RAM, inclusive 2GiB; 5GiB emergency disk reserve; 480s work/600s total. Installed Node24.22.3/npm11.19.1/Angular21.2.26/Vitest4.0.18 and system Chrome were reused, with private dependency copies excluding borrowed caches and owned HOME/TMP/config/npm/Angular/Vite data. No download.

Final selected peak RSS 1,124,548,608 B and combined RSS+scratch 1,433,605,766 B; sampled work scratch 313,818,918 B, ownership/cleanup high-water 318,842,118 B. Final browser recursive peak RSS 1,073,790,976 B; combined 1,393,576,959 B; scratch 319,785,983 B. At 17:08:58 UTC, independent LOCAL audit verified all nine owned scratch roots and all 23 recorded groups absent, the temporary dependency link absent, every canonical token absent under the short lock, and all five borrowed tool/dependency identities and selected caches unchanged. Final browser server reports closed. Historical browser1–5 receipts cannot establish complete detached-process peak RAM; final browser6 is authoritative for that measure.

**No OneDrive location was read, written, probed, cleaned or audited.** Old local receipt strings were not followed. Cloud cleanup status is not freshly verified. No current check required forbidden storage.

## Parent integration recipe (not applied by this worker)

The current `stock` route is still a StatePage placeholder. Parent owns shared routes, shell, catalogue/gallery and the manual flow. Apply serially after the shared-file writer releases ownership. Retain sessionGuard and employee roles. A thin route host can import StockComponent and bind its existing public API:

```html
<gcsp-stock [navigation]="stockNavigation()"
  (navigationChange)="saveStockNavigation($event)"
  (review)="reviewExactStock($event)"
  (back)="backToChoices()" />
```

Register that host lazily at the existing `stock` path, replacing only the placeholder entry (example parent-owned filename):

```ts
{ path: 'stock', loadComponent: () => import('./stock/stock-route.component').then(m => m.StockRouteComponent),
  canActivate: [sessionGuard], data: { title: 'Choose a car', roles: ['employee'] } },
```

The host imports `StockNavigationSnapshot` from stock.store and `StockCar` from stock.types. `navigation` accepts unknown and the store validates scope and snapshot atomically. `navigationChange` carries `{ snapshot: StockNavigationSnapshot | null; replace: boolean }`. Keep the snapshot in a namespaced browser-history state field, preserve Router-owned state, use Location.go for deliberate `replace:false` updates and Location.replaceState for automatic `replace:true` updates, and restore that field on popstate/route arrival. Avoid resetting identical input repeatedly; reject cross-scope data through the existing store. Snapshot fields are only version, scope, controls, limit and selectedId. Never persist full review facts, quote authority or tokens in history. Review output is `StockCar['review']`: forward the exact descriptor to the existing manual-review context/flow when integrated; do not reconstruct claimInput, select by configurationId or treat browsing as a reservation. Wire back to the existing choices destination. Destroy host subscriptions/listeners on departure. Actual router back/forward and source-authorised review handoff still require integration evidence.

Minimal catalogue/gallery example for parent to add after shared-file release (import VehicleCardComponent into the gallery's imports):

```html
<gcsp-vehicle-card memberId="gallery-exact-stock" name="BMW 3 Series" line="Touring"
  orderNumber="0000001" [images]="[]" [points]="740" [allowance]="1000"
  eligibility="Needs confirmation" [reviewDisabled]="true"
  disabledReason="Confirm the supplied information before reviewing this car."
  [facts]="[{ label: 'Exterior', value: 'Blue' }, { label: 'Interior', value: null }]" />
```

Catalogue inputs: required memberId/name; line/orderNumber; projected images/placeholder; nullable points/allowance/contribution; eligibility; reviewDisabled/disabledReason; supplied FactRow[] facts. Output `action: {memberId, action:'review'|'details'}`. No fetch, policy, auth or claim behavior. Existing media default callers retain their API.

## Remaining original work and disposition

Five slices remain fixed: typed-projection and browse-state complete at frontend boundaries, view-parity in-progress, review-proof and java-integration not-started. Route/history/manual-review and shared gallery/catalogue integration are parent-owned and unrun here. Independent whole-Story review, actual employee Java API/native PostgreSQL/OIDC, hosted HTTPS/CORS, Safari/private, production CSP and complete relevant accessibility remain open. Fixtures do not establish those checks or live BMW access. These are original acceptance gaps, not a newly introduced deployment/migration campaign.

Known linked **FUCQ-499 Low** remains unresolved and nonblocking under standing policy. The full-app boundary command historically FAILED rc1 because its inline-event regex mistakes unchanged `const only =` in stock.store.ts:20 for an attribute. It was not repaired/rerun or made a new merge dependency. Current release established no new product defect. No Built/In Review/Done or original acceptance claim; native status/claims/Jira/publication remain dispatcher-owned. HOLD the final source-plus-metadata SHA; no worker push/sync/rebase/merge or new child.

## Dispatcher learnings for parent to append

Shared log was read from the main checkout and left untouched. DL-20261114-GC-001: the finite combined source/check release delivered this screen, 33 selected passes and 17 actual-browser checks without another preparation/permission round; evidence is this source checkpoint and receipts. This mitigates the observed scheduling overhead for one increment, not the framework globally. DL-20261114-GC-004: explicit neutral local scratch policy and local-only audit worked without any forbidden-storage probe. DL-20261114-GC-007: installed Chrome starts; corrected fixture ApplicationRef/native-esbuild/partial-library compiler setup now has final-source passing evidence. Detached Chrome process groups require recursive accounting; browser6 corrected the local runner and supplies authoritative final resource evidence. Retain failed attempts and source identity; no shared scaffolding expansion was performed.

## Dispatcher integration and independent review — 17:19 UTC

Frozen worker `09a268f4150ef5fa04caafc28a56e95223471141` was independently reviewed and integrated/pushed to `gcsp-poc-dev` at `db1d00e8d`. Parent independently verified both sets of 167 inputs, 33 selected tests, 17 isolated browser checks, nine capture hashes, the original Story prefix and 301 foreign map rows. All nine owned local scratch roots, 23 recorded groups, nine supervisor PIDs, dependency link and canonical tokens were absent; five borrowed identities and selected caches were unchanged. Newer FUCQ-447 queue/route/gallery and shared policy/log changes were preserved.

Review verdict is PASS_FOR_PARTIAL_INTEGRATION. Source-confirmed, runtime-unreproduced findings are captured as separate native linked backlog Bugs **FUCQ-504 Medium** (selected detail mislabels a source/refusal error as an unavailable car) and **FUCQ-505 Low** (closing a different restored selection can focus an earlier car). Both remain To Do, unassigned, unclaimed, unfixed and nonblocking under the standing policy. FUCQ-499 Low also remains open. No original criterion was altered or marked met.

Resource qualification: final browser6 recursively accounts command descendants, including detached Chrome groups; earlier browser1–5 cannot establish that peak. All retained runner samples omit the Python supervisor itself. Consequently full aggregate peak RAM is **not established**; the reported command-descendant peaks are retained, and no overrun was established. Actual local teardown was independently checked without running another test or following any forbidden-storage path.

The current application stock route/history, manual-review handoff, gallery/catalogue wiring and actual connected journeys remain original integration work. Passing isolated screen proof and a pushed source increment do not establish full acceptance, In Review or Done.


## Route/history and shared-card continuation — 14 November 2026

Source `31589e3f4c57445744c6652edd5f4ed8353fd41a`, based on dispatcher-admitted `2efc8e955209b9ef1dbdf766ba58314e82706e87`, implements the finite delegated route/catalogue lane. This supersedes the earlier *not applied* host/gallery recipe at the new source boundary. Exact writes: new stock-route.component.ts/spec; stock.component.ts/html/spec only for host review availability; stock entry in routes.ts; additive VehicleCard import/example in gallery.component.ts; additive card/compact-media contracts in COMPONENTS.md. Existing Greg/table, Help, Activity, offers and every other route/example remain unchanged. No auth, shell, kit implementation, backend, provider or F443 source was edited.

StockRoute lazily composes the real StockComponent behind the existing sessionGuard/employee data. It reads the `gcspStock` history namespace on entry/popstate and uses existing store validation to reject malformed/cross-scope snapshots. It explicitly copies only version/scope/controls/limit/selectedId; full facts, source review descriptor, claim authority and tokens do not enter this namespace. Deliberate screen changes use Location.go; automatic resource snapshots use replaceState. Router-owned/unrelated state and query/fragment are preserved. No host input write-back is performed on local saves; signature deduplication avoids echoes. Listeners unsubscribe at teardown; late writes/away-path events are ignored. Back uses `/account`, the actual account/saved-choices route; Account exposes saved-journey Resume and no choices query-parameter API.

**Original manual-review handoff remains incomplete.** Current manual/review is still StatePage and there is no existing source-descriptor consumer. This release creates no fake review context, claim POST, command or placeholder navigation. A minimal optional `reviewUnavailableReason` screen input defaults null, retaining standalone source-enabled behavior; the route supplies “Reviewing a car is currently unavailable. You can still browse cars and view their details.” Review controls and direct card/detail activation are blocked while it is present. Source ineligibility reasons retain priority. Original F443/manual-review integration is still required before the routed experience can review/reserve a car; this is not a waiver or completion of FUCQ-442.

The additive Released vehicle card gallery uses the actual shared VehicleCard, missing media/fact, nullable facts and disabled review; Vehicle details gives explicit local example feedback. The two existing table examples and all earlier gallery sections remain. COMPONENTS.md now describes the actual card inputs/output and default versus compact existing-media semantics.

Selected command: `npm --prefix apps/gcsp-web test -- --include=src/app/stock/stock-route.component.spec.ts --include=src/app/stock/stock.component.spec.ts`, with Node heap capped at 384MiB in the owned runtime. **27 passed, 0 failed, 0 skipped** (host/history 13, screen 14); Angular compilation passed. Cases use the actual lazy routes/StockComponent/Location and mock platform history: exact entry restore, push/replace/echo behavior, native back/forward, scoped allowlist, privacy on scope clear, teardown, account destination, role/session guards, gallery composition and standalone/host review behavior. Nonfatal NG8107 optional-chain warning is unchanged. Full-suite, unchanged media/card/store/projection checks and the known full-app checker were not rerun.

Actual installed-Chrome router fixture passed **15 checks**, no page errors or failed requests, at 1440/375/320 with reduced motion. Native Enter/Space operate paging/detail; actual browser back/forward restore page/exact selection; document reload restores the scoped exact car; Router/unrelated state and URL query/fragment survive; cross-scope restoration resets to the current scoped snapshot; the real lazy gallery retains two tables and keyboard feedback. Seven captures: stock-host-desktop, stock-host-detail, stock-host-narrow-375, stock-host-narrow-320, stock-host-detail-narrow, stock-host-gallery-narrow and stock-host-gallery-desktop (all .png). Emmet visually inspected desktop stock,375narrow,320detail and both gallery views; explicit no-overflow checks cover320/375/desktop. This fixture uses actual routes and compiled authored source but fixture employee/stock and a compiler import for partially compiled Angular libraries. It proves neither real OIDC/Java/nativePG/hosted/Safari/private nor production CSP/AOT/full accessibility. The account target is verified against actual account code and the router call in selected tests; no browser account journey or review handoff is claimed.

Evidence root: `.claude/test-runs/fucq442/stock-host/`. Final `heap384-receipt.json` and `browser-receipt.json` each pin **178 current inputs**, all independently matched; `browser-summary.json` holds15 checks/seven captures. `lead-input-resource-audit.json` at **17:27:51 UTC** independently confirms four owned local roots, eight recorded groups and all four supervisors absent, dependency link absent, canonical tokens absent under the short lock, and all five borrowed identities/caches unchanged. Unrelated reservations were left alone. Final selected peak RSS **1,249,509,376 B**, combined RSS+scratch **1,559,242,854 B**, scratch high-water **318,842,118 B**. Browser peak RSS **1,245,151,232 B**, combined **1,567,876,991 B**, scratch **322,725,759 B**. The new owned runner includes its Python supervisor plus recursive descendants and recorded detached groups; the earlier release's supervisor-omission qualification remains.

Retained failed attempts: `first` stopped at measured RAM 1,351,647,232 B > 1,342,177,280 B grant; `heap512` stopped at 1,479,655,424 B. Both compiled and reached the test runner but produced no completed test result; rc -15 was the resource sentinel shutdown. Neither is a passing resource check. Lowering per-Node heap to 384 MiB allowed the unchanged selected checks to finish within the original grant. Logs/receipts remain; no product test assertion failed. Every allocation used explicit neutral local policy (`local_scratch_reason=Gary explicit OneDrive prohibition14Nov2026`, output_root=/private/tmp), manifest/finalizer before allocation, canonical grant/readback, one worker, 768 MiB scratch + 1280 MiB RAM, inclusive 2 GiB, 5 GiB reserve and 480s work/600s total. Installed tools/private caches only; no downloads. No OneDrive read/write/probe/cleanup/audit/sync occurred; no cloud status was refreshed.

Both original AC stay unchecked and the same five slices stay fixed: typed-projection/browse-state complete at frontend boundaries, view-parity in-progress, review-proof/java-integration not-started. Original review handoff, independent whole-Story proof and real connected/hosted/platform acceptance remain open. FUCQ-504 Medium (source-failure detail messaging), FUCQ-505 Low (restored-selection close focus) and FUCQ-499 Low (checker false positive) stay separate, native-linked, unclaimed/unfixed/nonblocking; none was repaired or made a new merge dependency. Full boundary remains historically FAILED rc1. No Built/In Review/Done/Jira transition or deployment claim. Emmet requested/selected/effective Sol/high, no fallback/new descendants. HOLD final source+own metadata for dispatcher publication; no worker push/sync/rebase/merge.

Dispatcher event for serial shared-log append: DL-20261114-GC-009 is **mitigated locally** by the new supervisor-inclusive recursive/group accounting and independent final teardown. Two real RAM-limit stops are preserved; a 384 MiB Node heap enabled 27 selected passes and 15 browser checks under unchanged limits. This is local runtime mitigation, not a shared framework fix. DL-GC-001 finite source/check release completed route/history and additive shared-card integration without a preparation/permission round; unresolved manual-review contract remains explicit. Shared dispatcher-learnings was read and left untouched.


## Dispatcher source obstacle update - 16 November 2026

F443's independently reviewed incomplete frontend checkpoint is integrated and
pushed at bf21ae27d. The stock route now hands the exact descriptor to the actual
manual route rather than the former StatePage placeholder. The directly affected
stock route's 14 selected module checks passed among F443's 80 selected passes.
This resolves the recorded source-level onward-consumer obstacle only; actual
connected/rendered stock-to-review proof and both original F442 ACs remain open.
The final manual order submission is intentionally disabled until Java supplies
review-details/version authority. No F442 worker is currently executing; its
reporting reservation moves from blocked to held, native In Progress unchanged.
No Bug repair, new acceptance gate, Story closure or runtime is implied.
