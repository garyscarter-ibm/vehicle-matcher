# FUCQ-122 repeatable trials

These scenarios describe the connected help/case capability. The service and renderer steps are observed in `server/test/gcsp-case-journey.test.js`; desktop/narrow browser observation and delivered runtime/host placement remain pending. Do not offer these as a completed demonstration until the integration gates in `browser-plan.md` pass.

## Starting state and reset

Use one isolated synthetic run with the canonical policy, DemoClock, trusted Paula and Greg sessions, supplied current contract and no cases. The actual services share one repository and the API and pages share one origin. Recreate that isolated run to reset; the authored HTTP journey does this per test without using a native database. Keep Paula and Greg browser sessions separate. The default pages are `gcsp-help.html` and `gcsp-case-queue.html`; query-string previews are read-only visual examples.

The current delivered `createGcspRuntime`/demo page allowlist and Greg host references are incomplete, so a one-command integrated manual launcher is not yet available. The browser runner uses an explicitly isolated real-service composition and labels that boundary. Keep this limitation visible when arranging a trial.

## Ask for help and receive an update

1. As Paula, open Renewal help. Expand Get help with your renewal. Confirm that no case exists and opening the entry changes nothing.
2. Choose Ask for help, enter a delayed-renewal reason, review the stated effect, then cancel. There should still be no case.
3. Repeat the request and choose Confirm help request. Expect one owned case, the supplied reason, dated employee history and a UTC demo-clock next-action due time.
4. As Greg, load Renewal cases. Inspect the employee, deadline, trigger/request, reason, status, owner and due time. Change the sort order, select Paula's case and open it.
5. Choose the server-offered In progress status. Record a reason, next action and UTC due time. Review, then confirm.
6. Reload Paula's help view. Expect Greg's persisted update and action in the dated history. No specific car or higher priority is promised.

Observed automated outcome: explicit review was read-only; confirmation persisted one case/update; actual authenticated HTTP and both renderers returned matching owner, history, action and due time. Browser feedback: pending.

## Confirm exactly one preference change

Start with Paula's confirmed brief and an unused recorded decline. The current isolated proof inserts the decline as labelled synthetic setup; it does not prove an offer-decision producer.

1. Greg opens the current case and selects a preference offered by the server, then one permitted new value. Record the next action, review the old/new proposal and confirm the case update.
2. Paula reloads, reviews the proposed change and checks the current/proposed values and its stated effect.
3. Cancel once; the brief should remain unchanged. Review again and choose Confirm preference change.
4. Reload. Expect one new brief version, the changed preference value, every other preference/importance weight/essential preserved, and the confirmed explanation. The case remains for the scheme team to review.

Observed automated outcome: actual BriefService confirmation and reload preserved the other inputs and did not resolve the case or offer the same confirmation again. Browser feedback: pending.

## Deadline case and difficult outcomes

1. Reset to an isolated run with a supplied current contract ending within the canonical deadline window and no acknowledged selection.
2. Invoke the authenticated DemoClock tick. Expect one case opened by the registered renewal-risk handler with a system actor and the actual supplied calendar deadline. Replay the same tick; expect no duplicate.
3. Open the case as Greg. Missing suitable stock, confirmed brief, reviewed release date or extension permission must be explained as unavailable. A manual decision remains available where the server permits it.
4. Delay a read or drop a committed command reply. Expect loading/busy status, disabled duplicate actions and an uncertain result until readback or the same command retry proves the outcome.
5. Change the case elsewhere before confirming an older version. Expect a conflict and a request to refresh current server options, without a success claim.
6. Repeat with a stale run or denied session. Expect the distinct refusal and no available write action. Unmount during a delayed response; no later reply should replace the detached view.

Observed automated outcome: actual clock handler and replay passed; authored view tests cover typed failures, stable retries, stale versions, unmount and late-response guards. Actual browser/transport-loss observation remains pending. A fabricated lifecycle exception receipt is not a substitute for an unavailable lifecycle producer.
