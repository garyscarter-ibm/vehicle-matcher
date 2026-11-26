#!/usr/bin/env python3
"""Shared test-stack state primitives. Standard library only; Python 3.9+.

Resource adapters (epic SCAF-66's hook point for per-project resources). The kit's default adapters are `postgres`,
`maven`, `node` and `build`, shipped beside this file in _tools/test_stack_adapters/ and enabled per project by
`test_stack.adapters` in .claude/scaffolding.json ({"adapters": {"postgres": {...}, "maven": {...}}}); a project gets
only the ones it lists. What the kit does not have, a project adds as an adapter of its own,
_tools/ext/test_stack/<name>.py listed in `extensions.test_stack`; it never forks this file or a kit adapter (a name already
in test_stack.adapters wins). Both kinds load through kit_ext.py and share one contract: NAME, add_commands(subparsers, ctx),
status(ctx) and gc(ctx). They are fault-isolated: an adapter that fails to import, lacks a function, or whose add_commands
raises is skipped with one stderr line (`extension test_stack/<name> skipped: <Kind>: <message>`); one whose status or gc
raises is reported as {"error": ...} in that command's JSON; the core commands and the other adapters carry on. The full
contract is references/extensions.md (project-scaffolding), section test_stack."""
import contextlib
import argparse
import copy
import datetime
import fcntl
import importlib.util
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from types import SimpleNamespace


VERSION = "1.2.1"

HERE = Path(os.path.abspath(os.path.dirname(__file__)))
_resource_spec = importlib.util.spec_from_file_location("agent_test_stack_resources", HERE / "test_resources.py")
if _resource_spec is None or _resource_spec.loader is None:
    raise ImportError("cannot load adjacent test_resources.py")
R = importlib.util.module_from_spec(_resource_spec)
_resource_spec.loader.exec_module(R)


DEFAULT_TTL = 24 * 60 * 60
MAX_SYMLINKS = 40
_KIND = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_ADAPTER_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
HELD_ENV = "AGENT_HEAVY_SLOT"
PARENT_ENV = "TEST_RESOURCE_PARENT_RESERVATION"
EX_TEMPFAIL = 75
GIB = 1024 ** 3


class StackError(RuntimeError):
    """A test-stack configuration or state operation failed."""


class RootRefusal(StackError):
    """A state path would enter a prohibited synced location."""


class _UnavailableReclaim(Exception):
    """A resource record cannot be safely removed without its adapter callback."""


def _machine_config(machine):
    if machine is None:
        machine = load_machine()
    elif isinstance(machine, (str, bytes, os.PathLike)):
        machine = load_machine(machine)
    if not isinstance(machine, dict):
        raise StackError("machine configuration must be an object")
    config = machine.get("test_stack", {})
    if config is None:
        config = {}
    if not isinstance(config, dict):
        raise StackError('machine "test_stack" configuration must be an object')
    return machine, config


def load_machine(path=None):
    """Load the machine profile, honoring the isolated test-stack config override."""
    if path is None:
        path = os.environ.get("AGENT_TEST_STACK_MACHINE")
    if path is None:
        path = os.path.join(os.path.expanduser("~"), ".config/agent-scaffolding/machine.json")
    path = os.path.expandvars(os.path.expanduser(os.fspath(path)))
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        raise StackError("cannot read machine configuration %s: %s" % (path, type(error).__name__))
    if not isinstance(value, dict):
        raise StackError("machine configuration must be a JSON object")
    return value


_CONFIG_VAR = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))")


def expand_path(value, name, env=None):
    """Expand a configured tool path: ``~``, ``$NAME``, ``${NAME}`` and ``${NAME:-default}`` (SCAF-81).

    One project record serves every machine: ``"${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/...}"`` follows CI's
    setup-java and falls back to the Mac's Homebrew JDK. ``:-`` uses the default when the variable is unset or empty,
    as in the shell. An unset variable with no default is an error naming it, never a literal ``$NAME`` path."""
    env = os.environ if env is None else env
    def substitute(match):
        variable = match.group(1) or match.group(3)
        current = env.get(variable)
        if match.group(2) is not None:
            return current if current else match.group(2)
        if current is None:
            raise StackError("%s names unset environment variable %s (give a default: ${%s:-/path})" %
                             (name, variable, variable))
        return current
    return os.path.expanduser(_CONFIG_VAR.sub(substitute, value))


def _absolute_lexical(path):
    """Expand a configured path and make it absolute without following symlinks."""
    value = os.path.expandvars(os.path.expanduser(os.fspath(path)))
    if not os.path.isabs(value):
        value = os.path.join(os.getcwd(), value)
    return os.path.normpath(value)


def _banned_roots(machine=None):
    machine, config = _machine_config(machine)
    del machine
    home = os.path.expanduser("~")
    roots = [os.path.join(home, "Library", "CloudStorage")]
    try:
        names = os.listdir(home)
    except OSError:
        names = []
    roots.extend(os.path.join(home, name) for name in names if name.casefold().startswith("onedrive"))
    configured = config.get("banned_roots", [])
    if configured is None:
        configured = []
    if not isinstance(configured, list) or not all(isinstance(item, (str, os.PathLike)) for item in configured):
        raise StackError('machine "test_stack.banned_roots" must be a list of paths')
    roots.extend(os.fspath(item) for item in configured)
    return [_absolute_lexical(root) for root in roots]


def _inside(candidate, root):
    candidate_folded = candidate.casefold().rstrip(os.sep) or os.sep
    root_folded = root.casefold().rstrip(os.sep) or os.sep
    if root_folded == os.sep.casefold():
        return candidate_folded.startswith(os.sep.casefold())
    return candidate_folded == root_folded or candidate_folded.startswith(root_folded + os.sep.casefold())


def _refuse_if_banned(candidate, banned):
    for root in banned:
        if _inside(candidate, root):
            raise RootRefusal("refusing state path inside a prohibited synced location")


def _lexical_resolve(path, banned):
    """Resolve symlinks one component at a time without statting a banned prefix."""
    value = os.path.expandvars(os.path.expanduser(os.fspath(path)))
    if not os.path.isabs(value):
        value = os.path.join(os.getcwd(), value)
    pending = value.split(os.sep)
    resolved = []
    links = 0
    while pending:
        part = pending.pop(0)
        if part in ("", "."):
            continue
        if part == "..":
            if resolved:
                resolved.pop()
            continue
        candidate = os.path.join(os.sep, *(resolved + [part]))
        _refuse_if_banned(candidate, banned)
        try:
            info = os.lstat(candidate)
        except (FileNotFoundError, NotADirectoryError):
            resolved.append(part)
            continue
        except OSError as error:
            raise RootRefusal("cannot safely inspect a state path component (%s)" % type(error).__name__)
        if not stat.S_ISLNK(info.st_mode):
            resolved.append(part)
            continue
        links += 1
        if links > MAX_SYMLINKS:
            raise RootRefusal("too many symlinks in state path")
        try:
            target = os.readlink(candidate)
        except OSError as error:
            raise RootRefusal("cannot safely read a state path symlink (%s)" % type(error).__name__)
        if os.path.isabs(target):
            resolved = []
        pending = target.split(os.sep) + pending
    final = os.path.join(os.sep, *resolved)
    _refuse_if_banned(final, banned)
    return final


def guard_path(raw, machine=None):
    """Return a lexically resolved absolute path, refusing banned roots before lstat."""
    if raw is None:
        raise StackError("a state path is required")
    return Path(_lexical_resolve(raw, _banned_roots(machine)))


def stack_root(raw=None, machine=None):
    """Choose and guard the shared local state root."""
    machine, config = _machine_config(machine)
    if raw is not None:
        candidate = raw
    elif os.environ.get("AGENT_TEST_STACK_DIR"):
        candidate = os.environ["AGENT_TEST_STACK_DIR"]
    elif config.get("state_root"):
        candidate = config["state_root"]
    elif sys.platform == "darwin":
        candidate = os.path.join(os.path.expanduser("~"), "Library/Caches/agent-scaffolding/test-stack")
    else:
        candidate = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"),
                                 "agent-scaffolding/test-stack")
    return guard_path(candidate, machine)


