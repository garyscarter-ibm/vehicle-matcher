# Retail compatibility expected-outcome review

5 November 2026. FUCQ-21. This review is owned by the story lead, separately from the implementer who captures the fixtures. It concerns the fixed retail compatibility baseline, not the correctness of known defects or scheme policy.

## Independent review method

Before inspecting the captured expected outputs, the lead read the production scoring and grouping paths in `server/engine.js`, serializers and handlers in `server/index.js`, the questionnaire hash reader and the existing API, grouped-preview and 30-mount render tests. The following anchors were derived from that source rather than copied from a passing capture:

- The configured `TASTE_SHARE` is read at module import; its default is `0.2`, blending 80% fit and 20% taste. Scores round the final blend; rounded fit/taste fields alone cannot reconstruct every exact total.
- Budget accepts a range, a positive number or legacy `b1`–`b5`; ranges are sorted and nonnegative. The hard budget boundary is the brand's stretch factor. Body and fuel wishes remain soft trade-offs; family/crew filters are separate from those preferences.
- Ordering is score descending, taste descending, price ascending, then name. A group's key is line, body, fuel, 0–62 and trim. Its representative is the highest-ranked exact listing; its count, price spread and feature union describe the whole group. Only up to 24 exact listings travel.
- A three-point cluster controls decisiveness. Decisive results show up to three groups; tied results show at least three and at most six. Six alternatives are held back. Those are presentation limits, not limits on eligibility evaluation.
- Preview returns up to nine raw ranked listings by default, or groups the complete ranking before taking nine when `group === true`. Field returns raw ranked listings, default/cap 16, with enrichment only on literal `true`.
- Nearby begins with three ranked listings and can append the best matching fuel/body rescue candidates. Failed nearby stock returns `unmet: null`; successful empty availability can establish unmet wishes.
- The pool endpoint serializes every car into aligned columns and dictionaries. Guess Who filters that whole display pool; it is not a top-match request. Health remains `{ "ok": true }`.
- Legacy hashes are decoded by the real questionnaire mount, including complete visible-question validation and the accepted legacy budget/mileage shapes. Creating a new share link currently loses query context; that is a correction case, not a required compatibility expectation.

## Inputs and independent findings

The implementer supplied inputs before capture. The lead found and requested two fixture corrections: Motorrad Full A must be `licence: "a"`, and MINI derivatives must use the mapper's recognised `3 Door`/`5 Door` spellings to exercise the intended door preference. Both were corrected before approval. These were input corrections, not product changes or adjustments to match a preferred winner.

Reviewed input SHA-256: `05ec09609fc1c5707c92a0e7e8ad80335dc4ffac6859985f3fb18953c824c0d5`. Reviewed expected SHA-256: `140db30fe605e364d4b88f2143e770a8ad9195f014f2f08d6bf64a732c9447ea`. The review covers all 67 server and 11 client records in that expected file; the manifest records capture provenance separately.

The lead also identified the existing undefined tourer-label defect independently in `scoreBody()`, then checked its raw captured result. The [correction record](retail-compat-corrections.md) preserves the exact brief and unprojected result. Only the exact observed malformed label and its intended legitimate replacement are projected out; all other reasons, score, rank and identity remain asserted. This approves neither malformed copy nor selected-sibling claim drift.

## Independent score arithmetic

These calculations used the reviewed input facts and source formulas, without calling `rankCars()`, `matchCars()` or the capture helper to obtain an answer. Priority boosts affect taste dimensions only; mileage adds to the fit economy weight. Final totals use unrounded ratios.

| Case and exact leading car | Independent fit / taste | Unrounded blend, rounded result |
|---|---|---|
| BMW full, `compat-bmw-3` X3 | `13.701953125 / 15.1875`; `3.675 / 4.5` | `88.50823045`, **89** |
| MINI sport, `compat-mini-3` | `20.514285714 / 21.5`; `5.97 / 10.3` | `87.92445892`, **88** |
| Ford EV family, `ford-4412112` Explorer | `19.5875 / 19.8875`; `3.647142857 / 4` | `97.02892610`, **97** |
| Honda city, `r1dpb6e` e | `1`; `3 / 3.3` | `98.18181818`, **98** |
| Motorrad tour, `577045` RT | `16.528571429 / 16.7`; `(1.7 × 11/13) / 5.1` | `84.81981093`, **85** |
| Ferrari PHEV, SF90 exact ID in input | `15.582890625 / 15.9875`; `3.516666667 / 8.9` | `85.87799311`, **86** |

