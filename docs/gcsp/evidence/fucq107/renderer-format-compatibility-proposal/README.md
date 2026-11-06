# FUCQ-107 renderer format compatibility proposal

6 November 2026. **Authoring and metadata refreeze only; unreviewed, unexecuted, no active grant.** FUCQ-107 remains incomplete. The first attempt and all original reviewed files are preserved; its grant is consumed. The dispatcher independently completed failed-run cleanup PASS32. See `../renderer-first-run-failure/README.md` and its byte-identical root receipt.

## Diagnosis and selected correction

The first loader refused the exact pinned `tldts/dist/cjs/index.js` before any of the nine selected renderer cases. The actual returned format was omitted from that journal and remains unknown. The observed failure establishes an owned-loader compatibility boundary, not a product renderer failure.

Node v26.5.0's `lib/internal/modules/cjs/loader.js` (`getDefaultLoad`, `loadSource`, `.js` handler) can retain a nullish context format for typeless `.js` until after the hook chain. `lib/internal/modules/customization_hooks.js` merges context passed to synchronous `nextLoad`. The official v26.5.1 synchronous load documentation says that default `nextLoad` needs `context.format` when explicit module type information is absent. These sources explain the compatibility risk; they do not recover the missing failed-run value. Exact primary references are in `formats.json`; the executable remains the originally pinned v26.5.0 binary.

The correction supplies `format: commonjs` to `nextLoad` only when the incoming format is null or undefined and the URL belongs to a finite reviewed list of already-pinned CommonJS `.js` files. It verifies the file bytes and the nearest pinned package metadata, which must have no explicit type. An explicit CommonJS input is passed unchanged; a contradictory explicit format for a listed file is refused. The returned format set remains exactly `module`, `commonjs`, `json`; unknown, nullish and native formats remain refused.

`formats.json` binds **205 exact paths across 22 typeless package roots** to the existing dependency inventory and nearest package metadata. Each entry includes a source review marker. CJS-only packages use their reviewed CommonJS files; mixed packages use only the reviewed `tldts`/`tldts-core` CJS distributions and the exact CommonJS entries for `punycode`, `decimal.js` and `bidi-js`. Thirty-one other typeless `.js` alternatives are excluded from hinting. No runtime glob or syntax classifier selects formats. These markers support static review and are not a JavaScript parse or runtime proof.

Every successful load now journals the original tagged input format, the supplied hint or null, and the actual returned format. Tagging preserves undefined without JSON dropping the field. Refused returned formats record that same context plus the returned value's type/value. Input is captured before `nextLoad` can merge its context. Both supervisor and independent auditor require the exact seven load fields, finite hint membership, matching bytes and the expected CommonJS result. Unhinted files cannot claim a hint; mapped explicit CommonJS input must remain unchanged. Application modules must return `module`.

## Frozen review packet

Authoritative prefix: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-cjs1-`. Adjacent copies are byte-identical and bound by `capture-index.json`.

Admission SHA-256: `91141d2838b6808304caed74eb1b602ffe598e6fc2055b18904d463737fa874e`.

| File | SHA-256 |
|---|---|
| formats.json | `5c5188be909988c0a7d19b6df1f4a7a3eaea8e120acb9008ac8a3bd971cf288e` |
| loader.mjs | `42d43f59e9dfee71a2176c58988dfeeeda679fc68cdc27cedcd12da934042376` |
| supervisor.py | `80ed784913b831069593c7725805f5909c2a3b71596c24f43c964d36ee0c3be7` |
| audit.py | `72bdb97e370ba70ebb47f47c14c907f2d7b39421339e46e7c2b022696c8e836e` |
| freeze.py | `5f9718615c78c1e148a582826354e3de9775ff91f858d020e80690c1ee03d9c9` |
| resources.py, unchanged | `1c19f35495cd5a186dfcb75490a314814a9b37be594acaa51dcfbdcfae445790` |

`vs-ed9.diff` shows only the loader, both validators and freezer changes with the mechanical prefix relocation normalised out. `formats.json` is the new finite metadata. Source/dependency/Node/impact manifests, launcher and resource helper are byte-identical to the admitted ed9f619 originals. All 13 old external files still match their capture hashes. The seven original failure captures remain unchanged; the separate dispatcher cleanup audit is added beside them.

The source scope stays at `94e05ff9070aa19f5deb3e9997dfed96cc268473`: 22 rows, 17 application modules, 33 application import edges, five explicit file reads and nine exact names. Dependency scope stays at 38 packages, 1,833 unique paths (1,850 original rows), three lock inputs, 228 directory identities/listings and 129 absent candidates. There is one additional admission node for the finite format manifest, for **2,112 pins**. No package/product/source/test/dependency change, package installation or alternate entry resolution is proposed.

The accepted lifecycle and resource helper are unchanged: 120 seconds, 384 MiB aggregate RSS, 128 MiB scratch plus the entire external107 retained directory, combined 2 MiB TAP/journal, one worker, 5 GiB disk and 512 MiB host RAM reserves. The new prefix preserves the original run-directory ownership pattern and all cleanup duties. Both old and new retained proposal bytes fall within the charged external107 root. No resource reservation or scratch was created during authoring.

The isolated stdlib freezer ran once for metadata only. Static review passed **3,128 checks**, including 2,112 physical/content pins, 129 absent candidates, five Python AST parses, all 22 immutable Git source rows, finite format/source-marker bindings, stable service/own16 hashes and original evidence preservation. Only the required scaffold Git adapter was imported for immutable Git reads. No execution helper, product, dependency or test module was imported; no Node command, JavaScript syntax check, process probe, ledger-content inspection, allocation, test, browser or renderer retry ran. No runtime result is inferred from static checks.

## Remaining gates

The proposed execution/audit command templates are frozen in admission JSON. They are not permission to execute. Independent review and a new exact dispatcher grant are required before one new attempt. The prior failure and cleanup receipt do not prove the correction works.

Accepted actual102 mixed11, controller14 and unchanged policy7 evidence remain separate. Own16, renderer9, canonical question runtime adoption, actual105/client/navigation composition, allocation/tick/evaluation/wait/no-match, responsive visual review and full integration remain open. The experience contract, agreed employee-account/replace-vehicle references and `COMPONENTS.md` remain applicable. No Jira, shared lane, product-map, integration or acceptance status changed. Paused allocator96 was neither read nor run.

Agents: Lego Batman requested/selected `gpt-6.1-sol` / high, no fallback or descendants. No agent spawned.
