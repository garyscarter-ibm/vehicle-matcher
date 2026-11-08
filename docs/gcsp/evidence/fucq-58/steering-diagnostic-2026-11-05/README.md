# Bounded steering diagnostic — 5 November 2026

The separately persisted [plan](plan.json) was committed as `f50f87d` before requests. The dispatcher authorised this diagnostic under Gary's existing source decision, after reviewing the first pilot's compact-node limitation. GitHub rejected two normal pushes with `fatal error in commit_refs_rules`; the commit is preserved locally. Pushes were paused after the dispatcher confirmed the shared server failure. A later successful operation elsewhere supplied a material server-state change; the dispatcher authorised one final ordinary push after the outcome commit. Its result is recorded in the shared run summary.

The diagnostic completed **3 GETs**, all HTTP 200, with **777,995 decoded bytes** in **467 ms client time** (0.733 s supervisor wall). It stayed below the 1 MiB response/2 MiB aggregate, 10 seconds per request/45 seconds wall limits. There were zero retries, writes, solver/OTD/manifest/image calls, new configurations or profile activations. No budget adjustment was needed.

| Read | Decoded bytes | Client time |
|---|---:|---:|
| Public configurator page | 17,763 | 169 ms |
| Discovered same-origin settings | 620,646 | 72 ms |
| Pinned G61E model tree | 139,586 | 208 ms |

[diagnostic.json](evidence/diagnostic.json) records the actual calls and source/code hashes. [projection.json](evidence/projection.json) retains 60,031 bytes: 40 nodes, 104 validated allowlisted facts and 96 explicit path relationships from 2,051 visited objects. No unsafe path segment required omission. Raw page/settings/tree bodies, credentials, headers, cookies, private identifiers and opaque asset URLs were never persisted.

## Actual model relation

Both `5/modelRanges/G61E/models/T5MJ` and `I/modelRanges/G61E/models/T5MJ` contain these same-object literal facts:

| Source field or path | Observed value |
|---|---|
| `modelCode` | `T5MJ` |
| `agModelCode` | `72HH` |
| `steering` | `RL` |
| `orderDate` | `2026-11-01` |
| `effectDate`, `taxDate` | `2027-01-05` |
| Ancestor range map key | `G61E` |
| Model object's `modelRange` field | `G61` |

The `5` and `I` paths are duplicate catalogue appearances, not independent configurations. Keep `G61E` and `G61` in separate fields; the diagnostic neither silently substitutes one nor infers a production year or VIN profile from them. The tree request itself used effect/order dates `2026-11-01`; the selected model's returned effect date is a separate observed field.

`5/modelRanges/G61E/lines/S0337/defaultModel` and the equivalent `I` path contain the same model/AG identifiers with no steering/date context in their allowlisted facts. They are compact sibling references under the containing range, not ancestors of the full `models/T5MJ` record. This actual 5 November hierarchy establishes the selection hazard. The exact compact node selected by the earlier 15:49 pilot remains unknowable because that earlier raw body was discarded. Equal byte counts do not prove identical payload contents.

`country: "gb"` appears on WLTP mapped-datasource branches, rather than directly on the selected model object. UK market and locale are also explicit request/page context. None of these observations independently qualifies UK descriptor/year/plant/era semantics or an enabled GB/RHD VIN profile. The raw steering code `RL` remains a literal observation; no unrelated `RL` or `LL` value is attached to the target.

## Offline checks and next step

The pure [projection module](evidence/model-context-projection.mjs) passed all **9 scoped checks** in [its test module](evidence/model-context-projection.test.mjs), 136.95 ms with no failures/skips. Expected red evidence preceded fixes for lost parent context, target metadata leakage, contradictory identity and case-variant overwrite. Tests cover parent/cross-reference relationships, separate unrelated steering, explicit AG-ancestor relations, unknown steering literals, privacy limits, traversal bounds and the separately dated historical observation. The [exact client](evidence/diagnostic-client.mjs) passed syntax validation before execution. No full suite or runtime/registry/UI change was required.

The smallest next offline step is a full-record selector over this retained projection: require the `modelRanges/<catalogue range>/models/<model code>` path and same-object AG/date/steering facts; reject `lines/.../defaultModel` references, conflicting aliases and unsupported/missing context. Compare duplicate `5`/`I` appearances and collapse identical evidence without creating configurations. Keep source range key `G61E`, source model field `G61`, request dates and model dates distinct. Add focused selector tests for those boundaries before using it in any future collector.

Then review source context mapping and raw steering-code semantics against the retained source/profile contracts. Model year, plant, era and compatible GB profiles remain unknown until corroborated; do not activate a profile on the strength of these literals. Every scheme-model dated catalogue mapping, five-WMI multi-build coverage and actual constructible corpus coverage also remain open. Further network work requires a separately selected finite engineering plan within the existing human source authority. This diagnostic budget is exhausted; no permission request to Gary is outstanding.

Run identity: `fucq58-20261105-steering-diagnostic`. The original authorised-pilot artifacts and receipts remain unchanged. Six child chunks were joined, their owned roots/groups are absent and reservations released. The finalizer removed 1,631 bytes of main scratch; 2,788 bytes of successful duplicate logs were deleted. Concise receipts and bounded expected-red failure logs remain under the shared test-runs checkpoint. Peak sampled group RSS was 76,136,448 bytes; child scratch peaks were zero. No browser/profile compatibility exception, archive, large output or leftover.
