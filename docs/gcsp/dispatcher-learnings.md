# Shared dispatcher learnings

Started at Gary's request on 14 November 2026. Both pollers record delivery issues and their resolution here,
so improvements can be carried into agent-scaffolding. This log is shared through `gcsp-poc-dev`.

Append an event when an issue is identified, mitigated, resolved, recurs or its diagnosis changes. Use a unique
ID such as `DL-20261114-GC-001` or `DL-20261114-RG-001`, then reuse it for later events. Preserve earlier entries;
correct them with a new event. Include UTC time, poller, impact, evidence, cause/uncertainty, action, outcome and
framework follow-up. Keep raw logs, credentials, private data and personal coordination files elsewhere.

States: **identified**, **mitigating**, **verified resolved**, **reopened**. A proposed framework change remains
a proposal until implemented and checked; record its eventual commit/check evidence against the same ID.
The log does not replace required defect records, expand Stories or add a delivery gate. Pull before writing;
commit and push named paths through the existing helper, preserving concurrent appends from the other poller.

## 2026-11-14 16:51 UTC · GC Codex · DL-20261114-GC-001 · identified

- **Issue/impact:** dispatch overhead and scheduling holds reduced useful parallel delivery. At the 16:32
  observation only FUCQ-447 was confirmed active; FUCQ-442 and FUCQ-446 were held by GC scheduling.
- **Cause/evidence:** repeated separate source, test-preparation, review and runtime-release handoffs are
  recorded in FUCQ-434 coordination comments 3629457/3629458 and the Story delivery histories. The capacity
  tool at 16:50 reported `can_start=3`; resource capacity did not require keeping both independent Stories held.
- **Action/outcome:** identified as a dispatcher process problem. Existing resource ownership, original
  acceptance criteria and conflict protection remain necessary; they do not require a new permission round
  for every routine implementation/test step.
- **Framework follow-up:** make a bounded Story release include implementation and proportionate checks;
  recheck runnable existing work against actual capacity and file conflicts, rather than waiting for an
  unrelated checkpoint. Measure useful delivery before calling this resolved.

## 2026-11-14 16:52 UTC · GC Codex · DL-20261114-GC-001 · mitigating

- **Action:** resumed the existing FUCQ-442 lead for its original stock screen, minimal vehicle card and
  compact media support, with source and selected checks authorised together. Exact allocated files exclude
  the FUCQ-447 worker's table, routes and catalogue/gallery edits; parent integrates shared wiring serially.
- **Evidence/outcome:** owned clean worker fast-forwarded and published at
  `8cbcfe7580785dacf77cb7b8ddff598d712756ae`. App API confirmed both Emmet/FUCQ-442 and Hubie/FUCQ-447 executing.
  Two active workers is a scheduling improvement; this release has no completed validation/delivery result yet.
- **Framework follow-up:** validate that the simpler release produces coherent tested integrations without
  widening the original Story or repeating preparation rounds. Framework implementation remains proposed.

## 2026-11-14 16:50 UTC · GC Codex · DL-20261114-GC-002 · mitigating

- **Issue/impact:** a global "active" count can be mistaken for complete visibility across both pollers.
- **Cause/evidence:** all 18 native In Progress Stories had leases, but nine belonged to the other poller
  without fresh execution evidence available here. Its latest observed FUCQ-434 coordination comment was
  3629458 at 10:29:52 UTC. A lease or native In Progress status cannot establish current execution or inactivity.
- **Action/outcome:** apply Gary's six exclusive buckets: To do, active, held, blocked, in review and done.
  Label those nine reservations **held — execution unverified**, with the observation time. Preserve native
  Jira statuses. Fresh native query and lease reconciliation still cover exactly the authorised 66 Stories.
- **Framework follow-up:** exchange small expiring execution observations between pollers, separate from
  leases and tracker status. Reporting semantics are applied locally; shared execution visibility is unresolved.

## 2026-11-14 16:35 UTC · GC Codex · DL-20261114-GC-003 · mitigating

- **Issue/impact:** the global Jira lifecycle planner took approximately eight minutes and produced 198
  proposals when only FUCQ-417's lifecycle needed action.
- **Cause/evidence:** the planner scanned historical adoption dates across Git refs for unrelated Stories.
  Only the authorised FUCQ-417 operation was applied; the Story is native In Review and cleaned up. Its
  acceptance disposition and evidence map are in `docs/gcsp/evidence/fucq417/`.
- **Action/outcome:** GC's local adapter now accepts an explicit issue scope before planning and rejects
  acknowledgements for foreign keys. Syntax was checked; the scoped runtime has not yet been exercised.
- **Framework follow-up:** add native scoped lifecycle planning to agent-scaffolding and verify it against
  both selected and excluded issues. Do not call the performance problem resolved from syntax checking alone.

## 2026-11-14 16:54 UTC · GC Codex · DL-20261114-GC-004 · mitigating

- **Issue/impact:** inherited output-placement and cleanup instructions conflict with Gary's explicit
  prohibition on all OneDrive access, including reads and cleanup verification.
- **Cause/evidence:** historical resource instructions require large outputs in synced storage. They cannot
  override the later human restriction. Historical observations retained locally are not fresh cloud audits.
- **Action/outcome:** current worker releases prohibit all such access and use bounded local scratch with
  the resource helper's explicit local reason and `/private/tmp` output root. Persisted the restriction in
  shared `AGENTS.md` and linked it from `CLAUDE.md`; no OneDrive inspection or cleanup was performed for this log.
- **Framework follow-up:** make explicit forbidden storage locations binding throughout allocation, imports,
  finalizers and audits; support local output policy without a cloud-aware runner. Do not verify this by
  probing a forbidden location. Future checks must retain resource limits and report any resulting limitation.

## 2026-11-14 16:54 UTC · GC Codex · DL-20261114-GC-005 · mitigating

- **Issue/impact:** scope and validation requirements can grow while an existing Story is being delivered.
- **Cause/evidence:** Gary reaffirmed strict bounds after today's stalled-work concern. Shared policy commit
  `2855b2f837a4392ac81d4c887867e1e4dee5c7fe` fixes the original criteria, applicable contracts and named files;
  lower-severity defects remain independent backlog work. Existing unmet criteria remain actual Story work.
