# Angular port gap review (20 November 2026)

Gary, 20 November 2026: the Angular port "looks nothing like the node version, in some cases whole features or UI
tweaks are missing". This review answers three questions: why it happened, what fixes it, and why the local Node
screenshots miss features such as notifications.

**Evidence basis.** Node reference: commit `e44ed08a9`, the FUCQ-434 freeze. Live Node (`gcsp-api.onrender.com`,
branch `gcsp-poc`) has no GCSP code change against it in `blocks/gcsp`, root pages or `server/gcsp`, so the freeze
is what is live. Angular: `apps/gcsp-web` at `feab052d7` (`gcsp-poc-dev`). Sources were compared screen by screen
for every GCSP screen, and the high-severity findings were spot-checked by hand. The account page was also compared
in a browser on 19 November (session "Hosted version not working"). On 20 November the account, bell, offer and
presenter screens were compared rendered (see "Rendered comparison" below). Other rendered differences are inferred
from templates and CSS. A full screenshot-pair pass is step 2 of the fix.

## Rendered comparison, 20 November 2026

Node: `e44ed08a9` run locally in live mode (`GCSP_RUNTIME=1`, memory repository), scenario "Main successful
journey", after one release, signed in as Paula. Angular: hosted dev (`gcsp-buddy-dev-web.onrender.com`), signed in
as Paula, then as Presenter, with its state left as found. Captures are 1280px wide, in
[evidence/angular-port-review-2026-11-20](evidence/angular-port-review-2026-11-20/).

| Screen | Node | Angular |
|---|---|---|
| Your cars | [node-01-account](evidence/angular-port-review-2026-11-20/node-01-account.jpg): studio photo, 23px title, rating pill on the photo, bell with a red 1, icon preference tiles, Buddy tile with "A car is held for you" beside them | [angular-01-account](evidence/angular-port-review-2026-11-20/angular-01-account.jpg), [angular-01b](evidence/angular-port-review-2026-11-20/angular-01b-account-preferences.jpg): no bell, false "Some offer or order details could not be read" banner with a full-width Retry, "No image available", small title, bordered text boxes for preferences, native radios, a text "Buddy" block with four buttons |
| Bell | [node-02-bell-open](evidence/angular-port-review-2026-11-20/node-02-bell-open.png): "Your buddy found a car", thumbnail, respond-by time, View your offer | none |
| Offer | [node-03-offer](evidence/angular-port-review-2026-11-20/node-03-offer.jpg): Back to Your cars, swatches, "300 fewer than your current car", "Held until 13:30 · 2h 00m left to decide", big-number Benefits and Tradeoffs | not captured: getting Paula an offer needs a reset of the shared dev run |
| Presenter | [node-00](evidence/angular-port-review-2026-11-20/node-00-presenter-basic.jpg), [node-04](evidence/angular-port-review-2026-11-20/node-04-presenter-after-release.jpg): "100 cars released", Release Monday's cars, Start again, Open the portal, day bar, car grid, release and allocation tiles | [angular-04-presenter](evidence/angular-port-review-2026-11-20/angular-04-presenter.jpg): Run, Clock version, Scenario version, Fixture version and a raw `2026-11-19T09:30:00.000Z`; Next release disabled with "No future release cue is configured" |

All the high-severity findings that could be checked on screen are confirmed. One finding is new: the hosted
presenter can't release cars in its current scenario, so the demo's core beat can't be run there without a reset.

## 1. Why it happened

1. **The baseline captured routes, not the product.** FUCQ-434's inventory
   (`migration-baseline-2026-11-13/inventory.json`) lists 100 API operations, 17 page file names and 672 source-file
   hashes. It has no list of UI features, controls or states, and no screenshots of the running app. Its own text
   says "no new browser/visual pass is claimed". A feature with no route of its own, such as the header bell (it
   reuses the activity read), appears only as a hashed file. No migration Story names it.
2. **"Parity" came to mean data parity and route existence.** Story evidence checks Angular against Java JSON
   goldens (for example `account.java-parity.spec.ts`). The FUCQ-453 retirement matrix marks each legacy page
   retired because "every route below appears as a `path:"…"` entry in that bundle". Nothing compared what a
   person sees.
3. **Visual checks used the wrong reference.** The ACs said "Reuse the current account/vehicle visual reference"
   and "preserve visual design". Agents checked against the static references: the 1 November portal screenshots
   (`docs/gcsp/screens/`) and the 10 November mockups. They did not check against the running Node page. For
   example, FUCQ-440's record names `00-employee-account.webp` and a mockup PNG as the evidence it inspected.
