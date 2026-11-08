"""FUCQ-126 story-owned strict resource guard; loaded from admitted bytes only.

Unknown OS/ledger state is a retained cleanup issue, never proof of absence.
No shared resource helper is patched. No application code is imported here.
"""
from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import shutil
import signal
import stat
import subprocess
import time
import threading
import sys
import uuid

MIB = 1024 ** 2


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError('Nonstandard JSON constant: ' + value)
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def start_identity(value):
    if not isinstance(value, str) or not re.fullmatch(
            r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', value):
        return None
    try:
        datetime.strptime(value, '%a %b %d %H:%M:%S %Y')
    except ValueError:
        return None
    return ' '.join(value.split())


class SnapshotUnknown(RuntimeError):
    def __init__(self, observations):
        super().__init__('Process query is incomplete or has malformed rows')
        self.observations = observations


def parse_snapshot(output, returncode, stderr, supervisor):
    rows, observations = {}, []
    unknown = returncode != 0 or bool(stderr) or not output.strip()
    for line in output.splitlines():
        fields = line.split(None, 4)
        partial = {key: int(fields[i]) if len(fields) > i and fields[i].isascii() and fields[i].isdigit() else None
                   for i, key in enumerate(('pid', 'ppid', 'pgid'))}
        partial['start'] = None
        if partial['pid'] is not None:
            observations.append(partial)
        if len(fields) != 5 or any(not value.isascii() or not value.isdigit() for value in fields[:4]):
            unknown = True
            continue
        pid, parent, group, rss = map(int, fields[:4])
        tail = fields[4].split(None, 5)
        # A supplied unknown start stays explicit. It cannot anchor ownership.
        if tail and tail[0] in ('-', '?', '??'):
            identity, command = None, fields[4].split(None, 1)[1] if len(fields[4].split(None, 1)) == 2 else ''
        elif len(tail) == 6 and start_identity(' '.join(tail[:5])):
            identity, command = start_identity(' '.join(tail[:5])), tail[5]
        else:
            unknown = True
            continue
        partial['start'] = identity
        if pid in rows or not command:
            unknown = True
            continue
        rows[pid] = {'pid': pid, 'ppid': parent, 'pgid': group, 'rss': rss * 1024,
                     'start': identity, 'command': command}
    if unknown or supervisor not in rows or not rows[supervisor]['start']:
        raise SnapshotUnknown(observations)
    return rows


def remaining(until):
    value = until - time.monotonic()
    if value <= 0:
        raise RuntimeError('Resource lifecycle deadline reached')
    return value


@contextmanager
def deferred_signals(record):
    previous, pending = {}, []
    def defer(signum, _frame):
        pending.append(signum)
    try:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, defer)
        yield
    finally:
        failed = sys.exc_info()[0] is not None
        if pending:
            record.setdefault('deferredSignals', []).extend(pending)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if pending and not failed:
            raise KeyboardInterrupt('Cancellation deferred through owned probe/cleanup')


