# Vehicle images fill their containers — FUCQ-403

Gary authorised this visual change across the application on 11 November 2026. It supersedes the previous intrinsic-ratio/contain treatment introduced for FUCQ-359; that Story's historical acceptance is preserved.

The shared GCSP image layer now uses cover cropping for Account, offer/activity/review media, gallery features/thumbnails/enlarged viewers and notification thumbnails. Account's photo well and gallery feature grow with their parent panel, eliminating empty container space while preserving image proportions. Existing retail and release-grid photos already use cover. Captions, order tags, missing-image fallbacks and image selection remain available.

Visual inspection used the current Account and offer preview fixtures at 1440×900 and 375×812, plus the shared gallery and enlarged viewer. Loaded image and container bounds matched exactly: Account 814×462 (desktop) and 341×191.8125 (narrow); offer 766.796875×544.5 (desktop) and 325×182.8125 (narrow). No narrow horizontal overflow. Missing Account imagery retained its message; gallery thumbnails and enlarged image used cover; closing the viewer returned focus to its opener. Reviewed images are retained beside this record in `evidence/car-images-fill-2026-11-11/`.

Scoped validation: **345 passing checks** across Account, gallery, manual-review, offer view, notification bell, shared shell/gallery and UI ratchet. The existing manual-review computed-style assertion now expects cover. No backend/data behavior changed; full fleet/database/matching suites were not run.

The first check found two missing `pg` imports; linking the checkout to the already installed server dependencies resolved them, and Account/gallery then passed all 78 checks. It also exposed two failures in sources unchanged from base d6292e2c: the removed Activity sidebar selector (tracked separately as FUCQ-404, Low), and presenter-console.css at 44 lines against its 39-line cap (existing FUCQ-387). The remaining 267 checks passed with these two named checks explicitly excluded. This is scoped evidence, not full-suite acceptance. No unrelated code or CSS caps were changed.

Checks ran serially through `_tools/test_stamp.py --targeted origin/gcsp-poc --command ...`; supervised test scratch was removed on completion. Local impact evidence and bounded logs remain in the shared ignored `.claude/test-runs/` directory. No agents or pollers were started.
