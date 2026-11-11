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

Gary chose C’s Active presentation with B’s box styling and requested mockups for every status. [The combined board](combined.html) shows Active, Paused and Not configured side by side, each in the supplied gap and with a readable detail underneath. Active/Paused retain C’s coloured dot, state text, divider and View buddy route inside B’s white outlined box; the unconfigured state uses the chosen Set up your buddy wording. This is a further static concept, pending selection before build. The original options remain available.

Validation: static sanity checks and `git diff --check` passed. One quick 1280 px browser look confirmed the three combined states; [the saved combined board](combined-statuses.jpg) records it. No application or interaction tests were run. The preview server was stopped after capture.
