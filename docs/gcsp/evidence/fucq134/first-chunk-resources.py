"""FUCQ-134 adaptation of reviewed918ce045 resources. Owned strict resource adapter. Imported only after frozen admission succeeds.

No shared helper is patched. All unknown ledger/OS states refuse destructive
cleanup and reservation release. A retained manifest includes every observed
PID/start pair, including observations whose start cannot be established.
"""
import atexit
import contextlib
import copy
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time


def strict_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result

    def constant(value):
        raise ValueError('Nonstandard JSON constant: ' + value)

    return json.loads(Path(path).read_text(), object_pairs_hook=pairs, parse_constant=constant)


class SnapshotUncertain(RuntimeError):
    def __init__(self, observations, diagnostic):
        super().__init__('OS process snapshot is incomplete or malformed')
        self.observations = observations
        self.diagnostic = diagnostic


def process_snapshot(timeout=3):
    query_exit, query_error, stderr = None, None, ''
    try:
        query = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='],
                               capture_output=True, text=True, timeout=timeout)
        output = query.stdout
        query_exit, stderr = query.returncode, query.stderr
        uncertain = query.returncode != 0 or bool(query.stderr) or not output.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        query_error = type(error).__name__
        stderr = getattr(error, 'stderr', None) or ''
        output = getattr(error, 'stdout', None) or ''
        if isinstance(output, bytes):
            output = output.decode('utf-8', errors='replace')
        uncertain = True
    rows, observations, first_rejected = {}, [], None
    def reject(number, line, reason):
        nonlocal first_rejected
        if first_rejected is None:
            first_rejected = {'line': min(number, (1 << 63) - 1), 'lineCapped': number >= (1 << 63),
                'rawFixedFields': line[:256], 'rawTruncated': len(line) > 256, 'reason': reason}
    for number, line in enumerate(output.splitlines(), 1):
        # ps pads the final lstart column. Normalize only trailing ASCII spaces
        # before BOTH partial and complete timestamp checks; grammar stays strict.
        parts = line.rstrip(' ').split(None, 5)
        partial = {key: int(parts[index]) if len(parts) > index and parts[index].isascii() and parts[index].isdigit() else None
                   for index, key in enumerate(['pid', 'ppid', 'pgid'])}
        partial['start'] = parts[5] if len(parts) == 6 and re.fullmatch(
            r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', parts[5]) else None
        if partial['pid'] and partial['pid'] > 0:
            observations.append(partial)
        if len(parts) != 6 or any(not value.isascii() or not value.isdigit() for value in parts[:4]):
            uncertain = True
            reject(number, line, 'column-count' if len(parts) != 6 else 'non-ascii-decimal-field')
            continue
        pid, ppid, pgid, rss = map(int, parts[:4])
        state, start = parts[4:]
        if pid <= 0 or pgid <= 0 or pid in rows or not state or state[0] not in 'RSDTtWXZIU' \
                or any(char not in '+<>AELNSsVWXl' for char in state[1:]) \
                or not re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', start):
            uncertain = True
            reason = 'pid-group-or-duplicate' if pid <= 0 or pgid <= 0 or pid in rows else \
                'state-grammar' if not state or state[0] not in 'RSDTtWXZIU' \
                or any(char not in '+<>AELNSsVWXl' for char in state[1:]) else 'start-grammar'
            reject(number, line, reason)
            partial['start'] = None
            continue
        rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024,
                     'state': state, 'start': start}
    if uncertain or os.getpid() not in rows:
        bounded_stderr = stderr[:512]
        if isinstance(bounded_stderr, bytes):
            bounded_stderr = bounded_stderr.decode('utf-8', errors='replace')
        raise SnapshotUncertain(observations, {'queryExit': query_exit, 'queryError': query_error,
            'stderr': bounded_stderr, 'stderrTruncated': len(stderr) > 512,
            'firstRejectedRow': first_rejected, 'ownerRowPresent': os.getpid() in rows})
    return rows


