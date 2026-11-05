# FUCQ-44 offline Driver’s Guide evidence

Validated on 5 November 2026 in `dev/DEV-2026-11-04-014`, implementation commit
`371e30906ab67b3ad1af775415dadd033f441f90`; integrated validation source
`7f614549c2227b0a169a5abf82b78511b8100482`. This is deterministic offline proof using generated
fictional identities, generated keys and injected transport. No real BMW request, real VIN, credential,
live activation, demo use or retention decision was made. The provider is disabled without explicit backend
transport and the existing trusted identity guard.

## Acceptance evidence

| Criterion | Implementation and observed proof |
| --- | --- |
| 1. Fixed fresh-key encrypted route | `createBmwDriversGuideAdapter` keeps its raw provider private. The “fresh source keys” test privately decrypts each captured ciphertext, verifies RSA PKCS#1 v1.5 and base64url, and checks a new fixed key request for each resolve. Only the fixed key/manual routes and `encryptedVin` plus explicit locale are constructed. |
| 2. Current key validation | “invalid key metadata, algorithms, decoded key types, sizes and HTTP” rejects invalid base64/DER, contradictory or unsupported algorithms, PSS/non-RSA types, and out-of-range keys before manual transport or injected encryption. Actual canonical SPKI and unrestricted RSA validation still run with injected encryption. No static key or credential is supplied. |
| 3. Bounded locale and identity | “only source-offered UK English”, “locale alternative rejects changed model or brand”, and timeout tests prove requested locale then at most one offered `en-gb`, unchanged ciphertext, exact authority at each request, no other locale retry, and rejection of conflicting vehicle metadata. Requested locale is retained; missing returned locale stays unknown. |
| 4. Independent safe outcomes | “manual HTTP, application, schema, identity and locale outcomes”, default negative/OK parser tests and hostile error tests prove `MANUAL_NOT_AVAILABLE` becomes `no-guide`, no-match and unsupported locale stay distinct, HTTP/application 422 never succeeds, and malformed schema, timeout and source failure retain fixed diagnostics. Raw application status is checked before a decoder. |
| 5. Injected bounded access and guard | Default-disabled, trusted-authority, fresh-key and timeout tests cover injected transport/clock/key handling, no redirects or returned URLs, response-size ceilings, whole-operation bounds and entry/key/requested/fallback guard checks. Actual synthetic-egress and registry callers pass their boundary suite. |
| 6. Metadata, privacy and presentation | Existing presentation tests and “hostile source content”, “hostile thrown objects”, “explicit provisional decoder” and “nested returned identifier containers” tests reject full/partial/encrypted/returned identifiers, query/hash URLs, raw errors and identifier aliases in metadata. Local opaque references replace source IDs. Disclaimer/source labels, metadata-only links, unknown equipment and independent current-car facts remain. The module owns no logging, analytics or trace sink. |

Focused tests are in `server/test/bmw-vin-guide-adapter.test.js`; the private provider and guarded projection
are in `server/vehicle-evidence/bmw-drivers-guide-provider.js` and `bmw-vin-guide-adapter.js`.
[Provider contract](../../bmw-drivers-guide-provider.md) records the transport obligations and exact supported
mapping. Caller-owned transport logging requires separate review before any activation.

## Source-schema boundary

The dated [1 November research](../fucq-4/drivers-guide-native-2026-11-01.json) supports the fixed routes,
`publicKeyData.pem`, DER/SPKI, RSA PKCS#1 v1.5, observed `OK`/`MANUAL_NOT_AVAILABLE` outcomes and named handbook
metadata. It does not retain a complete wire schema. The parser therefore requires no invented interface version
or `manualData` container. Its default root-field mapping is explicitly provisional. A bare unavailable status
needs no metadata; successful metadata stays partial; missing returned locale remains `null`.

The optional decoder fixture explicitly maps a fictional `manualData` container. That fixture proves the injected
mapping boundary, not live BMW schema compatibility. Root or nested RSA declaration placement, locale availability
paths and additional enumerated negative statuses are explicitly supported offline mappings. A later separately
authorised live check may refine them. It is optional and is not outstanding work in this offline story.

## Validation and identities

| Command | Native result | Supervised wall / peak descendant RSS / peak scratch |
| --- | --- | --- |
| `node --test server/test/bmw-vin-guide-adapter.test.js` | 25 passed, 0 failed | 1.4 s / 154238976 B / 41792 B |
| `node --test --test-concurrency=1 server/test/gcsp-synthetic-vin-egress.test.js server/test/gcsp-vin-registry.test.js` | 13 passed, 0 failed | 5.3 s / 264388608 B / 357792 B |
| Configured `npm test`, strict full mode, one worker | 1017 total, 1015 passed, 0 failed, 2 skipped, 0 cancelled/todo | 58.0 s / 392069120 B / 547968 B |

The two skipped PostgreSQL checks are the native SQL-constraint test and shared TransactionRepository integration
contract: `GCSP_DATABASE_URL` was unset. No PostgreSQL verification is claimed. Native counts come from the Node
summary; the generic command stamp does not parse them (`ran: null`, generic `skipped: 0`).