def _ensure_directory(path, machine=None):
    safe = guard_path(path, machine)
    safe.mkdir(parents=True, exist_ok=True)
    return safe


@contextlib.contextmanager
def file_lock(path, timeout=60, machine=None):
    """Take a bounded exclusive flock; the persistent empty lock file is never removed."""
    try:
        timeout_value = float(timeout)
    except (TypeError, ValueError, OverflowError):
        timeout_value = float("nan")
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout_value) or timeout_value < 0:
        raise StackError("lock timeout must be a non-negative number")
    timeout = timeout_value
    safe = guard_path(path, machine)
    _ensure_directory(safe.parent, machine)
    safe = guard_path(safe, machine)
    try:
        handle = open(safe, "a", encoding="utf-8")
    except OSError as error:
        raise StackError("cannot open lock file (%s)" % type(error).__name__)
    with handle:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise StackError("timed out waiting for lock %s" % safe)
                time.sleep(min(0.05, max(0.001, deadline - time.monotonic())))
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _process_snapshot():
    try:
        result = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,comm="], capture_output=True,
                                text=True, timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if result.returncode != 0 or result.stderr:
        return {}
    processes = {}
    for line in result.stdout.splitlines():
        parts = line.split(None, 2)
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        pid, parent = int(parts[0]), int(parts[1])
        processes[pid] = {"pid": pid, "ppid": parent, "comm": parts[2].strip()}
    return processes


def ancestors(pid=None):
    """Return process ids from pid (or this process) through its known parents, inclusive."""
    current = os.getpid() if pid is None else pid
    if isinstance(current, bool) or not isinstance(current, int) or current <= 0:
        raise StackError("process id must be a positive integer")
    processes = _process_snapshot()
    output = []
    seen = set()
    while current > 0 and current not in seen:
        seen.add(current)
        output.append(current)
        item = processes.get(current)
        if item is None:
            break
        current = item["ppid"]
    return output


def owner_for_pid(pid):
    """Return a validated process identity for a PID."""
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        raise StackError("owner PID must be a positive integer")
    start = R.process_identity(pid)
    if not start:
        raise StackError("owner PID %d is not a live process" % pid)
    return {"pid": pid, "start": start}


def _is_harness(comm):
    base = os.path.basename(comm)
    return base in ("claude", "codex") or "/share/claude/versions/" in comm


def select_owner(mode="session", owner_pid=None):
    """Choose the nearest harness process, the parent shell, or an explicitly validated PID."""
    if owner_pid is not None:
        return owner_for_pid(owner_pid)
    if mode == "shell":
        return owner_for_pid(os.getppid())
    if mode != "session":
        raise StackError('owner mode must be "session" or "shell"')
    processes = _process_snapshot()
    current = os.getpid()
    seen = set()
    while current > 0 and current not in seen:
        seen.add(current)
        item = processes.get(current)
        if item is None:
            break
        if _is_harness(item["comm"]):
            return owner_for_pid(current)
        current = item["ppid"]
    return owner_for_pid(os.getppid())


def _positive_ttl(ttl):
    try:
        ttl_value = float(ttl)
    except (TypeError, ValueError, OverflowError):
        ttl_value = float("nan")
    if isinstance(ttl, bool) or not isinstance(ttl, (int, float)) or not math.isfinite(ttl_value) or ttl_value <= 0:
        raise StackError("registry TTL must be a positive number")
    return ttl_value


