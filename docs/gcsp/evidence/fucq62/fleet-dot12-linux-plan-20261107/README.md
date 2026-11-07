# Minimal .12 Linux workflow proposal

Prepared only, in a separate packet from the executing cold plan. No source, runtime, tests, network, deployment or GET execution is authorized by these files. Root applies `ci.patch` after the actual cold/offline/recovery evidence is reviewed. The root-before and proposed-after hashes are in plan.json.

The proposal starts with the actual root .10 workflow and preserves its phase_start, phase_done and cleanup failure-evidence diagnostics byte for byte. Changes are limited to the exact .12 release and helper path, 31-asset/10,002-reference historical labels, retained 2,707 consumer failures, the124fetch bound,512MiB Node heap,2GiB scratch budget and bounded timeouts. Selected phase ceilings total570seconds inside the existing ten-minute job: npm90, download240, offline90, asset readback30 and boundary120. There is one worker; the original inode-independent fresh CI path manifest, bounded log snippets and teardown remain.

The Linux job downloads31exact assets, runs a fresh offline CLI process, verifies cache/restored bytes, and exercises five actual .12 DTO/HTTP/consumer references, including two known consumer failures. The full10,002 historical proof is not replayed. Helper files are consumed unchanged from fleet-dot12-10000-restore-plan; its frozen plan and all runtime/source/native pins remain untouched.

CI's ephemeral runner cache/store is active build working data with an explicit cleanup trap; it creates no archive. Actual runner allocation and physical absence must be read from the job logs. A proposed budget or passing static check is not an observed Linux result. Native-local PostgreSQL/current-run UUID and order acceptance remain separate; Render's configured managed policy DB can still be an actual deployment build boundary.

Static review checks only: exact root-before, byte-identical diagnostic block, patch application check, helper/cold pins, and no cold-plan changes. Runtime, sources, tests, builds, native work and live GETs are unrun by this agent.
