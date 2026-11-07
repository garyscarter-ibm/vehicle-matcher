# Fresh `.9` readiness deployment: at most three public GETs

Preparation only; no HTTP or execution is granted. This packet targets exact root readiness commit `91fe6cae774161365b196a342f79cbfce8aef030` and ordinary `.9` manifest `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884`. It pins 48 absolute-root code dependencies against their committed blobs, all 52 actual ordinary history files across ten versions, and the prior exact first-row offline HTTP receipt. Child `.036` production files remain unchanged for the active `.10` proof.

Root must identify a **fresh successful meaningful deployment of that exact readiness code**, supply its actual deployment ID and immutable deployment evidence, and separately release the exact plan SHA. Deployment `7617112384` is refused. Blueprint auto-sync is not assumed. The new readiness endpoint and 22 scoped checks do not establish why the earlier deployed DTO request timed out; this packet can observe readiness and one exact DTO only.

The one supervised phase first resolves the exact first configuration through the pinned **root** ordinary loader, without public requests, and saves its expected DTO. Its JSON digest must equal the independently retained prior offline first-row digest `2243502effab87b1a3653d7b67424f7a74af773bf5e656888a248772176d1c77`; row key and encoded-path digests match the original failed live request. It then sends, in order:

1. `GET /health`: require 200 with `ok:true`.
2. `GET /health/vehicle-evidence`: require 200, `ok:true`, `vehicleEvidence.status:"ready"` and the exact `.9` manifest.
3. One GET for that exact first configuration: require 200 and complete deep DTO equality with the offline expected object, including manifest identity.

Every GET is reserved and atomically checkpointed before fetch. Each has at most 30 seconds, bounded by the remaining **90-second total**, including offline expected preparation. Any failure or readiness mismatch stops; no later GET, retry, redirect, replay, additional health check or source request follows. The one configuration repeats a previously failed row only under this fresh explicit three-GET grant; the old failed receipt and packet remain unchanged. The new output root must be absent before execution.

Each bounded response retains its exact body bytes, status, digest, timing and up to 16 KiB of raw header values (2 KiB per value); credential/cookie headers are redacted. Readiness also gets an explicit safe-field projection. Partial response bytes and pending reservation survive handled failures. No access key is read or supplied. A 401/403 remains a failed observation. No live image, native DB or BMW/provider traffic is included. A pass proves three observations and one DTO comparison, not the full 2,426-reference parity or Story acceptance.

The supervisor requires `--reviewed-plan-sha256` and `--root-release` pointing to an absolute explicit parent grant. `parent-release.example.json` describes its fields with `authorized:false`; it is not an executable grant. The supervisor verifies code against both absolute-root bytes and the exact commit, checks ordinary tree membership and pins before/after, and uses the existing resource helper plus tri-state group proof. It writes an ownership manifest before allocation, registers a finalizer, propagates owned TMP variables, joins owned groups, checks open files, removes only its inode-verified dependency link, removes cloud scratch, releases the reservation and verifies absence. Existing dependencies are preserved. Output and scratch go directly to the distinct OneDrive root; bounded metadata remains under the root run directory.

Resources: one worker, 320 MiB Node heap, 512/448 MiB host/group RAM, 64 MiB cloud scratch/disk reservation, 90 seconds, at most 4 MiB retained response evidence. No live compatibility exception. Syntax and read-only code/ordinary/first-row identity checks are the preparation validation; no network/proof execution or successful deployment is inferred.

Agents: Mike Wazowski; requested/selected gpt-6.1-sol / medium; no fallback or descendants; effective runtime settings unverified.