- **Action/outcome:** current FUCQ-442/FUCQ-447 briefs carry exact original criteria, finite source allocations,
  selected checks and remaining acceptance gaps. Five GC Stories, FUCQ-412–415 and FUCQ-417, have since reached
  native In Review with integrated/pushed evidence. This does not prove all stalled work is resolved or accepted.
- **Framework follow-up:** carry the claimed contract through build and review; distinguish original gaps
  from proposed additions and reuse unchanged applicable evidence. Keep optional hardening off delivery gates.

## 2026-11-14 16:55 UTC · GC Codex · DL-20261114-GC-006 · identified

- **Issue/impact:** the installed headless browser could not establish rendered evidence for the new
  FUCQ-447 queue/detail UI. Desktop, narrow-screen and browser keyboard checks remain unverified.
- **Evidence/cause:** Hubie's current worker report says all 61 selected tests passed, but the Chrome
  attempt printed a blank page and failed to exit within 30 seconds, with display/process-policy errors.
  These results are worker-reported pending the parent receipt audit; the precise browser cause is unresolved.
- **Action/outcome:** the worker reports stopping its process group and removing owned local scratch,
  preserving the failed check and continuing the bounded source checkpoint without a browser repair campaign.
  Tests alone do not establish rendered or whole-Story acceptance.
- **Framework follow-up:** detect supported installed browser capability before allocating a rendered run,
  retain a bounded failure and stop/join its owned process group. Avoid repeatedly releasing the same failed
  environment without a causal correction. This entry neither authorises browser repair nor waives original checks.

## 2026-11-14 16:57 UTC · GC Codex · DL-20261114-GC-002 · mitigating

- **Correction/evidence:** a full coordination-comment read confirms 3629458 at 10:29:52 UTC was authored by
  GC, not the other poller. The latest Russell-authored update observed is 3629446 at 09:23:23 UTC. Preserve
  author identity as well as the timestamp when describing peer evidence. The nine execution-unverified
  reservations remain held; this correction establishes neither activity nor inactivity.
- **Action/outcome:** at Gary's explicit request, coordination comment 3629463 now asks the peer for a
  current per-Story execution/blocker/last-progress/next-action report, the overall bottleneck and any help
  needed from GC. No response has yet been observed. The earlier comment's author attribution was corrected.
- **Framework follow-up:** attach source author and observation time to cross-poller status evidence;
  distinguish an outbound request, a peer reply and a verified worker observation.


## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-001 · mitigating

- **Evidence/outcome:** FUCQ-447's bounded queue/table release produced compilation and 64/64 selected
  passing tests. Parent matched all 127 inputs and resource receipts; independent review found no actionable
  issue. Exact worker `8f539829506ec1c0491edb279b33caf781e93e44` is integrated/pushed as `b0c5ff37b1d10c6b23e6efde108e6a535742275e`.
- **Action:** publish the coherent increment promptly while retaining the original Story's unchecked
  criteria and failed/unrun browser/connected checks. FUCQ-442 continues its separate allocated screen work.
- **Framework follow-up:** this is direct evidence for a useful combined implementation/check release;
  it does not establish sustained throughput or resolve the framework scheduling problem. Current measured
  `can_start=2` remains below the three-slot new-Story-lead budget, so no new reservation was taken.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-004 · mitigating

- **Evidence/outcome:** the parent audited the current FUCQ-447 local runner/receipts, selected dependency
  identities and actual local teardown. All owned scratch/processes/tokens were absent at 17:05 UTC; the
  unrelated reservation was preserved. The audit used only explicit allowed local paths.
- **Action/follow-up:** the local mitigation worked for this increment; inherited forbidden-storage
  instructions remain overridden. No forbidden path was probed, and no framework implementation fix is claimed.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-006 · identified

- **Confirmed evidence:** independent review and parent audit retain native-2's incomplete Chrome
  about:blank attempt (blank DOM, 30-second timeout, display/process-policy errors). Native-3 passed 64
  tests only; it did not repeat or pass rendering. Product browser and keyboard evidence remain open.
- **Action/follow-up:** publish the source increment with this precise limit; avoid repeating a failed
  browser release without a causal change. No browser repair or acceptance waiver was introduced.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-007 · mitigating

- **Issue/evidence:** FUCQ-442 reports Chrome starts, but its isolated fixture initially could not
  bootstrap Angular's partially compiled libraries. This is worker-reported fixture setup evidence, not
  a production defect. Native ngc compilation passed; a fixture-only compiler import enabled 17 reported
  browser checks. Parent pin/resource audit and the final checkpoint are still pending.
- **Action/outcome:** the worker continues the same bounded release, correcting a missing original
  monthly-points summary found during visual inspection. No new feature or test-framework expansion.
- **Framework follow-up:** distinguish fixture bootstrap failures from product failures, retain each
  attempt, and require the final source identity for any reused visual evidence. Do not call this verified yet.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-008 · verified resolved

- **Issue/cause:** parent and reviewer source audits attempted to read a binary input through
  scaffold_git's text-output wrapper, raising UnicodeDecodeError before finishing pin verification.
- **Action/evidence/outcome:** parent used SHA-256 of exact local bytes plus tracked-file/clean frozen-HEAD
  comparison; reviewer used immutable Git blob IDs plus byte hashes. Both independently completed all 127
  pins. Parent receipt SHA-256 `ebef098dad6a1e45a1578b68e48f245d0eee4d991425efe7a039f448c74b57a4`.
- **Framework follow-up:** provide a binary-safe immutable-object audit API. The local audit failure
  is resolved; no shared framework patch, product source change or extra runtime was needed.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-001 · mitigating

