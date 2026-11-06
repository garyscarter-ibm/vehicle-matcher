# Buddy quote current-car metadata

FUCQ-100 bounded addition agreed by the dispatcher, 5 November 2026. The existing authenticated
employee row supplies `contract.manualContext`; the already-validated entitlement slot names its
current contract. No new source, identity, BriefService or repository schema is introduced.

`quotes.eligibility.currentCarComparison` is immutable quote evidence:

```js
{
  schemaVersion: '1',
  comparisonAvailable: false,
  binding: { contractId, employeeVersion, slotVersion, source }, // INTERNAL
  display: {
    state: 'partial', // or 'unavailable'
    model: 'Fictional BMW 320i Touring', // or null
    source: { mode: 'synthetic', sourceVersion: 'manual-records-v1', observedAt }, // or null
    unknowns: ['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points']
  }
}
```

Public offer readers explicitly allowlist `display` and the false comparison availability; they do
not automatically expose `binding`, contract IDs, employee/slot revisions or internal source refs.
The internal source is limited to mode/sourceRef/sourceVersion/schemaVersion/effectiveFrom/observedAt.
No account, address, contact, licence, driver list, raw manualContext, VIN or guessed specification is copied.

The contract must be unique, current and match the employee, slot, scheme and slot.contractId. Both
record and contract source must have a recognised mode, bounded version/ref/schema fields and valid
effective/observed dates no later than quote time. Missing, ambiguous, malformed, future or mismatched
input yields unavailable with null model/source/contract binding. Positive source revisions are
retained internally. Later changes to the employee source do not rewrite a pinned quote.

The current fixture supplies a model label and provenance, not an authenticated VIN/configuration or
specification/points association. A vehicle registry exists, but it has no authorised employee-current-car
join at this producer boundary. The model label cannot establish seats, equipment, fuel or current cost.
`comparisonAvailable` therefore remains false. This is truthful partial metadata, not completed FUCQ-105
comparison acceptance. A future source contract must separately supply verified current vehicle facts.

The same quote construction runs before local offer creation and remote claim intent; confirmation
reuses the immutable quote. The remote worker still checks the employee and slot pins before making
an offer. There is no separate remote current-car source or calculation.

Validation:19/19 pure projector/security tests and193/193 freshly selected buddy/local/remote/expiry,
clock/reset, stored-subject, notification/token boundaries, no skips. Real local and remote producers
prove the same metadata remains pinned after source changes. Shared `.claude/test-runs/fucq100/` records:
`fucq100-current-car-C-ca0cd8f3d9084a43850a75f201f0ac15-receipt.json`,
`fucq100-current-car-D-a3634ad48c8446a9a3438e6db237e8f0-receipt.json`,
`strict-current-car/targeted-bf60957aeb685c74aaa4e7e0f957d3da5b2d9abf9ec508d9d339e0fa5b3f71d9-default-1793921520458170000.json`,
and `parent-current-car-audit.json`. All35allocation manifests are clean; retained dependencies are
unchanged. No browser, listener, native database, network, full suite or large artifact was allocated.
