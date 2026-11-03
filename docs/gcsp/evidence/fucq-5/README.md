# FUCQ-5 architecture evidence

1 November 2026. Checkout `eefc85c` on `gcsp-poc`, including existing uncommitted GCSP research/design/story context. The deliverable is the [canonical draw.io HLD](../../../design/high-level-design.drawio), [view index](../../../design/README.md) and [whole-demo architecture record](../../../design/gcsp-high-level-design.md). It is proposed for architecture agreement; application implementation and BMW operational acceptance are separate.

## Research and source review

The parent read the GCSP index, brief, experience contract, component catalogue, current blueprint's complete service content, its research and v3/v4 review records, engine-reuse assessment/evidence and shared-recommendation design. The print representation duplicates the same blueprint service content. Two independent reviewers read the remaining research in full:

- `research_boundaries`: BMW interface research/stories and FUCQ-4 evidence; synthetic VIN proposal/rules; the full dated scheme guideline and eligibility extracts; ZEV research; all persona/source records and screen index.
- `architecture_evidence`: background, discovery, business-model exploration/argument check, capability proposal, Sandeep/GC questions, delivery evidence, FUCQ-7/FUCQ-12 story records and the original Mural CSV. It also checked relevant source, Pages/Render configuration, root/harness API resolution and EDS sync workflow.

The architecture record's research-coverage table links the evidence and its design consequences. No additional public research, credentials, BMW writes, provisioning or mail sends were needed.

## Decisions and corrections

- Extend one canonical diagram. Add **00 GCSP architecture** as a parent responsibility/navigation view; retain **02 Shared recommendation target** as its child/detail. Add **06 Vehicle evidence providers** and **07 Planning and lifecycle** and cross-link the existing employee views.
- Keep logical modules in the current backend, pure shared computation separate from scenario policy, and immutable VIN/configuration artifacts separate from changing transaction state. The proposed VIN lookup exposes actual HTTP without requiring another microservice/database.
- Address research-derived omissions: requested/resolved source IDs/options/fidelity; explicit synthetic identity routing and no real-decoder fallback; five-WMI/10,000-distinct publication limits; separate request/confirmed-supply/released-stock stages; acknowledged selection/order/booking and handover boundaries.
- Correct release documentation: Pages rewrites the harness API attribute while the root picker has an independent default. Main can also trigger the existing EDS consumer sync. Live Render branch/plan, database/runner/mail setup and BMW authorities remain owner gates.
- During review Russell confirmed preference sliders and separate importance weights; the exact supplied localhost:3163 blueprint URL was byte-identical to the local v4 file containing contrary text. His direct clarification is retained in the brief/index/HLD. Russell then asked to defer detailed interface discussion until the rest of the HLD is done. The blueprint itself and its saved review notes were left intact.

## Independent review

Both reviewers were dispatched with the authoritative `tools/tiers spawn reviewer --harness codex` output. Requested tier Opus; requested and selected `gpt-6.1-sol` / `high`; `fork_turns: none`; no fallback or descendants. Runtime-effective settings were not independently inspected. Follow-ups used the same agents/pairs.

The initial research audit identified substantive missing vehicle-source/synthetic contracts, which were incorporated. Both subsequent document reviews returned **PASS — no blocking or major issues found**. Minor corrections clarified that the HTTP lookup is proposed, acceptance respects the held quote's pinned terms, and released-stock visibility includes cohort/release-list membership. Parent review owns diagram content and rendered checks; the reviewers did not edit or manipulate the browser diagram.

## Verification

- IBM gateway check: PASS on `api.servicesessentials.ibm.com`. Scaffolding doctor/install were run; install staged metadata. No privileged apply or app restart was performed. Doctor's separate Claude-default endpoint failure does not describe this Codex gateway.
- Canonical draw.io exported successfully: ten pages. Structural inspection found no duplicate IDs within pages, no broken page hyperlinks, and no page above the 30-shape/40-connector readability thresholds. Twenty internal page links resolve.
- New and changed views were exported with draw.io and inspected for text clipping, overlapping shapes/legends, connector labels and grouping. Layout corrections and shorter connection labels preserve readability; the existing detailed views remain zoomable. The index links their PNG exports.
- All 115 local Markdown artifact targets resolve and `git diff --check` passed. No application/runtime files changed, so application tests were not rerun; the earlier 234-test retail result is historical baseline evidence only.
- The existing blueprint, review-note storage, unrelated local changes and proposed/built status distinctions were preserved. No broad dev poller, automation, implementation stories, deployment or commit was started by this task.

## Acceptance status

FUCQ-5 is **In Review**. The architecture proposal covers the issue's employee/Greg responsibilities, shared shell/UI/recommendation relationships, real/fixture data and operations, exact holds/mail, distinct supply stages, migration, Pages/Render/EDS release and later BMW integration conditions. Russell/Gary's design agreement remains outstanding. Open scheme-policy and hosting choices are explicit gates for the affected capabilities, rather than implied production facts.
