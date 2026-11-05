# Retail compatibility baseline v1 · FUCQ-21

Captured 5 November 2026. Tests and evidence only; no product, tuning or dependency changes. Expected snapshots have been independently approved in the [lead review](retail-compat-independent-review.md), which records input corrections, source-derived anchors and hand calculations for all six brands. The hand-review record is separate from the capture metadata; passing snapshots alone do not establish that outcomes are correct.

Run from the repository root:

```sh
node --test server/test/recommendation-compat.test.js
```

The command reads expected values, replays all cases twice and checks fixture bytes, file identities and write timestamps afterwards. It has no generator, update flag or write mode. A difference names the case and exact JSON path, with actual/expected snippets capped at 300 characters. Review intentional changes independently and create an explicit versioned baseline; never change expected output merely to make a test pass. The temporary one-off capture script is excluded from the deliverable and removed with owned scratch.

## Frozen inputs and reproducibility

- [inputs.json](../../../../server/test/fixtures/retail-compat-v1/inputs.json) holds version `retail-compat-input-v1`, raw BMW/MINI records, copied mapped rows for the other four brands, source snapshot SHA-256 hashes/selected IDs, literal legacy hashes, location fixtures and all briefs.
- [expected.json](../../../../server/test/fixtures/retail-compat-v1/expected.json) holds full endpoint requests/statuses/public JSON and dependency calls, full BMW/MINI mapped output, material ranked decisions and client restoration/manual-filter observations.
- [manifest.json](../../../../server/test/fixtures/retail-compat-v1/manifest.json) pins input/output SHA-256, capture revision, fixture versions, Node version and blend. It records capture provenance and the independent review approval for exact input/expected hashes.

Capture source HEAD: `ae98615dd9aae83146cc842ee15ee9d8f88b1162`. Node: `v26.7.0`. Configured `TASTE_SHARE=0.2`, the existing 80% fit / 20% taste blend; an absent setting resolves to 0.2. Any different configured value fails clearly before replay; this suite never retunes it. Source HEAD describes the captured implementation, not a requirement that future test commits retain that Git HEAD. Node version is recorded, not silently substituted.

BMW has 16 raw synthetic listings across fuel/body/price/practicality choices and two X3 siblings. MINI has 10 raw synthetic listings with actual parser-recognized `3 Door`/`5 Door` spellings, Classic/Exclusive/Sport trims, electric/PHEV/petrol and repeated Classic hatches. These exercise the actual `mapVehicle` boundary. Other marque slices copy small diverse, already mapped rows from dated repository snapshots into the versioned input, so replay never imports mutable runtime fixture files. They do not claim raw Honda/Ford/Motorrad/Ferrari parser coverage; existing brand/parser suites retain that responsibility.

The dedicated synthetic limit pool derives from the frozen mapped BMW X3: 13 distinct presentation identities with identical scoring facts, first group containing 26 listings. It freezes 38 eligible listings, a 13-group tie, six shown, six alternatives, 24 sampled members, a £30,000–£30,025 group price range and a towbar contributed only by member 26 beyond the sample. Group counts/equipment availability are aggregates; they do not claim that the selected member has every feature.

Stock, nearby stock, enrichment, directory and geocoding are explicitly injected. Stock is copied per request; colour enrichment is synchronous deterministic fixture paint, including detached warmer calls. Server capture rejects unexpected fetch origins; client capture uses an injected transport that rejects unrecognised endpoints and never reaches a network. Local HTTP binds one ephemeral loopback port. No scoring path samples randomness or time, and no timestamp or ephemeral port enters expected output. DOM observations use reduced motion; no visual screenshots are claimed or needed because product surfaces are unchanged.

## Reviewable case outcomes

Scores below are capture observations for independent review; full exact identities, reasons, trade-offs, stretch, eligible rank, group keys, clusters and alternatives remain in JSON.

| Case | Intent | Captured leading outcome | Cluster / shown / alternatives |
|---|---|---|---|
| `bmw-full-family` | Full family brief: SUV practicality, budget stretch and grouped X3 siblings. | BMW X3 xDrive20d M Sport, **89**; `compat-bmw-3` | 1 / 3 / 6 |
| `bmw-partial` | Budget-only partial; whole-pool ranking and presentation limits. | BMW X7 xDrive40d M Sport, **69**; `compat-bmw-15` | 8 / 6 / 6 |
| `bmw-contradictory` | Contradictory EV/convertible/crew with public charging; soft wishes trade off, no impossible match HTTP defect. | BMW X1 xDrive25e M Sport, **40**; `compat-bmw-16` | 5 / 5 / 2 |
| `mini-sport` | MINI bespoke sport vibe/3-door preference folding. | MINI Hatch Cooper S Sport 3 Door, **88**; `compat-mini-3` | 1 / 3 / 6 |
| `mini-partial` | MINI partial with duplicate Classic hatch listings. | MINI Countryman S E ALL4 Exclusive, **70**; `compat-mini-7` | 7 / 6 / 3 |
| `mini-contradictory-rescue` | PHEV hatchback contradiction; nearby rescue must show a Countryman PHEV outside initial top three. | MINI Hatch Cooper S Sport 3 Door, **70**; `compat-mini-3` | 1 / 3 / 6 |
| `ford-ev-family` | Ford EV family among EV, petrol and PHEV snapshot rows. | Ford Explorer Premium, **97**; `ford-4412112` | 3 / 3 / 4 |
| `honda-city` | Honda urban EV alongside petrol/diesel/hybrid mapped stock. | Honda e 35.5kWh Advance Hatchback 5dr Electric Auto (17in Alloy) (154 ps), **98**; `r1dpb6e` | 1 / 3 / 5 |
| `motorrad-tour` | Motorrad bike-native touring/licence answers, tourer vs sport/heritage/electric scooters. | BMW R 1250 RT LE, **85**; `577045` | 2 / 3 / 5 |
| `ferrari-phev` | Ferrari coupé PHEV performance against convertible/petrol/SUV stock. | Ferrari SF90 Stradale, **86**; `IljixbcgVnJGsKsQfDGsrinMXc`… | 2 / 3 / 6 |
| `bmw-limit-tie` | 13 deliberately equal synthetic groups; six shown, six alternatives, 24 listing sample with aggregates beyond it. | Equal group 01, **65**; `limit-01-1` | 13 / 6 / 6 |