class Observer:
    """Own each bounded OS-query handle, including cancellation during Popen.

    Only ps/vm_stat/lsof constants below are admitted. No query output is persisted.
    The external scratch journal records launch intent before every query.
    """
    def __init__(self, scratch, deadline):
        self.scratch, self.deadline, self.handles = scratch, deadline, {}
        self.phase = 'work'
        self.work_limit, self.total_limit = 768, 1024
        scratch.record['probes'] = []
        scratch.record['queryBudget'] = {'work': self.work_limit, 'cleanupReserved': 256,
                                        'total': self.total_limit, 'phase': self.phase}

    def begin_cleanup(self):
        # Monotone transition, armed before stop/proof even if work consumed its entire allowance.
        self.phase = 'cleanup'
        self.scratch.record['queryBudget']['phase'] = self.phase

    def clean(self, process, record):
        # This path never persists or probes before retaining and joining the handle.
        until = min(self.deadline, time.monotonic() + 2)
        for action in (process.terminate, process.kill):
            if process.poll() is None:
                try:
                    action()
                except OSError:
                    pass
            try:
                process.wait(timeout=min(0.75, max(0, until - time.monotonic())))
                break
            except subprocess.TimeoutExpired:
                continue
        record['joined'] = process.poll() is not None
        record['groupAbsent'] = False
        if record['joined']:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                record['groupAbsent'] = True
            except OSError:
                pass
        for handle in (process.stdout, process.stderr):
            if handle is not None:
                handle.close()
        record['cleanupVerified'] = record['joined'] and record['groupAbsent']
        record['phase'] = 'stopped-verified' if record['cleanupVerified'] else 'cleanup-issue'
        if record['cleanupVerified']:
            self.handles.pop(process.pid, None)
        return record['cleanupVerified']

    def query(self, command, until, timeout=3):
        if command[0] not in ('/bin/ps', '/usr/bin/vm_stat', '/usr/sbin/lsof'):
            raise RuntimeError('Unadmitted lifecycle query')
        records = self.scratch.record['probes']
        limit = self.work_limit if self.phase == 'work' else self.total_limit
        if len(records) >= limit:
            raise RuntimeError('Lifecycle ' + self.phase + ' query allowance exhausted; cleanup reserve is separate')
        query_started = time.monotonic()
        record = {'budgetPhase': self.phase, 'tool': Path(command[0]).name, 'phase': 'before-create', 'cleanupVerified': False}
        records.append(record)
        process = None
        output = [bytearray(), bytearray()]
        with deferred_signals(self.scratch.record):
            try:
                self.scratch.save()
                remaining(until)
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                self.handles[process.pid] = (process, record)
                record.update(pid=process.pid, pgid=process.pid, start=None, identityBasis='direct-Popen-handle', phase='created')
                self.scratch.save()
                query_until = min(until, time.monotonic() + timeout)
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ, 0)
                    selector.register(process.stderr, selectors.EVENT_READ, 1)
                    while process.poll() is None or selector.get_map():
                        for key, _ in selector.select(timeout=min(0.05, remaining(query_until))):
                            data = os.read(key.fd, 65536)
                            if not data:
                                selector.unregister(key.fileobj)
                                continue
                            if sum(map(len, output)) + len(data) > 2 * MIB:
                                raise RuntimeError('Lifecycle query output exceeded its cap')
                            output[key.data].extend(data)
                process.wait(timeout=remaining(query_until))
                record.update(stdoutBytes=len(output[0]), stderrBytes=len(output[1]),
                              wallSeconds=time.monotonic() - query_started)
                return subprocess.CompletedProcess(command, process.returncode,
                    output[0].decode('utf-8', errors='strict'), output[1].decode('utf-8', errors='strict'))
            finally:
                if process is None:
                    record.update(phase='no-child-created', cleanupVerified=True)
                    self.scratch.save()
                else:
                    try:
                        if not self.clean(process, record):
                            raise RuntimeError('Lifecycle query child/group cleanup is unproven')
                    finally:
                        self.scratch.save()

    def finish(self, until):
        self.begin_cleanup()
        with deferred_signals(self.scratch.record):
            for process, record in list(self.handles.values()):
                if not self.clean(process, record):
                    raise RuntimeError('Retained lifecycle query handle remains unproven')
            remaining(until)
            self.scratch.save()
        return not self.handles and all(row.get('cleanupVerified') is True for row in self.scratch.record['probes'])


