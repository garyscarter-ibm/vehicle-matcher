# FUCQ-551 Your cars parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. This dispatcher run already authorises the lead/implementer approach; the dispatcher coordinates physical slots.

**Goal:** Restore the six original FUCQ-551 account capabilities and demonstrate same-state parity with Node e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38.

**Architecture:** Port the source-named Node kit markup and scoped CSS into the existing Angular account composition. Reuse authenticated account, brief/activity, offer and order contracts and existing shared Angular components; preserve their authority, command and failure boundaries. No backend, schema or persistence change is included.

**Tech Stack:** Existing Angular standalone components and Vitest; pinned Node24.22.3/npm11.19.1; existing Java API only at the coordinated integration boundary.

**Spec:** `_dev/in-progress/DEV-2026-11-22-vesper-026.md`; `docs/gcsp/angular-port-gap-review-2026-11-20.md` section3; `docs/gcsp/experience-quality.md`; `docs/gcsp/demo-brief.md`; `docs/gcsp/build-rules.md`.

## Global constraints

- All six original ACs remain fixed and unticked until their actual evidence exists. Claimed estimate remains13 points; implementation slices are5+5+3 points, each at most8.
- Frozen live Node reference is e44ed08a9; preserve its worktree. Use the existing Node classes/CSS and the 1.6fr/320px account pair geometry,23px vehicle title and source wording.
- No OneDrive access, foreground browser/focus changes or real email. No new connected composition before dispatcher allocation; F562/F564 backend scope remains unanswered.
- Preserve F548 global CSS/bell, F549 navigation, F550 refresh and F552 preferences at supported integration. Do not copy, cherry-pick or manually stack their unmerged source.
- Excluded: preferences/category/mode/understanding-meter/account-preferences/editor/BriefEditorStore; shell/routes/auth/backend; angular.json styles/build/deploy settings; F550 service/activity/offers/orders/outbox. Source+catalogue entries share a commit. F552 preference ports remain reserved.
- Below High defects are independent linked backlog Bugs; Critical/High requires active triage or explicit human deferral. Original AC failure is never silently reclassified as an optional addition.

## Refreshed diagnosis and interfaces

On claimed base0f5959bc9, `previewFailed` already excludes not-found for offers/orders (earlier fix fa4996cd53). Preserve it and exercise absence versus genuine read failure before any banner change. The current hero uses local current-car/car-copy classes and a below-facts native rating; Buddy composition is absent; history is hand-built despite an existing shared table.

`AccountComponent.image(contract)` currently accepts HTTPS or root-relative media and returns it unchanged. The known frozen Paula asset exists in the repository but not Angular src/assets. Read-only probes on22November: web origin404 text/plain, Java API origin404 application/json, frozen Node host200 image/webp. Runtime config points Angular to gcsp-buddy-dev-api.onrender.com. These probes identify deployment absence for the known asset, not the currently authenticated hosted account payload. Do not hardcode the Node host or assume an API origin resolver fixes it. The dispatcher approved only the angular.json assets mapping on22November: glob `*.webp`, input `../../assets/gcsp-vehicle-evidence` (relative to apps/gcsp-web), output `assets/gcsp-vehicle-evidence`. The existing source set is921WebP files,87,265,982bytes; no image copy/generated asset is needed. Preserve styles and all other settings; no deployment-file edits.

Existing Angular ports to inspect/reuse: `kit/data-table.component.*`, `kit/vehicle-details.component.*`, `kit/star-rating.component.ts`, `kit/side-drawer.component.*`; `preferences/current-car-rating.component.ts` and its focused spec; existing BriefClient/ActivityClient read and command contracts. Exact Node account-buddy.js/buddy-tile.js composition is the authority for event ordering, state lamp/copy and held offer, and its existing source helpers are the authority for pause/resume and drawer contents. No invented timestamps or derived outcomes.

## Durable slice plan

### 1. current-car — source styling and rating (5 points)

**Files:** account.component.ts/html/css and focused account specs; preferences/current-car-rating.component.ts and its focused spec; kit/star-rating.component.ts and source-named supporting scoped CSS/spec only after inventory. Extend existing vehicle-details only when its public contract can preserve other consumers. Matching narrow COMPONENTS.md entry and existing gallery state in the same source commit.