For BMW, the 15,000-mile ramp is `0.6875`; X3 economy is `0.5723214286`. The four reasons sort as SUV shape, budget, family character, diesel mileage. Both £34,000/£39,000 X3 siblings are in budget and score 89; their grouped feature union is aggregate availability. The £44,000 X5 is a legitimate stretch below the £48,300 hard cap, rather than a filtered or silently in-budget car.

MINI's confirmed three-door Sport matches both bespoke preferences; unknown-door fixtures would have missed this branch. Honda's solo city use makes its four-seat e suitable without a family-seat penalty. Ford Explorer and Capri tie at 97/91 taste; Explorer wins the final price tie-break. Motorrad's comfort style reduces performance weight from 2.2 to 1.7, so the RT score is 85. Ferrari's 296 GTB has the same fit ratio as the SF90 but taste `2.023333333 / 8.9`, giving **83**; their three-point cluster is tied with a real taste lead.

## Review of remaining outcomes and boundaries

- BMW partial's X7/7 Series both round to 69; X7's higher taste resolves that tie before price. Eight groups lie within three points; six appear and six alternatives remain.
- BMW contradictory retains eight eligible exact listings and five clustered groups. The PHEV X1 leads at 40 while reporting both requested-EV and convertible trade-offs; wishes remain soft and hard budget/crew rules still apply. The grouped X3 keeps both exact member identities, including the stretch sibling.
- MINI partial retains a seven-group cluster and a duplicate Classic group, with Countryman PHEV 70 leading. MINI's contradictory PHEV/hatch request still ranks the Sport hatch 70, EV hatch 63 and Classic hatch 60; nearby appends the PHEV Countryman 56 as a fourth rescue entry. The output does not claim that a PHEV hatch exists.
- The dedicated 38-listing case derives thirteen equal group identities from versioned facts. Six shown and six alternatives deliberately leave group 13 outside presentation. The first group's count 26, price range £30,000–£30,025 and towbar union include members beyond its 24-listing sample. Raw preview versus grouped preview each fills nine; field defaults/clamps to 16 and explicitly enriched size two remains two.
- All six brand question sets were checked against `questionsForBrand()` surgery: MINI retains vibe/doors and Motorrad exposes riding style/licence, while car-only values stay excluded where specified. Pools retain aligned complete rows: BMW 16, MINI 10, Ford 7, Honda 8, Motorrad 8, Ferrari 10. BMW/MINI directory coordinates round to four decimals; absent other-brand coordinates remain null.
- Every endpoint request/status/projection and captured dependency-call sequence was reviewed against its handler. Geocode distinguishes success, 404 unknown and 502 unavailable; health stays open with `{ "ok": true }`; malformed answer/budget validation remains 400. Nearby failure's null unmet evidence remains distinct from confirmed-empty fuel/body unavailability.
- Four literal hashes were checked for the old band/scalar, numeric/scalar, current range/array and bespoke MINI shapes. The actual questionnaire mount transmits the decoded answers unchanged and rejects malformed hashes. These checks do not endorse the separate generation/context-loss defect.
- Actual Guess Who mounts display every input pool ID, then locally retain EV IDs (Ferrari petrol) with exactly one pool request and no score badges. The complete filter sets contain BMW 3, MINI 2, Ford 3, Honda 2, Motorrad 2 and Ferrari 7 cars. Existing render tests own the thirty six-brand/five-mode mounts; this test/evidence change adds no rendered surface requiring new screenshots.

## Review disposition

Approved independently by the story lead on 5 November 2026 for the exact input/expected hashes above, after the two input revisions and narrow correction-copy exclusion. Requested/selected lead settings: `gpt-6.1-sol` / `high`, no fallback. The capture implementer used `gpt-6.1-sol` / `medium`; it did not approve its own expected outputs. Final integrated test counts and resource cleanup evidence are recorded in the story Result and validation receipt; this review is the expected-outcome judgement, not a substitute for execution.