class Registry:
    """Owner-leased keyed JSON records with safe, out-of-lock reclamation.

    Resource adapters provision through ``register(create=...)``: a creator claim
    protects the entire callback lifetime even if the resource owner dies first.
    Without a callback, registration records intent before external work but
    cannot infer or protect that work's lifetime.
    """

    def __init__(self, root, kind, reclaim=None, machine=None, record_only=False):
        if not isinstance(kind, str) or not _KIND.fullmatch(kind) or kind in (".", ".."):
            raise StackError("registry kind must be one safe path component")
        if reclaim is not None and not callable(reclaim):
            raise StackError("reclaim must be callable")
        if not isinstance(record_only, bool):
            raise StackError("record_only must be a boolean")
        self.machine = machine
        self.root = guard_path(root, machine)
        self.kind = kind
        self.reclaim = reclaim
        self.record_only = record_only
        self.path = guard_path(self.root / "registry" / (kind + ".json"), machine)
        self.lock_path = guard_path(self.root / "locks" / ("registry-" + kind + ".lock"), machine)

    def _load_unlocked(self):
        safe = guard_path(self.path, self.machine)
        try:
            with open(safe, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise StackError("cannot read registry %s (%s)" % (self.kind, type(error).__name__))
        if not isinstance(data, dict) or not all(isinstance(k, str) and isinstance(v, dict) for k, v in data.items()):
            raise StackError("registry %s is not a keyed object" % self.kind)
        return data

    def _snapshot(self):
        with file_lock(self.lock_path, machine=self.machine):
            return copy.deepcopy(self._load_unlocked())

    def _write_unlocked(self, records):
        safe = guard_path(self.path, self.machine)
        _ensure_directory(safe.parent, self.machine)
        R.atomic_json(safe, records)

    @staticmethod
    def _next_revision(record):
        record["revision"] = int(record.get("revision", 0)) + 1

    def _claim(self, name, snapshot, force=False, stale=False, claim_dead=False):
        token = uuid.uuid4().hex
        worker = R.owner()
        with file_lock(self.lock_path, machine=self.machine):
            records = self._load_unlocked()
            current = records.get(name)
            if current != snapshot:
                return None
            if current.get("status") == "reclaim-pending":
                active = current.get("reclaim_claim")
                if active and not claim_dead:
                    return None
            elif not (force or stale):
                return None
            claimed = copy.deepcopy(current)
            claimed["status"] = "reclaim-pending"
            claimed["reclaim_claim"] = {"token": token, "owner": worker}
            claimed.pop("reclaim_error", None)
            self._next_revision(claimed)
            records[name] = claimed
            self._write_unlocked(records)
            return claimed

    def _finish_claim(self, name, claimed, failed=None, reason=None):
        claim = claimed.get("reclaim_claim", {})
        token = claim.get("token")
        with file_lock(self.lock_path, machine=self.machine):
            records = self._load_unlocked()
            current = records.get(name)
            if not current or current.get("status") != "reclaim-pending":
                return False
            if (current.get("reclaim_claim", {}).get("token") != token or
                    current.get("revision") != claimed.get("revision")):
                return False
            if failed is None:
                del records[name]
            else:
                current.pop("reclaim_claim", None)
                current["reclaim_error"] = type(failed).__name__
                if reason is not None:
                    current["reclaim_reason"] = reason
                else:
                    current.pop("reclaim_reason", None)
                self._next_revision(current)
            self._write_unlocked(records)
            return failed is None

    def _attempt_reclaim(self, name, snapshot, force=False, now=None):
        creating = snapshot.get("create_claim")
        if creating and R.process_alive(creating.get("owner", {})):
            return False
        status = snapshot.get("status")
        claim_dead = False
        stale = False
        if status == "reclaim-pending":
            claim = snapshot.get("reclaim_claim")
            if claim:
                if R.process_alive(claim.get("owner", {})):
                    return False
                claim_dead = True
        elif not force:
            now = time.time() if now is None else now
            expired = snapshot.get("expires", 0) <= now
            # An unfinished creation whose creator died is stale even while its
            # longer-lived session owner remains alive and its TTL has not expired.
            if not creating and not expired and R.process_alive(snapshot.get("owner", {})):
                return False
            stale = True
        claimed = self._claim(name, snapshot, force=force, stale=stale, claim_dead=claim_dead)
        if claimed is None:
            return False
        try:
            if snapshot.get("reclaim_required", True) is False:
                pass
            elif self.reclaim is None:
                raise _UnavailableReclaim("reclaim callback unavailable")
            else:
                self.reclaim(copy.deepcopy(claimed))
        except _UnavailableReclaim as error:
            self._finish_claim(name, claimed, failed=error, reason="reclaim callback unavailable")
            return False
        except Exception as error:
            self._finish_claim(name, claimed, failed=error)
            return False
        return self._finish_claim(name, claimed)

    def _finish_creation(self, name, claim):
        with file_lock(self.lock_path, machine=self.machine):
            records = self._load_unlocked()
            current = records.get(name)
            # The immutable claim includes its creation revision. A touch may renew
            # the record meanwhile; preserve that renewal and clear only our claim.
            if (current is None or current.get("create_claim") != claim or
                    current.get("status") == "reclaim-pending"):
                return None
            current.pop("create_claim")
            self._next_revision(current)
            self._write_unlocked(records)
            return copy.deepcopy(current)

    def register(self, name, project="", run="", owner=None, meta=None, ttl=DEFAULT_TTL, create=None,
                 record_only=None):
        if not isinstance(name, str) or not name:
            raise StackError("registry name must be a non-empty string")
        if not isinstance(project, str) or not isinstance(run, str):
            raise StackError("registry project and run must be strings")
        if owner is None:
            owner = R.owner()
        if (not isinstance(owner, dict) or isinstance(owner.get("pid"), bool) or
                not isinstance(owner.get("pid"), int) or owner["pid"] <= 0 or
                not isinstance(owner.get("start"), str) or
                not owner["start"]):
            raise StackError("registry owner must contain a PID and process start identity")
        owner = {"pid": owner["pid"], "start": owner["start"]}
        if meta is None:
            meta = {}
        if not isinstance(meta, dict):
            raise StackError("registry metadata must be an object")
        ttl = _positive_ttl(ttl)
        if create is not None and not callable(create):
            raise StackError("create must be callable")
        if record_only is None:
            record_only = self.record_only
        if not isinstance(record_only, bool):
            raise StackError("record_only must be a boolean")

        # Reclaim stale keys before checking uniqueness; a concurrent registration still wins by lock order.
        self.read()
        created = time.time()
        record = {"name": name, "kind": self.kind, "project": project, "run": run,
                  "owner": copy.deepcopy(owner), "created": created, "expires": created + ttl,
                  "meta": copy.deepcopy(meta), "reclaim_required": not record_only, "revision": 1}
        if create is not None:
            record["create_claim"] = {"token": uuid.uuid4().hex, "owner": R.owner(), "revision": record["revision"]}
        with file_lock(self.lock_path, machine=self.machine):
            records = self._load_unlocked()
            if name in records:
                raise StackError("registry key already exists: %s" % name)
            records[name] = record
            self._write_unlocked(records)
        if create is not None:
            try:
                create(copy.deepcopy(record))
            finally:
                finished = self._finish_creation(name, record["create_claim"])
            if finished is not None:
                record = finished
        return copy.deepcopy(record)

    def read(self):
        records = self._snapshot()
        now = time.time()
        for name, record in records.items():
            self._attempt_reclaim(name, record, now=now)
        return self._snapshot()

    def gc(self):
        """Reclaim stale records and return the remaining keyed records."""
        return self.read()

    def touch(self, name, ttl=DEFAULT_TTL):
        ttl = _positive_ttl(ttl)
        with file_lock(self.lock_path, machine=self.machine):
            records = self._load_unlocked()
            record = records.get(name)
            if record is None:
                raise StackError("registry key does not exist: %s" % name)
            if record.get("status") == "reclaim-pending" or record.get("reclaim_claim"):
                raise StackError("registry key is reclaim-pending: %s" % name)
            updated = copy.deepcopy(record)
            updated["expires"] = time.time() + ttl
            self._next_revision(updated)
            records[name] = updated
            self._write_unlocked(records)
            return copy.deepcopy(updated)

    def drop(self, name):
        """Reclaim one named record; return true only when it was removed."""
        snapshot = self._snapshot().get(name)
        if snapshot is None:
            return False
        return self._attempt_reclaim(name, snapshot, force=True)


class Context:
    """Project and machine configuration plus the shared state root and owner choice.

    SCAF-32–34 adapters register per-kind reclaim callbacks with ``registry`` before
    provisioning resources through ``register(create=...)``. Its creator claim
    covers the callback lifetime; registration without a callback cannot protect
    subsequent external work. Core CLI metadata explicitly uses ``record_only=True``;
    inspecting an existing kind never changes its per-record reclaim requirement.
    """

    def __init__(self, project=None, machine=None, state_root=None):
        if project is None:
            project = os.getcwd()
        self.project_root = Path(_absolute_lexical(project))
        self.project = str(self.project_root)
        self.project_config = self._read_project_config(self.project_root / ".claude/scaffolding.json")
        stack_config = self.project_config.get("test_stack", {})
        if stack_config is None:
            stack_config = {}
        if not isinstance(stack_config, dict):
            raise StackError('project "test_stack" configuration must be an object')
        self.test_stack = stack_config
        self.machine, self.machine_test_stack = _machine_config(machine)
        self._state_root = state_root
        self._root = None
        self._registries = {}
        self._adapters = {}
        self._cache = None
        self._core = None
        self.owner = select_owner()

    @property
    def core(self):
        """Explicit adapter API using this loaded core's helpers and exceptions.

        Adjacent adapters must not load another core copy: its exception classes
        would differ from the classes caught by this dispatcher's error boundary.
        """
        if self._core is None:
            self._core = SimpleNamespace(
                StackError=StackError, resources=R, guard_path=guard_path,
                file_lock=file_lock, select_owner=select_owner, host_dir=host_dir, expand_path=expand_path,
                Slots=Slots, valid_nested_slot=_valid_nested_slot, heavy_run=heavy_run)
        return self._core

    @property
    def cache(self):
        """Reuse cache registries and their reclaim callbacks for this context."""
        if self._cache is None:
            self._cache = Cache(self)
        return self._cache

    @property
    def root(self):
        """Resolve and guard the root only when a state operation needs it."""
        if self._root is None:
            self._root = stack_root(self._state_root, self.machine)
        return self._root

    @staticmethod
    def _read_project_config(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                value = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise StackError("cannot read project scaffolding configuration (%s)" % type(error).__name__)
        if not isinstance(value, dict):
            raise StackError("project scaffolding configuration must be a JSON object")
        return value

    def registry(self, kind, reclaim=None, record_only=False):
        """Return a cached registry; adapters pass callbacks before recording their resources.

        SCAF-32–34 adapters must provision with ``register(create=...)`` and reuse
        these cached instances so status/gc keep their callbacks. Generic CLI
        metadata opts into ``record_only`` explicitly; existing resource records
        remain reclaimable according to their own ``reclaim_required`` field.
        """
        if kind not in self._registries:
            self._registries[kind] = Registry(self.root, kind, reclaim=reclaim, machine=self.machine,
                                              record_only=record_only)
        else:
            registry = self._registries[kind]
            if reclaim is not None:
                if not callable(reclaim):
                    raise StackError("reclaim must be callable")
                registry.reclaim = reclaim
            if not isinstance(record_only, bool):
                raise StackError("record_only must be a boolean")
            registry.record_only = record_only
        return self._registries[kind]



def _cache_component(value):
    if not isinstance(value, str) or not _KIND.fullmatch(value) or value.startswith("."):
        raise StackError("cache kind and key must be safe path components")
    return value


def _cache_json(inputs, tools):
    inputs = {} if inputs is None else inputs
    tools = {} if tools is None else tools
    if not isinstance(inputs, dict) or not isinstance(tools, dict):
        raise StackError("cache inputs and tools must be JSON objects")
    try:
        return json.dumps({"inputs": inputs, "tools": tools}, sort_keys=True,
                          separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError) as error:
        raise StackError("cache fingerprints must be JSON values") from error


def content_key(inputs, tools=None):
    """Hash caller-supplied fingerprints and tool versions in canonical order."""
    return hashlib.sha256(_cache_json(inputs, tools).encode("utf-8")).hexdigest()


class Cache:
    """Rebuildable keyed directories, with persistent locks and owner leases.

    Registry locks cover JSON operations only. Key locks serialize publication,
    consumer acquisition and eviction; builders never hold the stage or registry
    locks. Recorded links protect artifacts independently of session lifetime.
    """

    def __init__(self, ctx):
        self.ctx = ctx
        self.root = ctx.root / "cache"
        self.leases = ctx.registry("cache-leases", record_only=True)
        self.links = ctx.registry("links", reclaim=self._reclaim_link)
        self.stage_lock = ctx.root / "locks/cache-stages.lock"
        self.gc_lock = ctx.root / "locks/cache-gc.lock"

    def _path(self, kind, key):
        return self.root / _cache_component(kind) / _cache_component(key)

    def _lock(self, kind, key, timeout=60):
        digest = hashlib.sha256(json.dumps([kind, key]).encode("utf-8")).hexdigest()
        return file_lock(self.ctx.root / "locks" / ("cache-key-" + digest + ".lock"),
                         timeout=timeout, machine=self.ctx.machine)

    def _directory(self, path, create=False):
        # Reject symlinks before guard_path could resolve them into another tree.
        relative = path.relative_to(self.ctx.root)
        candidate = self.ctx.root
        for component in relative.parts:
            candidate = candidate / component
            try:
                info = os.lstat(candidate)
            except FileNotFoundError:
                if create:
                    try:
                        guard_path(candidate, self.ctx.machine).mkdir()
                    except FileExistsError:
                        # Different keys may create their shared parents concurrently.
                        if not stat.S_ISDIR(os.lstat(candidate).st_mode):
                            raise StackError("unsafe cache directory: %s" % candidate)
                    continue
                return False
            if not stat.S_ISDIR(info.st_mode):
                raise StackError("unsafe cache directory: %s" % candidate)
        return True

    @staticmethod
    def _json_file(path):
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode):
            raise StackError("unsafe cache metadata: %s" % path)
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)

    def _metadata(self, path, kind, key):
        if not self._directory(path):
            return None
        try:
            meta = self._json_file(path / ".meta.json")
            if (not isinstance(meta, dict) or meta.get("kind") != kind or meta.get("key") != key or
                    not isinstance(meta.get("inputs"), dict) or not isinstance(meta.get("tools"), dict)):
                raise ValueError("invalid cache metadata")
            _finite_number(meta.get("created"), "cache creation time")
            _finite_number(meta.get("size"), "cache output size")
            _cache_json(meta["inputs"], meta["tools"])
            return meta
        except (OSError, ValueError, TypeError) as error:
            raise StackError("invalid cache metadata: %s" % path) from error

    @staticmethod
    def _walk(path):
        # Do not follow any output symlink, including directory symlinks.
        with os.scandir(path) as entries:
            for entry in entries:
                child = path / entry.name
                info = entry.stat(follow_symlinks=False)
                yield child, info
                if stat.S_ISDIR(info.st_mode):
                    yield from Cache._walk(child)

    @staticmethod
    def _allocated(info):
        return max(info.st_size, getattr(info, "st_blocks", 0) * 512)

    @classmethod
    def _bytes(cls, path, outputs=False):
        """Publication size is logical output; inventory is retained allocation.

        Inventory includes this entry and every descendant, including symlinks
        themselves, using the same units as R.allocated_bytes. No target is followed.
        """
        if outputs:
            return sum(info.st_size for child, info in cls._walk(path)
                       if stat.S_ISREG(info.st_mode) and
                       child.relative_to(path).parts[0] not in (".owner.json", ".meta.json"))
        return cls._allocated(os.lstat(path)) + sum(cls._allocated(info) for _child, info in cls._walk(path))

    @classmethod
    def _readonly(cls, path):
        for child, info in cls._walk(path):
            if not stat.S_ISLNK(info.st_mode):
                os.chmod(child, info.st_mode & ~0o222)
        os.chmod(path, os.lstat(path).st_mode & ~0o222)

    @classmethod
    def _remove(cls, path):
        info = os.lstat(path)
        if not stat.S_ISDIR(info.st_mode):
            raise StackError("refusing to remove unsafe cache directory")
        os.chmod(path, info.st_mode | stat.S_IWUSR | stat.S_IXUSR)
        for child, child_info in cls._walk(path):
            if stat.S_ISDIR(child_info.st_mode):
                os.chmod(child, child_info.st_mode | stat.S_IWUSR | stat.S_IXUSR)
        shutil.rmtree(path)

    def _lease(self, kind, key, run, owner, ttl):
        os.utime(self._path(kind, key), None)
        record = self.leases.register(uuid.uuid4().hex, project=self.ctx.project, run=run,
                                      owner=self.ctx.owner if owner is None else owner,
                                      ttl=ttl, meta={"kind": kind, "key": key}, record_only=True)
        return record

    def ensure(self, kind, key, builder, inputs=None, tools=None, readonly=False, run="", owner=None,
               ttl=DEFAULT_TTL):
        path = self._path(kind, key)
        fingerprints = json.loads(_cache_json(inputs, tools))
        if not callable(builder) or not isinstance(readonly, bool):
            raise StackError("cache requires a builder and boolean readonly")
        with self._lock(kind, key):
            meta = self._metadata(path, kind, key)
            if meta is not None:
                lease = self._lease(kind, key, run, owner, ttl)
                return {"kind": kind, "key": key, "path": str(path), "lease": lease["name"], "cached": True}
            self._directory(path.parent, create=True)
            stage = path.parent / (".stage-" + uuid.uuid4().hex)
            published = False
            stage_owned = False
            try:
                with file_lock(self.stage_lock, machine=self.ctx.machine):
                    stage.mkdir()
                    stage_owned = True
                    R.atomic_json(stage / ".owner.json", {"kind": kind, "key": key, "owner": R.owner()})
                builder(stage)
                self._directory(stage)
                meta = dict(fingerprints, kind=kind, key=key, created=time.time(), size=self._bytes(stage, outputs=True))
                # A builder cannot make control files point outside its owned stage.
                for name in (".owner.json", ".meta.json"):
                    control = stage / name
                    if os.path.lexists(control) and not stat.S_ISREG(os.lstat(control).st_mode):
                        raise StackError("unsafe cache control file")
                R.atomic_json(stage / ".meta.json", meta)
                os.rename(stage, path)
                published = True
                (path / ".owner.json").unlink()
                if readonly:
                    self._readonly(path)
                lease = self._lease(kind, key, run, owner, ttl)
                return {"kind": kind, "key": key, "path": str(path), "lease": lease["name"], "cached": False}
            except BaseException:
                owned = path if published else stage
                if (published or stage_owned) and os.path.lexists(owned):
                    self._remove(owned)
                raise

    def lease(self, kind, key, run="", owner=None, ttl=DEFAULT_TTL):
        path = self._path(kind, key)
        with self._lock(kind, key):
            if self._metadata(path, kind, key) is None:
                raise StackError("cache key does not exist")
            return self._lease(kind, key, run, owner, ttl)

    def release(self, token):
        return self.leases.drop(token)

    def _live_link(self, record):
        meta = record.get("meta", {})
        target = self._path(meta.get("kind"), meta.get("key"))
        path = Path(meta["path"])
        try:
            # Relative targets start at the parent's filesystem identity, which
            # may differ from the recorded spelling through an ancestor alias.
            parent = path.parent.resolve(strict=True)
            if not parent.is_dir():
                raise StackError("recorded link parent is not a directory")
        except (OSError, RuntimeError) as error:
            raise StackError("cannot determine recorded link parent identity (%s)" %
                             type(error).__name__) from error
        actual = parent / path.name
        try:
            if not stat.S_ISLNK(os.lstat(actual).st_mode):
                return False
            value = os.readlink(actual)
        except FileNotFoundError:
            return False
        resolved = os.path.normpath(value if os.path.isabs(value) else str(parent / value))
        # Resolve no part of the target: artifact/output symlinks are not followed.
        return resolved == str(target) or resolved.startswith(str(target) + os.sep)

    def _reclaim_link(self, record):
        if self._live_link(record):
            raise StackError("recorded consumer link is still live")

    def record_link(self, kind, key, path, create=None, run="", owner=None, ttl=DEFAULT_TTL):
        final = self._path(kind, key)
        with self._lock(kind, key):
            if self._metadata(final, kind, key) is None:
                raise StackError("cache key does not exist")
            record = self.links.register(uuid.uuid4().hex, project=self.ctx.project, run=run,
                                         owner=self.ctx.owner if owner is None else owner, ttl=ttl,
                                         meta={"kind": kind, "key": key, "path": _absolute_lexical(path)},
                                         create=create, record_only=False)
            os.utime(final, None)
            return record

    def release_link(self, token):
        return self.links.drop(token)

    @staticmethod
    def _records(registry):
        return registry.read() if registry.path.exists() else {}

    def _protection(self):
        leases = self._records(self.leases)
        links = self._records(self.links)
        counts, linked, uncertain = {}, set(), {}
        for row in leases.values():
            meta = row.get("meta", {})
            pair = (meta.get("kind"), meta.get("key"))
            if row.get("expires", 0) > time.time() and R.process_alive(row.get("owner", {})):
                counts[pair] = counts.get(pair, 0) + 1
        for row in links.values():
            try:
                if self._live_link(row):
                    meta = row["meta"]
                    linked.add((meta["kind"], meta["key"]))
            except (KeyError, TypeError, OSError, StackError) as error:
                # An uncertain observation protects the key but is not checked-live.
                meta = row.get("meta", {})
                pair = (meta.get("kind"), meta.get("key"))
                uncertain.setdefault(pair, []).append({"kind": pair[0], "key": pair[1],
                    "link": row.get("name"), "path": meta.get("path"),
                    "error": "recorded link protection uncertain: %s" % error})
        return counts, linked, uncertain

    def _retained_error(self, path, error):
        """Report allocation that validation prevented us from reclaiming."""
        row = {"path": str(path), "error": str(error), "bytes": 0}
        try:
            info = os.lstat(path)
            if stat.S_ISDIR(info.st_mode):
                row["bytes"] = self._bytes(path)
            else:
                row["bytes"] = self._allocated(info)
        except OSError:
            row["allocation_unknown"] = True
        return row

    def _scan(self):
        keys, stages, errors = [], [], []
        directory_bytes = 0
        if not self._directory(self.root):
            return keys, stages, errors, directory_bytes
        for kind_dir in self.root.iterdir():
            try:
                kind = _cache_component(kind_dir.name)
                self._directory(kind_dir)
                directory_bytes += self._allocated(os.lstat(kind_dir))
                for path in kind_dir.iterdir():
                    try:
                        self._directory(path)
                        if path.name.startswith(".stage-"):
                            with file_lock(self.stage_lock, machine=self.ctx.machine):
                                try:
                                    owner = self._json_file(path / ".owner.json")
                                except FileNotFoundError:
                                    owner = None
                                except (OSError, ValueError, StackError):
                                    raise StackError("malformed stage owner")
                                info = os.lstat(path)
                            if owner is not None:
                                if not isinstance(owner, dict) or owner.get("kind") != kind:
                                    raise StackError("malformed stage owner")
                                _cache_component(owner.get("key"))
                                identity = owner.get("owner", {})
                                if (not isinstance(identity, dict) or not isinstance(identity.get("pid"), int) or
                                        not isinstance(identity.get("start"), str) or not identity["start"]):
                                    raise StackError("malformed stage creator")
                            stages.append({"kind": kind, "path": str(path), "owner": owner,
                                           "identity": [info.st_dev, info.st_ino], "bytes": self._bytes(path)})
                        else:
                            key = _cache_component(path.name)
                            meta = self._metadata(path, kind, key)
                            keys.append({"kind": kind, "key": key, "path": str(path),
                                         "bytes": self._bytes(path), "mtime": os.lstat(path).st_mtime,
                                         "meta": meta})
                    except FileNotFoundError:
                        continue  # A builder published, or another GC completed.
                    except (StackError, OSError, ValueError) as error:
                        errors.append(self._retained_error(path, error))
            except (StackError, OSError) as error:
                errors.append(self._retained_error(kind_dir, error))
        return keys, stages, errors, directory_bytes

    def _cap(self):
        return int(_finite_number(self.ctx.machine_test_stack.get("cache_cap_gib", 8), "cache cap") * GIB)

    def _inventory(self, keys, stages, errors, directory_bytes, protection):
        counts, linked, uncertain = protection
        kinds = {}
        for row in keys:
            pair = (row["kind"], row["key"])
            row["lease_count"] = counts.get(pair, 0)
            row["linked"] = pair in linked
            row["link_uncertain"] = pair in uncertain
            kind = kinds.setdefault(row["kind"], {"keys": [], "bytes": 0, "lease_count": 0})
            kind["keys"].append(row)
            kind["bytes"] += row["bytes"]
            kind["lease_count"] += row["lease_count"]
        stage_bytes = sum(row["bytes"] for row in stages) + sum(
            row.get("bytes", 0) for row in errors if Path(row["path"]).name.startswith(".stage-"))
        total = directory_bytes + sum(row["bytes"] for row in keys) + sum(row["bytes"] for row in stages) + sum(
            row.get("bytes", 0) for row in errors)
        cap = self._cap()
        # Diagnostics are separate from scan allocation; no retained bytes are
        # counted a second time merely because their link cannot be inspected.
        errors = errors + [error for group in uncertain.values() for error in group]
        return {"kinds": kinds, "stages": stages, "stage_bytes": stage_bytes,
                "directory_bytes": directory_bytes, "byte_units": "filesystem allocation",
                "total_bytes": total, "cap_bytes": cap, "overage_bytes": max(0, total - cap), "errors": errors}

    def status(self):
        protection = self._protection()
        return self._inventory(*self._scan(), protection)

    def _keep(self, kind, override):
        value = self.ctx.test_stack.get("cache_keep", 3) if override is None else override
        if isinstance(value, dict):
            value = value.get(kind, 3)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise StackError("cache keep must be a non-negative integer or kind map")
        return value

    def gc(self, keep=None, kinds=None):
        """Collect selected exact kinds, retaining global accounting and protections.

        ``None`` keeps the original global behavior. An explicit empty or unknown
        collection selects no candidates; excluded allocations still count toward
        the shared cap and any remaining overage is reported honestly.
        """
        if kinds is not None:
            if not isinstance(kinds, (list, tuple, set, frozenset)):
                raise StackError("cache kinds must be a collection of safe path components")
            kinds = {_cache_component(kind) for kind in kinds}
        result = {"removed": [], "kept": [], "busy": [], "errors": [],
                  "stages": {"removed": [], "kept": []}, "removed_keys": 0}
        if not self._directory(self.root):
            inventory = self.status()
            result.update({name: inventory[name] for name in ("total_bytes", "cap_bytes", "overage_bytes", "stage_bytes")})
            result["errors"].extend(inventory["errors"])
            return result
        with file_lock(self.gc_lock, machine=self.ctx.machine):
            keys, stages, errors, directory_bytes = self._scan()
            result["errors"].extend(errors)
            for row in stages:
                if kinds is not None and row["kind"] not in kinds:
                    result["stages"]["kept"].append(row["path"])
                    continue
                path, owner = Path(row["path"]), row["owner"]
                if owner is not None and R.process_alive(owner["owner"]):
                    result["stages"]["kept"].append(str(path))
                    continue
                key = owner["key"] if owner is not None else path.name
                try:
                    with self._lock(row["kind"], key, timeout=0):
                        with file_lock(self.stage_lock, machine=self.ctx.machine):
                            info = os.lstat(path)
                            current = self._json_file(path / ".owner.json") if owner is not None else None
                            if [info.st_dev, info.st_ino] != row["identity"] or current != owner:
                                continue
                            if owner is None and os.path.lexists(path / ".owner.json"):
                                continue
                        self._remove(path)
                        result["stages"]["removed"].append(str(path))
                except FileNotFoundError:
                    continue
                except StackError as error:
                    if "timed out waiting" in str(error):
                        result["busy"].append(str(path))
                    else:
                        result["errors"].append({"path": str(path), "error": str(error)})
                except OSError as error:
                    result["errors"].append({"path": str(path), "error": type(error).__name__})
            newest = {}
            for row in sorted(keys, key=lambda item: (-item["mtime"], item["path"])):
                newest.setdefault(row["kind"], []).append(row["key"])
            preferred = {(kind, key) for kind, values in newest.items()
                         if kinds is None or kind in kinds
                         for key in values[:self._keep(kind, keep)]}
            total = directory_bytes + sum(row["bytes"] for row in keys) + sum(row["bytes"] for row in stages
                    if row["path"] not in result["stages"]["removed"]) + sum(row.get("bytes", 0) for row in errors)
            for row in sorted(keys, key=lambda item: (item["mtime"], item["path"])):
                if kinds is not None and row["kind"] not in kinds:
                    result["kept"].append(row["path"])
                    continue
                path, pair = Path(row["path"]), (row["kind"], row["key"])
                try:
                    with self._lock(*pair, timeout=0):
                        if self._metadata(path, *pair) is None:
                            continue
                        counts, linked, uncertain = self._protection()
                        size = self._bytes(path)
                        total += size - row["bytes"]
                        if (counts.get(pair) or pair in linked or pair in uncertain or
                                (pair in preferred and total <= self._cap())):
                            result["kept"].append(str(path))
                            continue
                        self._remove(path)
                        total -= size
                        result["removed"].append(str(path))
                        result["removed_keys"] += 1
                except FileNotFoundError:
                    continue
                except StackError as error:
                    if "timed out waiting" in str(error):
                        result["busy"].append(str(path))
                    else:
                        result["errors"].append({"path": str(path), "error": str(error)})
                except OSError as error:
                    result["errors"].append({"path": str(path), "error": type(error).__name__})
            inventory = self.status()
            result.update({name: inventory[name] for name in ("total_bytes", "cap_bytes", "overage_bytes", "stage_bytes")})
            result["errors"].extend(error for error in inventory["errors"] if error not in result["errors"])
        return result


