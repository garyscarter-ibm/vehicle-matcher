"""Owned finite I/O and sampled aggregate accounting; no import-time I/O or allocation."""
from pathlib import Path
import atexit
import io
import json
import math
import os
import resource
import selectors
import stat
import subprocess
import sys
import threading
import time

MIB = 1024 ** 2
CONTRACT = {
    'combined_bytes': 128*MIB, 'ram_bytes': 768*MIB, 'retained_bytes': 8*MIB,
    'json_bytes': MIB, 'summary_bytes': 512*1024, 'terminal_bytes': 16*1024,
    'audit_bytes': 16*1024, 'stdout_bytes': 4096, 'log_bytes': 2*MIB,
    'journal_bytes': 256*1024, 'checkpoint_bytes': 64*1024,
    'json_depth': 24, 'json_nodes': 32768, 'json_collection': 4096,
    'json_string_chars': 65536, 'json_total_chars': 524288,
    'entries': 4096, 'process_identities': 512, 'probe_bytes': MIB,
    'probe_timeout_seconds': 2, 'sample_interval_seconds': 0.2,
    'helper_timeout_seconds': 5, 'helper_capture_bytes': MIB,
    'supervisor_seconds': 240, 'audit_seconds': 120,
    # Charged inside the 768MiB grant even while the respective operation is idle.
    'probe_ram_allowance': 32*MIB, 'encoding_ram_allowance': 64*MIB,
    'ledger_ram_allowance': 32*MIB,
    # Charged inside 128MiB in every pre/post-write observation, including cleanup.
    'ledger_disk_allowance': 4*MIB, 'atomic_disk_allowance': MIB+8192,
    'terminal_disk_allowance': 64*1024, 'audit_disk_allowance': 64*1024,
}


class BoundError(RuntimeError):
    pass


def structure(value):
    nodes = chars = 0
    def walk(item, depth):
        nonlocal nodes, chars
        nodes += 1
        if depth > CONTRACT['json_depth'] or nodes > CONTRACT['json_nodes']:
            raise BoundError('JSON structure exceeds reviewed bounds')
        if isinstance(item, str):
            chars += len(item)
            if len(item) > CONTRACT['json_string_chars'] or chars > CONTRACT['json_total_chars']:
                raise BoundError('JSON strings exceed reviewed bounds')
        elif item is None or type(item) is bool:
            pass
        elif type(item) is int:
            if abs(item) >= 2**63:
                raise BoundError('JSON integer exceeds bound')
        elif type(item) is float:
            if not math.isfinite(item):
                raise BoundError('Non-finite JSON number')
        elif type(item) in (dict, list, tuple):
            if len(item) > CONTRACT['json_collection']:
                raise BoundError('JSON collection exceeds bound')
            if type(item) is dict:
                for key, child in item.items():
                    if type(key) is not str:
                        raise BoundError('JSON key is not a string')
                    walk(key, depth+1); walk(child, depth+1)
            else:
                for child in item:
                    walk(child, depth+1)
        else:
            raise BoundError('Unsupported JSON value')
    walk(value, 0)


def encode(value, cap):
    # Validate finite structure BEFORE the encoder allocates escaped strings/chunks.
    structure(value)
    chunks, size = [], 1
    for part in json.JSONEncoder(sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(value):
        block = part.encode('utf-8'); size += len(block)
        if size > cap:
            raise BoundError('Encoded JSON exceeds artifact byte cap')
        chunks.append(block)
    return b''.join(chunks) + b'\n'


def read_bytes(path, cap):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > cap or before.st_nlink != 1:
            raise BoundError('Input is not a bounded regular file')
        data = source.read(cap+1)
        after = os.fstat(source.fileno())
        if len(data) > cap or (before.st_size, before.st_mtime_ns, before.st_ino) != \
                (after.st_size, after.st_mtime_ns, after.st_ino):
            raise BoundError('Input changed or exceeded cap')
        return data


def read_json(path, cap=MIB):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise BoundError('Duplicate JSON key')
            result[key] = value
        return result
    data = read_bytes(path, cap)
    # Parsing is byte bounded; post-parse structure is bounded before use/re-encoding.
    value = json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(BoundError('Non-finite JSON')))
    structure(value)
    return value