- **Evidence/outcome:** the FUCQ-442 finite screen/card/media release reached reviewed, audited and pushed partial integration `db1d00e8d`, with 33 selected tests and 17 actual-source fixture browser checks. Existing FUCQ-446 lifecycle work resumed as soon as measured capacity reached three; the same lead is implementing the employee screen/actions. No new Story was reserved for this pass.
- **Action/follow-up:** continue complete source/check increments and prompt serial publication, then technically ready pickup within the fixed 66. Existing original route/connected acceptance gaps stay visible. This is measured local progress, not proof that scheduling overhead is globally resolved.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-003 · mitigating

- **Evidence/outcome:** the explicitly scoped FUCQ-447 lifecycle planner was exercised at runtime and returned an empty operation list, exit 0. No operations, writes or acknowledgements were required.
- **Action/follow-up:** this verifies the scoped no-op path for one Story; it does not measure broad performance or verify the nonempty write/acknowledgement path. Native framework scoped planning remains a proposal.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-007 · verified resolved locally

- **Evidence/outcome:** corrected FUCQ-442 fixture bootstrap/tool invocation produced 33 selected test passes and 17 browser checks on both matching 167-input receipts. Parent audited the final pins and local teardown; an independent reviewer matched immutable blobs and viewed all nine final captures. The screen increment is pushed at `db1d00e8d`.
- **Qualification:** retain initial TS2339/TS7006, native-esbuild invocation and partial-Angular-library/timeout failures, plus the earlier scrolled-capture compositor artifact. Their local fixture causes were corrected; this proves neither production CSP/AOT nor integrated router/Java/OIDC/native-PostgreSQL acceptance. No generic framework repair was performed.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-009 · identified

- **Issue/impact:** FUCQ-442's test runner samples command descendants but omits its Python supervisor from peak RSS. Earlier browser1–5 also omitted detached Chrome groups. Full aggregate historical peak cannot be established from those receipts.
- **Cause/evidence:** read-only inspection of local-run.py shows sampling rooted at the command PID; the supervisor is outside that set. Final browser6 correctly walks recursive command descendants and records their groups. Retained selected/browser combined peaks are approximately 1.43/1.39 GB; the omission establishes uncertainty, not a demonstrated overrun.
- **Action/outcome:** independently verified nine local scratch roots, 23 groups, supervisors, link and canonical tokens absent, plus borrowed identities/caches unchanged. Preserve the peak limitation in delivery evidence. No test was rerun merely to improve the receipt; no extra product or Story scope was introduced.
- **Framework follow-up:** shared resource supervision should include its own RSS, recursive descendants and detached groups in aggregate accounting, while preserving bounded local-only allocation and Gary's absolute forbidden-storage restriction. This remains a proposed framework improvement.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-005 · mitigating

- **Evidence/outcome:** FUCQ-442 independent review found two below-High source issues. They were promptly captured as separate linked backlog Bugs FUCQ-504 Medium and FUCQ-505 Low, left To Do/unassigned/unclaimed/unfixed, and did not expand the frozen screen increment. Existing FUCQ-499 remains open.
- **Action/follow-up:** preserve source-only versus runtime reproduction, actual impact and original unmet criteria. Apply the same rule in both pollers so ordinary review findings do not silently become extra Story scope or unnecessary merge gates.

## 2026-11-14 17:19 UTC · GC Codex · DL-20261114-GC-008 · verified resolved locally

- **Issue/cause:** the first FUCQ-442 parent audit checked new worker files in the parent checkout before the increment was merged, causing FileNotFoundError. This was an audit path error, not a mismatching product input.
- **Action/evidence:** corrected the audit root to the clean frozen worker and completed both 167-input sets, original Story/map preservation and actual local teardown. Receipt: `.claude/fucq442-stock-parent-audit-1700.json`. Following integration, only the expected newer FUCQ-447 input differences remained.
- **Framework follow-up:** bind audits explicitly to frozen checkout and commit; do not confuse an unmerged file's absence in the parent with a failed worker source check.

## 2026-11-14 17:22 UTC · GC Codex · DL-20261114-GC-010 · identified / correcting

- **Issue/impact:** FUCQ-446's first employee-screen/action check stopped during compilation, before any tests ran. No passing-test or rendered-journey claim follows.
- **Evidence/cause:** Bertie's current worker report identifies one new client type error and an isolated fixture that copied unrelated OIDC specs without their dependency closure. Exact compiler output and receipts remain with the active worker pending frozen checkpoint audit; this entry is worker-reported, not an independent runtime diagnosis.
- **Action/outcome:** the same worker is correcting its allocated client type and limiting fixture inputs to the selected import graph, retaining failed evidence and reporting owned cleanup/borrowed-input checks passed. No extra Story, dependency installation, backend repair or generic harness project was started. Resolution is not yet verified.
- **Framework follow-up:** selected compilation must include the actual transitive source dependencies while excluding unrelated specs; a test failure before discovery is zero executed tests. Preserve source identity, exact failure and teardown, and reuse the corrected bounded runner.

## 2026-11-14 17:22 UTC · GC Codex · DL-20261114-GC-010 · mitigating / validation incomplete

- **New evidence:** Bertie reports compilation now succeeds far enough to execute the selected checks: **103 passed, 11 component tests failed**. This supersedes zero executed tests for the latest attempt only; the earlier compilation failure remains retained. Parent has not yet audited the frozen receipts.
- **Cause/status:** the worker attributes the 11 failures to fixture assertions preceding asynchronous controller reads. That is the current diagnosis, pending a corrected check and parent audit; no green result or product-fix conclusion is claimed.
- **Action:** the same bounded worker is making fixtures await observed controller state and continuing relevant existing role/authentication coverage. Exact failed evidence, current source pins, owned teardown and original acceptance obligations remain required. No new scope or framework implementation is authorised.


## 2026-11-16 · GC Codex · DL-20261114-GC-001 · mitigating