def host_dir(machine=None):
    """Return the guarded, machine-wide test-resource directory."""
    candidate = (os.environ.get("TEST_RESOURCE_HOST_DIR") or
                 os.path.join(os.path.expanduser("~"), ".cache/agent-scaffolding/test-resources"))
    return guard_path(candidate, machine)


def _finite_number(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or value < minimum:
        relation = "non-negative" if minimum == 0 else "positive"
        raise StackError("%s must be a finite %s number" % (name, relation))
    return float(value)


class Slots:
    """Machine-wide heavy slots; a stale probe cannot delete a replaced lease."""

    def __init__(self, directory=None, slots=None, machine=None, out=sys.stderr):
        self.machine, config = _machine_config(machine)
        value = config.get("heavy_slots", 1)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise StackError('machine "test_stack.heavy_slots" must be a positive integer')
        self.slots = value
        if slots is not None:
            print("[heavy] --slots is ignored; machine.test_stack.heavy_slots is authoritative", file=out, flush=True)
        self.directory = guard_path(directory or host_dir(self.machine), self.machine)
        self.path = guard_path(self.directory / "heavy-slots.json", self.machine)
        self.lock = guard_path(self.directory / "heavy-slots.lock", self.machine)
        self.out = out

    def _snapshot(self):
        safe = guard_path(self.path, self.machine)
        try:
            with open(safe, "r", encoding="utf-8") as handle:
                value = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise StackError("cannot read heavy-slot leases (%s)" % type(error).__name__)
        if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, dict)
                                                  for k, v in value.items()):
            raise StackError("heavy-slot leases are not a keyed object")
        return value

    def _update(self, mutate):
        snapshot = self._snapshot()
        dead = {}
        for token, lease in snapshot.items():
            owner = lease.get("owner")
            if isinstance(owner, dict) and not R.process_alive(owner):
                dead[token] = copy.deepcopy(lease)
        with file_lock(self.lock, timeout=30, machine=self.machine):
            leases = self._snapshot()
            for token, old in dead.items():
                if leases.get(token) == old:
                    del leases[token]
            result = mutate(leases)
            _ensure_directory(self.directory, self.machine)
            safe = guard_path(self.path, self.machine)
            R.atomic_json(safe, leases)
            return result

    def try_acquire(self, token, label, owner=None, project="", ram=0):
        if not isinstance(token, str) or not token:
            raise StackError("heavy token must be a non-empty string")
        if not isinstance(label, str) or not label or not isinstance(project, str):
            raise StackError("heavy label and project must be strings")
        ram_value = _finite_number(ram, "heavy RAM")
        if not ram_value.is_integer():
            raise StackError("heavy RAM must be a whole number of bytes")
        if owner is None:
            owner = R.owner()
        if (not isinstance(owner, dict) or isinstance(owner.get("pid"), bool) or
                not isinstance(owner.get("pid"), int) or owner["pid"] <= 0 or
                not isinstance(owner.get("start"), str) or not owner["start"]):
            raise StackError("heavy owner must contain a PID and process start identity")
        lease = {"owner": {"pid": owner["pid"], "start": owner["start"]}, "label": label,
                 "since": time.time(), "project": project, "ram": int(ram_value)}

        def take(leases):
            if token in leases:
                return False
            if len(leases) >= self.slots:
                return False
            leases[token] = copy.deepcopy(lease)
            return True
        return self._update(take)

    def release(self, token):
        return self._update(lambda leases: leases.pop(token, None))

    def holders(self):
        return self._update(lambda leases: copy.deepcopy(leases))


