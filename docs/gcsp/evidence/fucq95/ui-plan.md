# FUCQ-95 activity view proposal

5 November 2026. Proposal for the dispatcher's reserved next shared-kit lane; no UI implementation is released by this document. Backend checkpoint `1bcea40338c8d1f1464f963fae831c4b0fb38784` is pushed and frozen. Read the current merged kit at `95f7648ecef7b5c7664b83d56d48b13da71c0786` before implementation; this story branch has not yet integrated it. The dispatcher owns that integration and the serial `server/index.js`/shared-contracts lane.

## Job, reference and composition

Paula needs to understand whether the buddy may search, what it actually did, and what she can do next. This is an Operate surface inside the existing employee experience. It implements the agreed HLD/blueprint activity view, without a new service, store, scheduler or routing authority. Follow `docs/gcsp/experience-quality.md`, `build-rules.md`, `screens/README.md` and Gary's approved FUCQ-64 body reference `docs/gcsp/evidence/fucq-6/README.md`, source `a7fc178`.

Use the existing slim account header and icon navigation. The body starts with one title, “Your buddy activity”, then a prominent state and one Pause or Resume action. Explain its consequence beside it. A current offer, when the real contract identifies one, is the next focal element; show its actual state and an authorised Open offer action. Below, show the last successful check and outcome, then dated activity. Avoid a dense dashboard, stepper or repeat of the current-car feature. Offer imagery belongs to the exact authorised offer display, not a decorative banner.

At desktop, offer and search facts can share a broad content row, followed by a full-width history. At 375px they stack in reading order: state/action, offer, last check, history. Reuse the reference typography, light surfaces, teal actions, spacing and visible focus. Long vehicle names and missing imagery must fit without horizontal overflow. State labels include text; colour alone carries no meaning. Time is server demo-clock time, labelled as such; browser time and relative wall-clock countdowns cannot imply checks.

## Components and paths

| Piece | Decision and reason |
|---|---|
| Employee shell and navigation | Reuse `mountEmployee`/`portalShell` and its injected `navigation`/`renderBody` adapter. Provide an activity destination through composition; keep unrelated disabled destinations honest. Do not duplicate header/sidebar or alter launcher availability. |
| Heading, actions and states | Reuse `screenIntro`, `button`, `statusScreen`, `factList` and `el` from `ui.js`. Import the merged `blocks/vehicle-matcher/gcsp-kit.css` shared primitive layer, rather than moving old employee rules back into a new page. |
| Exact offer | Reuse `matchCard(null, { view, onAction })` and its `mediaWell` fallback only when the authorised offer adapter supplies the exact display/decision/terms contract. Missing display facts remain missing; do not derive a quote or eligibility in the client. A metadata-only stored reference gets an honest text summary until that contract exists. |
| Dated history | Add shared `activityTimeline({ events, heading, emptyText })` under `blocks/gcsp/kit/`: a semantic ordered list of supplied `{ id, occurredAt, label, detail? }` values and `<time datetime>`. It owns no requests or domain state. `factList`, `messageList` and `dataTable` do not express chronological activity. Use scoped kit tokens/styles and explicit empty/invalid-date treatment. |

Proposed activity-owned files: `blocks/gcsp/activity/{gcsp-activity.js,activity-body.js,activity-controller.js,activity-http.js,activity-copy.js,gcsp-activity.css,register.js,harness.js,fixtures.js}`, `gcsp-activity.html`, and an embedding/adapter contract under `docs/gcsp/`. Keep functions focused; do not create empty modules solely to match this list. `mountActivity(root, ctx)` composes the existing employee shell; `renderActivityBody` also works in an employee host. `<gcsp-activity>` has an injected adapter, deterministic mount/unmount and refresh, with no browser identity attribute or location/history ownership. Static harness fixture selection stays outside the element.

Shared-kit writes in the same consuming commit: timeline module/styles/test, `COMPONENTS.md`, the existing single `component-gallery.js`/`components.html` gallery, and `server/test/ui-ratchet.json`. Reuse the newly merged primitive styles and the GCSP-specific kit stylesheet; no parallel gallery or independent token set. Extend ratchet exclusion/patterns only for the real kit component and add explicit caps for new stylesheets. Existing baseline counts only fall; do not increase caps on existing stylesheets to absorb page-specific layout.

## Controller, transport and truth boundaries

The adapter supplies account loading, `readActivity({ signal })`, pause and resume. An HTTP adapter uses credentialed same-origin `GET /api/gcsp/activity` and the existing BriefService POST endpoints with a command id and `expectedBriefVersion`; it sends no employee/run/roles from the browser. Keep it separate from retail `api.js`. The host supplies session/runtime configuration through the existing trusted boundary.

Use server projection state on mount and every refresh. Pause/resume disable while pending; success always performs a fresh GET before rendering the resulting version. Do not optimistically flip permission. A stale-version conflict refreshes and explains the changed state. A failed refresh must not leave a stale enabled control that appears current. Abort and generation guards discard late responses after navigation, remount, reset or a newer request. Preserve focus on the active control where possible and announce the result through a bounded live region.

Current supported evidence is confirmed permission, pause/resume/confirmation receipts and whitelisted stored offer metadata. `lastSuccessfulCheck: null`, `searchEvidence: not-recorded` and `sourceStatus: evidence-unavailable` mean “Check information is not available”, not “No match found” or “Source delayed”. Active permission can say the buddy is active/allowed to search; it cannot promise unattended or overnight checks. Explain that demo checks happen on presenter actions. A paused view explains that new searches and holds are stopped and that an existing offer is handled separately; producer integration must verify the stop actually governs those operations.

