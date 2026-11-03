# FUCQ-73 backlog and architecture record

2 November 2026. Russell approved the learned demand/choice model feeding constrained order planning and requested a backlog item and HLD update. This record covers authoring and verification; implementation stories, model training and execution remain subsequent work.

- Created **FUCQ-73**, “Recommend Greg's next vehicle order using predicted employee demand”, as an independent Epic with the `backlog` label, status To Do and default Medium priority. Read back the saved fields and description; [verification metadata](jira-verification.json) retains the identity/status.
- Added **08 Predictive order planning** to the [canonical HLD](../../../design/high-level-design.drawio), with an [export](../../../design/predictive-order-planning.png) and [architecture contracts](../../../design/gcsp-high-level-design.md#gregs-next-best-order-fucq-73). Updated overview/lifecycle references, the brief, context index and [research/refinement record](../../greg-predictive-research.md).
- Recorded offline training/evaluation, immutable model artifacts, active-model selection in the canonical policy source, separate choice prediction and constrained planning, baseline/fallback behaviour, Greg's intentional submission and Production-response replanning. Model/solver selection remains refinement; synthetic learning does not establish BMW predictive accuracy.

Verification completed: IBM Global gateway PASS; canonical draw.io saved with 11 pages; XML, unique cell IDs, connector/parent references, 20 existing internal page links and all page density limits passed. The new page contains 17 feature shapes and 21 connectors, plus the status legend. All new feature elements remain proposed.

Semantic comparison against the saved Git baseline confirmed every existing cell was retained and only six intended existing labels/references changed; the new page is additive. The stale simulation stretch label now reflects the full-build direction. Four new/changed views were exported and visually inspected; the new page's layout was changed to a more compact top-to-bottom flow. Local Markdown targets and whitespace checks passed.

The draw.io tab remained inactive, the browser's active tab ID was unchanged, and the editor was returned to its prior vehicle-evidence page. No application code, live integration, poller, model-training run, commit or deployment was started by this authoring task. The wider FUCQ-5 architecture agreement remains separate from Russell's approval of this capability.
