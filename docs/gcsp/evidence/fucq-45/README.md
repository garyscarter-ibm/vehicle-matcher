# FUCQ-45 controlled handbook and illustration evidence

Validated offline on 5 November 2026 in `dev/DEV-2026-11-04-015`. Implementation commit
`839bd12` is integrated with shared base `6e5870dae05f2c11e34bf7edbf22edf96cf04d2b`, producing full-tested
source `72646aeed7a5ba374b2ff9f1d7629c214df80aec` and tree
`4bc0d2001f7a5456a6a762ef5dd401639bdbadea`. Generated fictional identities/keys and injected
transport supply all guide content. No real VIN, credential or BMW request was used. Live activation,
demo use and retention of private guide content remain unapproved; optional live exercise is **UNEXERCISED**.
Offline success proves the implemented boundary, not supported production access or a full live schema.

The first pre-merge reconciliation added FUCQ-40's separately authorised local demo catalogue-image adapter,
dated manifest, two WebP runtime assets and tests. Review of all eight incoming paths confirmed no
rewiring of this private guide provider, transport, current-car facts or shared presentation contract.
The catalogue render's observed model/paint semantics remain separate from VIN-linked illustration's
unverified fidelity. The executable delta invalidated the earlier full stamp, so all prescribed focused
checks and exact configured `npm test` were rerun serially on the combined source. The new proof below
supersedes the earlier `87336780123e` full stamp for current-base completion.

Latest shared base `6e5870dae05f2c11e34bf7edbf22edf96cf04d2b` then added deployment YAML,
setup documentation and FUCQ-40/41 lifecycle records. No application/test/fixture/dependency file changed;
`render-base-focused-reconciliation.json` records unchanged focused-file blobs/hashes. The 36 + 17 focused
checks below retain proof from source `2ae1730f55e12c1ba4610d04da30c6ed33d20727`. Root `render.gcsp.yaml`
changed the strict code/config key, so status rejected full reuse and exact `npm test` ran again on the
latest source. No deployment or live provider call was performed.

## Acceptance evidence

| Criterion | Implementation and offline proof |
| --- | --- |
| Fixed guarded PDF/COSY | Explicit `content: { pdf: true, illustration: true }` adds only fixed `pdfManual`/`cosy` routes after usable manual metadata. “optional PDF and illustration requests” proves the same ciphertext, final attempted locale and fresh checks. “content requests are opt-in” proves default callers make no content request and revoked authority prevents each transport. “optional guard stalls” proves late authority cannot launch transport. |
| Returned URL/type validation | “PDF validation rejects unsafe URLs” covers protocol, exact source origin, credentials, port, fragments, malformed percent escapes/encoded controls, markup and PDF metadata. “raster MIME, bytes, redirect and transport validation” covers JPEG MIME/signature/basic structure, invalid/oversized/truncated/HTML/SVG bodies, redirects and changed response URLs. Unsupported PNG/WebP fail closed. No returned private URL is fetched or executed. |
| Truthful usable content/facts | PDF and illustration statuses/outcomes are independent. Missing PDF, failed application/HTTP, invalid image, decoder/transport/authority timeouts preserve unrelated usable handbook metadata and independent current-car facts. Source disclaimer, `href: null`, metadata-only opaque `pdf-N` references and `vin-linked-illustration` / `unverified` semantics remain. Paint, wheels, equipment and connected/scheme facts stay unknown. |
| Identifier privacy | Existing hostile-source/log/error tests plus “later raw or decoded PDF identifiers” and “rejected foreign URLs” prove final handbook text/sections/links are checked against raw and decoded PDF identifiers, even missing/422/invalid envelopes and rejected URLs. Known private collisions become unknown. No raw provider response, logging/trace/analytics sink, public VIN lookup, persistence or general proxy is added. Caller-owned transport logging requires separate activation review. |
| Complete opt-in verification seam | `scripts/gcsp/verify-vin-guide.mjs` executes the actual guarded provider through injected dependencies and projects only provider/version/verification date, separate handbook/PDF/image HTTP/application outcomes, locale, link/image status and limits. Four focused harness tests cover positive/negative results, denied authority/hostile errors, invalid date, no default network activation and safe live refusal. The CLI has no built-in fetch/environment wiring; it is excluded from npm test. |
| Contract examples/experience | Tests cover usable references, no PDF, no illustration through existing common-contract scenarios, unverified fidelity, invalid link and provider unavailable, without replacing car facts or inventing specification. No screen/route/interaction changes. Content/presentation assertions provide this backend slice’s experience evidence. |