- **Outcome:** parent completed review of the frozen FUCQ-442 route/history/gallery and FUCQ-446 employee lifecycle increments after the 14 November child review attempts failed. Stock is integrated/pushed through `6dc5a31d533d34b023a23c49feb45ea11564174a`; lifecycle through merge `58224a0c5`. No new actionable source finding was identified at these bounded review boundaries. Original unchecked criteria and separate Bugs remain open.
- **Evidence:** stock27 selected tests/15 actual-source fixture checks/seven personally inspected captures; lifecycle116 selected tests/eight files, with zero usable browser checks/captures. Parent matched178 stock native/browser inputs and136 lifecycle native/139 browser inputs, immutable blobs, original Story prefixes and301 foreign product-map objects before publication. Independent child review did not complete; parent review was independent of implementation. This is coherent partial delivery, not whole-Story acceptance or a full integrated-suite claim.
- **Follow-up:** publish completed increments promptly and distinguish original unfinished capability from extra validation or framework work. No framework implementation fix is claimed.

## 2026-11-14 17:30–17:39 UTC evidence, recorded16November · GC Codex · DL-20261114-GC-009 · mitigating

- **Stock outcome:** the new stock-host runner includes the Python supervisor plus recursive/detached owned process groups. Two actual earlier resource stops remain failed attempts; the heap384 attempt passed27 tests and final browser15 checks. Parent verified four allowed local roots, eight groups, supervisors, links/tokens absent and borrowed identities/caches intact. The earlier incomplete peak measurements remain qualified.
- **Lifecycle finding:** source inspection found its runner reserved2GiB disk PLUS2GiB RAM and checked them separately, rather than the intended inclusive2GiB sum. All retained disk+recordedRSS peak sums were below2GiB (largest approximately1.84GB); an overrun is not established. Supervisor/current-group RSS does not prove full recursive/detached coverage. Parent verified all six owned roots/groups/supervisors/tokens absent and23008 selected borrowed content hashes plus Node unchanged. Do not reuse that runner without correcting allocation and full aggregate accounting. Preserve the raw receipts; no rerun solely for improved accounting.
- **Follow-up:** allocation must fit one inclusive grant, e.g.768MiB disk+1280MiB aggregate RAM; enforce the sum across supervisor and all owned descendants. Both current F418 workers were briefed. Framework change remains proposed.

## 2026-11-14 17:23–17:39 UTC evidence, recorded16November · GC Codex · DL-20261114-GC-010 · verified resolved locally / acceptance incomplete

- **Correction:** lifecycle native-5 passed116 tests, zero failures/skips, eight files. Parent matched all136 native inputs and immutable blobs. Retain native-1 client type/unrelated spec-closure failure (zero tests), native-2 missing global styles (zero tests), native-3 103pass/11fail and native-4 114pass/2fail. The final changes await settled async producer state and use section-specific assertions instead of broad absence matches against baseline stage labels.
- **Outcome/follow-up:** selected fixture/type problems are resolved locally. Compilation/tests do not establish connected Java/OIDC/native PostgreSQL, rendered experience or whole-Story acceptance. Keep fixture prerequisites explicit; no generic harness expansion was added.

## 2026-11-14 17:26 UTC evidence, recorded16November · GC Codex · DL-20261114-GC-006 · identified recurrence

- **Evidence:** lifecycle development preview built successfully, then the90-second browser attempt timed out. Its report remains planned with zero checks/captures and empty browser log. Parent confirmed no captures exist and audited owned local teardown. Precise browser cause remains unresolved.
- **Action/follow-up:** retain this finite failure; no render/keyboard pass or causal diagnosis follows from a successful bundle. Establish a supported installed browser and a causal correction before repeating the same attempt. No repair campaign or original acceptance waiver was introduced.

## 2026-11-16 · GC Codex · DL-20261116-GC-001 · diagnosis clarified

- **Issue:** lifecycle browser receipt observed one unrelated reservation disappear during its lifetime, so it could not establish foreign-token continuity.
- **Correlation:** exact token96debdcd10e345f98a8753ecb1ba8828 and owner PID74610/start identity match the stock worker's first resource-stopped attempt. Stock records its own removal at2026-11-14T17:24:36.365UTC, inside lifecycle browser17:24:34–17:26:37UTC.
- **Outcome/follow-up:** this is consistent with independent normal stock cleanup, not evidence of cross-worker deletion. Preserve the original false-continuity flag/raw receipts and timed observations. Do not infer either mutation or universal foreign continuity from endpoint presence alone.

## 2026-11-16 · GC Codex · DL-20261116-GC-002 · verified corrected locally

- **Issue:** the product-map slice CLI normalized five foreign objects and advanced F446's native observation time while writing its own slices. Worker boundary checking caught this before commit; it restored the original native fields and spliced only its own output.
- **Evidence/outcome:** parent verified all301 foreign raw objects/order/outside bytes and original own native fields/slice IDs/points preserved. Stock's own work observation advanced separately; it did not change native status, assignment or fixed slice IDs/points. No product-map framework patch was made.
- **Follow-up:** provide an own-object-preserving update and separate native observation time from slice evidence time. Preserve historical observation times instead of refreshing them merely on rewrite.

## 2026-11-16 · GC Codex · DL-20261116-GC-003 · mitigating

- **Issue/evidence:** Dot, Foxy2 and Elmer Fudd each returned IBM HTTP422 errors saying Advantage credits were exhausted, from api.servicesessentials.ibm.com/v1/responses. The parent launcher continued to work. One same-agent retry also failed on14November; raw errors/CF rays are retained in local handoff/agent state, not treated as verified balance evidence.
- **Action/outcome:** preserve claims/branches/partial files and model settings; parent completed the existing source/evidence reviews. On16November the same Dot/Foxy pair resumed F418 and reached actual focused test discovery. No credential/model change or duplicate writer was introduced.
- **Follow-up:** treat child422 as a diagnostic while the launcher works, per AGENTS.md. Repeated blind retries do not deliver progress; carry a bounded existing task in the available launcher or resume the same checkpoint when viable.

## 2026-11-16 · GC Codex · DL-20261116-GC-004 · identified / correcting