4. **The component kit was rebuilt, not ported.** The components piece is on, and `COMPONENTS.md` catalogued 42
   Node kit modules: bell, stage tracker, task list, slot picker, activity timeline, metric tiles, count bars, range
   bars, release grid, loading skeleton, buddy tile and others. The Angular kit has 14. Stories recorded "no new
   shared primitive", so screens fell back to plain `dl`, `table`, native radios and text status screens.
   `angular.json` loads only `gcsp-shell.css`. Node's `vehicle-matcher.css`, `gcsp-kit.css` and per-block CSS
   never load, and templates dropped the Node class names. That is why the car title is 14px instead of 23px.
5. **Cross-cutting behaviour belonged to no Story.** Stories were cut by API capability, one screen each.
   Several things span screens: the bell, live refresh on presenter actions and polling, navigation between screens,
   breadcrumbs and loading skeletons. The strict-scope rule (14 November) then told agents to treat anything outside
   a Story as a separate proposal.
6. **The reference was deleted before anyone looked.** The experience contract set "no intermediate human layout
   or journey checkpoint": Gary reviews the hosted dev build at the end. That rule began as the 5 November "don't
   pause for layout reviews until the demo works" direction for the Node build, and it carried into the migration.
   FUCQ-453 (18 and 19 November) and FUCQ-482 (19 November) then retired every Node page and the Node HTTP surface.
   So the first human comparison came after the working reference had gone from the dev branch. This is the
   failure the new scaffolding rule "Turning my feedback into a standing rule" describes.
7. **Effort went into process proof, not the screen.** Story records are dominated by hashes, leases, resource
   receipts and allocation evidence. The 16 November Java audit (`dispatcher-learnings.md`, DL-20261116-RG-002)
   found 28 stories merged as done with unmet criteria. Its fix added a route-parity line for Java. No equivalent UI
   parity check was added for Angular.

### What should have been done

- Freeze a **UI feature inventory and a screenshot set** of the running Node app per screen and state, prepared
  from named scenarios so offers, the bell and order stages are populated. Gary or Russell approves it as the
  baseline.
- **Port the kit first**, component for component, with the same CSS and class names. Then port screens on top of
  it. Make `COMPONENTS.md` the checklist.
- Make the **parity AC a reviewed screenshot pair**: Node and Angular, same scenario, same viewport. Do this per
  screen, not per route.
- Give the **cross-cutting behaviour its own Stories**: shell, bell, live refresh, navigation and skeletons.
- **Check one ported screen with a human early**, before porting the rest.
- **Retire nothing until the parity sign-off.** Keep the Node stack runnable as the reference.

## 2. What is missing

H = whole feature missing or screen visibly broken. M = state, interaction or look clearly different. Low-severity
copy and spacing items are omitted here.

### Cross-cutting (H)
- **No notification bell.** Node's `kit/notification-bell.js` and `activity/notification-source.js` draw a badge,
  a rows panel and the "Your buddy found a car" note, poll every 30s and re-read on presenter actions. Angular has
  no bell. Its CSS is imported but unused.
- **No live refresh.** Node re-reads account, offer, activity, order progress and outbox on presenter actions,
  `pageshow` and polling. Angular has manual Refresh buttons only. The comparison poll is the one exception.
- **Screens are unreachable.** Nothing links to Activity: employee navigation is Your cars and Orders only, and the
  bell, Buddy tile and brief links that led there are gone. Nothing links to Greg's Next order (`greg/plan`) or
  Renewal cases (`greg/cases`). Greg also lands on Demand, not Next order.
- **Node stylesheets and class names are not used** (section 1, point 4). Loading skeletons are replaced by text
  status screens, and kit icons are missing outside the shell.

### Employee screens
| Screen | Missing or different | Sev |
|---|---|---|
| Account / Your cars | Buddy tile: status lamp, Pause/Resume, held-car panel, recent activity, history drawer | H |
| Account | Car title, facts grid and media styling; contract countdown block; star rating pill on the photo | H/M |
| Account | Order history without the shared data table or the Current car tag; Preferences and Buddy stacked, not side by side | M |
| Account (hosted) | False "Some offer or order details could not be read" banner when there is no order; car images 404 | H |
| Preferences | Category tiles with icons, importance colouring, slider stops, Same again help: now native radios and a `meter` | H |
| Preferences | Option chips, preview decision cards, links to Activity and order progress | M |
| Stock gallery | "View your offer" and car-taken notices; kit card styling; claim status moved to review | M |
| Order choices | Separate page with employee, driver and licence facts became an inline panel without them | M |
| Manual review | Live reservation countdown and consequence text; context shows internal ids (Draft version, Reservation version) | H/M |
| Manual summary | Six read-back cards (driver and licence, points and contract, and so on) with per-card edit; Finish and Print; raw Car ID shown | H/M |
| Activity | Unreachable (above); no live refresh | H |

