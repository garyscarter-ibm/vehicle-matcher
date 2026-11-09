# FUCQ-113 registered adoption caller proof

The lead verified FUCQ-103's published `82849155565edbfc792961553d7292b8b5965a35`
with FUCQ-113's learning modules from `ad2e3bfbce96e39fa16d6a0652cf0dd522da78df`.
The supervisor extracted those exact Git objects into owned scratch, including the runtime's shared
feedback-actions dependency. No working tree was merged or changed for the proof. SHA256 maps for every
materialised source are retained in the shared run root below. This is an isolated source composition,
not the current branch's integrated application and not a PostgreSQL or deployed-policy adoption claim.

The exact immutable candidate is `fucq113-learning-v1`, revision `learning-definitions.v1`,
canonical digest `a49f54884322f5993faf510aa8f5cea6e4a9c02e9fae2d2ddfefd350a69d7782`,
byte SHA256 `c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143`.
It is now registered by FUCQ-103. The new caller checks do not repeat its unchanged fifteen-test proof.

`adoption-caller-probe.mjs` performs two checks using the actual `createGcspRuntime(mode: memory)`,
identity adapter, DemoClock and same writable MemoryPolicyProvider. There are no outcome or policy-port
overlays, HTTP listeners, database connections or policy-source modifications.

1. Before intentional adoption, `loadLearningPolicy` refuses the missing canonical learning key. The
   real reviewed-definition operation publishes and activates a successor, ordinary session resolution
   pins it, and the learning reader receives all seven exact registered definitions with that version
   and effective date. Generation is deterministic and its complete manifest validates. Its configurations
   remain explicitly labelled reviewed fixtures, and all records remain synthetic with unknown satisfaction.
2. The original retained policy snapshot remains identical. A historical pin still refuses missing
   learning keys; it cannot borrow successor values. Existing non-learning assumptions survive adoption.

Selected command inside the supervisor-owned composition:
`node --test --test-concurrency=1 adoption-caller-probe.mjs` — **2/2 passed**, zero skips,
5 November 2026; child wall time 3.35s, peak RSS 219,873,280 bytes, peak owned scratch 1,969,793 bytes.
One setup attempt omitted the runtime's feedback-actions dependency; its zero-check failure was retained,
the source closure was corrected, and both attempt roots/groups were removed. The successful exact-source
map, selected checks/exclusions, supervisor and all checkpoints are retained at shared
`.claude/test-runs/fucq113-adoption-caller/`. Final cleanup verifies absent owned scratch and dependency link,
stopped process groups, released HostBudget reservations, unchanged tracked source and preserved shared pg8.23.1.

The reviewed registration and memory adoption/caller boundary are proved. The shared-source merge,
actual PostgreSQL activation/persistence, successful canonical default CLI run, actual FUCQ-77 corpus
and confirmed catalogue-feature/provenance mapping, actual observed outcome producers and authored
full-suite validation remain outside this evidence. The story remains blocked for full acceptance.
