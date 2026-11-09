# macOS process timestamp padding repair proposal

6 November 2026. Authorised read-only diagnosis and minimal owned parser repair,
following the failed single grant. Original actual failure/receipt is published
at `fbff6ae357dacc1b7b18e06be9132a8e77ef4fc7`; it remains unchanged. This proposal
has not run the repaired live probe or any activation/test/resource allocation.

One bounded synchronous read-only query used the exact frozen ps field selection
and the same allowlisted C-locale environment. It returned0 with no stderr:
662 rows/39,059 bytes. The original validator rejected all662 only at the final
start-time shape check. The command prints no command arguments or environment
values. The retained evidence contains counts and at most20 rejected metadata
rows (PID/PPID/PGID/RSS/state/start), not a process-argument/environment inventory.

Concrete cause: macOS pads its final `lstart` column with spaces. The parser used
`line.split(None,5)`, so its sixth field preserved those spaces. Its date regex
used `fullmatch`, rejecting an otherwise valid timestamp. All20 retained samples
fail the unchanged regex before trimming and pass it after outer whitespace is
trimmed. This passive comparison uses saved metadata; it is not a repaired live
probe or lifecycle test. No claim is made for an unretained full-snapshot replay.
`fucq115-activation-os-diagnosis.json` contains three representative original
metadata rows and exact hashes/paths for the20-sample diagnosis and original run.

The only executable source delta is four added lines in the owned
`fucq115-activation-resources.py`: strip the outer padding of the sixth field
before both partial and complete identity validation. This agrees with the
existing per-PID helper's `stdout.strip()` identity representation. The PID,
PPID, PGID, RSS, state, timestamp-format and complete-query checks stay strict.
Malformed/error/timeout/unknown snapshots still refuse; unknown observations,
strict ledger checks, recursive stop/join and absence-before-delete/release are
unchanged. Shared helpers, supervisor, launcher, activation entry, all77 immutable
source rows/217edges, source catalogue, artifact, training/evaluation/settings
and installed executables/dependencies are unchanged.

The new stdlib metadata freeze differs from c4667c21 in exactly one of204
physical/content identities: the owned resource helper. All138 installed files,
14 package manifests/edges and37 missing-resolution probes are identical. The
original c4667c21 admission is also copied byte-identically into the failed run's
owned external evidence directory, for independent audit.

| Current review file | SHA-256 |
| --- | --- |
| `fucq115-activation-admission.json` | `1fc1376aadeaa5e6652bf923356ae457074ae43697750f819ddb31934b55c9d9` |
| `fucq115-activation-resources.py` | `362b879cbb29da02ffb4fae8bc641b98bee95ac3ba29cd8b52514b2657684c41` |
| `fucq115-activation-supervisor.py` | `1e5a0811b8cad6cf449905f72c1da49c59d9f6f486c95c791e40b3d496deefe9` |
| `fucq115-activation-freeze.py` | `28ad3a2fa5af1a8a6fa37244dfa15481c7fe1dfa5725f032d7f45b69c9e0b192` |
| `fucq115-activation-launch.mjs` | `e257c85510f7559f5aa4e0231ff2b8034bd80a111e833c1b877656927c7d270b` |
| `fucq115-activation-run.mjs` | `bb7bf38bb1a93ab962123fd91aeb3d04484971e735c8cca1e1f16dd943e7bed9` |
| `fucq115-activation-source-plan.json` | `f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa` |

Proposed exact command after independent review and a new concrete grant:

```text
/usr/bin/python3 -I -B docs/gcsp/models/fucq115-activation-supervisor.py --execute --admission-sha 1fc1376aadeaa5e6652bf923356ae457074ae43697750f819ddb31934b55c9d9 --dispatcher-grant GRANT
```

Author-only validation: Python AST/static symbol analysis, exact one-row frozen
identity delta, unchanged source/entry/artifact checks and the new frozen `--plan`
passed. The plan imports helpers only after204 identity/37 absence admission and
checks all77 source hashes; it launches no Node, OS lifecycle proof or resource
allocation. There was one authorised read-only diagnosis query and passive saved-
metadata comparison; no renewed actual attempt, test suite or repaired lifecycle
run. Actual activation and final scoped/full integration remain open. Original
adverse Brier scores, iteration-limit and thin synthetic fixture limits remain.
