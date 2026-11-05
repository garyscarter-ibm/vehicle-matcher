# GCSP activity entry contract

`mountActivity(root, { adapter, brand = 'bmw', navigation, onNavigate, signal, offerDisplay })` in `blocks/gcsp/activity/gcsp-activity.js` mounts the existing employee shell. Its teardown empties root, destroys the body/menu listeners and aborts owned account, activity and command requests. An external abort also tears down. `teardown.refresh()` reads the current server projection; an in-flight command owns its final fresh read. Activity is read only after the account is ready. Unsupported brands and account failure never start that read.

The function exports `ACTIVITY_DESTINATION`, key `activity`, label `Buddy activity`, with the existing activity icon. A host supplies common navigation and receives `onNavigate(to)`; this consumer never changes location or history. Without host navigation, other employee destinations remain unavailable.

Adapter methods:

| Method | Contract |
| --- | --- |
| `loadAccount({ signal })` | Existing shell account: `{ status: 'ready', name, context }`, loading or unavailable. Identity stays with the trusted host. |
| `readActivity({ signal })` | Real activity reader result, `{ status: 'ok', value }` or a server failure. No confirmed brief means `permission: null`. |
| `pause({ commandId, expectedBriefVersion, signal })` | Current BriefService pause command and result. Optional; absent callback disables the action with “Preview only”. |
| `resume({ commandId, expectedBriefVersion, signal })` | Current BriefService resume command and result. Optional on the same terms. |

`createActivityHttpAdapter({ fetch = globalThis.fetch, loadAccount })` in `activity-http.js` implements GET `/api/gcsp/activity` and POST `/api/gcsp/brief/pause` or `/api/gcsp/brief/resume`. Paths are fixed and same origin, credentials are same-origin, cache is no-store and redirects fail closed. POST bodies contain only command id and expected brief version. No browser employee, run, fixture, role or access selector is accepted.

`createActivityController({ adapter, onChange, createCommandId })` owns reads and command sequencing. It aborts superseded reads, ignores late results, deep-copies supplied and returned snapshots, serializes commands and never changes permission optimistically. Pending commands retain the prior server facts with actions disabled. Success, conflict/stale version and failure all cause a new read. Failed or malformed reads clear old facts. A stable polite live region reports concise outcomes; focus follows replaced owned controls through pending/read/retry, while focus moved outside the body stays outside.

`<gcsp-activity>` uses light DOM and an injected `adapter` property. Its sole observed attribute is `brand`; it has no identity or fixture attributes. Register idempotently with `defineGcspActivity(registry = customElements)` or external module `blocks/gcsp/activity/register.js`. An adapter assigned before definition survives the custom-element upgrade. Adapter replacement and brand changes remount and abort prior requests; disconnect tears down. `element.refresh()` delegates the current read. `gcsp:navigate` is cancelable, bubbling and composed, with `{ from: 'activity', to }`; routing remains with the host. An adapter may provide `navigation` and `offerDisplay` for that host.

Styles remain `blocks/vehicle-matcher/vehicle-matcher.css`, `blocks/gcsp/shell/gcsp-shell.css`, `blocks/gcsp/activity/gcsp-activity.css` and `gcsp-employee.css`. No new style rules are needed. `gcsp-activity.html` is still the labelled synthetic design preview. `gcsp-activity-live.html` loads the external `activity/live.js` consumer against the same trusted host as the live Brief page. The live module imports only the pure shared account adapter; it uses same-origin fetch for activity, sends the fixed Brief navigation path and refreshes when restored from the browser's back/forward cache. The trusted runtime/bootstrap/static whitelist belongs to FUCQ-94.

The current reader proves confirmed permission, pause/resume history and stored offer rows. It does not yet have genuine check/no-match/source-delay receipts, canonical current-offer selection or offer access/lifecycle. Missing evidence stays unavailable. An `offerDisplay` must select an actual supplied row by explicit `offerRef.offerId`; identifier order never establishes currentness. A synthetic design offer is not an integrated allocation proof.
