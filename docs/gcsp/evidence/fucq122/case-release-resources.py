"""FUCQ-122 C4 owned proposal; copied from the unexecuted FUCQ-107 cancellation repair. Imported only after frozen admission succeeds.

No shared helper is patched. All unknown ledger/OS states refuse destructive
cleanup and reservation release. A retained manifest includes every observed
PID/start pair, including observations whose start cannot be established.
"""
import atexit
import contextlib
import fcntl
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
    def __init__(self, observations):
        super().__init__('OS process snapshot is incomplete or malformed')
        self.observations = observations


def process_snapshot():
    try:
        query = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='],
                               capture_output=True, text=True, timeout=3)
        output = query.stdout
        uncertain = query.returncode != 0 or bool(query.stderr) or not output.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        output = getattr(error, 'stdout', None) or ''
        if isinstance(output, bytes):
            output = output.decode('utf-8', errors='replace')
        uncertain = True
    rows, observations = {}, []
    for line in output.splitlines():
        parts = line.split(None, 5)
        if len(parts) == 6:
            parts[5] = parts[5].strip()
        partial = {key: int(parts[index]) if len(parts) > index and parts[index].isascii() and parts[index].isdigit() else None
                   for index, key in enumerate(['pid', 'ppid', 'pgid'])}
        partial['start'] = parts[5] if len(parts) == 6 and re.fullmatch(
            r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', parts[5]) else None
        if partial['pid'] and partial['pid'] > 0:
            observations.append(partial)
        if len(parts) != 6 or any(not value.isascii() or not value.isdigit() for value in parts[:4]):
            uncertain = True
            continue
        pid, ppid, pgid, rss = map(int, parts[:4])
        state, start = parts[4:]
        if pid <= 0 or pgid <= 0 or pid in rows or not state or state[0] not in 'RSDTtWXZIU' \
                or any(char not in '+<>AELNSsVWXl' for char in state[1:]) \
                or not re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', start):
            uncertain = True
            partial['start'] = None
            continue
        rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024,
                     'state': state, 'start': start}
    if uncertain or os.getpid() not in rows:
        raise SnapshotUncertain(observations)
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


def available_memory_strict():
    query = subprocess.run(['/usr/bin/vm_stat'], capture_output=True, text=True, timeout=3)
    if query.returncode != 0 or query.stderr:
        raise RuntimeError('Host memory probe failed')
    lines = query.stdout.splitlines()
    page = re.fullmatch(r'Mach Virtual Memory Statistics: \(page size of ([0-9]+) bytes\)', lines[0] if lines else '')
    if not page or int(page[1]) <= 0:
        raise RuntimeError('Host memory page size is unknown')
    wanted, counts = {'Pages free', 'Pages inactive', 'Pages purgeable'}, {}
    for line in lines[1:]:
        key = line.split(':', 1)[0]
        if key in wanted:
            value = re.fullmatch(r'([^:]+):\s+([0-9]+)\.', line)
            if not value or key in counts:
                raise RuntimeError('Host memory accounting is malformed')
            counts[key] = int(value[2])
    if set(counts) != wanted:
        raise RuntimeError('Host memory accounting is incomplete')
    return int(page[1]) * sum(counts.values())


