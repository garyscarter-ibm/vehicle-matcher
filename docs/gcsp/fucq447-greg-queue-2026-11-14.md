# FUCQ-447 Greg queue checkpoint — 14 November 2026

Partial original capability, ready for parent review/integration; worker HOLD. Both original
acceptance criteria remain unchecked. Native/file In Progress, Gary Carter assignment, claim,
13 points and the six stable slices are unchanged. No new feature or acceptance criterion.

## Delivered boundary

The native Angular `greg/cases` body now reads the authorised queue in server order, opens
one exact selected case, and shows its named ownership, current status, reason, calendar
renewal deadline, UTC due time, recorded remedy and dated history. The existing Java-facing
CaseClient and projections remain unchanged. Current returned options supply the permitted
statuses and feasible alternative cars, reviewed later releases, manual decisions and
policy-permitted contract extensions. Cars needing suitability confirmation are visible
and unselectable. Preference-confirmation support remains unavailable; no command or
successful capability is invented for that existing parity gap.

A local draft must pass validation before a separate review. Only Confirm sends the immutable
exact-case/current-version command. Pending writes block duplicate submission, editing,
selection, refresh and close. Acknowledged updates reread queue and selected options;
acknowledgement remains distinct from failed readback. Stale/conflicting versions discard
the obsolete intent and require refreshed options and a new review. Unknown outcomes retain
the exact command, perform no automatic retry, and expose deliberate identical-intent retry
only after both current reads succeed. Matching history/reason/version never proves success.
Account/run/environment/policy/role/session changes, refusal and disposal hide/clear private
state, abort work and ignore late responses; authentication recovery never replays a write.

The shared `gcsp-data-table` uses native caption/headers, explicit associations, literal
cells, employee-named Open actions, empty/disabled states and return-focus support. Its
rows stack below 640px with labels. The gallery adds only table examples; COMPONENTS adds
only the Angular table entry. The sole route substitution preserves the existing Greg
roles/guard/title and every other route byte, including Help and F445 offers. No backend,
authentication, shell, packages, locks or other shared primitives changed.

Reference: frozen `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38` files
`blocks/gcsp/cases/gcsp-case-queue.js`, `.css`, `case-content.js`, `gcsp-cases.css`,
`blocks/gcsp/kit/data-table.js` and `gcsp-case-queue.html`. The incoming
`blocks/gcsp/case-queue/` path was inaccurate. The shell/palette reference
`docs/gcsp/screens/00-employee-account.webp` was inspected. Current tokens/components are
reused; no unapproved Greg concept is a parity requirement. ScreenIntro/StatusScreen,
ButtonDirective, FactList, LabelledField and ErrorSummary are reused. Opening focuses the
case heading; review focuses its heading or validation summary; Close returns to the named
Open button; pending/completion focuses the single status region. These focus results were
tested in jsdom; product browser/rendered evidence remains open.

## Actual selected validation

Final `native-3`: native Angular test compilation/bundle PASS, **64/64 tests PASS**, zero
failed/skipped/pending/TODO, six files, exit 0. Store 27, component/actual router 15, shared
table 3, existing Help route 9, route policy 5 and route guards 5. The selection covers the
changed intent/privacy/selection boundary, native form/route/focus consumers and shared table;
it is scoped evidence, with no full-suite claim. The 127 current project input hashes match
the actual final run. A compact impact record is retained under local
`.claude/test-runs/impact/fucq447-greg-ee3984f2f11c2c07.json`.

Earlier results are preserved separately: `native-1` failed compilation with TS2322/TS4111
because an intersection type exposed alternative-car orderUuid as unknown/indexed data;
no tests executed. The store now checks the indexed exact ID before exposing the choice.
`native-2` then compiled and passed 61 tests. Final review added authentication-failure
presentation and mismatched-option cases; `native-3` passed the resulting 64. Counts are
not added across runs. `git diff --check` and an exact route-substitution check passed.

The installed headless Google Chrome smoke attempt in `native-2` printed a blank DOM but
did not exit within 30 seconds. Its log records
`CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670`, allocator warnings and macOS
`task_policy_set ... invalid argument (4)`. It was stopped/joined; no browser repair,
download, further browser attempt or product-page rendering followed. The combined
`native-2` receipt is therefore incomplete despite its 61 passing tests. Final `native-3`
explicitly retained that browser limitation and ran tests only.

