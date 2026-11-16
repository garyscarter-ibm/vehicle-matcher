# Manual journey composition gaps — 16 November 2026

Source observation: published `gcsp-poc-dev` at
`da53e8f4d99bb1abeb49af58756a3715fcf7dc5c`. This records remaining work within
the frozen migration contracts, not additional acceptance criteria or a runtime reproduction.

The replacement paths below are already in
`migration-baseline-2026-11-13/inventory.json`. Inspection of the published Java
resource annotations and source finds no corresponding registration:

| Existing replacement path, below `/api/gcsp/v1/` | Methods | Existing seam |
|---|---|---|
| `manual/draft` | GET, POST | F458 manual context; F440/F442 consumers |
| `manual/draft/discard` | POST | F458 manual context; F440 consumer |
| `manual/stock` | GET | F458 manual context; F442 consumer |
| `manual/quote` | GET | F463 manual claims; F443 consumer |
| `manual/review-details` | GET, POST | F468 manual ordering; F443 consumer |
| `brief/preview` | POST | Existing brief migration contract |
| `brief/change-after-decline` | POST | Existing brief migration contract |

`AccountResource.java` exposes `manual/account`; `ManualClaimsResource.java`
exposes claim/read/review/release; `OrderingResource.java` exposes manual
order/terms; `BriefResource.java` exposes history/draft/editor/preferences,
confirmation and engagement controls. The route names above are absent from
the Java source at this observation. The inventory's ownership associations
identify seams to reconcile, rather than adding a new contract to any Story.

Account's client reads the draft on load and uses draft/save/discard and stock
paths for the existing journey. A route-level 404 can resemble a legitimate
absent draft, so rendering an Account page does not prove its journey works.
The existing client validators must remain intact. No actual HTTP failure,
severity decision, repair or connected acceptance is established by this source audit.

The backend Stories F458/F463/F468 were natively In Review at the 11:33 UTC
snapshot. Their statuses are preserved; that status alone does not establish
connected route coverage. Current Java work must be coordinated with its
existing writers. Original PostgreSQL, authority, replay and presentation
validation remains required for the relevant original contracts.

Account has independent work against the already present `manual/order` and
`orders/progress/all` producers: truthful independent handoff and complete or
incomplete order-list composition. The original worker already prepared this
source in unpublished `fa4996cd53766085a2f2950590954a641fce4f5f` on 14 November.
It remains unvalidated and unintegrated at this observation. Reuse that
checkpoint and matching historical evidence; do not implement it a second time.
Both original F440 acceptance criteria remain open.