class Terminated(Exception):
    def __init__(self, signum):
        super().__init__("terminated by signal %d" % signum)
        self.signum = signum


def wait_for_slot(slots, budget, token, label, ram, wait_min, volume, out=sys.stderr, poll=1,
                  clock=time.monotonic, project=""):
    """Take a slot before RAM; release it while waiting for either resource."""
    ram = _finite_number(ram, "heavy RAM")
    wait_min = _finite_number(wait_min, "heavy wait")
    poll = _finite_number(poll, "heavy poll")
    deadline = clock() + wait_min * 60
    next_status = float("-inf")
    while True:
        if slots.try_acquire(token, label, owner=R.owner(), project=project, ram=int(ram * GIB)):
            if budget is None:
                return
            try:
                policy = budget.policy
                budget.acquire(token, policy.scratch_limit, int(ram * GIB), volume, minimum_disk=0)
                return
            except R.ResourceError as error:
                slots.release(token)
                reason = str(error)
        else:
            held = ", ".join("%s (pid %s)" % (v.get("label"), v.get("owner", {}).get("pid"))
                             for v in slots.holders().values())
            reason = "slot held by " + (held or "another run")
        now = clock()
        if now >= next_status:
            print("[heavy] waiting for %s: %s" % (label, reason), file=out, flush=True)
            next_status = now + 60
        if now >= deadline:
            raise StackError("heavy slot not available after %g min: %s" % (wait_min, reason))
        time.sleep(poll)


