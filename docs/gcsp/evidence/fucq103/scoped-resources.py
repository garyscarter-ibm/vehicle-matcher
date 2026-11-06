"""FUCQ-103 owned resource guard; loaded from admitted bytes only.

Unknown OS/ledger state is a retained cleanup issue, never proof of absence.
No shared resource helper is patched. No application code is imported here.
"""
import atexit
from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import stat
import subprocess
import time

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
            raw_start = None
            identity, command = None, fields[4].split(None, 1)[1] if len(fields[4].split(None, 1)) == 2 else ''
        elif len(tail) == 6 and start_identity(' '.join(tail[:5])):
            # Legacy launchers compare owner.start with raw ps lstart text.
            # Keep its internal padding separate from normalized PID identity.
            raw_start = re.match(r'\S+(?:\s+\S+){4}', fields[4]).group()
            identity, command = start_identity(' '.join(tail[:5])), tail[5]
        else:
            unknown = True
            continue
        partial['start'] = identity
        if pid in rows or not command:
            unknown = True
            continue
        rows[pid] = {'pid': pid, 'ppid': parent, 'pgid': group, 'rss': rss * 1024,
                     'start': identity, 'rawStart': raw_start, 'command': command}
    if unknown or supervisor not in rows or not rows[supervisor]['start']:
        raise SnapshotUnknown(observations)
    return rows


def process_snapshot():
    try:
        reply = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart=,args='],
                               capture_output=True, text=True, timeout=3)
    except (OSError, UnicodeError, subprocess.TimeoutExpired) as error:
        output = getattr(error, 'stdout', None) or ''
        if isinstance(output, bytes):
            output = output.decode('utf-8', errors='replace')
        try:
            parse_snapshot(output, 1, 'query failed', os.getpid())
        except SnapshotUnknown as unknown:
            raise unknown from error
    return parse_snapshot(reply.stdout, reply.returncode, reply.stderr, os.getpid())


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
    if not os.path.lexists(root):
        return 0
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


def available_memory():
    reply = subprocess.run(['/usr/bin/vm_stat'], capture_output=True, text=True, timeout=3)
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
    def __init__(self, resources, policy, contract):
        self.resources, self.policy, self.contract = resources, policy, contract
        self.directory = Path(contract['directory'])
        self.path, self.lock = self.directory / 'reservations.json', self.directory / 'reservations.lock'
        self.expected = None

    @contextmanager
    def locked(self):
        for name, expected in self.contract['anchors'].items():
            if physical_anchor(name) != expected:
                raise RuntimeError('Host accounting physical identity differs')
        fd = os.open(self.lock, os.O_RDWR | os.O_NOFOLLOW)
        try:
            value = os.fstat(fd)
            expected = self.contract['anchors'][str(self.lock)]
            if (value.st_dev, value.st_ino) != (expected['device'], expected['inode']):
                raise RuntimeError('Host reservation lock changed before open')
            deadline = time.monotonic() + 2
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
            yield
        finally:
            os.close(fd)

    def ledger(self):
        for name, expected in self.contract['anchors'].items():
            if physical_anchor(name) != expected:
                raise RuntimeError('Host accounting anchor changed before ledger read')
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise RuntimeError('Host reservation ledger is not regular')
            data = strict_json(stream.read())
        if not isinstance(data, dict):
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
        rows = process_snapshot()
        identity = {'pid': os.getpid(), 'start': rows[os.getpid()]['rawStart']}
        memory = available_memory()
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
            scratch.record['reservationIntent'] = {'token': scratch.token, 'row': row}
            scratch.record['headroom'] = {'freeBytes': free, 'availableRamBytes': memory,
                'outsideDiskPending': disk_pending, 'outsideRamPending': ram_pending,
                'lowDiskHeadroom': free < self.contract['preferredFreeBytes']}
            self.resources.atomic_json(scratch.manifest, scratch.record)
            data[scratch.token] = row
            self.resources.atomic_json(self.path, data)
            if self.ledger().get(scratch.token) != row:
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
        with self.locked():
            data = self.ledger()
            self.owned_row(data, token).update(used=used, rss=rss)
            self.resources.atomic_json(self.path, data)
            row = self.owned_row(self.ledger(), token)
            if row['used'] != used or row['rss'] != rss:
                raise RuntimeError('Reservation telemetry readback differs')

    def release(self, token, proof):
        if not all(proof.get(key) is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed', 'scratchAbsent')):
            raise RuntimeError('Complete cleanup proof is required for reservation release')
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


@contextmanager
def creation_window(record):
    # Defer handled cancellation across Popen return, assignment and registration.
    # Signal masks remain unchanged in the child; the gate stays closed throughout.
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    pending = []
    def deferred(signum, frame):
        pending.append(signum)
    try:
        for sig in previous:
            signal.signal(sig, deferred)
        yield
    finally:
        if pending:
            record['cancellationDuringCreation'] = list(pending)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if pending:
            raise KeyboardInterrupt('Handled cancellation deferred until child registration')


class Tree:
    def __init__(self, resources, scratch):
        self.resources, self.scratch = resources, scratch
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

    def register(self, process):
        self.process = process
        item = {'pid': process.pid, 'ppid': os.getpid(), 'pgid': process.pid, 'start': None, 'owned': True}
        self.scratch.record['ownedPids'].append(item)
        self.scratch.record['groups'].append(process.pid)
        self.save()
        try:
            rows = process_snapshot()
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
            rows = process_snapshot()
        except SnapshotUnknown as error:
            self.remember_unknown(error)
            raise
        # Reap an exited direct child before interpreting a transient unknown
        # start from that same Popen handle; every other unknown stays explicit.
        if (self.process is not None and rows.get(self.process.pid) is not None
                and not rows[self.process.pid]['start'] and self.process.poll() is not None):
            try:
                rows = process_snapshot()
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
        reply = subprocess.run(['/usr/sbin/lsof', '-nP', '-a', '-p', ','.join(map(str, sorted(pids))),
                                '-iTCP', '-sTCP:LISTEN', '-Fpfn'], capture_output=True, text=True, timeout=3)
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

    def proof(self):
        rows, _members = self.observe()
        record = self.scratch.record
        groups = set(record['groups']) | set(record['uncertainGroups'])
        ports_closed = True
        for port in record['ports']:
            reply = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fpn'],
                                   capture_output=True, text=True, timeout=3)
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
        # Direct joining never queries or persists a manifest before wait.
        for action in (process.terminate, process.kill):
            try:
                if process.poll() is None:
                    action()
            except OSError:
                pass
            try:
                process.wait(timeout=3)
                self.joined = True
                return
            except subprocess.TimeoutExpired:
                continue
        raise RuntimeError('Direct child stop/join remains unproven')

    def stop_join(self):
        try:
            return self._stop_observed()
        finally:
            if self.process is not None and not self.joined:
                self.join_direct()

    def _stop_observed(self):
        process = self.process
        if process is None:
            self.joined = True
            return self.proof()
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                _rows, members = self.observe()
                for row in sorted(members, key=lambda item: item['pid'] == process.pid):
                    fresh = process_snapshot()
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
                    process.wait(timeout=3)
                    self.joined = True
                except subprocess.TimeoutExpired:
                    pass
                deadline = time.monotonic() + 3
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
                for item in self.scratch.record['ownedPids']:
                    if not item.get('owned') or not item.get('start'):
                        continue
                    try:
                        row = process_snapshot().get(item['pid'])
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