## Public contracts and presentation boundaries

The 67 server records cover questions and full compact pools for all six brands; all eleven cases have full ranking and match payloads. BMW/MINI partial and synthetic limit cases also capture ungrouped/grouped previews, default and clamped fields, and a two-car enriched field. Four legacy/current hash briefs additionally replay through `/api/match`.

- Questions retain conditional flags, brand-specific options and bespoke MINI/Motorrad questions. Full versus partial versus contradictory briefs deliberately use the same ranking path, preserving soft fuel/body/charging trade-offs and retail budget stretch.
- Match retains exact advert identity, rank, public score/reasons/trade-offs/stretch, group listings, counts/ranges/colour/equipment aggregates, alternatives, decisive/cluster/taste flags, searched counts/margin and unmet wishes. Internal rank projection also retains fit/taste and the full `line|body|fuel|zeroTo62|styleLine` grouping identity.
- Presentation limits remain three nominal matches, six maximum tied cards, six alternatives, three-point cluster threshold, 24 listing samples, nine previews and field sizes two through 16. The true cluster may exceed the displayed count. The dedicated limit fixture proves these cuts against larger inputs.
- Nearby is three initial ranked entries **plus rescue cars**, not a strict three-car cap. `mini-contradictory-rescue` shows Sport hatch 70, Electric hatch 63, Classic hatch 60, then the requested Countryman PHEV 56 in slot 4. Failure produces `{nearby:[],unmet:null}`; a confirmed empty lookup produces explicit unmet fuel/body values.
- `/api/pool` freezes all public columns, dictionaries, bitmasks, link prefix, coordinate rounding, count and resolved scope; it is the complete display pool. Invalid brand/scope falls back to BMW/dealer. Geocode success/unknown/failure, health, missing answers and invalid budget are captured separately. The existing API suite owns the broader auth/CORS/method/body-size and stock-failure matrix.

The eleven client records execute the real questionnaire and Guess Who modules in jsdom. Four literal `#m=` links restore a legacy budget band with scalar fuel/mileage, a numeric slider with scalar fuel, a range with fuel array, and a MINI bespoke brief; the transmitted answers remain identical. Malformed hashes return to the intro. Hash generation with complete brand/mode/retailer/scope/API context is a documented correction below, not blessed by these restoration cases.

For **each of the six brands**, Guess Who displays every frozen pool ID, then filters EV locally (Ferrari filters petrol because that pool has no EV). It makes exactly one `/api/pool` call and no scoring/shortlist requests, and renders no score badges. The filtered IDs are checked against the complete pool, including members outside match/preview caps. This explicitly protects full-pool manual filtering. Existing `render.test.js` retains all 30 brand/mode mounts: filenames questionnaire/mingle/knockout/podium/guess-who; registered keys questionnaire/swipe/head-to-head/podium/guess-who. The lead runs that existing matrix and the full suite after integration.

## Corrections excluded from frozen-correct behaviour

See [the separate correction cases](retail-compat-corrections.md) and existing [reuse probes](reuse-probes.json). Empty-match HTTP completion, stale selected-sibling claims, obsolete preview callbacks and lost share-link context remain correction targets. They are not failing default tests and their broken responses are not expected snapshots.

The Motorrad tourer body explanation has one narrow projection: only exact strings `The undefined shape you asked for` (observed defect) or `The tourer shape you asked for` (intended correction) become `[tourer body-match explanation: correction boundary]` in that existing reason slot. Count/index, all other reasons and the rest of each decision remain frozen. A wrong SUV/hatchback label, an added/deleted reason or another copy change still fails. Broader copy revisions require explicit review. Raw unnormalised evidence is preserved separately in the correction document.

## Scoped verification and remaining review

The compatibility test contains 157 tests: 78 records replayed twice plus their parent. During implementation, the first run exposed JSON-only omission of undefined mapped fields; the helper now compares mapping in the same JSON representation as the frozen file. No production change or expected-value retuning was made for that harness correction.

Independent expected-outcome review is complete for the signed hashes. Final integrated render/full-suite evidence belongs to the lead and is recorded in the story Result; the scoped implementation check alone does not claim those gates. No raw-parser coverage for the four mapped-only marque slices, deployment/live feeds, browser screenshots or general UI acceptance is claimed. Test impact/resource receipts are retained outside scratch under the shared `.claude/test-runs/` directories.
