"""Owned finite I/O and sampled aggregate accounting; no import-time I/O or allocation."""
from pathlib import Path
import atexit
from datetime import datetime
import re
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
    'audit_bytes': 16*1024, 'stdout_bytes': 4096, 'log_bytes': 1536*1024,
    'journal_bytes': 512*1024, 'checkpoint_bytes': 64*1024,
    'json_depth': 24, 'json_nodes': 32768, 'json_collection': 4096,
    'json_string_chars': 65536, 'json_total_chars': 524288,
    'entries': 4096, 'process_identities': 512, 'probe_bytes': MIB,
    'probe_timeout_seconds': 2, 'sample_interval_seconds': 0.2,
    'helper_timeout_seconds': 5, 'helper_capture_bytes': MIB,
    'supervisor_seconds': 120, 'completion_reserve_seconds': 30,
    'bootstrap_bytes': MIB, 'source_plan_bytes': 4*MIB, 'input_bytes': 4*MIB,
    # Charged inside the 768MiB grant even while the respective operation is idle.
    'probe_ram_allowance': 32*MIB, 'encoding_ram_allowance': 64*MIB,
    'ledger_ram_allowance': 32*MIB,
    # Charged inside 128MiB in every pre/post-write observation, including cleanup.
    'ledger_disk_allowance': 4*MIB, 'atomic_disk_allowance': MIB+8192,
    'stream_disk_allowance': 2*MIB, 'terminal_disk_allowance': 64*1024, 'audit_disk_allowance': 64*1024,
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
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size < 0 or before.st_size > cap or before.st_nlink != 1:
            raise BoundError('Input is not a bounded regular file')
        data = source.read(cap+1)
        after = os.fstat(source.fileno())
        if len(data) > cap or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != \
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
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
            try:
                with os.scandir(path) as children:
                    for child in children:
                        visit(Path(child.path))
            except FileNotFoundError:
                pass  # Concurrent owned cleanup: already counted entries remain conservative.
    for path in paths:
        visit(Path(path))
    return total


PS = ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart=']


def normalized_start(value):
    match = re.fullmatch(r'(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([0-9]{1,2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}) ([0-9]{4})', value)
    if not match:
        raise BoundError('Unknown process start syntax')
    try:
        date = datetime.strptime(value, '%a %b %d %H:%M:%S %Y')
    except ValueError:
        raise BoundError('Invalid process start date')
    if date.year < 1970 or date.strftime('%a') != match[1]:
        raise BoundError('Process start weekday/year differs')
    return date.strftime('%a %b ') + str(date.day) + date.strftime(' %H:%M:%S %Y')


def process_rows(output, error, rc):
    if rc != 0 or error or not isinstance(output, str) or not output or not output.endswith('\n'):
        raise BoundError('Incomplete or failed process query')
    rows = {}
    for line in output.splitlines():
        fields = line.split(None, 5)
        if len(fields) != 6 or any(not item.isascii() or not item.isdigit() or len(item) > 19 for item in fields[:4]):
            raise BoundError('Unknown process row')
        pid, ppid, pgid, rss = map(int, fields[:4])
        state = fields[4]
        if pid <= 0 or pgid <= 0 or max(pid, ppid, pgid) >= 2**63 or rss > (2**63-1)//1024 or pid in rows or not state or state[0] not in 'RSDTtWXZIU' \
                or any(char not in '+<>AELNSsVWXl' for char in state[1:]):
            raise BoundError('Duplicate or invalid process identity/state')
        rows[pid] = dict(pid=pid, ppid=ppid, pgid=pgid, rss=rss*1024,
                         state=state, start=normalized_start(fields[5].strip()))
        if len(rows) > CONTRACT['entries']:
            raise BoundError('Process query row cap')
    if os.getpid() not in rows:
        raise BoundError('Supervisor absent from complete process query')
    return rows


