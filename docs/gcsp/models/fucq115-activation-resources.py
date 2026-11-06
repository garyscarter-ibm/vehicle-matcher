"""Owned strict resource adapter. Imported only after frozen admission succeeds.

No shared helper is patched. All unknown ledger/OS states refuse destructive
cleanup and reservation release. A retained manifest includes every observed
PID/start pair, including observations whose start cannot be established.
"""
import atexit
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
            # macOS pads the final lstart column. Match the per-PID helper's
            # outer trim before validating/comparing the actual timestamp.
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

        def acquire_owned(self, scratch, retained_bytes):
            rows = process_snapshot()
            identity = {key: rows[os.getpid()][key] for key in ['pid', 'start']}
            memory = resources.available_memory()
            if type(memory) is not int or memory <= 0:
                raise RuntimeError('Available host RAM is unknown')
            free = shutil.disk_usage(scratch.root.parent).free
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
                resources.atomic_json(self.path, data)
                if self.ledger().get(scratch.token) != row:
                    raise RuntimeError('Reservation write/readback differs')
                self.owned = (scratch.token, identity, str(scratch.root))

        def owned_row(self, data, token):
            expected = getattr(self, 'owned', None)
            row = data.get(token)
            if not expected or expected[0] != token or row is None \
                    or row['owner'] != expected[1] or row['root'] != expected[2]:
                raise RuntimeError('Reservation ownership is unknown')
            return row

        def update_owned(self, token, used, rss):
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                self.owned_row(data, token).update(used=used, rss=rss)
                resources.atomic_json(self.path, data)
                row = self.owned_row(self.ledger(), token)
                if row['used'] != used or row['rss'] != rss:
                    raise RuntimeError('Reservation telemetry differs')

        def release_owned(self, token, proof):
            if not proof or not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent', 'scratchAbsent']):
                raise RuntimeError('No proven cleanup authorises release')
            with resources.locked(self.directory / 'reservations.lock'):
                data = self.ledger()
                self.owned_row(data, token)
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
        self.record = scratch.record
        self.record.update(ownedPids=[], groups=[], uncertainGroups=[], processObservations=0)

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

    def register(self, process):
        self.process = process
        # Retain unknown before querying: a failed probe never drops its PID.
        item = {'pid': process.pid, 'start': None, 'pgid': process.pid, 'ppid': os.getpid(), 'owned': True}
        self.record['ownedPids'].append(item)
        self.record['groups'].append(process.pid)
        self.save()
        rows = process_snapshot()
        row = rows.get(process.pid)
        if row is None or row['pgid'] != process.pid or row['ppid'] != os.getpid():
            raise RuntimeError('Launched leader identity is unknown')
        item.update(start=row['start'])
        self.save()
        self.observe()

    def proof(self):
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

    def stop_join(self):
        try:
            return self._stop_join()
        except BaseException as error:
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
            process = self.process
            if process is not None:
                for action in [process.terminate, process.kill]:
                    if process.poll() is None:
                        action()
                    try:
                        process.wait(timeout=3)
                        self.joined = True
                        break
                    except subprocess.TimeoutExpired:
                        continue
            raise

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

    scratch = StrictScratch(rdir, root, policy, expected=16 * resources.MIB,
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
            if os.path.lexists(scratch.root):
                identity = scratch.root.lstat()
                if scratch.root.is_symlink() or (identity.st_dev, identity.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                    raise RuntimeError('Scratch physical identity differs')
                check = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=5)
                if check.returncode != 1 or check.stdout or check.stderr:
                    raise RuntimeError('Scratch open-file absence is unknown')
                # Last complete OS proof immediately precedes deletion.
                proof = self.tree.proof()
                if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                    raise RuntimeError('Process absence changed before deletion')
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
