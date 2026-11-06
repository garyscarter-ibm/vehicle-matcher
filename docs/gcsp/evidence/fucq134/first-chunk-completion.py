"""Finite final writes and a separate, read-only parent audit; authoring only."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import shutil
import stat
import sys
import time

MIB = 1024 ** 2
RAM_RESERVE = 64 * MIB
DISK_RESERVE = MIB
FILE_LIMITS = {'manifest': 64 * 1024, 'receipt': 64 * 1024, 'checkpoint': 8 * 1024}
TICKET_LIMIT = 8 * 1024
ROOT = Path(__file__).resolve().parents[4]
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs')
COMPLETION_CLOCK = {'kind': 'CLOCK_UPTIME_RAW', 'platform': 'darwin', 'units': 'seconds'}


def shared_clock_seconds():
    if sys.platform != COMPLETION_CLOCK['platform'] or not hasattr(time, 'CLOCK_UPTIME_RAW') \
            or not hasattr(time, 'clock_gettime'):
        raise RuntimeError('Shared completion clock is unsupported')
    value = time.clock_gettime(time.CLOCK_UPTIME_RAW)
    if type(value) is not float or not math.isfinite(value) or value <= 0:
        raise RuntimeError('Shared completion clock is unknown')
    return value


def shared_elapsed_seconds(started):
    if type(started) is not float or not math.isfinite(started) or started <= 0:
        raise RuntimeError('Controller start time is unknown')
    now = shared_clock_seconds()
    if started > now:
        raise RuntimeError('Controller start time is unknown')
    return now - started


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate(value, counters=None, depth=0):
    # Bound the object BEFORE json.dumps, including keys, scalars and string RAM.
    counters = counters if counters is not None else [0, 0]
    counters[0] += 1
    if counters[0] > 4096 or depth > 16:
        raise RuntimeError('Final JSON node/depth limit reached')
    kind = type(value)
    if kind is str:
        counters[1] += len(value)
        if len(value) > 16 * 1024 or counters[1] > 64 * 1024:
            raise RuntimeError('Final JSON string limit reached')
    elif kind is dict:
        if len(value) > 4096:
            raise RuntimeError('Final JSON member limit reached')
        for key, item in value.items():
            if type(key) is not str:
                raise RuntimeError('Final JSON requires string keys')
            validate(key, counters, depth + 1)
            validate(item, counters, depth + 1)
    elif kind is list:
        if len(value) > 4096:
            raise RuntimeError('Final JSON array limit reached')
        for item in value:
            validate(item, counters, depth + 1)
    elif kind is int:
        if value.bit_length() > 64:
            raise RuntimeError('Final JSON integer limit reached')
    elif kind is float:
        if not math.isfinite(value):
            raise RuntimeError('Final JSON must be finite')
    elif value is not None and kind is not bool:
        raise RuntimeError('Unsupported final JSON type')


def encode(value, limit, counters=None):
    validate(value, counters)
    data = (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('ascii')
    if len(data) > limit:
        raise RuntimeError('Final encoded byte limit reached')
    return data


def ancestors(path):
    for item in [path, *path.parents]:
        if item.is_symlink():
            raise RuntimeError('Final output symlink refused')


def write_once(path, data):
    # Old target + all preencoded bytes + exclusive atomic temporary files fit
    # inside the reserved 1MiB. Failure preserves named leftovers; never retry.
    ancestors(path)
    temporary = path.with_name('.final-' + path.name + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_bounded(path, limit):
    def identity(value):
        return (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    ancestors(path)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise RuntimeError('Final file type/size differs')
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if len(data) != before.st_size or identity(before) != identity(after) or identity(path.stat()) != identity(after):
            raise RuntimeError('Final file changed during audit')
    return data


def read_ticket():
    # The parent supplies a pipe. Do not wait indefinitely for bytes or EOF if
    # that input is substituted; its three-second ceiling is within the overall
    # controller-start-to-audit deadline checked after decoding.
    descriptor = sys.stdin.fileno()
    os.set_blocking(descriptor, False)
    deadline = time.monotonic() + 3
    data = bytearray()
    while time.monotonic() < deadline:
        try:
            block = os.read(descriptor, TICKET_LIMIT + 1 - len(data))
        except BlockingIOError:
            time.sleep(0.01)
            continue
        if not block:
            return bytes(data)
        data.extend(block)
        if len(data) > TICKET_LIMIT:
            raise RuntimeError('Parent ticket byte limit reached')
    raise RuntimeError('Parent ticket read deadline reached')


def decoded(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError('Duplicate final JSON key')
            result[key] = value
        return result
    def constant(value):
        raise RuntimeError('Nonfinite final JSON')
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    validate(value)
    return value


def audit(ticket, controller_exit, admission_sha):
    if controller_exit != 0 or ticket['candidatePassed'] is not True:
        raise RuntimeError('Controller did not exit successfully with a candidate result')
    if ticket['controllerPid'] == os.getpid() or ticket['admissionSHA256'] != admission_sha:
        raise RuntimeError('Independent parent/admission identity differs')
    if ticket['completionSHA256'] != sha(read_bounded(Path(__file__), 64 * 1024)):
        raise RuntimeError('Parent audit helper differs from admitted controller helper')
    if ticket['reserveRamBytes'] != RAM_RESERVE or ticket['reserveDiskBytes'] != DISK_RESERVE:
        raise RuntimeError('Completion reserve differs')
    if ticket.get('completionClock') != COMPLETION_CLOCK:
        raise RuntimeError('Completion clock contract differs')
    started = ticket.get('startedSharedSeconds')
    if shared_elapsed_seconds(started) > 120:
        raise RuntimeError('Overall completion deadline reached')
    rdir, manifest = Path(ticket['run']), Path(ticket['files']['manifest']['path'])
    if rdir.parent != SHARED / 'fucq134' or not re.fullmatch(r'first-chunk-[a-f0-9]{32}', rdir.name):
        raise RuntimeError('Run path differs from owned output layout')
    if manifest.parent != SHARED / 'ownership' or not re.fullmatch(r'fucq134-[a-f0-9]{32}\.json', manifest.name):
        raise RuntimeError('Manifest path differs from owned output layout')
    ancestors(rdir)
    names = set()
    with os.scandir(rdir) as entries:
        for entry in entries:
            names.add(entry.name)
            if len(names) > 3:
                raise RuntimeError('Unexpected retained output or atomic temporary file')
    if names != {'receipt.json', 'checkpoint.json', 'test.log'} or set(ticket['files']) != set(FILE_LIMITS):
        raise RuntimeError('Final output inventory differs')
    allocated = max(rdir.stat().st_size, rdir.stat().st_blocks * 512)
    values = {}
    for name, limit in FILE_LIMITS.items():
        row = ticket['files'][name]
        path = manifest if name == 'manifest' else rdir / (name + '.json')
        if row['path'] != str(path):
            raise RuntimeError('Final file path differs')
        data = read_bounded(path, limit)
        if len(data) != row['bytes'] or sha(data) != row['sha256']:
            raise RuntimeError('Final file bytes differ from preencoded ticket')
        values[name] = decoded(data)
        item = path.stat()
        allocated += max(item.st_size, item.st_blocks * 512)
        if os.path.lexists(path.with_name('.final-' + path.name + '.tmp')):
            raise RuntimeError('Atomic final-output temporary file remains')
    log = rdir / 'test.log'
    ancestors(log)
    item = log.lstat()
    if not stat.S_ISREG(item.st_mode) or item.st_size > 2 * MIB:
        raise RuntimeError('Retained log type/size differs')
    allocated += max(item.st_size, item.st_blocks * 512)
    receipt, checkpoint, record = values['receipt'], values['checkpoint'], values['manifest']
    if receipt['candidatePassed'] is not True or receipt['passed'] is not False \
            or receipt['identity']['admissionSHA256'] != admission_sha \
            or receipt['identity'].get('completionClock') != COMPLETION_CLOCK \
            or checkpoint['state'] != 'incomplete' or checkpoint['candidatePassed'] is not True \
            or checkpoint['completion'] != 'awaiting-independent-parent-audit' \
            or record['finalizer'] != receipt['cleanup'] or record['finalizer']['passed'] is not True:
        raise RuntimeError('Final outputs do not describe the same provisional success')
    before_write = receipt['result']
    if before_write['peakAggregateRSS'] + RAM_RESERVE > 768 * MIB \
            or before_write['peakCombinedBytes'] + DISK_RESERVE > 128 * MIB \
            or before_write['elapsedSeconds'] > 120:
        raise RuntimeError('Recorded prewrite resource budget failed')
    scratch = ROOT / '.claude/test-scratch/fucq134' / manifest.stem
    if record['root'] != str(scratch) or os.path.lexists(scratch):
        raise RuntimeError('Owned scratch absence differs')
    unit = 1 if sys.platform == 'darwin' else 1024
    audit_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * unit
    # This process runs after controller exit. Its bounded working set is covered
    # by the controller's reserved RAM, not an unmetered concurrent child.
    elapsed = shared_elapsed_seconds(started)
    if audit_peak > RAM_RESERVE or allocated + DISK_RESERVE > 128 * MIB or elapsed > 120 \
            or shutil.disk_usage(ROOT).free < 5 * 1024 ** 3:
        raise RuntimeError('Parent postwrite RAM/disk/time/free-space budget failed')
    return {'state': 'complete', 'admissionSHA256': admission_sha, 'controllerExit': controller_exit,
            'completionClock': COMPLETION_CLOCK,
            'run': str(rdir), 'files': ticket['files'], 'postwriteCombinedBytes': allocated,
            'parentPreoutputPeakRSS': audit_peak, 'preoutputElapsedSeconds': elapsed,
            'completionRequires': 'controller and parent audit exit0'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit', action='store_true', required=True)
    parser.add_argument('--controller-exit', type=int, required=True)
    parser.add_argument('--admission-sha', required=True)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.dont_write_bytecode or not re.fullmatch('[a-f0-9]{64}', args.admission_sha):
        raise RuntimeError('Use isolated no-bytecode Python with reviewed admission SHA')
    data = read_ticket()
    ticket = decoded(data)
    result = audit(ticket, args.controller_exit, args.admission_sha)
    # No receipt rewrite: parent exit0 AND this bounded stdout are the completion
    # evidence. Any decode/read/write/audit failure leaves on-disk state incomplete.
    sys.stdout.buffer.write(encode(result, TICKET_LIMIT))
    sys.stdout.buffer.flush()
    unit = 1 if sys.platform == 'darwin' else 1024
    if shared_elapsed_seconds(ticket['startedSharedSeconds']) > 120 \
            or resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * unit > RAM_RESERVE:
        raise RuntimeError('Parent output exceeded overall time/RAM budget')


if __name__ == '__main__':
    main()