def make_scratch(resources, retained, project, policy):
    class Scratch(resources.Scratch):
        def sample(self):
            used = allocated_bytes(self.root)
            self.record['peak'] = max(self.record['peak'], used)
            return used
        def __exit__(self, kind, value, traceback):
            raise RuntimeError('Only the admitted finalizer may delete owned scratch')
    rows = process_snapshot()
    scratch = Scratch(retained, project, policy, expected=128 * MIB)
    scratch.record['owner'] = {'pid': os.getpid(), 'start': rows[os.getpid()]['rawStart']}
    return scratch


class Finalizer:
    def __init__(self, resources, scratch, tree, budget):
        self.resources, self.scratch, self.tree, self.budget = resources, scratch, tree, budget
        self.result = None
        atexit.register(self.finish)

    def finish(self, preserve=None):
        if self.result is not None:
            return self.result
        previous = {}
        def deferred(signum, frame):
            self.scratch.record.setdefault('cancellationDuringCleanup', []).append(signum)
        result = {'passed': False, 'scratchAbsent': False, 'reservationAbsent': False}
        # Entry cancellation leaves result unset, so atexit can retry.
        try:
            for sig in (signal.SIGTERM, signal.SIGINT):
                previous[sig] = signal.getsignal(sig)
                signal.signal(sig, deferred)
        except BaseException:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
            raise
        try:
            proof = self.tree.stop_join()
            if not all(proof[key] is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed')):
                raise RuntimeError('Process cleanup is unproven; retain scratch and reservation')
            scratch = self.scratch
            scratch.record.update(state='stopped-and-joined', processAbsence=proof)
            self.tree.save()
            if os.path.lexists(scratch.root):
                value = scratch.root.lstat()
                if scratch.root.is_symlink() or (value.st_dev, value.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                    raise RuntimeError('Owned scratch identity changed')
                if preserve is not None:
                    preserve()
                opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=5)
                if opened.returncode != 1 or opened.stdout or opened.stderr:
                    raise RuntimeError('Scratch open-file absence is unproven')
                proof = self.tree.proof()
                if not all(proof[key] is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed')):
                    raise RuntimeError('Cleanup proof changed before deletion')
                result['removedBytes'] = scratch.sample()
                shutil.rmtree(scratch.root)
            if os.path.lexists(scratch.root):
                raise RuntimeError('Owned scratch still exists')
            proof['scratchAbsent'] = True
            scratch.record.update(state='removed', removed=time.time(), processAbsence=proof)
            self.tree.save()
            result.update(proof)
            self.budget.release(scratch.token, proof)
            result['reservationAbsent'] = self.budget.absence(scratch.token)
            result['passed'] = result['reservationAbsent'] and not scratch.record.get('cancellationDuringCleanup')
        except BaseException as error:
            result['error'] = type(error).__name__ + ': ' + str(error)[:1024]
        finally:
            try:
                if self.tree.process is not None and not self.tree.joined:
                    self.tree.join_direct()
            except BaseException as error:
                result.update(passed=False, directJoinError=type(error).__name__ + ': ' + str(error)[:1024])
            # Memoize only after cleanup and the persistence-independent join.
            self.result = result
            self.scratch.record['finalizer'] = result
            try:
                self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
            except BaseException as error:
                result.update(passed=False, receiptError=type(error).__name__ + ': ' + str(error)[:1024])
            finally:
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
        return result
