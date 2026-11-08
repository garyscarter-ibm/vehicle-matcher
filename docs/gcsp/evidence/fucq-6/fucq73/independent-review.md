# FUCQ-73 independent rendered review

- **Reviewer:** independent agent (Sonnet 5.5), no prior involvement. **Date:** 8 November 2026.
- **Reference:** FUCQ-64 representative body, `docs/gcsp/evidence/fucq-6/README.md` (revision `a7fc178`): `representative-desktop`, `-narrow-320`, `-unavailable-desktop`, plus `docs/gcsp/experience-quality.md`.
- **Inspected:** 1280-01, 02, 05 (cropped), 06, 08, 09, 10, 15, 17, 22, 24, 25, 29 and 320-02, 05, 06, 08, 09, 17, 29, plus `results-desktop.json` and `results-narrow.json`.
- **Measured numbers (from JSON, not re-run):** no page errors; no raw-id hits except the kebab-case strings below; focus outlines 2px on all 11 to 17 stops; lowest contrast 4.67:1; reduced-motion durations 0s; no overflow recorded.

## Verdict: pass with findings

The journey is coherent and honest. Collection is repeatedly "requested, not a confirmed appointment". Submission is shown as "Awaiting approval" with HR approval Waiting, so nothing implies approval or a booking. Loading, outage, expiry and unknown-outcome states each have a message and a next action. No em dashes seen. Long data wraps without overflow. The gap to FUCQ-64 is mainly shell and typographic drift plus screens that are heavy on mobile.

## Findings

| # | Sev | Screen | What I see | Why it matters |
|---|---|---|---|---|
| 1 | Medium | 1280-02, 320-02 | "twelve-month-12000: Not available for this driver and scheme." A raw option id, while the dropdown shows a readable name. (Self-logged as D3 in the results JSON, still unfixed.) | Breaks the no-raw-ids rule on the first setup screen. |
| 2 | Medium | 1280-08, 24, 25, 29; 320-08, 29 | Terms line shows "Terms version: fictional-order-terms-v1". | Internal identifier on the screen where the employee commits. |
| 3 | Medium | 1280-25 | After "could not confirm", "Retry the same submission" is pale and the ticks are greyed, so it reads as disabled. Only "Check order status" looks usable. | Recovery is unclear; the message promises a retry. |
| 4 | Medium | 1280-08, 320-08 | With all three boxes ticked, "Submit order" is a washed-out teal, not the full primary seen on "Continue to order review". May be a transition caught mid-frame. | Employee cannot tell whether submit is available. Needs a retake. |
| 5 | Medium | 1280-01, 06, 09 vs FUCQ-64 | Shell and type drift: "BMW GROUP" wordmark and a light-blue active nav tile (FUCQ-64: solid teal tile); heavy condensed H1 (FUCQ-64: regular sans); bright light-blue bands (FUCQ-64: pale teal-grey). Account page lost the "CHOICES" kicker and shows an empty dark 620px image panel. | The agreed reference is not followed consistently. Gary asked for tweaks "when built". |
| 6 | Medium | 320-05 | The gallery is 17,700px tall: 20 cars stacked, no paging or "show more". | Unusable scrolling on a phone; sorting helps little. |
| 7 | Medium | 320-02, 08, 09, 29 | Two-column fact grids at 320px break values: "employee-paula@exampl e.invalid", "FICTIONAL- NOMINEE". Selects clip ("Nominated: Casey (fictio"). Header name truncates. | Cramped; the grids should go single column below about 360px. |
| 8 | Low | All desktop and 320 | "Presenter controls" box sits above the kicker, wider than the content column (to x=1272 against 1208) and misaligned with the kicker. | Presenter chrome in front of BMW users; breaks the page grid. |
| 9 | Low | 1280-02, 06, 09, 10 | H1 shows a full rectangular focus box after programmatic focus. It also prints in 1280-10. | Looks like an error frame; suppress for programmatic focus. |
| 10 | Low | 1280-02 vs 06 vs 09 | Date formats vary: "12/11/2026" (ambiguous), "2026-11-13", "13 November 2026". | Inconsistent, and dd/mm versus mm/dd is a real risk. |
| 11 | Low | 1280-05 | Not-eligible reasons are lowercase code-like phrases ("policy exclude", "insurance grade limit"). Allowance status has no icon (FUCQ-64 used tick and warning icons). Header copy exposes "Current source version: unknown" and release-history lines. | Reads as internals; status relies on colour alone. |
| 12 | Low | 1280-29, 320-29 | Expired uses the same calm blue banner as an active countdown; "Refresh stock" is only a ghost button. | An expired state should look different and lead with its recovery. |
| 13 | Low | 1280-06, 25 | Presenter jargon reaches the employee: "Time follows the presenter clock", "Check current claim". "Collection and current contract" heading touches its first label. | Copy concision and spacing polish. |
| 14 | Low | 1280-10 | Print is readable and drops the chrome, but the empty image placeholder takes about 470px of the first page. | Wastes paper; hide the placeholder in print. |

Not re-reported: the known items in the brief.

## Lead triage, 8 November 2026

- **Fixed in FUCQ-73:** the `twelve-month-12000` reason on setup (3239d73c; captures predate it) and the terms version code on the final review (it is still sent with the submission, never shown).
- **Not a defect:** the faded Submit and Retry buttons are captures taken during the 0.15 s colour transition. The results record `submitEnabled: true` and one POST.
- **For the dispatcher to raise (not FUCQ-73 scope):** shell and type drift from FUCQ-64 (shared shell, Medium); the 320 px gallery has no paging (FUCQ-69, Medium); 320 px fact grids break long values and selects clip (shared kit, Medium); and the Low items above.