**Interfaces:** Retain ContractView identity/media/facts and existing rating save/read ownership. Reuse current `gcsp-current-car-rating` contract or an additive presentation input; do not change BriefEditorStore. Node source: kit/vehicle-details.css, kit/star-rating.js/help-tip, employee/representative-body.js74–75 and account current-car composition.

- [ ] Read exact frozen source and existing Angular callers before edits; record reused, extended or ported component decisions.
- [ ] Add focused expectations that current car has gcsp-vehicle-title, source two-column facts, source clock/countdown, rating pill within photo media, words/help and retained rating commands. Run those cases red through the run supervisor.
- [ ] Port the source structure/classes/CSS; preserve absent/broken media and rating failure/disabled semantics. Use host display adaptation only where Angular requires it.
- [ ] Run account/rating/changed-kit cases, inspect the changed source and ported CSS against Node, then commit/push this coherent source+catalogue chunk through scaffold_git.

### 2. buddy — account Buddy composition (5 points)

**Files:** new `kit/buddy-tile.component.ts` plus source-named scoped CSS/spec; account-specific Buddy composition in `account/` with focused specs; account.component integration; matching narrow catalogue/gallery state. Reuse existing SideDrawerComponent, ButtonDirective, shared status semantics and source timeline support; add a source-named timeline port only if the inventory proves absent and the dispatcher allocates it.

**Interfaces:** Consume the existing scoped activity/brief read result and guarded pause/resume commands; preserve current offer identity/href and authoritative stateChanges/lastSuccessfulCheck/offers timestamps. Reuse existing offer presentation; all data access remains in the account owner/composer rather than the kit tile.

- [ ] Read buddy-status/activity-timeline/side-drawer and current Angular activity contracts; freeze the smallest input/output contract before assigning the writer.
- [ ] Add red component/composition cases for loading, active, paused, held active offer, finished, unavailable; assert Pause/Resume ownership, held car/respond-by/View held offer, first2Recent activity, Buddy history drawer and Track your order.
- [ ] Port buddyTile1:1, mount beside Preferences at1.6fr/320px, retain response-pending disabling and honest partial evidence. Preserve drawer focus entry/Escape/return.
- [ ] Run selected Buddy/account specs and boundary/ratchet checks; review source and commit/push the bounded source+catalogue chunk.

### 3. account-history-media — table, failure regression and image deployment (3 points)

**Files:** account.component.ts/html/css/spec, existing data-table component/spec only if a source-supported extension is necessary. The dispatcher has allocated only the angular.json assets array for glob `*.webp`, input `../../assets/gcsp-vehicle-evidence`, output `assets/gcsp-vehicle-evidence` (921existing files;87,265,982bytes). Preserve styles/build/deploy settings and F548 global CSS; no deployment/server source edit is allocated.

**Interfaces:** Existing ContractView histories and `openRecord(contract,event)` retain record identity/focus/print; shared table columns/rows carry Current car tags and named record actions. Keep source404 semantics and genuine failure retry behavior. Asset proof must resolve the authenticated current contract's actual src and verify200 on hosted dev after supported deployment.

- [ ] Add red tests that history uses shared gcsp-data-table with Current car tag/named actions and that order not-found stays silent while unavailable/forbidden read failures show the real failure note.
- [ ] Replace the hand-built history table by the existing shared table's supported row/cell/action interface. Preserve no-history, history-only scheme and placed-order states.
- [ ] Use the approved exact assets mapping to implement the narrow image delivery fix; test exact src containment and hosted asset identity. Do not label the known frozen asset probe as current-account acceptance.
- [ ] Run focused account/table/image checks; review source and commit/push its coherent chunk. If the hosted path is unavailable, retain the precise unproved criterion.

### 4. integration-validation — supported sibling integration and focused build (0 points)

- [ ] Dispatcher integrates F548 global CSS first slice33698df1a, F549 source64271c5ef, F550 sourcec8728d4ae and F552 source1134d1ea through supported workflow. Preserve those sources and their claims; no manual stacking.
- [ ] Reconcile canonical catalogue rows once; run the affected selector and review its plan before choosing explicit account/Buddy/rating/table/shared boundary specs.
- [ ] Run scoped UI ratchet and app boundaries, pinned production build under shared heavy coordination, then targeted test_stamp. Record actual failed/skipped/unrun checks and source/input/environment identities. Full suites remain dispatcher batch work under the19November hold.