- **Issue/cause:** parent supplied a Jira search projection without parent/issuelinks to the official importer. Missing fields appeared as deleted epic/dependencies, creating misleading jira_changed notices and rewriting16 waiting records. Claimed original acceptance content stayed intact; the helper added notices only. The66 statuses/count were unaffected. This was the dispatcher's input error.
- **Action:** fetched all66 again including parent, issuelinks, created, description, attachment, reporter and points; both relationship fields are present for every issue. Corrective official import restores the waiting metadata. Retain the misleading notices as historical input-error evidence; do not interpret them as human acceptance changes. Final result is recorded in the pass handoff.
- **Performance impact:** the first import held the shared checkout mutex for several minutes while committing notes. A concurrent lifecycle merge was safely refused with no mutation, then succeeded after release. Shared Git operations must stay serial. Add a local projection guard before future imports; framework field-completeness/performance improvements remain proposed.

## 2026-11-16 · GC Codex · DL-20261114-GC-002 · mitigating

- **New native evidence:** all66 now show16ToDo/10InProgress/40InReview/0Done. The former nine peer reservations have reached native InReview; F466 also reached InReview.113 remote commits were integrated without dropping the stock increment. This supersedes the old nine-held report; it is progress evidence, not proof of present execution.
- **Coordination:** no reply to the explicit F434 status request was observed in the latest comment read. The last actual Russell-authored coordination observation remains3629446 at2026-11-14T09:23:23UTC. Reconcile current leases and classify current execution separately; do not infer activity from native status or old claims.

## 2026-11-16 · GC Codex · DL-20261116-GC-005 · verified diagnosis / parser unresolved

- **Issue/cause:** after the complete-projection corrective import succeeded, four `validate changed` notices remained on F436/F439/F445/F447. `jira_sync.split_story` stops only at `## Result`, so preceding local delivery/checkpoint headings become part of the last `validate:` block. Native validation did not change.
- **Evidence/action/outcome:** a read-only comparison using the official parser proves all four validation prefixes before the first local appendix equal current native validation. Local receipts `.claude/native-validation-deltas-20261116-0016.json` and `.claude/native-validation-prefix-proof-20261116-0016.json` retain the comparison. Original AC and historical notices stay intact; these are not collaborator contract changes. Corrective complete intake finished with zero failed items; the local adapter now requires parent/issuelinks as well as the other full-import fields.
- **Follow-up:** propose distinguishing local appendix boundaries from Jira-owned fields. No framework code repair, broad history rewrite or additional acceptance gate was performed.

## 2026-11-16 · GC Codex · DL-20261116-GC-006 · publication delay contained

- **Issue/evidence:** an optional push that merely fast-forwarded the existing F446 worker branch to the already published root `cbcd0aac5672968ba89b9cb93cb59b8a4392f3ee` remained in the managed Vault Radar pre-push hook without output for over17minutes. The parent cancelled only its owned push process tree and released the shared Git mutex. No hook, security setting or credential was bypassed or changed.
- **Outcome:** remote readback still shows the worker branch at reviewed `57e66de11c1a0083ba0cc7dfd4594a8e789dfab8` and the integration branch at published `cbcd0aac5`. The idle worker's local fast-forward succeeded cleanly. SAME Bertie resumed the finite original orders entry/catalogue increment from that published base; its actual new checkpoint still needs normal publication. Local diagnostic: `.claude/fucq446-fast-forward-push-delay-20261116-0016.json`.
- **Follow-up:** avoid optional ref-only pushes that hold the common mutex while scanning a large already published range; retain normal hooks for the actual source checkpoint. The hook's root cause is unverified; this is a cancelled delay, not a reported security rejection or a framework fix.

## 2026-11-16 · GC Codex · DL-20261114-GC-002 · stale blocker corrected

- **Evidence:** current Java `OffersResource` now implements F465/F466 offer reads/decisions/follow-up. The old F445 assertion that all these handlers are absent is stale after the peer integrations. Current source still has a concrete composition mismatch: Angular sends `runId` on offer reads/reasons while Java rejects all query parameters; Angular uses `/offer-followup?decisionId=...` and `/offer-followup/confirm` while Java exposes offer-scoped follow-up paths.
- **Outcome/limits:** source inventory is recorded in the F445 integration note. No HTTP reproduction, defect severity, repair, producer ownership transfer or acceptance is inferred. Real email/OIDC/remote outcomes remain original F445 obligations. Other idle frontend claims are held pending current technical reassessment where their older blocker has not been confirmed; unrun checks alone do not establish a blocker.

## 2026-11-16 · GC Codex · DL-20261116-GC-007 · elapsed-time evidence unresolved

- **Issue/evidence:** F418 lead reports101selected passes and one native PostgreSQL skip, but the main runner's reported290.976seconds conflicts with TAP durations of1142294ms for runtime plus608573ms for clock-reset. Suspension or clock behavior is a possible explanation, not verified. The480/600second elapsed budget is therefore unproven for that batch.
- **Action/outcome:** retain raw records and label the timing limitation explicitly; do not rerun the suite merely to replace an inconvenient receipt. Lead reports a fresh audit finding all five runs' owned resources absent and borrowed hashes preserved; parent audit is still outstanding. No claim of complete resource-budget compliance or Story acceptance follows from passing tests.

## 2026-11-16 07:52 UTC · GC Codex · DL-20261116-GC-007 · deadline failure confirmed

- **New evidence:** the main ownership manifest was created at1794809849.0533812 and removed at1794811647.0935879:1798.040seconds of realtime. This establishes that the600second total deadline was exceeded. The earlier description as merely unproven is superseded; the reason for the realtime/monotonic divergence remains unverified.
- **Action/outcome:** retain this failed resource obligation alongside the101passing assertions and one original native-case skip. SAME Foxy is attempting only that original skipped case against already installed owned local PostgreSQL, with both realtime and monotonic deadlines enforced; no installation or repetition of the101checks. That case cannot erase the historical overrun. Lead reports current resource absence, parent audit/publication remains pending, and native acceptance is not inferred.

## 2026-11-16 10:00 UTC · GC Codex · DL-20261114-GC-002 · blocker revalidated

