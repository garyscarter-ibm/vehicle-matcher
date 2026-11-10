# FUCQ-328: Paula's scheme and starting answers

Captured 10 November 2026 by `capture.mjs`: offline host, memory repository, signed in as `paula.mason@gcsp-demo.com`
(FUCQ-322 login), `/gcsp-brief-live.html`, headless Chrome at 1280x900 and 375x812. Per-screen checks are in `results.json`.

- `*-open.png`: the disclosure opened from its summary by keyboard (Enter; focus stays on the summary). Four facts from Paula's records:
  BMW 3 Series Touring 320i, Tuesday 1 December 2026, Paula Mason and Casey Ward, 12,000 mi/year. No "Not supplied", "Unknown ·",
  "Source not supplied" or internal source id. One line counts the four unanswered needs.
- `*-answered.png`: the towbar question answered No by keyboard. Its row appears (`Draft · Your answers`) and the count falls to 3.
- Both widths: no horizontal overflow, no inline scripts or handlers on the page.
- No-current-car (Jordan) state: covered by the render test in `server/test/gcsp-brief-render.test.js` (one line, no rows).

## Field trace (source record, projection, screen)

| Field | Source record (`manual-context/fixtures.js`) | Projection (`brief/editor.js` knownFacts) | Before | After | Class |
|---|---|---|---|---|---|
| Current car | contract `model` | `currentContract.value.model` | shown | shown | supplied and rendered |
| Contract ends | contract `contractEndDate` | `currentContract.value.contractEndDate` | raw `2026-12-01` | long date | supplied; render format fixed |
| Drivers | `drivers[].name` | `drivers.value[].name` | shown | shown | supplied and rendered |
| Annual mileage | contract `annualMileage`, `mileageUnit` | no `annualMileage` fact: live `employeeFacts` holds only essentials, charging, requiredBy, driverEligible | Not supplied | 12,000 mi/year from the contract | supplied but lost in the view (read only a provider fact the live runtime never sends) |
| Source note | `source` ids `manual-account` / `employee-provider` | per fact | "Scheme account" (fell back to "Source not supplied" when absent) | "Scheme account", nothing when absent | presentation |
| Needs provenance | none: four needs start `value: null`, source `policy:brief.editor.v1` | `initial.brief.essentials` | four "Unknown · policy:brief.editor.v1" rows | hidden; one "Not answered yet: N questions" line | genuinely absent until Paula answers |
| Preference provenance | policy defaults, source `policy:brief.editor.v1` | `initial.brief.preferences` | "... · policy:brief.editor.v1" | internal id dropped | presentation |
| Charging (provider) | `employeeFacts.charging` known `home` | `knownFacts.charging` | not shown | not shown | supplied, not a starting answer by rule (the essential stays the employee's own answer, FUCQ-94); see story result |

The fixture snapshot `docs/gcsp/evidence/fucq94/representative-snapshot.json` (the `gcsp-brief.html` preview) does carry an
`annualMileage` provider fact; the live runtime does not, which is why the review meeting saw "Not supplied" and tests did not.
