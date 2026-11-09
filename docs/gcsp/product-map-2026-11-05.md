# Product map and scaffolding refresh — 5 November 2026

The [connected map](https://garyscarter-ibm.github.io/vehicle-matcher/product-map/) covers 20
capabilities and all 107 authorised implementation Stories in the observed FUCQ backlog.
[PR #32](https://github.com/garyscarter-ibm/vehicle-matcher/pull/32) merged on 5 November at
22:57 UTC. Pages succeeded and the canonical page, snapshot and stylesheet returned HTTP 200;
the served snapshot generated at 23:03:27 UTC contains all 20 capabilities. The original map is live.
After checkpoint `5af2555` was pushed, its branch notification succeeded and the served snapshot
generated at 23:05:49 UTC advertised that exact GCSP revision, verifying pushed-commit refresh.

## Scaffolding 0.7.2 presentation refresh

Russell requested improvement against the new scaffolding rules. The shared renderer now uses
Carbon Gray 100, full-card status fills, locally packaged IBM Plex Sans, per-Story human/agent
identity labels and a full-width landscape with modal component details. Close, Escape and
backdrop dismissal restore focus; Tab stays within the dialog. Shared component hashes open the
dialog, while refreshing a dismissed selection keeps it closed. Mobile details remain scrollable.

The updated preview is `.claude/product-map-preview/index.html`.
[PR #33](https://github.com/garyscarter-ibm/vehicle-matcher/pull/33), requested for Gary's review,
updates the trusted main renderer. **Public Carbon delivery remains pending** its protected-main
review/merge, Pages deployment and served-asset readback. Existing retail assembly, API rewriting,
Pages policy and empty main input stubs are preserved. GCSP owns the map facts; main owns the
trusted renderer. Publication does not merge the GCSP application into the retail site.

Status arithmetic and acceptance remain unchanged. In Review is fully developed and green;
Done is accepted and blue. Missing full slice plans remain unknown. Human assignment never
establishes current agent activity, and rebuilding never refreshes source observation times.
Stable capability IDs, Story associations and current work facts were preserved byte-for-byte.
The project-owned Jira importer and publication workflows also remain intact.

Scoped checks passed seven renderer DOM scenarios and 25 real Chrome desktop/mobile checks at
1440px and 390px. All 20 cards and 52 connections rendered without JavaScript errors or horizontal
overflow. Dialog focus/dismissal, shared hashes, Story search, refresh, local fonts and identity
labels passed. Screenshots and bounded results are retained under
`.claude/test-runs/checkpoints/product-map-carbon-20261105/`; the impact map is under
`.claude/test-runs/impact/product-map-carbon-20261105.json`. Application suites were excluded:
no application code, component contract or HLD changed.

An isolated publication build using the GCSP baseline at `69081a8` produced all 20 capabilities
and shipped fonts/licenses. It disclosed one existing FUCQ-113 fact conflict between `gcsp-poc`
and `dev/DEV-2026-11-04-088`, leaving progress unknown. The earlier served snapshot has additional
branch-fact conflicts. These are data reconciliation work, not fabricated delivery percentages;
pollers should reconcile their own durable records while retaining claims and acceptance evidence.

## Poller handoff

GC pollers: pull the tooling checkpoint, read the generated `AGENTS.md` section and the
scaffolding `product-map` skill, then maintain `.product-map/work.json` with existing claimed work.
Record full slice plans including integration and passed delivery evidence. Keep Jira observations
current through the authenticated connector. Follow the
[maintenance and publication contract](../../.product-map/README.md).

Preserve leases, claims, retained branches and human pause boundaries. This tooling request does
not restart a dispatcher, take a Story or change acceptance. FUCQ-100 comments **132588** and
**132590** delivered the original immediate and concrete tooling alerts. The Carbon follow-up
was delivered in comment **132592**, with checkpoint `5af2555`, PR #33 and the source-conflict
reconciliation note.

The [installation note](scaffolding-install-2026-11-05.md) corrects the obsolete administrator
steps. Native Codex hook review and Claude's already-queued 0.7.2 pin verification belong to the
separate scaffolding rollout; no application restart or hook-trust change was performed here.

Disposable scratch was removed and absence verified; the owned HTTP server stopped and joined,
and the isolated headless Chrome context closed. The cleanup receipt records 62,930,734 bytes
maximum observed scratch, including the bounded local browser profile and isolated Git/build
fixture. Retained evidence is in the checkpoint directory above; no disposable leftovers remain.

## Publication freshness, 9 November 2026 (FUCQ-166)

A successful `deploy-pages` step is not evidence that the public map changed. On 7 November run 42374327870
deployed artifact 13574902456 (map sha256 `7ed0cc0a...`, generated 12:51:51 UTC) while the public
`product-map/data.json` kept serving the 00:57:38 UTC snapshot, including on an uncached edge read; only the
13:02 UTC main deployment was served. The retained observations are in
[the publication evidence](evidence/f58-63-final-publish-actions-2026-11-07/) and stay unchanged.

`pages.yml` now ends with **Verify the public product map** (`_tools/pages_readback.py`). It reads the public
data.json with a unique query string and `Cache-Control: no-cache` every 15 s for up to 10 minutes and passes
only when the served body's sha256 equals the uploaded file's. Otherwise the run fails with an `::error::` line.
The receipt in the step summary and log records the run, event, `pages_build_version` (GITHUB_SHA), artifact id
and each attempt's hash, `generated_at`, Age, X-Cache and Cache-Control.

Freshness limits:
- A green Pages run means the public body matched within 10 minutes of deployment. A red verify step means it
  did not, and the map must not be read as current until a later run passes.
- The gate bypasses edge caches with unique queries. An ordinary browser or link without a query can still see
  the previous object for up to the `Cache-Control` max-age the receipt records.
- Only the product-map data.json is checked; the retail demo files in the same artifact are not.

The serving cause is unconfirmed. Every `workflow_run` and dispatch publication uses the main head as
`pages_build_version`, and the first publication on a new main SHA was served at once, but same-SHA publications
were also served on 5 and 7 November. The receipts from two or more same-SHA data pushes, compared with the
github-pages deployment list, settle it. If same-version deployments prove unserved, the next correction is a
unique `pages_build_version` through the documented Pages deployments REST API. Nothing here changes the
main-only deployment policy or runs branch code.
