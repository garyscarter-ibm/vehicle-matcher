#!/usr/bin/env python3
"""Proposed finite F69 component runner. Requires a reviewed closure and explicit grant.

This is an ownership/budget supervisor, not an OS network or filesystem sandbox.
Do not execute, import, or syntax-check it before the dispatcher reviews its freeze.
"""
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
MIB = 1024 ** 2
PROBE_ENV = None
RESOURCE_ACCOUNT = None
FINAL_RECEIPT_CAP = MIB
FINAL_CHECKPOINT_CAP = 16 * 1024
FINAL_DISK_ALLOWANCE = 4 * MIB
FINAL_MEMORY_ALLOWANCE = 64 * MIB
FINAL_INCOMPLETE = b'{"state":"incomplete","completed":[],"issue":"Final receipt bounds, headroom or write failed; see plan.json and ownership."}\n'


def bounded_json_bytes(value, cap):
    """Finite streaming serialization: <=20k nodes, depth32, 16KiB strings, 128-bit integers."""
    nodes = 0
    def validate(item, depth=0):
        nonlocal nodes
        nodes += 1
        if nodes > 20000 or depth > 32:
            raise RuntimeError('Final receipt structure exceeds the frozen serializer bound.')
        if item is None or type(item) is bool:
            return
        if type(item) is str:
            if len(item) > 16384:
                raise RuntimeError('Final receipt string exceeds the frozen serializer bound.')
        elif type(item) is int:
            if item.bit_length() > 128:
                raise RuntimeError('Final receipt integer exceeds the frozen serializer bound.')
        elif type(item) is float:
            if not math.isfinite(item):
                raise RuntimeError('Final receipt contains a nonfinite value.')
        elif type(item) is dict:
            for key, child in item.items():
                if type(key) is not str:
                    raise RuntimeError('Final receipt keys must be strings.')
                validate(key, depth + 1)
                validate(child, depth + 1)
        elif type(item) in (list, tuple):
            for child in item:
                validate(child, depth + 1)
        else:
            raise RuntimeError('Final receipt contains an unsupported value.')
    validate(value)
    output = bytearray()
    encoder = json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(',', ':'))
    for text in encoder.iterencode(value):  # Streaming default; a string token is bounded to 12*16384+2 ASCII bytes.
        piece = text.encode('ascii')
        if len(output) + len(piece) + 1 > cap:
            raise RuntimeError('Final encoded receipt exceeds its frozen byte cap.')
        output.extend(piece)
    output.extend(b'\n')
    return bytes(output)


def atomic_bytes(path, payload, cap):
    """Write already encoded bounded bytes, including the atomic temporary file in the allowance."""
    if type(payload) is not bytes or len(payload) > cap:
        raise RuntimeError('Final write payload exceeds its frozen byte cap.')
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.fucq69-final-', dir=path.parent)
    try:
        view = memoryview(payload)
        written = 0
        while written < len(view):
            count = os.write(fd, view[written:written + 65536])
            if count <= 0:
                raise RuntimeError('Final receipt write made no progress.')
            written += count
        os.fsync(fd)
        os.close(fd)
        fd = None
        os.replace(temporary, path)
    finally:
        if fd is not None:
            os.close(fd)
        if os.path.lexists(temporary):
            os.unlink(temporary)


def strict_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise RuntimeError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def finite(value):
        raise RuntimeError('Nonfinite JSON value: ' + value)
    def bounded_integer(value):
        if len(value.lstrip('-')) > 20:
            raise RuntimeError('JSON integer exceeds the finite admission range.')
        return int(value)
    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise RuntimeError('Nonfinite JSON number: ' + value)
        return parsed
    return json.loads(text, object_pairs_hook=unique, parse_constant=finite,
                      parse_int=bounded_integer, parse_float=finite_float)


def digest(path):
    path = Path(path)
    remaining = path.stat().st_size
    value = hashlib.sha256()
    with path.open('rb') as source:
        while remaining:
            block = source.read(min(65536, remaining))
            if not block:
                raise RuntimeError('Input shortened during hashing: ' + str(path))
            value.update(block)
            remaining -= len(block)
        if source.read(1):
            raise RuntimeError('Input grew during hashing: ' + str(path))
    return value.hexdigest()


