"""Author-only finite ownership controller. No top-level probe or allocation.

The launcher admits this file before import, creates Controller before its first
OS/git probe, and owns every direct handle, including bootstrap/cleanup probes.
This is a cooperative budget, not a native sandbox. Unknown cleanup stays charged.
"""
import atexit
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import time

MIB = 1024 ** 2
DISK = 128 * MIB
RAM = 768 * MIB
LOGS = 2 * MIB
MAX_ROWS = 512
FINAL_DISK = 4 * MIB
FINAL_RAM = 64 * MIB
START = re.compile(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            value.update(block)
    return value.hexdigest()


def strict(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    def constant(value):
        raise ValueError('Nonstandard JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def write(path, value, cap=512 * 1024):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    if len(data) > cap:
        raise RuntimeError('Finite metadata bound exceeded')
    temporary = path.with_name(path.name + '.writing')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def allocated(root):
    if not os.path.lexists(root):
        return 0
    initial = root.lstat()
    if not stat.S_ISDIR(initial.st_mode) or root.resolve() != root:
        raise RuntimeError('Owned allocation is not an ordinary directory')
    total = max(initial.st_size, initial.st_blocks * 512)
    def failed(error):
        raise error
    for folder, dirs, files in os.walk(root, followlinks=False, onerror=failed):
        for name in dirs + files:
            item = Path(folder) / name
            value = item.lstat()
            if not (stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode)):
                raise RuntimeError('Nonordinary owned allocation')
            total += max(value.st_size, value.st_blocks * 512)
    return total


class Controller:
    def __init__(self, records, scratch, token, tools, host, grant):
        self.records, self.scratch = Path(records), Path(scratch)
        self.token, self.tools, self.host, self.grant = token, tools, host, grant
        self.handles, self.binding, self.done, self.cancelled = [], None, False, False
        self.finalizing = False
        self.work_deadlines = []
        self.in_snapshot = False
        self.started = time.monotonic()
        self.record = {'version': 1, 'token': token, 'grant': grant,
            'owner': {'pid': os.getpid(), 'start': None}, 'state': 'provisional',
            'scratch': str(self.scratch), 'scratchIdentity': None, 'launches': [],
            'identities': [], 'groups': [], 'signals': [], 'errors': [],
            'peakAggregateRss': 0, 'peakCombinedDisk': 0, 'cleanup': None}
        # Register before creating any run-owned directory and before first probe.
        atexit.register(self.finish)
        self.previous = {n: signal.getsignal(n) for n in (signal.SIGTERM, signal.SIGINT)}
        for number in self.previous:
            signal.signal(number, lambda n, f: setattr(self, 'cancelled', True))
        if self.records.parent.resolve() != self.records.parent:
            raise RuntimeError('External ownership parent is not ordinary')
        self.records.mkdir(mode=0o700)  # exclusive run identity; never adopt another run
        value = self.records.lstat()
        self.record['recordDirectoryIdentity'] = [value.st_dev, value.st_ino]
        self.manifest = self.records / 'ownership.json'
        self.save()

    def save(self):
        value = self.records.lstat()
        if self.records.resolve() != self.records or not stat.S_ISDIR(value.st_mode) or [value.st_dev, value.st_ino] != self.record['recordDirectoryIdentity']:
            raise RuntimeError('External ownership directory changed')
        write(self.manifest, self.record)

    def verify_tool(self, path):
        expected = self.tools[path]
        item = Path(path)
        value = item.stat()
        if (str(item.resolve()), value.st_dev, value.st_ino, file_digest(item), item.is_symlink()) != (
                expected['realpath'], expected['device'], expected['inode'], expected['sha256'], expected['symlink']):
            raise RuntimeError('Pinned executable identity changed')

    def remember(self, row):
        identity = {key: row[key] for key in ('pid', 'start', 'pgid')}
        if identity not in self.record['identities']:
            if len(self.record['identities']) >= MAX_ROWS:
                raise RuntimeError('Finite owned identity bound exceeded')
            self.record['identities'].append(identity)
        if row['pgid'] != os.getpgrp() and row['pgid'] not in self.record['groups']:
            self.record['groups'].append(row['pgid'])

    def command(self, argv, env, seconds=3, cap=2 * MIB, sample=False, log=None):
        self.verify_tool(argv[0])
        if len(self.handles) >= MAX_ROWS:
            raise RuntimeError('Finite direct-handle bound exceeded')
        if self.cancelled and not self.finalizing:
            raise RuntimeError('Handled cancellation before launch')
        start = time.monotonic()
        deadlines = [start + seconds, *self.work_deadlines,
            self.cleanup_deadline if self.finalizing else self.started + 420]
        deadline = min(deadlines)
        if deadline <= start:
            raise RuntimeError('Enclosing owned work deadline exceeded')
        row = {'kind': 'selected' if sample else 'probe', 'argv': argv, 'state': 'creating',
            'pid': None, 'start': None, 'returncode': None, 'joined': False,
            'stdoutBytes': 0, 'stderrBytes': 0}
        self.record['launches'].append(row)
        self.save()
        # Retain the Popen object before __init__; deferred signals cannot lose it.
        process = subprocess.Popen.__new__(subprocess.Popen)
        self.handles.append((process, row))
        buffers = {'stdout': bytearray(), 'stderr': bytearray()}
        self.work_deadlines.append(deadline)
        try:
            subprocess.Popen.__init__(process, argv, cwd=self.host['worktree'], env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            row.update(state='running', pid=process.pid)
            self.remember({'pid': process.pid, 'start': None, 'pgid': process.pid})
            self.save()
            with selectors.DefaultSelector() as selector:
                for name in buffers:
                    stream = getattr(process, name)
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, name)
                next_sample = time.monotonic()
                while selector.get_map() or process.poll() is None:
                    remaining_seconds = deadline - time.monotonic()
                    if remaining_seconds <= 0:
                        raise RuntimeError('Direct command deadline exceeded')
                    for key, _ in selector.select(min(.02, remaining_seconds)):
                        remaining = cap - sum(len(v) for v in buffers.values())
                        try:
                            data = os.read(key.fd, min(16384, remaining + 1))
                        except BlockingIOError:
                            continue
                        buffers[key.data].extend(data)
                        if sum(len(v) for v in buffers.values()) > cap:
                            raise RuntimeError('Combined direct output bound exceeded')
                        if not data:
                            selector.unregister(key.fileobj)
                    if time.monotonic() > deadline:
                        raise RuntimeError('Direct command deadline exceeded')
                    if self.cancelled and not self.finalizing:
                        raise RuntimeError('Handled cancellation')
                    if (sample or not self.in_snapshot) and time.monotonic() >= next_sample:
                        self.snapshot()
                        self.account()
                        if time.monotonic() > deadline:
                            raise RuntimeError('Enclosing selected chunk deadline exceeded')
                        next_sample = time.monotonic() + .1
        finally:
            # A still-unreaped direct handle cannot have its PID reused. Group
            # signals separately require a fresh saved PID/start anchor.
            errors = []
            try:
                if getattr(process, 'pid', None) is not None:
                    try:
                        if process.poll() is None:
                            process.terminate()
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        try:
                            if process.poll() is None:
                                process.kill()
                        finally:
                            process.wait(timeout=3)
                    row.update(state='joined', joined=True, returncode=process.returncode)
                else:
                    row['state'] = 'uncertain-creation'
                    raise RuntimeError('Child creation outcome uncertain; retain ownership')
            except BaseException as error:
                errors.append(type(error).__name__ + ': ' + str(error))
            finally:
                try:
                    for name in buffers:
                        stream = getattr(process, name, None)
                        if stream is not None:
                            try:
                                stream.close()
                            except BaseException as error:
                                errors.append(type(error).__name__ + ': ' + str(error))
                        row[name + 'Bytes'] = len(buffers[name])
                        row[name + 'Sha256'] = digest(buffers[name])
                    if log is not None:
                        # Preserve bounded originals even on failure/cancellation.
                        log.write_bytes(bytes(buffers['stdout']) + bytes(buffers['stderr']))
                    row['wall'] = time.monotonic() - start
                    self.record['errors'].extend(errors)
                    self.save()
                finally:
                    self.work_deadlines.pop()
            if errors:
                raise RuntimeError('Protected direct join failed')
        return process.returncode, bytes(buffers['stdout']), bytes(buffers['stderr'])

    def environment(self):
        return {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/Users/garycarter',
            'LC_ALL': 'C', 'TZ': 'Europe/London', 'TMPDIR': str(self.scratch),
            'TMP': str(self.scratch), 'TEMP': str(self.scratch)}

    def snapshot(self):
        if self.in_snapshot:
            raise RuntimeError('Recursive snapshot refused')
        self.in_snapshot = True
        try:
            rc, output, error = self.command(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart='],
                self.environment(), seconds=3, cap=2 * MIB)
        finally:
            self.in_snapshot = False
        if rc or error or not output:
            raise RuntimeError('Complete process snapshot unavailable')
        rows = {}
        for line in output.decode('ascii').splitlines():
            match = re.fullmatch(r'\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*', line)
            if not match or not START.fullmatch(match[5]):
                raise RuntimeError('Malformed process snapshot')
            pid, ppid, pgid, rss = map(int, match.group(1, 2, 3, 4))
            if pid <= 0 or pgid <= 0 or pid in rows:
                raise RuntimeError('Invalid process identity')
            start = ' '.join(match[5].split())
            datetime.datetime.strptime(start, '%a %b %d %H:%M:%S %Y')
            rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024, 'start': start}
        own = rows.get(os.getpid())
        if own is None or self.record['owner']['start'] not in (None, own['start']):
            raise RuntimeError('Launching owner identity unavailable or changed')
        self.record['owner']['start'] = own['start']
        selected = {os.getpid()}
        uncertain = set()
        for saved in self.record['identities']:
            current = rows.get(saved['pid'])
            if current and saved['start'] == current['start']:
                selected.add(saved['pid'])
            elif current and saved['start'] is None:
                uncertain.add(saved['pid'])
        while True:
            expanded = selected | {pid for pid, item in rows.items() if item['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        for pid in selected - {os.getpid()}:
            self.remember(rows[pid])
        for _process, launch in self.handles:
            current = rows.get(launch['pid'])
            if current and current['ppid'] == os.getpid() and launch['start'] is None:
                launch['start'] = current['start']
        rss = sum(rows[pid]['rss'] for pid in selected | uncertain)
        self.record['peakAggregateRss'] = max(self.record['peakAggregateRss'], rss)
        self.record['lastSnapshot'] = {'members': len(selected | uncertain), 'rss': rss,
            'ownRss': own['rss'], 'uncertainPidsCharged': sorted(uncertain)}
        self.save()
        if rss + FINAL_RAM > (self.binding['ram'] if self.binding is not None else RAM):
            raise RuntimeError('Conservative recursive aggregate RAM bound exceeded')
        return rows

    @contextlib.contextmanager
    def ledger(self):
        directory = Path(self.host['directory'])
        ds = directory.lstat()
        if directory.resolve() != directory or (ds.st_dev, ds.st_ino) != tuple(self.host['directoryIdentity']):
            raise RuntimeError('Frozen host directory identity changed')
        lock = directory / 'reservations.lock'
        fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            ls = os.fstat(fd)
            if not stat.S_ISREG(ls.st_mode) or (ls.st_dev, ls.st_ino) != tuple(self.host['lockIdentity']):
                raise RuntimeError('Frozen host lock identity changed')
            deadline = min([time.monotonic() + 2, *self.work_deadlines])
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Host ledger lock busy')
                    time.sleep(.02)
            path = directory / 'reservations.json'
            readfd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(readfd, 'rb') as stream:
                value = os.fstat(stream.fileno())
                if not stat.S_ISREG(value.st_mode) or value.st_size > MIB:
                    raise RuntimeError('Host ledger is not a finite regular file')
                raw = stream.read(MIB + 1)
            if len(raw) > MIB:
                raise RuntimeError('Host ledger grew beyond finite bound')
            entries = self.validate_ledger(strict(raw))
            yield path, entries
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def validate_ledger(self, entries):
        if type(entries) is not dict:
            raise RuntimeError('Host ledger object required')
        for token, row in entries.items():
            if not isinstance(token, str) or not token or type(row) is not dict or set(row) != {
                    'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}:
                raise RuntimeError('Host ledger exact row schema required')
            owner = row['owner']
            if type(owner) is not dict or set(owner) != {'pid', 'start'} or type(owner['pid']) is not int \
                    or owner['pid'] <= 0 or not isinstance(owner['start'], str) or not START.fullmatch(owner['start']):
                raise RuntimeError('Host ledger exact owner schema required')
            datetime.datetime.strptime(' '.join(owner['start'].split()), '%a %b %d %H:%M:%S %Y')
            if any(type(row[k]) is not int or row[k] < 0 for k in ('disk', 'ram', 'used', 'rss')):
                raise RuntimeError('Host ledger nonnegative integer accounting required')
            if row['root'] is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()):
                raise RuntimeError('Host ledger absolute root required')
            if row['parent'] is not None and (not isinstance(row['parent'], str) or not row['parent']):
                raise RuntimeError('Host ledger parent invalid')
        for token in entries:
            seen = set()
            while token is not None:
                if token in seen or token not in entries:
                    raise RuntimeError('Host ledger cyclic or dangling ancestry')
                seen.add(token)
                token = entries[token]['parent']
        return entries

    def store_row(self, path, before, after):
        transactions = self.record.setdefault('ledgerTransactions', [])
        if len(transactions) >= MAX_ROWS:
            raise RuntimeError('Finite ledger transaction journal bound exceeded')
        if {k: v for k, v in before.items() if k != self.token} != {k: v for k, v in after.items() if k != self.token}:
            raise RuntimeError('Foreign ledger mutation refused')
        self.validate_ledger(after)
        write(path, after, cap=MIB)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            value = os.fstat(stream.fileno())
            if not stat.S_ISREG(value.st_mode) or value.st_size > MIB:
                raise RuntimeError('Host readback identity/schema uncertain')
            actual = stream.read(MIB + 1)
        if len(actual) > MIB or self.validate_ledger(strict(actual)) != after:
            raise RuntimeError('Host ledger complete write/readback differs')
        foreign = {k: v for k, v in before.items() if k != self.token}
        transactions.append({'beforeSha256': digest(json.dumps(before, sort_keys=True).encode()),
            'afterSha256': digest(json.dumps(after, sort_keys=True).encode()),
            'foreignSha256': digest(json.dumps(foreign, sort_keys=True).encode()),
            'foreignRows': len(foreign), 'foreignRowsPreserved': True,
            'ownedPresentAfter': self.token in after})
        self.save()

    def reserve(self):
        if os.path.lexists(self.scratch):
            raise RuntimeError('Proposed owned scratch already exists; no adoption')
        self.snapshot()
        rc, output, error = self.command(['/usr/bin/vm_stat'], self.environment(), cap=65536)
        lines = output.decode('ascii').splitlines()
        header = re.fullmatch(r'Mach Virtual Memory Statistics: \(page size of (\d+) bytes\)', lines[0] if lines else '')
        wanted = {'Pages free', 'Pages inactive', 'Pages purgeable'}
        counts = {}
        for line in lines[1:]:
            name = line.split(':', 1)[0]
            if name in wanted:
                match = re.fullmatch(r'[^:]+:\s+(\d+)\.', line)
                if not match or name in counts:
                    raise RuntimeError('Host memory page accounting malformed')
                counts[name] = int(match[1])
        if rc or error or not header or int(header[1]) <= 0 or set(counts) != wanted:
            raise RuntimeError('Host memory unavailable')
        memory = int(header[1]) * sum(counts.values())
        free = shutil.disk_usage(self.host['worktree']).free
        with self.ledger() as (path, entries):
            if self.token in entries or self.binding is not None:
                raise RuntimeError('Reservation reuse refused')
            # Charge every row, including parents/descendants/our ancestors and
            # stale owners. Never prune, repair, discount telemetry or inherit.
            disk_pending = sum(max(row['disk'], row['used']) for row in entries.values())
            ram_pending = sum(max(row['ram'], row['rss']) for row in entries.values())
            disk_available = free - disk_pending - 5 * 1024 ** 3
            ram_available = memory - ram_pending - 512 * MIB
            self.record['capacity'] = {'freeDisk': free, 'availableMemory': memory,
                'allReservationDiskCharge': disk_pending, 'allReservationRamCharge': ram_pending,
                'diskHeadroom': disk_available, 'ramHeadroom': ram_available,
                'minimumDisk': 16 * MIB, 'minimumRam': 512 * MIB,
                'reservationRows': len(entries)}
            self.save()
            if disk_available < 16 * MIB or ram_available < 512 * MIB:
                raise RuntimeError('Indivisible declared chunk cannot fit all-reservation host budget')
            self.binding = {'owner': dict(self.record['owner']), 'root': str(self.scratch),
                'parent': None, 'disk': min(DISK, disk_available), 'ram': min(RAM, ram_available), 'used': 0, 'rss': 0}
            after = dict(entries)
            after[self.token] = dict(self.binding)
            self.record['state'] = 'reservation-writing'
            self.save()
            self.store_row(path, entries, after)
            self.record['state'] = 'reserved'
            self.save()
        self.scratch.mkdir(mode=0o700)
        value = self.scratch.lstat()
        self.record['scratchIdentity'] = [value.st_dev, value.st_ino]
        self.save()

    def account(self, final=False):
        self.logs_bounded()
        used = allocated(self.records) + (allocated(self.scratch) if self.record['scratchIdentity'] is not None else 0)
        self.record['peakCombinedDisk'] = max(self.record['peakCombinedDisk'], used)
        charged_disk = used + FINAL_DISK
        charged_rss = self.record['peakAggregateRss'] + FINAL_RAM
        disk_limit = self.binding['disk'] if self.binding is not None else DISK
        ram_limit = self.binding['ram'] if self.binding is not None else RAM
        if charged_disk > disk_limit or charged_rss > ram_limit or shutil.disk_usage(self.host['worktree']).free < 5 * 1024 ** 3:
            raise RuntimeError('Final/working conservative resource charge exceeds allocation')
        if self.binding is not None:
            with self.ledger() as (path, entries):
                if entries.get(self.token) != self.binding:
                    raise RuntimeError('Exact process-local reservation binding changed')
                after = dict(entries)
                row = dict(self.binding, used=charged_disk, rss=charged_rss)
                after[self.token] = row
                self.store_row(path, entries, after)
                self.binding = row
        if final:
            self.record['finalAccounting'] = {'actualBeforeFinalBytes': used,
                'diskChargeUpperBoundBytes': charged_disk, 'rssChargeUpperBoundBytes': charged_rss,
                'remainingDiskWriteAllowanceBytes': FINAL_DISK,
                'remainingRamAllowanceBytes': FINAL_RAM,
                'manifestCapBytes': 512 * 1024, 'receiptCapBytes': 512 * 1024,
                'remainingWrites': 'One bounded receipt (one bounded failure correction if necessary) and at most four bounded manifest replacements; atomic temporary peaks included; exact-row ledger transaction <=1MiB; no new process/probe after final accounting.'}
            self.save()
        return charged_disk, charged_rss

    def logs_bounded(self):
        paths = list(self.records.glob('*.tap')) + list(self.records.glob('*.jsonl'))
        if sum(p.stat().st_size for p in paths) > LOGS:
            raise RuntimeError('Combined original TAP/journal bound exceeded')

    def numeric_absence(self):
        for process, launch in self.handles:
            if not launch['joined'] or getattr(process, 'returncode', None) is None:
                raise RuntimeError('Direct handle is not joined')
        for saved in self.record['identities']:
            try:
                os.kill(saved['pid'], 0)
            except ProcessLookupError:
                continue
            raise RuntimeError('Owned PID absence uncertain; retain resources')
        for group in self.record['groups']:
            try:
                os.killpg(group, 0)
            except ProcessLookupError:
                continue
            raise RuntimeError('Owned group absence uncertain; retain resources')

    def stop_descendants(self):
        rows = self.snapshot()
        for number in (signal.SIGTERM, signal.SIGKILL):
            for group in reversed(self.record['groups']):
                members = [row for row in rows.values() if row['pgid'] == group]
                if not members:
                    continue
                try:
                    os.killpg(group, 0)
                except ProcessLookupError:
                    continue
                rows = self.snapshot()  # a new complete snapshot for each signal
                members = [row for row in rows.values() if row['pgid'] == group]
                if not members:
                    continue
                anchor = next((saved for saved in self.record['identities'] if saved['pgid'] == group
                    and saved['start'] and rows.get(saved['pid'], {}).get('start') == saved['start']), None)
                if anchor is None or group == os.getpgrp():
                    raise RuntimeError('No fresh owned PID/start group anchor')
                try:
                    if os.getpgid(anchor['pid']) != group:
                        raise RuntimeError('Fresh signal anchor changed process group')
                    os.killpg(group, number)
                except ProcessLookupError:
                    pass
                self.record['signals'].append({'group': group, 'signal': int(number), 'anchor': anchor})
            if number == signal.SIGTERM:
                time.sleep(.1)
                rows = self.snapshot()

    def finish(self):
        if self.done:
            return self.record.get('cleanup')
        self.done = self.finalizing = True
        self.cleanup_deadline = time.monotonic() + 60
        errors = []
        try:
            # Stop/query failures may never bypass direct-handle joins.
            try:
                self.stop_descendants()
            except BaseException as error:
                errors.append(type(error).__name__ + ': ' + str(error))
            finally:
                for process, launch in self.handles:
                    if launch['joined']:
                        continue
                    try:
                        if getattr(process, 'pid', None) is None:
                            raise RuntimeError('Unknown launch creation outcome')
                        if process.poll() is None:
                            process.kill()
                        process.wait(timeout=3)
                        launch.update(state='joined', joined=True, returncode=process.returncode)
                    except BaseException as error:
                        errors.append(type(error).__name__ + ': ' + str(error))
            if errors or self.record['errors']:
                raise RuntimeError('Protected handle/descendant cleanup uncertain')
            self.numeric_absence()
            if self.record['scratchIdentity'] is not None:
                value = self.scratch.lstat()
                if self.scratch.resolve() != self.scratch or not stat.S_ISDIR(value.st_mode) or [value.st_dev, value.st_ino] != self.record['scratchIdentity']:
                    raise RuntimeError('Owned scratch inode changed')
                rc, output, error = self.command(['/usr/sbin/lsof', '-t', '+D', str(self.scratch)],
                    self.environment(), seconds=5, cap=8192)
                if rc != 1 or output or error:
                    raise RuntimeError('Owned scratch open-file absence unproved')
                self.record['openFilesAbsent'] = True
            # Final probe is itself provisionally owned and joined. No OS child
            # is created after this snapshot; only file/syscall evidence follows.
            self.snapshot()
            self.numeric_absence()
            self.logs_bounded()
            self.account(final=True)
            if self.record['scratchIdentity'] is not None:
                value = self.scratch.lstat()
                if self.scratch.resolve() != self.scratch or [value.st_dev, value.st_ino] != self.record['scratchIdentity']:
                    raise RuntimeError('Owned scratch changed before deletion')
                shutil.rmtree(self.scratch)
            if os.path.lexists(self.scratch):
                raise RuntimeError('Owned scratch still exists')
            self.record['state'] = 'cleanup-proved-release-pending'
            self.save()
            if self.binding is not None:
                with self.ledger() as (path, entries):
                    if entries.get(self.token) != self.binding or any(row['parent'] == self.token for row in entries.values()):
                        raise RuntimeError('Exact reservation binding or child references changed')
                    after = dict(entries)
                    del after[self.token]
                    self.store_row(path, entries, after)
                self.binding = None
            self.record['cleanup'] = {'scratchAbsent': True, 'allDirectHandlesJoined': True,
                'ownedPidsAndGroupsAbsent': True, 'reservationAbsent': True,
                'finalAccountingBeforeRelease': True, 'foreignLedgerRowsPreserved': True}
            self.record['state'] = 'released'
        except BaseException as error:
            errors.append(type(error).__name__ + ': ' + str(error))
            self.record['state'] = 'cleanup-uncertain-resources-retained'
            self.record['cleanup'] = {'passed': False, 'errors': errors,
                'scratchPreserved': os.path.lexists(self.scratch), 'reservationPreserved': self.binding is not None}
        finally:
            self.record['errors'].extend(errors)
            try:
                if hasattr(self, 'manifest'):
                    self.save()
            finally:
                for number, handler in self.previous.items():
                    signal.signal(number, handler)
        return self.record['cleanup']
