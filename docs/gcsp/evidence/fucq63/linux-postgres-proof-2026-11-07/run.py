#!/usr/bin/env python3
"""One bounded Linux CI proof; no local execution, generic test framework or archive."""
import atexit
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[4]
PLAN = json.loads((BASE / "plan.json").read_text())
LIMIT = PLAN["resource"]
MIB = 1024 * 1024
assert sys.platform == "linux" and os.environ.get("GITHUB_ACTIONS") == "true"
run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
assert run_id.isdigit() and attempt.isdigit()
service = os.environ["PG_SERVICE_ID"]
assert re.fullmatch(r"[a-f0-9]{12,64}", service)
runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
identity = hashlib.sha256(f"f63-{run_id}-{attempt}".encode()).hexdigest()[:32]
owned = runner_temp / f"test-stamp-shard-{identity}"
control = REPO / ".claude/test-runs" / f"f63-linux-{run_id}-{attempt}"
manifest = control.with_name(control.name + "-ownership.json")
cleanup_only = sys.argv[1:] == ["--cleanup-only"]
assert not sys.argv[1:] or cleanup_only
children = []
phases = []
peak_root = peak_group = 0
started = time.monotonic()
root_inode = None
cleaned = False
result = {"status": "failed", "stage": "initializing", "acceptance": False}

def save(path, value):
    data = (json.dumps(value, indent=2) + "\n").encode()
    assert len(data) <= LIMIT["retainedReceiptLimitBytes"]
    path.write_bytes(data)

def docker(*args, timeout=10):
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)

