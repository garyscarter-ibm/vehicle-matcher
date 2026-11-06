"""Owned C4 strict shared-ledger adapter. No pruning, default registry or allocation on import."""
from contextlib import contextmanager
import copy
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time

LIMIT = 4 * 1024 * 1024


def strict_json(data):
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


def physical(path):
    path = Path(path)
    value = path.lstat()
    if path.is_symlink() or not (stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode)):
        raise RuntimeError('Accounting anchor is not physical')
    return {'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
            'uid': value.st_uid, 'kind': 'directory' if stat.S_ISDIR(value.st_mode) else 'file',
            'resolved': str(path.resolve(strict=True))}


def valid_start(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', value):
        return False
    try:
        datetime.strptime(value, '%a %b %d %H:%M:%S %Y')
        return True
    except ValueError:
        return False


class Budget:
    def __init__(self, resources, policy, contract, bounds, deadline, scratch=None):
        self.resources, self.policy, self.contract, self.scratch = resources, policy, contract, scratch
        self.bounds = bounds
        self.deadline = deadline
        self.final_staging = None
        self.completion_check = None
        self.directory = Path(contract['directory'])
        self.path = self.directory / 'reservations.json'
        self.lock = self.directory / 'reservations.lock'
        self.expected = None
        self.attempted = False
        self.lock_fd = None
        self.directory_fd = None
        self.sequence = 0

    def anchors(self):
        if time.monotonic() >= self.deadline:
            raise RuntimeError('Whole-chunk ledger deadline reached; preserve uncertain state')
        for path, expected in self.contract['anchors'].items():
            if physical(path) != expected:
                raise RuntimeError('Frozen accounting anchor changed')
        for path in [self.directory, *self.directory.parents]:
            if path.is_symlink():
                raise RuntimeError('Accounting path contains a symlink')

    @contextmanager
    def locked(self):
        self.anchors()
        directory = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fd = None
        try:
            expected_dir = self.contract['anchors'][str(self.directory)]
            opened = os.fstat(directory)
            if not stat.S_ISDIR(opened.st_mode) or (opened.st_dev, opened.st_ino, opened.st_uid, stat.S_IMODE(opened.st_mode)) != \
                    (expected_dir['device'], expected_dir['inode'], expected_dir['uid'], expected_dir['mode']):
                raise RuntimeError('Accounting directory changed during open')
            fd = os.open('reservations.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            opened = os.fstat(fd); expected = self.contract['anchors'][str(self.lock)]
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 \
                    or (opened.st_dev, opened.st_ino, opened.st_uid, stat.S_IMODE(opened.st_mode)) != \
                    (expected['device'], expected['inode'], expected['uid'], expected['mode']):
                raise RuntimeError('Accounting lock descriptor differs')
            deadline = min(self.deadline, time.monotonic()+2)
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Accounting lock is busy')
                    time.sleep(0.02)
            self.anchors()
            self.lock_fd, self.directory_fd = fd, directory
            yield
            self.anchors()
        finally:
            self.lock_fd, self.directory_fd = None, None
            if fd is not None:
                os.close(fd)
            os.close(directory)

    def ledger(self):
        if self.lock_fd is None:
            raise RuntimeError('Ledger read requires the frozen lock')
        self.anchors()
        fd = os.open('reservations.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.directory_fd)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > LIMIT \
                    or before.st_uid != self.contract['anchors'][str(self.directory)]['uid']:
                raise RuntimeError('Ledger is not a bounded owned regular file')
            raw = stream.read(LIMIT + 1)
            after = os.fstat(stream.fileno())
        named = os.stat('reservations.json', dir_fd=self.directory_fd, follow_symlinks=False)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(raw) > LIMIT or identity(before) != identity(after) or identity(after) != identity(named):
            raise RuntimeError('Ledger identity changed during read')
        data = strict_json(raw.decode('utf-8'))
        self.bounds.structure(data)
        if not isinstance(data, dict):
            raise ValueError('Ledger must be an object')
        for token, row in data.items():
            if not isinstance(token, str) or not token or len(token) > 128 or not isinstance(row, dict) \
                    or set(row) != {'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}:
                raise ValueError('Unknown ledger row')
            owner = row['owner']
            if not isinstance(owner, dict) or set(owner) != {'pid', 'start'} or type(owner['pid']) is not int \
                    or owner['pid'] <= 0 or not valid_start(owner['start']):
                raise ValueError('Unknown ledger owner')
            if any(type(row[key]) is not int or row[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                raise ValueError('Unknown ledger accounting')
            if row['root'] is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()
                                          or os.path.normpath(row['root']) != row['root']):
                raise ValueError('Unknown ledger root')
            parent, visited = row['parent'], {token}
            while parent is not None:
                if not isinstance(parent, str) or parent in visited or parent not in data or not isinstance(data[parent], dict):
                    raise ValueError('Unknown or cyclic ledger ancestry')
                visited.add(parent); parent = data[parent].get('parent')
        return data

    def write_readback(self, original, updated, final=False):
        # Compare all rows before and after; foreign values are never filtered, pruned or repaired.
        if self.expected is None or {k: v for k, v in original.items() if k != self.expected[0]} \
                != {k: v for k, v in updated.items() if k != self.expected[0]}:
            raise RuntimeError('Foreign reservation mutation refused')
        if self.ledger() != original:
            raise RuntimeError('Ledger changed before owned mutation')
        self.anchors()
        payload = self.bounds.encode(updated, LIMIT)
        if len(payload) > LIMIT:
            raise RuntimeError('Ledger mutation exceeds bound')
        if self.scratch is None:
            raise RuntimeError('Read-only adapter cannot mutate the ledger')
        if final:
            if self.completion_check is None:
                raise RuntimeError('Final completion accounting is required')
            self.completion_check()
            if self.final_staging is None:
                raise RuntimeError('Final release staging was not declared')
            name = Path(self.final_staging['path'])
            staging = self.final_staging
        else:
            self.sequence += 1
            name = self.directory / ('.fucq122-c4-ledger-' + self.scratch.token + '-' + str(self.sequence))
            staging = {'path': str(name), 'state': 'planned', 'bytes': len(payload)}
            self.scratch.record.setdefault('ledger_staging', []).append(staging)
            self.scratch.record['ledger_staging_peak_bytes'] = max(self.scratch.record.get('ledger_staging_peak_bytes', 0), len(payload))
            self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
        fd = os.open(name.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.directory_fd)
        identity = os.fstat(fd)
        try:
            with os.fdopen(fd, 'wb') as output:
                if not final:
                    staging.update(state='created', device=identity.st_dev, inode=identity.st_ino)
                    self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
                output.write(payload); output.flush(); os.fsync(output.fileno())
            self.anchors()
            if self.ledger() != original:
                raise RuntimeError('Ledger changed during owned mutation')
            staged = os.stat(name.name, dir_fd=self.directory_fd, follow_symlinks=False)
            if not stat.S_ISREG(staged.st_mode) or staged.st_nlink != 1 \
                    or (staged.st_dev, staged.st_ino) != (identity.st_dev, identity.st_ino):
                raise RuntimeError('Owned ledger staging identity changed')
            if final:
                self.completion_check()
            os.replace(name.name, self.path.name, src_dir_fd=self.directory_fd, dst_dir_fd=self.directory_fd)
            os.fsync(self.directory_fd)
            if self.ledger() != updated:
                raise RuntimeError('Complete ledger readback differs')
            self.anchors()
        finally:
            try:
                staged = os.stat(name.name, dir_fd=self.directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                staged = None
            if staged is not None:
                if (staged.st_dev, staged.st_ino) != (identity.st_dev, identity.st_ino):
                    raise RuntimeError('Preserve uncertain ledger staging path')
                os.unlink(name.name, dir_fd=self.directory_fd)
            if not final:
                staging['state'] = 'removed'
                self.resources.atomic_json(self.scratch.manifest, self.scratch.record)

    def owned(self, data, token, owner_start=None):
        if self.expected is None or token != self.expected[0] or data.get(token) != self.expected[1]:
            raise RuntimeError('Exact owned reservation row differs')
        row = data[token]
        observed_start = self.resources.process_identity(os.getpid()) if owner_start is None else owner_start
        if row['owner'] != self.scratch.record['owner'] or row['root'] != str(self.scratch.root) \
                or row['parent'] is not None or row['owner']['pid'] != os.getpid() \
                or observed_start != row['owner']['start']:
            raise RuntimeError('Reservation owner/root binding differs')
        return row

    def acquire(self, token, disk, ram, volume, root=None, minimum_ram=None):
        if self.scratch is None or root != self.scratch.root or token != self.scratch.token or self.expected is not None:
            raise RuntimeError('Supply the exact owned scratch reservation')
        owner = self.scratch.record['owner']
        if owner['pid'] != os.getpid() or not valid_start(owner.get('start')) \
                or self.resources.process_identity(os.getpid()) != owner['start']:
            raise RuntimeError('Supervisor identity is unknown')
        free, memory = shutil.disk_usage(volume).free, self.resources.available_memory()
        if type(memory) is not int or memory <= 0:
            raise RuntimeError('Available host memory is unknown')
        with self.locked():
            data = self.ledger()
            if token in data:
                raise RuntimeError('Reservation token already exists')
            disk_free = free - self.policy.reserve - sum(max(0, row['disk'] - row['used']) for row in data.values())
            ram_free = memory - int(self.policy.ram_reserve_mib * self.resources.MIB) \
                - sum(max(0, row['ram'] - row['rss']) for row in data.values())
            if disk_free < disk or ram_free < (ram if minimum_ram is None else minimum_ram):
                raise RuntimeError('Insufficient proven shared host headroom')
            row = {'owner': copy.deepcopy(owner), 'root': str(root), 'parent': None,
                   'disk': disk, 'ram': ram, 'used': 0, 'rss': 0}
            self.expected = (token, copy.deepcopy(row))
            self.attempted = True
            self.scratch.record['reservation_intent'] = {'token': token, 'row': copy.deepcopy(row)}
            self.resources.atomic_json(self.scratch.manifest, self.scratch.record)
            updated = copy.deepcopy(data); updated[token] = row
            self.write_readback(data, updated)
            return {'disk': row['disk'], 'ram': row['ram']}

    def update(self, token, used, rss):
        if type(used) is not int or used < 0 or type(rss) is not int or rss < 0:
            raise RuntimeError('Invalid reservation observation')
        with self.locked():
            data = self.ledger(); self.owned(data, token)
            updated = copy.deepcopy(data); updated[token].update(used=used, rss=rss)
            # Keep exact mutation intent if persistence/readback fails.
            self.expected = (token, copy.deepcopy(updated[token]))
            self.write_readback(data, updated)
            return True

    def authorize_cleanup(self, token):
        with self.locked():
            data = self.ledger()
            if any(row['parent'] == token for row in data.values()):
                raise RuntimeError('Dependent reservation prevents cleanup')
            if self.expected is not None:
                self.owned(data, token)
            elif token in data or self.attempted:
                raise RuntimeError('Uncertain acquisition prevents cleanup')

    @contextmanager
    def cleanup_authority(self, token, owner_start):
        if not isinstance(owner_start, str) or not valid_start(owner_start):
            raise RuntimeError('Fresh complete OS owner proof required for cleanup')
        with self.locked():
            data = self.ledger()
            if any(row['parent'] == token for row in data.values()):
                raise RuntimeError('Dependent reservation prevents scratch deletion')
            if self.expected is not None:
                self.owned(data, token, owner_start=owner_start)
            elif token in data or self.attempted:
                raise RuntimeError('Uncertain acquisition prevents scratch deletion')
            yield  # Held physical lock covers the caller's last inode check and rmtree.
            if self.ledger() != data:
                raise RuntimeError('Complete ledger changed under cleanup authority')

    def prepare_final_release(self, token):
        self.authorize_cleanup(token)
        if self.final_staging is not None:
            raise RuntimeError('Final release intent already exists')
        self.sequence += 1
        self.final_staging = {
            'path': str(self.directory / ('.fucq122-c4-ledger-' + token + '-' + str(self.sequence))),
            'state': 'planned-final-release', 'maximum_bytes': LIMIT,
            'completion': 'Actual exit and independent ledger/staging absence audit required; no post-release artifact writes.'}
        self.scratch.record['final_release_intent'] = self.final_staging
        self.resources.atomic_json(self.scratch.manifest, self.scratch.record)

    def release(self, token, proof):
        if not all(proof.get(key) is True for key in ('child_safe', 'groups_absent', 'processes_absent', 'scratch_absent', 'helpers_safe')):
            raise RuntimeError('Complete child/scratch proof is required for release')
        if not valid_start(proof.get('owner_start')):
            raise RuntimeError('Fresh sealed process owner proof required for final release')
        with self.locked():
            data = self.ledger(); self.owned(data, token, owner_start=proof['owner_start'])
            if any(row['parent'] == token for row in data.values()):
                raise RuntimeError('Owned reservation has dependent children')
            updated = copy.deepcopy(data); del updated[token]
            self.write_readback(data, updated, final=True)

    def absence(self, token):
        with self.locked():
            return token not in self.ledger()
