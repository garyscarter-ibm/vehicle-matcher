#!/usr/bin/env python3
"""Scan staged Git blobs with the installed DetectSecrets CLI, without exposing values."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile

VERSION = "1.0.1"
BASELINE_NAME = ".secrets.baseline"
HASH_RE = re.compile(r"^[0-9a-fA-F]{32,128}$")
SAFE_TYPE_RE = re.compile(r"^[A-Za-z0-9 _.-]{1,100}$")
CONFIG_FIELDS = ("version", "plugins_used", "filters_used", "exclude_files", "exclude_lines",
                 "exclude", "exclude_regex", "generated_at", "word_list")


class ScanError(Exception):
    """An operational scan error whose message is always a fixed safe string."""


def _git(args, root, timeout=30):
    try:
        result = subprocess.run(["git", "-C", str(root), *args], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise ScanError("git could not read the staged index")
    if result.returncode:
        raise ScanError("git could not read the staged index")
    return result.stdout


def _index_entry(root, raw_path):
    pathspec = b":(literal)" + raw_path
    try:
        result = subprocess.run([b"git", b"-C", os.fsencode(root), b"ls-files", b"--stage", b"-z",
                                 b"--", pathspec], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise ScanError("git could not read the staged index")
    if result.returncode:
        raise ScanError("git could not read the staged index")
    entries = []
    for row in result.stdout.split(b"\0"):
        if not row:
            continue
        try:
            meta, filename = row.split(b"\t", 1)
            mode, oid, stage = meta.split(b" ", 2)
        except ValueError:
            raise ScanError("git returned an invalid staged index entry")
        if filename == raw_path:
            entries.append((mode, oid, stage))
    if not entries:
        return None
    if len(entries) != 1 or entries[0][2] != b"0":
        raise ScanError("a staged path has unresolved merge entries")
    return entries[0][0], entries[0][1]


def _read_index_blob(root, raw_path, entry):
    mode, oid = entry
    try:
        result = subprocess.run([b"git", b"-C", os.fsencode(root), b"cat-file", b"blob", oid],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        raise ScanError("git could not read a staged blob")
    if result.returncode:
        raise ScanError("git could not read a staged blob")
    return mode, result.stdout


def _copy_index_blob(root, oid, destination):
    try:
        with open(destination, "xb") as output:
            result = subprocess.run([b"git", b"-C", os.fsencode(root), b"cat-file", b"blob", oid],
                                    stdin=subprocess.DEVNULL, stdout=output,
                                    stderr=subprocess.DEVNULL, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        try:
            os.unlink(destination)
        except OSError:
            pass
        raise ScanError("git could not copy a staged blob")
    if result.returncode:
        try:
            os.unlink(destination)
        except OSError:
            pass
        raise ScanError("git could not copy a staged blob")


def _valid_repo_path(raw_path):
    if not raw_path or raw_path.startswith(b"/") or b"\0" in raw_path:
        return False
    parts = raw_path.split(b"/")
    return all(part not in (b"", b".", b"..") for part in parts)


def _canonical_path(value):
    if not isinstance(value, str) or not value:
        raise ScanError("DetectSecrets returned an invalid file path")
    if value.startswith("./"):
        value = value[2:]
    value = posixpath.normpath(value)
    if value in ("", ".", "..") or value.startswith("../") or value.startswith("/"):
        raise ScanError("DetectSecrets returned an invalid file path")
    return value


def _normalized_record(item, reason=None):
    if not isinstance(item, dict):
        raise ScanError("DetectSecrets returned an invalid baseline entry")
    hashed = item.get("hashed_secret")
    kind = item.get("type")
    line = item.get("line_number")
    if not isinstance(hashed, str) or not HASH_RE.fullmatch(hashed):
        raise ScanError("DetectSecrets returned an invalid hash")
    if not isinstance(kind, str) or not SAFE_TYPE_RE.fullmatch(kind):
        kind = "Unknown"
    if isinstance(line, bool) or not isinstance(line, int) or line < 1:
        raise ScanError("DetectSecrets returned an invalid line number")
    record = {"hashed_secret": hashed.lower(), "is_verified": bool(item.get("is_verified", False)),
              "line_number": line, "type": kind}
    for name in ("is_secret", "is_ignored"):
        if isinstance(item.get(name), bool):
            record[name] = item[name]
    if reason is not None:
        record["false_positive_reason"] = reason
    return record


def _parse_baseline(data):
    if not isinstance(data, dict) or "results" not in data or not isinstance(data["results"], dict):
        raise ScanError("the staged .secrets.baseline is invalid")
    results = {}
    for filename, items in data.get("results", {}).items():
        name = _canonical_path(filename)
        if not isinstance(items, list):
            raise ScanError("the staged .secrets.baseline is invalid")
        normalized = []
        for item in items:
            record = _normalized_record(item)
            reason = item.get("false_positive_reason", "")
            if not isinstance(reason, str):
                reason = ""
            record["false_positive_reason"] = reason
            normalized.append(record)
        results[name] = normalized
    clean = {key: copy.deepcopy(value) for key, value in data.items()
             if key in CONFIG_FIELDS and key != "results"}
    clean["results"] = results
    return clean


def _cli_input_baseline(baseline, changed_paths):
    if baseline is None:
        return None
    value = copy.deepcopy(baseline)
    for path in changed_paths:
        value.get("results", {}).pop(path, None)
    for entries in value.get("results", {}).values():
        for item in entries:
            item.pop("false_positive_reason", None)
    return value


def _find_reason(old_entries, record):
    for old in old_entries:
        if (old.get("hashed_secret") == record["hashed_secret"] and
                old.get("type") == record["type"]):
            reason = old.get("false_positive_reason", "")
            if isinstance(reason, str) and reason.strip() and "\n" not in reason and "\r" not in reason:
                return reason.strip()
    return ""


def _normalize_tool_output(data, projection, staged_paths, changed_paths, old_baseline,
                           baseline_file=None, word_list=None):
    if not isinstance(data, dict) or "results" not in data or not isinstance(data["results"], dict):
        raise ScanError("DetectSecrets returned an invalid baseline")
    output = {key: copy.deepcopy(data[key]) for key in CONFIG_FIELDS if key in data}
    if baseline_file is not None and isinstance(output.get("exclude"), dict):
        # IBM adds the literal anchored import filename, without regex escaping. Remove only
        # this invocation's exact bare atom or final alternative, never a similar user path.
        atom = "^" + str(baseline_file) + "$"
        excluded = output["exclude"].get("files")
        prior = old_baseline or {}
        modern = prior.get("exclude")
        # Match IBM main._get_exclude_files: truthy modern configuration wins, then legacy.
        previous = modern.get("files") if isinstance(modern, dict) and modern else prior.get("exclude_regex")
        # IBM does not append an atom already present as a substring of the input policy.
        introduced = not isinstance(previous, str) or atom not in previous
        if introduced and excluded == atom:
            output["exclude"]["files"] = "" if previous == "" else None
        elif introduced and isinstance(excluded, str) and excluded.endswith("|" + atom):
            output["exclude"]["files"] = excluded[:-len("|" + atom)]
    if word_list is not None:
        configured, private_file, expected_hash = word_list
        actual = output.get("word_list")
        if (not isinstance(actual, dict) or actual.get("file") != str(private_file) or
                actual.get("hash") != expected_hash or set(actual) != {"file", "hash"}):
            raise ScanError("DetectSecrets changed the configured word list policy")
        output["word_list"] = {"file": configured, "hash": actual["hash"]}
    else:
        actual = output.get("word_list")
        if actual is not None and (not isinstance(actual, dict) or
                                   any(value is not None for value in actual.values())):
            raise ScanError("DetectSecrets changed the configured word list policy")
    old_results = {} if old_baseline is None else old_baseline.get("results", {})
    changed = set(changed_paths)
    results = {path: copy.deepcopy(entries) for path, entries in old_results.items() if path not in changed}
    current = {}
    for filename, items in data.get("results", {}).items():
        path = filename
        if not isinstance(path, str):
            raise ScanError("DetectSecrets returned an invalid file path")
        if os.path.isabs(path):
            try:
                path = os.path.relpath(path, projection)
            except ValueError:
                continue
        source_path = _canonical_path(path)
        if source_path not in staged_paths or source_path not in changed:
            continue
        if not isinstance(items, list):
            raise ScanError("DetectSecrets returned an invalid baseline")
        prior = old_results.get(source_path, [])
        normalized = []
        for item in items:
            record = _normalized_record(item)
            reason = _find_reason(prior, record)
            record["false_positive_reason"] = reason
            normalized.append(record)
        if normalized:
            current[source_path] = normalized
            results[source_path] = normalized
    output["results"] = dict(sorted(results.items()))
    if old_baseline is not None and "generated_at" in old_baseline:
        old_without_time = {k: v for k, v in old_baseline.items() if k != "generated_at"}
        output_without_time = {k: v for k, v in output.items() if k != "generated_at"}
        if old_without_time == output_without_time:
            output["generated_at"] = old_baseline["generated_at"]
    return output, current


def _dump_baseline(data):
    return (json.dumps(data, ensure_ascii=True, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_candidate(root, index_baseline_bytes, candidate):
    target = root / BASELINE_NAME
    try:
        if os.path.islink(target):
            return False
        if index_baseline_bytes is None:
            if os.path.lexists(target):
                return False
        else:
            if not os.path.isfile(target) or target.read_bytes() != index_baseline_bytes:
                return False
        content = _dump_baseline(candidate)
        if os.path.isfile(target) and target.read_bytes() == content:
            return True
        fd, temporary = tempfile.mkstemp(prefix=".secrets-baseline-", dir=root)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return True
    except OSError:
        return False


def _detect_cli():
    executable = shutil.which("detect-secrets")
    if not executable:
        return None, None, 3
    try:
        result = subprocess.run([executable, "scan", "--help"], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return executable, None, 2
    if result.returncode:
        return executable, None, 2
    help_text = (result.stdout + b"\n" + result.stderr).decode("utf-8", "replace")
    if "usage:" not in help_text.lower():
        return executable, None, 2
    if "--update" in help_text:
        return executable, "update", 0
    if "--baseline" in help_text:
        return executable, "baseline", 0
    return executable, None, 2


def _prepare_word_list(root, baseline, control):
    """Project at most one configured dependency from the index, never the working tree."""
    policy = (baseline or {}).get("word_list")
    if policy is None:
        return None
    if not isinstance(policy, dict) or set(policy) - {"file", "hash"}:
        raise ScanError("the configured word list policy is invalid")
    filename, recorded_hash = policy.get("file"), policy.get("hash")
    if filename is None and recorded_hash is None:
        return None
    if (not isinstance(filename, str) or not filename or
            (recorded_hash is not None and
             (not isinstance(recorded_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", recorded_hash)))):
        raise ScanError("the configured word list policy is invalid")
    relative = filename[2:] if filename.startswith("./") else filename
    raw_path = os.fsencode(relative)
    if not _valid_repo_path(raw_path):
        raise ScanError("the configured word list must be a regular indexed repository file")
    entry = _index_entry(root, raw_path)
    if entry is None or entry[0] not in (b"100644", b"100755"):
        raise ScanError("the configured word list must be a regular indexed repository file")
    private_file = control / ".word-list"
    _copy_index_blob(root, entry[1], private_file)
    # IBM f4b775c util.build_automaton: accepted lines keep punctuation, order and duplicates;
    # lowercase/strip each line, omit length <=3, and hash without separators.
    digest = hashlib.sha1()
    try:
        with private_file.open(encoding="utf-8") as stream:
            for line in stream:
                word = line.lower().strip()
                if len(word) > 3:
                    digest.update(word.encode("utf-8"))
    except (OSError, UnicodeError):
        raise ScanError("the configured word list could not be read safely")
    return filename, private_file, digest.hexdigest()


def _run_detector(root, executable, mode, projection, scan_files, input_baseline, changed_paths):
    control = projection.parent / "control"
    control.mkdir(mode=0o700)
    baseline_file = control / ".scanner-baseline"
    legacy = (input_baseline or {}).get("exclude_regex")
    if legacy is not None and not isinstance(legacy, str):
        raise ScanError("the configured legacy exclusion policy is invalid")
    word_list = _prepare_word_list(root, input_baseline, control)
    args = [executable, "scan"]
    if input_baseline is not None:
        cli_baseline = _cli_input_baseline(input_baseline, changed_paths)
        if word_list is not None:
            cli_baseline["word_list"]["file"] = str(word_list[1])
        baseline_file.write_bytes(_dump_baseline(cli_baseline))
        if mode == "update":
            args.extend(["--update", str(baseline_file)])
        else:
            # Yelp's scan --baseline updates this supplied file; keep it outside the source projection.
            args.extend(["--baseline", str(baseline_file)])
    if word_list is not None:
        args.extend(["--word-list", str(word_list[1])])
    args.append("--")
    args.extend(str(path) for path in scan_files)
    try:
        result = subprocess.run(args, cwd=projection, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise ScanError("DetectSecrets scan failed operationally")
    if result.returncode:
        raise ScanError("DetectSecrets scan failed operationally")
    try:
        if input_baseline is not None:
            data = json.loads(baseline_file.read_text(encoding="utf-8"))
        else:
            data = json.loads(result.stdout.decode("utf-8"))
    except (OSError, UnicodeError, ValueError):
        raise ScanError("DetectSecrets returned an invalid baseline")
    return data, baseline_file if input_baseline is not None else None, word_list


def _scan(root, executable, mode):
    changed_raw = [name for name in _git(["diff", "--cached", "--name-only", "-z", "--no-renames", "--"], root)
                   .split(b"\0") if name]
    changed_entries = {}
    for raw_path in changed_raw:
        if not _valid_repo_path(raw_path):
            raise ScanError("git returned an invalid staged path")
        changed_entries[raw_path] = _index_entry(root, raw_path)

    baseline_entry = _index_entry(root, os.fsencode(BASELINE_NAME))
    baseline_bytes = None
    baseline = None
    if baseline_entry is not None:
        mode_value, baseline_bytes = _read_index_blob(root, os.fsencode(BASELINE_NAME), baseline_entry)
        if mode_value not in (b"100644", b"100755"):
            raise ScanError("the staged .secrets.baseline is not a regular file")
        try:
            baseline = _parse_baseline(json.loads(baseline_bytes.decode("utf-8")))
        except (UnicodeError, ValueError):
            raise ScanError("the staged .secrets.baseline is invalid")

    staged_paths = {}
    for raw_path, entry in changed_entries.items():
        if raw_path == os.fsencode(BASELINE_NAME) or entry is None:
            continue
        mode_value, oid = entry
        if mode_value == b"160000":
            continue
        if mode_value not in (b"100644", b"100755", b"120000"):
            raise ScanError("git returned an unsupported staged file type")
        staged_paths[_canonical_path(os.fsdecode(raw_path))] = (raw_path, mode_value, oid)

    changed_paths = [_canonical_path(os.fsdecode(name)) for name in changed_raw
                     if name != os.fsencode(BASELINE_NAME)]
    with tempfile.TemporaryDirectory(prefix="detect-secrets-projection-") as temporary:
        sandbox = Path(temporary)
        projection = sandbox / "source"
        projection.mkdir(mode=0o700)
        scan_files = []
        for relative, (raw_path, mode_value, oid) in sorted(staged_paths.items()):
            if not _valid_repo_path(raw_path):
                raise ScanError("git returned an invalid staged path")
            destination = projection.joinpath(*relative.split("/"))
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            # Paths retain their repository-relative names so baseline filters see the same names.
            # Git symlink blobs are scanned as their staged link-target bytes in a regular file;
            # the projection never follows the worktree symlink.
            _copy_index_blob(root, oid, destination)
            scan_files.append(Path(relative))
        if not scan_files:
            empty = projection / ".empty"
            empty.write_bytes(b"")
            scan_files = [Path(".empty")]
        data, baseline_file, word_list = _run_detector(
            root, executable, mode, projection, scan_files, baseline, changed_paths)
        candidate, current = _normalize_tool_output(
            data, projection, staged_paths, changed_paths, baseline, baseline_file, word_list)
        candidate_bytes = _dump_baseline(candidate)
        old_bytes = baseline_bytes
        baseline_changed = old_bytes != candidate_bytes
        writable = _write_candidate(root, baseline_bytes, candidate)
        findings = []
        for path, entries in sorted(current.items()):
            for entry in entries:
                reason = entry.get("false_positive_reason", "")
                if not isinstance(reason, str) or not reason.strip() or "\n" in reason or "\r" in reason:
                    findings.append((path, entry["line_number"], entry["type"]))
        if not writable:
            if findings:
                return findings, False, "baseline update could not be saved"
            raise ScanError("the staged baseline could not be prepared safely")
        return findings, baseline_changed, None


def main(argv=None):
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--root", default=os.getcwd())
    try:
        args = parser.parse_args(argv)
    except SystemExit as error:
        return int(error.code)
    root = Path(os.path.realpath(args.root))
    executable, mode, tool_state = _detect_cli()
    if tool_state == 3:
        print("DetectSecrets not installed", file=sys.stderr)
        return 3
    if tool_state:
        print("secrets scan not run: DetectSecrets CLI unavailable", file=sys.stderr)
        return 2
    try:
        top = _git(["rev-parse", "--show-toplevel"], root).rstrip(b"\n")
        if not top:
            raise ScanError("git could not read the staged index")
        root = Path(os.path.realpath(os.fsdecode(top)))
        findings, baseline_changed, baseline_error = _scan(root, executable, mode)
    except ScanError as error:
        print("secrets scan not run: " + str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        print("secrets scan not run: operational error", file=sys.stderr)
        return 2
    if baseline_error:
        print("secrets scan not run: baseline update could not be saved", file=sys.stderr)
    if baseline_changed and not findings:
        print("baseline updated: .secrets.baseline; stage named paths and rescan")
    for path, line, kind in findings:
        safe_kind = kind if SAFE_TYPE_RE.fullmatch(kind) else "Unknown"
        print("finding: %r:%d (%s)" % (path, line, safe_kind))
    if findings:
        return 1
    if baseline_error:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