class Processes:
    """External intent before the first probe; every direct handle retained until durable join."""
    def __init__(self, outputs, path, deadline, cancel, admission, grant):
        self.outputs, self.path, self.deadline, self.cancel = outputs, Path(path), deadline, cancel
        self.lock = threading.RLock()
        self.handles = {}
        self.issue = None
        self.blocked = self.sealed = False
        self.sequence = 0
        self.record = {'state': 'provisional-before-first-probe', 'owner': {'pid': os.getpid(), 'start': None},
            'admissionSHA256': admission, 'grant': grant, 'scratchConstructor': 'not-started',
            'probeIntent': {'command': PS, 'captureBytes': CONTRACT['probe_bytes'],
                            'seconds': CONTRACT['probe_timeout_seconds'], 'newSession': True},
            'helpers': [], 'observed': [], 'issue': None}

    def save(self):
        self.outputs.record(self.path, self.record)

    def fail(self, error):
        with self.lock:
            self.issue = self.issue or type(error).__name__
            self.record.update(state='uncertain', issue=self.issue)
            self.cancel.set()
            if not self.sealed:
                self.save()  # Sealed terminal hashes stay immutable; refused later work exits failed.

    def initialize(self):
        if os.path.lexists(self.path.parent.parent):
            raise BoundError('Provisional run identity already exists')
        self.outputs.record(self.path, self.record, exclusive=True)
        # This durable intent precedes Aggregate.start and every shared helper/Scratch import.

    def launch(self, command, proof=False, intent=None):
        with self.lock:
            if self.issue or self.cancel.is_set() or self.sealed or (self.blocked and not proof) or time.monotonic() >= self.deadline:
                raise BoundError('New helper/probe refused by sticky ownership state')
            if proof and (not self.blocked or self.handles):
                raise BoundError('Proof query requires a quiescent process registry')
            if len(self.record['helpers']) >= CONTRACT['process_identities']:
                raise BoundError('Finite helper/probe identity cap')
            structure(command)
            self.sequence += 1
            row = {'id': self.sequence, 'command': list(command), 'pid': None, 'start': None,
                   'group': None, 'state': 'planned', 'directHandleRetained': False, 'joined': False}
            self.record['helpers'].append(row)
            if intent is not None:
                intent(row['id'])
            self.save()  # A launch intent exists even if Popen/retention/persistence fails next.
            proc = None
            try:
                if self.cancel.is_set() or time.monotonic() >= self.deadline:
                    raise BoundError('Launch intent exceeded the whole-chunk deadline or was cancelled')
                proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                self.handles[row['id']] = proc
                row.update(pid=proc.pid, group=proc.pid, state='retained', directHandleRetained=True)
                self.save()
                return proc, row
            except BaseException as error:
                # Keep the direct handle before any diagnostic persistence can fail.
                if proc is not None:
                    self.handles[row['id']] = proc
                try:
                    self.fail(error)
                finally:
                    if proc is not None:
                        self.join(proc, row)
                raise

    def join(self, proc, row):
        # Never infer a signal target from a persisted PID: only the retained Popen handle.
        try:
            if proc.poll() is None:
                proc.kill()
            rc = proc.wait(timeout=2)
            for pipe in (proc.stdout, proc.stderr):
                pipe.close()
            with self.lock:
                row.update(joined=True, returncode=rc, state='joined')
                self.save()
                self.handles.pop(row['id'], None)  # Only after join, directory fsync and exact manifest readback.
        except BaseException as error:
            self.fail(error)
            raise

    def observe(self, rows):
        with self.lock:
            owner = rows[os.getpid()]
            expected = self.record['owner']['start']
            if expected is not None and expected != owner['start']:
                raise BoundError('Supervisor start identity changed')
            self.record['owner']['start'] = owner['start']
            for helper in self.record['helpers']:
                row = rows.get(helper['pid'])
                if row and not helper['joined']:
                    if row['ppid'] != os.getpid() or row['pgid'] != helper['group']:
                        raise BoundError('Direct helper parent/group differs')
                    if helper['start'] is not None and helper['start'] != row['start']:
                        raise BoundError('Direct helper start differs')
                    helper['start'] = row['start']
            observed = {(row['pid'], row['start']): row for row in self.record['observed']}
            groups = {row['group'] for row in self.record['helpers'] if row['group'] is not None}
            selected = {os.getpid()} | {row['pid'] for row in rows.values()
                                       if row['pgid'] in groups or (row['pid'], row['start']) in observed}
            while True:
                more = {row['pid'] for row in rows.values() if row['ppid'] in selected} - selected
                if not more:
                    break
                selected.update(more)
            for pid in selected - {os.getpid()}:
                row = rows.get(pid)
                if row is not None:
                    observed[(pid, row['start'])] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
            identities = set(observed)
            identities.update((row['pid'], row['start']) for row in self.record['helpers'] if row['pid'] is not None)
            # A not-yet-observed direct PID counts once, not once more when its start arrives.
            identities = {(pid, start) for pid, start in identities
                          if start is not None or not any(other == pid and value is not None for other, value in identities)}
            if len(identities) > CONTRACT['process_identities']:
                raise BoundError('Owned helper/descendant identity cap')
            self.record['observed'] = list(observed.values())
            self.save()
            return selected

    def remember_partial(self, output):
        # Strict rejection must not discard relevant PID observations with unknown fields.
        with self.lock:
            observations = []
            truncated = False
            for index, line in enumerate(output.splitlines()):
                if index >= CONTRACT['entries']:
                    truncated = True
                    break
                fields = line.split(None, 5)
                row = {key: int(fields[pos]) if len(fields) > pos and fields[pos].isascii() and fields[pos].isdigit() and len(fields[pos]) <= 19 and int(fields[pos]) < 2**63 else None
                       for pos, key in enumerate(('pid', 'ppid', 'pgid'))}
                row['start'] = None
                if len(fields) == 6:
                    try:
                        row['start'] = normalized_start(fields[5].strip())
                    except BoundError:
                        pass
                if row['pid'] is not None and row['pid'] > 0:
                    observations.append(row)
            selected = {os.getpid()} | {row['pid'] for row in self.record['helpers'] if row['pid'] is not None}
            selected |= {row['pid'] for row in self.record['observed']}
            if self.record.get('nodePid') is not None:
                selected.add(self.record['nodePid'])
            groups = {row['group'] for row in self.record['helpers'] if row['group'] is not None}
            while True:
                more = {row['pid'] for row in observations if row['ppid'] in selected or row['pgid'] in groups} - selected
                if not more:
                    break
                selected.update(more)
            relevant = [row for row in observations if row['pid'] in selected and row['pid'] != os.getpid()]
            if len(relevant) > CONTRACT['process_identities']:
                relevant = relevant[:CONTRACT['process_identities']]
                truncated = True
            self.record.update(uncertainObservations=relevant, uncertainObservationsTruncated=truncated)
            self.save()  # Unknown/truncated state can never authorize deletion/release.

    def capture(self, command, cap, seconds, proof=False, intent=None):
        deadline = min(self.deadline, time.monotonic()+seconds)
        try:
            if not isinstance(command, (list, tuple)) or not 1 <= len(command) <= 32:
                raise BoundError('Finite helper command vector required')
            command = [os.fspath(part) for part in command]
            if any(not isinstance(part, str) or len(part) > 4096 for part in command):
                raise BoundError('Helper command argument bound')
            proc, row = self.launch(command, proof, intent)
        except BaseException as error:
            self.fail(error)
            raise
        chunks = {'stdout': [], 'stderr': []}
        size = 0
        rows = None
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(proc.stdout, selectors.EVENT_READ, 'stdout')
                ready.register(proc.stderr, selectors.EVENT_READ, 'stderr')
                while ready.get_map():
                    if time.monotonic() >= deadline:
                        raise BoundError('Helper/probe capture timeout')
                    for key, mask in ready.select(0.05):
                        block = os.read(key.fd, 65536)
                        if not block:
                            ready.unregister(key.fd)
                        else:
                            size += len(block)
                            if size > cap:
                                raise BoundError('Helper/probe combined capture byte cap')
                            chunks[key.data].append(block)
            rc = proc.wait(timeout=1)
            out, err = (b''.join(chunks[key]).decode('utf-8', errors='strict') for key in ('stdout', 'stderr'))
            if command == PS:
                try:
                    rows = process_rows(out, err, rc)
                    if proc.pid not in rows:
                        raise BoundError('Query producer absent from complete telemetry')
                    self.observe(rows)
                except BaseException:
                    self.remember_partial(out)
                    raise
            elif command and command[0] == '/bin/ps':
                raise BoundError('Undeclared process query shape')
            return subprocess.CompletedProcess(command, rc, out, err), row['id'], rows
        except BaseException as error:
            self.fail(error)
            raise
        finally:
            self.join(proc, row)

    def quiesce(self):
        with self.lock:
            self.blocked = True
            if self.issue or self.handles:
                raise BoundError('Unresolved helper/probe prevents quiescence')

    def resume(self):
        with self.lock:
            if self.issue or self.sealed or self.handles:
                raise BoundError('Uncertain or sealed registry cannot resume')
            self.blocked = False

    def absence(self, rows, producer):
        with self.lock:
            if not self.blocked or self.issue or self.handles or not all(row['joined'] for row in self.record['helpers']):
                raise BoundError('Every helper/probe must be durably joined')
            query = next(row for row in self.record['helpers'] if row['id'] == producer)
            for helper in self.record['helpers']:
                for row in rows.values():
                    if row['pid'] == query['pid'] and helper['id'] == producer:
                        continue  # Exact ps producer was directly joined after producing these rows.
                    if row['pgid'] == helper['group'] or (row['pid'] == helper['pid']
                            and (helper['start'] is None or row['start'] == helper['start'])):
                        raise BoundError('Helper/probe process or group still present')
            for known in self.record['observed']:
                current = rows.get(known['pid'])
                if current and current['pid'] != query['pid'] and current['start'] == known['start']:
                    raise BoundError('Observed descendant remains present')
            if any(row['ppid'] == os.getpid() and row['pid'] != query['pid'] for row in rows.values()):
                raise BoundError('Supervisor has an undeclared or unjoined child')
            proof = {'helpers_joined': True, 'helpers_absent': True, 'groups_absent': True,
                     'owner_start': rows[os.getpid()]['start'], 'producer': producer, 'sequence': self.sequence}
            self.record['lastAbsence'] = proof
            self.save()
            return proof

    def seal(self, proof):
        with self.lock:
            if self.issue or self.handles or not self.blocked or proof != self.record.get('lastAbsence') \
                    or proof['sequence'] != self.sequence:
                raise BoundError('Final helper/probe absence proof differs')
            self.record['state'] = 'sealed-all-helpers-joined-and-absent'
            try:
                self.save()
            except BaseException as error:
                self.fail(error)
                raise
            self.sealed = True

    def require_sealed(self):
        if not self.sealed or self.issue or self.handles or not self.blocked \
                or self.record.get('lastAbsence', {}).get('sequence') != self.sequence:
            raise BoundError('Final helper/probe barrier is not sealed')

    def stop(self):
        with self.lock:
            self.blocked = True
            pending = [(proc, next(row for row in self.record['helpers'] if row['id'] == identity))
                       for identity, proc in self.handles.items()]
        first = None
        for proc, row in pending:
            try:
                self.join(proc, row)
            except BaseException as error:
                first = first or error
        if first is not None:
            raise first


