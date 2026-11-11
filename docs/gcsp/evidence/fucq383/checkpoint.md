# FUCQ-383 presentation checkpoint, 11 November 2026

Status: **integration-pending; not built or accepted**. This is a coherent presentation checkpoint for FUCQ-386 to extend. The original Story criteria are unchanged.

The pending offer now uses the full content width and a shared vehicle decision card. It keeps pinned points and supplied facts, readable finishes with neutral unsupported swatches, a server-derived hours:minutes countdown, uncapped benefit cards, natural-height tradeoffs and one current-first comparison. Only lower monthly points and higher boot volume infer a winning cell. Unknowns, ties and preference-dependent differences remain neutral. Pending Scheme and order-number facts are omitted; accepted outcome behavior remains.

## Integration contract

`createOfferView(root, { openDecision(kind, model), ...existingPorts })` optionally routes header actions to a drawer composer. The controller supplies `canReviewAccept` for opening review without declarations; `canAccept` remains declaration-gated for the final command. Loading, uncertain and other blocked states clear the review gate. The header action host is `[data-offer-decision-actions]`. The normal custom-element mount still uses the existing inline decision composition until FUCQ-386 supplies the drawers and mounts the hook.

FUCQ-384 may supply ordinary colour/interior prose and options. Only an explicitly supplied supported `shade` paints a known swatch. FUCQ-385's additive image list and `photo` contract can be integrated without changing this checkpoint's facts. Its `label` and `viewpoint` metadata must be preserved. No equipment-ranking policy, vehicle data repair, gallery or drawer is claimed here.

## Scoped checks

- Ten-file regression run: 251 passed, 1 failed. The sole failure was the painted-copy test's former `Accept this offer` expectation. After updating it to the approved `Accept offer`, the entire painted-copy file passed 26/26, checking 354 painted views/assertions. No production change accompanied that assertion correction.
- Final controller review-gate correction: controller, rendered hook, decision and BFCache files passed 69/69. This specifically proves an uncertain command clears `canReviewAccept`, and a drawer opener cannot bypass declaration-gated submission.
- Owned ratchet selection passed 8/8: all counted patterns, banked baseline and both checks for offer CSS, comparison CSS and the new shared vehicle-decision stylesheet.
- Shared table callers, projection, shell/CSP, refreshed decisions and copy boundaries passed in the ten-file run. The full application suite was not selected: no service/store/ranking/API change; the affected selector lacked a configured language plugin and its broad fallback was reviewed and rejected.
- Impeccable detector returned `[]` for the six changed UI targets.
- Corrected browser pass: nine captures, zero page errors and no horizontal overflow. See `browser-receipt.json`; fixture composition is not evidence of the live producer or DemoClock integration.

Exact commands, file identities, allocation/cleanup records and historical failed attempts are retained in `validation-summary.json`. It identifies which verbose logs remain available; `baseline-failures.txt` retains the useful bounded diagnostic excerpts. The first attempts exposed old presentation assertions and a missing worktree dependency link; the named assertions were updated, and the worktree uses the existing installed server dependencies through a symlink. No dependencies were installed or changed.

## Rendered critique and confirmation

The first substantive inspection found an undersized uppercase page heading, benefit headings inheriting a small token, short desktop buttons and duplicate fixture finish rows. The corrected pass restores the approved Density heading hierarchy, 22px desktop/18px narrow highlight headings and 46px action height; desktop finishes sit below identity while narrow finishes follow the image.

The corrected desktop, 375px, long 320px, empty and unknown captures were critically inspected. The card uses the available width, identifies the vehicle clearly, preserves useful whitespace and keeps the countdown distinct. Highlight boundaries align with the three comparison columns. Five benefits wrap as two/two/one, leaving the sixth position neutral; the tradeoff does not stretch. Both configurations remain identifiable at narrow widths, with current boot and offer points highlighted separately. Empty groups and unknown finishes make no invented claims. At 375px the actions end at y=400, and at 320px y=450; the long-name case ends at y=625, before media y=695 and within the 812px viewport. All nine captures have no horizontal page overflow.

The visible disabled Accept action and inline declarations are the temporary no-hook composition. The approved enabled drawer-opening primary action remains an **unmet original criterion pending FUCQ-386**. The desktop image's remaining lower area is also the slot for the separately delivered gallery. This confirmation is an implementer critique; independent final rendered critique is still required after combined integration.

## Unmet and deferred evidence

- Actual authoritative newly generated offer/DemoClock reads: 2:00, 1:59, 0:01, 0:00; reload, second browser and presenter advance; missing timing and zero reread. Unit and fixture checks preserve these boundaries but do not replace this required live evidence.
- FUCQ-386 drawer opening, validation, confirmation, keyboard return and final action appearance.
- Combined FUCQ-384/385/386 facts and gallery integration, independent substantive visual/usability review and corrected final inspection.
- Unchanged presenter ratchet failures are linked to **FUCQ-387**: presenter-console.css 44 lines/cap 39; release-section.css 15 lines/cap 17. The full ratchet did fail; the owned selection is a scoped pass.
- Two nonfatal painted-copy JSDOM errors remain linked to **FUCQ-344**: `TypeError: Cannot read properties of undefined (reading 'clockVersion')` at presenter-controls/controls.js:136:81, triggered by painted-copy test line 518. The file passed while emitting these diagnostics. See `baseline-diagnostics.json` for unchanged source identities.

## Trial and reset

From this worktree run `node scripts/serve.js`, then open `/blocks/gcsp/offer/preview.html?fixture=handoff-replacement`. A fresh page resets the fixture. Inspect at 1440, 375 and 320px; verify the summary and actions precede media at narrow widths, supplied facts remain, and the current/offer comparison has one winner only for grounded directional differences. The retained `browser.mjs` generates the two/five/empty/unknown/long cases through the custom element's injected adapter and closes its headless browser/server in `finally`. Use `test_stamp.py` as recorded in the summary to repeat it. Use the actual application setup for the live producer and drawer evidence still listed above.

## Resources

One test worker per chunk, each below 600 seconds and 2GiB scratch. The largest measured process RSS across the supervised checks was below 445MiB; sampled scratch peak was 150,272 bytes. All recorded owned scratch roots were removed and their absence checked. The headless browser's active temporary profile was a bounded local compatibility exception; browser and local static server were closed, and port 3883 has no listener. Small screenshots and concise receipts remain here; no archive or large output was created. The existing installed dependency link is intentionally retained and excluded from commits. No owned child agents or test processes remain.
