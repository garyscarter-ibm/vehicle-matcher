# F63 exact order-reference runner preparation

Three scoped cases pass, with five actual memory-fixture stock rows checked through direct lookup, the consuming adapter and actual loopback HTTP. Zero source calls or external connection attempts occurred. `fixture-observation.json` records measured count, environment, elapsed time, sequential throughput and p50/p95/p99; these are fixture measurements with no SLA claim. Stock generator is checked against its exact synthetic association; corpus/manifest/snapshot versions and all shared facts/source/unit/image/presentation fields reconcile with configuration evidence.

The first phase failed one case: the runner compared the stock generator with the configuration route's intentionally null generator. Its failed result remains in `fixture-results.json`. The corrected runner is covered by `fixture-evidence-results.json`; intermediate results remain explicit.

Native execution remains unrun and blocked: boolean inspection found no GCSP_DATABASE_URL in the inherited environment. No secret file, connection string, key or database was read/probed. The native CLI prepares only a read-only existing repository (`migrate:false`), explicit file policy and pinned corpus, and validates exact UUID/context input before repository open. A native attempt cannot claim nativeProof unless all checks pass. The parent must review the exact plan and execution budget before native use. No fixture substitutes for native acceptance.

One worker used a maximum 107,296-byte scratch allocation in the final phase and 171,212,800-byte sampled process-group RSS. Supervisor receipts verify removal of owned scratch, dependency link, process groups and reservation; no compatibility exception or leftovers. Scoped results do not establish F63 acceptance, full corpus acceptance or Done.

Agents: Mike Wazowski, requested/selected gpt-6.1-sol / medium; no fallback, runtime pair not independently confirmed; no descendants.