class Aggregate:
    """Whole-chunk telemetry plus fixed transients; registry owns every query handle."""
    def __init__(self, cancel, seconds):
        self.cancel, self.seconds = cancel, seconds
        self.started = time.monotonic()
        self.limit = CONTRACT['ram_bytes']
        self.groups = []
        self.peak = self.rss = self.samples = 0
        self.last_sample = self.last_query = 0.0
        self.issue = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.probe_lock = threading.RLock()
        self.probe = None  # Registry event ID, retained if join/persistence is unresolved.
        self.thread = None
        self.observer = None
        self.registry = None
        self.quiesced = False
        atexit.register(self.stop)

    def failed(self, error):
        self.issue = self.issue or type(error).__name__
        self.cancel.set()
        self.registry.fail(error)

    def observe(self, rows=None, selected=None):
        scale = 1 if sys.platform == 'darwin' else 1024
        high = (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                + resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)*scale
        allowances = sum(CONTRACT[key] for key in ('probe_ram_allowance', 'encoding_ram_allowance', 'ledger_ram_allowance'))
        # State never suppresses reported RSS, including a reported zombie value.
        reported = sum(rows[pid]['rss'] for pid in selected) if rows is not None else max(0, self.rss-allowances)
        rss = max(reported, int(high)) + allowances
        with self.lock:
            self.rss = rss; self.peak = max(self.peak, rss); self.samples += 1
            self.last_sample = time.monotonic()
        if rss > self.limit or time.monotonic()-self.started > self.seconds:
            raise BoundError('Whole-chunk aggregate RAM/deadline exceeded')
        if self.observer is not None:
            self.observer()
        return rss

    def snapshot(self, proof=False):
        with self.probe_lock:
            if self.issue or self.registry.issue or self.probe is not None:
                raise BoundError('Sticky telemetry/probe ownership failure; no new query')
            if self.quiesced and not proof:
                return self.observe()
            try:
                # Planned/retained/joined query state is persisted by the registry.
                result, identity, rows = self.registry.capture(PS, CONTRACT['probe_bytes'], CONTRACT['probe_timeout_seconds'], proof,
                    intent=lambda identity: setattr(self, 'probe', identity))
                if identity in self.registry.handles:
                    raise BoundError('Captured probe/helper remains unresolved')
                self.probe = None
                self.last_query = time.monotonic()
                selected = self.registry.observe(rows)
                selected |= {row['pid'] for row in rows.values() if row['pgid'] in self.groups}
                self.observe(rows, selected)
                return rows, identity
            except BaseException as error:
                # The registry keeps the exact unresolved direct handle. Never overwrite it.
                self.failed(error)
                raise

    def loop(self):
        while not self.stop_event.is_set() and not self.issue and not self.registry.issue:
            try:
                self.snapshot()
            except BaseException as error:
                if not self.issue:
                    self.failed(error)
                break  # Failure is sticky; cleanup may only stop already-retained handles.
            self.stop_event.wait(CONTRACT['sample_interval_seconds'])

    def start(self):
        self.snapshot()
        self.thread = threading.Thread(target=self.loop, name='owned-aggregate', daemon=True)
        self.thread.start()
        return self

    def check(self):
        if self.cancel.is_set() or self.issue or self.registry.issue or not self.samples or self.rss > self.limit \
                or time.monotonic()-self.started > self.seconds \
                or time.monotonic()-self.last_sample > CONTRACT['probe_timeout_seconds']+1:
            raise BoundError('Owned aggregate observation failed or exceeded limit')
        if not self.thread or not self.thread.is_alive():
            raise BoundError('Aggregate monitor unexpectedly stopped')
        return self.rss

    def checkpoint(self):
        self.snapshot()
        return self.check()

    def quiesce(self):
        with self.probe_lock:
            self.quiesced = True
            self.registry.quiesce()

    def resume(self):
        with self.probe_lock:
            self.registry.resume()
            self.quiesced = False

    def absence(self):
        try:
            self.quiesce()
            rows, identity = self.snapshot(proof=True)
            return rows, self.registry.absence(rows, identity)
        except BaseException as error:
            self.failed(error)
            raise

    def stop(self):
        self.stop_event.set()
        problem = None
        if self.thread:
            self.thread.join(timeout=6)
            if self.thread.is_alive():
                problem = BoundError('Aggregate monitor join unknown')
            else:
                self.thread = None
        try:
            if self.registry is not None:
                self.registry.stop()  # Attempt every retained direct handle, even if thread join failed.
        finally:
            self.quiesced = True
        if problem is not None:
            self.failed(problem)
            raise problem

    def final_checkpoint(self):
        if self.thread:
            raise BoundError('Final accounting requires joined monitor')
        rows, proof = self.absence()
        self.registry.seal(proof)
        return rows, proof

    def final_observe(self):
        self.registry.require_sealed()
        if self.issue or self.registry.issue or self.cancel.is_set():
            raise BoundError('Final aggregate state failed or cancelled')
        return self.observe()  # Sealed, no children; self/child high water and fixed transients.

    def receipt(self):
        return {'peak_charged_rss_bytes': self.peak, 'samples': self.samples,
                'issue': self.issue or self.registry.issue, 'limit_bytes': self.limit,
                'process_manifest': str(self.registry.path),
                'basis': 'strict complete process rows; all reported RSS; recursive descendants+owned groups; self/reaped-child high water; fixed transients'}


