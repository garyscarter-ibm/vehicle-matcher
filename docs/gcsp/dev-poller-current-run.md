# Angular port gap run — 22 November 2026

Phase: repair FUCQ-548 through FUCQ-561; ends when all fourteen have validated implementations, same-state 1280px Node/Angular screenshot pairs attached, and Jira status In Review. Human acceptance remains pending until Gary or Russell reviews the pairs. Do not mark Done. No work outside this scope is authorised by a scheduled wake.

Poller: usget-vesper. Root: /Users/usget/Claude/vehicle-matcher. Base branch: gcsp-poc-dev. Use SCAFFOLDING_HARNESS=codex and --poller vesper for dev_mail.py/scaffold_git.py; Jira uses SCAFFOLD_POLLER=vesper.

Latest explicit human instructions:
- Start/resume the dev-inbox dispatcher and follow defects. Read docs/gcsp/angular-port-gap-review-2026-11-20.md, its captures, docs/gcsp/experience-quality.md and docs/gcsp/build-rules.md.
- Order: 548 bell; 549 navigation; 550 live refresh; 551 Your cars; 552 preferences; 555 offer; 556 order progress; 553 stock/order choices; 554 manual review/summary; 561 presenter; 558 demand; 559 planning; 557 cases; 560 comparison.
- Independent Bugs may run concurrently with no shared file writers. 554 depends on 553: gallery reserves; no second reserve at review. 559 AC3 restores production confirm/delay and Retry release queue; inspect services/gcsp-api and add missing Node-parity routes with Java tests.
- Session routing override: implementers gpt-6.1-sol/high; story-leads gpt-6.1-sol/xhigh. Run tiers spawn for naming/brief, then explicitly apply these user selections at every depth; record requested/selected pairs. Ignore the automated capacity admission limits this session; use actual machine capacity and the available harness slots. Maintain bounded resource ownership, shared heavy-run coordination and sequential merges/full suites.
- Port Node kit components 1:1, retaining class names/CSS. First implementation slice of first Bug loads the Node kit CSS globally in angular.json; report it in the Result.
- Port shared stage tracker/list once for 555/556; task list, slot picker and timeline once for 556; metric tile once for 558. Update COMPONENTS.md in the same commit and reuse ports.
- The reference is e44ed08a9 (same GCSP code as live gcsp-api.onrender.com). Keep it runnable; never merge gcsp-poc-dev into gcsp-poc.
- Node reference on a free port P: from server/, GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_PUBLIC_ORIGIN=http://127.0.0.1:P PORT=P node index.js. Use live pages only, never ?fixture=. In /gcsp-presenter.html choose Advanced, Main successful journey, Reset scenario, Confirm, then Clock / Next release.
- Angular uses the local Java API and the identical scenario/state. Capture pairs at 1280px and attach both to the Bug. Agent comparison is a pre-check. User explicitly requires In Review even when the only remaining item is human review; this overrides generic partial-to-In-Progress sync behaviour for these Bugs.
- Write story_points when claiming each Bug. Report progress via dev_mail.py.

Standing project constraints: no OneDrive access, no foreground browser/tab/focus changes, no real email. Use shared local test stack, bounded scratch and finalizers. Preserve other pollers' claims and edits. Per-Bug focused validation plus real connected browser proof; do not substitute fixture/JSON/route evidence for visual parity. Persist retained evidence outside disposable worker worktrees.

Startup observations:
- Gateway PASS: endpoint api.servicesessentials.ibm.com.
- All fourteen Jira rows verified To Do, Bug, parent FUCQ-432, label backlog, native Relates links to the user-named originating Story (types verified).
- The linked docs/gcsp/evidence/angular-port-review-2026-11-20/ files are absent from this checkout and all fourteen Jira attachment lists are empty as read on 22 November. Do not claim to have viewed them; recover them if possible or reproduce before-fix captures while completing diagnosis.
- Full Jira pull and open-Bug reconciliation are being performed from authenticated Atlassian MCP data. New helpers were refreshed by inbox_setup, leaving the project-owned jira_sync.py unchanged.
- Prior full-suite holds exist in the 19 November handover and dev_mail; do not silently claim a green batch. Reconcile current instructions before broad validation.


Node reference worktree: /Users/usget/.codex/worktrees/gcsp-gap-poller/vehicle-matcher, clean at the full e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38 SHA. Preserve it through the run. Petunia Pig (child 01a204f1-577f-74f1-b8e4-86737530c995) is the first lead; requested/selected Sol xhigh is confirmed in its turn_context. Subsequent pickups must check native ui metadata; FUCQ-548 was repaired natively and re-imported, now check-story passes.

## Prerequisite finding and pending routing, 22 November 2026

FUCQ-562 (High, parent433, originating Story479, related561) records the real Java named-journey reset failure: Main returns503 scenario-not-available-yet, because ScenarioCatalogue unconditionally marks non-mechanics capabilities missing. Its native record and sanitized response docs/gcsp/fucq562-reset-response.json are retained. Russell has been asked whether562 should join this run as a prerequisite; until answered, do not silently add backend implementation to the14-Bug scope or call it deferred/accepted. Continue independent authorised UI work.

For exact-state UI proof, the parent approved loading only immutable frozen Main initial brief/consent/account/policy fixture inputs into an owned testDB via existing fixture/schema helpers, and the exact frozen stock through the existing tranche-plan provider. Actual Java services must produce release/allocation/holds/offers/notifications, then real OIDC/browser reads prove the state. Never insert derived outcomes, add preference categories, weaken editor engagement rules or claim named reset works. Preserve and compare input/clock/state identities; if equivalence cannot be shown, record incomplete parity. This is proof setup, not a production repair or AC waiver.