### Offer, orders, help, Greg, presenter
| Screen | Missing or different | Sev |
|---|---|---|
| Offer | Exit links (Back to Your cars, Track your order, See buddy activity, Contact support); live refresh | H |
| Offer | Held-until countdown, points-saving line, winning-cell marks, stage list, decision drawer documents and error summary | M |
| Offer follow-up | "See buddy activity" after a saved change | M |
| Order progress | Live re-read and "Order progress updated"; stage tracker, task checklist, slot picker and timeline kits; help on proposed times | H/M |
| Greg case queue | Sort control (the code exists but is never called); raw gate codes may show | M |
| Greg | Six-tab dashboard split into routes, two of which are unreachable; order-request table now cards | H/M |
| Greg | Request-cars form, Production confirm/delay and Retry release queue missing (check whether this was agreed) | H |
| Greg | Metric tiles; range bars in the route comparison (raw JSON `pre` dumps instead) | M |
| Presenter | Basic console (Release tomorrow's cars, Start again, Open the portal); Today's release grid and count bars; car suitability matrix | H |
| Presenter | Scheme-week day bar; "What happened" feed with the captured-email drawer | M |
| Outbox | Live re-read; status chips | M/L |

**Intentional differences, not gaps** (FUCQ-434 "Intentional identity and state changes"): OIDC sign-in; no presenter
impersonation, acting principal or comparison start; comparison start is Greg's.

## 3. What fixes it

0. **Protect the reference.** `gcsp-api.onrender.com` deploys Node from `gcsp-poc`. On `gcsp-poc-dev`, FUCQ-482
   removed the Node GCSP HTTP surface and FUCQ-533 deleted `render.gcsp.yaml`. Merging `gcsp-poc-dev` into
   `gcsp-poc` would therefore redeploy `gcsp-api` without its GCSP pages. Hold that merge until parity is signed off,
   or first pin the Node service to a branch cut from today's `gcsp-poc`.
1. **Approve this inventory as the parity checklist.** Raise the gaps as Bugs against the delivered Stories
   (FUCQ-439 to 452): each Story's own AC already says to preserve the frozen visual design.
2. **Build a screenshot-pair harness.** Run Node at `e44ed08a9` locally on the live path, not fixture pages.
   Prepare each state with the named scenarios (`server/gcsp/scenarios/`). Run Angular against the Java API with
   the same scenario, then capture both at 1280px. Gary or Russell reviews the pairs; an agent's own check of a
   pair doesn't count as acceptance.
3. **Fix the cross-cutting items first:**
   - shell: bell, breadcrumbs, skeletons, icons;
   - a shared live-refresh service: presenter actions, polling, `pageshow`;
   - navigation to Activity, Next order and Renewal cases;
   - global loading of the Node kit CSS.
4. **Port the missing kit components 1:1**, keeping class names and CSS. Do this before reworking screens.
5. **Screens in demo order:** Account, Offer, Activity, Order progress, Manual review and summary, Presenter, then
   Greg. Fix the content defects in the same pass: raw ids, the false error banner, hosted car images.
6. **Sign off each screen against its pair** before retiring anything else.

## 4. Why the local Node screenshots miss notifications

- **Fixture mode never draws the bell.** The 19 November comparison opened `gcsp-account.html?fixture=ready` on
  `e44ed08a9` with `GCSP_OFFLINE=1`. In `blocks/gcsp/account/harness.js`, the `?fixture=` branch mounts the account
  with read-only fixture adapters and passes no `notifications` source. `portalShell({ notifications })` draws the
  bell only when given one ("Without it the header is unchanged", `COMPONENTS.md`). Only the live branch passes
  `createNotificationSource`. Fixture pages also skip the presenter subscription and live refresh.
- **A fresh local run has nothing to notify.** Bell rows come only from active or expired offers
  (`notificationRows`). Offers exist only after the presenter releases stock and Buddy allocates. Hosted Node has
  that accumulated state; a fresh local run does not.
- **The second attempt used half-retired commits.** It ran `ae69e6f6b`, then `9fa2b175b`, after some page routes
  had already been removed, and stopped before a capture.
- **The same gap affects Story evidence.** Agents' visual captures mostly came from fixture or preview pages.

**To capture Node properly:** use the live path (`GCSP_RUNTIME`, presenter "Open the portal"), and run a scenario
or "Release tomorrow's cars" first so an offer is waiting. Or capture against hosted `gcsp-api` with Gary's sign-in.
