#!/usr/bin/env python3
"""One bounded post-fix confirmation run with shared scratch ownership."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid


WORKTREE = Path(__file__).resolve().parents[4]
SHARED_ROOT = Path("/Users/usget/Claude/vehicle-matcher")
RUN = "fucq30-20261105-feedback-actions-browser-confirmation-retry1"
SCRATCH = SHARED_ROOT / ".claude/test-runs/scratch/fucq30-20261105-feedback-actions-browser-confirmation-retry1/browser"
MANIFEST = SHARED_ROOT / ".claude/test-runs/ownership/fucq30-browser-confirmation-retry1.json"
EVIDENCE = WORKTREE / "docs/gcsp/evidence/fucq-30"
HARNESS = EVIDENCE / "browser-confirmation-runner.mjs"
LOG = EVIDENCE / "browser-confirmation-retry1.log"
RECEIPT = EVIDENCE / "browser-confirmation-retry1-receipt.json"
MATRIX = EVIDENCE / "browser-confirmation-matrix.json"
NODE = Path("/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
TOOL = WORKTREE / "_tools/test_resources.py"
BASELINE_HEAD = "85e174e9aff71367472c54f489bea802008a869c"
SOURCE_FILES = [
    "blocks/vehicle-matcher/modes/questionnaire.js",
    "blocks/vehicle-matcher/modes/result-card.js",
    "blocks/vehicle-matcher/feedback-actions.js",
    "blocks/vehicle-matcher/engine.js",
    "blocks/vehicle-matcher/modes/question-ui.js",
    "blocks/vehicle-matcher/modes/brand-copy.js",
    "blocks/vehicle-matcher/modes/preview-feed.js",
    "blocks/vehicle-matcher/quiz-meta.js",
    "blocks/vehicle-matcher/ui.js",
    "blocks/vehicle-matcher/share-context.js",
    "blocks/vehicle-matcher/component-gallery.js",
    "blocks/vehicle-matcher/vehicle-matcher.css",
    "blocks/vehicle-matcher/component-gallery.css",
    "blocks/vehicle-matcher/tokens.css",
    "components.html",
    "server/questions.js",
]
MIB = 1024 ** 2
GIB = 1024 ** 3
MAX_LOG = 2 * MIB
MAX_SECONDS = 600
MAX_SCRATCH = 512 * MIB
MAX_RAM = 1024 * MIB


def load_resource_tools():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("fucq30_confirmation_resources", TOOL)
    if not spec or not spec.loader:
        raise RuntimeError("cannot load _tools/test_resources.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RESOURCES = load_resource_tools()


def source_identity():
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=WORKTREE, text=True, capture_output=True, timeout=5, check=True).stdout.strip()
    branch = subprocess.run(["git", "branch", "--show-current"], cwd=WORKTREE, text=True, capture_output=True, timeout=5, check=True).stdout.strip()
    hashes = {relative: hashlib.sha256((WORKTREE / relative).read_bytes()).hexdigest() for relative in SOURCE_FILES}
    return {"head": head, "branch": branch, "files": hashes}


def lsof_clear(root):
    command = [shutil.which("lsof") or "/usr/sbin/lsof", "-t", "+D", str(root)]
    result = subprocess.run(command, text=True, capture_output=True, timeout=8)
    return {"command": command, "returncode": result.returncode, "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(), "clear": result.returncode == 1 and not result.stdout and not result.stderr}


def main():
    if not WORKTREE.is_dir() or not SHARED_ROOT.is_dir() or not HARNESS.is_file() or not NODE.is_file():
        raise RuntimeError("worktree, shared root, harness, or bundled Node binary is unavailable")
    if SCRATCH.exists() or SCRATCH.is_symlink():
        raise RuntimeError("confirmation scratch root already exists; stop and reconcile its manifest")
    if MANIFEST.exists():
        raise RuntimeError("confirmation ownership manifest already exists; do not overwrite it")
    before = source_identity()
    if before["head"] != BASELINE_HEAD:
        raise RuntimeError("worktree is not at the parent-frozen confirmation SHA: " + before["head"])

    token = "fucq30-confirmation-" + uuid.uuid4().hex
    policy = RESOURCES.Policy({
        "preferred_free_gib": 30, "reserve_free_gib": 5, "chunk_scratch_mib": 512,
        "chunk_seconds": 600, "unit_scratch_mib": 512, "unit_ram_mib": 1024,
        "chunk_ram_mib": 1024, "log_mib": 2, "ram_reserve_mib": 512,
        "local_scratch_reason": "Bounded headless Chromium profile and temporary browser files for the FUCQ-30 post-fix confirmation.",
    })
    host = RESOURCES.HostBudget(policy)
    manifest = {
        "version": 1, "run": RUN, "state": "planned", "owner": RESOURCES.owner(),
        "worktree": str(WORKTREE), "sharedRoot": str(SHARED_ROOT),
        "branch": before["branch"], "head": before["head"], "source": before["files"],
        "scratch": str(SCRATCH), "scratchDevice": None, "scratchInode": None,
        "token": token, "reservation": None, "processGroup": None, "created": time.time(),
        "budgets": {"scratchBytes": MAX_SCRATCH, "ramBytes": MAX_RAM, "seconds": MAX_SECONDS, "logBytes": MAX_LOG},
    }
    RESOURCES.atomic_json(MANIFEST, manifest)

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
    started = time.monotonic()
    try:
        headroom = host.headroom(str(SHARED_ROOT))
        manifest["preflight"] = {
            "freeBytes": headroom["free"], "freeGiB": round(headroom["free"] / GIB, 2),
            "diskHeadroomBytes": headroom["disk"], "ramHeadroomBytes": headroom["ram"],
            "activeReservations": headroom["active"], "lowHeadroom": headroom["low"],
        }
        if headroom["free"] < policy.reserve:
            raise RuntimeError("free space is at or below the five-GiB emergency reserve")
        try:
            reservation = host.acquire(token, MAX_SCRATCH, MAX_RAM, str(SHARED_ROOT), root=SCRATCH,
                                       minimum_disk=128 * MIB, minimum_ram=512 * MIB)
        except RESOURCES.CapacityError:
            reservation = host.acquire(token, 256 * MIB, 768 * MIB, str(SHARED_ROOT), root=SCRATCH,
                                       minimum_disk=128 * MIB, minimum_ram=512 * MIB)
            manifest["budgetAdjustment"] = "Reduced reservation to 256 MiB disk / 768 MiB RAM after capacity review."
        manifest.update(state="reserved", reservation=reservation, localScratchReason=policy.local_reason)
        RESOURCES.atomic_json(MANIFEST, manifest)

        SCRATCH.mkdir(parents=True, mode=0o700)
        scratch_stat = SCRATCH.lstat()
        manifest.update(state="active", scratchDevice=scratch_stat.st_dev, scratchInode=scratch_stat.st_ino)
        RESOURCES.atomic_json(MANIFEST, manifest)

        child_env = dict(os.environ)
        child_env.update({
            "TMPDIR": str(SCRATCH), "TMP": str(SCRATCH), "TEMP": str(SCRATCH),
            "FUCQ30_SCRATCH": str(SCRATCH), "FUCQ30_HEAD": before["head"], "FUCQ30_BRANCH": before["branch"],
        })
        output = open(LOG, "wb")
        command = [str(NODE), str(HARNESS)]
        process = subprocess.Popen(command, cwd=WORKTREE, env=child_env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        manifest.update(state="running", processGroup=process.pid, command=command, started=time.time())
        RESOURCES.atomic_json(MANIFEST, manifest)

        monitor_issue = None
        while process.poll() is None:
            used = RESOURCES.allocated_bytes(SCRATCH)
            rss = RESOURCES.group_rss(process.pid)
            peak_scratch = max(peak_scratch, used)
            peak_rss = max(peak_rss, rss)
            host.update(token, used, rss)
            if used > reservation["disk"]:
                monitor_issue = "scratch exceeded its reserved disk budget"
            elif rss > reservation["ram"]:
                monitor_issue = "process group exceeded its reserved RAM budget"
            elif time.monotonic() - started > MAX_SECONDS:
                monitor_issue = "browser run exceeded ten minutes"
            elif LOG.stat().st_size > MAX_LOG:
                monitor_issue = "browser log exceeded two MiB"
            elif shutil.disk_usage(SHARED_ROOT).free < policy.reserve:
                monitor_issue = "free space reached the five-GiB emergency reserve"
            if monitor_issue:
                break
            time.sleep(0.25)
        if monitor_issue:
            RESOURCES.stop_group(process)
            error = monitor_issue
        else:
            exit_code = process.wait()
            if exit_code != 0:
                error = "browser confirmation exited with code %d" % exit_code
            elif not MATRIX.is_file():
                error, exit_code = "browser confirmation produced no matrix", 1
            else:
                result = json.loads(MATRIX.read_text())
                if result.get("status") != "passed":
                    error, exit_code = "confirmation matrix is not passed: %s" % result.get("status"), 1
                elif len(result.get("captures", [])) != 4:
                    error, exit_code = "confirmation did not refresh exactly four captures", 1
                else:
                    exit_code = 0
    except KeyboardInterrupt:
        error, exit_code = "supervisor interrupted; running finalizer", 130
    except BaseException as caught:
        error, exit_code = "%s: %s" % (type(caught).__name__, caught), 1
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
            error = error or "confirmation source hashes changed during browser run"
            exit_code = 1

        receipt = {
            "run": RUN,
            "status": "passed" if not error and exit_code == 0 and scratch_removed and process_group_clear is True and reservation_released else "incomplete",
            "worktree": str(WORKTREE), "sharedRoot": str(SHARED_ROOT), "branch": before["branch"],
            "head": before["head"], "headAfter": after["head"] if after else None,
            "sourceUnchanged": bool(after and after["files"] == before["files"]),
            "wallSeconds": round(time.monotonic() - started, 3),
            "scratch": {"path": str(SCRATCH), "compatibilityException": policy.local_reason,
                        "peakBytes": peak_scratch, "peakMiB": round(peak_scratch / MIB, 2), "removed": scratch_removed},
            "process": {"pid": process.pid if process else None, "processGroupEmpty": process_group_clear, "openFiles": open_files},
            "reservation": {"token": token, "diskBytes": reservation.get("disk") if reservation else None,
                            "ramBytes": reservation.get("ram") if reservation else None, "released": reservation_released},
            "log": str(LOG), "matrix": str(MATRIX) if MATRIX.exists() else None, "error": error,
        }
        RESOURCES.atomic_json(RECEIPT, receipt)
        manifest.update(
            state="removed" if scratch_removed and process_group_clear is True and reservation_released else "cleanup_incomplete",
            finished=time.time(), processGroupEmpty=process_group_clear, scratchRemoved=scratch_removed,
            reservationReleased=reservation_released, peakScratchBytes=peak_scratch, peakRssBytes=peak_rss,
            error=error, receipt=str(RECEIPT),
        )
        RESOURCES.atomic_json(MANIFEST, manifest)
        print(json.dumps(receipt, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
