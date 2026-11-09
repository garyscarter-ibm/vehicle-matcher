# FUCQ-107 renderer URL-key repair proposal

6 November 2026. Author-only repair and metadata refreeze. Independent delta review and a new exact grant are required before execution. FUCQ-107 remains incomplete.

## Current diagnosis

Origin: FUCQ-107 / DEV-2026-11-04-085, renderer9 harness on publication `1b0bbb5ba6e941fb5d840984c3cf11e99c2aeda0`. Its once-only grant `fucq107-renderer9-cjs1-1b0bbb5-0650` is consumed. The original child reported nine passing cases, but the supervisor exited 2 with `Dependency resolve/miss differs from reviewed inventory`; the success auditor exited 1 at `reported-success`. Renderer proof was not accepted.

The dispatcher and independent reviewer Dibble identified a URL representation mismatch. At original journal line 41, `html-encoding-sniffer/lib/html-encoding-sniffer.js` resolves `@exodus/bytes/encoding-lite.js`. Node records `file:///Users/garycarter/Code/GitHub/vehicle-matcher/node_modules/@exodus/bytes/encoding-lite.js`; the validators derive the same frozen physical path with `%40exodus` through Python `Path.as_uri()`. The expected outcome is exact membership of this already-pinned path and content. The actual raw URL key lookup fails. Dibble reports 230 affected records, 229 distinct, with no residual differences after changing only this encoding. Those are inherited independent findings; authoring does not replay or re-audit the original journal.

Affected writers/readers are the expected inventory map, finite format-hint map, package-root ownership lookup and exact JSDOM entry check in both independent validators. Source rows already contain frozen Node URLs. No package, product, loader, source graph, format set or dependency allowlist change is needed.

The selected repair derives expected keys from declared frozen paths with `Path(path).as_uri().replace('%40', '@')`, preserving every other encoding. Journal URLs remain untouched and must match exactly. Static review must establish injectivity over the finite declared paths and retain all membership, hash, format, edge and optional-miss checks. Runtime behavior remains unproved until an independently reviewed, separately granted attempt completes.

The root cleanup/input receipt is referenced in place at `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq107-cjs1-failed-run-root-0655-corrected.json`, SHA-256 `e56c7287f809223166b9706f1d4683f55c43c8b8e4cc70780711b12ed48ce113`. Its PASS covers 3,893 cleanup/input facts and explicitly sets `rendererProofAccepted: false`. Its earlier receipt and both snapshots remain preserved. No failed-run originals are copied into this proposal.

## Preservation and review boundary

New `uri1` supervisor, auditor and admission files preserve the entire original `cjs1` packet. Both new validators keep `PREFIX = 'renderer-94e05ff-cjs1-'` for unchanged manifests, loader, launcher and resource helper, and select only their new admission through a separate `ADMISSION_FILE`. The new admission replaces only the two validator nodes and their execution/audit entry paths, plus its descriptive variant. All 2,110 other nodes, 129 absent candidates and child argv remain as previously frozen. The old freezer remains pinned and unchanged; it is not invoked for this delta refreeze.

No active execution grant. No tests, execution-helper import or execution, Node invocation, journal replay, process/ledger probe, resource reservation, retry, descendant or browser run is authorised here. Static stdlib authoring and the scaffold Git adapter are the permitted operations. This harness-only proposal changes no screen or product behavior and supplies no visual acceptance evidence. The experience contract and shared component gates remain applicable to later story acceptance.

## Frozen packet and static evidence

New control/admission prefix: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-uri1-`. Unchanged input prefix: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-cjs1-`. Adjacent copies are byte-identical to their external files; `capture-index.json` binds them and references all 17 preserved prior captures without duplicating unchanged inputs.

