# FUCQ-371 current-car feedback: slices 1 to 3 evidence

Story DEV-2026-11-10-013, branch `dev/DEV-2026-11-10-013`. Slices A (policy, contract, evaluation), B (real consumers) and C1 (Offer explanation) are committed; this note records C2, the Offer comparison. Slice 4 (the integrated walkthrough, the Account comparison at frozen reference 193cbf07 and the six-story critique) waits for FUCQ-370 and is not covered here.

## Offer comparison (C2)

The capture script is `scripts/gcsp/fucq371-offer-capture.mjs`, with `scripts/gcsp/fucq371-compose.py` for the side-by-sides. Both Offer envelopes come from the real services: the PolicyService seed, the recommendation evaluator, Buddy allocation, the hold quote and the offer access `fromAccount` read with display images, as in `server/test/gcsp-offer-access-producer.test.js`. They are not hand-written decisions.

- **Old:** a brief with no rating.
- **Feedback:** the same inputs plus `currentCarRating` 5 on the current contract, with a stock car that has the baseline's model line, body and fuel.

The real `gcsp-offer.html`, `entry.js`, `toOfferPresentation` and Offer view render each envelope in headless Chrome at device scale 1, en-GB, reduced motion, scroll 0,0, with fonts and images loaded and external requests blocked. Two more variants are page-served from the feedback envelope:

- the exact car's name rewritten to a long BMW name;
- the reason swapped for `feedback-improvement`, so that second sentence is seen in place.

Viewports are 1440x1100, 375x812 and 320x800.

**Result:** 87 of 87 checks passed.
- No horizontal overflow, no console or page errors, no fallback reason sentence, and every image loaded.
- The reason is present only in the feedback variants.
- Text outside "Why it suits you" is identical between old and feedback.
- Heading, countdown and media boxes are equal. The comparison table keeps its x, width and height.
- The only movement is the added reason line: 25 px at 1440 and 46 px at the narrow widths.

**Critique:** an independent rendered critique (Opus, read-only) found nothing blocking. It confirmed that the reason content is the only change between old and feedback. Its four copy findings were applied to the new sentences only: "Similar to your current car, which you rated highly.", "Too similar to your current car, which you rated poorly.", "Neither similar to your current car nor better on your preferences." and "for" in both improvement forms. The corrected recapture was inspected at 1440 and 320.

**Limitations:**
- The producer fixture's stock car has no catalogue image, so both sides show "No image for this car yet".
- Its fixture name, "Synthetic exact car 1", is replaced in the long-name variant.
- At 320 the header truncates "Paula ...". This comes from the existing shell and is the same on both sides.
- Rendered evidence covers `feedback-similar` and `feedback-improvement` only. The omission sentences are blockers on cars that are never offered.

## External artefacts

Location: `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq371-2026-11-11/offer/`, 3.0 MB, 24 files. `SHA256SUMS.txt` there lists every file. Key hashes (SHA-256, first 16 hex):

| File | SHA-256 |
| --- | --- |
| `envelope-old.json` | 5d9ee204c167151d |
| `envelope-feedback.json` | f1fdfbb540b37f73 |
| `side-by-side-old-vs-feedback-1440.jpg` | 76f37c9c43ee3a1e |
| `side-by-side-old-vs-feedback-375.jpg` | 0deba101536e96a2 |
| `side-by-side-old-vs-feedback-longname-320.jpg` | af7aa833bba823f1 |
| `side-by-side-old-vs-improvement-longname-320.jpg` | 4610e0fd7c65abb7 |

The envelope hashes are the same across two independent runs, so the recorded fixture is deterministic. The superseded first capture, made before the copy fixes, was removed (2.1 MB).

## Scoped tests (slices A to C1)

Starting selection on the base tree: 276 tests, 273 passed, 3 skipped. Results per slice:

- **A:** 291 tests, 288 passed, 3 skipped.
- **B:** 13 files, 477 tests, 476 passed. The one failure is the known base failure in `gcsp-brief`, "retained brief, conflict and validation fixtures".
- **After the FUCQ-381 merge:** 143 of 143 affected tests passed.
- **C1:** 11 files; all passed except two `ui-ratchet` caps on presenter-controls CSS. Those two also fail without this story's changes.
- **After the copy fixes:** 54 of 54 passed.

No full suite was run.
