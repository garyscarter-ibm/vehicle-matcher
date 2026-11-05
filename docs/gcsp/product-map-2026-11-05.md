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
