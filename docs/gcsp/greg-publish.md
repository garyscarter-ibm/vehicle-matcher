# Greg policy projection, preview and publication · FUCQ-103

`createGregPublishService({ repository, policy, clock, identity })` in
`server/gcsp/greg/publish/index.js` exposes `readPolicy(context)`, `preview(context, input)`
and `publish(context, input)`. All require the actual DemoIdentityAdapter's Greg guard and
current run. `buildServer` registers these routes and composes publication activation from
`gcspRepository`, `gcspPolicy`, `gcspClock` and `gcspIdentity`; an explicitly injected
`gcspGregPublish` can supply the same service port. Screen composition remains the integrating
story lead's work.

The implementation follows `experience-quality.md`, `build-rules.md`, the HLD's Greg supply
loop and `COMPONENTS.md`. Shell references are `screens/00-employee-account.webp` and
`screens/01-replace-vehicle.webp`; body reference is `evidence/fucq-6/README.md`, revision
`a7fc178`, using current Density tokens and Greg's denser operational treatment. No screen
is changed here, so this slice provides response/state tests rather than new screenshots.
Desktop, narrow-width, keyboard and integrated screen evidence remain integration acceptance.
The ordinary HTTP employee reload/evaluation boundary is covered below with real services
and memory persistence, without a browser or native database claim.

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
`activationRequired` flag and an `activation` outcome. After acceptance the trusted
`activateRunPolicy` composition resolves the effective version at the persisted
`runs.clockInstant` and compare-and-swaps both `runs.policyVersion` and
`runs.versions.policy`. It preserves every other run field and never rewrites existing
quotes, holds, offers or history. The CAS fences concurrent run/clock changes, retries up
to three times and rechecks the final clock/version pair. A coherent repeated activation
does not open a transaction. Stable activation command digests include the run version,
clock instant and target policy version; a lost response can reconcile from the persisted run.

Accepted publication stays accepted if activation or held-offer readback fails. Activation
returns either `{ status: 'active', policyVersion, asOf, publishedVersionActive }` or
`{ status: 'pending', policyVersion, retryable: true, reason, outcome }`. Pending activation
sets `activationRequired: true`. Retry the original unchanged publication command to reconcile;
the immutable provider receipt prevents another append. An active outcome identifies the
actual effective version, which can differ from the published version after a later clock
advance. Held-offer readback failure reports a refresh message rather than rejecting the
already accepted publication.

Ordinary `resolveSession`, presenter session creation and principal switching adopt the same
persisted domain-time version before minting a branded context. Previously minted context
objects remain immutable; the same employee cookie obtains the new version on the next
ordinary resolution. `requireRole`, resource authorization and repeated guards stay read-only,
and preview never invokes activation. Session expiry and issuance always use the injected
server wall clock, independently of the demo date. Identity-only legacy runs with no
`clockInstant` retain their existing pinned identity behavior and skip adoption; the helper
never substitutes wall time for missing domain time. Invalid persisted clocks fail closed.
There is no additional employee-context resolver API.

`heldOffers` counts active, decision-pending, selection-pending and release-pending offers backed
by an occupying hold and matching pinned quote. Elapsed plain active offers/holds are excluded
without writing expiry state. Pending operations retain protected terms beyond the original
deadline until their occupying hold is reconciled. After publication it
counts offers pinned to a version other than the published version. The message says how many
held offers keep their earlier terms. Historical quote, hold and offer payloads remain unchanged.

`createGregPublishRoutes(service)` in `publish/http.js` supplies registered Greg-only
`GET /api/gcsp/greg/policy`, `POST .../preview` and `POST .../publish` definitions.
Query selectors and nonempty GET bodies are rejected; the shared handler's internal empty
GET body is accepted. The ordinary shared HTTP gate supplies trusted context, exact-origin
and session checks, role checks and no-store handling. Browser policy pins and identity
claims cannot select the run or policy.

## Scoped validation and boundaries

Use `python3 docs/gcsp/evidence/fucq103/scoped-supervisor.py <mode>` with `publish`, `scoring`,
`policy-demand`, `activation`, `activation-http`, `identity-clock` or `employee-boundaries`. Each chunk has one worker, 120 seconds, 768 MiB RSS, 128 MiB scratch and
2 MiB output limits. Fresh HostBudget reservation, external ownership manifest, registered
finalizer, descendant/process-group cleanup and scratch deletion are checked per chunk.
Existing shared dependencies are temporarily adopted by owned symlinks and preserved; no
installation or credential-file read occurs. Database environment aliases are removed.

The affected-selector dry-run has no JavaScript plug-in and proposes the full `npm test` fallback.
These checks explicitly replace that broad plan: new publish tests protect bounded edits,
legacy adoption, real no-write preview/fit, immutable publication, replay/stale/rejection,
role/route/privacy states and pinned offers. Existing employee recommendation/API/feedback
checks cover the scorer's callers; policy versions/service and Greg demand checks protect
retained reads and existing projections. Activation checks cover scheduled refresh, CAS fences,
lost responses, accepted-but-pending replay, guard writes and separate security/domain clocks.
The ordinary HTTP proof uses a retained calibration without preference weights, real Greg
and recommendation services, registered routes, session switching and employee context reload.
It observes zero preview transactions after context resolution, new points/scoring on employee
evaluation, canonical privacy suppression and unchanged calculated pinned quote terms.
Full suite, native PostgreSQL and browser evidence remain outstanding integration acceptance.
No live BMW, email or deployment is exercised.

## Additive assumptions and retained policies

The stable migration boundary is the append-only PolicyService publication provider, followed
by trusted domain-time run adoption. Each new policy snapshot retains existing keyed rows,
values and provenance unless its bounded change set explicitly revises them. FUCQ-103 adds
only the narrowly validated `employee.recommendation.v1.preferenceWeights` shape migration
described above. It does not authorize arbitrary new assumption keys or change the seed.
Future learning/generator assumptions must use their own reviewed, keyed additive migration
through this same publication boundary and preserve unrelated calibration and clock assumptions.
They must not replace the active snapshot, reseed retained `gcsp-policy-v1`, infer browser
defaults or add an alternative activation/context API.

The HTTP proof's legacy calibration lacks preference weights but its canonical snapshot
already includes `clock.presenter.stepSeconds`. It does not prove adoption for stored
policies missing that key. FUCQ-126's separately owned correction is required to keep core clock/reopen usable
without the presenter step assumption; presenter controls remain explicitly unavailable
until a sanctioned successor adopts the missing key. General absent-key publication is
still an integration gate and is outside this slice. FUCQ-113 can integrate future keyed
assumptions compatibly at that reviewed seam; this slice does not broaden its scope.
