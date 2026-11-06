# FUCQ-103 owned harness repair, 6 November 2026

Earlier sections record authoring at their original revisions. The latest listener correction below
and the two immutable core25 attempt receipts provide the current state.

## Diagnosis and scope

Dispatcher review of `f80fc61ca151cb46ad21cb2b19e704f4012d53de` accepted the product/source composition and exact 107 registration, then refused runtime admission because of inherited supervision defects. The reproduced evidence is source inspection, not an executed failure: custom `test_resources` imported before hash admission; the combined plan had no externally admitted digest; inherited loader/native environment families survived; permissive JSON/default ledger/release behavior hid accounting uncertainty; missing process starts or failed queries could look absent; scratch was deleted before explicit absence proof; malformed RSS rows/stderr/empty snapshots were discarded. A subsequent shared review identified handled cancellation between Popen creation and initial ownership persistence.

Only owned harness, catalogue and evidence paths change. Every tracked product/test byte, including `server/`, frontend assets and `_tools/test_resources.py`, remains identical to f80fc61. No new 100 runtime/index/host integration is adopted. No product behavior is changed. The shared helper is read, hashed and used through an owned adapter; it is not patched.

## Authored controls

- Admission uses only the Python standard library until the external SHA matches strict plan JSON and all source, installed dependency, executable and physical accounting-anchor identities match. Three source directory inventories and installed membership are checked. The pinned interpreter requires `-I -B`. Already admitted helper bytes are compiled directly, with no loader reopen. Plan-only imports no custom helpers or application and allocates nothing.
- Execution also requires clean exact HEAD/upstream and a new grant prefixed for the selected eligibility mode. The only executable modes are the nine frozen selections: 77 cases across 11 unique test files. The closed environment allowlist retains USER/LOGNAME/LANG/LC_CTYPE/TZ and fixes the admitted HOME plus PATH/LC_ALL/PYTHONDONTWRITEBYTECODE/SCAFFOLDING_HARNESS. Other inherited loader, native, database and debug families are removed before helpers/children.
- The finite source graph is copied into owned scratch; installed `server/node_modules` is linked inside that mirror only. Worktree dependency resolution must remain absent. The Node gate starts tests only after the leader identity is recorded. Handled SIGINT/SIGTERM are deferred across Popen creation, handle assignment and initial registration, then propagated. Signal masks remain unchanged for the child. Cleanup explicitly retains any returned unregistered handle, marks ownership uncertain and stops/joins that direct child; an empty ownership list is insufficient while a handle exists.
- Process snapshots require numeric PID/PPID/PGID/RSS columns, complete parseable rows, a known supervisor start, successful query status and empty stderr. Explicit unknown starts remain unknown. Incomplete snapshots make ownership uncertainty sticky. Recursive descendants require observed PID/start ancestry or an anchored owned group. Retained numeric group IDs alone never authorise signalling. Known exact owned starts are checked again before signals; direct Popen handles remain owned after query failures. Termination errors cannot skip the direct join attempt.
- Resource accounting requires an existing strict JSON ledger with exact row/owner/accounting shapes and acyclic parents. Duplicate keys, nonstandard constants and missing/corrupt ledgers are refused. There is no default empty ledger or pruning of foreign reservations. Directory/lock device, inode, mode, kind and resolved path are explicit admission inputs; O_NOFOLLOW/fstat and a bounded exclusive-lock wait protect access. Owned write intent precedes ledger mutation and every update/release has strict readback. Owned disk/RAM/parent fields must match; a reservation with dependent children cannot be removed.
- Host emergency disk reserve is 5GiB, host RAM reserve 512MiB, preferred free disk 30GiB. Preferred headroom is an adjustment trigger; these small chunks already use one worker and 128MiB scratch/768MiB RAM/120s/2MiB child-log caps. Sampled aggregate RSS includes the supervisor, recursive owned descendants and direct OS probes present in the snapshot. These checks are supervision contracts, not kernel limits or measured proof.

## Cleanup order and retained evidence

The external ownership manifest and registered finalizer precede reservation, retained-root and scratch allocations. The creation gate is closed during registration. On normal completion, failure or handled cancellation:

1. Stop and join the direct child and recursively observed exact owned descendants; obtain a fresh complete process snapshot and explicit PID/group/observed-port absence proof.
2. Preserve the entire bounded original merged test.log on success and failure, with byte count/SHA-256 and readback, or retain scratch if cleanup is uncertain. Keep exact command/revision/grant/source identity and an incomplete checkpoint.
3. Check scratch device/inode, reject symlinks or changed identity, and require successful open-file absence checks. Refresh process/port proof before deleting only the owned scratch tree.
4. Prove scratch absence, then release only the exact owned reservation under the verified lock. Read back the complete ledger and verify the token is absent.
5. Persist compact manifest/summary/impact evidence with separate 256KiB receipt headroom beyond the 2MiB original-log cap; all scratch and retained output remain within 128MiB combined. Receipt failures remain failures. Pipe close errors cannot bypass the nested finalizer.