- **Evidence:** F441 was held while its historical missing-version assertion awaited current-source reassessment. At shared root `045a304e538a7f8a90f49d09f60f14e68ae2087e`, Angular still requires editor contextVersion and context/clock versions; the Java editor response omits them. Exact producer/consumer locations and source hashes are retained in the F441 delivery note and local reassessment receipt.
- **Outcome/limits:** report F441 blocked on this concrete composition obstacle, preserving native In Progress, original unchecked criteria and Java ownership. This source inspection establishes neither runtime reproduction nor a repair or severity verdict. Unrun checks on other reserved Stories remain held unless a current concrete obstacle is recorded. Separate Medium F491 remains unfixed and nonblocking.

## 2026-11-16 09:36–09:40 UTC · GC Codex · DL-20261116-GC-007 / DL-20261114-GC-009 · integration completed, limits retained

- **F418 outcome:** the original skipped native case subsequently passed alone on owned installed PG16.15, with strict dual-clock checks. Parent verified all 815 native inputs, 3,939 borrowed identities and all seven attempts' current resource absence. Frozen source was reviewed, integrated and pushed; native Jira moved to In Review and helper cleanup completed. The main 1,798.040-second realtime deadline failure and unknown historical aggregate peak remain unresolved. Passing native evidence does not repair the historical failure.
- **F446 mitigation:** the necessary orders-route check used the corrected inclusive 768 MiB disk plus 1,280 MiB RAM grant. Fifteen selected tests passed; sampled disk plus RSS peaked at 1,483,329,408 bytes and realtime ownership was 36.654 seconds. Parent checked nine indexed evidence files, 144 tested inputs and current owned cleanup. Continuous detached-process peak remains unproven. Route source was reviewed, published and integrated; original rendered/connected acceptance remains open. No framework patch, redundant suite or OneDrive access was introduced.
- **Publication:** a GitHub connection reset and advancing peer commits delayed parent pushes. Normal helper pull/merge/retry succeeded, preserving peer changes and security hooks. The actual new F446 checkpoint published successfully; this mitigates the earlier optional-ref push delay without establishing its hook root cause.

## 2026-11-16 · Russell Claude Code · DL-20261116-RG-001 · unparented Jira items: fix applied

- **Issue/evidence:** 205 FUCQ items were created with no parent between 7 and 14 Nov, from both pollers, a Codex
  batch and the bulk review intake. Cause: the shared skills never said to set `parent` when creating a Story, Task
  or Bug. See [the diagnosis](epic-parenting-diagnosis-2026-11-16.md).
- **Action:** agent-scaffolding 0.7.6 (`7e5e656`). Every create passes `parent`. A Bug's parent is its origin
  Story's Epic. A Bug with an unknown origin goes under the Epic of the work it was found in, labelled
  `origin-unknown`. FUCQ has no `triage_epic` (Russell, 16 Nov): a Bug with no home is reported for a person to
  place. `jira_sync.py` 1.4.0 reports `unparented` on every pull and adds `audit --check`. Pollers run it when
  anything is unparented, and at least daily.
- **Outcome:** a proposed fix that is now applied and tested, but not yet a verified resolution. The audit is clean
  on today's FUCQ. On the state before the clean-up, it flagged 177 of 180 orphans (the other 3 are exempt).
  Whether new items now arrive parented is unproven until the pollers run the new rules.

## 2026-11-16 11:40 UTC · GC Codex · DL-20261114-GC-001 · recurrence / mitigation applied

- **Evidence/impact:** a current-root Account investigation proposed independent handoff composition, but the original worker already held that source in unpublished `fa4996cd53766085a2f2950590954a641fce4f5f`, dated14November10:20UTC. Its own delivery appendix explicitly says prepared/unvalidated, awaiting dispatcher runtime release. Checking only published source missed the retained checkpoint and risked duplicate implementation.
- **Action/outcome:** parent inspected the idle clean owned branch, preserved the checkpoint, normally merged current published base without conflicts, and resumed the same lead for bounded validation/correction with source, selected checks and owned local resources released together. App evidence confirms current execution. No duplicate writer, new claim or completed validation is inferred. The earlier fast-forward safely refused because the retained commit diverged; no work was discarded.
- **Framework follow-up:** reconcile unpublished owned commits and outstanding runtime releases before another readiness investigation. Associate current source identity, pending next action and original worker with the claim. This is a scheduling mitigation, not yet a verified delivery resolution.

## 2026-11-16 11:40 UTC · GC Codex · DL-20261114-GC-002 · connected readiness gap identified

- **Evidence/impact:** the frozen inventory includes manual draft/discard/stock/quote/review-details and brief preview/change-after-decline routes, but current published Java resource/source inspection finds no corresponding registrations at `da53e8f4d`. Backend F458/F463/F468 remain native In Review; a rendered Account and that tracker status do not establish connected journey coverage. Details: [source gap record](manual-java-contract-gaps-2026-11-16.md).
- **Action/outcome:** preserved native statuses and original contracts; coordinated the precise producer gaps with the Java lane through F434 comment3629579. Reused independent existing Account work against the present order producers. Source inspection alone establishes neither executed failure nor defect severity, producer repair or acceptance. No new Bug or scope was created by this observation.
- **Framework follow-up:** link migrated route inventory to actual consumer/producer composition evidence before describing a journey as connected. Keep native review status separate from execution and original integration-proof obligations; no generic new acceptance campaign is introduced.

## 2026-11-16 11:45 UTC · GC Codex · DL-20261116-GC-004 · intake guard verified locally

- **Evidence/action:** this pass's compact Jira search omitted description/reporter/parent/issuelinks despite the requested field list. The local adapter refused all66 before invoking the importer, preventing the earlier missing-field rewrite. The rejected projection is retained locally; repeating the read with explicit `view: full` supplied every required field.
- **Outcome/limits:** complete-projection import succeeded with zero changes/failures/unparented items. Require the full response view and validate returned fields, rather than trusting request fields alone. This verifies the local guard for this rejection, not a shared connector/parser repair or additional application validation.

## 2026-11-16 11:53 UTC · GC Codex · DL-20261114-GC-001 · recovered checkpoint delivered