**Still unrun/unproved:** actual employee→Greg→employee Java/real OIDC/native PostgreSQL
journey, native transaction/restart/concurrency acceptance, employee/Greg backend authority,
full original preference-confirmation/suitability/clock/risk/notification/host parity,
rendered desktop/narrow, Safari/private browsing, browser keyboard/focus/announcements,
reduced-motion/CSP/accessibility, hosted/email/remote acceptance, production build and full
suite. Doubles and native test compilation do not establish these boundaries. FUCQ-501
Medium and FUCQ-502 Low remain separate, unclaimed, unfixed and nonblocking/outside66.

## Local resource and preservation receipt

Gary's explicit OneDrive prohibition governed all work, including metadata and teardown.
No OneDrive path was read, written, checked or followed; no historical cloud runner was
executed/imported. Previously retained cloud cleanup observations remain historical only.
The task-specific local runner imports only `_tools/test_resources.py` with an explicit
local reason and `/private/tmp` output root. It materialises a private 23,008-file,
241,262,821-byte dependency closure from the permitted read-only installation and pins
current source/template/style/dynamic-import inputs. HOME/TMP/config/npm/cache paths are
owned local scratch. Installed tools only; one worker, canonical 2GiB disk/RAM grant and
locked readback, 480-second work/600-second inclusive boundary, 120-second cleanup allowance
and 5GiB emergency reserve. No real services, database or network integration were started.

Actual maxima across the three finite chunks: 320,667,161 bytes inclusive scratch/output,
1,315,471,360 bytes supervisor-plus-group RSS, 66.916 seconds inclusive. All local scratch
roots, supervisors, owned process groups/command lines and canonical reservation tokens
were independently absent at the local audit. Strict locked canonical ledger schema passed
with zero entries. Borrowed installation metadata, every selected dependency hash, and Node
identity/hash matched before/after each run. No whole-installation content-hash claim.

Local evidence root: `.claude/test-runs/fucq447/greg-queue-local/` in the main checkout.
`local-final-audit.json` SHA-256 `685ffa622fa4079774095f23ebff5b2be62429f0eeb59c7cdfbd1ba2bcd7a138`.

| Retained evidence | Bytes | SHA-256 |
| --- | ---: | --- |
| `native-1/receipt.json` | 3066 | `a874af932aa352913d7c96f33ebe9843a60b9c872c272ae34ec42bdef6faa9e0` |
| `native-1/tests.log` | 856 | `f36a9d4e283b81f1516dab6afe2f5ec7a041ac95222038cf1755ff8194a20298` |
| `native-2/receipt.json` | 3596 | `675265967cc3c5d6434fb5e70866fd2c3b74584dcdc1b19587808f2eee07f895` |
| `native-2/test-report.json` | 23411 | `0943f7f6ca63e94b4ff2083588d9dfc8e0e84bc296bc1a615b30b720b9632717` |
| `native-2/tests.log` | 4446 | `23e867f824651edf10cad3982b5cc2fb04d7aa854e531596aa0e928205eca7b2` |
| `native-2/browser-start.log` | 1252 | `c476916e638510ba77cd5060e408f90be62f0fc92977cdf0362155ae268854fe` |
| `native-3/receipt.json` | 3144 | `f93b3768171a49bf3568ec4fd45bc74a68ed0e752702bcef63cbdbcba389be4c` |
| `native-3/test-report.json` | 24556 | `592c1c06e51988e2400fdf3e20bcea6ac3aaa655da99a03eca65fac37ef7d53f` |
| `native-3/tests.log` | 4446 | `7abe13717a756f76b811a4bb8fa6035c9804aafb4346e9433dc2fbd3c69f4fde` |

## Source identity and handoff

Clean parent base: `8cbcfe7580785dacf77cb7b8ddff598d712756ae`, branch
`dev/DEV-2026-11-13-015`. SAME Hubie, requested/selected/effective gpt-6.1-sol/high,
no fallback, descendants, new chat or claim. Parent owns Jira/native lifecycle,
publication/integration and sync; this worker commits only its allocated paths and does
not push, merge, rebase or claim acceptance. Route writer is released on handoff.

Own FUCQ-447 map object only: Greg moves to in-progress; contracts remains in-progress,
client complete, employee-help/composition in-progress and integration not-started. All
301 foreign raw rows/order/outer bytes and native observations are preserved. Worker HOLD
observation expires immediately and makes no ongoing execution claim. Original Story bytes
remain an exact prefix. Existing Help/client/projection files are unchanged.