The [provider contract](../../bmw-drivers-guide-provider.md) records exact supported dependencies,
transport obligations and decoder mappings. Dated 1 November evidence establishes the fixed routes,
selected PDF `OK` outcome and JPEG result, not a complete PDF-list schema. The default root
`{ status, locale?, links }` mapping and injected `decodePdfManual` examples are explicit and provisional;
no invented mandatory source container/interface version is required. Fictional fixtures prove the seam.
JPEG validation is bounded content identification/basic structure, not full pixel decoding or production
image security certification. Bytes and URLs are discarded; no content delivery route is supplied.

The production private-field filter was preserved. Offline encryption fixtures select a collision-free
random ciphertext, with a bounded 100-attempt cap, to keep legitimate public fixture prose deterministic
under the existing strict four-character private-fragment filter. Actual RSA PKCS#1 v1.5 encryption,
private decryption/padding proof and a separate default-encryptor check remain. A real private collision
still removes the affected field; no source identity or URL is weakened to make a fixture pass.

## Validation and exact source identities

| Command | Native result | Supervised wall / peak descendant RSS / scratch |
| --- | --- | --- |
| `node --test server/test/bmw-vin-guide-adapter.test.js` | 36 passed, 0 failed/skipped | 2.1 s / 166281216 B / 12704 B |
| `node --test --test-concurrency=1 scripts/gcsp/verify-vin-guide.test.mjs server/test/gcsp-synthetic-vin-egress.test.js server/test/gcsp-vin-registry.test.js` | 17 passed, 0 failed/skipped: 4 harness + 13 actual callers; zero external calls | 5.7 s / 271187968 B / 341280 B |
| Configured `npm test`, strict full mode, one worker | 1041 total, 1039 passed, 0 failed, 2 skipped, 0 cancelled/todo | 61.3 s / 413859840 B / 786720 B |

The native PostgreSQL constraint and shared TransactionRepository integration checks skipped because
`GCSP_DATABASE_URL` was unset. No PostgreSQL verification is claimed. Native counts come from Node’s
summary; the generic full stamp records `ran: null` / generic `skipped: 0` and does not parse those counts.

The story's explicit npm test requirement and changed strict configuration identity justified the
final serial full run. Fresh `render-base-preflight.json` showed no active reservation, 4193255424 B
conservative RAM headroom beyond reserve, 61% system free and 3516.06 MiB swap used. The immediate
full plan measured 4267245568 B headroom; supervisor reservation adapted to measured room. No test
settings or dependencies changed. The configured test command and environment identities remain exact.

- Full-tested source HEAD: `72646aeed7a5ba374b2ff9f1d7629c214df80aec`; tree: `4bc0d2001f7a5456a6a762ef5dd401639bdbadea`.
- Integrated shared base: `6e5870dae05f2c11e34bf7edbf22edf96cf04d2b`.
- Final full code/config fingerprint: `5d25216390ac9ab5a1f0ab3fe6fb544d4244c6472fac26e45e3485cc80f91e6d`.
- Scoped checks’ code fingerprint: `e476bbc307dee9228dbd1b5206e682dece97e8178fef33a6f6fafaa208c24a09`; scoped source/input reuse is recorded separately.
- Strict full key: `a2bbc0dca0e6ab1a6bb91f3a59aa48b9fb7a602932cf0724fff4a41739dc30f5`, recorded `2026-11-05T14:19:44+0000`, default variant.
- Full environment identity: `307a4e291678d4e67d3da522f583e0d43b6112ebccef610bd1c05e91d3bef19d`.
- Full settings identity: `0d673c6e06b7b0092235e4f11ba39fc6925760e457a91b1482b6d78fbe4a56fb`.
- Actual argv: `/opt/homebrew/bin/node --test-concurrency=1 --test server/test/**/*.test.js`, recorded through the process-local fixed shim.
- Node v26.5.0, Python 3.9.6, macOS 26.5.1 arm64. No project settings changed. `SCAFFOLDING_HARNESS` was absent during test/status execution; final strict `--status` matched exactly.