def _parse_clock(value):
    if not isinstance(value, str):
        raise StackError('machine "night_window" must be a string')
    match = re.fullmatch(r"\s*(\d{2}):(\d{2})\s*[-–—]\s*(\d{2}):(\d{2})\s*", value)
    if not match:
        raise StackError('machine "night_window" must use HH:MM-HH:MM')
    hour1, minute1, hour2, minute2 = map(int, match.groups())
    if hour1 > 23 or hour2 > 23 or minute1 > 59 or minute2 > 59:
        raise StackError('machine "night_window" must use valid 24-hour times')
    return hour1 * 60 + minute1, hour2 * 60 + minute2


def _inside_night_window(machine, now=None):
    machine, config = _machine_config(machine)
    value = machine.get("night_window", "00:00–07:30")
    start, end = _parse_clock(value)
    if now is None:
        now = datetime.datetime.now().time()
    minute = now.hour * 60 + now.minute
    if start < end:
        return start <= minute < end
    if start > end:
        return minute >= start or minute < end
    return False


def _live_ancestor(owner, caller_pid=None):
    if not isinstance(owner, dict):
        return False
    pid, start = owner.get("pid"), owner.get("start")
    return (not isinstance(pid, bool) and isinstance(pid, int) and pid in ancestors(caller_pid) and
            isinstance(start, str) and bool(start) and R.process_alive(owner) and
            R.process_identity(pid) == start)