def identity(path):
    path = Path(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError('Expected a regular input: ' + str(path))
    return {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size,
            'mode': stat.S_IMODE(info.st_mode), 'sha256': digest(path)}


def directory_identity(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
        raise RuntimeError('Expected an ordinary directory: ' + str(path))
    return {'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)}


def package_members(path):
    found = []
    for folder, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            if (Path(folder) / name).is_symlink():
                raise RuntimeError('Dependency symlink is outside the proposal.')
        dirs[:] = sorted(name for name in dirs if name != 'node_modules')
        found.extend((Path(folder) / name).relative_to(path).as_posix() for name in sorted(files))
    return sorted(found)


def verify_inputs(closure, deadline=None):
    def timely():
        if RESOURCE_ACCOUNT is not None:
            RESOURCE_ACCOUNT(None, False)
        if deadline is not None and time.monotonic() > deadline:
            raise RuntimeError('Input verification phase deadline exceeded.')
    for row in closure['sourceRows'] + closure['guardRows']:
        timely()
        target = ROOT / row['path']
        if target.resolve() != target or identity(target) != row['identity']:
            raise RuntimeError('Frozen source/config/tool changed: ' + row['path'])
    for row in closure['tools']:
        timely()
        target = Path(row['path'])
        if str(target.resolve()) != row['realpath'] or identity(target) != row['identity']:
            raise RuntimeError('Frozen executable changed: ' + row['path'])
    for row in closure['installedGuards']:
        timely()
        if identity(row['path']) != row['identity']:
            raise RuntimeError('Installed manifest/lock changed: ' + row['path'])
    installed = Path(closure['installedRoot'])
    if directory_identity(installed) != closure['installedRootIdentity']:
        raise RuntimeError('Installed dependency root identity changed.')
    for row in closure['packages']:
        timely()
        target = installed / row['path']
        if directory_identity(target) != row['directoryIdentity'] or package_members(target) != row['members']:
            raise RuntimeError('Installed package membership changed: ' + row['path'])
    for row in closure['dependencyRows']:
        timely()
        target = installed / row['path']
        if target.resolve() != target or identity(target) != row['identity']:
            raise RuntimeError('Installed dependency changed: ' + row['path'])
    for row in closure['packageEdges']:
        timely()
        for candidate in row['candidateVariants']:
            if os.path.lexists(candidate['path']) != candidate['exists']:
                raise RuntimeError('Dependency file/directory candidate changed: ' + candidate['path'])
        for candidate in row['searchedCandidates']:
            exists = (Path(candidate) / 'package.json').is_file()
            if exists != (candidate == row['resolvedPath']):
                raise RuntimeError('Package resolution changed: ' + candidate)
    if RESOURCE_ACCOUNT is not None:
        RESOURCE_ACCOUNT(None, True)


def snapshot():
    if PROBE_ENV is None:
        raise RuntimeError('Probe environment was not sanitized.')
    if RESOURCE_ACCOUNT is not None:
        RESOURCE_ACCOUNT(None, True)
    try:
        probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart=,args='],
                               capture_output=True, text=True, timeout=3, check=True, env=PROBE_ENV)
    finally:
        if RESOURCE_ACCOUNT is not None:
            RESOURCE_ACCOUNT(None, True)  # Reaped probe high-water usage is charged even on telemetry failure.
    if probe.stderr or not probe.stdout.strip():
        raise RuntimeError('Process telemetry is uncertain.')
    rows = []
    for line in probe.stdout.splitlines():
        fields = line.split(None, 10)
        if (len(fields) != 11 or any(not value.isdigit() for value in fields[:4])
                or not re.fullmatch(r'[RSDTtWXZIU][+<>AELNSsVWXl]*', fields[4])):
            raise RuntimeError('Cannot parse process ownership telemetry.')
        started = re.search(r'\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}\b', line)
        if started is None:
            raise RuntimeError('Cannot parse an exact process start identity.')
        rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]), 'pgid': int(fields[2]),
                     'rss': int(fields[3]) * 1024, 'stat': fields[4], 'start': started.group(0)})
    if RESOURCE_ACCOUNT is not None:
        RESOURCE_ACCOUNT(rows, True)
    return rows


