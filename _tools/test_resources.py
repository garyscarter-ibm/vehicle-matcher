"""Owned scratch, shared host reservations and resumable test checkpoints. Standard library only.

This supervisor bounds commands it launches. Global instructions also apply to one-off commands outside it;
this module is not a shell sandbox. All persisted identities hash environment values rather than logging them.
"""
import contextlib
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

VERSION = "1.0.1"
MIB = 1024 ** 2
GIB = 1024 ** 3
LARGE = 256 * MIB


class ResourceError(RuntimeError):
    pass


class CapacityError(ResourceError):
    def __init__(self, message, headroom):
        super().__init__(message)
        self.headroom = headroom


@contextlib.contextmanager
def handled_termination():
    """Let the supervisor's normal finalizers run for SIGTERM as well as Ctrl-C."""
    main = threading.current_thread() is threading.main_thread()
    previous = signal.getsignal(signal.SIGTERM) if main else None

    def interrupt(signum, frame):
        raise KeyboardInterrupt("test supervisor received SIGTERM")

    if main:
        signal.signal(signal.SIGTERM, interrupt)
    try:
        yield
    finally:
        if main:
            signal.signal(signal.SIGTERM, previous)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, sort_keys=True, separators=(",", ":"))
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def locked(path):
    """Acquire immediately; workload never waits indefinitely for another launcher."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        deadline = time.monotonic() + 2
        while True:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ResourceError("resource accounting is busy: %s; retry this chunk or do independent work" % path)
                time.sleep(0.02)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def process_identity(pid):
    try:
        p = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart="],
                           capture_output=True, text=True, timeout=3)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def process_alive(owner):
    pid = owner.get("pid", 0)
    if not isinstance(pid, int) or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    current = process_identity(pid)
    return current is None or not owner.get("start") or current == owner["start"]


def owner():
    return {"pid": os.getpid(), "start": process_identity(os.getpid())}


def allocated_bytes(root):
    total = 0
    if not os.path.lexists(root):
        return total
    for folder, dirs, files in os.walk(root, followlinks=False):
        for name in files + dirs:
            try:
                s = os.lstat(os.path.join(folder, name))
                total += max(s.st_size, getattr(s, "st_blocks", 0) * 512)
            except FileNotFoundError:
                pass
    return total


def available_memory():
    """Conservative available RAM, or None when the host does not expose it."""
    try:
        if Path("/proc/meminfo").is_file():
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
        p = subprocess.run(["/usr/bin/vm_stat"], capture_output=True, text=True, timeout=3)
        lines = p.stdout.splitlines()
        page = int(lines[0].split("page size of ")[1].split()[0])
        counts = {line.split(":")[0]: int(line.split(":")[1].strip().rstrip("."))
                  for line in lines[1:] if ":" in line}
        return page * sum(counts.get(k, 0) for k in ("Pages free", "Pages inactive", "Pages purgeable"))
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return None


class Policy:
    def __init__(self, raw=None):
        raw = raw or {}
        if not isinstance(raw, dict):
            raise ResourceError('"tests.resources" must be an object')
        defaults = {"preferred_free_gib": 30, "reserve_free_gib": 5, "chunk_scratch_mib": 2048,
                    "chunk_seconds": 600, "unit_scratch_mib": 32, "unit_ram_mib": 256,
                    "chunk_ram_mib": 2048, "log_mib": 2, "ram_reserve_mib": 512}
        for name, default in defaults.items():
            value = raw.get(name, default)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
                raise ResourceError('"tests.resources.%s" must be positive' % name)
            setattr(self, name, value)
        self.scratch_limit = int(self.chunk_scratch_mib * MIB)
        self.reserve = int(self.reserve_free_gib * GIB)
        self.preferred = int(self.preferred_free_gib * GIB)
        self.local_reason = raw.get("local_scratch_reason", "")
        self.output_root = raw.get("output_root", str(Path.home() / "Library/CloudStorage/OneDrive-IBM/Claude"))
        self.source_root = raw.get("source_root", str(Path.home() / "Claude"))
        self.inputs = raw.get("inputs", [])
        self.estimates = raw.get("estimates", {})
        if not all(isinstance(p, str) for p in (self.local_reason, self.output_root, self.source_root)):
            raise ResourceError("resource paths and local_scratch_reason must be strings")
        if not isinstance(self.inputs, list) or not all(isinstance(p, str) for p in self.inputs):
            raise ResourceError("resources.inputs must be a list of input paths")
        if not isinstance(self.estimates, dict):
            raise ResourceError("resources.estimates must be an object keyed by test id")

    def destination(self, project, run, relative):
        relative = Path(relative)
        if relative.is_absolute() or ".." in relative.parts:
            raise ResourceError("output path must stay relative to its destination")
        base = Path(self.output_root).expanduser().resolve()
        if not base.is_dir() or not os.access(base, os.W_OK):
            raise ResourceError("large output destination unavailable: %s; continue suitable small work" % base)
        project = Path(project).resolve()
        try:
            prefix = project.relative_to(Path(self.source_root).expanduser().resolve())
        except ValueError:
            prefix = Path("_agent-output") / project.name / run
        dest = (base / prefix / relative).resolve()
        if base not in dest.parents:
            raise ResourceError("output path escapes configured OneDrive root")
        return dest


class HostBudget:
    """Both harnesses use this registry, independent of project and checkout."""
    def __init__(self, policy, directory=None):
        self.policy = policy
        self.directory = Path(directory or os.environ.get("TEST_RESOURCE_HOST_DIR") or
                              Path.home() / ".cache/agent-scaffolding/test-resources")
        self.path = self.directory / "reservations.json"

    def _dead_owners(self):
        """Probe process identities outside the reservation lock; an OS query can take seconds."""
        data = read_json(self.path, {}) or {}
        return {k: v["owner"] for k, v in data.items() if not process_alive(v["owner"])}

    def _live(self, dead):
        data = read_json(self.path, {}) or {}
        # A reservation created or replaced after the probe must remain charged.
        return {k: v for k, v in data.items() if k not in dead or v["owner"] != dead[k]}

    def _usage(self, live, token, field):
        entry = live[token]
        used = entry.get(field, 0)
        for child, data in live.items():
            if data.get("parent") != token:
                continue
            # Disk under an ancestor scratch tree is included by its directory measurement; process groups are disjoint.
            contained = (field == "used" and entry.get("root") and data.get("root") and
                         os.path.commonpath([entry["root"], data["root"]]) == entry["root"])
            if not contained:
                used += self._usage(live, child, field)
        return used

    def _capacity(self, live, free, memory):
        parent = os.environ.get("TEST_RESOURCE_PARENT_RESERVATION")
        parent = parent if parent in live else None
        roots = [k for k, v in live.items() if v.get("parent") not in live]
        ancestor = parent
        while ancestor and live[ancestor].get("parent") in live:
            ancestor = live[ancestor]["parent"]
        outside = [k for k in roots if k != ancestor]
        reserved = sum(max(0, live[k]["disk"] - self._usage(live, k, "used")) for k in outside)
        ram_reserved = sum(max(0, live[k]["ram"] - self._usage(live, k, "rss")) for k in outside)
        disk = max(0, free - self.policy.reserve - reserved)
        ram = None if memory is None else max(0, memory - ram_reserved - int(self.policy.ram_reserve_mib * MIB))
        if parent:
            children = [k for k, v in live.items() if v.get("parent") == parent]
            disk_pending = sum(max(0, live[k]["disk"] - self._usage(live, k, "used")) for k in children)
            ram_pending = sum(max(0, live[k]["ram"] - self._usage(live, k, "rss")) for k in children)
            disk = min(disk, max(0, live[parent]["disk"] - self._usage(live, parent, "used") - disk_pending))
            inherited_ram = max(0, live[parent]["ram"] - self._usage(live, parent, "rss") - ram_pending)
            ram = inherited_ram if ram is None else min(ram, inherited_ram)
        return {"free": free, "disk": disk, "ram": ram, "active": len(roots),
                "low": free < self.policy.preferred, "parent": parent}

    def headroom(self, volume):
        dead = self._dead_owners()
        free, memory = shutil.disk_usage(volume).free, available_memory()
        with locked(self.directory / "reservations.lock"):
            live = self._live(dead)
            atomic_json(self.path, live)
            return self._capacity(live, free, memory)

    def acquire(self, token, disk, ram, volume, root=None, minimum_disk=None, minimum_ram=None):
        dead, identity = self._dead_owners(), owner()
        free, memory = shutil.disk_usage(volume).free, available_memory()
        with locked(self.directory / "reservations.lock"):
            live = self._live(dead)
            capacity = self._capacity(live, free, memory)
            needed_disk = disk if minimum_disk is None else minimum_disk
            needed_ram = ram if minimum_ram is None else minimum_ram
            if needed_disk > capacity["disk"]:
                raise CapacityError("chunk needs %d bytes above the %d-byte emergency reserve; available %d" %
                                    (needed_disk, self.policy.reserve, capacity["disk"]), capacity)
            if capacity["ram"] is not None and needed_ram > capacity["ram"]:
                raise CapacityError("chunk needs %d bytes RAM; available %d; shrink or serialize it" %
                                    (needed_ram, capacity["ram"]), capacity)
            disk = min(disk, capacity["disk"])
            ram = ram if capacity["ram"] is None else min(ram, capacity["ram"])
            live[token] = {"owner": identity, "disk": disk, "ram": ram, "used": 0, "rss": 0,
                           "parent": capacity["parent"], "root": str(root) if root else None}
            atomic_json(self.path, live)
            return {"disk": disk, "ram": ram}

    def update(self, token, used, rss):
        try:
            with locked(self.directory / "reservations.lock"):
                live = read_json(self.path, {}) or {}
                if token in live:
                    live[token].update(used=used, rss=rss)
                    atomic_json(self.path, live)
                return True
        except ResourceError:
            # The reservation stays fully charged. Retry telemetry at the next sample without aborting owned work.
            return False

    def release(self, token):
        with locked(self.directory / "reservations.lock"):
            live = read_json(self.path, {}) or {}
            live.pop(token, None)
            atomic_json(self.path, live)


def group_has_live_members(pgid):
    """Return None for an uncertain ps query; only a complete snapshot can prove no live members."""
    try:
        snapshot = subprocess.run(["/bin/ps", "-axo", "pgid=,stat="],
                                  capture_output=True, text=True, timeout=3)
        if snapshot.returncode != 0 or snapshot.stderr or not snapshot.stdout.strip():
            return None
        live = False
        for line in snapshot.stdout.splitlines():
            parts = line.split()
            if (len(parts) != 2 or not parts[0].isascii() or not parts[0].isdigit() or
                    parts[1][0] not in "RSDTtWXZIU" or any(c not in "+<>AELNSsVWXl" for c in parts[1][1:])):
                return None
            if int(parts[0]) == pgid and not parts[1].startswith("Z"):
                live = True
        return live
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def stop_group(process):
    """Each supervised process owns a session, including its normally spawned descendants."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        except PermissionError as error:
            # macOS returns EPERM for zombie-only groups. Never hide denied signals to live/unknown groups.
            if error.errno != errno.EPERM or group_has_live_members(process.pid) is not False:
                raise
            break
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            continue
        if sig == signal.SIGTERM:
            # The leader may exit before one of its children; the owned group still needs the second signal.
            continue
    process.wait()


