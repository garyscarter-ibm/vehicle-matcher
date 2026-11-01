# FUCQ-3 — Paula service blueprint, version 3

Historical record: its generic 5 Series premise is superseded by the screen-identified G21 320i M Sport Touring in version 4.

1 November 2026. [Open the blueprint](service-blueprint.html). Proposed continuing service for review; BMW rules and production integrations still require confirmation.

## What changed

Russell asked for each action by Paula to be explicit, for the differentiating experience to be visible, and for the story to include rejecting the first recommendation. Version 3 has sixteen steps. Every experience cell contains **Paula does**, **Paula sees** and a short explanation of the practical benefit.

The new central sequence is:

| Step | Story |
|---|---|
| 03 | Paula completes one guided brief, reviews it and switches on her agent. This combines the former life / preferences / delegation setup. |
| 04 | Her agent checks currently released cars, applies her brief and requests a confirmed exact-car hold while she works. |
| 05 | An email and account alert lead to the first offer page and comparison with her Touring. |
| 06 | Paula declines because the extra contribution is not worth this car to her, despite fitting her original ceiling. |
| 07 | A predefined follow-up asks about her limit. Paula confirms a lower ceiling; the agent saves version 2 of her brief, checks remaining stock and continues watching when nothing fits. |
| 08 | She views the available renewal-help options and closes the panel. She does not take an exception route in this story. |
| 09–11 | The next release is checked against her updated brief. The second offer shows what changed; Paula chooses it and submits her selection. |

Reminder, current-car feedback, approval, booking, handover, after-use feedback and the next renewal have explicit actions too. All sixteen columns connect to background work and input cards specifying sources, adapter types, flow methods and proposed frequencies. Screen and print use the same content.

This remains deterministic: choice lists, checkboxes, numeric / date fields and preference sliders with separate importance controls. Rule-based checks, scoring and fixed explanation wording use confirmed inputs. Written notes do not silently change matching rules. A rejection reason opens a particular question; Paula must approve any changed limit.

## Boundaries preserved

The first and second recommendations each require a confirmed hold before notification. Rejection releases the exact car; an uncertain release stays pending. Manual choices use the same pool. Essential needs, entitlement and the employee's limit remain constraints. Rejection alone creates neither recovery priority nor a penalty. Selection, approved order and physical handover remain separate.

Help is available without being forced on Paula. If an actual renewal-risk condition is met, the scheme team still owns follow-through. Extensions require the relevant authority. Appointment booking may precede signing; completed documents and readiness gate physical handover.

Paula's name, employer and Winchcombe locality come from the test screen; Russell supplies the Touring. Her personality, routines, quotations and the offer / rejection story are authored. The [persona sources](personas/sources.md#e11-paula-scenario) distinguish these from public Farnborough / hybrid-work evidence. All operational connections, policies and refresh intervals shown remain proposals.

## Numbering and existing review notes

| Version 2 references | Version 3 location |
|---|---|
| 01–02 · Reminder / current car | 01–02 |
| 03–05 · Needs / preferences / delegation | 03 setup; 04 first agent search |
| 06 · Renewal help | 08, visible but unused here |
| 07 · Release and hold | 09; initial stock / hold also shown in 04 |
| 08 · Offer presentation | 05 first offer; 10 second offer |
| 09 · Employee decision | 06 rejection; 07 follow-up; 11 selection |
| 10–14 · Approval through next cycle | 12–16 |

The FUCQ-7 reuse assessment retains its original version 2 numbering and findings, with a dated clarification and this crosswalk. No implementation scope or Jira records were changed by this blueprint revision.

Version 3 notes use a new browser-storage key. Existing version 2 comments remain untouched and can be exported separately when present. They are not silently moved onto different steps. Exported notes include their version and reviewer / meeting identity.

## Verification

Checked the actual served HTML in Chromium. Tests used isolated contexts so the visible browser stayed full width and no test notes entered the user's review record.

- Sixteen stage headings, sixteen cells in each of the three rows and sixteen matching print stages. Thirty-six input cards, repeated in the print view.
- Inspected combined setup, first offer / rejection, response / help / new release, second offer, input cards and the narrow rejection view.
- Full-width layout at 2048 px; page width equals the viewport at 390 and 320 px. Narrow row labels and content blocks have no horizontal text overflow.
- All six chapter jumps, current chapter, displayed visible-step range, row jumps and end-of-map state work. Navigation respects reduced motion.
- No page-script errors in the functional checks. New notes survive reload and export literal text / newlines. Previous-version export preserves the old note and its original version context.
- Desktop and narrow axe-core WCAG A / AA scans found zero violations. Contrast checks for some clipped / overlapping sticky headers and labels require manual review; their actual light backgrounds and dark text were inspected. This is not an accessibility certification.
- Print emulation exposes the same sixteen steps and hides the wide screen table. PDF pagination and physical printing were not verified.
- Final design detector and whitespace checks passed without suppressions. Local file links resolve.

Current visual evidence:

- [Combined setup](evidence/fucq-3/v3/setup.png)
- [First offer and rejection](evidence/fucq-3/v3/first-offer.png)
- [Agent response, unused help options and next release](evidence/fucq-3/v3/response-options-release.png)
- [Second offer and choice](evidence/fucq-3/v3/second-offer.png)
- [Corresponding data / adapters](evidence/fucq-3/v3/data.png)
- [Narrow rejection](evidence/fucq-3/v3/mobile-rejection.png)

Earlier captures in the parent evidence folder document version 2; they are not current version 3 verification.

## Delivery record

Version 3 was authored and reviewed in the parent session. No subagents were started for this revision. Earlier version 2 work used `paula_persona_revision` and `journey_data_mapping` as implementers / Sonnet, each requested and selected `gpt-6.1-sol` / `medium`; `data_and_policy_review` as reviewer / Opus, requested and selected `gpt-6.1-sol` / `high`. No fallback or descendants. Those earlier reviews do not claim independent approval of version 3.

The artifact uses the official IBM Carbon White theme and local IBM Plex fonts. [Asset provenance and licences](assets/service-blueprint/README.md) remain included. The employee application's visual reference and implementation are separate.

The Codex gateway check passed on IBM Global. This revision changed documentation and its review controls only. It created no User Stories, Jira edits, live BMW transactions, outbound messages, deployments, poller, automation or Git commit. Concurrent design / implementation-story work was preserved. Application tests were not rerun.
