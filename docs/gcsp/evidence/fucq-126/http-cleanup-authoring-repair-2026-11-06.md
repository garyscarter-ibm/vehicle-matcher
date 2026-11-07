# Cleanup reserve and source-pin repair

6 November 2026. **Source-only; HOLD retained; no execution admission.** Existing FUCQ-126 /
DEV-2026-11-04-096 claim, following published `ee405af10c5c1459cdcbe8591652e2a93c57a820`.

The independent source review is
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/results/claude-assist-fucq126-2026-11-06-02.md`,
SHA256 `bcaddfcfbd0b9d3430d9c8f770b376a70115b87edfec94436f5735b541a70a08`.
Reviewer **Granny**, `claude-opus-5-5`, reported **LOW effort**, verdict **HOLD** with N1 MAJOR.
Its trace passes are scoped static observations, not a high-tier PASS or runtime evidence.

## Diagnosis and authored repair

| Finding | Source response; unexecuted |
| --- | --- |
| N1 MAJOR | Work queries stop at 768 of the finite total 1,024, reserving at least 256 for cleanup. A monotone cleanup transition occurs before stop/proof and finalization. Work RSS/listener sampling runs at most once per 0.5 seconds; capped TAP draining remains responsive. Emergency group stopping no longer depends on an available `ps` query. |
| N2 MINOR | The first identify/register/body/observation failure is retained explicitly. Full-charge update and guard/cleanup failures are recorded separately and do not replace it. No success is inferred from failed telemetry. |
| N3 MINOR | The emergency direct/group kill attempt precedes any deadline-dependent wait. Waits use the remaining absolute deadline, including a zero-time join attempt after expiry. Probe cleanup also attempts kill even when no wait budget remains. Unproved joins retain an issue and block deletion/release. |
| N4 MINOR | The new candidate is explicitly a **manual source-pin revision**, carrying forward previous dependency/graph records. The preparation source is **reference-only, not a reproducer of this candidate**, and now names a separate recollection destination. It was not executed. No physical regeneration or reproducibility claim is made. |
| N5 MINOR, unverified | The host's `ps` output size/latency remains unmeasured. Future query journals record byte counts and elapsed duration without raw output; locale values/hashes are included in the future receipt. Admission still requires one explicitly admitted bounded measurement. The 2 MiB cap is not claimed sufficient on this host. |

## Group-signal authority and remaining uncertainty

The emergency path retains the actual Popen handle and defers handled cancellation. It requires
the main thread and default SIGCHLD behavior, then calls `waitpid` for that exact child with
WNOHANG. A zero result proves the child is still owned and unreaped. With no intervening wait or
reaper, its PID cannot be reused before the fresh `getpgid` and `getsid` checks. Both must equal
the admitted new-session leader PID, and the group must differ from the supervisor's group.
Only then may it signal that group with SIGKILL, before any joining wait or process query.

If `waitpid` instead reaps an already exited child, its status is transferred to the Popen handle;
the numeric group is not signaled. Reaped leaders, changed groups/sessions, nondefault reapers,
missing authority and unknown descendants never authorize a stored-PGID kill. The existing
fresh PID/start descendant path and absence proofs remain required. Any unresolved ownership,
exhausted cleanup allowance, failed query or unproved join retains scratch/charge and a named issue.
The emergency path does not prove a descendant escaped into an unknown session absent.

The shared seven-key ALL-row ledger, no pruning, exact owner-start spacing, no-follow bounded
locked reads, foreign-row preservation/readback, full RAM reservation and open-file/inode/definite
scratch-absence release gates remain. `_tools/test_resources.py` stays at
`3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d`.
No shared-helper patch or fleet rollout was applied. A5 dead-owner reaping by other launchers and
A6 generic `run_process` registration remain open outside this route.

## Current review inputs and proof limits

Review the wrapper/supervisor diff from `ee405af`, the reference-only preparation label,
[new candidate](http-physical-candidate-cleanup-repair-2026-11-06.json) and
[exact authoring receipt](http-cleanup-authoring-repair-2026-11-06.json).
The six case names, harness, transport helper, cancellation guard, product graph, 29 static sites,
1,975 dependency records and business/visual boundaries are carried forward unchanged. Dependency
pins and physical memberships are not freshly revalidated. Prior 2,216/root936 evidence retains
its original bytes and scope. Earlier Granny review does not review these replacement bytes.

Only ordinary source/text edits, hashes, JSON and Git metadata/whitespace checks are authorized
and performed. No reviewed-code import, syntax/AST check, helper execution, runtime test,
process/RSS/lsof/ledger probe, listener, browser, native/live/full allocation, credential access,
shared merge, Jira write or foreign file change occurred. The reference preparation source was
not run. Both execution flags remain false; outputRoot and physical host anchors remain null.
Product UI bytes are unchanged, so this resource-only repair makes no new visual acceptance claim;
the agreed shell, FUCQ-64 body, COMPONENTS.md and experience contract remain binding.

## Bounded next validation proposal — no grant implied

1. Independent source review at the authoritative current reviewer tier of the N1–N4 diff, group
   authority, primary failure retention and exact candidate/pins. Record the actual requested and
   selected model/effort, capacity result and verdict; do not upgrade Granny's LOW provenance.
2. If separately admitted, one worker with an owned **private ledger/lock**, shell child and
   grandchild. Four lifecycle cases: normal exit, shortened 8-second work/12-second whole hang,
   cancellation during a query, and exhausted work-query allowance. At most 20 seconds per case,
   32 MiB scratch, 64 MiB RAM and 1 MiB logs, with external ownership/checkpoint and independent
   descendant/group/open-file/scratch/reservation audit. Include registration/telemetry failure
   masking, expired-deadline kill, reaped/reused-PID refusal and unresolved-ownership retention.
   Stop and join only proven owned resources; retain uncertainty for reconciliation.
3. Only after that admission/review, collect fresh strict ALL-row host/lock anchors, locale and
   bounded `ps` byte/latency evidence, and an external output/impact/ownership plan for the same
   six HTTP cases. Retain 120/90/30 seconds, 768 MiB RAM, 128 MiB combined disk, 2 MiB TAP and
   one worker; require original TAP 6/6, actual V8 modules, exact source identity and root cleanup.

C5, positive new-run supply, six business preparations, paused96 and browser/native/full gates
remain unchanged. This checkpoint neither claims runtime safety nor starts any later validation.
