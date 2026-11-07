# Fleet artifact whole-body deadline correction, 7 November 2026

The exact 190,860,237-byte fifth-asset diagnostic reproduced a default 30-second abort after receiving 190,003,815 bytes. The controller fired at 30,002.292 ms, and the body threw AbortError; the 35-second diagnostic cap did not fire. This independently reproduces the suspected cold failure boundary; the original CLI masked its exception and remains recorded as a failed attempt.

`downloadAsset` now permits 120 seconds for the complete transfer. The timer still encloses redirects, streaming, hash verification and file sync; exact approved URLs, byte/hash bounds, exclusive destinations and partial-file cleanup are unchanged. Explicit caller deadlines remain supported. This is a deployment build blocker; it does not add Story acceptance scope.

The new two-byte virtual-time regression failed before the change (one passed, one failed), then passed both cases after it: a body may finish after 30 seconds under the default; an explicit 30-second deadline still aborts and removes the partial file. The selected artifact, build-entry and Render blueprint boundary run passed 17 tests, zero failures/skips, in 0.504 seconds of supervised child time. Full suite, native PostgreSQL, source APIs, live application and new cold restore were excluded: the implementation only changes this artifact transfer deadline. These are scoped results, not Story completion.

Each run established external ownership and a finalizer before scratch or its owned dependency symlink. All child groups, reservations, scratch paths and the temporary `server/node_modules` link are physically absent; installed vendor data was borrowed in place. The three runs sampled 64 bytes of aggregate scratch peaks; useful concise results are retained here, logs/checkpoints in `.claude/f58-63-overnight-20261106/f62/asset-deadline-*`. No large generated files, compatibility exception or disposable leftovers.

Fresh cold/offline/recovery and Linux/deployment evidence remain required; the previous frozen failed plan is preserved. The separate 10,000-VIN and qualified profile gaps are unchanged.
