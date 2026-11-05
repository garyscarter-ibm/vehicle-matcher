# FUCQ-49 source gate — 5 November 2026

Recorded before provider implementation or live qualification.

Gary’s [5 November source decision](../../fucq-58-source-authorisation-2026-11-05.md) selects read-only BMW public UK configurator delivery and permits retention and display of the resulting configuration data and images for this project for as long as needed. The observed COSY dynamic named-image manifest and its returned assets are delivery within that same source/use. The dispatcher confirmed this assessment on 5 November. No further collaborator ratification is required. This selects an unsupported public website demo provider, not a BMW-supported API arrangement.

## Registered source and access

- Public source: `https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ`; anonymous public settings on that same origin. Read the relevant COSY backend profile and keep its application `x-api-key` solely in backend process memory. Do not borrow user credentials or sessions, log settings or print keys.
- Manifest origin: `https://prod.cosy.bmw.cloud`; only `/image-urls/dynamic-named-images/mandators/connext-bmw/collections/stage-fullscreen-views-legacy-newnames/brands/bmwCar/models/{AG}` with compact effect date, `CLOUD_PROD_INTERNET`, `webp` and sorted complete selected options. No catalogue request is required.
- Asset origin/path: `https://prod.cosy.bmw.cloud/connext-bmw/cosySec`; only exact opaque URLs returned by a validated manifest. Never rebuild, amend, infer expiry, expose credentials, accept a caller-supplied URL or follow cross-origin redirects.
- Native COSY manifest replay is not proved by the existing evidence. The browser manifest and independently retrievable returned images are different access facts. Qualification records actual outcomes without turning mocked success into live completion.

## Finite qualification budget

At most five GETs: up to two public page/settings discovery reads, up to two manifest reads, and one returned image; one image maximum, 6 MiB aggregate response bytes, zero retries, concurrency one, 90 seconds total and 15 seconds per request. `cache: no-store`, no cookies, no redirects, no disk cache. Stop on access failures, unknown source/profile, malformed records, redirects or exhausted budget. No customer login, private VIN/plate, garage/save/order operation or bulk collection.

The versioned external run plan is the shared root’s `.claude/test-runs/fucq49/plan-v1.json`; supervisor/ownership receipts remain there. RAM 768 MiB, scratch 128 MiB, logs 2 MiB, wall 120 seconds per native/offline chunk. No browser, server port or profile allocation. Only sanitised selected schema, counts, hashes and identity checks may be retained. Remove scratch and disposable logs and verify owned processes/groups/host reservations absent. Package and lock files must be unchanged. OneDrive is unavailable; retained artifacts remain small.

## Contract and validation

C14 consumes the complete known snapshot identity, canonical AG model, compact effect date, sorted options, requested viewport/view/size. Validate manifest identity/paint before selection; missing identity evidence stays unknown or unavailable. Named assets and supported dimensions/content type must come from actual validated records. Complete options do not establish wheel/interior/equipment/exact-car fidelity. Snapshot remains the default; source choice is explicit and failures never silently switch provider or overwrite specifications.

Normal tests are offline: `node --test server/test/bmw-live-imagery.test.js server/test/bmw-image-adapter.test.js`. The authored `npm test` runs once at final integration after dispatcher grants the single full slot; use a matching strict stamp. No screen is added: presentation-contract scenarios cover representative labels, provenance, unknown fidelity and unavailable states. The visual contract remains `experience-quality.md`, shell references `screens/00` and `screens/01`, approved body reference `evidence/fucq-6/README.md` revision `a7fc178`, and `COMPONENTS.md`. No policy assumptions are introduced; any future scheme rules must use PolicyService.
