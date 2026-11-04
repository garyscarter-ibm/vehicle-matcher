# FUCQ-3 — Paula service blueprint, version 4

1 November 2026. [Open the blueprint](service-blueprint.html). Proposed service for review, using the agreed Carbon White document design. The [version 3 record](service-blueprint-review-v3.md) preserves earlier verification.

## Changes from Russell’s review

The map now has **15 columns: 01–13, plus 01a and 04a**. Existing main labels remain stable through 13.

| Review point | Revision |
|---|---|
| Current car too generic | BMW 320i M Sport Touring (G21 LCI2), B48 2.0-litre petrol, automatic, Portimao Blue Metallic, from the supplied replacement-vehicle screen. All fifteen experience cells name the derivative. Listed equipment now anchors the personal view and comparison; the earlier 5 Series premise has been corrected. |
| Make “Paula sees” engaging | Each cell describes the visible experience: personal usage, vehicle imagery / cabin gallery, illustrated priorities, useful progress, held-car comparison, remembered rejections and a handover plan. No separate surprise-and-delight heading. |
| Background row incomprehensible | Spaced, labelled responsibilities replace dense paragraphs and compressed role strings. Each ends with a short result. Technical connections stay in the data row. |
| Personal usage in 01 | Proposed 30-day miles, average MPG, weekly efficiency trend, longest recorded journey, remaining agreement miles and service status, with period / coverage / update time. Scheme data access remains unverified; no petrol-car driver score is claimed. |
| Modernised manual route | 01a shows the more attractive gallery and the same release-day race. Paula leaves without ordering and chooses her agent. Monday is the story example, not a verified universal release schedule. |
| Minimal inputs | 02 captures two broad priorities and one optional improvement from six themes. 03 reuses known drivers, dates and needs, asks for maximum extra payment and charging readiness, and reveals missing / relevant checks only. Sliders and separate weights are removed. |
| Verify cash contribution | June 2024 Choices guide, §1.2, p9, permits monthly salary-deducted contributions above points entitlement at £1 per excess point. Current figures and applicability to the screen’s PCS UKFS BMW scheme need confirmation; the payment branch is conditional. |
| Explicit delegated work | 04 is Paula handing over. 04a uses **The agent does / The agent sees** to show checking, comparing, ranking, obtaining a confirmed hold and preparing an offer. |
| Rejection history and car’s fate | 06 adds an inline “My rejections” card with old quote, reason, date and retained comparison. The exact car returns to the shared eligible pool after confirmed release. An uncertain release stays pending. |
| Later scope | Collection, after-use feedback and repeat-renewal steps are removed from the main walkthrough. A short note explains that confirmed handover updates the current car and future renewal reuses the brief, asking only what changed. |

The [research record](service-blueprint-research.md) contains the primary UX guidance, screen-identified car, contribution evidence and connected-data boundaries. The vehicle specification comes from the supplied screen; the surrounding personality / journey is authored. This is desk research; employee usability testing and production integration are not claimed.

## Service and data boundaries

Inputs remain deterministic. Broad priorities rank suitable cars; confirmed must-haves, eligibility, driver restrictions, affordability and collection timing remain constraints. Only Paula’s confirmation changes a brief or submits a selection. Unknown essential facts must be resolved before a car is represented as suitable.

Both offers require confirmed exact-car holds before notification. Manual and delegated choices share one stock pool. Rejection alone creates neither a penalty nor extra priority. “My rejections” is historical and cannot revive an old hold. Help is visible but unused here; an extension needs the proper authority.

Each of the 36 input cards states source status, adapter type and proposed flow / frequency. Public BMW consumer features do not prove enterprise API access. Connected data is optional and separate from allocation or employer performance assessment. Actual agreement dates remain authoritative.

## Earlier assessment references

The FUCQ-7 assessment retains its fourteen-step **version 2** baseline and findings. These editorial changes create no new implementation scope or Jira updates.

| Version 2 reference | Version 4 location |
|---|---|
| 01–02 · Reminder / current car | 01, new 01a and 02 |
| 03–05 · Needs / preferences / delegation | 02–03 short setup; 04 delegation; new 04a search / hold |
| 06 · Renewal help | 08, available but unused |
| 07 · Release and hold | 09; initial search / hold also in 04a |
| 08 · Offer | 05 first offer; 10 second offer |
| 09 · Employee decision | 06 rejection; 07 revised limit; 11 selection |
| 10–11 · Approval / appointment | 12–13 |
| 12–14 · Physical handover / later use / next cycle | Outside the main walkthrough; continuing-service note only |

Version 4 notes use a separate browser-storage key. Existing version 2 / 3 comments remain untouched and can be exported with their original version context.

## Verification

Checked the served HTML in Chromium using isolated contexts, leaving the visible browser at its existing width and avoiding the user’s saved notes.

- Fifteen headers and fifteen cells in each of three rows; 36 input cards. Print exposes the same fifteen stages and hides the screen table.
- All six chapter jumps settle on the correct active chapter. Visible ranges include 01a / 04a; the end control disables at the end. Keyboard scrolling and row jumps work.
- Page width equals the viewport at 2048, 390 and 320 px. Narrow content blocks and row labels have no horizontal text overflow.
- Desktop and narrow views inspected for current car / usage, setup, agent work, offer / rejection, background responsibilities and data.
- Axe-core WCAG A / AA scans found zero violations at desktop and mobile. Some contrast checks for clipped / overlapping sticky content remain incomplete; actual rendered colours were inspected. This is not an accessibility certification.
- Browser checks recorded no page-script errors. New notes save across reload and export literal markup / newlines as text. Version 2 / 3 exports retain their original notes and identity unchanged.
- Final Impeccable detector found no issues; whitespace checks and local file-link checks passed. Final captures were refreshed after the 320i correction.
- Print emulation verified matching content and screen-table hiding. PDF pagination and physical printing were not tested. Application tests were not rerun because no application code changed.

Final evidence:

- [Current car, usage and manual route](evidence/fucq-3/v4/car-usage.png)
- [Short setup](evidence/fucq-3/v4/short-setup.png)
- [Explicit agent work](evidence/fucq-3/v4/agent-work.png)
- [First recommendation and rejection](evidence/fucq-3/v4/first-offer-rejection.png)
- [Readable background responsibilities](evidence/fucq-3/v4/plain-background.png)
- [Connected data / adapters](evidence/fucq-3/v4/connected-data.png)
- [Second offer](evidence/fucq-3/v4/second-offer.png)
- [Narrow rejection](evidence/fucq-3/v4/mobile-rejection.png)
- [Narrow background responsibilities](evidence/fucq-3/v4/mobile-background.png)

## Delivery record

Authored and checked in the parent session; no subagents started for version 4. The [earlier record](service-blueprint-review-v3.md) records previous agent participation without implying independent approval of this revision.

Codex gateway verification passed on IBM Global. Concurrent architecture, screenshot-index, experience-contract and implementation-story edits were preserved. This revision created no User Stories, Jira updates, outbound messages, live BMW transactions, deployment, automation or poller. Carbon / IBM Plex provenance and licences remain in the [asset record](assets/service-blueprint/README.md).

Russell authorised committing this blueprint package on 1 November 2026 for his review with GC. Scheme-policy and integration assumptions remain for review.