- **Evidence/outcome:** retained Account source `fa4996cd` was validated by the same lead:56/56 selected Account/preferences checks, no application correction. Frozen `6216010d` was independently audited, published and integrated/pushed into `gcsp-poc-dev` at `094c4d72fc7bd6cb4eadc636bae953d18e223607`. All61 tested input hashes match the integrated source; both original acceptance criteria remain unchecked.
- **Resolution boundary:** recovery and delivery of this missed checkpoint are verified. The wider scheduling issue is not closed: rendered and real Java/OIDC/PostgreSQL/hosted proof remain unrun. Preserve original workers, unpublished source identity and pending runtime action at dispatch boundaries to prevent duplicate work.

## 2026-11-16 11:53 UTC · GC Codex · DL-20261114-GC-009 · local owned validation verified, historical limits retained

- **Failure/mitigation:** first Account harness attempt stopped before Angular when dependency metadata inspection rejected existing `.bin` links; its final process discovery also observed transient `ps`. Launcher corrected metadata inspection to lstat without following links and audited after discovery joined; original failure retained. No product defect established.
- **Observed outcome:** second attempt56/56 passed. Parent verified current23,008 borrowed file hashes/identities,25,442 metadata entries and Node unchanged, and both attempts' owned process/group/scratch/link/token absence. Current35.768s dual-clock ownership and conservative1,506,509,952byte inclusive bound satisfy the release; full retained evidence is below2MiB. Sampled peaks do not establish continuous containment or repair historical resource failures.
- **Framework follow-up:** distinguish metadata links from copied source inputs; join discovery before final identity checks and charge the whole retained evidence root. These are local harness mitigations, not a shared framework implementation or OneDrive audit.

## 2026-11-16 12:01 UTC · GC Codex · DL-20261114-GC-002 · response projection gap confirmed

- **Evidence:** after F467 integration at `2ad99f0f79be76dc72915a9e488b244a2562727a`, Angular exact-offer/reason reads still send runId queries rejected by Java. Beyond that URL mismatch, successful OfferAccess→OfferView output lacks runId/clockVersion and the richer original quote/comparison structure required by the existing Angular projection validator. Source locations and observed limits are recorded in [the offer composition note](fucq445-integration-blocker-2026-11-14.md).
- **Impact/action:** URL-only repair would still fail the consumer contract. Keep F445 blocked on its original authoritative read/decision composition; preserve native review statuses and existing Java ownership. No runtime reproduction, weakened validator, fabricated source fact, new acceptance gate, Bug severity or producer repair is claimed.
- **Framework follow-up:** readiness evidence must trace the emitted success body through the actual consumer validator as well as matching route names. Native In Review and a matching endpoint do not establish composition. This refines the diagnosis; no delivery resolution is verified.

## 2026-11-16 12:22 UTC · GC Codex · DL-20261114-GC-001 · continuation supervision uncertain

- **Evidence/impact:** a successor acknowledgement was observed, but after roughly15minutes no subsequent implementation result or addressable session/transcript handle was available to this dispatcher. The last source observation at12:19 was unchanged. Acknowledgement alone cannot distinguish current execution, a legitimate wait or a stopped session.
- **Action/outcome:** retained execution as unverified and requested a checkpoint and usable supervision handle through the existing local handoff. No stop, replacement, duplicate writer or test replay was inferred from silence. The managed stall check could not be targeted; its verdict and delivery remain unverified.
- **Framework follow-up:** handoffs should retain an addressable successor identity, next action and evidence time alongside the branch/checkpoint. Verify that supervision can resume after handoff; an active label or accepted brief alone is not that evidence. This is a coordination mitigation, not a verified delivery resolution or new Story gate.

## 2026-11-16 12:26 UTC · GC Codex · DL-20261114-GC-001 · supervision restored locally

- **Evidence/diagnosis:** targeted discovery within the Java worktree's local harness project found the successor transcript. Managed checks returned ALIVE for both the session and its implementer, with activity2seconds and12seconds before inspection. The coordination status was stale; silence there did not establish a stopped worker.
- **Action/outcome:** retained the supervision handle locally and left the live workers alone. Current execution is now verified at this observation, while implementation, selected-test results, resource receipts and Story acceptance remain unproven. No replacement, duplicate writer or test replay was needed.
- **Framework follow-up:** retain the addressable harness identity with handoff evidence, and distinguish status-file freshness from actual harness activity. Local supervision recovery is verified; route delivery and the wider scheduling issue are not resolved by this check.

## 2026-11-16 12:37 UTC · GC Codex · DL-20261116-GC-008 · transient read recovered

- **Evidence/impact:** the F434 full comments-page read failed once with `MCP -32001: mcp-remote: fetch failed`; the independent full66 Jira snapshot succeeded. The failed read briefly left coordination freshness unverified, without changing Jira or claims.
- **Action/outcome:** one read retry returned the complete final page, total60/latest3629579, unchanged. This read recovered; the transport cause and any lasting connector repair remain unverified. No application test or additional Story gate was introduced.
- **Framework follow-up:** retain failed-read diagnostics and freshness separately; use one bounded retry for a transient read, and label old coordination evidence when recovery fails.

## 2026-11-16 12:43 UTC · GC Codex · DL-20261114-GC-001 · parent observation uncertain, implementer live

- **Evidence/diagnosis:** the managed parent check now returns UNSURE after16minutes quiet with nothing pending recorded; its implementer independently returns ALIVE with fresh activity. This supersedes the earlier both-ALIVE observation for the parent only. A parent stall or stopped implementer is not established.
- **Action/outcome:** follow the existing UNSURE procedure: wait one dispatcher interval and recheck. Leave the live implementer and its source alone; no message, stop, replacement, duplicate or test replay. Current implementation execution is confirmed through the child; parent execution, first-slice delivery and resource/test receipts remain unverified.
- **Framework follow-up:** preserve per-agent verdicts in supervision summaries and distinguish child activity from parent transcript freshness. This is an observation change, not a verified scheduling or delivery resolution.

## 2026-11-16 12:49 UTC · GC Codex · DL-20261114-GC-009 · capacity admission stopped

