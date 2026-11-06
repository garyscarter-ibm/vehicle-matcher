"""FUCQ-122 C4 owned proposal; copied from the unexecuted FUCQ-107 cancellation repair. Imported only after frozen admission succeeds.

No shared helper is patched. All unknown ledger/OS states refuse destructive
cleanup and reservation release. A retained manifest includes every observed
PID/start pair, including observations whose start cannot be established.
"""
import atexit
import contextlib
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

STOP_AT = None
PROCESS_ROWS = None


def remaining(cap):
    return cap if STOP_AT is None else max(0, min(cap, STOP_AT-time.monotonic()))


class SnapshotUncertain(RuntimeError):
    def __init__(self, observations):
        super().__init__('OS process snapshot is incomplete or malformed')
        self.observations = observations


def process_snapshot():
    if remaining(3) <= 0 or PROCESS_ROWS is None:
        raise RuntimeError('Whole-chunk deadline/parser binding unknown; no process query')
    query = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='],
                           capture_output=True, text=True, timeout=3)
    return PROCESS_ROWS(query.stdout, query.stderr, query.returncode)


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
        if len(self.record['ownedPids']) > 512 or len(self.record['groups']) > 512 \
                or len(self.record['uncertainGroups']) > 512:
            raise RuntimeError('Owned process/group identity cap reached')
        self.resources.atomic_json(self.scratch.manifest, self.record)

    def observe(self, rows=None):
        try:
            rows = process_snapshot() if rows is None else rows
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

    def proof(self, rows=None):
        rows, members, _rss = self.observe(rows)
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
                    process.wait(timeout=remaining(3))
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
                process.wait(timeout=remaining(3))
                self.joined = True
            except subprocess.TimeoutExpired:
                pass
            deadline = time.monotonic() + remaining(3)
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
    def __init__(self, resources, scratch, tree, budget, monitor):
        self.resources, self.scratch, self.tree, self.budget = resources, scratch, tree, budget
        self.monitor = monitor
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
        result = {'passed': False, 'scratchAbsent': False, 'reservationHeldForCompletion': True}
        try:
            proof = self.tree.stop_join()
            if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                raise RuntimeError('Process proof incomplete; preserve scratch and reservation')
            self.scratch.record.update(state='stopped-and-joined', processAbsence=proof)
            self.tree.save()
            scratch = self.scratch
            if os.path.lexists(scratch.root):
                check = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=5)
                if check.returncode != 1 or check.stdout or check.stderr:
                    raise RuntimeError('Scratch open-file absence is unknown')
            # Stop new monitor/helper probes; the last query producer is joined before proof.
            rows, helper_proof = self.monitor.absence()
            proof = self.tree.proof(rows)
            if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                raise RuntimeError('Final complete process absence is unknown')
            proof['helpersAbsent'] = helper_proof['helpers_absent']
            # OS proof first; hold the pinned lock and full owned-row/dependent binding
            # continuously through the final inode check, deletion and absence check.
            with self.budget.cleanup_authority(scratch.token, helper_proof['owner_start']):
                if os.path.lexists(scratch.root):
                    scratch.sample()
                    fresh = scratch.root.lstat()
                    if scratch.root.is_symlink() or (fresh.st_dev, fresh.st_ino) != (scratch.record.get('device'), scratch.record.get('inode')):
                        raise RuntimeError('Scratch identity changed before deletion')
                    shutil.rmtree(scratch.root)
                if os.path.lexists(scratch.root):
                    raise RuntimeError('Scratch removal incomplete')
            proof['scratchAbsent'] = True
            scratch.record.update(state='removed', removed=time.time(), processAbsence=proof)
            self.tree.save()
            result.update(proof)
            # Main retains the strict row through outputs, verification and monitor join.
            result['passed'] = True
            if self.scratch.record.get('cancellationDuringCleanup'):
                result.update(passed=False, cancelledDuringCleanup=True)
        except BaseException as error:
            result['error'] = type(error).__name__ + ': ' + str(error)[:1024]
            if self.monitor.quiesced:
                self.monitor.failed(error)
        finally:
            if self.monitor.quiesced and not self.monitor.issue and not self.monitor.registry.issue:
                self.monitor.resume()
        self.result = result
        self.scratch.record['finalizer'] = result
        self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
        return result
