# FUCQ-552 Preferences Parity Implementation Plan

> **For agentic workers:** Use one Sol/high implementer for the independent source slice, followed by lead specification and code review. The existing approved migration plan and seven original ACs remain authoritative.

**Goal:** Restore the frozen category preferences, mode/help and completeness presentation, then integrate the remaining editor/cards/links and prove all seven original acceptance items.

**Architecture:** Port the source presenters into the existing Angular kit; preserve public category inputs/outputs and BriefEditorStore ownership of all state and commands. Compose them in the existing `preferences/account-preferences.component.ts`. The assembled global source stylesheet exists in frozen FUCQ-548 and is an explicit integration dependency; do not duplicate or modify its port.

**Tech Stack:** Angular 21, TypeScript, pinned Node 24.22.3/npm 11.19.1; existing Vitest/Angular tests.

**Spec:** `_dev/in-progress/DEV-2026-11-22-vesper-027.md`; frozen Node `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; COMPONENTS category preferences/understanding/FUCQ-405 and Angular preferences sections.

## Global constraints

- Preserve all seven original ACs and all existing source/save/removal/mode/disabled/error/focus semantics; no redesign, new categories or client confidence score.
- Use source DOM/class/state names and existing source CSS 1:1. The server projection owns input completeness; the kit only renders it.
- No edits to account.component.*, live-refresh.service.*, stores, auth, backend, angular.json, F549 frozen files or F548 ports. No OneDrive, foreground changes, real email or connected Java/browser/database run.
- Shared COMPONENTS/gallery/ratchet writers need the dispatcher's named window. Catalogue/gallery changes accompany the first consuming source commit; no ratchet baseline increase.
- All commands that mutate or test use this explicit F552 worktree. Git changes use scaffold_git with poller vesper and the Codex trailer; ordinary explicit story-ref publication follows each coherent commit.
- Resources: one test worker, <=2 GiB RAM/disk and <=600 seconds per chunk; outside-scratch ownership manifests and supervisor finalizers, shared HostBudget acquire/update/release, bounded logs and TMPDIR/TMP/TEMP propagation. Retain evidence under the shared fucq552 run root; clean each owned scratch/group.

## Source diagnosis and evidence

Current base renders category names and native checkbox/radio groups without source icons/bin/stopped slider; `account-preferences.component.ts` renders native mode radios and a meter. The existing store already provides categories, considered/unset state, pending removal, same-again availability, guarded actions and projected understanding. The source category presenter composes option buttons, stopped range slider, importance switch and help tip. No state/backend change is needed for this independent port. Evidence helper for DEV-2026-11-22-vesper-027 returned `ready: [], missing: []`; supplied 20 November captures are absent, so none are claimed inspected. Diagnosis is source-confirmed; actual composition reproduction remains pending.

## Task 1: category presenter (original AC1)

Files: extend `apps/gcsp-web/src/app/kit/preference-category.component.ts`; add its focused `.spec.ts` and template only if needed; source-named kit presentation helpers only where a source component must be ported once. Read frozen `blocks/gcsp/kit/category-preferences.js/.css` and its composed `renderOptionList`, `renderRangeSlider` and checkbox switch implementations.

Interfaces stay: inputs `id`, `definition`, `state`, `open`, `removing`, `disabled`; outputs `opened`, `changed({value?,importance?})`, `removeRequested`, `removed`, `kept`. Add a close output only if needed to express the source Done intent without changing store semantics; composition may call existing `store.open(key)` to close the current panel.

- [ ] Add a regression that source icon/tile/bin and considered/high classes render, stopped slider emits the chosen value and label, unset display does not emit, and removal needs confirmation.
- [ ] Run the focused category regression to record the expected red behavior against current markup.
- [ ] Port source markup and intent handling, retaining native keyboard semantics, stable open controls and disabled behavior. Use Angular bindings such as `(changed)="store.change(key, $event)"`; do not save data in the presenter.
- [ ] Run the focused regression and existing account-preferences/store callers; inspect every changed file.

## Task 2: mode/help and understanding (original AC2/AC3)

Files: extend `apps/gcsp-web/src/app/preferences/account-preferences.component.ts`; port `understanding-meter.component.ts` and source-named mode/help presenters in the Angular kit as needed, plus focused specs. Read frozen category-preferences.js choice-mode branch, understanding-meter.js/.css, preference-modes.css and help-tip.js/.css. Reuse the existing ButtonDirective and source-presenter behavior; no legacy screen/controller wrapper.

Consume existing `store.understanding()` `{value,maximum,pending}`, `store.failure()`, `store.sameAgain()`, `editor.initial.sameAgain`, `store.toggleSameAgain(boolean)`, `carDescription()`, category and Buddy command interfaces. Keep the current Buddy controls; F551 owns the Buddy tile.

- [ ] Add regressions for segmented n/max completeness (including pending/failure/clamping), the source mode radio structure, unavailable mode, help dismiss/toggle/Escape, preserved category intent and focus on removal/mode changes.
- [ ] Record meaningful red results, then implement source structure/class names without changing store policy or its save queue.
- [ ] Bind failed unsaved state to the meter's presentation only; never recompute confidence or mutate completeness values in the kit.
- [ ] Re-run focused kit/account-preferences/store callers. Record source-only scope and pending global CSS integration.

## Task 3: required catalogue/gallery and source verification

- [ ] Obtain the dispatcher's COMPONENTS writer release. Request exact gallery/ratchet paths before touching them.
- [ ] Add bounded F552 port/reuse entries and gallery states for unset/considered/open/high/removal/disabled/mode/help/pending/failure. Do not recreate F548's complete Port status table; name later reconciliation.
- [ ] Lead reads the complete diff for original scope, source markup, accessibility, saved-state preservation and callers. Run narrow final regressions, UI ratchet, applicable boundaries and production build through shared helpers after source stabilizes; no full suites.
- [ ] Commit only named owned source/spec/catalogue/gallery paths through scaffold_git with Codex trailer, publish the exact story ref, independently verify its remote SHA and retain cleanup/impact evidence.

## Remaining original scope and integration slices

- Editor controls (AC4): inspect and port frozen brief-view.js option chips, end labels and Preference/Importance axes after a named writer allocation; do not change store semantics.
- Preview cards (AC5): reuse/port source matchCard once from frozen brief-view.js preview composition; no canned outcomes or replacement decision logic.
- Navigation (AC6): reuse frozen F549 editor/Activity work only through authorized integration; do not duplicate/cherry-pick or alter its checkpoint. Verify accepted-order link behavior against actual state.
- Connected/parity (AC7 plus all behavioral AC evidence): after F548/F549 integration and collaborator routing of F562/F564, use live frozen Node and local Java/OIDC with identical actual scenario/input/clock/state, persistent browser cases and reviewed 1280px pairs attached to the Bug. No runtime is authorized now. Narrow/Safari/keyboard/browser evidence remains unrun until eligible. Component tests do not tick full ACs; only Gary/Russell pair review establishes parity acceptance.

## Self-review

All seven ACs map to tasks/slices above. Initial independent delivery covers source AC1-3 only; editor/cards/link integration and real composition remain explicit. Existing public category/store types are retained. Diagram topology is unchanged inside the existing Angular component, so design-with-drawio's topology gate does not fire. Full suites remain deferred to dispatcher batches under the 19 November hold.
