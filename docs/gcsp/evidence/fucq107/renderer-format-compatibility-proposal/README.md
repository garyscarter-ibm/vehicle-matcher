# FUCQ-107 renderer format compatibility proposal

6 November 2026. **Authoring and metadata refreeze only; unreviewed, unexecuted, no active grant.** FUCQ-107 remains incomplete. The first attempt and all original reviewed files are preserved; its grant is consumed. The dispatcher independently completed failed-run cleanup PASS32. See `../renderer-first-run-failure/README.md` and its byte-identical root receipt.

## Diagnosis and selected correction

The first loader refused the exact pinned `tldts/dist/cjs/index.js` before any of the nine selected renderer cases. The actual returned format was omitted from that journal and remains unknown. The observed failure establishes an owned-loader compatibility boundary, not a product renderer failure.

Node v26.5.0's `lib/internal/modules/cjs/loader.js` (`getDefaultLoad`, `loadSource`, `.js` handler) can retain a nullish context format for typeless `.js` until after the hook chain. `lib/internal/modules/customization_hooks.js` merges context passed to synchronous `nextLoad`. The official v26.5.1 synchronous load documentation says that default `nextLoad` needs `context.format` when explicit module type information is absent. These sources explain the compatibility risk; they do not recover the missing failed-run value. Exact primary references are in `formats.json`; the executable remains the originally pinned v26.5.0 binary.

The correction supplies `format: commonjs` to `nextLoad` only when the incoming format is null or undefined and the URL belongs to a finite reviewed list of already-pinned CommonJS `.js` files. It verifies the file bytes and the nearest pinned package metadata, which must have no explicit type. An explicit CommonJS input is passed unchanged; a contradictory explicit format for a listed file is refused. The returned format set remains exactly `module`, `commonjs`, `json`; unknown, nullish and native formats remain refused.

`formats.json` binds **205 exact paths across 22 typeless package roots** to the existing dependency inventory and nearest package metadata. Each entry includes a source review marker. CJS-only packages use their reviewed CommonJS files; mixed packages use only the reviewed `tldts`/`tldts-core` CJS distributions and the exact CommonJS entries for `punycode`, `decimal.js` and `bidi-js`. Thirty-one other typeless `.js` alternatives are excluded from hinting. No runtime glob or syntax classifier selects formats. These markers support static review and are not a JavaScript parse or runtime proof.

Every successful load now journals the original tagged input format, the supplied hint or null, and the actual returned format. Tagging preserves undefined without JSON dropping the field. Refused returned formats record that same context plus the returned value's type/value. Input is captured before `nextLoad` can merge its context. Both supervisor and independent auditor require the exact seven load fields, finite hint membership, matching bytes and the expected CommonJS result. Unhinted files cannot claim a hint; mapped explicit CommonJS input must remain unchanged. Application modules must return `module`.

## Launcher argument correction after static review

The initial compatibility publication `c1eb26537c96c6fbd14aad290f614960c55dce63` had a real launcher mismatch: admission selected the `cjs1` loader, while the copied launcher's `EXPECTED` list still selected the old ed9 loader. The initial author checks and compatibility review missed that argv edge. A resumed static handoff caught it before execution. Root held the old admission `91141d2838b6808304caed74eb1b602ffe598e6fc2055b18904d463737fa874e` and authorised the minimal correction; it received no execution grant.

The new launcher changes exactly one `--import` path literal to `renderer-94e05ff-cjs1-loader.mjs`. Its size changes from 820 to 825 bytes. The admission changes exactly that node's bytes and SHA-256; command arrays, physical identity, guard, loader, validators, formats, product/source/dependency inputs and all 33 source edges remain unchanged. `vs-c1-argv.diff` shows this exact delta. `launcher-argv-repair.json` records the diagnosis and old/new hashes. The initial static-review capture is retained byte-identically as `author-static-review-c1eb265.json`, with SHA-256 `23675b6640a9213070d6803b23308da94f23ba8ddf01c332d473f0a6e3c28e9d`; its claim of launcher byte preservation is historical and superseded for the current packet.

The current static review verifies the complete frozen supervisor command → isolated Python launcher → identical Node `EXPECTED`/`execve` argv, including owned cwd, one-byte gate, exact loader path, reporter, single worker and exact test file. It passed **2,306 checks**, including all 2,112 physical pins, 129 absent candidates, the preserved original packets/captures and five Python AST parses. No runtime compatibility result is claimed. Targeted independent delta review and a fresh grant remain required.

## Frozen review packet