Unknown ownership/query/accounting/open-file state preserves scratch and reservation as a named cleanup issue. Missing starts and query errors never prove absence. SIGKILL cannot execute finalizers; any later reconciliation needs independent manifest ownership/process/open-file evidence. No cleanup receipt exists for this repair because no harness has run or allocated resources.

## Static validation and next admission

The new `eligibility-harness-static-audit.json` records source/dependency/executable hashes, three inventories, immutable composition, finite test selections, Python AST checks, product/helper freeze, admission-before-custom-import and cleanup/cancellation source ordering. The old `eligibility-authoring-audit.json` remains unchanged as historical f80fc61 authoring evidence. This audit imports no guard/supervisor/application, executes no tests/browser/native/database/OS proof, and creates no test scratch or reservations.

First propose `eligibility-core` 25 only, then review its exact result and cleanup before a separately granted `eligibility-registry` 16. Both commands in `eligibility-combined-proposal-2026-11-06.md` require this refrozen plan SHA, the reviewed published harness commit and new mode-specific grant. No command has an execution grant here. Stop at the first failed chunk. Other modes, browser preparation, desktop/narrow320 journeys, native integration and full-suite acceptance remain separately gated. Story stays In Progress; rendered integration remains blocked.

Read-only reference: FUCQ-115 `918ce04510fd327e860809e7de53bd636d1cf7da`, resources SHA `2ef0823acaf59764c3c9e0e3cb662f0bd72637f7ee569807c61c537d0b742949`, supervisor SHA `1e5a0811b8cad6cf449905f72c1da49c59d9f6f486c95c791e40b3d496deefe9`. Its ownership design informed review; its parser/source was not adopted. The first 115 attempt stopped before allocation on an OS snapshot. The dispatcher subsequently reported a scoped successful 115 run; that receipt neither validates this 103 harness nor proves the later cancellation edge was exercised.

No new subagents, installs, application imports, test runs, browsers, native/database calls, resource reservations or scratch allocations. Visual product files remain frozen; earlier screen evidence remains tied to its original sources. Apply build-rules, experience-quality, technical-readiness, COMPONENTS and the agreed visual reference at the later integration gates.


## Dibble HOLD of 011325a: second static repair

Source diagnosis, 6 November: (1) `Finalizer.attempted` was set before deferred cancellation handlers were installed, so an interruption could leave attempted true/result null and make atexit skip cleanup; (2) fallback manifest writes preceded direct-child termination/wait, so persistent storage failure could skip joining; (3) the installed inventory skipped symlinks and directories, allowing an unadmitted `pg/node_modules/pg-types` candidate to affect CommonJS resolution. The intended behavior is retryable incomplete entry, mandatory persistence-independent direct joining, and rejection of every unadmitted resolver entry before application imports. No runtime reproduction was authorised or performed.

The follow-up removes the attempted flag. Handler installation has an entry rollback path that leaves `result` unset on interruption; only an outcome after the cleanup/direct-join path is memoized. `Tree.stop_join` now invokes a dedicated direct stop/wait helper from `finally`, and Finalizer has the same last-resort obligation. That helper performs no manifest writes, resource queries or descendant discovery before waiting. Persistent observation/manifest errors retain cleanup failure while still reaching direct-child termination/join.

Both the catalogue and admission code enumerate physical files and directories with lstat/scandir, including empty directories, and reject every symlink or special entry without following it. File membership and hashes remain unchanged. The plan additionally records missing nested node_modules paths, ancestor search paths, absent finite package candidates (directory/.js/.json/.node), and legacy global search locations. An existing external search directory has an admitted physical identity. The finite package-name set comes from unchanged server dependency literal require calls plus application package imports; a source scan found no computed server require target. HOME is fixed to the reviewed resolver home so another inherited home cannot widen lookup. This does not repair or admit the browser supervisor.

Only the three changed owned harness/catalogue pins and their corresponding graph/evidence are refrozen. All251 installed byte hashes, eight executable hashes,219-source membership,432 edges and77 selected cases are preserved. Product/tests remain exact f80fc61. No new100 checkpoint, dependency installation, imported application/guard/supervisor, test/probe/browser/native/database call, reservation or scratch allocation. Static audit assertions inspect the new entry/mandatory-finally ordering and physical dependency/resolver membership; they do not prove runtime cancellation or persistent-write behavior.