def definitely_absent(record, rows):
    """PID reuse is absence only when both starts are known and differ."""
    pid = record['pid']
    current = rows.get(pid)
    if current:
        return bool(record.get('start') and current['start'] != record['start'])
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


def allocated_bytes(root):
    total = 0
    if not os.path.lexists(root):
        return total
    def failed(error):
        raise error
    for folder, dirs, files in os.walk(root, followlinks=False, onerror=failed):
        for name in dirs + files:
            value = (Path(folder) / name).lstat()
            total += max(value.st_size, value.st_blocks * 512)
    return total


def make_budget(resources, policy, directory, lock_identity):
    class StrictBudget(resources.HostBudget):
        def ledger(self):
            # Every caller holds the same machine-wide lock. Missing, malformed,
            # duplicate-key, unknown-owner and cyclic-parent data are errors.
            lock = self.directory / 'reservations.lock'
            value = lock.lstat()
            if lock.is_symlink() or (value.st_dev, value.st_ino) != tuple(lock_identity):
                raise RuntimeError('Shared reservation lock identity differs')
            if self.path.is_symlink() or not self.path.is_file():
                raise RuntimeError('Reservation ledger missing or not a regular file')
            data = strict_json(self.path)
            if not isinstance(data, dict):
                raise ValueError('Reservation ledger must be an object')
            for token, row in data.items():
                if not isinstance(token, str) or not token or not isinstance(row, dict) \
                        or set(row) != {'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}:
                    raise ValueError('Unknown reservation shape')
                owner = row['owner']
                if not isinstance(owner, dict) or set(owner) != {'pid', 'start'} \
                        or type(owner['pid']) is not int or owner['pid'] <= 0 \
                        or not isinstance(owner['start'], str) \
                        or not re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', owner['start']):
                    raise ValueError('Unknown reservation owner')
                if any(type(row[key]) is not int or row[key] < 0 for key in ['disk', 'ram', 'used', 'rss']):
                    raise ValueError('Unknown reservation accounting')
                if row['parent'] is not None and (not isinstance(row['parent'], str) or row['parent'] not in data):
                    raise ValueError('Unknown reservation parent')
                if row['root'] is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()):
                    raise ValueError('Unknown reservation root')
                visited, parent = {token}, row['parent']
                while parent is not None:
                    if parent in visited or parent not in data or not isinstance(data[parent], dict):
                        raise ValueError('Cyclic/unknown reservation ancestry')
                    visited.add(parent)
                    parent = data[parent].get('parent')
            return data

        def acquire_owned(self, scratch, retained_bytes, tree):
            rows = tree.snapshot()
            identity = {key: rows[os.getpid()][key] for key in ['pid', 'start']}
            if identity != scratch.record['owner']:
                raise RuntimeError('Scratch/reservation owner identity differs')
            query = tree.probe(['/usr/bin/vm_stat'], timeout=3)
            lines = query.stdout.decode('ascii').splitlines()
            header = re.fullmatch(r'Mach Virtual Memory Statistics: \(page size of (\d+) bytes\)', lines[0]) if lines else None
            counts = {}
            for line in lines[1:]:
                match = re.fullmatch(r'([^:]+):\s+(\d+)\.', line)
                if not match or match[1] in counts:
                    raise RuntimeError('Host RAM probe is malformed')
                counts[match[1]] = int(match[2])
            required = ['Pages free', 'Pages inactive', 'Pages purgeable']
            if query.returncode or query.stderr or not header or not all(key in counts for key in required):
                raise RuntimeError('Available host RAM is unknown')
            memory = int(header[1]) * sum(counts[key] for key in required)
            if memory <= 0:
                raise RuntimeError('Available host RAM is unknown')
            free = shutil.disk_usage(scratch.project).free
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                if scratch.token in data:
                    raise RuntimeError('Reservation token already exists')
                # Never prune others. Conservatively count nested reservations
                # separately; stale or uncertain rows cannot disappear here.
                disk_pending = sum(max(0, row['disk'] - row['used']) for row in data.values())
                ram_pending = sum(max(0, row['ram'] - row['rss']) for row in data.values())
                if free - self.policy.reserve - disk_pending < 128 * resources.MIB + retained_bytes:
                    raise RuntimeError('Insufficient proven shared disk headroom')
                if memory - ram_pending - int(self.policy.ram_reserve_mib * resources.MIB) < 768 * resources.MIB:
                    raise RuntimeError('Insufficient proven shared RAM headroom')
                row = {'owner': identity, 'disk': 128 * resources.MIB, 'ram': 768 * resources.MIB,
                       'used': retained_bytes, 'rss': 0, 'parent': None, 'root': str(scratch.root)}
                data[scratch.token] = row
                self.owned = (scratch.token, copy.deepcopy(row))
                resources.atomic_json(self.path, data)
                if self.ledger().get(scratch.token) != row:
                    raise RuntimeError('Reservation write/readback differs')

        def owned_row(self, data, token):
            expected = getattr(self, 'owned', None)
            row = data.get(token)
            if not expected or expected[0] != token or row != expected[1]:
                raise RuntimeError('Complete expected reservation row differs')
            return row

        def update_owned(self, token, used, rss):
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                row = self.owned_row(data, token)
                updated = copy.deepcopy(row)
                updated.update(used=used, rss=rss)
                data[token] = updated
                resources.atomic_json(self.path, data)
                if self.ledger().get(token) != updated:
                    raise RuntimeError('Reservation telemetry differs')
                self.owned = (token, copy.deepcopy(updated))

        @contextlib.contextmanager
        def validated_deletion(self, token):
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                self.owned_row(data, token)
                if any(row['parent'] == token for row in data.values()):
                    raise RuntimeError('Child reservation still refers to this token')
                yield
                self.owned_row(self.ledger(), token)

        def release_owned(self, token, proof):
            if not proof or not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent', 'scratchAbsent']):
                raise RuntimeError('No proven cleanup authorises release')
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                self.owned_row(data, token)
                if any(row['parent'] == token for row in data.values()):
                    raise RuntimeError('Child reservation still refers to this token')
                del data[token]
                resources.atomic_json(self.path, data)
                if self.ledger() != data:
                    raise RuntimeError('Reservation release readback failed')

        def absence(self, token):
            with resources.locked(self.directory / 'reservations.lock'):
                return token not in self.ledger()

    return StrictBudget(policy, directory=directory)


