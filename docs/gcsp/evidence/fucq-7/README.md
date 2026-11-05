# FUCQ-7 evidence

1 November 2026. Supports the [reuse assessment](../../engine-reuse-assessment.md). Primary evidence is the reviewed production code, root README and current service blueprint. Browser use is unnecessary for these functional findings; no visual or accessibility audit is claimed.

## Reviewed baseline

- Branch: `gcsp-poc`.
- HEAD: `27cf841e1af6ea1c0598bcd63700145138fdb947`.
- Included existing working-copy GCSP context and service blueprint. Unrelated edits were preserved.
- Read Jira FUCQ-7 description and its one subsequent repurposing comment. No Jira writes.

## Verification

`npm test` completed with 234 tests passed, zero failed, zero skipped, in approximately 5.2 seconds. This is the existing retail test baseline. It does not establish scheme-specific acceptance; the additional probes expose cases that the suite does not catch.

Run the evidence probes from the repository root:

```sh
node docs/gcsp/evidence/fucq-7/reuse-probes.mjs
```

[reuse-probes.mjs](reuse-probes.mjs) exercises real production functions and card DOM with synthetic cars. It injects empty stock into a local HTTP server and mocks the preview transport; it makes no upstream network calls. Its deliberately isolated unhandled-rejection listener captures the existing empty-result API defect without treating it as an ordinary successful response. The request's one-second timeout is a probe guard, not an application timeout policy.

[reuse-probes.json](reuse-probes.json) is the actual saved output. It records:

- EV/body/fuel mismatches surviving soft scoring, and a retail price stretch.
- The empty engine result omitting `alternatives` and the resulting HTTP failure.
- Group-level equipment union versus individual-listing equipment.
- Selecting the £39,000 sibling retaining the £30,000 sibling's 96% score and budget reason, although independent scoring gives 87%/stretch.
- Thirteen tied models producing six shown and six alternatives, omitting the sole towbar-equipped thirteenth model from the refinement pool.
- Game taste inference changing explicit `charging: none` to `either`.
- An in-flight preview invoking its callback after cancellation.

The source locations and interpretation of each finding are in the assessment. These are controlled demonstrations of current behaviour, not predictions of employee choices or claims about real BMW scheme stock.

Two independent reviewer agents inspected the code: both requested/selected Opus `gpt-6.1-sol` / `high`, no fallback or descendants. The parent ran the full suite and reproduced the saved probes. No application fixes were made as part of this review.

## Shared implementation design extension

The [shared recommendation design](../../shared-recommendation-design.md) and [canonical HLD guide](../../../design/README.md) extend these findings into a proposed implementation for both scenarios. They specify separate policy profiles, shared exact-car computation/evidence, scoped feedback, retail compatibility contracts, migration gates and employee transaction invariants.

Independent architecture review found and resolved notification atomicity, durable-brief migration order and configured `TASTE_SHARE` preservation. A further document/diagram-outline review found no remaining material architecture corrections. Reviewers retained requested/selected `gpt-6.1-sol` / `high`, with no fallback or descendants. The parent reviewed the final diagram exports. These are design checks; no extraction or employee implementation was performed, and the 234-test result above was not rerun or represented as proof of future parity.

## Versioned retail compatibility contract

FUCQ-21 adds the [offline retail baseline](retail-compat-baseline.md), [independent expected-outcome review](retail-compat-independent-review.md), [separate correction cases](retail-compat-corrections.md) and [integrated validation receipt](retail-compat-validation.md). Its versioned fixtures cover all six brands, full-pool manual filtering and legacy answer restoration. The receipt records its own current counts and environment; the historical 234-test reuse assessment above remains unchanged.

## Shared kit for retail and employee decisions

FUCQ-31 extends the shared components with explicit exact-member display data, typed terms and callback-owned controls/preview. The [review and resettable gallery trial](fucq31-review.md), [automated validation](fucq31-validation.json), [browser matrix](fucq31-browser-review.json) and [independent resource cleanup audit](fucq31-resources.json) record its final source, references, rendered states and limitations. Historical FUCQ-7/FUCQ-21 evidence above retains its own scope and counts.
