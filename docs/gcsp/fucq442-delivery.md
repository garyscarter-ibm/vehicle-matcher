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
