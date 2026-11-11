# Buddy status on Your cars · 11 November 2026

Gary requested clarifying questions and visual options before build. His answers:

- One account-level Buddy status.
- Compact but clearly visible.
- Unconfigured wording: **Buddy · Set up your buddy**.
- All three states open the buddy page.
- Suggested location: the gap above the current-car panel, shown in the supplied screenshot.

[Open the static design board](index.html). A is an unboxed status link (recommended), B an outlined indicator, C a status plus named View buddy route. Each shows the supplied gap in context and all three state variants. The screenshot crop is Gary’s supplied 13:21:09 image; its historical contract countdown is retained as background, not recalculated. The page title is outside the crop's left edge. Proposed placement aligns with that title row and the right edge of the car panel; narrow placement can wrap below the title.

References: `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, `docs/gcsp/your-cars-ui-rules-review-2026-11-11.md`, current GCSP Density tokens. These are static HTML/CSS sketches with the source screenshot, no scripts, navigation, state changes, data wiring or production changes. Green/check, amber/pause and neutral/plus are proposed cues; text also conveys state. An unresolved/failed status read must not be labelled unconfigured in a future build.

The 10 November frozen Account reference and existing FUCQ-370 overlap this area; choosing a direction here is not a Story amendment or delivery claim. Spec, Story reconciliation and implementation follow selection. No Jira or product-map status is changed.

Validation: static HTML/asset sanity checks and `git diff --check` passed; a quick browser look at 1280 px confirmed all three placements and nine state examples. [The saved board](options.jpg) shows that render. Application tests, interaction tests and full visual acceptance were not run for this static concept task. The temporary preview server was stopped after capture; the HTML and saved image remain available.

## Refined combination

Gary chose C’s Active presentation with B’s box styling and requested mockups for every status. [The combined board](combined.html) shows Active, Paused and Not configured side by side, each in the supplied gap and with a readable detail underneath. Following Gary’s next refinement, Active/Paused retain C’s coloured dot and state text with an arrow inside B’s white outlined box, with the View buddy wording and its divider removed; the unconfigured state uses the chosen Set up your buddy wording. This is a further static concept, pending selection before build. The original options remain available.

Validation: static sanity checks and `git diff --check` passed. One quick 1280 px browser look confirmed the three combined states; [the updated combined board](combined-statuses-no-label.jpg) records it. No application or interaction tests were run. The preview server was stopped after capture.

## Cross-page consistency options

Gary preferred the original chevron and supplied the 13:35:10 Your buddy crop to discuss consistency and replacing its ellipsis menu. The combined Your cars concept now uses chevrons in all three states. [The cross-page board](consistency.html) compares two static directions across Active, Paused and Not configured:

- A (recommended): retain the chosen Your cars dot treatment, use the same dot/colours/wording on Your buddy, and expose a separate named Pause search / Resume search control.
- B: use the existing Your buddy circled check/pause icon language on both pages and combine its status and named control in one outlined group.

The unconfigured Your cars indicator retains Set up your buddy. Your buddy shows Not set up and a named setup control. Resume search is proposed instead of Restart to convey continuing the saved search. This is visual discussion only; no real control, policy change or permission mapping is implemented. Other live outcomes (finished, unavailable or not authorised) remain distinct from the three states being explored. The existing menu/source was read for context; no production defect triage or repair is claimed. The two treatments use the existing GCSP Density theme; no full spec, Story amendment, Jira update or product-map status change is made.

Validation: static HTML sanity and scoped whitespace checks passed. Quick 1280 px browser looks covered the six paired state examples and the restored chevrons in the original placement. Saved renders: [cross-page options](consistency-options.jpg) and [Your cars with chevrons](combined-statuses-chevron.jpg). No application or interaction tests were run. The temporary preview server was stopped after capture; source and small saved artifacts are retained, with no disposable scratch created.
