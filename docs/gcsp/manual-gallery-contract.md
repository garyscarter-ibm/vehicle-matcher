# Manual released-car gallery and review boundary · FUCQ-69

Contract proposed for the rendered slice, 5 November 2026. The independently tested DOM-free projection/controller currently prepares the exact selection handoff and makes no claim request. This document fixes the next composition boundary with FUCQ-70; it does not claim the rendered integration is implemented or validated.

## Read and inspect

`createManualGalleryController` consumes `adapter.browseStock()` through the existing authenticated `GET /api/gcsp/manual/stock` route. Only the server supplies stock, visibility, gates, terms and revisions. Search, series/body navigation, sorting, image viewing and opening exact details never claim a car. Each card/detail is keyed by `orderUuid`; `configurationId` and image/catalogue identifiers are never a claim key.

The exact selection descriptor is `{ orderUuid, orderNumber, configurationId, candidateKey, snapshot, facts, terms, draftVersion, versions, decisionVersions, claimInput }`. The descriptor preserves all server-issued fields and passes `claimInput` verbatim. FUCQ-66's published contract is `f81855f:docs/gcsp/manual-claims-contract.md`, SHA-256 `9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`.

## One explicit claim

The rendered FUCQ-69 action owner handles **Review this car**. It invokes `POST /api/gcsp/manual/claim` with `{ commandId, ...claimInput }` once for the explicit selected-car attempt. The command ID remains stable for identical retries of that unresolved attempt. Repeated clicks coalesce while a request is in flight. Reading, repainting, filter changes and FUCQ-70 mounting cannot invoke this command.

The action owner reconciles through `GET /api/gcsp/manual/claim`. A timeout is uncertain; a `pending` envelope remains pending. Neither emits a confirmed handoff or starts a second claim. Conflicts and stale versions provide refresh/review recovery; after a definitive failed attempt, a new explicit choice uses the freshly supplied exact identity/revisions. A refresh cannot replay an old payload with a new command ID while its outcome is unresolved.

## Confirmed handoff to FUCQ-70

On current authoritative readback with `status: ok`, matching selected `orderUuid`, an `active` owned hold and a matching pinned quote, the gallery invokes `onClaimConfirmed({ selection, claim, commandId })`. Here `selection` is the exact descriptor above and `claim` is the complete current server read envelope, retaining hold/quote IDs, versions, expiry and source facts. The mounted block also emits bubbling/composed `gcsp:manual-claim-confirmed` with the same detail. The callback/event are two notification forms for the same transition; a host must subscribe to one, or deduplicate by hold ID.

FUCQ-70 accepts the existing confirmed hold and pinned quote. It **does not call POST /manual/claim again**. It re-reads current authority through `GET /manual/claim` or `/quote`, displays pending/expired/released/current state truthfully, and owns only the explicit once-only `POST /manual/claim/review` phase transition when its required review fields validate. Saving contact fields and draft-version handling follow the separately agreed FUCQ-66/FUCQ-70 contract; the gallery cannot invent or reprice them.

For a pending/failed/unavailable attempt there is no `gcsp:manual-claim-confirmed` event. Browse recovery stays with the gallery until authority is resolved. Claim service endpoints, current-run/employee authority, idempotency, expiry and quote validation remain FUCQ-66's responsibility.

## Required integration evidence

Keep read-only unit/gallery fixtures separate from actual FUCQ-92 released runs. Prove one explicit click creates one occupying hold, duplicate clicks/retries preserve its command/hold identity, timeout/pending emits no success and survives re-read, and FUCQ-70 mounts the existing hold without a second claim. Desktop/320px/keyboard, source/no-stock/empty-search/car-taken recovery, image failures and the authored serial full suite remain required before completion.