### 5. connected-parity — actual live state and visual review (0 points)

- [ ] Await dispatcher-authorised connected setup and F562/F564 resolution. Reuse valid approved immutable inputs and real Java services; no derived outcome insertion, fabricated live proof or weakened clock equality.
- [ ] Prove identical run/clock/account/brief/release/held-offer state via real OIDC reads. Verify current hosted image returns200 for the actual authenticated src.
- [ ] Capture Node live and Angular1280px same-state pair; inspect hero/rating/facts/table/Buddy, keyboard drawer/focus, errors and paused/finished states, plus applicable narrow-width behavior. Retain evidence outside disposable worktree and attach both pair images through dispatcher.
- [ ] Independent agent critique and Gary/Russell review are distinct. Record matches/intended-change/defect in parity ledger; no human ruling is inferred.

### 6. review-handoff — fixed AC evidence and cleanup (0 points)

- [ ] Lead reviews every source delivery and maps evidence to all6ACs, checks no scope expansion and performs actual resource audit. Update map states only for lead-verified boundaries.
- [ ] Publish Result, selected test impact map, retained bounded receipts, exact remote SHAs and residual limitations. Release writers. Dispatcher handles Jira In Review only at the run's actual technical/pair gate; never Done.

## Validation and resource ownership

Retained run root: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/angular-gap-20261122/fucq551/`. Every test/proof/build runs through its `supervise.py`: ownership manifest outside scratch, handled termination/finalizer, HostBudget reservation, one worker, target2GiB RAM/scratch and600seconds per chunk, bounded2MiB logs; descendant RSS measured. Propagate owned temp env. Existing shared dependency cache is linked only for checks and unlinked finally. Builds use `_tools/test_stack.py heavy` plus `_tools/test_stack_build.py`; preserve cache, remove owned worktree dist. Final `audit-resources.py` must verify every root/group/reservation absent. No scratch or runtime is started by this plan checkpoint.

Impact file: `/Users/usget/Claude/vehicle-matcher/.Codex/test-runs/impact/fucq551.json`, atomically refreshed with source/test identity, changed functions/callers, fixture/config/subprocess edges, selected commands, measured timing and exclusions. Initial exclusions: backend/database/Java startup, full suites and connected browsers (no source change or authorised composition yet). A selected green run never represents full acceptance.

## Plan self-review

AC1→slice2+5; AC2→slice1+5; AC3→slice3+5; AC4→slice3+5; AC5→slice3+5; AC6→slice5. All implementation tasks carry an independently reviewable test/source/catalogue checkpoint. Integration, live proof and handoff are explicit; none is counted complete. Source interfaces above are retained rather than invented ahead of inventory.

## Allocation and execution amendment, 22 November 2026

The dispatcher additionally allocated the account-specific `preferences/current-car-rating.component.ts` and focused spec, the single rating-clear test in `preferences/preferences.component.spec.ts`, and one canonical `kit/help-tip.directive.ts` port. Canonical help seam: `[gcspHelpTip]` text, `helpTipId`, `helpTipPlacement` (`below-start`/`above-end`), `helpTipDismissOnActivate`, `helpTipTriggers`; F552 reuses it only at supported integration. All other F552 production/test deltas stay frozen.

F548 `src/styles/node-gcsp.css` already contains the original star-rating/help-tip, buddy-status/tile, activity-timeline and activity-offer sheets. Reuse those global original classes/CSS at integration; F551 creates no duplicate source sheets. Minimal Angular host adaptation is distinct and must be named. The dispatcher approved the ONE canonical `kit/activity-timeline.component.ts` port with focused spec/catalogue/gallery now because original551already needs it; later556must reuse it. ActivityStore owns scoped reads and BriefEditorStore.runBuddyCommand owns guarded pauseSearch/resumeSearch; no store/client changes.

The originally approved external asset input failed in the installed Angular builder before compilation: `The ../../assets/gcsp-vehicle-evidence asset path must be within the workspace root.` Useful failure is retained in `fucq551/beaky-red-star-correct-cli.log`. That uncommitted entry was removed to unblock tests; no successful asset config is claimed. Installed normalize-asset-patterns.js/resolve-assets.js require a lexically contained input and support followSymlinks. A narrowly scoped tracked source link and contained input was requested from the dispatcher; no link was created pending allocation. Hosted200 remains unproved.

Only the narrow ratchet JSON allocation is approved: new component stylesheet caps at actual source size if needed, and lowering account hand-built debt after table adoption. Existing caps/baselines never rise; no ratchet source/framework change. Record actual keys/counts with the eventual source checkpoint.

The dispatcher approved the contained asset seam after the failed direct input: tracked `apps/gcsp-web/src/vehicle-evidence -> ../../../assets/gcsp-vehicle-evidence`, assets `{ glob: '*.webp', input: 'src/vehicle-evidence', output: 'assets/gcsp-vehicle-evidence', followSymlinks: true }`. Canonical realpath must equal this checkout's existing corpus. A supervised installed-Angular resolver check proves921destinations/87,265,982sourcebytes before final build output verification; no generated source copy. Also allocated pure `kit/activity-offer.component.ts` with focused spec/catalogue/gallery, using existing approvedActivityImages/activity.copy and F548 CSS; no activity source/store/client edits.

Final asset seam amendment: the source-tree link made the unchanged code-only boundary walker call readFile on a symlinked directory (EISDIR, retained `beaky-boundaries.log`). The dispatcher approved moving only the link to `apps/gcsp-web/vehicle-evidence -> ../../assets/gcsp-vehicle-evidence` with assets input `vehicle-evidence`; glob/output/followSymlinks stay unchanged. The old src link itself is removed; target corpus untouched. Angular browser output assets are assembled under `/gcsp/assets`, so the allocated Account image method normalizes only exact repository WebP paths to base-relative `assets/...`, preserving other URLs. Required final resolver/boundary/build/hosted checks retain their original meaning. No checker/harness/deploy edits.

Current-car source delivery boundary: lead compared frozen starRating/helpTip/currentCar/countdown source, reviewed scoped rating intent/queue/canonical acknowledgement ownership and source CSS specificity, then `lead-current-car-review` passed89tests across6specs (account56, preferences12, account-preferences HTTP integration6, current-rating9, star3, help3). Selected worker ratchet126 and inline-event4 passed; unchanged app boundary passed after the approved asset-link move. The only ratchet change is new Angular-only host adapter stylesheet cap absent→2 counted lines; existing caps/baselines unchanged. Initial source sheets were removed because F548 already owns them. All6ACs, actual rendered/global-style integration, production build, assembled-path/hosted200 and reviewed pair remain incomplete.

Published source checkpoint `9f668374fe2352189fbc10740829532a31445a79` records the current-car delivery boundary and final contained asset link; exact remote verified. Lead review and89focused cases justify completing only the current-car source slice in the map. Original6ACs remain unticked. Beaky continues the original Buddy slice on the same verified Sol/high allocation; the dispatcher approved source buddyStatus and one pure shared vehicle-image-url helper for Account/ActivityOffer. Canonical source CSS is reused; no store/client/route changes. COMPONENTS.md/gallery writers are briefly released to F555 before the next source checkpoint.

Buddy composition allocation amendment: the dispatcher approved the original account presentation seam in `preferences/account-preferences.component.ts`, `preferences/buddy-controls.component.ts` and their focused specs. Add an optional compatible `buddyControls` input matching frozen `brief/account-preferences.js`: an account-owned tile hides the active/paused/disabled action, while inactive/disengaged engagement and existing recovery remain available. Inspect actual callers and F552 published1134d1ea diff first; preserve standalone/default behaviour, existing stores/commands and all F552 compact/category/mode/meter presenters and non-rating assertions. No CSS/editor/store/client change is allocated. Record the public input in the shared catalogue. Root returned COMPONENTS.md/gallery writers to F551 after F555 canonical-stage checkpoint `a9fdc1cee8fc5770c414d824b09eea889c47d868`; sibling source remains separate until supported integration.
