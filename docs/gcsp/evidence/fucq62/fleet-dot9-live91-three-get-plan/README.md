# Frozen .9 actual91 deployment: three new GETs only

Prepared, unexecuted. Actual deployment `7617454370` completed 2026-11-07 06:13:49 UTC at exact code `91fe6cae774161365b196a342f79cbfce8aef030`. Parent must provide retained actual successful deployment evidence in the exact grant. The original failed deployment is refused.

The probe reads only the frozen prior .9 HTTP receipt, verifies its SHA256 and first-row direct/HTTP success, and derives expected DTO digest `2243502effab87b1a3653d7b67424f7a74af773bf5e656888a248772176d1c77`. It performs no local lookup or source replay and needs no dependency link. Forty-eight original code blobs are checked against the exact deployed commit by `git show`; current changed .10 code does not substitute for historical deployment identity.

Exactly three GETs: `/health`, `/health/vehicle-evidence`, then exact first configuration only if nested `vehicleEvidence` is ready for .9. Thirty seconds each, 90 seconds total, no retry/redirect/replay. Raw bounded bodies and redacted headers retained. No source/provider/database or image request. No whole-corpus/deployment/acceptance claim; original timeout cause remains unresolved.

Use `/usr/bin/python3 -I supervise.py --reviewed-plan-sha256 EXACT_SHA --root-release /absolute/grant.json`. Grant fields are unchanged from the prior packet, with `authorized:true`, phase `readiness-first-dto`, exact planSha256/code/manifestDigest, sourceCalls0, newGetCeiling3, deploymentSucceeded/freshReadinessDeployment true, actualDeploymentId7617454370 and exact deploymentEvidence path/hash.

One worker, 512MiB host/448MiB group, 320MiB Node heap, 64MiB cloud scratch, 90 seconds. Existing finalizer/group/open-file/inode resource lifecycle reused; output is created before nested scratch allocation. Prepared checks: Node syntax, Python in-memory compile and 48 exact deployed Git blob hashes. Runtime/network unrun.