def group_rss(pgid):
    try:
        p = subprocess.run(["/bin/ps", "-axo", "pgid=,rss="], capture_output=True, text=True, timeout=3)
        return sum(int(parts[1]) * 1024 for line in p.stdout.splitlines()
                   if len(parts := line.split()) == 2 and parts[0] == str(pgid))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0


class Scratch:
    def __init__(self, rdir, project, policy, expected=0, checkpoint=None):
        self.token = uuid.uuid4().hex
        self.manifest = Path(rdir) / "ownership" / (self.token + ".json")
        if expected >= LARGE and not policy.local_reason:
            self.root = policy.destination(project, self.token, Path(".agent-scratch") /
                                           ("test-stamp-shard-" + self.token))
            location = "cloud"
        else:
            # Nested macOS TMPDIR paths exceed local IPC socket limits used by Node and browser tools.
            base = Path("/private/tmp") if sys.platform == "darwin" else Path(tempfile.gettempdir()).resolve()
            self.root = base / ("test-stamp-shard-" + self.token)
            location = "local"
        self.record = {"version": 1, "owner": owner(), "token": self.token, "root": str(self.root),
                       "state": "planned", "groups": [], "peak": 0, "local_scratch_reason": policy.local_reason,
                       "created": time.time(), "location": location,
                       "checkpoint": str(Path(checkpoint).resolve()) if checkpoint else None}

    def __enter__(self):
        atomic_json(self.manifest, self.record)
        try:
            self.root.parent.mkdir(parents=True, exist_ok=True)
            self.root.mkdir(mode=0o700)
            s = self.root.lstat()
            self.record.update(state="active", device=s.st_dev, inode=s.st_ino)
            atomic_json(self.manifest, self.record)
        except BaseException:
            if "inode" in self.record:
                self.__exit__(*sys.exc_info())
            raise
        return self

    def env(self, env):
        out = dict(env)
        out.update(dict.fromkeys(("TMPDIR", "TMP", "TEMP"), str(self.root)))
        return out

    def child(self, process):
        self.record["groups"].append(process.pid)
        atomic_json(self.manifest, self.record)

    def sample(self):
        used = allocated_bytes(self.root)
        self.record["peak"] = max(self.record["peak"], used)
        return used

    def __exit__(self, kind, value, tb):
        self.sample()
        if self.root.is_symlink():
            raise ResourceError("owned scratch was replaced by a symlink: %s" % self.root)
        if self.root.exists():
            s = self.root.lstat()
            if (s.st_dev, s.st_ino) != (self.record["device"], self.record["inode"]):
                raise ResourceError("owned scratch identity changed: %s" % self.root)
            shutil.rmtree(self.root)
        if os.path.lexists(self.root):
            raise ResourceError("scratch cleanup incomplete: %s" % self.root)
        self.record.update(state="removed", removed=time.time())
        atomic_json(self.manifest, self.record)


