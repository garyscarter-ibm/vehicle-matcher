# Buddy status and visible search controls

FUCQ-389. Gary approved Option A and authorised build on 11 November 2026. The approved reference is [Option A](mockups/buddy-status-2026-11-11/consistency.html).

Your cars gains one compact, outlined account-level Buddy indicator with the original chevron. The entire link opens Buddy activity. Active and Paused share their green/amber dot and wording with the activity header; unconfigured reads Set up your buddy. The activity header replaces the ellipsis with separate named Pause search / Resume search controls, or setup navigation. No View buddy wording.

## Scope and interfaces

Reuse the existing `/api/gcsp/activity` read and existing pause/resume controller commands. Setup navigates to preferences; navigation grants no search/hold consent. No new backend authority, search algorithm, offer cancellation or automatic resume. Missing setup is only an explicit null permission; failed/malformed reads show Status unavailable. Accepted offers retain a finished state. Withdrawn search permission stays Inactive. Pending commands remain guarded and server readback determines the result.

FUCQ-370 is already claimed by another collaborator. This separate bounded capability does not claim that Story or alter its category-minimum/backend contract. The newer approved reference supersedes older status presentation only on the two surfaces named here. Preserve existing account car, preference, history and details composition.

## Component plan

Reuse shared `button`, `svgIcon`, heading, focus-key and live-region helpers. Existing statusScreen is a page message; viewStatus is an announcement; neither is a compact navigation/status indicator. Add `kit/buddy-status` for shared state interpretation and dot/wording, with catalogue, gallery, regression and ratchet coverage. Page CSS owns header/action layout only.

## Validation plan

Scoped tests: Buddy status, Account rendering/runtime, Activity body/entry/controller/HTTP/live, presenter refresh, shared-kit contracts, copy/live regions and UI ratchet. Real authenticated HTTP verifies both pages read the same permission after pause/resume. Inspect rendered desktop/narrow states and keyboard navigation/focus. Detailed changed-path plan and supervisor receipts stay under the shared `.claude/test-runs/impact/`. Full suite is not required for this bounded presentation change.

## Result

Implemented and visually inspected against Option A. [Validation and replay](evidence/fucq389/validation.md) records 193 passing functional checks and the existing Low severity ratchet exception. Ready for collaborator review; no Done transition or broader FUCQ-370 acceptance is implied.

Existing unrelated validation defect: FUCQ-387 already tracks the presenter-console.css cap 39 vs actual 44 and release-section.css cap 17 vs actual 15. Both reproduce unchanged from the base. This Story does not repair or block on that Low severity maintenance defect.
