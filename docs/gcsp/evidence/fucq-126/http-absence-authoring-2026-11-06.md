# Narrow scratch-absence authoring repair

6 November 2026. **Author-only; HOLD retained; shared helper unapplied.**

Beaky Buzzard's independent static review of `8ca2162` identified one concrete MAJOR:
the proposed `_resources_absent` used `os.path.lexists`, whose false result did not distinguish
missing scratch from failed lookup. The local review receipt remains ignored under
`.claude/test-runs/ownership/fucq126-repair-static-review-1016.json`; it was read without
copying the raw report into product evidence. No other blocking/major authored finding was
reported in that review scope.

The generator and [replacement patch](shared-resource-contract-review-repair-2026-11-06.patch)
now use explicit `lstat`. An existing root retains its charge. Only FileNotFoundError can
proceed, and its parent must itself resolve successfully to a directory. Missing, inaccessible,
invalid, I/O-failed or symlink parents retain the charge, as do every other root lookup error.
The existing owner, strict ledger/lock/schema, child and pending-launch gates are unchanged.
No shared helper was applied or imported.

The helper base remains
`3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d`.
The [patch receipt](shared-resource-contract-review-repair-2026-11-06.json) records the new
patch/result hashes and retained prior review pins. The [replacement freeze](http-physical-candidate-review-repair-2026-11-06.json)
updates only the three affected input pins, patch/result references and follow-up review metadata.
Dependency pins are carried forward; no collector or dependency revalidation was run.

Validation for this delta is static text/hash/Git metadata: exact patch reconstruction in memory,
comparison with the reviewed previous result, matching generator text, metadata binding and
whitespace. The generator, proposed helper, AST/syntax checks, tests, runtime, process/ledger
probes and collectors were not executed. The earlier 2,216-check receipt belongs to `8ca2162`;
it is not new validation of these bytes.

Both execution flags remain false, outputRoot and adoptedHelperSha256 remain null, and all
existing adoption, generic run_process and older-writer rollout gates remain. The C5 proposal,
accepted controller/browser evidence, story states, worker/Jira observations and known untracked
dependency symlinks are preserved. The [follow-up receipt](http-absence-authoring-2026-11-06.json)
contains the exact current pins and validation scope.