def parse_tap(raw, names):
    text = raw.decode('utf-8', errors='strict')
    counts = {}
    for name in ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        matches = re.findall(r'^# ' + name + r' (\d+)\s*$', text, re.M)
        if len(matches) != 1:
            raise RuntimeError('Expected one original TAP total: ' + name)
        counts[name] = int(matches[0])
    subtests = re.findall(r'^# Subtest: (.+)$', text, re.M)
    successes = re.findall(r'^ok (\d+) - (.+)$', text, re.M)
    expected = {'tests': 4, 'suites': 0, 'pass': 4, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    complete = (counts == expected and subtests == names
                and successes == [(str(i + 1), name) for i, name in enumerate(names)]
                and re.findall(r'^1\.\.(\d+)\s*$', text, re.M) == ['4']
                and not re.search(r'^not ok\b|^Bail out!|# (?:SKIP|TODO)\b', text, re.M))
    return {'counts': counts, 'subtests': subtests, 'successes': successes, 'complete': complete}


def run():
    global PROBE_ENV, RESOURCE_ACCOUNT
    started = time.monotonic()
    parser = argparse.ArgumentParser()
    parser.add_argument('--dispatcher-grant', required=True)
    parser.add_argument('--expected-closure-sha256', required=True)
    args = parser.parse_args()
    if not args.dispatcher_grant.strip() or not re.fullmatch('[0-9a-f]{64}', args.expected_closure_sha256):
        parser.error('Supply the specific grant and reviewed closure SHA-256.')
    closure_path = HERE / 'history-back-closure.json'
    if digest(closure_path) != args.expected_closure_sha256:
        raise RuntimeError('Reviewed closure changed; no allocation or product execution.')
    closure = strict_json(closure_path.read_text())
    if closure['state'] != 'frozen authoring; awaiting execution grant':
        raise RuntimeError('Unexpected closure state.')
    # Verify this file, all product/package bytes, Python and resource tools BEFORE importing project helpers.
    verify_inputs(closure, started + 120)
    if Path(sys.executable).resolve() != Path(closure['python']['path']).resolve():
        raise RuntimeError('Use the frozen Python executable.')
    if sys.version != closure['python']['version'] or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise RuntimeError('Use the exact frozen isolated Python invocation.')
    if os.environ.get('TEST_RESOURCE_PARENT_RESERVATION'):
        raise RuntimeError('This proposal owns a top-level reservation; inherited reservations require a new review.')
    # Imported helpers also inherit this whitelist, including their ps/vm_stat subprocesses.
    PROBE_ENV = dict(closure['supervisorEnvironment'])
    os.environ.clear()
    os.environ.update(PROBE_ENV)
    spec = importlib.util.spec_from_file_location('fucq69_history_resources', ROOT / '_tools/test_resources.py')
    r = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(r)
    cancel = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _sig, _frame: cancel.set())

    class StrictHost:
        """Own-row adapter: never prune, repair or infer liveness of foreign reservations."""
        def __init__(self, policy, admission):
            self.policy = policy
            self.admission = admission
            self.directory = Path(admission['directory'])
            self.path = self.directory / 'reservations.json'
            self.lock_path = self.directory / 'reservations.lock'
            if str(self.lock_path) != admission['lockPath'] or str(self.path) != admission['ledgerPath']:
                raise r.ResourceError('Admission paths differ from the frozen registry paths.')
            self.expected = None
            self.token = None
            self.owner = None
            self.root = None
            self.released = False
            self.issues = []
            self.foreign_receipts = []

        def paths(self):
            if directory_identity(self.directory) != self.admission['directoryIdentity']:
                raise r.ResourceError('Host registry directory changed.')
            info = self.lock_path.lstat()
            physical = {'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)}
            if (not stat.S_ISREG(info.st_mode) or self.lock_path.resolve() != self.lock_path
                    or physical != self.admission['lockIdentity']):
                raise r.ResourceError('Frozen physical reservation lock changed.')
            return physical

        @contextlib.contextmanager
        def locked(self):
            fd = None
            held = False
            try:
                expected = self.paths()
                fd = os.open(self.lock_path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
                info = os.fstat(fd)
                if ({'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)} != expected
                        or not stat.S_ISREG(info.st_mode)):
                    raise r.ResourceError('Opened lock differs from frozen physical lock.')
                deadline = time.monotonic() + 2
                while True:
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        held = True
                        break
                    except BlockingIOError:
                        if time.monotonic() > deadline:
                            raise r.ResourceError('Reservation lock busy; no allocation.')
                        time.sleep(0.02)
                self.paths()
                yield
                self.paths()
            except BaseException as error:
                self.issues.append(type(error).__name__ + ': ' + str(error))
                raise
            finally:
                if fd is not None:
                    try:
                        if held:
                            fcntl.flock(fd, fcntl.LOCK_UN)
                    finally:
                        os.close(fd)

        def registry(self):
            # Called only under our already-open, identity-checked physical lock. Missing is an error.
            fd = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                info = os.fstat(fd)
                linked = self.path.lstat()
                if (not stat.S_ISREG(info.st_mode) or self.path.resolve() != self.path
                        or stat.S_IMODE(info.st_mode) != self.admission['ledgerMode']
                        or (info.st_dev, info.st_ino) != (linked.st_dev, linked.st_ino)
                        or info.st_size > 2 * MIB):
                    raise r.ResourceError('Reservation ledger is not the expected regular bounded file.')
                with os.fdopen(fd, 'r', encoding='utf-8') as source:
                    fd = None
                    text = source.read(2 * MIB + 1)
                    after = os.fstat(source.fileno())
                linked = self.path.lstat()
                if ((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
                        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
                        or (after.st_dev, after.st_ino) != (linked.st_dev, linked.st_ino)
                        or len(text.encode('utf-8')) > 2 * MIB):
                    raise r.ResourceError('Reservation ledger changed during its locked read.')
                data = strict_json(text)
                if not isinstance(data, dict):
                    raise r.ResourceError('Reservation ledger is not an object.')
                for token, row in data.items():
                    if not isinstance(token, str) or not token or not isinstance(row, dict):
                        raise r.ResourceError('Malformed reservation row.')
                    owner = row.get('owner')
                    if (not isinstance(owner, dict) or type(owner.get('pid')) is not int or owner['pid'] <= 0
                            or not isinstance(owner.get('start'), str) or not owner['start']):
                        raise r.ResourceError('Reservation owner identity is uncertain.')
                    if any(type(row.get(key)) is not int or row[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                        raise r.ResourceError('Reservation allocation is uncertain.')
                    if row.get('parent') is not None and not isinstance(row['parent'], str):
                        raise r.ResourceError('Reservation parent is uncertain.')
                    if row.get('root') is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()):
                        raise r.ResourceError('Reservation root is uncertain.')
                return data
            finally:
                if fd is not None:
                    os.close(fd)

        def current_owner(self):
            row = next((row for row in snapshot() if row['pid'] == os.getpid()), None)
            if row is None or not row['start']:
                raise r.ResourceError('Current supervisor owner identity is uncertain.')
            value = {'pid': row['pid'], 'start': row['start']}
            if self.owner is not None and value != self.owner:
                raise r.ResourceError('Supervisor owner identity changed.')
            return value

        def bound(self, data):
            if self.issues or self.expected is None or self.released or self.current_owner() != self.owner:
                raise r.ResourceError('Reservation admission is not a known live owned binding.')
            row = data.get(self.token)
            if (row != self.expected or row.get('owner') != self.owner or row.get('root') != self.root
                    or row.get('parent') is not None):
                raise r.ResourceError('Exact owned reservation owner/root/allocation/state changed.')

        def replace(self, before, after):
            # No foreign row is deleted, repaired, normalized or refreshed.
            foreign_before = {key: row for key, row in before.items() if key != self.token}
            foreign_after = {key: row for key, row in after.items() if key != self.token}
            if foreign_before != foreign_after or self.registry() != before:
                raise r.ResourceError('Foreign ledger rows or locked ledger state changed before mutation.')
            payload = (json.dumps(after, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
            if len(payload) > 2 * MIB:
                raise r.ResourceError('Bounded ledger write would overflow.')
            fd, temporary = tempfile.mkstemp(prefix='.fucq69-reservation-', dir=self.directory)
            try:
                os.fchmod(fd, self.admission['ledgerMode'])
                with os.fdopen(fd, 'wb') as target:
                    fd = None
                    target.write(payload)
                    target.flush()
                    os.fsync(target.fileno())
                self.paths()
                if self.registry() != before:
                    raise r.ResourceError('Locked ledger changed before atomic replacement.')
                os.replace(temporary, self.path)
                readback = self.registry()
                if readback != after:
                    raise r.ResourceError('Exact reservation ledger readback failed.')
                self.foreign_receipts.append({'count': len(foreign_before), 'sha256': hashlib.sha256(
                    json.dumps(foreign_before, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest(),
                    'preserved': {key: row for key, row in readback.items() if key != self.token} == foreign_before})
            finally:
                if fd is not None:
                    os.close(fd)
                if os.path.lexists(temporary):
                    os.unlink(temporary)

        def acquire(self, token, disk, ram, volume, root, minimum_disk, minimum_ram):
            if self.token is not None:
                raise r.ResourceError('This adapter supports one exact admission only.')
            self.token = token
            self.root = str(root.resolve())
            self.owner = self.current_owner()
            free = shutil.disk_usage(volume).free
            memory = r.available_memory()  # Frozen vm_stat; inherits the sanitized supervisor environment.
            if memory is None:
                raise r.ResourceError('Available memory telemetry is uncertain.')
            with self.locked():
                before = self.registry()
                if token in before:
                    raise r.ResourceError('Admission token already exists.')
                # Charge every foreign reservation in full, including dead/unknown/orphaned rows.
                disk_available = max(0, free - self.policy.reserve - sum(row['disk'] for row in before.values()))
                ram_available = max(0, memory - int(self.policy.ram_reserve_mib * MIB)
                                    - sum(row['ram'] for row in before.values()))
                if disk_available < minimum_disk or ram_available < minimum_ram:
                    raise r.ResourceError('The indivisible component chunk cannot fit its minimum reservation.')
                row = {'owner': self.owner, 'root': self.root, 'parent': None, 'disk': min(disk, disk_available),
                       'ram': min(ram, ram_available), 'used': 0, 'rss': 0}
                self.expected = row
                after = dict(before)
                after[token] = row
                self.replace(before, after)
                self.bound(self.registry())
                return {'disk': row['disk'], 'ram': row['ram']}

        def update(self, token, used, rss):
            if token != self.token or type(used) is not int or used < 0 or type(rss) is not int or rss < 0:
                raise r.ResourceError('Invalid exact-owner reservation update.')
            with self.locked():
                before = self.registry()
                self.bound(before)
                row = dict(self.expected, used=used, rss=rss)
                after = dict(before)
                after[token] = row
                self.replace(before, after)
                self.expected = row
                self.bound(self.registry())
            return True

        def release(self, token):
            if token != self.token:
                raise r.ResourceError('Release token does not match the exact owned admission.')
            with self.locked():
                before = self.registry()
                self.bound(before)
                after = dict(before)
                del after[token]
                self.replace(before, after)
                if token in self.registry():
                    raise r.ResourceError('Owned reservation release readback failed.')
                self.released = True

        def absent(self):
            with self.locked():
                data = self.registry()
                self.current_owner()
                return (not self.issues and self.token not in data
                        and (self.expected is None or self.released))

    policy = r.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'unit_ram_mib': 512,
                       'chunk_scratch_mib': 128, 'unit_scratch_mib': 48, 'log_mib': 2})
    host = StrictHost(policy, closure['hostAdmission'])
    run_id = 'history-back-' + uuid.uuid4().hex[:12]
    records = ROOT.parents[1] / 'test-runs/fucq69-history-back' / run_id
    ledger = {}  # (PID, start) -> immutable identity plus every observed parent/group transition.
    materialized = {}
    process = None
    root_identity = None
    direct_handle_joined = False
    result = {'rc': None}
    timings = {}
    uncertain = []
    granted = None
    accounting_last = 0.0
    accounting_live_rss = 0

    def sticky(message):
        if message not in uncertain:
            uncertain.append(message)

    def observed(row):
        return (row['pid'], row['start']) in ledger

    def remember(row):
        key = (row['pid'], row['start'])
        if any(pid == row['pid'] and start != row['start'] for pid, start in ledger):
            raise r.ResourceError('PID reuse cannot replace an earlier owned identity: ' + str(row['pid']))
        item = ledger.setdefault(key, {'pid': row['pid'], 'start': row['start'], 'observations': []})
        transition = {'ppid': row['ppid'], 'pgid': row['pgid']}
        if transition not in item['observations']:
            item['observations'].append(transition)

    def persist():
        scratch.record['ownedPids'] = list(ledger.values())
        if process is not None:
            scratch.record['localHandle'] = {'pid': process.pid, 'registeredIdentity': root_identity,
                                            'joined': direct_handle_joined, 'returncode': process.returncode}
        try:
            r.atomic_json(scratch.manifest, scratch.record)
        except BaseException as error:
            sticky('Ownership persistence: ' + type(error).__name__ + ': ' + str(error))
            raise

    def live_owned(rows):
        return [row for row in rows if not row['stat'].startswith('Z') and observed(row)]

    def validate_group(rows, group):
        if group not in scratch.record['groups']:
            raise r.ResourceError('Group has no validated adoption proof: ' + str(group))
        proven = {(item['pid'], item['start']) for item in ledger.values()
                  if any(value['pgid'] == group for value in item['observations'])}
        members = [row for row in rows if row['pgid'] == group]
        if any((row['pid'], row['start']) not in proven for row in members):
            raise r.ResourceError('Group member start/ownership is unknown or reused: ' + str(group))
        return members

    def absent(record):
        if uncertain or host.issues:
            return False
        if process is not None and (not direct_handle_joined or process.poll() is None):
            return False
        try:
            rows = snapshot()
            for group in record['groups']:
                if any(not row['stat'].startswith('Z') for row in validate_group(rows, group)):
                    return False
            return not live_owned(rows)
        except BaseException as error:
            sticky('Absence telemetry/identity: ' + type(error).__name__ + ': ' + str(error))
            raise

    class SafeScratch(r.Scratch):
        def child(self, _process):
            raise r.ResourceError('Numeric-only group registration is forbidden; use validated sample().')

        def __exit__(self, kind, value, tb):
            stop_join()  # Local handle cleanup runs even if registration or an earlier finalizer failed.
            if uncertain or host.issues or not absent(self.record):
                raise r.ResourceError('Owned process cleanup uncertain; retain named scratch: ' + str(self.root))
            try:
                account_resources(None, True)
                try:
                    opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(self.root)],
                                            capture_output=True, timeout=5, env=PROBE_ENV)
                finally:
                    account_resources(None, True)  # Includes this reaped probe's kernel high-water usage.
                if opened.returncode != 1 or opened.stdout or opened.stderr:
                    raise r.ResourceError('Scratch open-file status uncertain; retain: ' + str(self.root))
            except BaseException as error:
                sticky('Open-file telemetry: ' + type(error).__name__ + ': ' + str(error))
                raise
            # Keep the exact binding locked through the shared helper's inode check and deletion.
            # A fresh ledger/owner/root/allocation failure preserves scratch; cached host.issues is insufficient.
            with host.locked():
                host.bound(host.registry())
                account_resources(None, True)
                outcome = super().__exit__(kind, value, tb)
                account_resources(None, True)
                return outcome

    scratch = SafeScratch(records, ROOT, policy, expected=48 * MIB, checkpoint=records / 'checkpoint.json')
    original_sample = scratch.sample

    def combined_disk():
        used = original_sample() + r.allocated_bytes(records)
        scratch.record['peak'] = max(scratch.record['peak'], used)
        persist()
        return used

    scratch.sample = combined_disk

    def account_resources(rows=None, force=False):
        nonlocal accounting_last, accounting_live_rss
        try:
            if sys.platform != 'darwin':
                raise r.ResourceError('The frozen Darwin rusage byte units are required.')
            if rows is not None:
                supervisor = next((row for row in rows if row['pid'] == os.getpid()), None)
                if supervisor is None or (host.owner is not None and supervisor['start'] != host.owner['start']):
                    raise r.ResourceError('Resource accounting supervisor identity is uncertain.')
                selected = {row['pid'] for row in rows if observed(row) or row['ppid'] == os.getpid()}
                while True:
                    expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
                    if expanded == selected:
                        break
                    selected = expanded
                accounting_live_rss = sum(row['rss'] for row in rows if row['pid'] in selected)
                result['peakAggregateRssBytes'] = max(result.get('peakAggregateRssBytes', 0),
                                                       supervisor['rss'] + accounting_live_rss)
            now = time.monotonic()
            if not force and now - accounting_last < 0.2:
                return
            accounting_last = now
            own_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            child_peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
            if any(not math.isfinite(value) or value < 0 for value in (own_peak, child_peak)):
                raise r.ResourceError('Kernel high-water resource accounting is uncertain.')
            # A conservative charge, separate from sampled aggregate RSS: it also catches a short
            # synchronous ps/lsof probe that finishes between snapshots, after its bounded wait.
            charged_rss = int(own_peak + child_peak + accounting_live_rss)
            result['peakConservativeAggregateRssBytes'] = max(result.get('peakConservativeAggregateRssBytes', 0), charged_rss)
            result['kernelSupervisorPeakRssBytes'] = max(result.get('kernelSupervisorPeakRssBytes', 0), int(own_peak))
            result['kernelReapedChildrenPeakRssBytes'] = max(result.get('kernelReapedChildrenPeakRssBytes', 0), int(child_peak))
            used = r.allocated_bytes(scratch.root) + r.allocated_bytes(records)
            scratch.record['peak'] = max(scratch.record['peak'], used)
            limits = granted or {'disk': 128 * MIB, 'ram': 768 * MIB}
            if charged_rss > limits['ram'] or used > limits['disk']:
                raise r.ResourceError('Verification/cleanup aggregate resource charge exceeded the granted budget.')
            if shutil.disk_usage('/private/tmp').free < policy.reserve:
                raise r.ResourceError('Verification/cleanup reached the emergency disk reserve.')
        except BaseException as error:
            sticky('Resource accounting: ' + type(error).__name__ + ': ' + str(error))
            raise

    RESOURCE_ACCOUNT = account_resources

    def sample():
        nonlocal root_identity
        try:
            rows = snapshot()
            supervisor = next((row for row in rows if row['pid'] == os.getpid()), None)
            if supervisor is None or (host.owner is not None and supervisor['start'] != host.owner['start']):
                raise r.ResourceError('Supervisor telemetry/identity disappeared or changed.')
            if process is not None and root_identity is None:
                root = next((row for row in rows if row['pid'] == process.pid), None)
                if (root is None or root['ppid'] != os.getpid() or root['pgid'] != root['pid']
                        or os.getpgid(process.pid) != root['pgid']):
                    raise r.ResourceError('Local handle initial parent/start/session identity is unknown.')
                root_identity = {'pid': root['pid'], 'start': root['start']}
                remember(root)
            selected = {row['pid'] for row in rows if observed(row)}
            while True:
                expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
                if expanded == selected:
                    break
                selected = expanded
            owned = [row for row in rows if row['pid'] in selected]
            for row in owned:
                remember(row)
            # Adopt only groups whose complete membership has a PID/start ancestry proof in this snapshot.
            for group in {row['pgid'] for row in owned}:
                members = [row for row in rows if row['pgid'] == group]
                if group <= 0 or group == supervisor['pgid'] or any(row['pid'] not in selected for row in members):
                    raise r.ResourceError('A descendant group has unowned/unknown members.')
                if any(not observed(row) for row in members):
                    raise r.ResourceError('Group adoption lacks a start identity for every member.')
                if group not in scratch.record['groups']:
                    scratch.record['groups'].append(group)
                validate_group(rows, group)
            persist()
            probes = [row for row in rows if row['ppid'] == os.getpid() and row['pid'] not in selected]
            return supervisor['rss'] + sum(row['rss'] for row in owned + probes)
        except BaseException as error:
            sticky('Recursive telemetry/identity: ' + type(error).__name__ + ': ' + str(error))
            raise

    def meter(deadline):
        used, rss = scratch.sample(), sample()
        result['peakAggregateRssBytes'] = max(result.get('peakAggregateRssBytes', 0), rss)
        host.update(scratch.token, used, rss)
        if cancel.is_set() or time.monotonic() > deadline:
            raise r.ResourceError('Cancelled or phase deadline exceeded.')
        if used > granted['disk'] or rss > granted['ram'] or shutil.disk_usage(scratch.root).free < policy.reserve:
            raise r.ResourceError('Combined disk/RSS/headroom budget exceeded.')

    def join_local_handle():
        nonlocal direct_handle_joined
        if process is None or direct_handle_joined:
            return
        # Popen owns this unreaped child handle. No ps, ledger, manifest or group query gates these operations.
        for action in ('terminate', 'kill'):
            try:
                if process.poll() is None:
                    getattr(process, action)()
            except ProcessLookupError:
                pass
            except BaseException as error:
                sticky('Direct handle ' + action + ': ' + type(error).__name__ + ': ' + str(error))
            try:
                process.wait(timeout=3)
                direct_handle_joined = True
                break
            except subprocess.TimeoutExpired:
                continue
            except BaseException as error:
                sticky('Direct handle wait: ' + type(error).__name__ + ': ' + str(error))
        if not direct_handle_joined:
            sticky('Known local child handle could not be stopped/joined.')

    def stop_join():
        if process is None:
            return
        try:
            try:
                sample()
            except BaseException as error:
                sticky('Final recursive discovery: ' + type(error).__name__ + ': ' + str(error))
            for sig in (signal.SIGTERM, signal.SIGKILL):
                rows = snapshot()
                for group in reversed(scratch.record['groups']):
                    try:
                        members = validate_group(rows, group)  # No original-group exemption.
                        if any(not row['stat'].startswith('Z') for row in members):
                            os.killpg(group, sig)
                    except ProcessLookupError:
                        pass
                    except BaseException as error:
                        sticky('Group cleanup identity/signal: ' + type(error).__name__ + ': ' + str(error))
                if sig == signal.SIGTERM:
                    time.sleep(0.05)
        except BaseException as error:
            sticky('Group cleanup telemetry: ' + type(error).__name__ + ': ' + str(error))
        finally:
            # This protected direct cleanup survives every discovery, persistence and second-snapshot failure.
            try:
                join_local_handle()
            finally:
                try:
                    persist()
                except BaseException:
                    pass  # persist() already made the failure sticky; never replace the direct-cleanup result.

    plan = {'story': 'FUCQ-69', 'run': run_id, 'grant': args.dispatcher_grant,
            'closureSha256': args.expected_closure_sha256, 'argv': closure['nodeArgv'],
            'cwd': str(scratch.root), 'scratch': str(scratch.root), 'manifest': str(scratch.manifest),
            'expectedNames': closure['expectedNames'], 'limits': closure['limits'], 'scope': closure['scope'],
            'supervisorEnvironment': dict(PROBE_ENV), 'hostAdmission': closure['hostAdmission']}
    # Admission reads only: no records/scratch/lock/ledger creation and no foreign-row maintenance.
    with host.locked():
        host.registry()
        host.owner = host.current_owner()
    if scratch.record['owner'] != host.owner:
        raise r.ResourceError('Initial manifest owner was unknown or differs from exact admission owner.')
    r.atomic_json(scratch.manifest, scratch.record)  # External owner BEFORE scratch allocation.
    r.atomic_json(records / 'plan.json', plan)
    r.atomic_json(records / 'checkpoint.json', {'state': 'incomplete', 'selected': closure['expectedNames'], 'completed': []})
    try:
        granted = host.acquire(scratch.token, 128 * MIB, 768 * MIB, '/private/tmp', root=scratch.root,
                               minimum_disk=48 * MIB, minimum_ram=512 * MIB)
        with scratch:
            preparation_deadline = started + 120
            # No dependency fallback from scratch ancestors; --no-global-search-paths excludes CJS global roots.
            for parent in scratch.root.parents:
                if os.path.lexists(parent / 'node_modules'):
                    raise r.ResourceError('Scratch ancestor dependency root exists: ' + str(parent))
            def write(path, source, expected):
                target = scratch.root / path
                target.resolve().relative_to(scratch.root.resolve())
                if target.exists():
                    raise r.ResourceError('Duplicate materialization target: ' + path)
                data = Path(source).read_bytes()
                if hashlib.sha256(data).hexdigest() != expected:
                    raise r.ResourceError('Input changed during materialization: ' + path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                materialized[path] = expected
                if cancel.is_set() or time.monotonic() > preparation_deadline:
                    raise r.ResourceError('Preparation cancelled or deadline exceeded.')
            for row in closure['sourceRows']:
                write(row['path'], ROOT / row['path'], row['identity']['sha256'])
            for index, row in enumerate(closure['dependencyRows']):
                write('node_modules/' + row['path'], Path(closure['installedRoot']) / row['path'], row['identity']['sha256'])
                if index % 64 == 0:
                    meter(preparation_deadline)
            for directory in ('tmp', 'home'):
                (scratch.root / directory).mkdir()
            verify_inputs(closure, preparation_deadline)
            meter(preparation_deadline)
            timings['preparationSeconds'] = time.monotonic() - started
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC',
                   'HOME': str(scratch.root / 'home'), 'TMPDIR': str(scratch.root / 'tmp'),
                   'TMP': str(scratch.root / 'tmp'), 'TEMP': str(scratch.root / 'tmp'),
                   'NO_COLOR': '1', 'FORCE_COLOR': '0', 'TEST_RESOURCE_PARENT_RESERVATION': scratch.token}
            plan['environment'] = env
            plan['granted'] = granted
            r.atomic_json(records / 'plan.json', plan)
            raw_log = records / 'test.tap'
            observed_bytes = 0
            log_drained = False
            execution_started = time.monotonic()
            try:
                with raw_log.open('xb') as log, selectors.DefaultSelector() as selector:
                    # Cancellation cannot land between successful creation and initial durable ownership.
                    # The outer finally also adopts/stops the local handle if any registration step raises.
                    if threading.active_count() != 1:
                        raise r.ResourceError('The tiny child signal-mask reset requires a single-threaded supervisor.')
                    prior_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
                    try:
                        process = subprocess.Popen(closure['nodeArgv'], cwd=scratch.root, env=env,
                                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                                                   preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask))
                        persist()  # Local handle inventory only; no unverified numeric group adoption.
                        sample()
                    finally:
                        signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask)
                    selector.register(process.stdout, selectors.EVENT_READ)
                    last_sample = 0.0
                    while selector.get_map() or process.poll() is None:
                        if time.monotonic() - last_sample >= 0.2:
                            meter(execution_started + 120)
                            last_sample = time.monotonic()
                        for key, _mask in selector.select(timeout=0.1):
                            block = os.read(key.fileobj.fileno(), 65536)
                            if not block:
                                selector.unregister(key.fileobj)
                                continue
                            prior = observed_bytes
                            observed_bytes += len(block)
                            log.write(block[:max(0, 2 * MIB - prior)])
                            if observed_bytes > 2 * MIB:
                                raise r.ResourceError('Original output exceeds 2 MiB; bounded prefix is incomplete.')
                    process.wait(timeout=3)
                    result['rc'] = process.returncode
                    log_drained = True
            finally:
                stop_join()
                if process is not None and process.stdout is not None:
                    process.stdout.close()
                timings['executionAndStopSeconds'] = time.monotonic() - execution_started
                result.update(originalBytesObserved=observed_bytes, logTruncated=observed_bytes > 2 * MIB,
                              logDrained=log_drained,
                              log=str(raw_log), logSha256=digest(raw_log) if raw_log.exists() else None)
            finalization_started = time.monotonic()
            meter(finalization_started + 120)
            result['tap'] = parse_tap(raw_log.read_bytes(), closure['expectedNames'])
            result['materializedUnchanged'] = all(digest(scratch.root / path) == sha for path, sha in materialized.items())
            verify_inputs(closure, finalization_started + 120)
            timings['verificationSeconds'] = time.monotonic() - finalization_started
    except BaseException as error:
        result['issue'] = type(error).__name__ + ': ' + str(error)
    finally:
        cleanup_started = time.monotonic()
        try:
            stop_join()
        finally:
            join_local_handle()
        def check(work):
            try:
                return bool(work())
            except BaseException as error:
                uncertain.append(type(error).__name__ + ': ' + str(error))
                return False
        processes_absent = check(lambda: absent(scratch.record))
        def reservation_absent():
            return host.absent()
        def inputs_unchanged():
            verify_inputs(closure, cleanup_started + 120)
            return digest(closure_path) == args.expected_closure_sha256
        frozen_inputs_unchanged = check(inputs_unchanged)
        def accounted_cleanup():
            account_resources(None, True)
            return True
        cleanup_accounted = check(accounted_cleanup)
        if processes_absent and not os.path.lexists(scratch.root) and cleanup_accounted and not uncertain:
            try:
                host.release(scratch.token)
            except BaseException as error:
                uncertain.append('Reservation release: ' + str(error))
        checks = {'scratchAbsent': not os.path.lexists(scratch.root), 'ownedProcessesAbsent': processes_absent,
                  'reservationAbsent': check(reservation_absent), 'allFrozenInputsUnchanged': frozen_inputs_unchanged,
                  'resourceAccountingThroughCleanup': cleanup_accounted and check(accounted_cleanup),
                  'notCancelled': not cancel.is_set(),
                  'originalLogComplete': result.get('logTruncated') is False and result.get('logDrained') is True,
                  'materializedUnchanged': result.get('materializedUnchanged') is True}
        passed = (result.get('rc') == 0 and not result.get('issue') and not uncertain and not host.issues and all(checks.values())
                  and result.get('tap', {}).get('complete') is True)
        timings['receiptCleanupSeconds'] = time.monotonic() - cleanup_started
        receipt = {'state': 'passed' if passed else 'incomplete', 'result': result, 'checks': checks,
                   'uncertainties': uncertain, 'grant': args.dispatcher_grant, 'closureSha256': args.expected_closure_sha256,
                   'timings': timings, 'totalWallSeconds': time.monotonic() - started,
                   'combinedAllocatedPeakBytes': scratch.record['peak'], 'manifest': str(scratch.manifest),
                   'groups': scratch.record['groups'], 'processes': list(ledger.values()),
                   'rootIdentity': root_identity, 'directHandleJoined': direct_handle_joined,
                   'hostAdmission': closure['hostAdmission'], 'hostIssues': host.issues,
                   'ownedReservation': host.expected, 'foreignLedgerMutations': host.foreign_receipts,
                   'materialized': materialized, 'scope': closure['scope'],
                   'independentParentAudit': 'required separately; this receipt is the launching supervisor report'}
        # One bounded final commit of pre-encoded receipt/checkpoint bytes; no proof-rewrite loop.
        # The 64 MiB serializer allowance covers <=20k validated nodes, <=32 depth,
        # <=16KiB strings (<=196,610-byte ASCII tokens), bounded sorting and <=1MiB buffers/copies.
        # The 4 MiB disk allowance includes both durable outputs and simultaneous atomic temporaries.
        final_issue = None
        headroom_known = False
        final_payloads = None
        limits = granted or {'disk': 128 * MIB, 'ram': 768 * MIB}
        try:
            account_resources(None, True)
            used_before_write = r.allocated_bytes(scratch.root) + r.allocated_bytes(records)
            rss_before_write = result['peakConservativeAggregateRssBytes']
            free_before_write = shutil.disk_usage('/private/tmp').free
            headroom_known = True
            if (used_before_write + FINAL_DISK_ALLOWANCE > limits['disk']
                    or rss_before_write + FINAL_MEMORY_ALLOWANCE > limits['ram']
                    or free_before_write < policy.reserve + FINAL_DISK_ALLOWANCE):
                raise r.ResourceError('Final receipt serialization/atomic-write allowance cannot fit.')
            checks['finalWriteHeadroomReserved'] = True
            receipt['retainedAllocatedBeforeFinalWriteBytes'] = r.allocated_bytes(records)
            receipt['combinedAllocatedPeakMeasuredThrough'] = 'before final bounded output write'
            receipt['finalWrite'] = {
                'receiptCapBytes': FINAL_RECEIPT_CAP, 'checkpointCapBytes': FINAL_CHECKPOINT_CAP,
                'serializeMemoryAllowanceBytes': FINAL_MEMORY_ALLOWANCE, 'diskAllowanceBytes': FINAL_DISK_ALLOWANCE,
                'allocatedUpperBoundBytes': max(scratch.record['peak'], used_before_write + FINAL_DISK_ALLOWANCE),
                'rssChargeUpperBoundBytes': rss_before_write + FINAL_MEMORY_ALLOWANCE,
                'independentParentPostwriteAuditRequired': True}
            receipt['totalWallBeforeFinalWriteSeconds'] = receipt.pop('totalWallSeconds')
            receipt_bytes = bounded_json_bytes(receipt, FINAL_RECEIPT_CAP)
            checkpoint_bytes = bounded_json_bytes({'state': receipt['state'], 'selected': closure['expectedNames'],
                'completed': closure['expectedNames'] if passed else [], 'receipt': str(records / 'receipt.json')},
                FINAL_CHECKPOINT_CAP)
            final_payloads = (receipt_bytes, checkpoint_bytes)
        except BaseException:
            passed = False
            receipt['state'] = 'incomplete'
            checks['finalWriteHeadroomReserved'] = False
            final_issue = 'final serialization bounds or reserved headroom failed'
            # Fixed constants need no serializer and no proof rewrite. Otherwise the original incomplete
            # checkpoint/plan remains authoritative; never attempt output with unknown headroom.
            if (headroom_known and used_before_write + 65536 <= limits['disk']
                    and rss_before_write + MIB <= limits['ram'] and free_before_write >= policy.reserve + 65536):
                final_payloads = (FINAL_INCOMPLETE, FINAL_INCOMPLETE)
        if final_payloads is not None:
            try:
                atomic_bytes(records / 'receipt.json', final_payloads[0], FINAL_RECEIPT_CAP)
                atomic_bytes(records / 'checkpoint.json', final_payloads[1], FINAL_CHECKPOINT_CAP)
            except BaseException:
                passed = False
                final_issue = 'final atomic output write failed; no further proof rewrite attempted'
        else:
            passed = False
        print(json.dumps({'state': 'passed' if passed else 'incomplete', 'receipt': str(records / 'receipt.json'),
                          'finalWriteIssue': final_issue}, sort_keys=True))

    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(run())
