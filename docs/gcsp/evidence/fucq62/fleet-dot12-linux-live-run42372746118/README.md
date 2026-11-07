# Second Linux live .12 diagnostic — run 42372746118

The sole push-triggered run **42372746118**, attempt **1**, succeeded at **2026-11-07T12:30:19Z** on integration head `13144e31f1b0b5db47e0b189e6d14784abdaa055`. Its fixed diagnostic identity is `fleet-dot12-linux-live-20261107-2`; the exact reviewed plan SHA is `627a4704d1a03f2eb944ab99f01993a11883fbb7175f50f590470a63d3f8e043`.

The actual three GETs passed:

| Observation | HTTP | Elapsed | Evidence |
| --- | --- | --- | --- |
| Health | 200 | 271.58 ms | `ok:true` |
| Vehicle readiness | 200 | 137.57 ms | `ready`, actual manifest `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30` |
| Exact first configuration | 200 | 314.14 ms | DTO SHA `82712c8d703e6546d6c4298fa3a168b2ea48f09c73931ee9eb061ee36f98e2e4`, matching the prior offline DTO |

The pinned target is GitHub deployment `7620961777`, actual Render deployment `dep-dbnhane8bjmc73a7v5qg`, code `c87b6f075c4e79bee93b71e1965ad23310ab8473`, whose success preceded this observation. The readiness response itself proves the manifest; deployment success alone was not used as manifest evidence.

`probe-receipt.json` and `remote-cleanup.json` are decoded from the original bounded log. `response-excerpts.json` preserves the logged hashes, byte lengths and Base64 prefixes. `responses/` decodes full health/readiness bodies and sanitized headers plus only the first 2048 bytes of the 11532-byte configuration body; its omitted bytes were not reconstructed. `job.log` is 31757 bytes, below the 65536-byte retrieval ceiling. `integrated-input-pins.json` verifies the exact runtime packet and workflow identities at the run head.

The remote supervisor finished with rc 0 in 0.834 seconds, confirmed process-group and scratch absence, and removed a measured 16946-byte scratch peak. Aggregate sampled RSS upper bound was 90398720 bytes. No archive or leftovers remained. The observer created no local scratch, archive or owned children; retained evidence was written directly into this small output directory outside both watched packet directories. No new local application GET, dispatch or rerun occurred.

This is scoped success for one exact live configuration and the deployment selector boundary. It does not establish a full 10002-reference consumer replay, erase the 2707 known historical consumer failures, explain the original local timeout, establish full acceptance or authorise Done. The older local timeout and Linux .10 mismatch evidence remains preserved.
