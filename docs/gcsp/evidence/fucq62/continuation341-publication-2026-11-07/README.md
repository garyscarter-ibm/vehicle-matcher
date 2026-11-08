# Actual continuation publication, 7 November 2026

Root released exact contract `715a5ad2c59e02751058967c86477f5b1750322bce73c7b66d23501b0ae48033` and executed the supervisor once from worktree 036. Version `2026-11-07.3` selects manifest `ba9442f93ae8ac2c77d47631061827a16be42f9d3a4a5e64f9b32866928b6d5a`: 342 distinct configurations, 341 complete source configurations, one retained VIN and no images. One actual admitted S03GD configuration was added.

The existing publisher prepared, published, validated, loaded in a fresh process, and repeated publication idempotently. The audit read all 342 configurations and one VIN directly and made 343 local HTTP requests with zero errors, zero source calls and zero external egress. All 341 prior rows, the VIN bytes and 14 old version files remain byte-identical. `reconciliation.json` independently checks the retained files against these receipts and the exact accepted source.

The single released run returned 0 in 13.122876291 seconds, peaked at 391,905,280 bytes RSS and 12,771,616 scratch bytes. Scratch was removed; process groups, host reservation, dependency link and publisher temporary paths were absent. There was no compatibility exception. Original operational receipts remain outside scratch under `.claude/f58-63-overnight-20261106/f62/continuation341-publication/publish/`. Concise exact receipts and the complete active audit are retained here.

This is partial configuration-only publication evidence. It adds no VIN/stock or images, does not execute F60 enrichment, and establishes neither full F59/F61/F62 acceptance nor the 10,000-record or wider WMI/model coverage targets. FUCQ-152 and FUCQ-154 remain deferred and unfixed. No unchanged test suite or source request was rerun for this reconciliation.
