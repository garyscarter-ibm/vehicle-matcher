# Live P0490 sample check — 11 November 2026

Two exact records from the sealed 10,000-configuration cohort restored successfully in the live BMW UK configurator. Both retained `P0490`, displayed **BMW Individual Paintwork** with a selected rainbow swatch, and exposed no named shade or mandatory shade prompt in the inspected Exterior Colour panel. A same-model Alpine White control restored its named paint correctly.

| Sample | Model / catalogue range | Factory codes supplied | Live selected paint | Factory selection comparison |
|---|---|---:|---|---|
| i5 eDrive40 M Sport Touring | `T5MJ` / `G61E` | 48 | `P0490` — BMW Individual Paintwork | Exact; no codes missing or added |
| iX1 eDrive20 xLine | `IX1H` / `U11` | 37 | `P0490` — BMW Individual Paintwork | Exact; no codes missing or added |
| i5 named-paint control | `T5MJ` / `G61E` | 49 | `P0300` — Alpine White | Exact; no codes missing or added |

Each page's two observed full-configuration solver responses returned HTTP 200, `constructible: true` and the intended model. The sole extra element was accessory `SE000001`, outside the canonical factory selection. Neither P0490 sample gained another paint/shade identifier. The two generic selections rendered white-looking cars; the selected rainbow swatches and generic labels mean those images do not establish White as their actual colour family.

## Method and limits

Observed at 23:32:09–23:32:24 UTC on 11 November 2026. An isolated headless Chrome session opened each public deep link using the exact cohort model and complete factory-code list. Optional cookies were rejected and the Exterior Colour tab opened without changing any paint option. All three screenshots were visually inspected against their accessible selected options and solver results. Existing foreground tabs and keyboard focus were undisturbed.

The route was `https://configure.bmw.co.uk/en_GB/configure/{catalogueRangeKey}/{modelCode}/{comma-separated factory codes}`. The live page used effect date `2027-01-05` and order date `2026-11-11`; the retained source used the same effect date with order date `2026-11-01`. These are successful current-catalogue round trips of the supplied selections, rather than replays pinned to the historical order date. The i5's raw source range is `G61`; its qualified catalogue key is `G61E`.

This establishes that the **public configurator itself permits a generic Individual paint selection without a companion shade code**. A missing companion is therefore insufficient, by itself, to diagnose a collection error. A factory needs a precise finish, but the production/dealer order system was not inspected. Additional shade specification later in the order process or in separate order fields remains an explanation to verify, not a finding of this check. No colour-family preference should be inferred for these generic selections.

There was no login, deliberate configuration save, offer request or order submission. Normal configurator loading can create an anonymous garage record, as documented in the [existing interface research](../../bmw-interface-research.md#follow-up-opening-a-configuration-in-the-configurator-4-nov). Garage identifiers, credentials, request headers and solver state identifiers were omitted from retained evidence.

## Retained evidence

The immutable source manifest is `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-retained-coverage-20261107/selection-manifest.json`, SHA-256 `216359c111a5169d15a98de1c476a5c62714a3b3a7ee71431c325a45c90f096f`. The three source byte ranges and their row digests were verified. Exact canonical IDs, code lists, source context/pointers, selected-field solver excerpts, colour-panel accessibility text and screenshot hashes are retained under:

`/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/paint-live-sample-20261111/`

- `sample-i5-p0490.json` and `.png`
- `sample-ix1-p0490.json` and `.png`
- `control-i5-white.json` and `.png`

These JSON files are selected-field excerpts, not complete response fixtures. Large unrelated availability prefetches and page sections were discarded. The repository retains this concise summary in accordance with its evidence-archive policy.

Validation was scoped to these two generic samples and one named control. An initial browser extraction failed because BMW's consent component added another `body` element in shadow DOM; the extraction was corrected and the failed attempt's scratch removed before continuing. A second pass established solver round trips; a third pass rejected the cookie banner and captured the colour panels. No source collector, application implementation or full test suite ran. No Jira writes occurred.

The local supervisor records are `.claude/test-runs/live-paint-sample-20261111/`. All three owned browser scratch roots were removed and their absence verified; no browser process referencing those roots remains. The active-profile compatibility exception peaked at 7,153,180 allocated bytes. Retained evidence is in the OneDrive directory above; file placement does not establish cloud upload completion.

Agent: Mike Wazowski, scoper, requested/selected `gpt-6-luna` with `high` reasoning; no fallback. They independently extracted source samples and qualified range keys. The parent performed the live probes and comparisons.
