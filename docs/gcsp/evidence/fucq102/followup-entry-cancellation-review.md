# Child creation and registration cancellation repair

6 November 2026. **Authored and statically reviewed only.** No supervisor, OS proof,
runtime reproduction, test or allocation is authorised or executed by this checkpoint.

Diagnosis: root relayed 107's static review of the inherited 115 pattern. In 102's
published `c6b8534` supervisor, `process = subprocess.Popen(...)` preceded
`tree.register(process)`. A handled SIGTERM/KeyboardInterrupt between those steps
could leave the child only in the local variable, while `tree.process` and the
persisted owned-PID list were empty. The old empty-tree branch could then claim
joined/absent, permitting scratch deletion and reservation release despite that
untracked child. This is source evidence, not a reproduced runtime failure. Root's
scoped accepted 115 run does not establish that it encountered this edge.

Affected writer: the owned supervisor's child creation. Readers: `ProcessTree`'s
registration, stop/join and absence proof; `Finalizer`'s destructive cleanup and
reservation-release gate. The actual application/offer lookup and eleven test
cases are unchanged. No prior 102 follow-up test run exists to invalidate or repeat.

The repair moves creation into the owned tree's `launch()` method. It writes a
`creating` launch intent to the external manifest before invoking `Popen`. Temporary
handlers defer handled SIGTERM and SIGINT through child assignment, PID/start/group
registration and persistence; pending cancellation is recorded, then re-raised after
the original handlers are restored. The OS signal mask remains unchanged for the
child. The tree receives the returned handle before the supervisor's assignment.

Registration retains an unknown PID before its first OS query, preserves any known
start on repeated adoption, rejects conflicting handles/observations, and marks the
launch registered only after observation. `stop_join(process)` can adopt an existing
unregistered handle before attempting cleanup. If identity cannot be established,
the direct owned handle is still stopped/joined by the existing fallback, but the
proof remains incomplete and destructive cleanup/release is refused. An unresolved
creation with no available handle can never pass the empty-tree branch. A proof
with a handle requires matching registered launch state/PID. The supervisor's
`finally` recovers the tree-held handle when cancellation prevents its local
assignment, so it also closes the correct pipes.

Static control-flow review, with future execution evidence still required:

| Interruption boundary | Authored behavior |
|---|---|
| Before launch intent/child creation | Empty-tree success remains valid because no child was launched. |
| After durable intent, before `Popen` returns a handle | Unresolved launch refuses absence/deletion/release; preserve manifest/scratch/reservation if no handle can be recovered. |
| After returned handle assignment to the tree, before PID persistence | Handled signals stay deferred; unexpected exceptions retain the handle for adoption/stop/join or fail closed. |
| During initial PID/start/group observation or manifest persistence | Unknown observations remain recorded; registration or proof failure prevents destructive cleanup. |
| After registration, before assignment in the supervisor | Tree owns the child; `finally` recovers it and runs stop/join plus pipe cleanup. |
| Existing unregistered local handle at cleanup | `stop_join(process)` adopts it before considering absence; conflicting handles refuse success. |

Static checks are Python AST parsing, whitespace review and admission regeneration
from existing physical identities using the stdlib-only authoring freezer. Neither
the resource adapter nor supervisor was imported or run. The unchanged
44-module/122-edge/seven-data/eleven-case application source proposal remains fixed
at source-plan SHA `fd2eb341905bba23414e799bb011c0d415564c0c4ac656a0b0047d82a8111c3a`.
Its implementation remains `754b70c`; new helper/admission hashes are in the next
publication receipt. Root must review this adaptation and issue any later explicit
execution grant. No automatic retry, runtime success, broader lifecycle proof or
story acceptance follows from this repair.
