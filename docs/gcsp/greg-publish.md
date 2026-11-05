# Greg policy projection, preview and publication · FUCQ-103

`createGregPublishService({ repository, policy, clock, identity })` in
`server/gcsp/greg/publish/index.js` exposes `readPolicy(context)`, `preview(context, input)`
and `publish(context, input)`. All require the actual DemoIdentityAdapter's Greg guard and
current run. These are backend presentation contracts; route registration, run/context
activation and screen composition remain the integrating story lead's work.

The implementation follows `experience-quality.md`, `build-rules.md`, the HLD's Greg supply
loop and `COMPONENTS.md`. Shell references are `screens/00-employee-account.webp` and
`screens/01-replace-vehicle.webp`; body reference is `evidence/fucq-6/README.md`, revision
`a7fc178`, using current Density tokens and Greg's denser operational treatment. No screen
is changed here, so this slice provides response/state tests rather than new screenshots.
Desktop, narrow-width, keyboard and employee reload evidence remain integration acceptance.

## Editable contract

`readPolicy` returns the active dated version resolved at DemoClock now (independent of an
older run policy pin), its effective date, clock/as-of, editable fields, held-offer count and
history message. Fields retain stable IDs, values, source/date, assumed/verified status,
basis and units. The entire policy seed never crosses HTTP.

* `price:<pricePlans row.key>` changes that effective row's `monthlyPoints` and `value`
  together. All effective price rows are listed, with scheme and exact match/configuration facts.
* `weight:<preference key>` changes
  `employee.recommendation.v1.value.preferenceWeights[<key>]`. The complete key set is the
  existing registered preferences: body, fuel, sportiness, comfort, economy and size.
* Values are nonnegative safe integers, step 1. Points use `points/month`; weights use
  `relative-weight`. Duplicate, unknown and no-op-only changes are rejected.
* Allowances, eligibility, essentials, hard filters, the preference/essential schema, existing
  one-dimensional `tuning.weights`, and other assumptions cannot be edited through this service.

Legacy retained policies have no `preferenceWeights` map. Their employee score remains the
existing employee-importance mean. The server projects a neutral adoption proposal of 1 for
each registered preference, flagged `weightsAdoptionRequired: true` and `adoptionRequired`
on weight fields. This is a server-owned compatibility proposal, not a browser policy default.
A first weight publication adds the complete map only to the new immutable successor.
PolicyService allows that single additive shape migration for this exact assumption; every
existing calibration value must remain equal during adoption. Other shape changes and partial,
negative or fractional maps are rejected. The canonical seed is unchanged.

When a complete map is present, employee fit aggregates each independently calculated dimension
using `effectiveImportance = employee importance * policyWeight`. Configured-map component evidence keeps all
three values separate; absent-map component payloads retain their exact existing shape. Zero weight contributes zero; zero total importance yields a null score.
An absent map is mathematically neutral, preserving existing scores and ranking. A malformed
map fails evaluation. Gates and suitable-candidate counts remain independent of fit weighting.

## Inputs and outcomes

Preview accepts exactly:

```json
{
  "expectedActiveVersion": "gcsp-policy-v1",
  "changes": [{ "id": "weight:body", "value": 2 }]
}
```

Publication accepts exactly the same fields plus `commandId`, a new `policyVersion`, and
`effectiveFrom` copied from the projection's `asOf`. It is intentionally immediate:
future input is rejected. An unseen past command is rejected by PolicyService; an identical
recorded command can be replayed at its original instant. Retry with the original unchanged
input, including effective date. A changed retry conflicts. Scheduled retained successors can
prevent immediate publication under PolicyService's existing version-order rule; this panel
does not pretend its active-version preview simulates those later scheduled versions.

All responses retain the common `status`/`contractVersion` envelope. Invalid changes include
typed code and field/reason records. Stale reads retain refresh guidance. Non-Greg and forged
contexts retain the actual identity refusal. Consumers can render draft, preview loading,
preview ready, publishing, published, rejected and refused states using these outcomes.
Loading/publishing are client request states; the backend reports completed outcomes only.

Preview resolves the active PolicyService snapshot, applies bounded edits to a clone and creates
an ephemeral PolicyService with a distinct preview digest version. It calls the real Greg demand and employee recommendation services
on both variants. It returns `preview: true`, active/draft demand and fit aggregates and explicit
field differences. Fit is the mean best available eligible score across scored saved briefs,
labelled as recommendation fit, not predicted acceptance. Existing unchanged-decline exclusions
apply. Tiny counts and fit means use the same canonical demand privacy threshold. No employee
identity or individual score is exposed. Repository and clock rechecks reject a mixed read.
No repository, policy provider, offer, quote, hold, brief or employee write occurs.

Publish delegates to `PolicyService.publishPolicyVersion` with bounded patches and synthetic
provenance. The immutable provider records Greg's principal, publication instant, effective
instant, source version and command receipt. Success returns those accepted values and an
`activationRequired` flag plus `{ policyVersion, effectiveFrom }` for integrating activation.
It does not claim that a run or previously issued employee context has been activated.

`heldOffers` counts active, decision-pending, selection-pending and release-pending offers backed
by an occupying hold and matching pinned quote. Elapsed plain active offers/holds are excluded
without writing expiry state. Pending operations retain protected terms beyond the original
deadline until their occupying hold is reconciled. After publication it
counts offers pinned to a version other than the published version. The message says how many
held offers keep their earlier terms. Historical quote, hold and offer payloads remain unchanged.

`createGregPublishRoutes(service)` in `publish/http.js` supplies unregistered Greg-only
`GET /api/gcsp/greg/policy`, `POST .../preview` and `POST .../publish` definitions.
Query selectors and GET bodies are rejected. The shared HTTP gate must supply trusted context,
origin/session checks and no-store handling when the parent registers these routes.

## Scoped validation and boundaries

Use `python3 docs/gcsp/evidence/fucq103/scoped-supervisor.py <mode>` with `publish`, `scoring`
or `policy-demand`. Each chunk has one worker, 120 seconds, 768 MiB RSS, 128 MiB scratch and
2 MiB output limits. Fresh HostBudget reservation, external ownership manifest, registered
finalizer, descendant/process-group cleanup and scratch deletion are checked per chunk.
Existing shared dependencies are temporarily adopted by owned symlinks and preserved; no
installation or credential-file read occurs. Database environment aliases are removed.

The affected-selector dry-run has no JavaScript plug-in and proposes the full `npm test` fallback.
These checks explicitly replace that broad plan: new publish tests protect bounded edits,
legacy adoption, real no-write preview/fit, immutable publication, replay/stale/rejection,
role/route/privacy states and pinned offers. Existing employee recommendation/API/feedback
checks cover the scorer's callers; policy versions/service and Greg demand checks protect
retained reads and existing projections. Full suite, native PostgreSQL, ordinary HTTP employee
activation/reload and browser evidence remain outstanding integration acceptance, not fixture
claims of completion. No live BMW, email or deployment is exercised.