def service_identity():
    observed = docker("inspect", service)
    assert observed.returncode == 0 and len(observed.stdout) < 65536
    value = json.loads(observed.stdout)[0]
    assert value["Id"].startswith(service) and value["State"]["Running"]
    assert value["Config"]["Image"] == "postgres:16"
    host = value["HostConfig"]
    assert host["Memory"] == LIMIT["postgresContainerMiB"] * MIB
    assert host["PortBindings"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": "5432"}]
    assert host["Tmpfs"].get("/var/lib/postgresql/data") == "rw,size=192m"
    assert all(mount["Type"] == "tmpfs" for mount in value["Mounts"])
    image = docker("image", "inspect", value["Image"])
    assert image.returncode == 0 and len(image.stdout) < 65536
    image_value = json.loads(image.stdout)[0]
    return {"id": value["Id"], "imageId": value["Image"], "configuredImage": value["Config"]["Image"],
            "repoDigests": image_value.get("RepoDigests", []), "startedAt": value["State"]["StartedAt"],
            "memoryLimitBytes": host["Memory"], "tmpfs": host["Tmpfs"], "ports": host["PortBindings"]}

def group_members(group):
    members = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            if int(fields[2]) == group and fields[0] != "Z":
                members.append((int(entry.name), int(fields[21]) * os.sysconf("SC_PAGE_SIZE")))
        except (OSError, ValueError, IndexError):
            continue
    return members

def stop_child(child):
    for action in (signal.SIGTERM, signal.SIGKILL):
        if not group_members(child.pid):
            break
        try:
            os.killpg(child.pid, action)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + 2
        while group_members(child.pid) and time.monotonic() < deadline:
            time.sleep(.1)
    child.wait(timeout=5)
    assert not group_members(child.pid), "owned child group remains"

def tree_bytes(path):
    total = 0
    if path.exists():
        for directory, _, files in os.walk(path, followlinks=False):
            for name in files:
                try:
                    total += (Path(directory) / name).lstat().st_size
                except FileNotFoundError:
                    pass
    return total

def cleanup():
    global cleaned
    if cleaned:
        return True
    cleaned = True
    issues = []
    for child in children:
        try:
            stop_child(child)
        except Exception:
            issues.append("owned-child-group-cleanup")
    for name in ("download.json", "orders.json"):
        path = owned / "receipts" / name
        if path.is_file():
            try:
                assert path.stat().st_size <= LIMIT["retainedReceiptLimitBytes"]
                document = json.loads(path.read_text())
                save(control / name, document)
                print(json.dumps({"receipt": name, "value": document}), flush=True)
            except Exception:
                issues.append("receipt-retention-" + name)
    claims = json.loads(manifest.read_text()).get("childGroups", []) if manifest.is_file() else []
    for claim in claims:
        group = claim["pid"]
        if not group_members(group):
            continue
        try:
            fields = (Path("/proc") / str(group) / "stat").read_text().rsplit(")", 1)[1].split()
            assert int(fields[19]) == claim["startTicks"], "process identity changed"
            os.killpg(group, signal.SIGTERM)
            deadline = time.monotonic() + 2
            while group_members(group) and time.monotonic() < deadline:
                time.sleep(.1)
            if group_members(group):
                os.killpg(group, signal.SIGKILL)
                deadline = time.monotonic() + 2
                while group_members(group) and time.monotonic() < deadline:
                    time.sleep(.1)
            assert not group_members(group), "claimed group remains"
        except Exception:
            issues.append("manifest-owned-group-unknown-or-live")
    groups_absent = not any(group_members(child.pid) for child in children) and not any(group_members(c["pid"]) for c in claims)
    removed = tree_bytes(owned)
    if owned.exists():
        try:
            st = owned.lstat()
            assert not owned.is_symlink() and root_inode == [st.st_dev, st.st_ino]
            assert owned.parent == runner_temp and owned.name == f"test-stamp-shard-{identity}"
            assert groups_absent
            shutil.rmtree(owned)
            assert not owned.exists()
        except Exception:
            issues.append("owned-root-cleanup")
    inspected = docker("inspect", service)
    if inspected.returncode == 0:
        removed_service = docker("rm", "--force", "--volumes", service, timeout=20)
        if removed_service.returncode != 0:
            issues.append("owned-service-removal")
    remaining = docker("ps", "-a", "--no-trunc", "--filter", "id=" + service, "--format", "{{.ID}}")
    absent_service = remaining.returncode == 0 and not remaining.stdout.strip()
    if not absent_service:
        issues.append("owned-service-still-present")
    receipt = {"status": "passed" if not issues else "failed", "issues": issues,
               "root": str(owned), "scratchAbsent": not owned.exists(), "removedWorkingBytes": removed,
               "serviceId": service, "serviceAbsent": absent_service, "tmpfsDataAbsentWithContainer": absent_service,
               "ownedGroupsAbsent": groups_absent, "ownedProcessOpenFilesAbsent": groups_absent,
               "installedEnvironmentPreserved": str(REPO / "server/node_modules"),
               "peakRunnerWorkingBytes": peak_root, "peakNodeGroupRssBytes": peak_group,
               "supervisorPeakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
               "compatibilityException": LIMIT["compatibilityException"], "acceptance": False}
    save(control / ("cleanup-confirmation.json" if cleanup_only else "cleanup.json"), receipt)
    print(json.dumps({"cleanup": receipt["status"], "scratchAbsent": receipt["scratchAbsent"],
                      "serviceAbsent": absent_service, "removedWorkingBytes": removed, "issues": issues}), flush=True)
    return not issues

# GitHub registers its service teardown before container creation. Register this
# finalizer before allocating any supervisor-owned scratch or proof process.
control.mkdir(parents=True, exist_ok=True)
atexit.register(cleanup)
for signum in (signal.SIGTERM, signal.SIGINT):
    signal.signal(signum, lambda *_: (_ for _ in ()).throw(InterruptedError("CI stop")))
if cleanup_only:
    if manifest.is_file():
        previous = json.loads(manifest.read_text())
        assert previous["root"] == str(owned) and previous["serviceId"] == service
        root_inode = previous.get("rootInode")
    sys.exit(0 if cleanup() else 1)
assert not owned.exists() and not manifest.exists()
save(manifest, {"root": str(owned), "serviceId": service, "owner": f"{run_id}-{attempt}",
                "rootInode": None, "resource": LIMIT, "childGroups": [], "finalizerRegistered": True})

def phase(name, command, seconds, cwd, env, output=None):
    global peak_root, peak_group
    assert time.monotonic() - started < LIMIT["supervisorSeconds"]
    result["stage"] = name
    print(json.dumps({"phase": name, "state": "start"}), flush=True)
    phase_start = time.monotonic()
    log_path = owned / (name + ".log")
    with log_path.open("wb") as log:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        try:
            fields = (Path("/proc") / str(child.pid) / "stat").read_text().rsplit(")", 1)[1].split()
            current = json.loads(manifest.read_text())
            current["childGroups"].append({"pid": child.pid, "startTicks": int(fields[19])})
            save(manifest, current)
        except FileNotFoundError:
            assert not group_members(child.pid)
        while child.poll() is None:
            rss = sum(value for _, value in group_members(child.pid))
            used = tree_bytes(owned) + tree_bytes(REPO / "server/node_modules")
            peak_group, peak_root = max(peak_group, rss), max(peak_root, used)
            assert rss <= LIMIT["nodeGroupRssMiB"] * MIB, "node group RAM budget"
            assert used <= LIMIT["runnerWorkingDataMiB"] * MIB, "working data budget"
            assert shutil.disk_usage(runner_temp).free >= LIMIT["minimumFreeMiB"] * MIB, "emergency reserve reached"
            assert log_path.stat().st_size <= LIMIT["boundedPhaseLogBytes"], "phase output budget"
            assert time.monotonic() - phase_start <= seconds, "phase deadline"
            assert time.monotonic() - started <= LIMIT["supervisorSeconds"], "run deadline"
            assert resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 <= LIMIT["supervisorRssMiB"] * MIB
            time.sleep(.5)
        code = child.wait()
    stop_child(child)
    assert log_path.stat().st_size <= LIMIT["boundedPhaseLogBytes"], "phase output budget"
    entry = {"phase": name, "exitCode": code, "seconds": round(time.monotonic() - phase_start, 3)}
    phases.append(entry)
    save(control / "progress.json", {"runtimeCommit": os.environ.get("GITHUB_SHA"), "manifestDigest": PLAN["releaseId"], "phases": phases, "acceptance": False})
    if code != 0:
        save(control / (name + "-failure.json"), {**entry, "boundedLog": log_path.read_text(errors="replace")[:LIMIT["boundedPhaseLogBytes"]]})
    assert code == 0, name + " failed"
    if output:
        value = json.loads(log_path.read_text())
        save(output, value)
    print(json.dumps({**entry, "state": "passed"}), flush=True)

try:
    assert shutil.disk_usage(runner_temp).free >= LIMIT["minimumFreeMiB"] * MIB, "5GiB reserve unavailable"
    for path, expected in PLAN["codePins"].items():
        assert hashlib.sha256((REPO / path).read_bytes()).hexdigest() == expected, path + " changed; review required"
    assert hashlib.sha256((BASE / "selection.json").read_bytes()).hexdigest() == PLAN["selectionSha256"]
    container = service_identity()
    owned.mkdir(mode=0o700)
    st = owned.stat(); root_inode = [st.st_dev, st.st_ino]
    current = json.loads(manifest.read_text()); current["rootInode"] = root_inode; save(manifest, current)
    (owned / "receipts").mkdir()
    env = {k: v for k, v in os.environ.items() if k not in {"GCSP_DATABASE_URL", "DATABASE_URL", "DEMO_ACCESS_KEY", "NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE"}}
    env.update({"TMPDIR": str(owned), "TMP": str(owned), "TEMP": str(owned), "NODE_OPTIONS": "--max-old-space-size=512", "PROOF_OUTPUT": str(owned / "receipts")})
    phase("npm-ci", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", str(owned / "npm-cache")], LIMIT["phaseSeconds"]["npm-ci"], REPO / "server", env)
    phase("restore", ["node", "scripts/fleet-artifacts.mjs", "restore", "--release", PLAN["releaseId"], "--store", str(owned / "store"), "--cache", str(owned / "cache"), "--network", "download"], LIMIT["phaseSeconds"]["restore"], REPO / "server", env, owned / "receipts/download.json")
    restored = json.loads((owned / "receipts/download.json").read_text())
    assert restored["status"] == "ok" and restored["mode"] == "cold-restore"
    assert restored["active"]["manifestDigest"] == PLAN["releaseId"] and restored["externalCalls"] <= PLAN["expected"]["maxRestoreFetches"]
    env["GCSP_DATABASE_URL"] = "postgresql://gcsp_ci_fixture@127.0.0.1:5432/gcsp_ci_fixture"
    phase("orders", ["node", str(BASE / "orders.mjs")], LIMIT["phaseSeconds"]["orders"], REPO, env)
    orders = json.loads((owned / "receipts/orders.json").read_text())
    assert orders["status"] == "passed" and orders["proof"]["nativeProof"] and orders["proof"]["checked"] == 3
    result.update({"status": "passed", "stage": "completed", "manifestDigest": PLAN["releaseId"], "container": container,
                   "nativeProof": orders["proof"]["nativeProof"], "checkedOrders": orders["proof"]["checked"], "postgresVersion": orders["postgresVersion"],
                   "seedRepositoryClosed": orders["seedRepositoryClosed"], "freshRepositoryOpened": orders["freshRepositoryOpened"], "ownedSchemaAbsent": orders["ownedSchemaAbsent"],
                   "runtimeCommit": os.environ.get("GITHUB_SHA"), "node": subprocess.check_output(["node", "--version"], text=True).strip(),
                   "phases": phases, "scope": "three native current-run order references; full F63 acceptance remains open",
                   "codePins": PLAN["codePins"], "acceptance": False})
except BaseException as error:
    failed_log = owned / (result["stage"] + ".log")
    if failed_log.is_file():
        with failed_log.open("rb") as stream:
            stream.seek(max(0, failed_log.stat().st_size - LIMIT["boundedPhaseLogBytes"]))
            failure_log = {"stage": result["stage"], "boundedLog": stream.read(LIMIT["boundedPhaseLogBytes"]).decode(errors="replace")}
            save(control / (result["stage"] + "-failure.json"), failure_log)
            print(json.dumps({"phaseFailure": failure_log}), flush=True)
    result.update({"status": "failed", "errorType": type(error).__name__, "reason": str(error)[:256] if isinstance(error, AssertionError) else None, "phases": phases, "acceptance": False})
finally:
    good_cleanup = cleanup()
    result["cleanupPassed"] = good_cleanup
    save(control / "result.json", result)
    impact = REPO / ".claude/test-runs/impact"
    impact.mkdir(parents=True, exist_ok=True)
    save(impact / (control.name + ".json"), {"runtimeCommit": os.environ.get("GITHUB_SHA"), "codePins": PLAN["codePins"], "selection": PLAN["testImpact"], "actualPhases": phases, "status": result["status"], "acceptance": False})
    print(json.dumps(result), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as stream:
            stream.write(f"F63 native three-order proof: {result['status']}. Cleanup: {good_cleanup}. Full acceptance: false.\n\n")
            stream.write("```json\n" + json.dumps(result, indent=2) + "\n```\n")
sys.exit(0 if result["status"] == "passed" and good_cleanup else 1)
