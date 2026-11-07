# G42 contract-only range inventory — 7 November 2026

The original three-GET allocation is spent and preserved in `../g42-range-inventory-2026-11-07/`. This directory prepares a distinct fresh allocation after narrowing the projection. No source traffic has run here and no capacity is credited.

The projection retains full direct model facts and complete aliases, then only literal line/default-model/included-variant/configuration relationships and the presence/type of each line’s literal trim key. It never walks unrelated properties, all elements, prices or payload fields. Bounds remain explicit: 128 lines and variants per container, 768 total relationship rows, 112 KiB report and 128 KiB sealed operation. Refusals retain a safe contract path, count, ceiling and type in the primary and receipt. Source settings/bootstrap material stays ephemeral.

The two added regression tests failed before the fix. Eleven focused tests then passed; 50 selected inventory/lifecycle/context/options/batch boundary tests passed with zero skips in 6.465 seconds, sampled 240,943,104 bytes peak RSS and 4,432,128 bytes scratch. All owned scratch, groups, dependency links and reservations are absent. `fix-validation.json` retains code identities and cleanup. No full suite, actual source result or acceptance is implied.
