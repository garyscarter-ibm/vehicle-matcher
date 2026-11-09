# Producer contracts inspected for the FUCQ-77 verifier

6 November 2026. Read-only inspection of the parent's pinned producer checkpoints:

| Boundary | Inspected source | Observed contract |
|---|---|---|
| F59 collector/session | `fdb71c2a34b3501ed0549424947ec67c1145f433` | `collect-fleet.mjs` SHA-256 `1656b49e2423ab95ebe3e3987c6988f7099f3fe5f590c888dcf324c9e31ee019`; session SHA-256 `aed978263f9c904c9c5f75daf9d1ff254bdd02ec177d5cd04421c5e8cfa70881` |
| F60 pure enrichment | source `cc94edcf6ccdeb5a8b107d8b60e27e7d94461f35`, result `25588ee0e4df0a660e6314f3d8b0bff324236479` | `enrich-fleet.mjs` SHA-256 `fb9ea98a764db00953c26f6ddfc8ab32eafb753573275937b389a66e190cf059` |
| F54 publisher/registry | existing base `e865aa0497ac` | Existing canonical configuration/image/manifest format is preserved. |

These are offline implementation contracts, not live qualification or accepted configurations.
No producer files are edited or copied into this story. The parent coordinates their integration.

## F59 collection proof

Accepted rows carry `configurationId`, `decodedIdentity`, `canonicalIdentity`, `signaturePolicyVersion`,
`modelRange`, `resolvedOptions`, `selectedAccessories`, `selectedElements`, `catalogueRequest`,
`lookupIdentity`, `solverChanges`, `source`, `sourceKind` and `candidateId`. Typed paint/upholstery
and accessories are separated. Model/AG/range/context substitution is rejected by the solver validator.
The request lives in the checkpoint queue, while the accepted row retains added/removed/ignored codes.

The pinned collector intentionally labels rows `sourceKind: offline-fixture` and its report
`qualification: offline-fixture-not-source-qualified`. The collector rejects `mode: live`; the shared
session requires offline operation descriptors and zero source calls. Its CLI accepts `--plan`,
`--offline`, `--checkpoint`, rather than the authored future `--config ... --execute` command.
The `selectPlan` hook selects model codes already present in a finite F59 plan.

Required later canonical integration:

- Guard the accepted F77 plan before session creation, select exact qualified models and keep every
  matrix entry's coverage. Source contexts with different dates need their own bounded plan chunks.
- Keep the actual original candidate request, complete solver response selection, `constructible: true`
  source proof, observation/source dates and requested/resolved changes accessible to the verifier.
  A successful offline normalisation must never be relabelled as a live BMW observation.
- Persist explicit model-year knowledge/unknown provenance separately from order/effect dates.
- Add the actual source executor to the existing collector/session boundary with finite attempt,
  byte, image, elapsed-time, timeout, backoff and checkpoint limits. Enforce the combined F77 ceiling
  of 3,000 source attempts and concurrency at most two across collector, enrichment and browser work.
  Per-operation budgets alone are not proof of that combined ceiling.

No second collector, cache, retry or budget engine is introduced by F77.

## F60 enrichment proof

The pinned module is a pure F39/F40 adapter-envelope projection. Its outputs explicitly say
`scope: pure-enrichment`, with `sharedAccounting: unvalidated` and `corpusIntegration: unvalidated`.
The next canonical F59-session consumer is owned by F60 and was not included in this pin.

The retained record shape contains `identity`, typed facts/equipment/appearance, `sources.catalogue`,
`sources.image`, image content/hash/fidelity/retention metadata, and explicit partial/rejected states.
The five named metrics are seats, normal/expanded luggage, 0–100 km/h acceleration and body length.
Range/economy and CO2 need source-backed named values or named explicit unknowns for F77; an
anonymous count of unmapped measurements does not establish which requested metric is unknown.
The 0–100 km/h source definition must remain visible; do not relabel it as an exact 0–62 mph measurement.

The consumer must preserve each configuration's own catalogue/image identities, source dates,
unknowns and representative exterior fidelity. The same byte hash may share storage but cannot
transfer one configuration's paint/body claims to another. F54's approved image record and local
asset path must be bound to that same configuration without retaining opaque image URLs.

## F54 and remaining proof

F54's current configuration fields are `configurationId`, `snapshotVersion`, `canonicalIdentity`,
`canonicalSignature`, `configuration`, `sourceContext`, `catalogue`, `imageIds`. Catalogue facts are
limited to the five F39 metrics above. F54 requires the adapter's requested and resolved identity
to agree; the collector's original request belongs in collection evidence, not in those F39 fields.
The existing manifest remains conservatively qualified as a bounded fixture or partial corpus.
Any shared format extension needs parent coordination; F77 does not add incompatible fields.

The new verifier reuses F54's real directory/schema/checksum validation. Its focused integration
test writes a tiny candidate through `writeCorpusCandidate` with an empty allocation inventory,
zero VIN mappings, no images and no selected runtime store. It verifies the manifest digest and
rejects a tampered `configurations.jsonl`. No VIN/order/stock generation or runtime activation occurs.
Actual version publication and lookup count/record/hash reconciliation remain separate unfinished gates.

The required 20 real headless deep-link checks remain unexecuted. The retained 4 November research
reports automatic anonymous garage POSTs on page load; a future read-only browser plan must block
that write route and verify that resolved-selection checks still work. Generate the URL from the
stored complete factory selection, compare the page's exact resolved model and options, and record
real pass/fail counts with dated evidence. Creating a URL alone never counts as a browser check.

The first lane makes zero source/key/browser/image requests. Existing source/retention/display
authorisation persists. All these gaps are technical integration/evidence requirements, not a
renewed human permission request or a claim that completed producer stories alone prove acceptance.
