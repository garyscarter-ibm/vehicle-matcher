# Retained source checkpoint interruption proof — 7 November 2026

Both forced termination cases passed. An inner Python supervisor and Node collection-session child were killed together with SIGTERM and SIGKILL after an atomic checkpoint containing one actual source32 accepted record and its exact source captures was committed. The primary checkpoint lived in the retained evidence directory from its first write. The outer launcher exported it, removed disposable scratch, then invoked the existing source binder: the accepted record qualified after cleanup in both cases.

This synthetic harness reuses one immutable actual source record; it makes no network requests and adds no source capacity. The earlier interrupted200 allocation is the regression: its primary lived under disposable scratch, so supervisor cleanup deleted it. Production collector, binder, validators and policy code are unchanged.

`run-proof.py`, `proof-supervisor.py` and `proof-child.mjs` record the owned forced-stop procedure. `export_checkpoint.py` is the small finalizer exporter used by the proof and future source wrappers; it validates the envelope/content digest and source artifact hashes, exports bounded safe artifacts and never deletes the primary. It leaves a named export failure on CLI failure. Binder semantics are checked separately after cleanup.

Each case retains `collector-checkpoint.json`, exported source artifacts, `checkpoint-export.json`, `proof-result.json` and `cleanup.json`. `receipt.json` records both passing cases. Removed scratch allocation: 8,192 bytes across two cases. Maximum supervised group RSS: 141,508,608 bytes. Process groups, reservations and borrowed dependency link are absent; no compatibility exception. Retained primary paths and expected 2 MiB bounds were registered in external ownership manifests before creation.

Future source allocations use this same retained-primary placement from outset and finalizer export before scratch cleanup. They keep exact finite plans, immutable source/producer pins, permanently spent one-shot markers and cross-chunk dedup. No production throughput repair is included.