The reader returns an offer collection ordered by identifier. The UI must not infer which is current from identifier order or invent a link from `offerId`. Offer tokens never enter activity projections, fixtures or logs. Reuse the real offer access/opening authority when available.

## Runtime dependencies required for complete acceptance

1. **Composition:** a real demo bootstrap must inject the same repository, identity and clock into `createActivityService`, inject that instance as `gcspActivity`, and compose the existing BriefService. `node server/index.js` currently calls `buildServer()` without these dependencies and truthfully returns unavailable. An employee account/session adapter and supported navigation host are also needed; static fixtures are not the connected journey.
2. **Search evidence:** reconcile actual FUCQ-92 release and FUCQ-96 allocation/check outcomes, including a real successful check with no match and actual source availability/delay. Agree additive read contracts with their owners before changing receipt consumers/schema. A clock tick, command receipt, evaluation or storage timestamp is not sufficient evidence. No second fabricated check stream is proposed.
3. **Offer lifecycle and access:** FUCQ-100 must create the actual offer; FUCQ-102 supplies run-bound access/current reads, FUCQ-105 the authorised exact display and FUCQ-106 the actual declined/expired states. Reconcile the canonical current-offer selection and safe employee opening route with those owners. Until then, current-offer/link acceptance is incomplete.

No policy constants are introduced by the view; policy/quote facts come through the server-owned projection and canonical PolicyService consumers. These dependencies remain required work, not a reduction in the planned demonstration.

## Early design and validation sequence

1. Dispatcher integrates the frozen backend and merged `95f7648` kit into the agreed branch, then releases the exact activity/shared-kit paths. FUCQ-94 remains read-only on those paths. No child starts until the dispatcher releases an actual slot and fresh tiers/capacity/resource admission is recorded.
2. Build one representative activity body plus the timeline in the existing gallery before the rest of the view fans out. Generate small synthetic fixtures through the real current reader/BriefService for confirmed-never-checked, paused-with-history and projection-unavailable states. Clearly label fixture data. A stored-offer metadata example may show the honest missing-access/display state; no fake successful check, delayed-source claim or working offer link.
3. Inspect the early body and adjacent approved employee/gallery surfaces at desktop and 375px, including keyboard Pause/Resume/Retry and long text/missing imagery. Record source identity, captures and observations for dispatcher/lead review before broader body work. Use background headless browser sessions; no foreground/focus change. Feedback is captured in the chat and a repository review record; do not add an on-page comment request without tested persistent retrieval.
4. Complete the custom element, real transport and command/reload/conflict behavior; then integrate the genuine producer/current-offer/access contracts. Only then generate repeatable fixtures and browser evidence for every required state: never searched, searching with no match, waiting offer, declined/expired offer, paused, and source unavailable/delayed.
5. Before running checks, update the impact map/selection for changed controller, DOM, transport, kit, shell and route boundaries. Use one supervisor-owned worker and small synthetic inputs, expected under 256MiB scratch/512MiB recursive RSS per short chunk initially; revise from measured DOM/browser requirements. Declare browser working-data exceptions if needed, keep their active set bounded, then delete them. Large outputs/archives go directly to the configured OneDrive path. Preserve concise identity-keyed results, stop/join children, release reservations and verify scratch absence at each checkpoint.
6. Selected UI checks will cover controller request ordering/abort/conflicts, real HTTP command-and-reload, element lifecycle and keyboard semantics, timeline date/empty/long-text behavior, shared-card/kit contracts, shell/unsafe-execution checks, render copy and UI ratchet. Review the affected selector plan; use explicit boundaries if unsupported. The story also explicitly requires one final `npm test` integration checkpoint, planned/budgeted separately after the complete integrated source stabilises. No backend scoped result substitutes for it.
7. Capture the six genuine states at desktop and 375px, with keyboard-only actions, focus, reload, pending/errors/conflict and reduced-motion checks. Lead reviews rendered results against `a7fc178`, fixes the observed set in one batch and confirms once. Record starting state, reset/click-through steps, expected/observed behavior, source identities and cleanup receipts before offering the connected story for review.

## Acceptance still incomplete after the backend checkpoint

| Acceptance area | Current evidence and remaining work |
|---|---|
| Activity screen | No activity screen yet. Last genuine check/outcome, distinct searching/delay and canonical current offer/link contracts are absent. |
| Activity projection | Scoped read-only brief/change/offer metadata reader and HTTP guards are validated. Real search/source outcomes and current-offer meaning are not implemented. |
| Pause/resume | Real BriefService HTTP commands plus fresh activity reads pass. Visible interaction, existing-offer guidance and enforcement by real search/hold producers remain unproved. |
| Every state/reload | Backend current-state reload is validated; all six rendered states and the genuine missing producer/lifecycle cases remain. |
| Shared kit | Plan only; timeline/catalogue/gallery/ratchet work and rendered consistency proof remain. |
| Embeddable/keyboard | No activity element yet; lifecycle, CSP/unsafe-execution, desktop/375px keyboard and focus evidence remain. |

Plan prepared by lead `gpt-6.1-sol/high` (runtime previously confirmed), using the component-kit and Impeccable Shape guidance within the binding already-agreed project direction. No UI code, browser allocation, new dependency, new topology, full-suite run or additional backlog scope was introduced.