class ProcessTree:
    def __init__(self, resources, scratch):
        self.resources, self.scratch = resources, scratch
        self.process = None
        self.samples = 0
        self.peak_rss = 0
        self.joined = False
        self.account = None
        self.deadline = None
        self.probes = {}
        self.record = scratch.record
        self.record.update(ownedPids=[], groups=[], uncertainGroups=[], processObservations=0, probeLaunches=[])

    def save(self):
        self.resources.atomic_json(self.scratch.manifest, self.record)

    def snapshot(self, deadline=None):
        if self.account:
            self.account(None)
        deadlines = [value for value in [self.deadline, deadline] if value is not None]
        remaining = min(deadlines) - time.monotonic() if deadlines else 3
        if remaining <= 0:
            raise RuntimeError('Resource-accounting deadline reached')
        rows = process_snapshot(timeout=min(3, remaining))
        if self.account:
            self.account(rows)
        return rows

    def _launch_probe(self, index, command, deadline):
        previous = {sig: signal.getsignal(sig) for sig in [signal.SIGTERM, signal.SIGINT]}
        cancelled = []
        def defer(signum, frame):
            cancelled.append(signum)
        try:
            for sig in previous:
                signal.signal(sig, defer)
            launch = {'state': 'creating', 'command': command[0], 'pid': None}
            self.record['probeLaunches'].append(launch)
            self.save()
            self.probes[index] = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env=self.scratch.env(os.environ), start_new_session=True)
            process = self.probes[index]
            item = {'pid': process.pid, 'start': None, 'pgid': process.pid, 'ppid': os.getpid(), 'owned': True}
            self.record['ownedPids'].append(item)
            self.record['groups'].append(process.pid)
            launch['pid'] = process.pid
            self.save()
            row = self.snapshot(deadline).get(process.pid)
            if row:
                if row['pgid'] != process.pid or row['ppid'] != os.getpid():
                    raise RuntimeError('Probe identity differs')
                item['start'] = row['start']
            elif process.poll() is None:
                raise RuntimeError('Probe identity is unknown')
            launch['state'] = 'registered'
            self.save()
        finally:
            if cancelled:
                self.record['deferredProbeCancellation'] = cancelled
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        if cancelled:
            raise KeyboardInterrupt('Cancellation deferred until probe ownership was persisted')
        return self.probes[index]

    def probe(self, command, timeout):
        if command[0] not in ['/usr/bin/vm_stat', '/usr/sbin/lsof']:
            raise RuntimeError('Unreviewed probe command')
        index = len(self.record['probeLaunches'])
        started = time.monotonic()
        deadline = started + timeout
        output, errors = bytearray(), bytearray()
        try:
            process = self._launch_probe(index, command, deadline)
            for stream in [process.stdout, process.stderr]:
                os.set_blocking(stream.fileno(), False)
            def drain():
                for stream, target in [(process.stdout, output), (process.stderr, errors)]:
                    while True:
                        try:
                            data = os.read(stream.fileno(), 65536)
                        except BlockingIOError:
                            break
                        if not data:
                            break
                        target.extend(data)
                        if len(output) + len(errors) > 128 * 1024:
                            raise RuntimeError('Probe output exceeds128KiB')
            while True:
                drain()
                self.snapshot(deadline)
                if process.poll() is not None:
                    drain()
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('Probe time limit reached')
                time.sleep(0.02)
            return subprocess.CompletedProcess(command, process.returncode, bytes(output), bytes(errors))
        finally:
            process = self.probes.get(index)
            if process is not None:
                # Joining a known handle never depends on metering or persistence.
                self._stop_handle(process)
                for stream in [process.stdout, process.stderr]:
                    if stream and not stream.closed:
                        stream.close()
                launch = self.record['probeLaunches'][index]
                if process.returncode is not None and launch['state'] == 'registered':
                    launch['state'] = 'joined'
                if self.account:
                    self.account(None)
                self.save()

    def observe(self):
        try:
            rows = self.snapshot()
        except SnapshotUncertain as error:
            self.remember_uncertain(error)
            raise
        known = self.record['ownedPids']
        selected = {item['pid'] for item in known if item.get('owned') and item.get('start') and item['pid'] in rows
                    and rows[item['pid']]['start'] == item['start']}
        anchored_groups = {rows[pid]['pgid'] for pid in selected}
        uncertain = [row for row in rows.values() if row['pgid'] in self.record['groups']
                     and row['pgid'] not in anchored_groups]
        for row in uncertain:
            if not any((item['pid'], item.get('start')) == (row['pid'], row['start']) for item in known):
                known.append({**{key: row[key] for key in ['pid', 'ppid', 'pgid', 'start']}, 'owned': False})
        if uncertain:
            self.save()
            raise RuntimeError('Unanchored numeric group; ownership is uncertain')
        selected |= {row['pid'] for row in rows.values() if row['pgid'] in anchored_groups
                     and row['pgid'] in self.record['groups']}
        while True:
            expanded = selected | {row['pid'] for row in rows.values() if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        members = [rows[pid] for pid in selected]
        for row in members:
            existing = next((item for item in known if (item['pid'], item.get('start')) == (row['pid'], row['start'])), None)
            if existing is None:
                known.append({**{key: row[key] for key in ['pid', 'ppid', 'pgid', 'start']}, 'owned': True})
        # Persist all observations before rejecting a shared/unknown group.
        self.record['processObservations'] += 1
        self.save()
        for group in {row['pgid'] for row in members}:
            if group == os.getpgrp() or any(row['pgid'] == group and row['pid'] not in selected for row in rows.values()):
                if group not in self.record['uncertainGroups']:
                    self.record['uncertainGroups'].append(group)
                self.save()
                raise RuntimeError('Shared descendant process group refused')
            if group not in self.record['groups']:
                self.record['groups'].append(group)
        rss = sum(row['rss'] for row in members)
        self.peak_rss = max(self.peak_rss, rss)
        self.samples += 1
        self.record.update(peakAggregateRSS=self.peak_rss, lastProcessSample=time.time())
        self.save()
        return rows, members, rss

    def remember_uncertain(self, error):
        # Keep relevant partial PID/start observations before refusing the
        # entire snapshot. Unknown start is explicit; never filter it out.
        selected = {item['pid'] for item in self.record['ownedPids']}
        while True:
            expanded = selected | {row['pid'] for row in error.observations
                                   if row['ppid'] in selected or row['pgid'] in self.record['groups']}
            if expanded == selected:
                break
            selected = expanded
        for row in error.observations:
            if row['pid'] in selected and not any((item['pid'], item.get('start')) == (row['pid'], row.get('start'))
                                                 for item in self.record['ownedPids']):
                self.record['ownedPids'].append({**row, 'owned': False})
            if row['pid'] in selected and row.get('pgid') and row['pgid'] not in self.record['uncertainGroups']:
                self.record['uncertainGroups'].append(row['pgid'])
        self.record.setdefault('uncertainSnapshots', []).append(time.time())
        self.save()

    def register(self, process):
        if self.process is not None and self.process is not process:
            raise RuntimeError('A different direct child is already owned')
        self.process = process
        # Retain unknown before querying: a failed probe never drops its PID.
        item = {'pid': process.pid, 'start': None, 'pgid': process.pid, 'ppid': os.getpid(), 'owned': True}
        self.record['ownedPids'].append(item)
        self.record['groups'].append(process.pid)
        self.save()
        rows = self.snapshot()
        row = rows.get(process.pid)
        if row is None or row['pgid'] != process.pid or row['ppid'] != os.getpid():
            raise RuntimeError('Launched leader identity is unknown')
        item.update(start=row['start'])
        self.save()
        self.observe()

    def launch(self, command, **options):
        if self.process is not None or 'launch' in self.record:
            raise RuntimeError('Only one launch attempt is permitted')
        previous = {sig: signal.getsignal(sig) for sig in [signal.SIGTERM, signal.SIGINT]}
        cancelled = []
        def defer(signum, frame):
            cancelled.append(signum)
        # Keep handled cancellation out of Popen's return/assignment interval.
        # A persisted unresolved intent also covers exceptions without a handle.
        try:
            for sig in previous:
                signal.signal(sig, defer)
            self.record['launch'] = {'state': 'creating', 'at': time.time(), 'pid': None}
            self.save()
            self.joined = False
            self.process = subprocess.Popen(command, **options)
            self.register(self.process)
            self.record['launch'].update(state='registered', pid=self.process.pid)
            self.save()
        finally:
            if cancelled:
                self.record['deferredLaunchCancellation'] = cancelled
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        if cancelled:
            self.save()
            raise KeyboardInterrupt('Cancellation deferred until child ownership was persisted')
        return self.process

    def proof(self):
        launch = self.record.get('launch')
        if self.record.get('unresolvedChildHandle'):
            raise RuntimeError('Conflicting direct child handle; absence cannot be certified')
        if launch and (launch['state'] != 'registered' or self.process is None):
            raise RuntimeError('Unresolved child creation/registration; absence cannot be certified')
        if self.process is not None and not any(item['pid'] == self.process.pid for item in self.record['ownedPids']):
            raise RuntimeError('Direct child handle lacks persisted ownership')
        if any(row['state'] != 'joined' or index not in self.probes or self.probes[index].returncode is None
               for index, row in enumerate(self.record['probeLaunches'])):
            raise RuntimeError('Probe creation/join is unresolved')
        rows, members, _rss = self.observe()
        pids_absent = all(definitely_absent(item, rows) for item in self.record['ownedPids'])
        # An extant zombie is not absence. Wait/join precedes this proof.
        groups = set(self.record['groups']) | set(self.record['uncertainGroups'])
        groups_absent = not any(row['pgid'] in groups for row in rows.values())
        result = {'joined': self.joined or self.process is None, 'pidsAbsent': pids_absent,
                  'groupsAbsent': groups_absent, 'observedPids': len(self.record['ownedPids']),
                  'groups': sorted(groups), 'sampledAt': time.time()}
        self.record['processAbsence'] = result
        self.save()
        return result

    def stop_join(self, process=None):
        try:
            if process is not None and self.process is None:
                self.record.setdefault('launch', {'state': 'unregistered', 'at': time.time(), 'pid': process.pid})
                self.process = process
                self.register(process)
            elif process is not None and self.process is not process:
                self.record['unresolvedChildHandle'] = {'pid': process.pid, 'at': time.time()}
                self.save()
                raise RuntimeError('Cleanup received a conflicting child handle')
            return self._stop_join()
        except BaseException as error:
            try:
                if isinstance(error, SnapshotUncertain):
                    self.remember_uncertain(error)
                # Descendant signals still require fresh exact PID/start proof.
                # Persistence failures cannot bypass the direct-handle finally.
                for sig in [signal.SIGTERM, signal.SIGKILL]:
                    for item in self.record['ownedPids']:
                        if not item.get('owned') or not item.get('start'):
                            continue
                        try:
                            current = self.snapshot().get(item['pid'])
                            if current and current['start'] == item['start']:
                                os.kill(item['pid'], sig)
                        except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                            if isinstance(error, SnapshotUncertain):
                                self.remember_uncertain(error)
                            self.record.setdefault('cleanupSignalUncertainty', []).append({
                                'pid': item['pid'], 'start': item['start'], 'error': type(error).__name__})
                    self.save()
            finally:
                self._stop_direct_handle()
                if self.account:
                    self.account(None)
            raise

    def _stop_direct_handle(self):
        self._stop_handle(self.process)

    def _stop_handle(self, process):
        if process is None:
            return
        # No manifest writes or OS snapshots may prevent bounded direct join.
        for action in [process.terminate, process.kill]:
            try:
                if process.poll() is None:
                    action()
            except BaseException as error:
                self.record.setdefault('directHandleErrors', []).append(type(error).__name__)
            try:
                process.wait(timeout=3)
                if process is self.process:
                    self.joined = True
                break
            except BaseException as error:
                self.record.setdefault('directHandleErrors', []).append(type(error).__name__)

    def _stop_join(self):
        process = self.process
        if process is None:
            self.joined = True
            return self.proof()
        for sig in [signal.SIGTERM, signal.SIGKILL]:
            rows, members, _rss = self.observe()
            # Signal exact observed identities individually. Never signal a
            # process merely because an old numeric group ID was retained.
            for row in sorted(members, key=lambda value: value['pid'] == process.pid):
                fresh = self.snapshot()
                current = fresh.get(row['pid'])
                if current is None:
                    if not definitely_absent(row, fresh):
                        raise RuntimeError('Signal target absence is uncertain')
                    continue
                if current['start'] != row['start']:
                    continue
                try:
                    os.kill(row['pid'], sig)
                except ProcessLookupError:
                    continue
            try:
                process.wait(timeout=3)
                self.joined = True
            except subprocess.TimeoutExpired:
                pass
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                proof = self.proof()
                if all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                    return proof
                time.sleep(0.05)
        raise RuntimeError('Owned PIDs/groups not proven absent after stop/join')


def make_scratch(resources, rdir, project, policy, ownership):
    class StrictScratch:
        def __init__(self):
            import uuid
            self.token = 'fucq134-' + uuid.uuid4().hex
            self.project = Path(project)
            self.root = self.project / '.claude/test-scratch/fucq134' / self.token
            self.manifest = Path(ownership) / (self.token + '.json')
            self.record = {'version': 1, 'token': self.token, 'root': str(self.root),
                'owner': {'pid': os.getpid(), 'start': None},
                'state': 'planned', 'peak': 0, 'created': time.time(),
                'checkpoint': str(rdir / 'checkpoint.json')}

        def __enter__(self):
            for path in [self.root.parent, *self.root.parent.parents]:
                if path.is_symlink():
                    raise RuntimeError('Scratch ancestor symlink refused: ' + str(path))
            self.root.parent.mkdir(parents=True, exist_ok=True)
            self.root.mkdir(mode=0o700)
            value = self.root.lstat()
            self.record.update(state='active', device=value.st_dev, inode=value.st_ino)
            resources.atomic_json(self.manifest, self.record)
            return self

        def env(self, environment):
            return {**environment, **dict.fromkeys(['TMPDIR', 'TMP', 'TEMP'], str(self.root))}

        def sample(self):
            value = allocated_bytes(self.root)
            self.record['peak'] = max(self.record['peak'], value)
            return value

    return StrictScratch()


class Finalizer:
    def __init__(self, resources, scratch, tree, budget, verify):
        self.resources, self.scratch, self.tree, self.budget = resources, scratch, tree, budget
        self.attempted = False
        self.result = None
        self.verify = verify
        atexit.register(self.finish)

    def finish(self):
        previous = {sig: signal.getsignal(sig) for sig in [signal.SIGTERM, signal.SIGINT]}
        def deferred(signum, frame):
            self.scratch.record.setdefault('cancellationDuringCleanup', []).append(signum)
        try:
            for sig in previous:
                signal.signal(sig, deferred)
            return self._finish()
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)

    def _finish(self):
        if self.attempted:
            return self.result
        self.attempted = True
        result = {'passed': False, 'scratchAbsent': False, 'reservationAbsent': False}
        try:
            self.tree.phase = 'cleanup'
            proof = self.tree.stop_join()
            if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                raise RuntimeError('Process proof incomplete; preserve scratch and reservation')
            self.scratch.record.update(state='stopped-and-joined', processAbsence=proof)
            self.tree.save()
            self.tree.phase = 'cleanup-verification'
            self.tree.snapshot()
            self.verify()
            self.tree.snapshot()
            result['pinsPreserved'] = True
            self.tree.phase = 'cleanup'
            scratch = self.scratch
            if os.path.lexists(scratch.root):
                identity = scratch.root.lstat()
                if scratch.root.is_symlink() or (identity.st_dev, identity.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                    raise RuntimeError('Scratch physical identity differs')
                check = self.tree.probe(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], timeout=5)
                if check.returncode != 1 or check.stdout or check.stderr:
                    raise RuntimeError('Scratch open-file absence is unknown')
                # Last complete OS proof immediately precedes deletion.
                proof = self.tree.proof()
                if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                    raise RuntimeError('Process absence changed before deletion')
                with self.budget.validated_deletion(scratch.token):
                    identity = scratch.root.lstat()
                    if scratch.root.is_symlink() or (identity.st_dev, identity.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                        raise RuntimeError('Scratch identity changed before locked deletion')
                    shutil.rmtree(scratch.root)
            if os.path.lexists(scratch.root):
                raise RuntimeError('Scratch removal incomplete')
            proof['scratchAbsent'] = True
            scratch.record.update(state='removed', removed=time.time(), processAbsence=proof)
            self.tree.save()
            result.update(proof)
            self.tree.snapshot()
            if getattr(self.budget, 'owned', None):
                self.budget.release_owned(scratch.token, proof)
            result['reservationAbsent'] = self.budget.absence(scratch.token)
            result['passed'] = result['reservationAbsent']
            if self.scratch.record.get('cancellationDuringCleanup'):
                result.update(passed=False, cancelledDuringCleanup=True)
        except BaseException as error:
            result['error'] = type(error).__name__ + ': ' + str(error)[:1024]
        self.result = result
        self.scratch.record['finalizer'] = result
        # The supervisor preencodes this final manifest with receipt/checkpoint
        # inside its reserved completion budget. No unmetered write after release.
        return result
