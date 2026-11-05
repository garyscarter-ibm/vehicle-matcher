# PostgreSQL work handoff to Gary — 5 November 2026

Russell asked Gary's sessions to take work requiring the PostgreSQL credential, which is already on Gary's machine. Keep the credential there; use the existing private backend configuration. This supersedes requests to supply a database URL or key to Russell's machine.

## Ready for Gary to claim

| Jira | Story | Published branch | Published checkpoint |
|---|---|---|---|
| FUCQ-83 | DEV-2026-11-04-065 | `dev/DEV-2026-11-04-065` | `e3d19dc0d8658c41d7db88a278d316dfc4d999af` |
| FUCQ-66 | DEV-2026-11-04-069 | `dev/DEV-2026-11-04-069` | `d645f581d2c9c166ea4112d871beb65ff5269aa0` |

These existing stories are requeued for **`garyscarter-ibm` only**, retaining their IDs, acceptance, dependencies, 13-point estimates and unmerged implementation. Russell's pollers must not reclaim them. The normal remote lease decides which of Gary's Claude/Codex pollers owns each one. A Jira assignment is routing, not evidence Gary has claimed or started work.

This is an explicitly authorised transfer of existing stories, not new story intake. Scaffolding has no transfer/requeue command: the source dispatcher moves only its own two lifecycle files back to the inbox, commits/pushes the named paths and releases only its own leases using `claim-release`. It preserves both published branches and local worktrees. Claim and queue state remain authoritative; this document is a handoff record.

## Pickup without losing the implementation

1. Pull `gcsp-poc`; read current `AGENTS.md`, the GCSP index, build rules, experience contract, story and Jira comments. Honour the working-demo-first direction: no human layout-review pause; concise product copy, existing components and ratchet still apply.
2. On Gary's machine, claim each story normally with `SCAFFOLDING_HARNESS=<actual harness> python3 -B _tools/scaffold_git.py claim --id <id> --points 13`. If still leased, wait for the source release. Never impersonate a member or remove another host's lease.
3. **Reuse the published branch above.** The wrapper's ordinary `worktree --id` starts from the base and would omit this implementation. Fetch that exact dev branch through the wrapper, then reuse/create its worktree from `origin/dev/<id>` using imported `scaffold_git.git` under `checkout_mutex`, with normal identity/path/branch checks. Do not reset an existing worktree, overwrite work, recreate from base, delete the unmerged branch or force-push.
4. Integrate the current base/claim metadata into the retained branch through the wrapper/imported API under its mutex. Preserve both sides; refresh the Result's historical ownership/configuration statements. Reassess validation for the integrated code and configured target. Gary's dispatcher owns subsequent integration, Jira updates and closure.
5. Use the existing approved managed PostgreSQL target privately. Do not provision a substitute, put the URL/key in command arguments, logs, evidence, Jira or Git, or pass it between machines. Restrict proof to owned synthetic run/schema data and verify its cleanup.

FUCQ-83 can run first; coordinate shared repository/policy integration before FUCQ-66. Serialize merges and full suites. Establish a proportionate test plan, impact evidence, owned scratch/manifest/finalizer and cross-app resource reservation before running checks. Reuse matching proof; configured-provider skips leave acceptance incomplete.

## Remaining acceptance and retained evidence

**FUCQ-83:** the Result and `docs/gcsp/evidence/fucq83/` are on its branch. Offline checkpoint: 874 tests, 870 passed, four native SQL skips, zero failures; this is historical evidence for that frozen code/environment. Run the real configured `gcsp-policy-versions.test.js`, unchanged `gcsp-policy-service.test.js` and repository boundary checks. Prove native migration/seed/reseed/reopen, immutable dated rows, active/future and pinned reads, publish/rollback/replay/race and provider parity. Retain target identity without secrets and isolated-schema cleanup. Reassess the prescribed `npm test` after base integration; no completion from doubles/skips.

**FUCQ-66:** the Result and `docs/gcsp/evidence/fucq-6/` are on its branch. Offline checkpoint: 756 tests, 754 passed, two native SQL skips, zero failures; this is historical evidence for that frozen code/environment. Run the configured `gcsp-repository-contract.test.js` and manual-claim regression/boundaries. Prove real persistence across repository/process reopen, rollback, independent-session exact-car uniqueness/native constraints and persisted release/expiry/allocation behaviour. Reassess the prescribed `npm test` after integration. Preserve the shared repository, policy, identity and clock ports; infrastructure provisioning is outside this story.

## Later database gates

Route any later checkpoint requiring the actual PostgreSQL credential to Gary's sessions through the same shared handoff and normal claim workflow. Continue disjoint source/offline work locally until a coherent checkpoint is ready; publish it before transferring its claim. Do not transfer unfinished dirty branches or duplicate a live owner. FUCQ-71/92/96 currently retain local source/validation work; their native integration checkpoints follow this routing when ready. Other source/provider and email gates remain separate.

No application code or acceptance was changed for this handoff. Verification is lifecycle/branch identity, story validation, whitespace, remote lease and Jira read-back; no application suite is selected for routing metadata.