def reconcile(manifest):
    """Only an externally recorded, abandoned root with no live owners/groups/open files is removable."""
    record = read_json(manifest)
    if not record or record.get("version") != 1:
        raise ResourceError("invalid ownership manifest: %s" % manifest)
    root = Path(record["root"])
    if not root.is_absolute() or root.name != "test-stamp-shard-" + record["token"]:
        raise ResourceError("invalid owned scratch path: %s" % root)
    if process_alive(record["owner"]):
        raise ResourceError("scratch owner is still active: %s" % root)
    for group in record["groups"]:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            continue
        except PermissionError as error:
            if error.errno != errno.EPERM or group_has_live_members(group) is not False:
                raise
            continue
        raise ResourceError("owned process group is still active: %s" % group)
    if os.path.lexists(root):
        if root.is_symlink():
            raise ResourceError("scratch root is a symlink: %s" % root)
        s = root.lstat()
        if (s.st_dev, s.st_ino) != (record.get("device"), record.get("inode")):
            raise ResourceError("scratch identity is uncertain: %s" % root)
        lsof = shutil.which("lsof") or "/usr/sbin/lsof"
        try:
            p = subprocess.run([lsof, "-t", "+D", str(root)], capture_output=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            raise ResourceError("cannot establish open-file status: %s" % root)
        if p.returncode != 1 or p.stdout or p.stderr:
            raise ResourceError("scratch has open files or uncertain status: %s" % root)
        shutil.rmtree(root)
    record.update(state="removed", reconciled=time.time())
    atomic_json(manifest, record)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Checkpoint:
    def __init__(self, rdir, identity, units, resume=False):
        self.identity = identity
        self.path = Path(rdir) / "checkpoints" / (digest(identity) + ".json")
        previous = read_json(self.path)
        selected = [u["id"] for u in units]
        if resume and previous and (previous.get("identity") != identity or previous.get("selected") != selected):
            raise ResourceError("checkpoint identity/plan mismatch; start a new run")
        self.data = previous if resume and previous else {"version": 1, "identity": identity, "units": units,
                                                         "selected": selected, "completed": {}, "issues": [],
                                                         "state": "incomplete"}

    def save(self):
        self.data["updated"] = time.time()
        atomic_json(self.path, self.data)

    def completed(self, ids, result):
        self.data["completed"][digest(ids)] = {"ids": ids, "result": result}
        self.save()

    def pending(self):
        done = {uid for c in self.data["completed"].values() for uid in c["ids"]}
        return [u for u in self.data["units"] if u["id"] not in done]


def run_process(command, cwd, env, log, scratch, policy, disk_limit, ram_limit, timeout, host=None, cancel=None):
    """Run one owned group, sample allocation, and always stop/join the group before scratch teardown."""
    start = time.monotonic()
    issue, issue_kind, peak_rss = None, None, 0
    log = Path(log)
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "w", encoding="utf-8") as output:
        child_env = scratch.env(env)
        if host:
            child_env["TEST_RESOURCE_PARENT_RESERVATION"] = scratch.token
        process = subprocess.Popen(command, cwd=cwd, env=child_env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            scratch.child(process)
            while process.poll() is None:
                used = scratch.sample()
                rss = group_rss(process.pid)
                peak_rss = max(peak_rss, rss)
                if host:
                    host.update(scratch.token, used, rss)
                if cancel is not None and cancel.is_set():
                    issue = "launcher cancelled; checkpoint remains incomplete"
                elif used > disk_limit:
                    issue = "scratch exceeded %d-byte chunk budget (measured %d)" % (disk_limit, used)
                elif used >= LARGE and not policy.local_reason and scratch.record["location"] == "local":
                    issue = "unplanned large scratch requires the configured OneDrive destination"
                    issue_kind = "output_location"
                elif rss > ram_limit:
                    issue = "RAM exceeded %d-byte chunk budget (measured %d)" % (ram_limit, rss)
                elif shutil.disk_usage(scratch.root).free < policy.reserve:
                    issue = "free space reached the %d-byte emergency reserve" % policy.reserve
                elif time.monotonic() - start > timeout:
                    issue = "chunk exceeded %.0f-second timeout" % timeout
                elif log.stat().st_size > int(policy.log_mib * MIB):
                    issue = "chunk output exceeded bounded log allowance"
                if issue:
                    break
                time.sleep(0.2)
        finally:
            stop_group(process)
    used = scratch.sample()
    if not issue and used > disk_limit:
        issue = "scratch exceeded %d-byte chunk budget (measured %d)" % (disk_limit, used)
    if not issue and used >= LARGE and not policy.local_reason and scratch.record["location"] == "local":
        issue, issue_kind = "unplanned large scratch requires the configured OneDrive destination", "output_location"
    # Keep useful failure output bounded even if a child wrote a burst between samples.
    cap = int(policy.log_mib * MIB)
    if log.stat().st_size > cap:
        with open(log, "rb") as f:
            f.seek(-cap, os.SEEK_END)
            tail = f.read()
        with open(log, "wb") as f:
            f.write(tail)
    return {"rc": process.returncode, "wall": time.monotonic() - start, "issue": issue,
            "issue_kind": issue_kind,
            "peak_scratch": scratch.record["peak"], "peak_rss": peak_rss,
            "manifest": str(scratch.manifest), "log": str(log)}


def choose_chunk(units, policy, headroom):
    """Pack independent units within the current disk/RAM/duration target. An atomic long unit stays intact."""
    disk = min(policy.scratch_limit, headroom["disk"])
    ram = min(int(policy.chunk_ram_mib * MIB), headroom["ram"]) if headroom["ram"] is not None else \
        int(policy.chunk_ram_mib * MIB)
    chosen, planned_disk, seconds = [], 0, 0
    for unit in units:
        if unit["disk"] > disk or unit["ram"] > ram:
            continue
        if chosen and (planned_disk + unit["disk"] > disk or seconds + unit["seconds"] > policy.chunk_seconds):
            continue
        chosen.append(unit)
        planned_disk += unit["disk"]
        seconds += unit["seconds"]
        if seconds >= policy.chunk_seconds:
            break
    return chosen


def execute(units, identity, project, rdir, log_dir, policy, jobs, callback, split=None,
            resume=False, say=print):
    """Run adaptive chunks. callback owns no persistent data; completion is recorded after verified teardown.

    callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel) returns a compact result dict.
    A resource-limited chunk is subdivided once per unit boundary; indivisible work remains explicitly incomplete.
    """
    host = HostBudget(policy)
    checkpoint_path = Path(rdir) / "checkpoints" / (digest(identity) + ".json")
    cancelled = threading.Event()
    with handled_termination(), locked(str(checkpoint_path) + ".lock"):
        checkpoint = Checkpoint(rdir, identity, units, resume)
        checkpoint.data.update(state="incomplete", issues=[])
        if resume:
            for manifest in sorted((Path(rdir) / "ownership").glob("*.json")):
                record = read_json(manifest, {}) or {}
                if record.get("checkpoint") != str(checkpoint.path.resolve()) or record.get("state") == "removed":
                    continue
                try:
                    reconcile(manifest)
                    say("  reconciled abandoned scratch: %s" % record["root"])
                except ResourceError as error:
                    issue = "cleanup unresolved (%s): %s" % (manifest, error)
                    checkpoint.data["issues"].append(issue)
                    say("INCOMPLETE: " + issue)
        checkpoint.save()
        say("checkpoint: %s%s" % (checkpoint.path, " (resume)" if resume else ""))
        pending = checkpoint.pending()
        active, attempted, deferred, replans, cloud_retry = {}, set(), set(), {}, set()
        sequence = len(checkpoint.data["completed"])
        start = time.monotonic()

        def shrink(unit):
            if split is None or unit["id"] in attempted:
                return False
            attempted.add(unit["id"])
            parts = split(unit)
            if not parts or [p["id"] for p in parts] == [unit["id"]]:
                return False
            index = checkpoint.data["units"].index(unit)
            checkpoint.data["units"][index:index + 1] = parts
            pending.remove(unit)
            pending.extend(parts)
            checkpoint.save()
            say("  split %s into %d independent units" % (unit["id"], len(parts)))
            return True

        def invoke(chunk, scratch, log, disk_limit, ram_limit, timeout):
            try:
                with scratch:
                    result = callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancelled)
                result["cleanup"] = {"root": str(scratch.root), "removed": not os.path.lexists(scratch.root),
                                     "peak": scratch.record["peak"], "manifest": str(scratch.manifest),
                                     "local_scratch_reason": policy.local_reason}
                return result
            finally:
                host.release(scratch.token)

        pool = ThreadPoolExecutor(max_workers=max(1, jobs))
        try:
            while pending or active:
                headroom = host.headroom(tempfile.gettempdir())
                cap = 1 if headroom["low"] else jobs
                runnable = [u for u in pending if u["id"] not in deferred]
                while runnable and len(active) < cap:
                    if any(shrink(u) for u in list(runnable) if u["seconds"] > policy.chunk_seconds):
                        runnable = [u for u in pending if u["id"] not in deferred]
                        continue
                    chunk = choose_chunk(runnable, policy, headroom)
                    if not chunk:
                        if active:
                            break
                        if any(shrink(u) for u in list(runnable)):
                            runnable = [u for u in pending if u["id"] not in deferred]
                            continue
                        for u in runnable:
                            issue = ("indivisible %s needs %d scratch bytes and %d RAM bytes; current disk budget %d "
                                     "above emergency reserve, RAM budget %s" %
                                     (u["id"], u["disk"], u["ram"], headroom["disk"], headroom["ram"]))
                            say("INCOMPLETE: " + issue)
                            checkpoint.data["issues"].append(issue)
                            deferred.add(u["id"])
                        checkpoint.save()
                        break
                    expected = sum(u["disk"] for u in chunk)
                    try:
                        scratch = Scratch(rdir, project, policy, expected, checkpoint=checkpoint.path)
                    except ResourceError as error:
                        # Without the cloud tree, small independent units can still make progress locally.
                        if len(chunk) > 1:
                            for u in chunk:
                                u["seconds"] = max(u["seconds"], policy.chunk_seconds)
                            checkpoint.save()
                            continue
                        deferred.add(chunk[0]["id"])
                        checkpoint.data["issues"].append("%s: %s" % (chunk[0]["id"], error))
                        checkpoint.save()
                        say("INCOMPLETE: %s: %s" % (chunk[0]["id"], error))
                        runnable = [u for u in pending if u["id"] not in deferred]
                        continue
                    volume = scratch.root.parent
                    while not volume.exists():
                        volume = volume.parent
                    disk_limit = min(policy.scratch_limit, headroom["disk"])
                    ram_limit = min(int(policy.chunk_ram_mib * MIB), headroom["ram"]) \
                        if headroom["ram"] is not None else int(policy.chunk_ram_mib * MIB)
                    try:
                        limits = host.acquire(scratch.token, disk_limit, ram_limit, str(volume), root=scratch.root,
                                              minimum_disk=expected, minimum_ram=max(u["ram"] for u in chunk))
                    except CapacityError as error:
                        headroom = error.headroom
                        key = tuple(u["id"] for u in chunk)
                        replans[key] = replans.get(key, 0) + 1
                        if active:
                            break
                        if replans[key] > 2:
                            if any(shrink(u) for u in list(chunk)):
                                runnable = [u for u in pending if u["id"] not in deferred]
                                continue
                            checkpoint.data["issues"].append(str(error))
                            deferred.update(key)
                            checkpoint.save()
                            say("INCOMPLETE: " + str(error))
                            runnable = [u for u in pending if u["id"] not in deferred]
                        continue
                    disk_limit, ram_limit = limits["disk"], limits["ram"]
                    sequence += 1
                    log = Path(log_dir) / ("chunk-%04d.log" % sequence)
                    timeout = max(policy.chunk_seconds * 2, sum(u["seconds"] for u in chunk) * 1.5)
                    future = pool.submit(invoke, chunk, scratch, log, disk_limit, ram_limit, timeout)
                    active[future] = chunk
                    for u in chunk:
                        pending.remove(u)
                    say("  chunk %d: %d unit(s), %.0fs planned, %.1f MiB estimated scratch%s" %
                        (sequence, len(chunk), sum(u["seconds"] for u in chunk), expected / MIB,
                         "; low headroom: serial" if headroom["low"] else ""))
                    headroom = host.headroom(str(volume))
                    runnable = [u for u in pending if u["id"] not in deferred]
                if not active:
                    break
                finished, _ = wait(active, timeout=0.25, return_when=FIRST_COMPLETED)
                for future in finished:
                    chunk = active.pop(future)
                    try:
                        result = future.result()
                    except Exception as error:
                        result = {"issue": str(error), "rc": -1, "retryable": False}
                    if result.get("issue"):
                        pending.extend(chunk)
                        if result.get("issue_kind") == "output_location" and any(u["id"] not in cloud_retry for u in chunk):
                            for u in chunk:
                                u["disk"] = max(u["disk"], LARGE, result.get("peak_scratch", 0))
                                cloud_retry.add(u["id"])
                            checkpoint.save()
                            say("  retrying with scratch created directly in the OneDrive destination")
                        elif not result.get("retryable", True):
                            for u in chunk:
                                deferred.add(u["id"])
                            checkpoint.data["issues"].append(result["issue"])
                            checkpoint.save()
                            say("INCOMPLETE: " + result["issue"])
                        elif len(chunk) > 1:
                            # Split the group into single-unit chunks after a measured limit was exceeded.
                            for u in chunk:
                                u["seconds"] = max(u["seconds"], policy.chunk_seconds)
                            checkpoint.save()
                        elif not shrink(chunk[0]):
                            deferred.add(chunk[0]["id"])
                            checkpoint.data["issues"].append("%s: %s" % (chunk[0]["id"], result["issue"]))
                            checkpoint.save()
                            say("INCOMPLETE: %s: %s" % (chunk[0]["id"], result["issue"]))
                    else:
                        checkpoint.completed([u["id"] for u in chunk], result)
                        say("  completed %d unit(s), exit %d; scratch removed" % (len(chunk), result["rc"]))
            checkpoint.data["state"] = "complete" if not checkpoint.pending() and not checkpoint.data["issues"] else "incomplete"
            checkpoint.data["wall"] = round(time.monotonic() - start, 3)
            checkpoint.save()
        except BaseException:
            cancelled.set()
            checkpoint.data["state"] = "interrupted"
            checkpoint.save()
            raise
        finally:
            cancelled.set()
            pool.shutdown(wait=True)
        return checkpoint.data
