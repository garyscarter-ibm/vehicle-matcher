# Central GCSP integration handoff

FUCQ-103 central edit ownership is released at published checkpoint
`82849155565edbfc792961553d7292b8b5965a35`. Its policy/adoption route registrations,
same-provider runtime composition and domain-time identity activation bindings must be
preserved by subsequent central composition. Local metadata merge
`cec3eced5a848628a95d4961979e75551771e6ac` adds no GCSP runtime changes.

The dispatcher owns the next minimal FUCQ-102 offer-access registration plan. Keep its
separate `offers/access*.js` modules additive and agree central changes through that lane.
FUCQ-103 will coordinate any later backend repair exposed by browser validation.

## Pending outcomes require actual HTTP 202 integration

Dispatcher observation, 5 November 2026: FUCQ-66 checkpoint `66abed096` adds
`pending: 202` in `server/gcsp/identity/http.js`; FUCQ-70 correctly returns a pending
outcome through its route factory. Integrating FUCQ-66 must preserve that mapping alongside
the authored central route/service composition. That FUCQ-66 object is unavailable in this
worktree; its changed-source observation is attributed to the dispatcher.

Locally inspected published `b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96` and this
branch retain a shared `statusCode` map without `pending`. Its fallback is HTTP 500, and
`createGcspHandler` sends route outcomes through that map. A pending route-factory result
therefore does not establish the required HTTP 202 response in this composition.

Required integration evidence: send the real pending operation through `buildServer`, the
ordinary authenticated shared handler and the actual registered route; assert HTTP 202
with the unchanged pending envelope and expected retry semantics. Preserve role, session,
origin, gate and no-store behavior and FUCQ-103 publication/adoption bindings. Metadata
merges, route-factory-only checks and FUCQ-103's unchanged scoped proofs do not establish
this HTTP integration. No runtime edit is made solely for this handoff.

## Publication and remaining story gates

The published FUCQ-103 tip remains `8284915`. Later local commits are not published while
the dispatcher-reported GitHub `fatal: commit_refs_rules` condition remains unchanged.
Use no force push, rules workaround or unchanged retry loop. Browser queue remains
FUCQ-122 diagnostic, then FUCQ-126, then FUCQ-103; full/native/browser execution requires
dispatcher admission.
