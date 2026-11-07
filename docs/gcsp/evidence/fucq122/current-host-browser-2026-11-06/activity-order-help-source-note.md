# Activity and order-progress help placement: source-only finding

Observed 6 November 2026, 19:00 UTC. The original FUCQ-122 help-entry criterion remains unmet in the inspected source: shared has neither host screen; the available FUCQ-95 activity branch has a host but no renewal-help entry. This is a composition gap as well as a browser-evidence gap. No product code, foreign work, Jira state, claim or acceptance text was changed, and no runtime check was run.

## Inspected identities and limits

- Shared `gcsp-poc`: `9f590bb016ea036031db3053e35468c41fd7d232`, clean at observation.
- Published `origin/dev/DEV-2026-11-04-083`: `c50851b4e0ba000dda5f233204b6a08324e1a0d1`. `ls-remote` matched the locally available remote-tracking object. That tip is not an ancestor of shared; its activity files are absent from shared.
- No local or origin branch named `dev/DEV-2026-11-04-082`, and no DEV-082/083 worktree, was observed. FUCQ-120 / DEV-082 remains in shared `_dev/code-inbox/DEV-2026-11-04-082.md` without a `claimed_by` field. This does not establish the state of unpublished work on another machine or the live Jira status.
- Inspection used the scaffold Git mutex/wrapper, committed-tree searches, named source reads and the existing story records. Foreign sources remained read-only. The earlier [waiting checkpoint](waiting375-summary.json) and its raw incomplete/exit 1 outcome are unchanged.

## Existing composition and routing

| Surface | Concrete source evidence | Missing original behavior and existing lane |
| --- | --- | --- |
| Shared employee workspace | `blocks/gcsp/presenter-controls/workspace.js:20` mounts `mountManualJourney`; its `onSupport` navigates to `gcsp-help.html`. `blocks/gcsp/account/harness.js:16` has the same support destination. `blocks/gcsp/manual-setup/journey.js:10` composes account, setup, gallery and review. | These are actual account/manual support entry points, not an activity or order-progress screen. FUCQ-100 owns workspace composition; its support route does not close FUCQ-122's placement criterion. |
| Activity, published FUCQ-95 branch | `gcsp-activity-live.html:14` mounts `<gcsp-activity data-live>` using `blocks/gcsp/activity/live.js`. `live.js:8` injects the HTTP adapter and only Brief/Activity navigation; `live.js:13` handles only the Brief destination. `gcsp-activity.js:10` exports `mountActivity`; `:38` passes Retry/Pause/Resume to `activityBody`, while `:87` emits `gcsp:navigate`. `activity-body.js:29` offers only Pause/Resume in its action menu. The separate `gcsp-activity.html` uses the synthetic preview harness. | No help import, mount, action or help navigation handler exists in the inspected branch's GCSP blocks/pages. Route the placement work to FUCQ-95 / DEV-083, recorded `claimed_by: usget` (Russell), coordinated with FUCQ-122's existing help consumer. Do not adopt or edit that foreign branch here. |
| Order progress | No order-progress block/page, `stageTracker` or `taskList` consumer was found in shared GCSP source or the inspected activity branch. DEV-082 names a proposed order-progress view used by account and offer views; its original states include approval declined with a help entry. | A host and its help entry are absent from the inspected source; this cannot be closed with a screenshot alone. Route to existing FUCQ-120 / DEV-082 through the dispatcher; current pickup owner is unresolved. FUCQ-122 owns the reusable help body, while the order-progress view itself remains outside its scope. |

The reusable consumer already exists in shared: `blocks/gcsp/cases/gcsp-help.js:21` exports `mountHelpBody`; `:174` exports `mountHelp` with an `embedded` path, and `:185` defines `<gcsp-help embedded>` with adapter injection, heading-level support and teardown. `blocks/gcsp/cases/register.js` registers it; `gcsp-help.html:14` provides the standalone destination and loads the case stylesheet. `blocks/gcsp/cases/http-adapter.js:52` supplies existing help/case reads and the explicit request command. No new service port or FUCQ-96 admission gate is needed to expose the existing help flow from a host.

## Smallest useful action

Coordinate host-owned entry wiring with FUCQ-95, and preserve the same integration point for the existing FUCQ-120 lane when its host is available. Reuse the shipped help destination or embedded consumer and its no-write opening/review/explicit-confirmation behavior. These are existing FUCQ-122 requirements, not new ACs or a request to take over another story.

After actual host composition, the original desktop/375px keyboard, focus, status and read-only-open/explicit-request evidence remains due. Existing help/service/waiting proofs remain credited. No new defect, repair, native/live-source requirement, runtime grant, Done recommendation or shared adoption follows from this source note. All collaborators retain equal authority; routing metadata does not confer higher approval authority. Existing independent FUCQ-150 and FUCQ-146 findings and the failed npm result remain as recorded in the [original-AC matrix](original-ac-evidence-matrix.md).
