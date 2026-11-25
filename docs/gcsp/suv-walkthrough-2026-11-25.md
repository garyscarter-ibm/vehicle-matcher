# Paula's estate and SUV walkthroughs — FUCQ-340

This preparation reuses FUCQ-125's versioned Main reset and FUCQ-128's normal body-preference change. Both walkthroughs use the same complete 100-car release, employee, eligibility, points policy and practical requirements. Only Paula's body preference differs. The application computes the result; the fixture contains no offer, hold, quote, score or chosen winner.

## Preparation and provenance

`server/gcsp/fixtures/scenarios/suv-walkthrough-v1.json` is a separate input recipe, not a new scenario catalogue entry. Java currently supports **Main successful journey**; do not select the unavailable **Decline then change** entry or use historical acting-principal instructions. Presenter and Paula sign in separately.

The registered `f340` browser composition uses the existing `tranche-plan` supply adapter. It verifies the original retained Main source, selects its entire final release window and writes that selection to owned local scratch before Java starts. It changes no car, configuration, fact, identity, availability date or policy. Other browser cases continue to use the original five-window source.

| Input | Identity |
|---|---|
| Original source | `apps/gcsp-web/e2e/fixtures/main-stock-plan.json.gz`, captured from frozen `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; provenance in `main-inputs.json` |
| Original uncompressed SHA-256 | `50f19efc4b4ae818f500b6a2e32c1f1f5ea3d56150d05d72312102f35748c475` |
| Selected complete window | `demo-4bf037223a3a9fd0792fb06668db141a:stock:4` |
| Release instant | **27 November 2026, 11:30 UTC** |
| Selected plan SHA-256 | `104eeb68d28c6c488bd3c12d4e65661695a785b86900d27227325d13c44c0a7d` (existing plan object with only `windows` reduced to this whole window; JSON serialization used by the runner) |
| Stock | 100 exact source cars: 44 SUV, 17 estate, 24 coupé, 15 hatchback |

The original first release has no eligible estate for these requirements. Selecting the final whole window retains its eligible 320i Touring and eligible SUVs without editing eligibility or selecting only a desired winner. The historical FUCQ-128 run sheet in `manual-acceptance-scenarios.md` used different demo-provider stock and changed Touring to Saloon. This source contains no saloon; its historical Saloon result is not the expected outcome here. The reusable parts are reset, a confirmed changed brief, real release/allocation and replay.

Main reset starts with Estate at importance 80, five seats, charging **not ready**, and search/hold consent. A normal preference save requires three considered categories. Therefore prepare **Comfort 50 / importance 50** and **Sportiness 50 / importance 50** identically in both walkthroughs. Keep Body at importance 80. These are explicit employee inputs; the canonical policy retains ownership of the minimum, essential operators, matching weights, eligibility and points. No new store or policy source is introduced; existing run-scoped PostgreSQL state and selected adapters remain authoritative. Input identities are synthetic scenario records; no new personal data is collected.

## Presenter steps

Use a local composition configured with the selected plan above. The registered automated setup is `python3 -B apps/gcsp-web/e2e/run.py --case f340`, using the shared test stack and its normal build/runtime requirements. That runner owns scratch, the local database, signed OIDC and process cleanup. It executes the steps below and closes its composition at completion.

1. Sign in as Presenter at `/gcsp/presenter`. Choose **Main successful journey**, press **Reset scenario**, review, then **Confirm reset**. Confirm a new run was activated. Refresh sign-in context, or open a fresh sign-in, before reading the new run.
2. Sign in separately as Paula and open `/gcsp/preferences`. Verify that the restored Body answer is **Estate**, with five seats and charging **not ready**. The prior offer must be absent.
3. For the estate walkthrough, retain **Estate** alone. For the SUV walkthrough, select **SUV**, then deselect **Estate** so SUV is the only selected body. Keep importance 80. In both walkthroughs set Comfort and Sportiness to 50 with importance 50; retain the practical requirements. Select **Engage Buddy**, then **Save your preferences**. Read the successful confirmation before continuing.
4. In Presenter, open **Advanced clock controls** and select **Named time or instant**. Advance to the selected release minus one displayed step (with the current 60-second step, `2026-11-27T11:29:00.000Z`). Press **Step 60 seconds**. Verify the actual clock reaches `2026-11-27T11:30:00.000Z`. Advancing alone is not evidence that allocation ran: the step must process the release.
5. Open Paula's Activity and actual offer. Explain the offered car's fit, eligibility and terms from its current projection. The estate input should produce an estate; the SUV input should produce an SUV on these prepared inputs. Do not promise the same outcome with arbitrary stock or changed policy. Body is a preference, so another body may remain eligible.
6. Reset Main again before changing walkthroughs. Repeat each walkthrough from its own reset, including the shared preference preparation. A new run must start with no previous offer, and processing must compute its new offer. The prepared replay retains the same model, eligible fit and terms; exact paint, upholstery and source stock order may differ between tied cars because the normal allocation lottery includes the fresh run ID. Reopening an old run does not count as replay.

Keep scenario provenance in these instructions and the presenter explanation. Existing employee screens, shared shell, preference controls, Activity and offer components carry the interaction without added product copy, inline code or new UI controls.

## Evidence and remaining review

The scoped Node regression computes real recommendation previews over this whole selected window and canonical policy. On 25 November 2026 it found **41 eligible cars** for both inputs: one estate, 25 SUVs and 15 hatchbacks. With the shared Comfort/Sportiness inputs, the baseline ranked the source 320i Touring first and the SUV variant ranked the source X2 M35i first. These are observations from the recommendation check, not embedded fixture answers or proof of Java release/hold/offer execution.

`server/test/gcsp-suv-walkthrough.test.js` plus `gcsp-scenarios.test.js` and `gcsp-order-plan-scenarios.test.js`: **11 passed**, no failures/skips; full suite deferred to batch. The new test verifies exact source hash/window identity, unchanged Main starting input, bounded common preparation and computed contrasting fits. It supplies the StockService availability projection for the isolated preview; the connected browser case must prove actual release and lifecycle execution.

`apps/gcsp-web/e2e/suv-walkthrough.test.mjs` is registered as `f340`. It deliberately discards the composition's initial fixture through four actual Main resets, uses normal keyboard-accessible editor saves, advances the reset clock, runs the real release tick and checks actual offers. It repeats estate and SUV at 1280×800 and 390×844, records reset/brief/clock/activity/offer readbacks and captures saved preferences, computed offer and Activity. The receipt separately retains the original and selected plan hashes and exact window. The no-eligible-SUV variant is not part of this preparation; no such result is manufactured.

The connected browser case, rendered inspection and independent substantive usability/visual critique remain **pending** until their actual final-source results are recorded by the story lead. Check saved preference clarity, the real stock-empty pre-release state where visible, successful result/explanation, keyboard focus, long source car names, narrow wrapping and CSP/runtime errors. This document does not mark the original acceptance criteria accepted.
