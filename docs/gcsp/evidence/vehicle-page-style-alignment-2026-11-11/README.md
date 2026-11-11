# Vehicle page styling evidence — 11 November 2026

External capture directory: `/Users/garycarter/.codex/visualizations/2026/11/11/01a1ccbd-0d3d-73d0-9aaa-1f6b68ec09ae/style-alignment`. PNGs are retained outside Git. Desktop 1280×720; full-page captures.

| File | SHA-256 |
| --- | --- |
| `cars-and-offer.png` | `4acdfc7b0f6a64d2a215821066c574b34a5e39b48e0c2f0b0fab4b572fc4e3e8` |
| `computed-styles.json` | `2277fc00681085d1832fa7315667fdc9254ab230f050e60c7339819ed1aa4fcb` |
| `offer-long-name-missing-data.png` | `c006ced6123008124533567265372f652b8abb3ac8860769158c5ae44e70bccd` |
| `your-cars-viewport.png` | `2a8597a39a5582eee1e1c4fd9c427461ff5db2f172165a254188d70be789094e` |
| `your-cars.png` | `d74c229fa47a037f14ee02c7e3cbe496613069184c6f5f003bfb47c36a828fba` |
| `your-offer-viewport.png` | `f1513f0358178c0764c603fabd686f4b4f985c9f2b7c3a876103f29c6d05f40d` |
| `your-offer.png` | `ab72ad4d1963b84c66fa620dd908118b445d647d20b0c934327dc1e9feb532e8` |

Your cars: `/gcsp-account.html?fixture=ready&prefs=selected&activity=searching`. Your offer: `/blocks/gcsp/offer/preview.html?fixture=fuller-offer`. Reset by reloading these read-only fixture URLs on the retained local server at port 8910.

Rendered inspection confirmed matching vehicle names 23/28px 600; context 12/16px 400 muted; metadata and body 14/20px 400; 4px heading grouping; 20px summary spacing; 24px padding. Facts and controls retain their existing common hierarchy. Both catalogue examples compute to 23/28px. The long-name/no-image fixture wraps the name over three lines with no overflow (document width and scroll width both 1280px); missing facts remain readable.

Interaction checks: current car record opens, Escape returns focus to View car record; Body preference opens and Done closes without a write; acceptance review opens with final Accept disabled, Keep reviewing returns focus to Review & accept; rear thumbnail selects its image, viewer opens, Escape returns focus to Enlarge rear exterior image. No real offer decision or email was sent.

Scoped automated run: 449 passed / 3 failed initially (two changed expectations; one pre-existing outdated Accept offer label). After updating those expectations, all 116 checks in the three affected suites passed; this resolves all three failures from the 452-check selection. The painted-copy suite checked 355 rendered states/strings. It emitted existing unrelated presenter stub errors involving clockVersion while reporting success; these are retained as a validation limitation. Two presenter-console stylesheet cap assertions were explicitly omitted for known FUCQ-387 (44 lines against cap39); cap unchanged. No phone/tablet or complete backend validation.

Supervisor receipts: `.claude/test-runs/checkpoints/6ea258cf9a0b8b99d7ac1b911e63ef8679ace9ca5b29a5fa4ef03256e650c0fd.json` and `879b650f1ff09c5bd4e58112d1ed32436ebb54c9200b32e94c49e455a24c0cbc.json` in the shared checkout. One worker, 66.7s and 51.4s; second run peak process-group RSS 371.5MiB; scratch0 bytes, supervisor reports removed. Final integration and cleanup receipt follows in the style-alignment note.

Final integration: tested merge `5346b87b` on base `099a9c3e`, 452 passed /0 failed /0 skipped in 67.6s; two known presenter cap assertions explicitly omitted. Checkpoint `bb942bb06b51c427acdaa79eacbbcc7ea964eb639c1efe280c51459454759a3e.json`, peak RSS 375.7MiB, owned scratch absent. Dependency links removed; review server and external screenshots retained. `cars-and-offer.png` is a side-by-side composite of the two final1280×720 viewport captures.