| File | SHA-256 |
|---|---|
| New admission | `d5893900496e23cc5d38907af05bb92672b6b9125b11ca7f4b2dceeea66ad866` |
| New supervisor | `65cfba09576ceae17e7ba93004695b7dfa5d6308edecbc6ad9432e9277f710ef` |
| New independent auditor | `078a112bbc0334f7beb5814dc97df756780d038577994ef0137d635ef1e23eaf` |
| Preserved loader | `42d43f59e9dfee71a2176c58988dfeeeda679fc68cdc27cedcd12da934042376` |
| Preserved corrected launcher | `9e80006cf1969dec2dd7d34396536e36e28b62250f967c787b8392710a345eb0` |
| Preserved owned resource guard | `1c19f35495cd5a186dfcb75490a314814a9b37be594acaa51dcfbdcfae445790` |
| Preserved shared test resource helper | `3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d` |
| Preserved source plan | `fb9cb018534ca934ebb74582a440f0fab3d2ab4b6ccfa05880d9f1f5f103cda8` |
| Preserved dependency plan | `59838f3f60cc54ffffd4150aad7d9fbfdeef0bfc3408de3e7b1c76929a852597` |
| Preserved finite format plan | `5c5188be909988c0a7d19b6df1f4a7a3eaea8e120acb9008ac8a3bd971cf288e` |
| Preserved original freezer | `5f9718615c78c1e148a582826354e3de9775ff91f858d020e80690c1ee03d9c9` |

`renderer-94e05ff-uri1-vs-cjs1.diff` shows the complete two-validator and admission delta. The author static review passed 7,983 assertions over JSON metadata, Python ASTs and the frozen path catalogue. It parses both new validators and the unchanged launcher without importing or executing them. Reversing only the declared helper/call-site/admission-selection edits recovers each original validator's complete AST, preserving the seven load fields, exact hashes and membership, returned formats, edges, optional misses and lifecycle logic.

The finite catalogue has 1,896 distinct declared paths and 1,896 URL keys. All 1,833 unique dependency keys remain distinct; 203 change `%40` to `@`. All 205 hint keys remain distinct and currently have no spelling change. All 38 package-root keys remain distinct; ten change spelling. Every dependency file retains its most specific physical package owner. Each of the 22 source URLs already matches the convention. The first independently reported failing target is present under the corrected exact key. No observed journal URL is decoded, normalised or used to extend an allowlist.

Static argv review checks the complete frozen supervisor child command, unchanged isolated Python launcher, its `EXPECTED` list and `os.execve` argument binding, the one-byte gate, owned cwd, existing `cjs1` loader path, TAP reporter, single worker and exact renderer test file. All 2,110 carried node records and 129 absent declarations are identical to the prior admission. They were preserved as metadata; this author-only check does not establish their current physical validity or current host capacity. The dispatcher must perform fresh admission separately.

Source scope stays at `94e05ff9070aa19f5deb3e9997dfed96cc268473`: 22 rows, 17 application modules, 33 source edges, five explicit reads and nine exact names. Dependency scope stays at 38 packages, 1,850 rows / 1,833 unique files. The 205 hints across 22 typeless roots and the 31 excluded alternatives are unchanged. Limits remain 120 seconds, 384 MiB aggregate RSS, 128 MiB scratch plus the entire retained external107 directory, combined 2 MiB TAP/journal and one worker, with 5 GiB disk and 512 MiB host RAM reserves. Original `ed9` and `cjs1` packets are preserved; no original failed-run file was opened for replay or copied by this repair.

## Remaining gates

The command arrays in the new admission are review templates only. The supervisor must be granted the exact new admission SHA above and a new dispatcher grant; the separate auditor must use that same admission and a fresh original run directory. The consumed `cjs1` grant supplies no authority for another attempt. Both validators select the `uri1` admission while all child and input paths remain `cjs1`; the unchanged original freezer would regenerate the old packet and must not be used for this proposal.

A newly granted attempt must preserve bounded originals, prove all nine exact cases and the declared module/source/dependency graph, and meet the unchanged process, scratch, open-file, strict ledger and all-outcome cleanup duties. Unknown cleanup remains named and incomplete. No retry or repair follows automatically. The static proposal and inherited cleanup PASS do not establish renderer acceptance.

Accepted controller14, prior policy7 and actual102 combined11 evidence remain separate. Own16 backend selection, renderer9 acceptance, canonical103 runtime, actual105/client/navigation/next-offer composition, allocation/tick/evaluation/wait/no-match, responsive visual review and full integration remain unproved. No Jira, product-map, integration or acceptance state changed. Allocator96 was neither read, edited nor run.

Agents: Lego Batman requested/selected `gpt-6.1-sol` / high; no fallback or descendants.