def make_budget(resources, policy, directory, lock_identity):
    class StrictBudget(resources.HostBudget):
        def prohibited(self, *args, **kwargs):
            raise RuntimeError('Use strict owned budget methods only')
        headroom = acquire = update = release = prohibited

        @contextlib.contextmanager
        def locked(self):
            # Open the existing frozen lock read-only: never recreate it or
            # follow a replacement symlink before validating its identity.
            path = self.directory / 'reservations.lock'
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                value = os.fstat(fd)
                if (value.st_dev, value.st_ino) != tuple(lock_identity):
                    raise RuntimeError('Opened reservation lock identity differs')
                deadline = time.monotonic() + 2
                while True:
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Strict shared resource ledger is busy')
                        time.sleep(0.02)
                try:
                    yield
                finally:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

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

        def acquire_owned(self, scratch, retained_bytes):
            rows = process_snapshot()
            identity = {key: rows[os.getpid()][key] for key in ['pid', 'start']}
            memory = available_memory_strict()
            if type(memory) is not int or memory <= 0:
                raise RuntimeError('Available host RAM is unknown')
            free = shutil.disk_usage(scratch.root.parent).free
            with self.locked():
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
                resources.atomic_json(self.path, data)
                if self.ledger().get(scratch.token) != row:
                    raise RuntimeError('Reservation write/readback differs')
                self.owned = (scratch.token, identity, str(scratch.root), row['disk'], row['ram'], row['parent'])

        def owned_row(self, data, token):
            expected = getattr(self, 'owned', None)
            row = data.get(token)
            if not expected or expected[0] != token or row is None \
                    or row['owner'] != expected[1] or row['root'] != expected[2] \
                    or (row['disk'], row['ram'], row['parent']) != expected[3:]:
                raise RuntimeError('Reservation ownership is unknown')
            return row

        def update_owned(self, token, used, rss):
            with self.locked():
                if any(type(value) is not int or value < 0 for value in [used, rss]):
                    raise RuntimeError('Invalid owned accounting update')
                data = self.ledger()
                self.owned_row(data, token).update(used=used, rss=rss)
                resources.atomic_json(self.path, data)
                row = self.owned_row(self.ledger(), token)
                if row['used'] != used or row['rss'] != rss:
                    raise RuntimeError('Reservation telemetry differs')

        def release_owned(self, token, proof):
            if not proof or not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent', 'scratchAbsent']):
                raise RuntimeError('No proven cleanup authorises release')
            with self.locked():
                data = self.ledger()
                self.owned_row(data, token)
                if any(row['parent'] == token for row in data.values()):
                    raise RuntimeError('Owned reservation still has descendants')
                del data[token]
                resources.atomic_json(self.path, data)
                if self.ledger() != data:
                    raise RuntimeError('Reservation release readback failed')

        def authorize_cleanup(self, token):
            with self.locked():
                data = self.ledger()
                if any(row['parent'] == token for row in data.values()):
                    raise RuntimeError('Descendant reservation prevents scratch cleanup')
                if getattr(self, 'owned', None):
                    self.owned_row(data, token)
                elif token in data:
                    raise RuntimeError('Acquisition was uncertain; retain scratch and reservation')

        def absence(self, token):
            with self.locked():
                data = self.ledger()
                return token not in data and not any(row['parent'] == token for row in data.values())

    return StrictBudget(policy, directory=directory)