Final Result/evidence edits affect documentation only, so the tested executable fingerprint remains valid.
The harness’s actual `node ... --live` command was not run: the offline unit check invokes its refusal
function without any live transport. Activation/use/retention and live/production proof remain separate.

## Experience and remaining boundaries

No screen, shared component/gallery/ratchet, route, policy, retail contract or persistence changed.
Presentation/content assertions check source labels, disclaimer, unknown image fidelity/equipment and
preserved current-car facts. No new screenshot is appropriate. Approved body reference `a7fc178` in
`../fucq-6/README.md`, supplied shell/palette screenshots, Used Cars body direction and `COMPONENTS.md`
continue to govern later consuming screens and their desktop/narrow/keyboard gates. The 5 November delivery
sequence defers human layout reviews until a working end-to-end demo; concise copy,
component/ratchet enforcement and applicable agent/browser/accessibility checks continue. No policy assumption
was introduced; existing central PolicyService authority remains unchanged. No required offline work remains.

## Retained reconstruction and cleanup

All relative paths below are under the shared, ignored records root
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq45/`, outside owned scratch:

- Preallocation plan: `ownership-plan.json`; audited supervisor: `lead-supervisor.py`; finalizer: `finalize-cleanup.py`.
- Full preflight: `render-base-preflight.json`; full plan: `render-base-full-1793888321854530000-plan.json`.
- Full receipt: `render-base-full-1793888321854530000-receipt.json`.
- Full stamp: `strict/stamp-a2bbc0dca0e6ab1a6bb91f3a59aa48b9fb7a602932cf0724fff4a41739dc30f5-default.json`.
- Full checkpoint: `strict/checkpoints/e7315c02d6e3574059689ef1e5c0a487bd3e2184428f200f0c7616a042d55820.json`.
- Bounded full log: `strict/logs/20261105-141842-vny1tuxp/chunk-0001.log`; shim: `serial-runtime/node`; actual argv: `full-effective-argv.nul`.
- Integrated guide receipt/checkpoint: `fucq40-base-guide-1793888019094915000-receipt.json`; `strict/checkpoints/65b9e3c431741c3b050749604fee636c6f3c6443abf93e015231791ed9003122.json`.
- Integrated harness/caller receipt/checkpoint: `fucq40-base-harness-boundaries-1793888028106647000-receipt.json`; `strict/checkpoints/bde149c8cd4d1be71b9708836648eff4738486e3f240aec87da2c6cb2c16b81e.json`.
- Targeted records: `strict/targeted-e476bbc307dee9228dbd1b5206e682dece97e8178fef33a6f6fafaa208c24a09-default-1793888022133143000.json` and `strict/targeted-e476bbc307dee9228dbd1b5206e682dece97e8178fef33a6f6fafaa208c24a09-default-1793888034621959000.json`.
- Current-base strict status: `render-base-passing-status-1793888392051521000-plan.json` and `render-base-passing-status-1793888392051521000-receipt.json` (passed; all 21 manifests removed/absent).
- Final cleanup plan: `final-cleanup-plan.json`; independently verified receipt: `final-cleanup-1793888398804988000-receipt.json`.
- Dispatcher’s independent all-21-manifest check: shared `.claude/test-runs/ownership/fucq45-dispatcher-final-verification.json` (updated after final-base validation).
- Focused reconciliation: `render-base-focused-reconciliation.json`.
- Pinned package/lock hashes: `dependencies-summary.json`; effective model/session records: `agent-models.json`.

All 21 exact ownership manifests below are `removed`; their roots, process groups and reservations were
independently verified absent by lead finalizer and dispatcher. The exact owned scratch parent
`worktree/.claude/test-scratch/fucq45/` was removed. Scope: 120 seconds / 128 MiB scratch / 768 MiB RSS
for direct checks; full run 300-second ceiling / 128 MiB scratch / at most 4 GiB RSS as measured room allows;
2-MiB log caps. Useful bounded failure logs and summaries are retained, disposable scratch removed.

- `ownership/011784dfb2564d35a462a455580467e3.json`
- `ownership/3c75efc848af46608fb761bf0b9d2a66.json`
- `ownership/3f095f3e227b4ff0a42b8ef773d7be6e.json`
- `ownership/5195bf9697ac47958757929a206506f6.json`
- `ownership/5b88ed82df4d4afaadb241c87b123dc6.json`
- `ownership/5d56a448e9d14d268c77ba06713e923c.json`
- `ownership/6656d6f97db8485c871a953b775cf831.json`
- `ownership/7e132a55ee0f4bdea91968642d29248c.json`
- `ownership/882317ce92ee45619ae6bcde04a48720.json`
- `ownership/a11adbe432344cecaf96f8f890dc152d.json`
- `ownership/b730f5a4890c4801ad67dfc551fcaf24.json`
- `ownership/bd5d8b8203224f43bf68955b850f41d6.json`
- `ownership/d3a8b7e65c864e6fb4c07d966e748785.json`
- `ownership/eb50f2d829654e748b80c0c9774d8b2a.json`
- `strict/ownership/09c9aa0962db4d199928ff53e673e70b.json`
- `strict/ownership/1625833220314f1580f5d279d594f6dd.json`
- `strict/ownership/6abd79559bf64d71bd013e62b4debd95.json`
- `strict/ownership/85d94c15d7f044c3ae4174750d2c891b.json`
- `strict/ownership/8a946ac9c6944f6ab27828934162bc20.json`
- `strict/ownership/bc45478c9cac459ea002715380aea845.json`
- `strict/ownership/690c4589f9034792bdd6038eda5dc891.json`

OneDrive-IBM/Claude was actually absent; no fabricated cloud destination or large output/archive was created.
Explicitly retained until dispatcher worktree cleanup: worktree `node_modules` 27138292 B and
`server/node_modules` 858816 B, installed using existing pinned npm ci with unchanged package/lock hashes.
No other story’s allocations were touched.

Agents: lead requested/selected/effective `gpt-6.1-sol/high`; implementer requested/selected/effective
`gpt-6.1-sol/medium`, no fallback. Each effective pair was independently verified from the first
`turn_context`; lead session `01a1abf9-54a0-7333-94bc-a8ed856bcf08`, implementer session
`01a1abfb-06e3-7a33-8ecf-a84e647da56e`, full paths in `agent-models.json`. One implementer, no descendants.
No Cowork/Jira operation, scheduled job, credential discovery or live use. Dispatcher retains merge/close/drop.


Dispatcher final integration, 5 November 2026: shared base 0c15b0ad2d22e96437060ab2daff6f936552bc57
was merged as f91da3550c99d145946a96ec845be5e93e462fc6. The incoming delta since reviewed 6e5870d
contains only docs/gcsp/dev-poller-2026-11-05.md and _dev/code-inbox/DEV-2026-11-04-054.md. No executable,
test, dependency or configuration input changed. The exact owned-worktree supervisor status matches full stamp
a2bbc0dca0e6ab1a6bb91f3a59aa48b9fb7a602932cf0724fff4a41739dc30f5; all original passing proof and
21 independently verified cleanup manifests remain applicable. No new suite/allocation was needed for prose.
Status receipt: .claude/test-runs/fucq45/dispatcher-owned-worktree-status-1793889332461232000-receipt.json.
Gary's explicit FUCQ-98 pause remains binding despite removal of a duplicated preconditions line in the inbox.