def allocation(paths):
    total = entries = 0
    seen = set()
    def visit(path):
        nonlocal total, entries
        try:
            item = path.lstat()
        except FileNotFoundError:
            return
        entries += 1
        if entries > CONTRACT['entries'] or stat.S_ISLNK(item.st_mode):
            raise BoundError('Allocation traversal exceeds bound or contains symlink')
        if not (stat.S_ISREG(item.st_mode) or stat.S_ISDIR(item.st_mode)):
            raise BoundError('Unexpected allocation type')
        identity = (item.st_dev, item.st_ino)
        if identity in seen:
            raise BoundError('Aliased allocation')
        seen.add(identity)
        if stat.S_ISREG(item.st_mode) and item.st_nlink != 1:
            raise BoundError('Hard-linked retained allocation')
        total += max(item.st_size, item.st_blocks*512)
        if stat.S_ISDIR(item.st_mode):
            with os.scandir(path) as children:
                for child in children:
                    visit(Path(child.path))
    for path in paths:
        visit(Path(path))
    return total


class Aggregate:
    """Supervisor plus recursive descendants, recorded identities and owned groups.

    Sampling is an execution contract, not a native RSS sandbox. The fixed RAM reserve
    covers probe/encoding/ledger transients; self/reaped-child high water conservatively
    covers short-lived helpers between snapshots. Unknown/oversize telemetry is failure.
    """
    def __init__(self, cancel, seconds):
        self.cancel, self.seconds = cancel, seconds
        self.started = time.monotonic()
        self.limit = CONTRACT['ram_bytes']
        self.groups = []
        self.seen, self.rows = {}, []
        self.peak = self.rss = self.samples = 0
        self.last_sample = 0.0
        self.issue = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.probe_lock = threading.Lock()
        self.probe = None
        self.thread = None
        atexit.register(self.stop)

    def snapshot(self):
        with self.probe_lock:
            return self._snapshot()

    def _snapshot(self):
        # Capture the probe handle before reads; never subprocess.run(capture_output=...).
        proc = subprocess.Popen(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.probe = proc
        chunks, size = [], 0
        deadline = time.monotonic() + CONTRACT['probe_timeout_seconds']
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(proc.stdout, selectors.EVENT_READ)
                while True:
                    if time.monotonic() > deadline:
                        raise BoundError('Aggregate telemetry timed out')
                    if not ready.select(0.05):
                        continue
                    block = os.read(proc.stdout.fileno(), 65536)
                    if not block:
                        break
                    size += len(block)
                    if size > CONTRACT['probe_bytes']:
                        raise BoundError('Aggregate telemetry exceeds byte cap')
                    chunks.append(block)
            if proc.wait(timeout=1):
                raise BoundError('Aggregate telemetry failed')
            rows = []
            for line in b''.join(chunks).decode('ascii').splitlines():
                fields = line.split(None, 5)
                if len(fields) != 6:
                    raise BoundError('Unknown aggregate telemetry row')
                pid, ppid, pgid, rss = map(int, fields[:4])
                if min(pid, pgid) <= 0 or min(ppid, rss) < 0 or len(fields[5].split()) != 5:
                    raise BoundError('Invalid aggregate telemetry identity/RSS')
                rows.append(dict(pid=pid, ppid=ppid, pgid=pgid, rss=rss*1024,
                                 state=fields[4], start=fields[5]))
                if len(rows) > CONTRACT['entries']:
                    raise BoundError('Aggregate telemetry row cap')
            if not any(row['pid'] == os.getpid() for row in rows):
                raise BoundError('Supervisor absent from telemetry')
            selected = {os.getpid()} | {row['pid'] for row in rows if row['pgid'] in self.groups
                                        or (row['pid'], row['start']) in self.seen}
            while True:
                more = {row['pid'] for row in rows if row['ppid'] in selected} - selected
                if not more:
                    break
                selected.update(more)
            owned = [row for row in rows if row['pid'] in selected]
            # Probes are independently captured/joined, not unbounded historical identity rows.
            for row in owned:
                if row['pid'] not in (os.getpid(), proc.pid):
                    self.seen[(row['pid'], row['start'])] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
            if len(self.seen) > CONTRACT['process_identities']:
                raise BoundError('Owned process identity cap')
            scale = 1 if sys.platform == 'darwin' else 1024
            high = (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                    + resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)*scale
            rss = max(sum(row['rss'] for row in owned if not row['state'].startswith('Z')), int(high))
            rss += sum(CONTRACT[key] for key in ('probe_ram_allowance', 'encoding_ram_allowance', 'ledger_ram_allowance'))
            with self.lock:
                self.rows = list(self.seen.values())
                self.rss = rss; self.peak = max(self.peak, rss); self.samples += 1
                self.last_sample = time.monotonic()
            if rss > self.limit:
                raise BoundError('Owned aggregate RAM exceeds grant')
            if time.monotonic() - self.started > self.seconds:
                raise BoundError('Owned supervisor deadline exceeded')
        finally:
            # Direct handle stop/wait always precedes any status persistence.
            try:
                if proc.poll() is None:
                    proc.kill()
                proc.wait(timeout=2)
            finally:
                proc.stdout.close()
                if proc.poll() is not None:
                    self.probe = None

    def loop(self):
        while not self.stop_event.is_set():
            try:
                self.snapshot()
            except BaseException as error:
                self.issue = self.issue or type(error).__name__
                self.cancel.set()
            self.stop_event.wait(CONTRACT['sample_interval_seconds'])

    def start(self):
        self.snapshot()  # Fail before verification or shared-helper imports on unknown telemetry.
        self.thread = threading.Thread(target=self.loop, name='owned-aggregate', daemon=True)
        self.thread.start()
        return self

    def check(self):
        if self.issue or not self.samples or self.rss > self.limit or time.monotonic()-self.started > self.seconds \
                or time.monotonic()-self.last_sample > CONTRACT['probe_timeout_seconds']+1:
            raise BoundError('Owned aggregate observation failed or exceeded limit')
        if not self.thread or not self.thread.is_alive():
            raise BoundError('Aggregate monitor unexpectedly stopped')
        return self.rss

    def checkpoint(self):
        try:
            self.snapshot()
        except BaseException as error:
            self.issue = self.issue or type(error).__name__
            self.cancel.set()
            raise
        return self.check()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=6)
            if self.thread.is_alive():
                raise BoundError('Aggregate monitor join unknown')
        if self.probe is not None:
            self.probe.kill(); self.probe.wait(timeout=2)
            self.probe = None

    def receipt(self):
        return {'peak_charged_rss_bytes': self.peak, 'samples': self.samples,
                'issue': self.issue, 'limit_bytes': self.limit,
                'basis': 'sampled supervisor+recursive descendants+owned groups/identities; max(self+reaped-child high water); fixed probe/encoding/ledger allowances'}


