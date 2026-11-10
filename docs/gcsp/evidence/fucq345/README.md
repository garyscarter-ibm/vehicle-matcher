# FUCQ-345 selected-review media repair

Implementation/evidence checkpoint for DEV-2026-11-10-004. Independent visual AssessmentA and the subsequent AssessmentB/detector remain parent-owned; these captures and implementer inspection do not establish acceptance.

The shared GCSP media layer gives the selected review's image, order tag and caption separate space. Review tags wrap below the complete contained image. Missing or broken images retain their 16:9 frame, with separate placeholder and tag space. Offer/activity badges retain their existing placement. No review identity, quote, facts, controls or route composition changed.

Source checkpoint: `e81db95ae0198679f7d4daf08a2132ca3a3c942d`, containing source repair `5d1cfc33c817b6015c5362279b88eabe75cb263d` and integrated shell base `aff66b6bc94ad29349f3ef765c72adaf599e978b`. [source-manifest.json](source-manifest.json) pins the source and every retained artifact. The `base:23ce581b` field in raw capture receipts means the historical faulty CSS reference for the before comparison; `sourceCommit:e81db95a` identifies the corrected runtime source.

## Current rendered evidence

All names below have `-1280.jpg` and `-375.jpg` variants under [flow-corrected](flow-corrected/). The memory runtime uses actual draft, release, claim, saved-journey, review, summary and submission routes with local fixtures. Source-image retrieval is disabled; retained image assets are served locally. Headless isolated Chrome, local HTTPS, and external-request blocking preserve the user's foreground browser.

| Prefix | State |
| --- | --- |
| `02-selected` | Selected car, order identity, image, caption and facts |
| `03-validation` | Empty contact phone with linked error feedback |
| `04-controls` | Corrected contact phone and review actions |
| `05-broken-photo` | Image-error fallback preserving the order tag |
| `06-empty-tag` | Hidden empty tag and readable placeholder |
| `07-long-content-photo` | Gallery long name, order tag and caption |
| `08-missing-photo` | Gallery long order tag without an image |
| `09-order-review` | Final review reusing the selected vehicle |
| `10-confirmation` | Submitted order confirmation |
| `13-long-content-media` | Complete long-content media band; resolves full-card screenshot framing limits |
| `14-missing-photo-media` | Complete missing-photo band with a long tag |

[flow-corrected/capture-receipt.json](flow-corrected/capture-receipt.json) records 18 screenshots, 14 geometry checks, two preserved claim/quote identity checks, zero page errors and zero external egress. [flow-corrected/gallery-media-receipt.json](flow-corrected/gallery-media-receipt.json) records the four supplemental media-band screenshots and four further non-overlap checks. The implementer visually inspected all 22 corrected images at both widths, including the full silhouette, tag/caption wrapping, placeholder separation, facts, validation/focus and action placement.

The root-level 28 screenshots and [capture-receipt.json](capture-receipt.json) preserve the initial before/repair comparison and adjacent offer/activity loaded/fallback states. They are historical evidence, captured before the normal-flow tag refinement and newer shell integration. Offer/activity media declarations remained identical through that refinement; the shell update concerns loading states. Their stable adjacent-state evidence is reused on that bounded basis, not presented as a new final-source capture.

## Scoped validation and failed attempts

[validation-receipt.json](validation-receipt.json) preserves exact command arguments, identities, logs/hashes, results, timing and cleanup. All Node runs used `--test-concurrency=1`; no full suite was run.

| Run | Result |
| --- | --- |
| Initial caption regression | Expected failure: caption position was `absolute`, expected `static` |
| Initial repair regression | 1/1 passed |
| Eight selected boundary modules | 243 passed; two module imports failed because `pg` was unavailable |
| Only the two import-failed modules after dependency resolution | 35/35 passed; no database connection |
| Normal-flow tag regression | Expected failure: tag position was `absolute`, expected `static` |
| First flow boundary run | 137 passed; one ratchet failure for eight counted CSS lines against the existing seven-line cap |
| Consolidated CSS; review-render, manual-gallery-render and ratchet | 138/138 passed, zero skipped; cap unchanged |
| Lead final strict targeted run after shell integration | 170/170 passed, zero skipped: review-render, shell, loading-skeleton and ratchet |
| Initial 28-capture browser run | Failed final page-error assertion; all 22 geometry/four identity checks had passed |
| Gallery tooling probe | `serviceWorkers:block` reproduces the sandboxed iframe SecurityError; normal `allow` has zero page errors |
| Corrected 18-capture runtime run | Passed; 14 geometry/two identity checks, zero page errors/egress |
| Four complete media-band supplement captures | Passed; four geometry checks, zero page errors |

The initial browser error is preserved verbatim in the raw receipt: `Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.` [tooling-probe.json](tooling-probe.json) isolates this to Playwright's blocking setting with an existing gallery mail iframe. Corrected captures use normal `allow` in a fresh isolated browser while retaining external-request blocking. No production code was changed for that tooling failure.

Exact supervised capture commands were:

```text
python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-supervise.py browser python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-browser-driver.py
python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-supervise.py gallery-probe node /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-gallery-probe.mjs
python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-supervise.py flow-browser python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-flow-browser-driver.py
python3 -B /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-supervise.py gallery-media node /Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-gallery-media.mjs
```

Byte-identical copies of those proof programs are retained in [proof](proof/). They intentionally record this workspace's absolute execution paths. The compact [impact-map.json](impact-map.json) maps changed selectors/fixtures to the selected regression and integration boundaries; its atomic shared copy is named in the source manifest. No second suite was run solely to populate coverage metadata. CSS layout evidence comes from computed styles, browser geometry and inspection rather than V8 coverage.

## Resource receipt and limits

Every test/browser command used the supervisor's machine-wide reservation, one worker, a 128 MiB scratch/1 GiB RAM budget and 600-second chunk limit. All eleven owned scratch roots are verified absent. Their measured scratch peaks total 33,723,341 bytes; the largest individual peak was 9,931,131 bytes, and maximum measured RSS was 385,466,368 bytes. Bounded browser profiles/TLS fixtures used the permitted local working-set exception and were removed. No archive or output approaching 256 MiB was created.

The sole intentional leftover is the owned `server/node_modules` symlink to the existing DEV-2026-11-04-069 dependency directory, providing verified `pg` 8.23.1. It is transferred to the parent for AssessmentB runtime imports. The parent must unlink only that symlink after AssessmentB and preserve its target. All source, working trees, installed dependencies and user files remain outside scratch cleanup.

Validation is scoped. PostgreSQL, real mail, external source/corpus integration, deployed smoke and production writes were not run. Independent visual review and final integration/acceptance remain outside this implementer checkpoint.
