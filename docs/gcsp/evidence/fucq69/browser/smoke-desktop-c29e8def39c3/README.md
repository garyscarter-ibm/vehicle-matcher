# First desktop smoke · incomplete · 6 November 2026

The dispatcher granted exactly one `smoke-desktop` run at `84af623aff460e47c22409e5a5bdc9fdb3347a7a`, reference `fucq69-smoke-84af623-20261106`. Source manifest stamp: `f2ff7257ec5674074a86117cc8e4a9e635961fa6cfddbe4a53f694dda884825c`. The input was the dated read-only three-car gallery fixture, never an actual FUCQ-92 released run or claim service. The browser lane was released immediately after the failed result and independent cleanup check. No retry or matrix ran.

The run is **incomplete**: the evidence helper returned 403 for the existing shell image `/assets/brand-logos/bmwgroup-bmw-mini.svg`. Diagnosis: `portal-shell.js` correctly resolves its one literal LOGO call to the existing asset; the helper's manually enumerated allowlist omitted it. The same broken header image is visible in both captures. This establishes a harness asset gap, not a product or keyboard defect. The existing logo is 6,479 bytes, SHA-256 `703c69d19aa0d2eda773a1b4022af2bf474c1058a4bafb84468abf7df63557ac`.

Both bounded captures were inspected by the lead against the previously reviewed shell/body and current Density reference:

- `01-overview.png`: three separate exact cards; allowance, costs, typed NEDC/WLTP observations and unknowns remain readable; the long model name wraps; representative-image disclaimers and the missing-photo placeholder are distinct. Ineligible reasons are visible and every Review action is disabled for the fixture. The header logo is broken by the helper's 403.
- `02-smoke-series-filter.png`: Series shows `3 Series`, two exact cards remain, counts show two cars/two eligible shown, and Tab leaves a visible focus outline on Body style. The same header-logo gap remains. No horizontal overflow or visible fit scores were observed. These desktop captures do not establish 320px, detail, failure-state or full matrix acceptance.

The Density heading font loaded. The native series action followed Space → observed-label typeahead `3` → Enter → Tab, with trusted input and change at exact value `3 Series`, trusted per-key observations, and the exact value retained after Enter/Tab. `results.json` retains the trace and capture hashes. External requests and page errors were absent; the one HTTP error above prevents a passed result.

Supervised wall time 5.487 seconds; peak recursive RSS 1,187,823,616 bytes; peak combined scratch/retained allocation 9,537,856 bytes. The two PNGs total 644,575 bytes. The supervisor and independent parent verified owned scratch/profile/process PID-start identities/groups/owner/reservation, open-file cleanup and HTTP port 63773 absent. All browser source hashes and the separate 174-file product identity were unchanged at audit. See `supervisor-receipt.json`, `parent-cleanup-audit.json` and `run-plan.json`. No installed dependencies were modified.

Immutable hashes:

- Overview: `9e163b66b44eec0e4dcaf1ec17e5e7c6cd12953ff5f39fe3b23d095865451155`.
- Filtered view: `5f4c9d09c3328bea815f8673233075ebacc0d7c0c58922ee1f992162e79a9eb0`.
- Results: `f5f7e9111c58ab6f3fa36da195748e38403b5c9ad1d43fda9ab8ba59299fda60`.
- Original supervisor receipt: `d65e35c067725cfdd8790ba97ac8eba2927a10ea660f8b6407c67b8a59ad9d94`.

The follow-up helper uses a pinned finite HTML/module/CSS/URL closure as the exact served-file allowlist, including the existing logo and its immutable bytes. Static guard preparation is separate from this run. Another smoke requires a new exact-source dispatcher grant; the corrected helper has no browser evidence yet. Actual release-history/producer, released-run→claim→FUCQ-70 and authored full-suite gates remain open.
