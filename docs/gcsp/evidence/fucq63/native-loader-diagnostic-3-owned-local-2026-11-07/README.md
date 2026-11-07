# Seven retained bottle loader diagnostic 3: owned local working set

Prepared only. Mike Wazowski: requested/selected `gpt-6.1-sol` / `medium`, runtime
unverified; no fallback or descendants. No installation or Story acceptance claim.

Diagnostic1 failed before Ruby because `/dev/null` writes were denied. Diagnostic2
permitted that exact device, then Homebrew's `utils.sh:144` Bash here-string could
not create a temp file. Its bounded actual log, failure, result and complete cleanup
are preserved here. No Ruby events or installation were observed; 104,795,040 bytes
were removed and process groups, scratch, reservation and all immutable pins were
verified absent or unchanged as applicable. A cloud log write also raised a timeout.

Installed `/opt/homebrew/bin/brew` copies TMPDIR into HOMEBREW_TMPDIR, but then omits
TMPDIR/TMP/TEMP from its `env -i` whitelist before starting `/bin/bash -p brew.sh`.
An outer local TMPDIR alone cannot close that boundary. Diagnostic3 pins the entire
installed entrypoint and permits one exact projection: add `TMPDIR TMP TEMP` to
`ENV_VAR_NAMES`. The Python driver checks the projected byte hash and stages it in
owned scratch. It passes the exact projected text to `/bin/bash -pu -c`, with the
original `/opt/homebrew/bin/brew` as `$0`; prefix, repository and library resolution
remain on the installed paths. Installed startup scripts remain unchanged. Review
the exact one-line diff in `brew-startup-projection.diff` and the plan's projection
identity; the grant must acknowledge that exact identity.

The Ruby wrapper still sets the internal local-path flag after startup. It checks
the guard, bottle filename regex, file existence, exact retained archive size/hash,
reviewed embedded Ruby, FromBottleLoader, package name/version, local_bottle_path
and original factory route for all seven archives. There must be exactly nine JSON
events: one startup, seven bottle loaders and one completion. FormulaInstaller must
remain unloaded. No DEVELOPER or NO_INSTALL_FROM_API override is supplied.

The bounded active Homebrew cache, canonical bottle copies and Bash temp files use
one exact `/private/tmp/test-stamp-shard-<owned token>` root. This is the explicit
active-build compatibility exception. The OS sandbox denies network and file writes
except beneath that exact root and to literal `/dev/null`. Arbitrary `/tmp`, prefix,
source cache, keg, link, service and default-cluster writes remain denied. Retained
source archives and both source cache files are immutable; copied signature sidecars
are forbidden and Homebrew must verify its own cache.

The existing test_resources lifecycle uses one worker, 120 seconds, 128 MiB scratch,
320 MiB child-group RAM plus 64 MiB supervisor headroom, and a 144 MiB disk reservation.
An external ownership manifest and finalizer are registered before allocation. The
finalizer stops/joins owned groups, proves absence, checks open files, removes only
owned scratch, releases the reservation and rechecks code/input/installed-state
identity. It never removes the shared `/private/tmp` parent. The cleanup receipt
records the exception and measured peak.

Small progress, log and result artifacts are written under the external metadata
root's `evidence` directory, at most 2 MiB total, then exported once with hashes and
atomic names to the OneDrive output directory. These concise local diagnostics remain
available if a cloud export fails; the cleanup receipt reports export completeness.
Archives/cache/temp working data are disposable and removed. No copy of those inputs
is retained locally. SIGKILL reconciliation requires the exact recorded manifest and
owner/open-file checks, never broad deletion.

After reviewing the packet, the parent creates an external grant from the unauthorized
example and sets authorized, diagnosticAllowed, allowReviewedLocalPackagePaths and
allowOwnedLocalWorkingSet true. Preserve the exact projection identity, deviceWriteException
`/dev/null`, installation/native false and zero request ceiling. Invoke supervise.py
with the exact reviewed plan SHA and absolute root-release path. This is one attempt;
failed or uncertain runs require a separately reviewed fresh packet.

Static checks are scoped preparation evidence. The seven loaders, signature-cache
behavior, sandbox compatibility, temp handling and resource fit remain unrun. Actual
diagnostic success and cleanup review must precede install5 preparation. Preserve the
original 167 native pins, the frozen diagnostic packets and `.12` proof pins. This
packet changes no screen or product behavior, so rendered visual checks do not apply.
GCSP build-rules, experience-quality, fixed scope, equal collaborator authority and
below-High Bug handling remain binding. HTTP 422 child errors remain diagnostic while
the launcher can continue; keep provider and credentials unchanged. No Done transition.
