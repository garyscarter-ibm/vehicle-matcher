# Actual eight-record 1F7B publication, 7 November 2026

Root released exact contract `3b88ebb11071e5e6797e6f6c65fe75043d09e9a97aa8bf17ec9b2fc423bf55f2` and ran the supervisor once from worktree 036. Version `2026-11-07.4` selects manifest `8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9`: 350 distinct configurations, 349 complete source configurations, one retained VIN and no images. Eight actual admitted 1F7B configurations were added.

Existing CLI prepare/publish/validate/fresh-process-load/idempotent-publish passed. The verifier checked all 350 configurations and one VIN directly, then through 351 local HTTP requests, with zero errors and zero source/external egress. Independent reconciliation verifies the manifest/source hashes and each added catalogue, all 342 previous rows byte-identical, exact VIN bytes and 19 historical version files unchanged.

The released run returned 0 in 13.64522525 seconds, peaked at 406,044,672 bytes RSS and removed 13,168,928 scratch bytes. Process groups, scratch, reservation, dependency link and publisher temporary paths are absent; there was no compatibility exception. Exact concise receipts and the complete active audit are retained here; operational originals remain under `.claude/f58-63-overnight-20261106/f62/f70first8-publication/publish/`.

This is partial configuration-only publication. It adds no VIN/stock or imagery and does not execute F60 enrichment. The nine recent source rows have separate F60 replay work; this publication does not establish full F59/F61/F62 acceptance, 10k, wider WMI or model breadth. FUCQ-152 and FUCQ-154 remain deferred and unfixed. No unchanged check or source request was repeated during reconciliation.