## Superseded unconsumed grant: original-log retention contract

The dispatcher statically accepted 45d337af and issued `fucq103-eligibility-core-45d337a-0214`. Preflight source inspection found that the grant required original exact TAP while 45d337af deleted successful output and kept only a 256KiB failure tail. No execution or allocation occurred. The dispatcher superseded the unconsumed grant and authorised this preservation-only helper change; this is a receipt-contract mismatch rather than a new product failure. Existing static module identities satisfy the requested module evidence, so no instrumentation or module journal is introduced.

The existing finalizer callback now retains the full original bounded test.log after stop/join and scratch device/inode proof, on both outcomes. It rejects a nonregular or oversized source, opens without following symlinks, reads and checks the complete source size, reserves receipt headroom before copying, writes an exclusive retained file, fsyncs, and verifies retained size/SHA-256 before deletion can proceed. The result records its exact byte count, SHA-256 and no-truncation status. Live combined byte telemetry includes the retained copy before scratch deletion.

Child stdout/stderr remain merged under the 2MiB cap. Metadata has a separate 256KiB retained receipt allowance; scratch, retained original and records stay within the existing 128MiB combined reservation. If receipt accounting exceeds its bound, the result/checkpoint stays failed/incomplete while preserving the original log. No original is silently shortened for metadata. Unknown retention state fails cleanup and retains scratch/reservation. Resource guard, launcher, product/test code, dependency/resolver and lifecycle checks remain unchanged.

Only supervisor/catalogue pins and their corresponding graph/evidence are refrozen. A replacement exact-revision once grant is required before any core 25 execution. Registry 16, browser, central100, mixed, native and full validation remain ungranted. No run, probe, application/guard/supervisor import, test scratch or reservation was created in this preservation authoring checkpoint.


## Listener framing after the consumed 8bafa39 attempt

The separate 1024MiB grant ran once at 8bafa39 and stopped after 6.961 seconds with
`Malformed listener observation`, within its RAM cap. The original 1,717-byte merged
log has 15 successful case lines and no final 25-case summary. Receipt
`eligibility-core-8bafa39-2026-11-06.json` preserves the originals and 505-check lead
audit; the earlier 8568dae resource-stop receipt is unchanged. The dispatcher also
independently verified cleanup with 34 checks; its receipt path and hash are in the
current static audit. No product assertion failure or complete core25 result is inferred.

Diagnosis: static inspection confirms a listener-parser compatibility defect. The
installed primary manual `/usr/share/man/man8/lsof.8` identifies 4.91 and describes
process sets starting with `p`, file sets starting with `f`, and `f file descriptor (always selected)`.
The admitted `/usr/sbin/lsof` byte stream contains 4.91 version strings. The old
`-Fpn` parser accepted only `p`/`n` and rejected `f`. The raw failed query response was
not retained, so the exact offending field from the consumed attempt is unknown.
The official upstream manual is <https://lsof.readthedocs.io/en/latest/manpage/>;
this diagnosis is grounded in the hashed installed primary manual and pinned binary,
without invoking lsof or opening a listener.

The correction requests `-Fpfn` explicitly and parses owned `pPID`/`fFD`/`nendpoint`
frames with numeric descriptors. Every file requires exactly one endpoint; process/file
transitions reject incomplete frames. Foreign or duplicate PID frames, duplicate
descriptors/names, unknown fields and malformed ports fail closed. Ports remain 1..65535
with 128 unique ports per observation and the existing cumulative 128-port cap. Parser
errors retain an offending-field sample bounded to 128 ASCII characters. Query return/stderr
rules, owned PID binding, port persistence and every other guard AST are unchanged.

`eligibility-listener-parser-fixtures.json` authors 32 parser and six wrapper expectations,
including installed 4.91 framing, multiple owned processes/files, IPv4/IPv6/wildcard
endpoints, duplicate/incomplete/unknown records, invalid ports, caps and diagnostic
bounds. These are source-review design fixtures, not original observations or
executed tests. The static audit parses Python AST and data only; no guard/supervisor
import, lsof probe, listener/reproduction, test/browser/native call, reservation or
scratch allocation occurred. Only the owned resource helper pin changes in both
refrozen plans. Product/tests remain exact f80fc61; supervisor, launcher, catalogue,
all 251 installed and eight executable pins, source membership/edges and all limits
are unchanged. A fresh exact once grant is required after dispatcher review; no retry
or next mode is authorised by this source checkpoint. The browser supervisor remains
unrepaired and unadmitted.
