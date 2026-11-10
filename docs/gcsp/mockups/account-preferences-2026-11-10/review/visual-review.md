# Account and Preferences mockup review

10 November 2026. Scope: the isolated interactive discussion mockup. No production feature or User Stories were built.

## Visual and usability verdict

The earlier independent PASS missed the actual image-boundary issue shown in the user's screenshot. The media-container bounds passed while the contained bitmap had letterboxing. The launcher corrected image sizing and inspected 820, 900, 1024, 1440 and 375px renders, including the new Points cost fact. Independent reviewer **Road Runner** then viewed all 20 final renders and verified all three source hashes against the final browser receipt. **Corrected verdict: PASS**, with no remaining actionable findings. This replaces the earlier insufficient media-container-only overlay assessment.

The wider centred page gives the car useful prominence while keeping the existing facts compact and identifiable. The image now determines its media wrapper's height, preserving the complete bitmap. Stars sit transparently inside the actual displayed image at every inspected width: 24px visuals with 44px targets, without a separate rating card. Considered categories show their saved choices, a distinct fill and a separate bin action. Three-stop sliders show all choices with a clear midpoint, including long endpoint labels at 320px. Opening an unset slider selects and auto-saves “A bit of both”; Done only closes it. Unopened categories remain unset.

The primary action explicitly engages or disengages Buddy; editing preferences alone never engages it. Top status combines a static red/green lamp and text. The two header allowance lines are removed. Current-car facts now include a full-width Points cost row showing 1,100 / 1,300 points per month; the standalone current-cost line is removed. Automatic-save feedback, three-category validation, named removal confirmation/cancel and retained Same again choices remain coherent at desktop and narrow widths. Same again disables category selection and displays 11/11. The mockup's proposed response to falling below the minimum while engaged is to disengage with an explanation; this interpretation remains for discussion.

Two earlier independent MINOR findings were corrected and reinspected: the missing-image fallback now has readable contrast, and category accessible names include saved choices. Those fixes remain present. The newly reported image-boundary miss was corrected and independently reinspected as described above.

## Verification and limits

`browser-review.json` records **93 passing scoped checks**, **20 screenshots**, no failed assertions and no uncaught page errors. The final supervised browser pass took 5.40 seconds. Widths: 1920, 1440, 1100, 1024, 900, 820, 375 and 320px. The proof now calculates the actual contained bitmap rectangle, checks the rating targets have at least 4px inset, and verifies that the media wrapper has no internal letterboxing. It also checks allowance removal and the labelled current cost/budget fact. A final visual correction gave Points cost the full facts width so it does not wrap unnecessarily inside one column; the final renders were inspected again. States cover empty, selected, options/default slider, validation, removal/cancel, Same again, missing image, long content and engaged/disengaged Buddy. Keyboard Home/End and arrow movement, reload persistence without Done, rating persistence, confirmed deletion, minimum engagement and score caps were exercised. Both JavaScript sources passed `node --check`.

The first added persistence assertion reloaded `?state=empty`, intentionally resetting the fixture. The proof was corrected to navigate to the base URL and verify persisted state. The final complete pass above is passing; the initial failed assertion and diagnosis remain in the local run receipts.

The prior production UI ratchet passed and is reused because production source/test/config identities are unchanged. Its roots do not cover this docs-only mockup. Source checks cover external module loading and absence of inline script/event handlers. The actual Impeccable CLI returned `[]` for the changed page and sources. Its static/regex analysis supports the rendered critique; it does not replace it.

Two narrow, file-scoped Impeccable ignore-value entries apply only to this mockup's `index.html`: `monotonous-spacing` traversed imported legacy CSS despite the rendered page's varied Density spacing; `pulsing-dot` matched an imported legacy rule whose element is never mounted here. Buddy's new lamp is static, verified in the browser. No rule-wide or file-wide suppression or ratchet baseline change was made.

Persistence is mockup-only localStorage. Buddy does not start a real search. The current production model has no 1–5 star-rating field and no suitable Buddy/model-confidence score. The displayed score is an illustrative completeness mapping, capped at 10 for preferences and 11 for Same again. Live recommendations, database persistence, real model confidence and future contract changes were not tested or implemented.

## Epic and review provenance

Native Jira Epic **FUCQ-358 — Improve Account and simplify Preferences** was created and read back as To Do, label `backlog`, default Medium priority. Later user requirements were recorded in comment `3628581` and its text verified by readback. User Stories are intentionally unwritten until the mockup discussion concludes.

Road Runner: reviewer/Opus, requested and selected `gpt-6.1-sol` with `high` effort, no fallback. Its desktop title was verified. An earlier continuation returned HTTP 422; the parent continued under the project rule and the resumed reviewer completed the final PASS. No credit balance is inferred. Jira runners Mary-Sue Walton and Maximus the Horse requested and selected `gpt-6-luna/high`, no fallback. Their title tool was unavailable; the CLI request and bounded receipts are retained locally, without independently claiming the effective gateway route.

## Resources and cleanup

All eleven manifest-owned scratch roots are verified absent. Aggregate measured peak allocation removed: **62,979,289 bytes**. Final browser peak scratch: **6,975,611 bytes**; peak process-group RSS: **231,669,760 bytes**. Bounded isolated local browser profiles were the declared compatibility exception and were removed. Owned browser/test child processes were closed and joined. No archive or 256MiB generated output was created.

The read-only preview server at port 4877 (PID 80687) is intentionally retained for user discussion and separately recorded in `preview-service.json`. The task-created Jira OAuth tab was closed; user tabs were preserved. Screenshots, source/proof, concise JSON evidence and useful bounded failure diagnostics are retained. Local impact maps, ownership manifests and final receipt are under `.claude/test-runs/account-preferences-20261110-01a1c6a0/` and `.claude/test-runs/impact/`. Feedback is received in this Codex chat; the mockup has no separate comment form.