class Outputs:
    def __init__(self, scratch, retained, monitor):
        self.scratch = Path(scratch) if scratch else None
        self.retained = [Path(path) for path in retained]
        self.monitor = monitor
        self.peak = 0
        self.sequence = 0
        self.temporaries = set()
        self.diagnostics = False
        self.lock = threading.RLock()

    def observe(self):
        with self.lock:
            return self._observe()

    def _observe(self):
        roots = self.retained + ([self.scratch] if self.scratch else [])
        external_temps = [path for path in self.temporaries
                          if not any(path == root or path.is_relative_to(root) for root in roots)]
        retained = allocation(self.retained + external_temps)
        scratch = allocation([self.scratch]) if self.scratch else 0
        allowances = sum(CONTRACT[key] for key in ('ledger_disk_allowance', 'atomic_disk_allowance',
                                                   'stream_disk_allowance', 'terminal_disk_allowance', 'audit_disk_allowance'))
        charged = retained + scratch + allowances
        self.peak = max(self.peak, charged)
        if retained + CONTRACT['stream_disk_allowance'] > CONTRACT['retained_bytes'] or charged > CONTRACT['combined_bytes']:
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
        with self.lock:
            return self._write(path, payload, cap, exclusive)

    def _write(self, path, payload, cap, exclusive=False):
        if not self.diagnostics:
            self.monitor.check()
        if type(payload) is not bytes or len(payload) > cap or cap > CONTRACT['json_bytes']:
            raise BoundError('Output byte cap')
        path = self.admissible(path)
        # RAM failures still allow finite cleanup diagnostics within the reserved allowances.
        before = self.observe()
        if before['charged_combined_bytes'] + len(payload) + 8192 > CONTRACT['combined_bytes']:
            raise BoundError('Output would exceed combined cap')
        if before['retained_allocated_bytes'] + CONTRACT['stream_disk_allowance'] + len(payload) + 8192 > CONTRACT['retained_bytes']:
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

    def record(self, path, value, exclusive=False):
        # Provisional/failure ownership precedes monitor availability; all output bounds apply.
        with self.lock:
            previous = self.diagnostics
            self.diagnostics = True
            try:
                payload = encode(value, CONTRACT['json_bytes'])
                self.write(path, payload, CONTRACT['json_bytes'], exclusive=exclusive)
                fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
                if read_bytes(path, CONTRACT['json_bytes']) != payload:
                    raise BoundError('Durable process manifest readback differs')
            finally:
                self.diagnostics = previous

    def json(self, path, value, cap=None, exclusive=False):
        if not self.diagnostics:
            self.monitor.check()
        self.write(path, encode(value, cap or CONTRACT['json_bytes']), cap or CONTRACT['json_bytes'], exclusive)


