# FUCQ-370 - engage Buddy explicitly from Account (visual capture and live walkthrough)

Story DEV-2026-11-10-012, slice 3. Reference: frozen mockup `docs/gcsp/mockups/account-preferences-2026-11-10/` (193cbf07), compared at the exact manifest viewports.

## Tested code

Branch `dev/DEV-2026-11-10-012`, base commit `da4bc9be` plus the two CSS fixes made from this capture (`blocks/gcsp/kit/category-preferences.css`, `blocks/gcsp/account/gcsp-account.css`), committed with this note. The scripts that produced the evidence are `scripts/gcsp/capture-account-prefs.mjs`, `scripts/gcsp/compose-account-prefs.py` and `scripts/gcsp/walk-buddy-engagement.mjs`. Browser: Chrome 157.0.8103.51, headless, device scale 1, en-GB, reduced motion, full page, scroll 0,0, fonts and vehicle media loaded.

## Part A - strict paired capture (static Account harness)

26 states: 17 paired with the reference PNG (side-by-side, Your preferences 2x zoom, and a head zoom of the YOUR CARS heading with the lamp) and 9 implementation-only. **707 checks, 707 passed, none failed, no page or console errors.**

- Engaged (`buddy=engaged`): 1440-selected, 1440-options, 1440-remove-confirmation, 375-engaged.
- Disengaged: 1920, 1100, 1024, 900, 820, 375 selected; 320-long; 1440-same-again; 320-same-again-neutral; 1440-initial.
- Under minimum: 1440-validation (red footer "Choose 3 more categories to engage Buddy. Your preferences save automatically.", status line focused).
- Integration order: 1440-record-drawer and 375-record-drawer. Closing the drawer returns focus to the first View record opener and removes the dialog (both widths).
- Implementation-only at 1440x1100 and 320x1000: engage-pending, engage-failed, minimum-loss, unknown (neutral lamp "Buddy status unavailable", action disabled). Plus a 320 keyboard pass: Tab from the Preferences heading reaches the action, Enter engages with three categories, focus stays on the button, the label flips to "Disengage Buddy".

Checks recorded in `results.json` for every state: lamp 18x18 px circle; computed colour equals `--gcsp-success` (engaged), `--gcsp-danger` (disengaged) or `--gcsp-text-muted` (unknown); no animation or transition names on the lamp or its text; status text 23px (the `--gcsp-font-size-title` token); lamp right of the heading at 800px and wider and below it at 375/320, and the same side as the live reference; exact action text per state; no button on Account containing "Save"; DOM order Your cars, Your preferences, Order history, Your details; no horizontal overflow; manifest viewport, understanding score, rating, categories and footer text equal the manifest; geometry (tile top, mode row, understanding meter) within 1 px of the live reference; action width and height within 2 px of the live reference.

### Differences fixed after looking at the side-by-sides

1. Footer action was 32 px tall and hugged its label; the reference is 48 px with the regular font and wide inline padding (kit `category-preferences.css`).
2. At 600 px and narrower the action must fill the footer width like the reference (kit CSS).
3. At 600 px and narrower the lamp must sit below the YOUR CARS heading, not beside it (Account page CSS composition).

### Expected differences left (not defects)

Four-icon navigation rail; no Registration row in the car facts; countdown days (26 vs 21) and the duplicated "320i" in the fixture car name; Your cars where merged rules changed it (23px car title, no "Account as of", no Status/Contract end facts, order history wording incl. "Your previous car" instead of "Model not supplied", and the "No Motorcycle Choices orders." line absent); the page title renders smaller than the reference heading; the status text uses the system UI font stack in both pages (the reference does not apply the title font to it either).

## Part B - live runtime walkthrough

Real host (`node index.js` in `server/` with `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_PUBLIC_ORIGIN=http://127.0.0.1:8808 PORT=8808`), real HTTP, real sign-in at `/gcsp/login` as the seeded employee Paula Mason, `/api/gcsp/activity` read from the page context. 1440x1100 and 375x1000, each on a fresh host. **32 steps, 32 passed.**

Per viewport: load; under-minimum Engage (red message, status focused, nothing written, no search permission); choose three categories through the tiles; Engage (green lamp, "Disengage Buddy", "Buddy engaged. Your preferences will guide the search."); reload keeps engaged with `canSearch` and `canHold` true and an `engaged` state change; Disengage ("Buddy disengaged. Your preferences are kept.", focus stays on the button); reload keeps disengaged, preferences kept, `canSearch` and `canHold` false, last state change `disengaged`; Engage again; remove one category with the bin and its confirmation, which turns the lamp to "Buddy disengaged" with the minimum-loss copy, and after reload `canSearch` is false and the last state change is `disengaged`; no "Save" button; no page errors or HTTP errors.

Finding: the demo access-key gate no longer exists (commit cb04b284), and a fresh memory run has **no confirmed brief** for Paula (activity state `no-brief`), so the starting point "seeded brief already has consent" does not occur. Disengage is therefore exercised after a real Engage. No code defect was found in this story's server or client.

## Limitations

Static-harness captures use fixtures; the live walkthrough uses the memory repository, not PostgreSQL. The password for the demo login is passed through the `WALK_PASSWORD` environment variable and is not stored. No deployed Render host was exercised. Existing offers and hold behaviour were not part of this slice.

## Artefacts (outside Git)

98 files, 15,197,799 bytes (JPEG, plus `results.json`, `walkthrough.json` and `manifest.json`):

```text
/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq370-2026-11-11/
```

`manifest.json` lists the SHA-256 and size of every other file. Key hashes:

| File | SHA-256 |
| --- | --- |
| results.json | 99d844c0374bf12cbed3825d93ceac306ce50f6639914ba1cc138e08cfb3107c |
| walkthrough.json | 442356122c8461061b86425c4aeaef1d7ac045c2a9ac98be8d6270cbe7ef5c9b |
| manifest.json | c3e06232bf08cb0a5cd02154b8ac4077b5f6d6833befe8a732cef06c7781bf7b |

Naming: `<state>-side-by-side.jpg`, `<state>-prefs-zoom.jpg`, `<state>-head-zoom.jpg` for paired states; `<state>-implementation.jpg` plus the two zooms for implementation-only states; `walk-<width>-NN-<step>.jpg` for the live walkthrough. This is a verified local OneDrive copy; cloud upload was not verified.

## Scoped tests

`node --test --test-concurrency=1` on gcsp-buddy-status, gcsp-account-preferences-controller, gcsp-account-preferences-mount, gcsp-account-render, gcsp-category-preferences, gcsp-buddy-engagement and ui-ratchet: 316 tests, 314 passed, 2 failed. Both failures are the known base failures (`presenter-console.css` does not grow, `release-section.css` shrink not banked). No full suite was run.