Shared dispatcher learnings for the parent to append: DL-20261114-GC-004 has direct local
mitigation evidence above; the current forbidden-storage policy was obeyed without probing
OneDrive. The bounded implementation+selected-check release delivered a coherent tested
increment without preparation handoffs (DL-20261114-GC-001), while the browser timeout remains
unresolved (DL-20261114-GC-006). Framework follow-up proposal: recognise a bounded headless smoke timeout after
blank DOM as incomplete browser evidence, stop owned groups and preserve logs without a
repair campaign. This worker did not edit the shared learnings log or expand Story scope.

| Current authored source | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/cases/case-queue.store.ts` | `c5cc73eca00acf2b6e0f9b2544fd7bd30a2f5464b87252b8affe6fe30f0df67e` |
| `apps/gcsp-web/src/app/cases/case-queue.store.spec.ts` | `18fcc21ddbefd07c0c10300db404abdcd8cb9ccfe6e366fd232fdc12661d9577` |
| `apps/gcsp-web/src/app/cases/case-queue.component.ts` | `024e3331dccb1017344925e166dceb693e76dbc454d220ff3d1ac36581b95c09` |
| `apps/gcsp-web/src/app/cases/case-queue.component.html` | `5fbde6d6ef71834b457294509b768832796fe1d2db57d315a5bdb087c283e776` |
| `apps/gcsp-web/src/app/cases/case-queue.component.css` | `3236ffc13f82e41eb96375667ce6daf0d44dcbc922c02e9d07f65feeccc3d439` |
| `apps/gcsp-web/src/app/cases/case-queue.component.spec.ts` | `cf804f9e5d602cd300f7c31002832206b4ed5493545e247cc938f967b9e343a1` |
| `apps/gcsp-web/src/app/kit/data-table.component.ts` | `c38fffb11573f1643d06ac0e107b02ef4a4e839cf9fac6e9d64397625fd83064` |
| `apps/gcsp-web/src/app/kit/data-table.component.css` | `608c7d3faa1e989e0b574b442d700ae2937d6b33f84e74f22600896099275081` |
| `apps/gcsp-web/src/app/kit/data-table.component.spec.ts` | `d7efa0774c8eec5abfe5162023ee4e26bf592df1decd9e18be1593ad03a38515` |
| `apps/gcsp-web/src/app/routes.ts` | `a83914f555d9b2222fecee191144b075ca81bce5956916de5dd96e45e04710f4` |
| `apps/gcsp-web/src/app/pages/gallery.component.ts` | `625c774da0da69bb9f63260511d2a41f097cb3de6d06fda3f11377fe61376b37` |
| `COMPONENTS.md` | `4a4846cbc9d62c2863adb9078c9b00197fd5df6e5a01093636b519254cbaf72d` |


## Dispatcher integration — 2026-11-14 17:07 UTC

Published exact worker `8f539829506ec1c0491edb279b33caf781e93e44` and merged/pushed to
`gcsp-poc-dev` at `b0c5ff37b1d10c6b23e6efde108e6a535742275e`. Elmer Fudd's independent read-only review returned
PASS_FOR_PARTIAL_INTEGRATION with no actionable findings; receipt
`.claude/fucq447-greg-independent-review-1700.json`, SHA-256
`bf9d8b2cafafb421d82638be1321990f4423cf65a3a59a414de5cbd21b3966a8`.
Requested/selected gpt-6.1-sol/high; no fallback, descendants or reviewer runtime.

Parent independently matched all 127 final test input hashes, 301 foreign raw map rows,
original Story prefix, 23,008 selected borrowed dependency hashes and unchanged installation
metadata/Node. Owned local scratch, supervisors, process groups and canonical tokens were
absent under the ledger lock at 17:05 UTC; one other reservation was preserved. Parent audit
SHA-256 `ebef098dad6a1e45a1578b68e48f245d0eee4d991425efe7a039f448c74b57a4`.
Integrated root still matches all 127 inputs; no duplicate test run was needed.

This publishes the coherent increment only. Both original AC, native In Progress and Story
lease remain; browser timeout, rendered/connected/hosted limitations above are unchanged.
No OneDrive access, acceptance waiver, In Review or Done transition occurred.
