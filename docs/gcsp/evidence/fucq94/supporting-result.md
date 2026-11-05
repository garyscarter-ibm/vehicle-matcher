# FUCQ-94 supporting backend checkpoint

5 November 2026. The scoped backend slice is implemented and validated. The full UI story remains incomplete.

## Behaviour delivered

`createBriefEditorService({ brief, account, provider, policy, clock, identity })` supplies sourced, read-only known facts and canonical editable controls via `GET /api/gcsp/brief/editor`. Existing matching drafts, semantically consumed drafts after confirmation, current approved versions and labelled unconfirmed defaults reopen with their actual versions and independently saved consent. Missing HR account data stays visibly missing; unavailable required services fail unavailable.

`POST /api/gcsp/brief/preview` validates exact unsaved/base/draft input and uses the shared real FUCQ-29 evaluator over complete trusted stock. Responses and each candidate are explicitly `approved: false`; an absent approved base stays null, with no invented positive version. Only employee charging is overlaid with preview provenance. Provider essentials, driver, eligibility, allowance, timing, availability and source gates remain authoritative. Preview has no write/allocation/hold/mail interface and tests assert unchanged repository state.

The canonical assumed `brief.editor.v1` entry owns initial displayed positions/importance, labels and practical mappings. Explicit no means numeric minimum zero, empty required-equipment list or charging not-ready. Empty and zero requirements add no employee gate; positive provider requirements remain effective. Unknown stays null/needs-confirmation. No browser scoring/default table or known-fact editing endpoint is introduced.

Position and importance values remain independent. The existing schema has one source per preference and separate value/importance states. After an employee edits either axis, preview may provisionally use its carried displayed draft value on the other axis. Original draft states and unapproved provenance remain visible. This is a calculation of current draft choices, not evidence that each axis was reviewed or that durable permission was granted. Later UI copy must preserve that distinction; Save continues through the actual draft/confirm services with explicit independent consent.

## Scoped verification

The two commands in `supporting-validation-plan.md` passed against the same code identity `a048626ee40124a67a8c24cd0a01bf96054beae98e42546e1018ddf156b752e7`:

- New editor/controller: 34/34 passed (16 new integration tests and 18 controller tests), no skips; supervisor wall 2.480 seconds.
- Existing BriefService, approved recommendation API/unit, policy, employee feedback and index API boundaries: 142/142 passed, no skips; supervisor wall 8.278 seconds.

New checks execute the real PolicyService, repository, DemoClock, ManualContext, recommendation evaluator, BriefService Save/confirm and guarded HTTP composition. They cover canonical one-place changes, source authority, enum/type/authority rejection, explicit yes/no/unknown, retained consumed drafts, conflicting/stale/concurrently changed saved bases, no writes, unavailable sources, actual origin/role/run guards and absent injection. No preset winners are used. The approved public recommendation entry remains version-strict and refuses browser charging.

Coverage measured during these required checks: editor 99.38% lines / 89.74% branches / 96.77% functions; recommendation 100% / 79.22% / 96.43%; employee validator/gates 98.28% / 79.17% / 100%; controller 99.54% / 87.79% / 94.59%. The boundary command separately measured employee feedback 100% lines/functions. These are scoped observations, not whole-repository coverage or per-test contexts; Node supplies file/function coverage only.

Targeted records in shared `.claude/test-runs/`:

- `targeted-a048626ee40124a67a8c24cd0a01bf96054beae98e42546e1018ddf156b752e7-default-1793884088044383000.json`.
- `targeted-a048626ee40124a67a8c24cd0a01bf96054beae98e42546e1018ddf156b752e7-default-1793884156252659000.json`.

Full source/test/input hashes, execution/environment identity, measured coverage, useful initial failure excerpt and cleanup are retained in `.claude/test-runs/receipts/fucq94-20261105-editor/checkpoint-summary.json`; impact map is `.claude/test-runs/impact/fucq94-brief-editor.json`.

| Source | SHA-256 |
|---|---|
| `server/gcsp/brief/editor.js` | `df70b807923069db3b9d2b4a99ecd3ca887bc7683c5e536065c145c2664e8dc1` |
| `server/gcsp/brief/http.js` | `20a88f4cafa5c0009b54398682e1540cfabc2afea2b16935962b1406cbef8402` |
| `server/gcsp/recommendation/index.js` | `f0595fa37434b139d953db0ca89754ada08c9f6902abf3ea924addd2b72b6036` |
| `server/scenarios/employee/index.js` | `43f50c04794902dd1d10a008f7882d335c1b5179f1c57a3f4ab9ea1293f7d844` |
| `server/gcsp/policy/seed-v1.json` | `c585213b98631d6e82acc1b3720d47efae49fdb502f5fc86fb440703ef6e41a6` |
| `server/index.js` | `97b7c0c8507cac82cba8f62f470e53e490f194182faf0501af68a2569c6456a2` |
| `server/test/gcsp-brief-editor.test.js` | `e02989b8316d08267c231f3795bafc403ba6008221647e2542764cfef2a97d9a` |
| `blocks/gcsp/brief/brief-controller.js` | `724120f45ad1fb8c14ee6de1a82c3579fe97c075254b6ce8032d712abe6c82aa` |

## Resources and remaining scope

One worker, sequential small chunks. Largest nested sampled RSS 295,682,048 bytes, with boundary wrapper peak 33,046,528 bytes; nested scratch peak 3,711,200 bytes. Pinned dependency restoration used 2,920,288 bytes scratch and retained only the existing installed environment (851,968 allocated bytes). Four exact nested scratch roots, outer scratch, owned groups and reservation were verified absent. Removed successful verbose output trees/logs total 155,648 measured allocated bytes; scratch bytes at deletion were not separately measured. Retained compact proofs/checkpoints/coverage/hashes and bounded failure excerpt; no compatibility exception or leftovers. No archive or large output was created.

Implementer requested/selected/effectively verified `gpt-6.1-sol` / `medium`; no fallback or descendants. It finished before the lead's boundary command and cleanup. The lead reviewed source and caller boundaries, fixed the scope of validation and retained the actual runtime record.

FUCQ-95 frozen backend `1bcea40338c8d1f1464f963fae831c4b0fb38784` is absent from this tree. Its separate activity route/index/contract additions were inspected to plan reconciliation; nothing was copied. Combined FUCQ-95 route validation is pending an integrated tree. No full-suite run or full-story validation is claimed. Mounted brief view, browser transport/runtime composition, shared kit/catalogue/gallery/ratchet, custom element, accessibility and desktop/375px visual evidence remain incomplete under the Gary-approved `a7fc178` body reference. Shared UI paths remain held for FUCQ-95.
