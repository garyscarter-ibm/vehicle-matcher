# Fresh first-bottle preflight — prepared only

The consumed original native installation failed before any package install log existed. Its wrapper suppressed the original exception and retained no stage, while the owned archive was removed during successful cleanup. Exact cause is unresolved. Current retained evidence narrows the boundary to the first bottle download, archive size/hash or embedded Ruby checks; no checksum check may be removed based on a hypothesis.

This is a new finite diagnostic phase, `install-2-preflight`. It downloads only the exact first `ca-certificates` bottle: 109,619 bytes, SHA256 `8589f4e61b3afcc5ea375aab11af1c891ec4c94421c699c2a5a4765078de4443`. It records stage checkpoints before each boundary, actual/expected size and SHA256, bounded `.brew` member names/lengths/hashes, and sanitized exception type plus file/line frames. Registry tokens stay in memory; no URL query, bearer token or exception text is logged. The original expected embedded Ruby hash is retained and must match for a passing preflight.

There is no Homebrew child, package installation, native database, dependency link, source transport or candidate generation. Even a passing preflight grants no installation permission. It permits at most five fresh public token/blob/CDN operations, three redirects, no retry, 15 seconds per request and 60 seconds total. Only the original approved GHCR/CDN hosts are accepted.

The example grant is unauthorized. An exact parent grant requires `authorized:true`, phase/plan SHA/full code pins, `newRequestCeiling:5`, `installAllowed:false` and `nativeAllowed:false`:

```sh
/usr/bin/python3 -I docs/gcsp/evidence/fucq63/native-install-2-preflight-2026-11-07/supervise.py \
  --reviewed-plan-sha256 EXACT_PLAN_SHA256 --root-release /absolute/exact-grant.json
```

One worker uses a 256MiB host reservation (192MiB group plus 64MiB supervisor), 2MiB owned cloud scratch and an 8MiB disk reservation. Ownership and the finalizer are registered before allocation; destination creation precedes scratch. The finalizer stops/joins the owned group, proves absence, checks open files, removes only owned scratch and releases its reservation. Compact stage/hash/member/failure receipts remain in OneDrive, including after a failed preflight. No installed keg or dependency link is changed. The generic `icu4c` and `openssl` aliases are recorded before and after and must remain unchanged; their observed targets are `icu4c@78/78.3` and `openssl@3/3.6.3` respectively. No compatibility exception is used.

Preparation validation is Python syntax, exact code/input/alias pin checks and preserved original-packet identity only. No new download, installation or native proof has run. A later corrected installer requires the actual preflight evidence, a separate immutable packet and exact grant. Original consumer failures and Story acceptance remain unchanged.

Agent: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`; runtime unverified; no fallback or descendants. Background-only work.