Actual full Node argv was `/opt/homebrew/bin/node --test-concurrency=1 --test server/test/**/*.test.js`, supplied
through a process-local fixed shim. Node v26.5.0; Python 3.9.6; macOS 26.5.1 arm64. No project settings changed.
The full run used the configured command without a command override and held the dispatcher’s serial slot.
After the current base advanced in documentation/queue records, guarded `--no-ff` integration created
`7f614549c2227b0a169a5abf82b78511b8100482`. The prescribed guide check and full suite were repeated once on
that integrated tree under code-poller D1–D2. Strict `--full --force` bypassed stamp reuse for this explicitly
required refresh; the configured `npm test` command and executable fingerprint were unchanged.
HostBudget had no active reservation at preflight; there was no other live full suite.

- Executable code fingerprint, all final checks: `1e0e035be1ada83c917fc7fac1eea6956582c255bf07f015f5ede04dea5b35c9`.
- Full source HEAD: `7f614549c2227b0a169a5abf82b78511b8100482`; tree: `3c18e22e671f7777c34ba4226a3fce02b659fcc4`.
- Full strict key: `aba55ccda2d73fc2dd6b585620793a2384692c2024e1022fc99f996e09c26c07`, recorded `2026-11-05T13:45:41+0000`, default variant.
- Full environment identity: `f9eb6dd19f792aeb39a239c8e7448ecb84825e4b8cc6916adf93c5cfd6d2cc9d`.
- Full settings identity: `0d673c6e06b7b0092235e4f11ba39fc6925760e457a91b1482b6d78fbe4a56fb`.
- Integrated shared base: `b9dd531d3aa35ff1bb87065eb9da51e664065444`; initial scoped comparison base was `0d056e56291967381f57f25798244f0f73ed9ccb`. The integration changed only queue/mail/setup/Result documentation, with no executable delta.

No screen, interaction or shared component changed. Metadata/disclaimer/unknown-equipment assertions satisfy this
backend slice’s experience gate. Approved visual reference `a7fc178`, supplied header/sidebar/palette references,
Used Cars body direction and `COMPONENTS.md` still govern future consuming screens, which require their own
desktop/narrow/keyboard review. No new screenshot or live/production proof is claimed.

## Retained reconstruction and cleanup

All local paths below are under
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq44/` and are intentionally outside owned scratch:

- Audited supervisor: `lead-supervisor.py`; fixed shim: `serial-runtime/node`; actual argv: `full-effective-argv.nul`.
- Full plan: `integrated-full-1793886282262954000-plan.json`.
- Full stamp: `strict/stamp-aba55ccda2d73fc2dd6b585620793a2384692c2024e1022fc99f996e09c26c07-default.json`.
- Full checkpoint: `strict/checkpoints/09b6ceb43534b124180fce01544817c0ca028cc856e5fb109612497d429fa185.json`.
- Full bounded log: `strict/logs/20261105-134442-7q2qhtcw/chunk-0001.log`.
- Full resource receipt: `integrated-full-1793886282262954000-receipt.json`; full manifest: `strict/ownership/0baeec9aed59441c96624f5417ca6569.json`.
- Scoped receipts: `integrated-guide-1793886263226348000-receipt.json`, `lead-final-boundaries-1793885806941519000-receipt.json`.
- Scoped strict records: `strict/targeted-1e0e035be1ada83c917fc7fac1eea6956582c255bf07f015f5ede04dea5b35c9-default-1793886265470570000.json` and `strict/targeted-1e0e035be1ada83c917fc7fac1eea6956582c255bf07f015f5ede04dea5b35c9-default-1793885813097626000.json`.
- Scoped checkpoints: `strict/checkpoints/ec2eacab5ae275134b7062f2978d9c8871162fc81e25fa19f359fd7129acb89d.json` and `strict/checkpoints/f2f852b9c66fa6f091021c0a4401d54601b4650bd26e7a28eb084c1354c75c70.json`.
- Pinned dependency receipts and unchanged package/lock hashes: `dependencies-summary.json`.
- Independent finalizer: `finalize-cleanup.py`; pre-removal plan: `final-cleanup-plan.json`; final receipt: `final-cleanup-1793886346405170000-receipt.json`.

The final receipt enumerates all 13 manifests, independently verifies their scratch roots, process groups and
reservations absent, and verifies unchanged package/lock hashes. Exact empty owned parents under worktree
`.claude/test-scratch/fucq44` were removed. No disposable scratch remains. OneDrive-IBM/Claude was absent;
no large output, archive or fabricated cloud destination was created. Only bounded local records are retained.

Explicitly retained until dispatcher worktree cleanup: worktree `node_modules` (27138292 bytes) and
`server/node_modules` (858816 bytes), installed from existing pinned locks with no source/package/lock changes.
No cleanup touched other stories. Dispatcher retains merge/close/drop and independent integration checks.

Agents: lead requested/selected `gpt-6.1-sol/high`; implementer requested/selected `gpt-6.1-sol/medium`;
no fallback. Effective lead `gpt-6.1-sol/high` and implementer `gpt-6.1-sol/medium` were independently verified
from each session’s first `turn_context` by the dispatcher and lead. Session evidence: lead
`/Users/garycarter/.codex/sessions/2026/11/05/rollout-2026-11-05T13-20-09-01a1abdd-e6a2-7cc1-8021-1e141d316dac.jsonl`;
implementer `/Users/garycarter/.codex/sessions/2026/11/05/rollout-2026-11-05T13-22-49-01a1abe0-577a-7bd1-9ab9-27ea9aad9b64.jsonl`.
One implementer, no descendants. No Cowork/Jira action or scheduled job.