class Outputs:
    def __init__(self, scratch, retained, monitor):
        self.scratch = Path(scratch) if scratch else None
        self.retained = [Path(path) for path in retained]
        self.monitor = monitor
        self.peak = 0
        self.sequence = 0
        self.temporaries = set()
        self.diagnostics = False

    def observe(self):
        roots = self.retained + ([self.scratch] if self.scratch else [])
        external_temps = [path for path in self.temporaries
                          if not any(path == root or path.is_relative_to(root) for root in roots)]
        retained = allocation(self.retained + external_temps)
        scratch = allocation([self.scratch]) if self.scratch else 0
        allowances = sum(CONTRACT[key] for key in ('ledger_disk_allowance', 'atomic_disk_allowance',
                                                   'terminal_disk_allowance', 'audit_disk_allowance'))
        charged = retained + scratch + allowances
        self.peak = max(self.peak, charged)
        if retained > CONTRACT['retained_bytes'] or charged > CONTRACT['combined_bytes']:
            raise BoundError('Combined/retained allocation exceeds reviewed cap')
        return {'retained_allocated_bytes': retained, 'scratch_allocated_bytes': scratch,
                'temporary_allowance_bytes': allowances, 'charged_combined_bytes': charged,
                'peak_charged_combined_bytes': self.peak}

    def admissible(self, path):
        path = Path(os.path.abspath(path))
        roots = self.retained + ([self.scratch] if self.scratch else [])
        if not any(path == root or path.is_relative_to(root) for root in roots):
            raise BoundError('Output outside declared ownership')
        for parent in (path, *path.parents):
            if parent.is_symlink():
                raise BoundError('Output path contains symlink')
        return path

    def write(self, path, payload, cap, exclusive=False):
        if not self.diagnostics:
            self.monitor.check()
        if type(payload) is not bytes or len(payload) > cap or cap > CONTRACT['json_bytes']:
            raise BoundError('Output byte cap')
        path = self.admissible(path)
        # RAM failures still allow finite cleanup diagnostics within the reserved allowances.
        before = self.observe()
        if before['charged_combined_bytes'] + len(payload) + 8192 > CONTRACT['combined_bytes']:
            raise BoundError('Output would exceed combined cap')
        if before['retained_allocated_bytes'] + len(payload) + 8192 > CONTRACT['retained_bytes']:
            raise BoundError('Output would exceed retained cap')
        path.parent.mkdir(parents=True, exist_ok=True)
        self.sequence += 1
        temporary = path.with_name('.'+path.name+'.owned-'+str(os.getpid())+'-'+str(self.sequence))
        self.temporaries.add(temporary)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        identity = os.fstat(fd)
        try:
            with os.fdopen(fd, 'wb') as target:
                target.write(payload); target.flush(); os.fsync(target.fileno())
            self.observe()  # Includes actual staging allocation, conservatively plus allowance.
            self.admissible(path)
            if exclusive:
                os.link(temporary, path, follow_symlinks=False)
                temporary.unlink()
            else:
                os.replace(temporary, path)
            self.observe()
        finally:
            if os.path.lexists(temporary):
                current = temporary.lstat()
                if (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
                    raise BoundError('Temporary output identity unknown')
                temporary.unlink()
            self.temporaries.discard(temporary)

    def json(self, path, value, cap=None, exclusive=False):
        if not self.diagnostics:
            self.monitor.check()
        self.write(path, encode(value, cap or CONTRACT['json_bytes']), cap or CONTRACT['json_bytes'], exclusive)


class Quiet(io.TextIOBase):
    """Suppress helper progress while refusing unbounded writes; final stdout is separate."""
    def __init__(self):
        self.size = 0
    def write(self, value):
        if not isinstance(value, str) or len(value) > CONTRACT['stdout_bytes']:
            raise BoundError('Helper stdout chunk exceeds cap')
        self.size += len(value.encode('utf-8'))
        if self.size > 16*1024:
            raise BoundError('Helper stdout exceeds cap')
        return len(value)


class Captures:
    """Bound captured helper subprocesses on loaded module instances only."""
    def __getattr__(self, name):
        return getattr(subprocess, name)

    def run(self, command, capture_output=False, text=False, input=None, timeout=None, **options):
        if not capture_output or input is not None or options:
            raise BoundError('Unexpected helper subprocess contract')
        deadline = time.monotonic() + min(timeout or CONTRACT['helper_timeout_seconds'], CONTRACT['helper_timeout_seconds'])
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        streams = {'stdout': [], 'stderr': []}
        size = 0
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(proc.stdout, selectors.EVENT_READ, 'stdout')
                ready.register(proc.stderr, selectors.EVENT_READ, 'stderr')
                while ready.get_map():
                    if time.monotonic() > deadline:
                        raise BoundError('Helper subprocess timeout')
                    for key, mask in ready.select(0.05):
                        block = os.read(key.fd, 65536)
                        if not block:
                            ready.unregister(key.fd)
                        else:
                            size += len(block)
                            if size > CONTRACT['helper_capture_bytes']:
                                raise BoundError('Helper capture byte cap')
                            streams[key.data].append(block)
            rc = proc.wait(timeout=1)
            out, err = (b''.join(streams[key]) for key in ('stdout', 'stderr'))
            return subprocess.CompletedProcess(command, rc, out.decode() if text else out, err.decode() if text else err)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=2)
            proc.stdout.close(); proc.stderr.close()


def temporary_leftovers(paths, pid):
    leftovers, visited = [], set()
    for value in paths:
        path = Path(value)
        if path.parent in visited or not path.parent.exists():
            continue
        visited.add(path.parent)
        # Shared parent traversal is bounded and observes only this owner's exact temp prefix.
        count = 0
        prefixes = ['.'+Path(other).name+'.owned-'+str(pid)+'-' for other in paths if Path(other).parent == path.parent]
        with os.scandir(path.parent) as entries:
            for entry in entries:
                count += 1
                if count > CONTRACT['entries']:
                    raise BoundError('Temporary audit traversal cap')
                if any(entry.name.startswith(prefix) for prefix in prefixes):
                    leftovers.append(entry.path)
    return leftovers