class ProcessTree:
    def __init__(self, resources, scratch):
        self.resources, self.scratch = resources, scratch
        self.process = None
        self.samples = 0
        self.peak_rss = 0
        self.joined = False
        self.record = scratch.record
        self.record.update(ownedPids=[], groups=[], uncertainGroups=[], processObservations=0,
                           launchAttempted=False, directHandleRetained=False, registrationComplete=False)

    def save(self):
        self.resources.atomic_json(self.scratch.manifest, self.record)

    def observe(self):
        try:
            rows = process_snapshot()
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

    @contextlib.contextmanager
    def deferred_cancellation(self, key, propagate):
        previous = {sig: signal.getsignal(sig) for sig in [signal.SIGTERM, signal.SIGINT]}
        received = []
        def defer(signum, frame):
            received.append(signum)
        try:
            for sig in previous:
                signal.signal(sig, defer)
            yield
        finally:
            # The launch handle is retained before handlers can raise again.
            # Cleanup calls this only around bounded direct-handle stop/wait.
            self.record.setdefault(key, []).extend(received)
            for sig, handler in previous.items():
                signal.signal(sig, handler)
            if received and propagate:
                raise KeyboardInterrupt('Cancellation deferred until child ownership handoff')

    def launch(self, command, **kwargs):
        if self.record['launchAttempted'] or self.process is not None:
            raise RuntimeError('Only one owned child launch is allowed')
        self.record['launchAttempted'] = True
        self.save()
        # The only deferred launch region is one Popen call and in-memory
        # retention. No probe, filesystem write, loop or registration occurs
        # inside it. The child gate stays closed until later full registration.
        with self.deferred_cancellation('cancellationDuringLaunch', propagate=True):
            self.process = subprocess.Popen(command, **kwargs)
            self.record['directHandleRetained'] = True
            self.record['ownedPids'].append({'pid': self.process.pid, 'start': None,
                'pgid': None, 'ppid': None, 'owned': True, 'direct': True})
        self.save()
        return self.process

    def register(self, process):
        if process is not self.process or not self.record['directHandleRetained']:
            raise RuntimeError('Registration requires the retained direct child handle')
        item = next((row for row in self.record['ownedPids'] if row.get('direct')
                     and row['pid'] == process.pid), None)
        if item is None:
            raise RuntimeError('Retained child observation is incomplete')
        try:
            rows = process_snapshot()
        except SnapshotUncertain as error:
            self.remember_uncertain(error)
            raise
        row = rows.get(process.pid)
        if row is None or row['pgid'] != process.pid or row['ppid'] != os.getpid():
            raise RuntimeError('Launched leader identity is unknown')
        item.update(**{key: row[key] for key in ['start', 'pgid', 'ppid']})
        self.record['groups'].append(row['pgid'])
        self.record['registrationComplete'] = True
        self.save()
        self.observe()

    def proof(self):
        rows, members, _rss = self.observe()
        registered = not self.record['launchAttempted'] or (self.process is not None
            and self.record['directHandleRetained'] and self.record['registrationComplete']
            and any(item.get('direct') and item['pid'] == self.process.pid and item.get('start')
                    for item in self.record['ownedPids']))
        pids_absent = registered and all(definitely_absent(item, rows) for item in self.record['ownedPids'])
        # An extant zombie is not absence. Wait/join precedes this proof.
        groups = set(self.record['groups']) | set(self.record['uncertainGroups'])
        groups_absent = registered and not any(row['pgid'] in groups for row in rows.values())
        result = {'joined': registered and (self.joined or not self.record['launchAttempted']), 'pidsAbsent': pids_absent,
                  'registrationComplete': registered,
                  'groupsAbsent': groups_absent, 'observedPids': len(self.record['ownedPids']),
                  'groups': sorted(groups), 'sampledAt': time.time()}
        self.record['processAbsence'] = result
        self.save()
        return result

    def stop_direct_handle(self):
        process = self.process
        if process is None:
            return
        # An unreaped direct Popen handle remains ours even if registration
        # never began/completed. Stop and join it before any evidence write or
        # descendant probe can fail. This never signals an inferred PID/group.
        with self.deferred_cancellation('cancellationDuringDirectCleanup', propagate=False):
            for action in [process.terminate, process.kill]:
                try:
                    if process.poll() is None:
                        action()
                except OSError as error:
                    self.record.setdefault('directCleanupErrors', []).append(type(error).__name__)
                try:
                    process.wait(timeout=3)
                    self.joined = True
                    self.record['directHandleJoined'] = True
                    return
                except subprocess.TimeoutExpired:
                    continue
        raise RuntimeError('Retained direct child was not joined within bounded cleanup')

    def stop_join(self):
        try:
            return self._stop_join()
        except BaseException as error:
            # Direct handle teardown is unconditional and precedes all
            # potentially failing record writes and descendant observations.
            self.stop_direct_handle()
            if isinstance(error, SnapshotUncertain):
                self.remember_uncertain(error)
            # A still-unreaped direct child is ours even when ps fails. Stop and
            # join that handle; independently stop already-known descendants
            # where a fresh full snapshot proves their exact start. Unknowns
            # remain in the manifest and prevent deletion/release.
            for sig in [signal.SIGTERM, signal.SIGKILL]:
                for item in self.record['ownedPids']:
                    if not item.get('owned') or not item.get('start'):
                        continue
                    try:
                        current = process_snapshot().get(item['pid'])
                        if current and current['start'] == item['start']:
                            os.kill(item['pid'], sig)
                    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                        if isinstance(error, SnapshotUncertain):
                            self.remember_uncertain(error)
                        self.record.setdefault('cleanupSignalUncertainty', []).append({
                            'pid': item['pid'], 'start': item['start'], 'error': type(error).__name__})
                self.save()
            raise

    def _stop_join(self):
        process = self.process
        if process is None:
            if self.record['launchAttempted']:
                raise RuntimeError('Launch attempted without a retained handle; preserve resources')
            self.joined = True
            return self.proof()
        if not self.record['registrationComplete']:
            self.stop_direct_handle()
            raise RuntimeError('Direct child joined but registration incomplete; preserve resources')
        for sig in [signal.SIGTERM, signal.SIGKILL]:
            rows, members, _rss = self.observe()
            # Signal exact observed identities individually. Never signal a
            # process merely because an old numeric group ID was retained.
            for row in sorted(members, key=lambda value: value['pid'] == process.pid):
                fresh = process_snapshot()
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