def _valid_parent_reservation(token, budget):
    if not isinstance(token, str) or not token:
        return False
    try:
        data = R.read_json(budget.path, {}) or {}
    except Exception:
        return False
    record = data.get(token)
    return isinstance(record, dict) and _live_ancestor(record.get("owner"))


@contextlib.contextmanager
def _budget_parent(token):
    """HostBudget reads os.environ; scope its input to the validated caller ancestor."""
    original = os.environ.get(PARENT_ENV)
    if token is None:
        os.environ.pop(PARENT_ENV, None)
    else:
        os.environ[PARENT_ENV] = token
    try:
        yield
    finally:
        if original is None:
            os.environ.pop(PARENT_ENV, None)
        else:
            os.environ[PARENT_ENV] = original


def _valid_nested_slot(queue, token, caller_pid=None):
    if not isinstance(token, str) or not token:
        return False
    lease = queue.holders().get(token)
    if not isinstance(lease, dict):
        return False
    return _live_ancestor(lease.get("owner"), caller_pid)


def _release_heavy(queue, budget, token, out):
    """Attempt both idempotent releases, retry briefly, and report any retained record."""
    failed = []
    for name, release, snapshot in (
            ("RAM reservation", budget.release, lambda: R.read_json(budget.path, {}) or {}),
            ("slot lease", queue.release, queue._snapshot)):
        error = None
        for attempt in range(3):
            try:
                release(token)
                if token in snapshot():
                    raise StackError("owned record remains after release")
                error = None
                break
            except Exception as problem:
                error = problem
                if attempt < 2:
                    time.sleep(0.05)
        if error is not None:
            failed.append("%s (%s)" % (name, type(error).__name__))
    if failed:
        print("[heavy] cleanup failed for %s: %s" % (token, ", ".join(failed)), file=out, flush=True)
    return not failed