def process_snapshot(observer, until):
    try:
        reply = observer.query(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart=,args='], until)
    except (OSError, UnicodeError, RuntimeError, subprocess.TimeoutExpired) as error:
        raise SnapshotUnknown([]) from error
    return parse_snapshot(reply.stdout, reply.returncode, reply.stderr, os.getpid())


def owner_start(observer, until):
    # The unchanged helper compares lstart verbatim. Preserve its internal spacing in ledger owners.
    reply = observer.query(['/bin/ps', '-p', str(os.getpid()), '-o', 'lstart='], until)
    value = reply.stdout.strip()
    if reply.returncode != 0 or reply.stderr or len(reply.stdout.splitlines()) != 1 or not start_identity(value):
        raise RuntimeError('Exact supervisor start identity is unknown')
    return value


def absent(item, rows):
    current = rows.get(item['pid'])
    if current is not None:
        return bool(item.get('start') and current.get('start') and item['start'] != current['start'])
    try:
        os.kill(item['pid'], 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


def listener_ports(output, pids):
    # lsof 4.91 emits f framing even with -Fpn. Request it explicitly on all versions.
    current, descriptor, named = None, None, False
    processes, files, observed = set(), set(), set()
    admitted = {str(pid): pid for pid in pids}

    def malformed(reason, field):
        diagnostic = ascii(field[:64])[:128]
        raise RuntimeError('Malformed listener observation (' + reason + '): ' + diagnostic)

    def finish(field):
        if current is not None and (descriptor is None or not named):
            malformed('incomplete process/file frame', field)

    for line in output.splitlines():
        if re.fullmatch(r'p[0-9]+', line):
            finish(line)
            if line[1:] not in admitted or line[1:] in processes:
                malformed('foreign or duplicate PID', line)
            processes.add(line[1:])
            current, descriptor, named = admitted[line[1:]], None, False
        elif re.fullmatch(r'f[0-9]+', line):
            if current is None or (descriptor is not None and not named):
                malformed('file outside process or missing name', line)
            key = (current, line[1:])
            if key in files:
                malformed('duplicate file descriptor', line)
            files.add(key)
            descriptor, named = line[1:], False
        elif line.startswith('n'):
            if current is None or descriptor is None or named:
                malformed('name outside file or duplicate name', line)
            match = re.fullmatch(r'n.+:([0-9]{1,5})', line)
            if not match or not 0 < int(match.group(1)) <= 65535:
                malformed('invalid listener port', line)
            observed.add(int(match.group(1)))
            if len(observed) > 128:
                raise RuntimeError('Owned listener observation cap exceeded')
            named = True
        else:
            malformed('unknown field', line)
    finish('<end>')
    return observed


def allocated_bytes(root):
    try:
        value = Path(root).lstat()
    except FileNotFoundError:
        if definitely_absent(Path(root)):
            return 0
        raise
    if not stat.S_ISDIR(value.st_mode):
        raise RuntimeError('Scratch sizing root is not a physical directory')
    def failed(error):
        raise error
    total = 0
    for folder, directories, files in os.walk(root, followlinks=False, onerror=failed):
        for name in directories + files:
            item = (Path(folder) / name).lstat()
            total += max(item.st_size, item.st_blocks * 512)
    return total


def physical_anchor(path):
    path = Path(path)
    value = path.lstat()
    if path.is_symlink() or not (stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode)):
        raise RuntimeError('Host accounting anchor is not physical')
    return {'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
            'kind': 'directory' if stat.S_ISDIR(value.st_mode) else 'file', 'resolved': str(path.resolve(strict=True))}


def available_memory(observer, until):
    reply = observer.query(['/usr/bin/vm_stat'], until)
    if reply.returncode != 0 or reply.stderr or not reply.stdout.strip():
        raise RuntimeError('Host RAM query is unknown')
    lines = reply.stdout.splitlines()
    header = re.search(r'page size of ([0-9]+) bytes', lines[0])
    if not header or int(header.group(1)) <= 0:
        raise RuntimeError('Host RAM page size is unknown')
    wanted = {'Pages free', 'Pages inactive', 'Pages purgeable'}
    counts = {}
    for line in lines[1:]:
        name, separator, value = line.partition(':')
        if name in wanted:
            if not separator or name in counts or not re.fullmatch(r'\s*[0-9]+\.\s*', value):
                raise RuntimeError('Host RAM counters are malformed')
            counts[name] = int(value.strip().rstrip('.'))
    if counts.keys() != wanted:
        raise RuntimeError('Host RAM counters are incomplete')
    return int(header.group(1)) * sum(counts.values())


class Budget:
    def __init__(self, resources, policy, contract, observer, deadline):
        self.resources, self.policy, self.contract = resources, policy, contract
        self.observer, self.deadline = observer, deadline
        self.directory = Path(contract['directory'])
        self.path, self.lock = self.directory / 'reservations.json', self.directory / 'reservations.lock'
        self.expected = None
        if str(self.directory.resolve(strict=True)) != str(self.directory) or set(contract['anchors'] or {}) != {
                str(self.directory), str(self.lock)}:
            raise RuntimeError('Explicit canonical host directory and stable lock anchors are required')

    @contextmanager
    def locked(self):
        remaining(self.deadline)
        for name, expected in self.contract['anchors'].items():
            if physical_anchor(name) != expected:
                raise RuntimeError('Host accounting physical identity differs')
        fd = os.open(self.lock, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            value = os.fstat(fd)
            expected = self.contract['anchors'][str(self.lock)]
            if not stat.S_ISREG(value.st_mode) or (value.st_dev, value.st_ino) != (expected['device'], expected['inode']):
                raise RuntimeError('Host reservation lock changed before open')
            deadline = min(self.deadline, time.monotonic() + 2)
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Host reservation accounting is busy')
                    time.sleep(0.02)
            for name, expected in self.contract['anchors'].items():
                if physical_anchor(name) != expected:
                    raise RuntimeError('Host accounting anchor changed while locking')
            remaining(self.deadline)
            yield
        finally:
            os.close(fd)

    def ledger(self):
        for name, expected in self.contract['anchors'].items():
            if physical_anchor(name) != expected:
                raise RuntimeError('Host accounting anchor changed before ledger read')
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise RuntimeError('Host reservation ledger is not regular')
            before = os.fstat(stream.fileno())
            payload = stream.read(2 * MIB + 1)
            after = self.path.lstat()
            if len(payload) > 2 * MIB or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or not stat.S_ISREG(after.st_mode):
                raise RuntimeError('Host ledger size/physical identity is unknown')
            data = strict_json(payload)
        if not isinstance(data, dict) or len(data) > 4096:
            raise ValueError('Host reservation ledger is not an object')
        for token, row in data.items():
            if not isinstance(token, str) or not token or not isinstance(row, dict) or set(row) != {
                    'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}:
                raise ValueError('Unknown reservation row')
            owner = row['owner']
            if not isinstance(owner, dict) or set(owner) != {'pid', 'start'} or type(owner['pid']) is not int \
                    or owner['pid'] <= 0 or not start_identity(owner['start']):
                raise ValueError('Unknown reservation owner')
            if any(type(row[key]) is not int or row[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                raise ValueError('Unknown reservation accounting')
            if row['root'] is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()):
                raise ValueError('Unknown reservation root')
            parent, visited = row['parent'], {token}
            while parent is not None:
                if not isinstance(parent, str) or parent in visited or parent not in data or not isinstance(data[parent], dict):
                    raise ValueError('Unknown/cyclic reservation ancestry')
                visited.add(parent)
                parent = data[parent].get('parent')
        return data

    def acquire(self, scratch, retained):
        rows = process_snapshot(self.observer, self.deadline)
        identity = {'pid': os.getpid(), 'start': owner_start(self.observer, self.deadline)}
        if start_identity(identity['start']) != rows[os.getpid()]['start']:
            raise RuntimeError('Supervisor start identities disagree')
        memory = available_memory(self.observer, self.deadline)
        if type(memory) is not int or memory <= 0:
            raise RuntimeError('Host available RAM is unknown')
        free = shutil.disk_usage(scratch.root.parent).free
        with self.locked():
            data = self.ledger()
            if scratch.token in data:
                raise RuntimeError('Reservation token already exists')
            disk_pending = sum(max(0, row['disk'] - row['used']) for row in data.values())
            ram_pending = sum(max(0, row['ram'] - row['rss']) for row in data.values())
            if free - self.contract['emergencyReserveBytes'] - disk_pending < self.contract['diskBytes'] + retained:
                raise RuntimeError('Insufficient proven host disk headroom')
            if memory - ram_pending - self.contract['ramReserveBytes'] < self.contract['ramBytes']:
                raise RuntimeError('Insufficient proven host RAM headroom')
            row = {'owner': identity, 'disk': self.contract['diskBytes'], 'ram': self.contract['ramBytes'],
                   'used': retained, 'rss': 0, 'parent': None, 'root': str(scratch.root)}
            # Record intent before the atomic write; a failed readback cannot lose ownership.
            self.expected = (scratch.token, identity, str(scratch.root))
            scratch.record['owner'] = identity
            scratch.record['reservationIntent'] = {'token': scratch.token, 'row': row}
            scratch.record['headroom'] = {'freeBytes': free, 'availableRamBytes': memory,
                'outsideDiskPending': disk_pending, 'outsideRamPending': ram_pending,
                'lowDiskHeadroom': free < self.contract['preferredFreeBytes']}
            self.resources.atomic_json(scratch.manifest, scratch.record)
            data[scratch.token] = row
            self.resources.atomic_json(self.path, data)
            if self.ledger() != data:
                raise RuntimeError('Reservation write/readback differs')

    def owned_row(self, data, token):
        row = data.get(token)
        if not self.expected or self.expected[0] != token or row is None \
                or row['owner'] != self.expected[1] or row['root'] != self.expected[2] \
                or row['disk'] != self.contract['diskBytes'] or row['ram'] != self.contract['ramBytes'] \
                or row['parent'] is not None:
            raise RuntimeError('Reservation ownership differs')
        return row

    def update(self, token, used, rss):
        if any(type(value) is not int or value < 0 for value in (used, rss)):
            raise ValueError('Unknown reservation telemetry')
        with self.locked():
            data = self.ledger()
            self.owned_row(data, token).update(used=used, rss=rss)
            self.resources.atomic_json(self.path, data)
            if self.ledger() != data:
                raise RuntimeError('Reservation telemetry or foreign-row readback differs')
            return True

    def release(self, token, proof):
        if not all(proof.get(key) is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed', 'probesAbsent', 'openFilesAbsent', 'scratchAbsent')):
            raise RuntimeError('Complete cleanup proof is required for reservation release')
        if not self.expected or not definitely_absent(Path(self.expected[2])):
            raise RuntimeError('Scratch absence cannot be established')
        with self.locked():
            data = self.ledger()
            if token in data:
                self.owned_row(data, token)
                if any(row['parent'] == token for row in data.values()):
                    raise RuntimeError('Reservation still has dependent children')
                del data[token]
                self.resources.atomic_json(self.path, data)
                if self.ledger() != data:
                    raise RuntimeError('Reservation release readback differs')
            elif self.expected is not None:
                raise RuntimeError('Owned reservation disappeared before release')

    def absence(self, token):
        with self.locked():
            return token not in self.ledger()


class Tree:
    def __init__(self, resources, scratch, observer, deadline):
        self.resources, self.scratch = resources, scratch
        self.observer, self.deadline, self.until = observer, deadline, deadline
        self.process, self.joined = None, False
        scratch.record.update(ownedPids=[], groups=[], uncertainGroups=[], ports=[], processSamples=0)

    def save(self):
        self.resources.atomic_json(self.scratch.manifest, self.scratch.record)

    def remember_unknown(self, error):
        record = self.scratch.record
        selected = {item['pid'] for item in record['ownedPids']}
        while True:
            expanded = selected | {row['pid'] for row in error.observations if row.get('pid') is not None
                                   and (row.get('ppid') in selected or row.get('pgid') in record['groups'])}
            if expanded == selected:
                break
            selected = expanded
        for row in error.observations:
            if row['pid'] in selected and not any((item['pid'], item.get('start')) == (row['pid'], row.get('start')) for item in record['ownedPids']):
                record['ownedPids'].append({**row, 'owned': False})
        record['ownershipUncertain'] = True
        record.setdefault('uncertainSnapshots', []).append(time.time())
        self.save()

    def retain_direct(self, process):
        if self.process is not None and self.process is not process:
            raise RuntimeError('Direct child handle ownership differs')
        self.process = process
        record = self.scratch.record
        if not any(item['pid'] == process.pid and item.get('owned') for item in record['ownedPids']):
            record['ownedPids'].append({'pid': process.pid, 'ppid': os.getpid(),
                'pgid': process.pid, 'start': None, 'owned': True})
            record['groups'].append(process.pid)
            record['ownershipUncertain'] = True
        # Keep the handle in memory even if persistence itself fails.
        self.save()

    def identify(self, pid):
        row = process_snapshot(self.observer, self.until).get(pid)
        if not row or row['ppid'] != os.getpid() or row['pgid'] != pid or not row['start']:
            raise RuntimeError('Direct child identity is unknown')
        return row['start']

    def register(self, process):
        self.process = process
        item = {'pid': process.pid, 'ppid': os.getpid(), 'pgid': process.pid, 'start': None, 'owned': True}
        self.scratch.record['ownedPids'].append(item)
        self.scratch.record['groups'].append(process.pid)
        self.save()
        try:
            rows = process_snapshot(self.observer, self.until)
        except SnapshotUnknown as error:
            self.remember_unknown(error)
            raise
        row = rows.get(process.pid)
        if not row or not row['start'] or row['ppid'] != os.getpid() or row['pgid'] != process.pid:
            self.scratch.record['ownershipUncertain'] = True
            self.save()
            raise RuntimeError('Launched leader identity is unknown')
        item['start'] = row['start']
        self.save()
        self.observe()

    def observe(self):
        try:
            rows = process_snapshot(self.observer, self.until)
        except SnapshotUnknown as error:
            self.remember_unknown(error)
            raise
        # Reap an exited direct child before interpreting a transient unknown
        # start from that same Popen handle; every other unknown stays explicit.
        if (self.process is not None and rows.get(self.process.pid) is not None
                and not rows[self.process.pid]['start'] and self.process.poll() is not None):
            try:
                rows = process_snapshot(self.observer, self.until)
            except SnapshotUnknown as error:
                self.remember_unknown(error)
                raise
        record = self.scratch.record
        selected = {item['pid'] for item in record['ownedPids'] if item.get('owned') and item.get('start')
                    and item['pid'] in rows and rows[item['pid']]['start'] == item['start']}
        anchored_groups = {rows[pid]['pgid'] for pid in selected}
        unanchored = [row for row in rows.values() if row['pgid'] in record['groups'] and row['pgid'] not in anchored_groups]
        for row in unanchored:
            if not any((item['pid'], item.get('start')) == (row['pid'], row['start']) for item in record['ownedPids']):
                record['ownedPids'].append({**{key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}, 'owned': False})
        if unanchored:
            record['ownershipUncertain'] = True
            self.save()
            raise RuntimeError('Numeric group has no proven ownership anchor')
        selected |= {row['pid'] for row in rows.values() if row['pgid'] in anchored_groups and row['pgid'] in record['groups']}
        while True:
            expanded = selected | {row['pid'] for row in rows.values() if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        members = [rows[pid] for pid in selected]
        for row in members:
            if not any((item['pid'], item.get('start')) == (row['pid'], row['start']) for item in record['ownedPids']):
                record['ownedPids'].append({**{key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}, 'owned': bool(row['start'])})
        record['processSamples'] += 1
        self.save()
        for row in members:
            if not row['start']:
                record['ownershipUncertain'] = True
                self.save()
                raise RuntimeError('Owned descendant start is unknown')
            group = row['pgid']
            if group == os.getpgrp() or any(other['pgid'] == group and other['pid'] not in selected for other in rows.values()):
                if group not in record['uncertainGroups']:
                    record['uncertainGroups'].append(group)
                self.save()
                raise RuntimeError('Descendant entered a shared process group')
            if group not in record['groups']:
                record['groups'].append(group)
            args = shlex.split(row['command'])
            if args and Path(args[0]).name == 'node' and '--test' in args and '--test-concurrency=1' not in args:
                raise RuntimeError('Unbounded Node test worker count')
        self.save()
        return rows, members

    def sample_ports(self, members):
        if not members:
            return
        pids = {row['pid'] for row in members}
        reply = self.observer.query(['/usr/sbin/lsof', '-nP', '-a', '-p', ','.join(map(str, sorted(pids))),
                                '-iTCP', '-sTCP:LISTEN', '-Fpfn'], self.until)
        if reply.stderr or reply.returncode not in (0, 1) or (reply.returncode == 1 and reply.stdout):
            raise RuntimeError('Owned listener query is unknown')
        observed = listener_ports(reply.stdout, pids)
        if reply.returncode == 0 and not observed:
            raise RuntimeError('Empty successful listener query')
        ports = set(self.scratch.record['ports']) | observed
        if len(ports) > 128:
            raise RuntimeError('Owned listener observation cap exceeded')
        self.scratch.record['ports'] = sorted(ports)
        self.save()

    def rss(self, until):
        self.until = until
        _rows, members = self.observe()
        self.sample_ports(members)
        return sum(row['rss'] for row in members)

    def proof(self, until=None):
        if until is not None:
            self.until = until
        rows, _members = self.observe()
        record = self.scratch.record
        groups = set(record['groups']) | set(record['uncertainGroups'])
        ports_closed = True
        for port in record['ports']:
            reply = self.observer.query(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fpn'], self.until)
            if reply.returncode != 1 or reply.stdout or reply.stderr:
                ports_closed = False
        proof = {'joined': self.joined or self.process is None,
                 'pidsAbsent': not record.get('ownershipUncertain', False) and all(absent(item, rows) for item in record['ownedPids']),
                 'groupsAbsent': not any(row['pgid'] in groups for row in rows.values()),
                 'portsClosed': ports_closed, 'observedPids': len(record['ownedPids']),
                 'ports': list(record['ports']), 'sampledAt': time.time()}
        record['processAbsence'] = proof
        self.save()
        return proof

    def join_direct(self):
        process = self.process
        if process is None:
            return
        # Emergency path: no query or persistence, and no time check may bypass the kill attempt.
        # The only caller of this Popen's wait methods is this main thread. Default SIGCHLD
        # leaves exited children waitable; handled cancellation stays deferred through proof/signal/join.
        issue = None
        with deferred_signals(self.scratch.record):
            if process.returncode is None:
                if threading.current_thread() is not threading.main_thread() or signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
                    issue = 'Unreaped-child ownership cannot be established with this thread/SIGCHLD handler'
                else:
                    try:
                        waited, status = os.waitpid(process.pid, os.WNOHANG)
                    except ChildProcessError:
                        issue = 'Direct child was reaped outside its owning Popen handle'
                    else:
                        if waited == process.pid:
                            # Do not signal this numeric group after reaping its leader. PID reuse is now possible.
                            process.returncode = os.waitstatus_to_exitcode(status)
                            self.joined = True
                        elif waited == 0:
                            # waitpid(0) proves it is still our unreaped child. With no intervening wait/reaper,
                            # its PID cannot be reused, even if it exits before these fresh kernel identity reads.
                            try:
                                group, session = os.getpgid(process.pid), os.getsid(process.pid)
                                if group != process.pid or session != process.pid or group == os.getpgrp():
                                    raise RuntimeError('Direct child no longer owns its admitted session/group')
                                self.scratch.record['emergencyGroupSignal'] = {'pid': process.pid, 'pgid': group,
                                    'sid': session, 'basis': 'own-unreaped-child-WNOHANG-zero-and-fresh-getpgid-getsid',
                                    'signal': 'SIGKILL', 'at': time.time()}
                                os.killpg(group, signal.SIGKILL)
                            except (OSError, RuntimeError) as error:
                                issue = type(error).__name__ + ': ' + str(error)
                        else:
                            issue = 'Unexpected waitpid result for the owned direct child'
                # Popen's own direct kill remains the fallback; never invent group authority from a stored PGID.
                # This also runs after the deadline: the bounded wait below may be zero, but kill is still attempted.
                if process.returncode is None:
                    try:
                        process.kill()
                    except OSError as error:
                        issue = issue or type(error).__name__ + ': ' + str(error)
            try:
                process.wait(timeout=min(3, max(0, self.deadline - time.monotonic())))
                self.joined = True
            except subprocess.TimeoutExpired:
                issue = issue or 'Direct child join was not proved before the absolute deadline'
            if issue is not None:
                self.scratch.record.update(ownershipUncertain=True, directJoinIssue=issue)
                raise RuntimeError(issue)

    def stop_join(self, process):
        # Retain the actual Popen handle before a query or journal can fail.
        if self.process is not None and self.process is not process:
            raise RuntimeError('Direct child handle ownership differs')
        self.process = process
        self.observer.begin_cleanup()
        self.until = min(self.deadline, time.monotonic() + 6)
        first = None
        try:
            # Emergency group kill precedes every observation/wait that could reap the ownership anchor.
            self.join_direct()
            self.retain_direct(process)
            return self._stop_observed()
        except BaseException as error:
            first = error
            self.scratch.record['stopFailure'] = type(error).__name__ + ': ' + str(error)
            raise
        finally:
            if self.process is not None and not self.joined:
                try:
                    self.join_direct()
                except BaseException as error:
                    self.scratch.record['directJoinFailure'] = type(error).__name__ + ': ' + str(error)
                    if first is None:
                        raise

    def _stop_observed(self):
        process = self.process
        if process is None:
            self.joined = True
            return self.proof()
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                _rows, members = self.observe()
                for row in sorted(members, key=lambda item: item['pid'] == process.pid):
                    fresh = process_snapshot(self.observer, self.until)
                    current = fresh.get(row['pid'])
                    if current is None:
                        if not absent(row, fresh):
                            raise RuntimeError('Signal target absence is unknown')
                    elif current['start'] == row['start']:
                        try:
                            os.kill(row['pid'], sig)
                        except ProcessLookupError:
                            pass
                try:
                    process.wait(timeout=min(1, remaining(self.until)))
                    self.joined = True
                except subprocess.TimeoutExpired:
                    pass
                deadline = min(self.until, time.monotonic() + 1)
                while time.monotonic() < deadline:
                    proof = self.proof()
                    if all(proof[key] for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed')):
                        return proof
                    time.sleep(0.05)
            raise RuntimeError('Owned process/group absence is unproven after stop/join')
        except BaseException:
            # Best effort stops only exact previously owned PID/start pairs.
            # Any query uncertainty remains sticky and blocks deletion/release.
            for sig in (signal.SIGTERM, signal.SIGKILL):
                remaining(self.until)
                for item in self.scratch.record['ownedPids']:
                    if not item.get('owned') or not item.get('start'):
                        continue
                    try:
                        row = process_snapshot(self.observer, self.until).get(item['pid'])
                        if row is not None and row['start'] == item['start']:
                            os.kill(item['pid'], sig)
                    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                        if isinstance(error, SnapshotUnknown):
                            self.remember_unknown(error)
                        self.scratch.record.setdefault('signalUncertainty', []).append({
                            'pid': item['pid'], 'start': item['start'], 'error': type(error).__name__})
                self.save()
            # Unknown descendants remain recorded and prevent deletion/release.
            raise



def definitely_absent(path):
    # Keep the root936 lstat/parent-directory rule; lookup errors never mean absent.
    try:
        path.lstat()
    except FileNotFoundError:
        try:
            parent = path.parent.lstat()
            return stat.S_ISDIR(parent.st_mode) and str(path.parent.resolve(strict=True)) == str(path.parent)
        except (OSError, ValueError):
            return False
    except (OSError, ValueError):
        return False
    return False


class Scratch:
    """Physical owned scratch; construction has no process or filesystem side effects."""
    def __init__(self, resources, output, policy, checkpoint):
        self.resources, self.policy = resources, policy
        self.token = uuid.uuid4().hex
        self.root = Path('/private/tmp') / ('test-stamp-shard-' + self.token)
        self.manifest = output / 'ownership' / (self.token + '.json')
        self.record = {'version': 1, 'owner': {'pid': os.getpid(), 'start': None}, 'token': self.token,
            'root': str(self.root), 'state': 'planned', 'groups': [], 'peak': 0,
            'local_scratch_reason': policy.local_reason, 'created': time.time(), 'location': 'local',
            'checkpoint': str(checkpoint)}

    def save(self):
        self.resources.atomic_json(self.manifest, self.record)

    def __enter__(self):
        self.save()
        if str(self.root.parent.resolve(strict=True)) != str(self.root.parent) or not definitely_absent(self.root):
            raise RuntimeError('Require definite scratch absence under a canonical physical parent')
        self.root.mkdir(mode=0o700)
        value = self.root.lstat()
        if not stat.S_ISDIR(value.st_mode):
            raise RuntimeError('New scratch is not a physical directory')
        self.record.update(state='active', device=value.st_dev, inode=value.st_ino)
        self.save()
        return self

    def env(self, env):
        result = dict(env)
        result.update(dict.fromkeys(('TMPDIR', 'TMP', 'TEMP'), str(self.root)))
        return result

    def sample(self):
        used = allocated_bytes(self.root)
        self.record['peak'] = max(self.record['peak'], used)
        return used


def cleanup_scratch(scratch, tree, observer, until, attempted, ownership):
    # The caller retains the reservation on every uncertainty or persistence failure.
    observer.begin_cleanup()
    with deferred_signals(scratch.record):
        if attempted and ownership.get('cleanupVerified') is not True and ownership.get('phase') not in ('not-launched', 'no-child-created'):
            raise RuntimeError('Actual handle cleanup is unverified; retain scratch and charge')
        if not observer.finish(until):
            raise RuntimeError('Lifecycle query cleanup is unverified')
        proof = tree.proof(until)
        if not all(proof[key] is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed')):
            raise RuntimeError('Recursive process/group/port absence is unproven')
        try:
            value = scratch.root.lstat()
        except FileNotFoundError:
            if 'inode' in scratch.record or attempted or not definitely_absent(scratch.root):
                raise RuntimeError('Scratch disappeared before open-file proof, or absence is unknown')
        else:
            if not stat.S_ISDIR(value.st_mode) or (value.st_dev, value.st_ino) != (
                    scratch.record.get('device'), scratch.record.get('inode')):
                raise RuntimeError('Owned scratch physical identity differs')
            opened = observer.query(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], until, timeout=5)
            if opened.returncode != 1 or opened.stdout or opened.stderr:
                raise RuntimeError('Scratch open-file absence is unproven')
            proof = tree.proof(until)
            if not all(proof[key] is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed')):
                raise RuntimeError('Cleanup proof changed before deletion')
            current = scratch.root.lstat()
            if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (value.st_dev, value.st_ino):
                raise RuntimeError('Owned scratch changed before deletion')
            remaining(until)
            scratch.record['removedBytes'] = scratch.sample()
            shutil.rmtree(scratch.root)
        if not definitely_absent(scratch.root):
            raise RuntimeError('Definite scratch absence is unproven')
        proof.update(probesAbsent=observer.finish(until), openFilesAbsent=True, scratchAbsent=True)
        if proof['probesAbsent'] is not True:
            raise RuntimeError('Lifecycle query absence is unproven')
        scratch.record.update(state='removed', removed=time.time(), processAbsence=proof)
        scratch.save()
        return proof