- **Evidence/impact:** the managed capacity check reports `can_start=0 running=2: 9.1 GB of swap in use (stop at 9 GB)`. This prevents new worker admission; it does not identify a responsible process or prove a Story failure. The existing Java implementer remains independently ALIVE.
- **Action/outcome:** no new claim, worker or parent test/runtime allocation. Retain owned work and receipts; no foreign cleanup or OneDrive access. Resource pressure is observed, while its cause, recovery and any delivery impact beyond admission remain unverified.
- **Framework follow-up:** retain the capacity tool's reason as well as its count; pressure responses may report swap rather than the normal free-memory format. Do not discard that evidence or infer authority to stop foreign work.

## 2026-11-16 13:01 UTC · GC Codex · DL-20261114-GC-009 · positive admission snapshot observed

- **Evidence/change:** after the earlier swap admission stop, the managed capacity check reports `can_start=2 running=2: 6.1 GB free less 3 GB reserve leaves room for 2 at 1.5 GB each`. Two slots remain below the three required for a new Story lead, so no new claim or allocation was made.
- **Outcome/limits:** this is a recovered positive admission snapshot; its cause, lasting recovery, cleanup and delivery resolution remain unverified. The Java parent remains UNSURE while its implementer is independently ALIVE; leave the live implementer alone, with no interruption or duplicate. No OneDrive access or foreign cleanup.
- **Framework follow-up:** preserve the time and admission reason across pressure changes; a positive sample alone does not close a resource or delivery issue.

## 2026-11-16 13:04 UTC · GC Codex · DL-20261114-GC-009 · admission stop recurred

- **Evidence/impact:** the closing check reports `can_start=0 running=2: 9.4 GB of swap in use (stop at 9 GB)`, superseding the 13:01 positive sample for current admission. Recovery was not sustained across these observations; the responsible process and underlying cause remain unknown.
- **Action/outcome:** no new claim, worker or parent runtime was allocated. Preserve existing owned work and leave the live Java implementer undisturbed. New Java test source files are visible, but no frozen slice, executed test result or resource receipt has returned. No foreign cleanup or OneDrive access.
- **Framework follow-up:** report the closing admission state alongside transient recovery; do not convert a short positive sample or new test files into a resolved resource issue or validated delivery.

## 2026-11-16 13:06 UTC · GC Codex · DL-20261114-GC-001 · returned slice under active parent review

- **Evidence/change:** the managed parent check now returns ALIVE (activity ten seconds before inspection), and the session check finds no unfinished subagent. The parent transcript at 13:05:19 UTC reports that Donald Duck returned slice 1 and that diff review has started. This supersedes the earlier parent-UNSURE/child-ALIVE observation.
- **Action/outcome:** leave the active owning parent to review its returned manual draft/discard slice; no interruption, duplicate writer or dispatcher test replay. No frozen source, test/resource receipt, publication or original Story acceptance has yet been independently reviewed by this dispatcher. Native backend In Review statuses remain unchanged; new-worker admission still reports zero at 9.4 GB swap.
- **Framework follow-up:** a quiet parent with a live child can resume normally when the child returns. Preserve per-agent supervision and result provenance; neither a child return nor an active review establishes validated delivery. This confirms a normal handoff observation, not a wider scheduling or resource resolution.

## 2026-11-16 13:11 UTC · GC Codex · DL-20261114-GC-001 / DL-20261114-GC-002 · first Java route slice delivered

- **Evidence/outcome:** Claude reviewed and published manual draft GET/POST and discard source `b4ed8d3a329391fec4086a017d3f08e28313b94a`. The normal helper pull fast-forwarded shared `gcsp-poc-dev` to `637a0ccd27984f9965877730a4807babc82b7e8e`; parent verified the source is an ancestor, all 14 changed paths fit the account/test/unique-migration allocation, and current Java content matches that checkpoint. A concurrent documentation push briefly required the owning session to merge and retry publication; both histories were retained.
- **Validation boundary:** the recorded ten selected classes total 69 passes, zero failures/errors/skips; XML report times fall within the recorded 13:04 regression run. Its receipt reports 33.9 seconds on both clocks, 831,619,072-byte sampled RSS, 211,825,024-byte scratch, scratch removed and reservation released. Dispatcher read these receipts without a replay; no independent current cleanup or continuous aggregate peak audit is claimed. The retained 27,178,272-byte target cache is outside the reported scratch peak; no tested-source hash manifest was provided. Extra stale report lines are excluded from the selected count.
- **Remaining work/action:** this delivers the first route-registration increment, not connected Angular/hosted acceptance or an entire Story. Preserve native In Review and all original criteria. Stock/selection and later route slices remain; the owner records capacity zero/9.4 GB swap and has not started the next implementer. No duplicate, new claim, dispatcher runtime or OneDrive access.
- **Framework follow-up:** retain frozen source, selected fresh report identity and explicit resource-proof limits with each returned increment. Separate publication recovery, partial route delivery and original integration acceptance; do not infer a full journey from this checkpoint.

## 2026-11-16 13:14 UTC · GC Codex · DL-20261114-GC-001 · retained reports inflated returned class count

- **Evidence/cause:** the Java owner's 13:10 final summary describes 13 classes in the latest run. The recorded invocation selects ten classes; their 69 passing XML results fall within that run. DefaultProfileTest (9), ClaimLifecycleTest (23) and ManualClaimsHttpNoDatabaseTest (1) have earlier report times. The local runner prints every retained Surefire text report, including those three, from its persistent target cache.
- **Action/outcome:** retain only the ten fresh selected classes/69 passes as evidence for this run. The other 33 assertions remain earlier evidence; no failure or fresh execution is inferred. No test replay, product change, new acceptance gate or interruption of the ALIVE owning session. First-slice Java source is unchanged; next implementation remains capacity-held.
- **Framework follow-up:** return selected report identities and observation times with a chunk, rather than counting all files in a retained report directory. Diagnosis and reporting mitigation are verified here; the runner has not been repaired, and tested-source hash/current cleanup/continuous aggregate limits remain as recorded.
