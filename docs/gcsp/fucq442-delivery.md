# FUCQ-442 delivery record

Story: DEV-2026-11-13-010. Lead: Emmet (they/them). Branch: `dev/DEV-2026-11-13-010`.
Kickoff reference: `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; admitted worker base: `382b52e2e5a0b2ae5da00119f97b9c8c8d492ad8`.

## Fixed contract and boundary

Preserve both original acceptance criteria: existing filters, paging/history and vehicle detail use actual released-stock/API projections while preserving the exact car; missing facts/images, empty stock, source failure and stale/unavailable selections retain meaningful outcomes. No redesigned browsing or client policy calculation.

`AccountClient.readStock()` already reads the agreed bearer endpoint `/api/gcsp/v1/manual/stock`, including `manual-stock-compact-v1`. Its loose `EvidenceRecord` rows need a stock-owned typed projection before use. `blocks/gcsp/manual-gallery/gallery-model.js`, `gallery-controller.js`, the browser/account stock expander and server compact producer establish the source semantics. Exact identity is `orderUuid`; multiple cars may share a `configurationId`. Eligibility, source/policy/quote versions and issued claim inputs stay attached to that same car.

The admitted Java tree contains supply/released-stock and presenter resources; it does not establish the employee manual-stock projection. Presenter data cannot substitute for the employee contract. Java producers remain Russell's scope. Actual Java/native PostgreSQL/OIDC/hosted/Safari/private acceptance remains open. Fixtures prove only their stated frontend boundary.

## Stable delivery slices (13-point capability)

1. `typed-projection` (3 points): typed validation/expansion and source-backed exact car, details, decisions, quote/version projection. Named spec: `stock.projection.spec.ts`.
2. `browse-state` (3 points): read-only scoped load, filters, paging/history/detail selection and stale/failure/account/run/late-response handling. Named spec: `stock.store.spec.ts`.
3. `view-parity` (3 points): native Angular stock composition preserving the frozen gallery visual/behavior contract; named spec `stock.component.spec.ts` plus rendered desktop/narrow states.
4. `review-proof` (2 points): substantive lead and independent review, selected regression/ratchet/boundary and rendered keyboard/focus/reduced-motion/CSP/accessibility evidence.
5. `java-integration` (2 points): dispatcher route/shared-kit integration and actual Java browse/detail/navigation with two cars sharing one configuration, exact identity/eligibility/quote continuity; native PostgreSQL/OIDC/hosted and applicable Safari/private evidence.

Stable IDs include the required integration gate. No partial checkpoint means Built, In Review, Done, full acceptance or 100% developed.

## Component and file plan

Reuse committed Angular `ButtonDirective`, `ScreenIntroComponent`, `StatusScreenComponent`, `LabelledFieldComponent` and semantic Density tokens. Stock is view composition under `apps/gcsp-web/src/app/stock/**`. The dispatcher owns routes, shell/auth, existing/all shared kit, global CSS, catalogue/gallery and build/runtime configuration. FUCQ-445's four new drawer/tabs/media/details families require reviewed integration before use. No private copy of those shared components is planned.

Only stock files, this unique record, the claimed Story record and this Story's product-map row are writable. Preserve foreign map rows exactly. The existing `manual-journey` association already includes FUCQ-442; no component boundary change.

## Validation and resource selection

Start with exactly named stock specs using pinned Node 24.22.3/npm 11.19.1/Angular 21.2.26 and `ng test --watch=false` with a single worker. Each chunk is at most 600 seconds, one worker, at most 2 GiB scratch, with a 5 GiB emergency disk reserve and smaller chunks near 30 GiB free. A manifest and supervisor finalizer precede every scratch/link/process allocation. Retain bounded evidence under root `.claude/test-runs/fucq442`; outputs expected above 256 MiB go directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq442`. Preserve borrowed worker007 dependencies/runtime/cache and foreign links.

Typed checks cover compact/full shape, exact same-configuration cars, malformed/inconsistent source identity and quote/version data, known/unknown facts and images, empty/failure and invalid release history. State checks add filter/paging/back-forward, stale/denied/account/run change and late reads. Route, shared-kit, rendered and actual producer checks remain separately open until performed. No full suite is justified by this isolated checkpoint.

## Current checkpoint

2026-11-14: gateway PASS at `api.servicesessentials.ibm.com`; actual worker helper base `gcsp-poc-dev`, merge `auto`, expected branch, clean admitted HEAD confirmed through worker scaffold API and checkout mutex. Mandatory project/Story/procedure references inspected. No tests, dependency links, browsers or runtime processes allocated yet. Lead starts the typed boundary slice under the fixed original contract.

## Reviewed typed projection checkpoint

Source commit `0c547fdb55fcfb507687279fbf64bfba2d4a9c49` adds exactly `stock.types.ts`, `stock.projection.ts` and `stock.projection.spec.ts`. Emmet reviewed the complete added source/spec against ManualContextService.browseStock, ManualClaimsService.browseStock, the release-history decorator, real compact producer and VehicleSnapshot/EmployeeTerms constructors. `validateStockPayload`, `projectStock` and `validStockReleaseHistory` pass substantive review at this pure frontend boundary. There is no production caller yet; filters/state/paging/history and screen composition belong to the remaining declared slices.

The projection retains the complete unranked decision set in `allCars`, while `cars` and `total` preserve the producer's eligible-only membership. Two distinct `orderUuid` values sharing one configuration retain separate snapshots, terms, eligibility and source evidence. Snapshot, availability, terms, draft/context and shared source pins are checked together. Numeric `expectedStockVersion` is a stock-row revision, not the string `versions.stock` source version. The source-issued terms digest remains opaque; the browser neither calculates it nor issues claim authority. A held Buddy entry may have a null offer ID and still blocks review. Missing facts/media and fitted/reference/unclassified evidence remain explicit.

Selected command: `npm --prefix apps/gcsp-web test -- --include=src/app/stock/stock.projection.spec.ts`. Final result: 50 passed, 0 failed, 0 skipped, one file/worker, pinned Node 24.22.3, npm 11.19.1 and Angular 21.2.26. The tests invoke the actual compact producer and snapshot/terms constructors, rather than relying only on copied wire fixtures. The first attempt failed compilation with four TypeScript errors before test execution; `first.log` is retained. Corrected intermediate runs passed 49; the final run passed 50. These are scoped results with no full-suite stamp. No full suite/build is justified by three isolated files with no wired production caller.

Tested tree `e3668979b45a309d3a8615695cb62db4d8d06c5c`. Lead rechecked all ten recorded input hashes and exact tree, source/caller boundaries and diff whitespace. Matching passing evidence was reused without another test allocation. Lead review receipt: root `.claude/test-runs/fucq442/lead-projection-review.json`; child evidence: `imhotep/{summary.json,final-receipt.json,final.log,first.log,ownership-final.json}`. Dispatcher audit: root `.claude/fucq442-projection-parent-audit-0749.json`.

Resource audit passed: five owned process groups (55256, 55437, 55828, 56312, 56080), owned scratch and the temporary dependency link are absent. All five borrowed worker007 toolchain/dependency identities remain unchanged. Maximum measured scratch was 11,054,237 bytes; group RSS 1,012,416,512 bytes. Bounded active compiler/Vite working data was the local compatibility exception and was removed. No large output was produced; the declared OneDrive destination was unused. Lead independently verified the filesystem/process outcome and retained bounded receipts/failure logs.

Imhotep: requested/selected/effective `gpt-6.1-sol` / `medium`, no fallback or descendants; exact thread `01a1d903-a79d-7442-b019-cf6aaee90264`, parent `01a1d901-2715-7062-8602-8b96ff614b2e`, depth 1. Session metadata and turn context verified; saved desktop title **Imhotep** independently read back. Lead Emmet: effective `gpt-6.1-sol` / `high`, saved title **Emmet**. Identity receipt: root `.claude/test-runs/fucq442/imhotep-identity.json`.

At the safe metadata checkpoint after the child's final result, the own map row is reconciled to the dispatcher's verified native In Progress/Gary Carter observation (13 points, started 14 November 2026; native branch comment 3629428, coordination comment 3629429). Historical original status remains To Do. All 301 foreign rows are preserved. Only `typed-projection` is complete at its declared boundary; review/proof and actual Java integration remain open.

Both original acceptance boxes remain unchecked. Required remaining work includes scoped read/state/filter/paging/back-forward/detail behavior; native Angular visual parity and reviewed shared-kit/route integration; independent review and actual rendered desktop/narrow keyboard/focus/reduced-motion/CSP/accessibility checks; actual Java employee manual-stock browse/detail/navigation with two same-configuration stock cars and quote/eligibility continuity; native PostgreSQL/OIDC/hosted and applicable Safari/private evidence. Presenter release stock is not the employee contract. No current defect was established by this slice review; missing producers and unperformed original checks remain acceptance gaps. No Built, In Review, Done or full acceptance is claimed.
