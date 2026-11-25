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

## Java quote comparison repair — FUCQ-565, 23 November 2026

Russell approved restoring the later frozen FUCQ-105 implementation at `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`;
the earlier model-only checkpoint above remains historical. **Data strategy: default, agreed 23 November 2026.**
New Java Buddy quotes store one bounded historical snapshot in existing `buddy_quotes.quote.currentCarComparison`.
This keeps decision support faithful to quote time with one existing-store read and no new schema, index, provider,
cache or backfill. Existing unpinned quotes remain unavailable; later source corrections affect new quotes only.

`Claim` reads the scoped employee, entitlement slot and account-record aggregate in one statement in its existing
transaction immediately before inserting the quote, before branching to local versus remote custody. Primary and
unique keys bound the two scoped left joins to at most one row; work is one keyed read per successful claim, not per
stock candidate. Missing or invalid evidence pins unavailable without adding an allocation refusal. The snapshot
checks the claim's expected employee/slot revisions, each row's environment/run/employee, the slot identity and
contract, and the account record-set identity and positive independent revision. Its internal binding retains those
identities/revisions and the six allowlisted contract-source fields; the raw source aggregate is never copied.

Only the recorded current contract supplies `configuration`, `body`, `fuel`, `seats`, `boot`, `mpg`, `zeroTo62` and
`points`. Nonempty bounded text and positive finite numbers follow the frozen type rules; units are respectively
null, null, null, `count`, `L`, `mpg-imperial`, `s` and `points-per-month`. Absent/invalid facts remain in the ordered
unknown partition. A valid model and source with no valid facts stay partial and unavailable for quantitative
comparison; all eight valid facts make the comparison available. Missing, duplicate, wrong-owner, wrong-slot,
wrong-scheme, malformed, unsupported or future source evidence stays unavailable.

The shared public projector is used by ordinary/terminal offer reads and each historical side of a ready follow-up.
It checks the pin against independently sourced quote/hold ownership and the actual persisted quote time. It exposes
only status/reason, comparison availability, safe model/source, allowlisted facts and unknowns: no internal binding,
contract/employee/slot/record-set identifiers, source reference, account/address/driver/licence data or VIN.
Ordinary reads reuse the existing quote/offer/hold join; follow-up adds each immutable quote's slot to its existing
keyed read. Neither enriches a historical quote from current account data. Remote reconciliation retains the original
pin; existing authority, custody, expected-version, clock, policy and duplicate-command guards remain in force.

Implementation allocation: `CurrentCarComparison`, `allocation/Claim`, `FollowupComparison`, `OfferPresentation`
and `OfferFollowups`; focused pure and existing allocation/local/remote/decline journey tests cover the contract.
The final merged F555 real Main offer supplies current1100 versus offered800 and the existing Angular 300 saving,
comparison/highlights and same-offer1280/390 proof. That connected result, the shared covering Java batch and human
1280 screenshot verdict remain separate evidence; this contract note does not claim their completion.

The public comparison also respects the existing Angular scalar contract: observed timestamps use the frozen
reader's UTC `Z` form (whole seconds or three fractional digits), and text contains no ASCII control characters.
An offset-form timestamp remains exactly as recorded in the immutable pin but makes the public comparison
unavailable. Invalid model/source text likewise yields unavailable; invalid fact text or units remain unknown.
These fallbacks keep a malformed comparison from invalidating an otherwise usable offer.

Sibling checks: ordinary and follow-up Java readers share this projector; Angular already enforces `Z` and
control-free public text. The frozen Node reader already has the same timestamp fallback and remains read-only.
Stored evidence remains unchanged, and both harnesses execute the same Java implementation. Deployment needs no
new gate because this repairs the existing DTO contract without configuration or schema changes.

Independent source/security review found and then closed the timestamp/control-text issues. Two literal
regressions failed before repair and passed afterwards (10/10 pure tests); the final allocation package also
passed 83/83 on the repaired source. Remaining final package/caller runs and the integrated Main/browser/restart
result are recorded in the Story Result rather than inferred from this contract note.
