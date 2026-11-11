# FUCQ-402: offer shared design and loading patterns

Gary authorised the repair on 11 November 2026. The origin Stories are FUCQ-383 (offer composition) and FUCQ-385 (gallery), verified as native Stories and linked to this independent Bug. Their accepted scope and review state are unchanged.

Diagnosis at 19a8fa9e: entry.js painted bare text while reading the account; offer-view.js showed a generic loading heading and Please wait rather than the shared skeleton. Its loading state already omitted decision/refresh controls. Gallery features/enlargements used text overlays. The offer header overrode Density's uppercase title style and size; vehicle/highlight titles and button metrics also had local overrides. This is a presentation fault, with no change to quote/decision/expiry authority or stored data.

Reuse: portalShell, screenIntro, mediaWell, button, shared tokens and motion rules. Extend: loadingSkeleton with offer and media layouts; gallery consumes the media layout, retains selected views, and clears its busy state on current-image load/error. No new primitive. The startup shell is cleaned before the real shell mounts and on cancellation. Loading retains one accessible h1; visible shapes are decorative and have one loading announcement. Page titles, vehicle headings, button sizing and section spacing now follow Your cars. Summary/actions stay before media on narrow screens.

## Verification

The initial scoped run: 274 checks, 267 pass, five fail, two existing skips. Corrected the loading h1/follow-up focus consequence and our new/lowered CSS caps. The second full selected check set: 259 checks, 258 pass, one failure. All changed offer and shared component checks passed. The sole remaining failure is the existing Low FUCQ-387: presenter-console.css is 44 logical lines against a 39-line cap. Its file hash is identical to HEAD before this repair (47193b56f2303b08ed1d3ef1937042a5489e26750defd833cdbc19ad1d37f9b7). No Presenter styles or cap were changed.

Final selected functional command (through _tools/test_stamp.py --targeted HEAD --command):

```sh
node --test --test-concurrency=1 server/test/gcsp-loading-skeleton.test.js server/test/gcsp-media-gallery.test.js server/test/gcsp-offer-view-render.test.js server/test/gcsp-offer-view-check.test.js server/test/gcsp-offer-view-decision.test.js server/test/gcsp-offer-view-decision-mixed.test.js server/test/gcsp-offer-view-followup-entry.test.js server/test/gcsp-offer-bfcache.test.js server/test/gcsp-offer-runtime-composition.test.js server/test/gcsp-shell.test.js
```

154 pass, zero failures, two existing skips: the two mixed-decision tests explicitly require the reviewed finite105 decision supervisor. This includes the real local HTTP offer entry/follow-up composition, deferred account abort, BFCache/unload, loading-to-ready and terminal state headings, stale image load/failure events, gallery selection and teardown, decision drawers, Density tokens and CSP. The earlier painted-copy run passed its assertions; it printed existing Presenter clockVersion console errors, which are not an offer repair claim. No backend/full suite, deployed smoke, real external acceptance, mail delivery or BMW integration was selected.

Full ratchet was run and failed only on FUCQ-387. A scoped ratchet command excludes exactly that assertion, without changing its source or cap:

```sh
node --test --test-concurrency=1 --test-skip-pattern='^blocks/gcsp/presenter-controls/presenter-console.css doesn.t grow' server/test/ui-ratchet.test.js
```

143 passing selected checks. The Node reporter omits the excluded check from the selected count. The new offer skeleton stylesheet is capped; vehicle-decision.css's cap fell from 59 to 57. The final stable-tree receipt is recorded in validation.json: 299 selected tests, 297 passed, zero failed and two existing skips; it combines the functional and scoped ratchet commands above. Earlier supervised runs declined a tree-wide evidence stamp because product-map metadata changed during validation; source-identity.json retains the relevant source basis. Every run used one test worker, bounded logs and supervised scratch; receipts confirm scratch removal.

## Rendered review and repeatable trial

Serve this checkout locally, then open blocks/gcsp/offer/preview.html?fixture=loading, handoff-replacement, no-image, accepted, expired or error. These are existing display fixtures; no real decisions are sent. Open components.html > Vehicle media gallery for the shared loading/three-view/single/empty/broken examples. For service integration use the scoped runtime test above.

Inspected actual rendered screens at 1280x720, 375x812 and 320x812. The long vehicle name wraps, page width equals viewport width at both narrow sizes, and Accept/Decline are visible before media (bottom 409.5px at 375, 481.5px at 320). Touch targets are 44px on narrow screens; h1 resolves to the shared 23px Density token. Loading blocks match summary/media ordering; corrected a first-pass placeholder button overflow and clock shape specificity, then reinspected. Shared reduced-motion/CSP rules pass. Opened acceptance review, used Escape, and verified return to Accept without issuing a decision. Opened the retained-image viewer, selected rear/interior, wrapped from third to first with ArrowRight and verified Escape restores the magnifier. Functional checks cover failures/empty/single images and stale callbacks. Parent performed the rendered review; no separate reviewer was commissioned for this bounded repair.

Captures are adjacent: offer-desktop.png, offer-desktop-full.png, offer-loading-desktop.png, offer-375.png, offer-loading-375.png, offer-320.png, offer-loading-320.png, accept-drawer-375.png and gallery-viewer.png. Images are small local preview evidence; no new model assets or image associations were created. Collaborator acceptance remains pending; FUCQ-387 remains independently open.