def make_scratch(resources, rdir, root, policy):
    class StrictScratch(resources.Scratch):
        def sample(self):
            value = allocated_bytes(self.root)
            self.record['peak'] = max(self.record['peak'], value)
            return value

        def __exit__(self, kind, value, traceback):
            # Only this owned finalizer calls deletion after an explicit proof.
            raise RuntimeError('Use the strict finalizer; automatic scratch deletion is prohibited')

    scratch = StrictScratch(rdir, root, policy, expected=1 * resources.MIB,
                            checkpoint=rdir / 'checkpoint.json')
    rows = process_snapshot()
    scratch.record['owner'] = {key: rows[os.getpid()][key] for key in ['pid', 'start']}
    return scratch


class Finalizer:
    def __init__(self, resources, scratch, tree, budget):
        self.resources, self.scratch, self.tree, self.budget = resources, scratch, tree, budget
        self.attempted = False
        self.result = None
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
            proof = self.tree.stop_join()
            if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                raise RuntimeError('Process proof incomplete; preserve scratch and reservation')
            self.scratch.record.update(state='stopped-and-joined', processAbsence=proof)
            self.tree.save()
            scratch = self.scratch
            self.budget.authorize_cleanup(scratch.token)
            if os.path.lexists(scratch.root):
                identity = scratch.root.lstat()
                if scratch.root.is_symlink() or (identity.st_dev, identity.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                    raise RuntimeError('Scratch physical identity differs')
                check = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=5)
                if check.returncode != 1 or check.stdout or check.stderr:
                    raise RuntimeError('Scratch open-file absence is unknown')
                # Last complete OS proof immediately precedes deletion.
                self.budget.authorize_cleanup(scratch.token)
                proof = self.tree.proof()
                if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                    raise RuntimeError('Process absence changed before deletion')
                fresh = scratch.root.lstat()
                if scratch.root.is_symlink() or (fresh.st_dev, fresh.st_ino) != (scratch.record['device'], scratch.record['inode']):
                    raise RuntimeError('Scratch identity changed before deletion')
                scratch.sample()
                shutil.rmtree(scratch.root)
            if os.path.lexists(scratch.root):
                raise RuntimeError('Scratch removal incomplete')
            proof['scratchAbsent'] = True
            scratch.record.update(state='removed', removed=time.time(), processAbsence=proof)
            self.tree.save()
            result.update(proof)
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
        self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
        return result
