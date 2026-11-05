#!/usr/bin/env python3
"""Bounded FUCQ-30 headless browser run with an external ownership manifest."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid


WORKTREE = Path(__file__).resolve().parents[4]
RUN = "fucq30-20261105-feedback-actions-browser"
SCRATCH = WORKTREE / ".claude/test-runs/scratch/fucq30-20261105-feedback-actions/browser"
MANIFEST = WORKTREE / ".claude/test-runs/ownership/fucq30-browser.json"
EVIDENCE = WORKTREE / "docs/gcsp/evidence/fucq-30"
HARNESS = EVIDENCE / "browser-runner.mjs"
LOG = EVIDENCE / "browser-run.log"
RECEIPT = EVIDENCE / "browser-run-receipt.json"
MATRIX = EVIDENCE / "browser-matrix.json"
NODE = Path("/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
TOOL = WORKTREE / "_tools/test_resources.py"
SOURCE_FILES = [
    "blocks/vehicle-matcher/modes/questionnaire.js",
    "blocks/vehicle-matcher/modes/result-card.js",
    "blocks/vehicle-matcher/feedback-actions.js",
    "blocks/vehicle-matcher/engine.js",
    "blocks/vehicle-matcher/modes/question-ui.js",
    "blocks/vehicle-matcher/component-gallery.js",
    "blocks/vehicle-matcher/vehicle-matcher.css",
    "blocks/vehicle-matcher/component-gallery.css",
    "components.html",
    "server/questions.js",
    "server/test/render.test.js",
]
MIB = 1024 ** 2
GIB = 1024 ** 3
MAX_LOG = 2 * MIB
MAX_SECONDS = 600
MAX_SCRATCH = 512 * MIB
MAX_RAM = 1024 * MIB
BASELINE_HEAD = "b8bfee75fadd7aff2f7dfa2d7238bc93373ac708"
BASELINE_HASHES = {
    "blocks/vehicle-matcher/modes/questionnaire.js": "3b8c7e5643b4ae269a6b28fe533286e892bf80161b3dd9ebd05e2caf9ddd088f",
    "blocks/vehicle-matcher/modes/result-card.js": "0cd71f20029ca401ab8fd05c62b2275db28f65090c424885ed1ecd18d323e56a",
    "blocks/vehicle-matcher/feedback-actions.js": "6d15f7e9bb3b9c4e680fe57ee7f248675151989a7e7dba730ad4e18e11724ef5",
    "blocks/vehicle-matcher/engine.js": "f69fa8db8730e928f5cac3ea84ae2fc7988b79864c182febe58338d8ea6db9cd",
    "blocks/vehicle-matcher/modes/question-ui.js": "6eba9ed0af4c12d520173638dac4c30476dc41b686e453afbf8ae3a48b152706",
    "blocks/vehicle-matcher/component-gallery.js": "d11e830813acffee89151ab4d46483902acbd90bc1784223cfc0cfa0c28e7a35",
    "blocks/vehicle-matcher/vehicle-matcher.css": "471f36da9dc5989bb949ae0aba276e589562f0874a0832d90191c66c604855a9",
    "blocks/vehicle-matcher/component-gallery.css": "f12f32aa2569bd84e9bc7fc3fb771a1228312aca2997566936b375d32943ad7b",
    "components.html": "44adaad05dbdd9dc61fbcd4df12963743d710e13d995df0f66568f7e6dd5a512",
    "server/questions.js": "898716dfaf8a184fef39a9ae12b9d59b01cce94c48356dab5e3b4e81de62c26d",
    "server/test/render.test.js": "4af6a592ace52f6911154b1c125f9c1eb8fdc21efa30c2ffd628e331729acf75",
}


def load_resource_tools():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("fucq30_test_resources", TOOL)
    if not spec or not spec.loader:
        raise RuntimeError("cannot load _tools/test_resources.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RESOURCES = load_resource_tools()


def source_identity():
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=WORKTREE,
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
    )
    branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=WORKTREE,
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
    )
    hashes = {}
    for relative in SOURCE_FILES:
        path = WORKTREE / relative
        hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"head": result.stdout.strip(), "branch": branch.stdout.strip(), "files": hashes}


def atomic_write(path, data):
    RESOURCES.atomic_json(path, data)


def lsof_clear(root):
    command = [shutil.which("lsof") or "/usr/sbin/lsof", "-t", "+D", str(root)]
    result = subprocess.run(command, text=True, capture_output=True, timeout=8)
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "clear": result.returncode == 1 and not result.stdout and not result.stderr,
    }


def main():
    if not WORKTREE.is_dir() or not HARNESS.is_file() or not NODE.is_file():
        raise RuntimeError("worktree, harness, or bundled Node binary is unavailable")
    if SCRATCH.exists() or SCRATCH.is_symlink():
        raise RuntimeError("owned scratch root already exists; stop and reconcile its manifest")
    if MANIFEST.exists():
        raise RuntimeError("run ownership manifest already exists; do not overwrite it")
    before = source_identity()
    if before["files"] != BASELINE_HASHES:
        raise RuntimeError("frozen browser source hashes differ from dispatched b8bfee75")
    token = "fucq30-browser-" + uuid.uuid4().hex
    policy = RESOURCES.Policy({
        "preferred_free_gib": 30,
        "reserve_free_gib": 5,
        "chunk_scratch_mib": 512,
        "chunk_seconds": 600,
        "unit_scratch_mib": 512,
        "unit_ram_mib": 1024,
        "chunk_ram_mib": 1024,
        "log_mib": 2,
        "ram_reserve_mib": 512,
        "local_scratch_reason": "Bounded headless Chromium profile and temporary browser files for FUCQ-30 visual inspection.",
    })
    host = RESOURCES.HostBudget(policy)
    manifest = {
        "version": 1,
        "run": RUN,
        "state": "planned",
        "owner": RESOURCES.owner(),
        "worktree": str(WORKTREE),
        "branch": before["branch"],
        "head": before["head"],
        "baselineHead": BASELINE_HEAD,
        "source": before["files"],
        "scratch": str(SCRATCH),
        "scratchDevice": None,
        "scratchInode": None,
        "token": token,
        "reservation": None,
        "processGroup": None,
        "created": time.time(),
        "budgets": {"scratchBytes": MAX_SCRATCH, "ramBytes": MAX_RAM, "seconds": MAX_SECONDS, "logBytes": MAX_LOG},
    }
    atomic_write(MANIFEST, manifest)

    process = None
    output = None
    error = None
    exit_code = 1
    peak_scratch = 0
    peak_rss = 0
    process_group_clear = None
    open_files = None
    scratch_removed = False
    reservation_released = False
    reservation = None
    start = time.monotonic()
    monitor_issue = None
    try:
        headroom = host.headroom(str(WORKTREE))
        manifest["preflight"] = {
            "freeBytes": headroom["free"],
            "freeGiB": round(headroom["free"] / GIB, 2),
            "diskHeadroomBytes": headroom["disk"],
            "ramHeadroomBytes": headroom["ram"],
            "activeReservations": headroom["active"],
            "lowHeadroom": headroom["low"],
        }
        if headroom["free"] < policy.reserve:
            raise RuntimeError("free space is at or below the five-GiB emergency reserve")
        try:
            reservation = host.acquire(
                token, MAX_SCRATCH, MAX_RAM, str(WORKTREE),
                root=SCRATCH, minimum_disk=128 * MIB, minimum_ram=512 * MIB,
            )
        except RESOURCES.CapacityError:
            # An automatic smaller attempt preserves the same one-worker scope.
            reservation = host.acquire(
                token, 256 * MIB, 768 * MIB, str(WORKTREE),
                root=SCRATCH, minimum_disk=128 * MIB, minimum_ram=512 * MIB,
            )
            manifest["budgetAdjustment"] = "Reduced reservation to 256 MiB disk / 768 MiB RAM after capacity review."
        manifest["reservation"] = reservation
        manifest["state"] = "reserved"
        manifest["localScratchReason"] = policy.local_reason
        atomic_write(MANIFEST, manifest)

        SCRATCH.mkdir(mode=0o700)
        scratch_stat = SCRATCH.lstat()
        manifest.update(state="active", scratchDevice=scratch_stat.st_dev, scratchInode=scratch_stat.st_ino)
        atomic_write(MANIFEST, manifest)

        child_env = dict(os.environ)
        child_env.update({
            "TMPDIR": str(SCRATCH),
            "TMP": str(SCRATCH),
            "TEMP": str(SCRATCH),
            "FUCQ30_SCRATCH": str(SCRATCH),
            "FUCQ30_HEAD": before["head"],
            "FUCQ30_BASELINE_HEAD": BASELINE_HEAD,
            "FUCQ30_BRANCH": before["branch"],
        })
        output = open(LOG, "wb")
        command = [str(NODE), str(HARNESS)]
        process = subprocess.Popen(
            command,
            cwd=WORKTREE,
            env=child_env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        manifest.update(state="running", processGroup=process.pid, command=command, started=time.time())
        atomic_write(MANIFEST, manifest)

        while process.poll() is None:
            peak_scratch = max(peak_scratch, RESOURCES.allocated_bytes(SCRATCH))
            group_memory = RESOURCES.group_rss(process.pid)
            peak_rss = max(peak_rss, group_memory)
            host.update(token, peak_scratch, group_memory)
            elapsed = time.monotonic() - start
            free = shutil.disk_usage(WORKTREE).free
            log_size = LOG.stat().st_size if LOG.exists() else 0
            if peak_scratch > reservation["disk"]:
                monitor_issue = "scratch exceeded the 512-MiB budget"
            elif peak_rss > reservation["ram"]:
                monitor_issue = "process group exceeded the 1-GiB RAM budget"
            elif elapsed > MAX_SECONDS:
                monitor_issue = "browser run exceeded the ten-minute limit"
            elif log_size > MAX_LOG:
                monitor_issue = "browser log exceeded the two-MiB limit"
            elif free < policy.reserve:
                monitor_issue = "free space reached the five-GiB emergency reserve"
            if monitor_issue:
                break
            time.sleep(0.25)
        if monitor_issue:
            RESOURCES.stop_group(process)
            exit_code = 1
            error = monitor_issue
        else:
            exit_code = process.wait()
            if exit_code != 0:
                error = "browser harness exited with code %d" % exit_code
            elif not MATRIX.is_file():
                error = "browser harness produced no matrix"
                exit_code = 1
            else:
                result = json.loads(MATRIX.read_text())
                if result.get("status") != "passed":
                    error = "browser matrix is not passed: %s" % result.get("status")
                    exit_code = 1
                elif len(result.get("captures", [])) > 12:
                    error = "browser harness exceeded the 12-capture limit"
                    exit_code = 1
                else:
                    exit_code = 0
    except KeyboardInterrupt:
        error = "supervisor interrupted; running finalizer"
        exit_code = 130
    except BaseException as caught:
        error = "%s: %s" % (type(caught).__name__, caught)
        exit_code = 1
    finally:
        if output:
            try:
                output.flush()
                output.close()
            except BaseException as caught:
                error = error or ("log close: %s" % caught)

        if process:
            try:
                RESOURCES.stop_group(process)
                process_group_clear = RESOURCES.group_has_live_members(process.pid) is False
                if not process_group_clear:
                    error = error or "owned browser process group could not be proven empty"
            except BaseException as caught:
                process_group_clear = False
                error = error or ("process teardown: %s" % caught)

        if SCRATCH.exists() and not SCRATCH.is_symlink():
            current = SCRATCH.lstat()
            same_identity = (current.st_dev, current.st_ino) == (manifest.get("scratchDevice"), manifest.get("scratchInode"))
            if process_group_clear is True and same_identity:
                try:
                    open_files = lsof_clear(SCRATCH)
                    if open_files["clear"]:
                        shutil.rmtree(SCRATCH)
                        scratch_removed = not os.path.lexists(SCRATCH)
                    else:
                        error = error or "scratch has open files or lsof status is uncertain"
                except BaseException as caught:
                    error = error or ("scratch cleanup: %s" % caught)
            else:
                error = error or "scratch identity/process ownership is uncertain; left for safe reconciliation"
        else:
            scratch_removed = not os.path.lexists(SCRATCH)

        peak_scratch = max(peak_scratch, RESOURCES.allocated_bytes(SCRATCH))
        if reservation:
            try:
                host.update(token, peak_scratch, peak_rss)
                host.release(token)
                reservation_released = token not in (RESOURCES.read_json(host.path, {}) or {})
            except BaseException as caught:
                error = error or ("reservation release: %s" % caught)

        try:
            if LOG.exists() and LOG.stat().st_size > MAX_LOG:
                with open(LOG, "rb") as source:
                    source.seek(-MAX_LOG, os.SEEK_END)
                    tail = source.read()
                with open(LOG, "wb") as target:
                    target.write(tail)
            after = source_identity()
        except BaseException as caught:
            after = None
            error = error or ("final identity check: %s" % caught)

        if after and after["files"] != before["files"]:
            error = error or "frozen executable source identity changed during browser run"
            exit_code = 1

        receipt = {
            "run": RUN,
            "status": "passed" if not error and exit_code == 0 and scratch_removed and process_group_clear is True and reservation_released else "incomplete",
            "startedEpoch": manifest.get("started"),
            "wallSeconds": round(time.monotonic() - start, 3),
            "worktree": str(WORKTREE),
            "branch": before["branch"],
            "head": before["head"],
            "baselineHead": BASELINE_HEAD,
            "headAfter": after["head"] if after else None,
            "sourceUnchanged": bool(after and after["files"] == before["files"]),
            "scratch": {
                "path": str(SCRATCH),
                "compatibilityException": policy.local_reason,
                "peakBytes": peak_scratch,
                "peakMiB": round(peak_scratch / MIB, 2),
                "removed": scratch_removed,
            },
            "process": {
                "pid": process.pid if process else None,
                "processGroupEmpty": process_group_clear,
                "openFiles": open_files,
            },
            "reservation": {
                "token": token,
                "diskBytes": reservation.get("disk") if reservation else None,
                "ramBytes": reservation.get("ram") if reservation else None,
                "released": reservation_released,
            },
            "log": str(LOG),
            "matrix": str(MATRIX) if MATRIX.exists() else None,
            "error": error,
        }
        atomic_write(RECEIPT, receipt)
        manifest.update(
            state="removed" if scratch_removed and process_group_clear is True and reservation_released else "cleanup_incomplete",
            finished=time.time(),
            processGroupEmpty=process_group_clear,
            scratchRemoved=scratch_removed,
            reservationReleased=reservation_released,
            peakScratchBytes=peak_scratch,
            peakRssBytes=peak_rss,
            error=error,
            receipt=str(RECEIPT),
        )
        atomic_write(MANIFEST, manifest)
        print(json.dumps(receipt, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
