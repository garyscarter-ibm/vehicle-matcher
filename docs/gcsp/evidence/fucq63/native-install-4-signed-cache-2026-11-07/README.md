# Native install4 — retained signed cache and explicit local-path allowance

This fresh packet prepares installation of the same seven exact reviewed bottles. It performs no installation until the parent reviews this exact plan and supplies a fresh grant. The original driver and all original 167 code pins remain unchanged; the prior install3 packet's 170 pins also remain unchanged. The new packet adds three scripts for 173 pins.

Actual install3 failed after 6.705957458 seconds before any new keg or opt-link change. Homebrew attempted one API fetch; the sandbox denied DNS. No successful public request or redownload occurred. The parent later proved owned children, scratch and reservation absent, removed 23,128,608 bytes, preserved installed kegs and recorded no leftovers. The initial cleanup failure was a `fileproviderd` observer; a later exact-root open-file check was empty before parent reconciliation. The prior attempt and its evidence remain consumed.

The initial loader failure is explained by the inspected Homebrew 7 code: `FromBottleLoader.try_new` returns before filename checking when `forbid_packages_from_paths?` is true. The whitelisted install3 environment supplied none of the opt-outs; Homebrew's current default therefore refused the local archive route and eventually invoked `NullLoader` and API names. The canonical bottle names already satisfy the pinned regex. Current API code also requires the signed envelope; the old copied `.payload` alone does not satisfy the cache contract.

The correction explicitly sets `HOMEBREW_INTERNAL_ALLOW_PACKAGES_FROM_PATHS=1` only in the isolated installer child environment and copies the retained signed API envelope into owned cache alongside the prior payload. The envelope is exactly 15,973,185 bytes, SHA256 `5ce934895df1f66d1fd42da2e433922560f226c14cae8c36c74427a11fe60b4b`. Source cache files remain read-only. No existing verification sidecars are copied: Homebrew must verify the signed envelope and create matching sidecars in owned scratch. Current-formula metadata is used for API name/path resolution; the original driver still loads and verifies the exact reviewed Ruby embedded in each official retained bottle.

`HOMEBREW_NO_INSTALL_FROM_API` remains unset. The local `homebrew/core` tap is absent; the inspected `AbstractCoreTap.ensure_installed!` API-mode branch skips a tap clone, while the no-API branch would call `Tap.ensure_installed!` and attempt installation. No tap, dependency, package, service or new network route is added by preparation.

The deny-network sandbox remains mandatory for every Homebrew command. Download/curl fallback markers are retained in bounded per-package logs and cause the phase to fail without retry. A sandbox-denied attempt is reported separately from successful requests. No source compilation, service registration, postinstall, default cluster, native database or public fleet action is authorized. Existing, new and partial installed kegs are preserved. Existing non-opt prefix links remain unchanged; named generic/versioned opt links may change only under the exact grant, with before/after strings retained. The PG archive is copied into owned scratch under its correct rebuild filename; original archives remain unchanged.

Resources remain one worker, 600 seconds, 768MiB cloud scratch, 2,048MiB disk reservation, 672MiB process-group RSS and 768MiB host RAM including supervisor headroom. The ownership manifest and registered finalizer precede allocation. Owned children are stopped and joined; group absence and open files are checked; disposable scratch is removed and reservation absence verified. A failed cleanup remains an explicit issue requiring reconciliation. No dependency link is touched. No compatibility exception is used.

The unauthorized grant example requires the exact signed envelope, exact seven embedded Ruby identities, approved packages, explicit local-path allowance, preserved-keg acknowledgement and opt-link acknowledgement. Static Python syntax and immutable pin checks passed. Homebrew loading, signed-cache verification, installation and native proof remain unrun.

```sh
/usr/bin/python3 -I docs/gcsp/evidence/fucq63/native-install-4-signed-cache-2026-11-07/supervise.py \
  --reviewed-plan-sha256 EXACT_PLAN_SHA256 --root-release /absolute/exact-parent-grant.json
```

Agent: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`, runtime unverified; no fallback or descendants. Background-only preparation; no network, installer, browser or scratch allocation occurred.
