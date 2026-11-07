# Seven retained bottle loader diagnostic

Prepared only. This packet makes no installation or native-database acceptance claim.
Mike Wazowski: requested/selected `gpt-6.1-sol` / `medium`; effective runtime unverified;
no fallback or descendants.

The installed `brew.sh:655` unsets `HOMEBREW_INTERNAL_ALLOW_PACKAGES_FROM_PATHS`, so
the install4 shell environment correction never reached the loader. The installed
`env_config.rb:1038` checks this variable at runtime. This diagnostic assigns it in
Ruby after shell startup, then requires `formulary`. The existing `brew ruby` entry
point already requires `formulary` through `brew_irb_helpers`; neither startup route
loads an archive before the diagnostic assigns the flag. No developer or API-disable
environment override is supplied.

The single Ruby invocation checks exactly seven copied retained archives. Each must
match its whole-file size/hash, canonical bottle filename, reviewed embedded formula
hash, package name/version, `FromBottleLoader` class, exact `local_bottle_path`, and
the unchanged install driver's `Formulary.factory` route. It emits one startup,
seven package, and one completion JSON record. `FormulaInstaller` must remain unloaded.

The OS sandbox denies all network operations and all file writes except beneath the
exact owned cloud scratch root. Source archives, source API cache, Homebrew prefix,
kegs, links, services and default cluster remain immutable. Only the signed envelope
and payload are copied into the owned cache; Homebrew must verify its own sidecars.
The copied archives and cache occupy 97,534,874 bytes before bounded cache sidecars.
Successful public requests and redownload bytes must be zero; a denied fallback
attempt remains a failure, with bounded log evidence. There is no automatic retry.

One worker, 120 seconds, 128 MiB scratch, 320 MiB child group plus 64 MiB supervisor
headroom (384 MiB host total), and a 144 MiB disk reservation include the small retained
evidence budget. `_tools/test_resources.py` supplies the existing short-held host
reservation, external ownership manifest, process-group teardown and scratch cleanup.
The finalizer proves group absence, checks open files, removes owned scratch, releases
the reservation, rechecks every code/input pin and installed state, and retains the
cleanup receipt. There is no local compatibility exception. SIGKILL reconciliation
must use the recorded exact owner manifest; never broadly delete output or kegs.

The parent must review `plan.json`, the Ruby/Python drivers, supervisor and frozen
input identities, then create a fresh external grant from the unauthorized example.
Set only `authorized`, `diagnosticAllowed` and `allowReviewedLocalPackagePaths` true;
keep installation/native false and request ceiling zero. Execute the supervisor with
`--reviewed-plan-sha256 <exact plan SHA>` and `--root-release <absolute grant path>`.
One output/metadata root is permitted, with no replay after a failed or uncertain run.

Static syntax and identity checks are preparation evidence only. The seven loaders,
signature-cache behavior, sandbox compatibility and resource fit remain unrun. Review
the actual diagnostic receipt and cleanup before preparing any install5 correction.
That later wrapper would set the flag inside Ruby and load the unchanged original
driver; it requires a separate exact installation packet and grant.

This packet changes no screen or product behavior, so no rendered visual check is
applicable. `docs/gcsp/build-rules.md`, `experience-quality.md`, fixed Story scope,
equal collaborator authority and separate below-High Bug handling remain binding.
Child HTTP 422 errors remain diagnostic while the launcher can continue; credentials
and provider stay unchanged. No Story Done transition is authorized.