def emit(payload, deadline, fd=1):
    if type(payload) is not bytes or len(payload) > CONTRACT['stdout_bytes']:
        raise BoundError('Terminal stream byte cap')
    previous = os.get_blocking(fd)
    try:
        os.set_blocking(fd, False)
        offset = 0
        while offset < len(payload):
            if time.monotonic() >= deadline:
                raise BoundError('Terminal stream deadline reached')
            try:
                count = os.write(fd, payload[offset:])
            except BlockingIOError:
                time.sleep(min(0.05, max(0, deadline-time.monotonic())))
                continue
            if count <= 0:
                raise BoundError('Terminal stream write made no progress')
            offset += count
    finally:
        os.set_blocking(fd, previous)


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
    """Bounded shared-module adapter; every helper uses the durable process registry."""
    def __init__(self, deadline, registry):
        self.deadline, self.registry = deadline, registry

    def __getattr__(self, name):
        return getattr(subprocess, name)

    def run(self, command, capture_output=False, text=False, input=None, timeout=None, **options):
        if not capture_output or input is not None or options:
            raise BoundError('Unexpected helper subprocess contract')
        result, identity, rows = self.registry.capture(command, CONTRACT['helper_capture_bytes'],
            min(timeout or CONTRACT['helper_timeout_seconds'], CONTRACT['helper_timeout_seconds']))
        if text:
            return result
        return subprocess.CompletedProcess(command, result.returncode, result.stdout.encode(), result.stderr.encode())


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