Authoritative prefix: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-cjs1-`. Adjacent copies are byte-identical and bound by `capture-index.json`.

Admission SHA-256: `a9ce7ec7f13b94f677ab74c3a61fa945be2ab6dec18930cb6ba133b1de569524`.

| File | SHA-256 |
|---|---|
| formats.json | `5c5188be909988c0a7d19b6df1f4a7a3eaea8e120acb9008ac8a3bd971cf288e` |
| loader.mjs | `42d43f59e9dfee71a2176c58988dfeeeda679fc68cdc27cedcd12da934042376` |
| launch.py, one path corrected | `9e80006cf1969dec2dd7d34396536e36e28b62250f967c787b8392710a345eb0` |
| supervisor.py | `80ed784913b831069593c7725805f5909c2a3b71596c24f43c964d36ee0c3be7` |
| audit.py | `72bdb97e370ba70ebb47f47c14c907f2d7b39421339e46e7c2b022696c8e836e` |
| freeze.py | `5f9718615c78c1e148a582826354e3de9775ff91f858d020e80690c1ee03d9c9` |
| resources.py, unchanged | `1c19f35495cd5a186dfcb75490a314814a9b37be594acaa51dcfbdcfae445790` |

`vs-ed9.diff` retains the initial loader/both-validator/freezer compatibility delta with mechanical prefix relocation normalised out. `vs-c1-argv.diff` adds the later exact launcher correction and one-node admission update. `formats.json` is the finite compatibility metadata. Source/dependency/Node/impact manifests and resource helper are byte-identical to the admitted ed9f619 originals. The original ed9 launcher remains unchanged at SHA-256 `3f20c1e2b1915efebf76ef6e16f90ad344d72232c74a7c9ca3e6071ae32a89f3`; only the new cjs1 launcher path differs. All 13 old external files still match their capture hashes. The seven original failure captures remain unchanged; the separate dispatcher cleanup audit is added beside them.

The source scope stays at `94e05ff9070aa19f5deb3e9997dfed96cc268473`: 22 rows, 17 application modules, 33 application import edges, five explicit file reads and nine exact names. Dependency scope stays at 38 packages, 1,833 unique paths (1,850 original rows), three lock inputs, 228 directory identities/listings and 129 absent candidates. There is one additional admission node for the finite format manifest, for **2,112 pins**. No package/product/source/test/dependency change, package installation or alternate entry resolution is proposed.

The accepted lifecycle and resource helper are unchanged: 120 seconds, 384 MiB aggregate RSS, 128 MiB scratch plus the entire external107 retained directory, combined 2 MiB TAP/journal, one worker, 5 GiB disk and 512 MiB host RAM reserves. The new prefix preserves the original run-directory ownership pattern and all cleanup duties. Both old and new retained proposal bytes fall within the charged external107 root. No resource reservation or scratch was created during authoring.

The isolated stdlib freezer ran once for the initial compatibility metadata. Its initial 3,128 author checks omitted complete argv consistency. The current metadata refreeze updates only the launcher node hash/size using stdlib text/JSON authoring, with the separate 2,306-check static review above; no freezer or execution helper was imported or executed during that repair. Required immutable reads used the scaffold Git CLI. No product, dependency or test module was imported; no Node command, JavaScript syntax check, process probe, ledger-content inspection, allocation, test, browser or renderer retry ran. No runtime result is inferred from static checks.

## Remaining gates

The proposed execution/audit command templates are frozen in admission JSON. They are not permission to execute. From the owned worktree only, the once-only command template is:

```text
/usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-cjs1-supervisor.py --execute --admission-sha a9ce7ec7f13b94f677ab74c3a61fa945be2ab6dec18930cb6ba133b1de569524 --dispatcher-grant <new-exact-renderer9-grant>
```

The dispatcher chooses the exact new grant after independent delta review and current admission. The prior failure and cleanup receipt do not prove the correction works. A granted attempt must retain its original bounded `plan.json`, `output.log`, `modules.jsonl`, `summary.json`, `checkpoint.json` and external ownership manifest under a fresh `renderer9-<uuid>` run, with its exact child/supervisor PID/start/group identities and scratch/reservation token. All nine exact names, 17 application modules and 33 source edges must be proved from originals, with zero failures/cancellations/skips/todos.

On success, error or handled cancellation, stop/join all owned descendants, prove recorded PID/start and group absence, validate the strict locked ledger, prove scratch inode/open-file absence before exact owned removal, prove deletion, and release/verify only the exact reservation. Unknowns preserve named resources and report incomplete cleanup. The separately pinned auditor runs only after supervisor exit against the exact original run directory; a failed test summary will refuse the success auditor and requires the dispatcher's independent failed-run cleanup audit. No retry, variant, repair, extra probe or browser run follows automatically.

Accepted actual102 mixed11, controller14 and unchanged policy7 evidence remain separate. Own16, renderer9, canonical question runtime adoption, actual105/client/navigation composition, allocation/tick/evaluation/wait/no-match, responsive visual review and full integration remain open. The experience contract, agreed employee-account/replace-vehicle references and `COMPONENTS.md` remain applicable. No Jira, shared lane, product-map, integration or acceptance status changed. Paused allocator96 was neither read nor run.

Agents: Lego Batman requested/selected `gpt-6.1-sol` / high, no fallback or descendants. No agent spawned.