def _forwarded_grace(child, seconds=3):
    """Let every group member finish its signal handler before stop_group escalates."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        child.poll()
        if R.group_has_live_members(child.pid) is False:
            return
        time.sleep(0.05)


def _in_ci(env=None):
    """True on a CI runner: GitHub Actions and most CI services export CI=true. The daytime cap protects an
    interactive Mac and sends big runs "overnight or in CI", so it must not refuse them in CI itself (SCAF-78: the
    Linux runner has no machine profile, so it got the 3 GiB default and the 00:00-07:30 window)."""
    value = (os.environ if env is None else env).get("CI", "")
    return value.strip().lower() in ("true", "1", "yes")


def heavy_run(command, label="heavy", ram_gib=2, wait_min=30, slots=None, env=None, cwd=None, out=sys.stderr,
              ctx=None, allow_daytime=False):
    """Run a command under the machine-wide heavy lease and HostBudget reservation."""
    if not isinstance(command, (list, tuple)) or not command:
        raise StackError("heavy needs a command")
    if not isinstance(label, str) or not label:
        raise StackError("heavy label must be a non-empty string")
    ram_gib = _finite_number(ram_gib, "heavy RAM")
    wait_min = _finite_number(wait_min, "heavy wait")
    if not isinstance(allow_daytime, bool):
        raise StackError("allow_daytime must be a boolean")
    machine = ctx.machine if ctx is not None else load_machine()
    _, config = _machine_config(machine)
    daytime_cap = _finite_number(config.get("daytime_max_gib", 3), "machine daytime_max_gib")
    if ram_gib > daytime_cap and not allow_daytime and not _in_ci() and not _inside_night_window(machine):
        print("[heavy] request exceeds daytime RAM cap; run overnight or in CI", file=out, flush=True)
        return EX_TEMPFAIL

    directory = host_dir(machine)
    queue = Slots(directory, slots=slots, machine=machine, out=out)
    policy = R.Policy({"output_root": str(directory)})
    budget = R.HostBudget(policy, directory)
    token = "heavy-%d-%s" % (os.getpid(), uuid.uuid4().hex[:12])
    inline = False
    admission_started = False
    result = None
    terminated = None
    process = {"value": None}
    previous = {}

    def forward(signum, _frame):
        child = process["value"]
        if child is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(child.pid, signum)
        raise Terminated(signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            previous[signum] = signal.signal(signum, forward)
        inherited = os.environ.get(HELD_ENV)
        inline = bool(inherited and _valid_nested_slot(queue, inherited))
        child_env = dict(env if env is not None else os.environ)
        if inline:
            token = inherited
        else:
            original_parent = os.environ.get(PARENT_ENV)
            validated_parent = original_parent if _valid_parent_reservation(original_parent, budget) else None
            # The minted token is ours even if cancellation interrupts an acquire after its atomic write.
            admission_started = True
            try:
                with _budget_parent(validated_parent):
                    wait_for_slot(queue, budget, token, label, ram_gib, wait_min,
                                  tempfile.gettempdir(), out=out,
                                  project=(ctx.project if ctx else os.fspath(cwd or os.getcwd())))
            except StackError as error:
                print("[heavy] %s" % error, file=out, flush=True)
                result = EX_TEMPFAIL
        child_env[HELD_ENV] = token
        child_env[PARENT_ENV] = token
        if result is not None:
            return result
        process["value"] = subprocess.Popen(command, env=child_env, cwd=cwd, start_new_session=True)
        last_update = time.monotonic()
        while process["value"].poll() is None:
            time.sleep(0.2)
            now = time.monotonic()
            if not inline and now - last_update >= 5:
                budget.update(token, 0, R.group_rss(process["value"].pid))
                last_update = now
        code = process["value"].returncode
        result = 128 + -code if code < 0 else code
    except Terminated as error:
        terminated = error.signum
        result = 128 + error.signum
    finally:
        # Repeated cancellation must not interrupt teardown; restore the caller's handlers afterwards.
        for signum in previous:
            signal.signal(signum, signal.SIG_IGN)
        child = process["value"]
        try:
            if child is not None:
                if terminated is not None:
                    _forwarded_grace(child)
                R.stop_group(child)
        finally:
            try:
                if admission_started and not _release_heavy(queue, budget, token, out) and result == 0:
                    result = 2
            finally:
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
    return result


def _meta_object(value):
    try:
        decoded = json.loads(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("metadata must be a JSON object") from error
    if not isinstance(decoded, dict):
        raise argparse.ArgumentTypeError("metadata must be a JSON object")
    return decoded


def _add_kind_option(parser, default=None):
    parser.add_argument("--kind", dest="kind", default=default, help="registry kind")


def build_parser(ctx=None):
    parser = argparse.ArgumentParser(description="Shared local test-stack queue, registry and content-keyed cache",
                                     epilog="Caches publish once per key and hold consumer leases; gc preserves live leases and links. "
                                            "Read-only output is optional; cache outputs are writable by default.")
    parser.add_argument("--project", default=os.getcwd(), help="project directory (default: current directory)")
    parser.add_argument("--state-root", help="override the guarded test-stack state root")
    subparsers = parser.add_subparsers(dest="command", required=True)

    heavy = subparsers.add_parser("heavy", help="run a command under the machine-wide heavy queue")
    heavy.add_argument("--label", default="heavy")
    heavy.add_argument("--ram-gib", type=float, default=2)
    heavy.add_argument("--wait-min", type=float, default=30)
    heavy.add_argument("--slots", type=int, default=None)
    heavy.add_argument("--allow-daytime", action="store_true")
    heavy.add_argument("command_args", nargs=argparse.REMAINDER)
    heavy.set_defaults(func=lambda args: heavy_run(args.command_args, label=args.label, ram_gib=args.ram_gib,
                                                     wait_min=args.wait_min, slots=args.slots,
                                                     ctx=ctx, allow_daytime=args.allow_daytime))

    status_parser = subparsers.add_parser("status", help="show test-stack state")
    status_parser.set_defaults(func=lambda args: _command_status(ctx))
    gc_parser = subparsers.add_parser("gc", help="reclaim stale test-stack state")
    gc_parser.set_defaults(func=lambda args: _command_gc(ctx))

    registry = subparsers.add_parser("registry", help="manage generic keyed registry records")
    _add_kind_option(registry)
    actions = registry.add_subparsers(dest="registry_action", required=True)
    add = actions.add_parser("add", help="record metadata under a registry key")
    _add_kind_option(add, default=argparse.SUPPRESS)
    add.add_argument("name")
    add.add_argument("--run", default="")
    add.add_argument("--owner", choices=("session", "shell"), default="session")
    add.add_argument("--owner-pid", type=int)
    add.add_argument("--ttl", type=float, default=DEFAULT_TTL)
    add.add_argument("--meta", type=_meta_object, default={})
    add.set_defaults(func=lambda args: _command_registry(args, ctx))
    for action in ("list", "touch", "drop"):
        item = actions.add_parser(action, help="%s registry records" % action)
        _add_kind_option(item, default=argparse.SUPPRESS)
        if action != "list":
            item.add_argument("name")
        if action == "touch":
            item.add_argument("--ttl", type=float, default=DEFAULT_TTL)
        item.set_defaults(func=lambda args: _command_registry(args, ctx))

    if ctx is not None:
        loader_path = HERE / "test_stack_adapters" / "__init__.py"
        spec = importlib.util.spec_from_file_location("agent_test_stack_adapter_loader", loader_path,
                                                      submodule_search_locations=[str(loader_path.parent)])
        if spec is None or spec.loader is None:
            raise StackError("cannot load adjacent adapter loader")
        loader = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(loader)
            loader.load_adapters(ctx, subparsers, StackError)
        except StackError:
            raise
        except Exception as error:
            raise StackError("cannot configure adapters (%s)" % type(error).__name__)
        ctx._adapter_loader = loader
    return parser


def _all_registry_records(ctx):
    directory = guard_path(ctx.root / "registry", ctx.machine)
    if not directory.exists():
        return {}
    output = {}
    try:
        entries = os.scandir(directory)
    except OSError as error:
        raise StackError("cannot scan registry directory (%s)" % type(error).__name__)
    with entries:
        for entry in entries:
            candidate = directory / entry.name
            # lstat only: a symlink never becomes a registry or a traversal into another tree.
            safe_parent = _absolute_lexical(directory)
            _refuse_if_banned(os.path.join(safe_parent, entry.name), _banned_roots(ctx.machine))
            try:
                info = os.lstat(candidate)
            except OSError:
                continue
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or not entry.name.endswith(".json"):
                continue
            kind = entry.name[:-5]
            if not _KIND.fullmatch(kind) or kind in (".", ".."):
                continue
            output[kind] = ctx.registry(kind).read()
    return output


def _state_bytes(ctx):
    root = ctx.root
    try:
        root_info = os.lstat(root)
    except FileNotFoundError:
        return 0
    if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
        return root_info.st_size
    banned = _banned_roots(ctx.machine)
    total = 0
    # One streamed iterator per depth, rather than collecting every directory at a wide level.
    pending = []

    def descend(directory):
        lexical_dir = _absolute_lexical(directory)
        _refuse_if_banned(lexical_dir, banned)
        try:
            entries = os.scandir(directory)
        except FileNotFoundError:
            return
        except OSError as error:
            raise StackError("cannot scan state root (%s)" % type(error).__name__)
        entries.__enter__()
        pending.append((lexical_dir, entries, iter(entries)))

    try:
        descend(root)
        while pending:
            directory, scan, entries = pending[-1]
            try:
                entry = next(entries)
            except StopIteration:
                scan.__exit__(None, None, None)
                pending.pop()
                continue
            path = os.path.join(directory, entry.name)
            _refuse_if_banned(path, banned)
            try:
                info = os.lstat(path)
            except FileNotFoundError:
                continue
            total += max(info.st_size, getattr(info, "st_blocks", 0) * 512)
            if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
                descend(path)
    finally:
        for _directory, scan, _entries in reversed(pending):
            scan.__exit__(None, None, None)
    return total


def _status_data(ctx, adapter_status, gc_result=None):
    ctx.cache  # Install link callbacks before generic registry reads.
    payload = {"heavy": Slots(host_dir(ctx.machine), machine=ctx.machine).holders(),
               "registry": _all_registry_records(ctx), "state_bytes": _state_bytes(ctx),
               "adapters": adapter_status, "caches": ctx.cache.status()}
    if gc_result is not None:
        payload["gc"] = gc_result
    return payload


def _json_print(value):
    print(json.dumps(value, sort_keys=True, default=str))
    return 0


def _command_status(ctx):
    ctx.cache
    loader = getattr(ctx, "_adapter_loader", None)
    adapters = loader.status(ctx) if loader is not None else {}
    return _json_print(_status_data(ctx, adapters))


def _command_gc(ctx):
    loader = getattr(ctx, "_adapter_loader", None)
    reclaimed = loader.gc(ctx) if loader is not None else {}
    cache_result = ctx.cache.gc()
    records = _all_registry_records(ctx)
    adapters = loader.status(ctx) if loader is not None else {}
    return _json_print(_status_data(ctx, adapters, {"adapters": reclaimed, "cache": cache_result,
                                                     "registries_scanned": len(records)}))


def _command_registry(args, ctx):
    if not args.kind:
        raise StackError("registry requires --kind")
    ctx.cache  # Generic drop must retain protection for recorded live links.
    registry = ctx.registry(args.kind, record_only=True)
    if args.registry_action == "add":
        owner = select_owner(args.owner, args.owner_pid)
        value = registry.register(args.name, project=ctx.project, run=args.run, owner=owner,
                                  meta=args.meta, ttl=args.ttl, record_only=True)
    elif args.registry_action == "list":
        value = registry.read()
    elif args.registry_action == "touch":
        value = registry.touch(args.name, args.ttl)
    elif args.registry_action == "drop":
        value = {"dropped": registry.drop(args.name)}
    else:
        raise StackError("unknown registry action")
    return _json_print(value)


def _global_context(argv):
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--project", default=os.getcwd())
    pre.add_argument("--state-root")
    parsed, _rest = pre.parse_known_args(argv)
    return Context(project=parsed.project, state_root=parsed.state_root)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        ctx = _global_context(argv)
        parser = build_parser(ctx)
        args = parser.parse_args(argv)
        if args.command == "registry" and not args.kind:
            parser.error("registry requires --kind")
        if args.command == "heavy" and args.command_args and args.command_args[0] == "--":
            args.command_args = args.command_args[1:]
        return args.func(args)
    except (StackError, R.ResourceError) as error:
        print("test_stack: %s" % error, file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
