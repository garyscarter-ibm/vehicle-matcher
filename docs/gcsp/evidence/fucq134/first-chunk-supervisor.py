"""Author-only FUCQ-134 first chunk. Requires reviewed freeze and a new grant."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq134'
MIB = 1024 ** 2
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs')


def sha(data):
    return hashlib.sha256(data).hexdigest()


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


def physical(path, expected):
    value, followed = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    actual = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
              'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        actual['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = path.read_bytes()
        actual.update(bytes=len(data), sha256=sha(data))
    if 'children' in expected:
        actual['children'] = sorted(item.name for item in path.iterdir())
    if actual != expected:
        raise RuntimeError('Frozen physical/content identity differs: ' + str(path))


def admit(expected_sha):
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use /usr/bin/python3 -I -B')
    data = (EVIDENCE / 'first-chunk-admission.json').read_bytes()
    if sha(data) != expected_sha:
        raise RuntimeError('Admission SHA differs from reviewed command')
    plan = strict_json(data)
    if plan['root'] != str(ROOT) or plan['pythonExecutable'] != sys.executable or plan['pythonVersion'] != sys.version:
        raise RuntimeError('Reviewed checkout/interpreter differs')
    for name, expected in plan['nodes'].items():
        physical(Path(name), expected)
    for name in plan['absent']:
        if os.path.lexists(name):
            raise RuntimeError('Frozen absent resolution candidate exists: ' + name)
    for name, row in plan['sources'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise RuntimeError('Source escapes mirror')
        data = row['text'].encode()
        if len(data) != row['bytes'] or sha(data) != row['sha256']:
            raise RuntimeError('Embedded immutable source differs: ' + name)
    material = {name: row['sha256'] for name, row in plan['sources'].items()}
    if sha(json.dumps(material, sort_keys=True, separators=(',', ':')).encode()) != plan['codeRevision']:
        raise RuntimeError('Composed code identity differs')
    return plan


def imported(plan, name, path):
    physical(path, plan['nodes'][str(path)])
    data = path.read_bytes()
    if sha(data) != plan['nodes'][str(path)]['sha256']:
        raise RuntimeError('Helper changed immediately before import')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--execute', action='store_true')
    parser.add_argument('--admission-sha', required=True)
    parser.add_argument('--dispatcher-grant')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.admission_sha):
        parser.error('Supply the externally reviewed admission SHA')
    started = time.monotonic()
    frozen = admit(args.admission_sha)
    if args.plan:
        print(json.dumps({'status': 'plan-only', 'codeRevision': frozen['codeRevision'],
                          'sourceFiles': len(frozen['sources']), 'allocation': 'none; no custom imports/JavaScript/OS proof'}))
        return
    if args.dispatcher_grant != 'fucq134-first-chunk-' + args.admission_sha:
        parser.error('Requires the exact new dispatcher grant for this freeze')
    environment = {key: value for key, value in os.environ.items()
                   if key in ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_CTYPE', 'TZ']}
    environment.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL='C')
    os.environ.clear()
    os.environ.update(environment)
    resources = imported(frozen, 'fucq134_resources', ROOT / '_tools/test_resources.py')
    guard = imported(frozen, 'fucq134_strict_resources', EVIDENCE / 'first-chunk-resources.py')
    completion = imported(frozen, 'fucq134_completion', EVIDENCE / 'first-chunk-completion.py')
    with resources.handled_termination():
        execute(frozen, args, resources, guard, completion, environment, started)


def execute(frozen, args, resources, guard, completion, environment, started):
    import uuid
    policy = resources.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128,
                               'log_mib': 2, 'reserve_free_gib': 5})
    rdir = SHARED / 'fucq134' / ('first-chunk-' + uuid.uuid4().hex)
    for path in [rdir.parent, *rdir.parent.parents, SHARED / 'ownership']:
        if path.is_symlink():
            raise RuntimeError('Retained path ancestor symlink refused')
    scratch = guard.make_scratch(resources, rdir, ROOT, policy, SHARED / 'ownership')
    lock = frozen['nodes'][str(Path(frozen['ledgerDirectory']) / 'reservations.lock')]
    host = guard.make_budget(resources, policy, frozen['ledgerDirectory'], [lock['device'], lock['inode']])
    tree = guard.ProcessTree(resources, scratch)
    finalizer = guard.Finalizer(resources, scratch, tree, host, verify=lambda: admit(args.admission_sha))
    identity = {'story': 'FUCQ-134', 'variant': 'isolated-real66-three-mechanics-cases',
        'admissionSHA256': args.admission_sha, 'codeRevision': frozen['codeRevision'],
        'actual66': frozen['actual66'], 'base': frozen['base'], 'limits': frozen['limits'],
        'sources': {name: row['sha256'] for name, row in frozen['sources'].items()},
        'environmentDigest': sha(json.dumps(environment, sort_keys=True).encode())}
    process, failure, result = None, None, {}
    tree.phase = 'setup'
    tree.deadline = started + 120
    def account(rows):
        try:
            unit = 1 if sys.platform == 'darwin' else 1024
            own_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * unit
            child_peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * unit
            rss = result.get('lastAggregateRSS', own_peak)
            if rows is not None:
                selected = {os.getpid()} | {item['pid'] for item in tree.record['ownedPids']
                    if item.get('start') and rows.get(item['pid'], {}).get('start') == item['start']}
                anchored = {rows[pid]['pgid'] for pid in selected} & set(tree.record['groups'])
                selected |= {row['pid'] for row in rows.values() if row['pgid'] in anchored}
                while True:
                    expanded = selected | {row['pid'] for row in rows.values() if row['ppid'] in selected}
                    if expanded == selected:
                        break
                    selected = expanded
                rss = sum(rows[pid]['rss'] for pid in selected)
                result['lastAggregateRSS'] = rss
            used = scratch.sample() + guard.allocated_bytes(rdir)
            if os.path.lexists(scratch.manifest):
                value = scratch.manifest.lstat()
                used += max(value.st_size, value.st_blocks * 512)
            elapsed = time.monotonic() - started
            result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss, own_peak + child_peak),
                peakCombinedBytes=max(result.get('peakCombinedBytes', 0), used), elapsedSeconds=elapsed,
                accountingSamples=result.get('accountingSamples', 0) + 1, accountingPhase=tree.phase,
                rssPeakBasis='recursive snapshots and conservative process high-water bound',
                completionReserveRamBytes=completion.RAM_RESERVE, completionReserveDiskBytes=completion.DISK_RESERVE)
            tree.record['accounting'] = {key: result[key] for key in ['peakAggregateRSS', 'peakCombinedBytes',
                'elapsedSeconds', 'accountingSamples', 'accountingPhase', 'rssPeakBasis']}
            if result['peakAggregateRSS'] + completion.RAM_RESERVE > 768 * MIB \
                    or used + completion.DISK_RESERVE > 128 * MIB or elapsed > 120:
                raise RuntimeError('Aggregate RAM/combined disk/elapsed cap reached')
            if guard.shutil.disk_usage(ROOT).free < policy.reserve + completion.DISK_RESERVE:
                raise RuntimeError('Host disk emergency reserve reached')
            if rows is not None and getattr(host, 'owned', None):
                host.update_owned(scratch.token, used + completion.DISK_RESERVE,
                                  max(rss, own_peak + child_peak) + completion.RAM_RESERVE)
                if time.monotonic() >= tree.deadline:
                    raise RuntimeError('Resource deadline reached during ledger accounting')
        except BaseException as error:
            tree.record['accountingFailure'] = {'type': type(error).__name__, 'phase': tree.phase}
            raise
        finally:
            result['elapsedSeconds'] = time.monotonic() - started
            tree.record.setdefault('accounting', {})['elapsedSeconds'] = result['elapsedSeconds']
    tree.account = account
    try:
        rows = tree.snapshot()
        scratch.record['owner'] = {key: rows[os.getpid()][key] for key in ['pid', 'start']}
        resources.atomic_json(scratch.manifest, scratch.record)
        resources.atomic_json(rdir / 'checkpoint.json', {'state': 'incomplete', 'identity': identity,
            'grant': args.dispatcher_grant, 'manifest': str(scratch.manifest)})
        host.acquire_owned(scratch, guard.allocated_bytes(rdir) + scratch.manifest.stat().st_size, tree)
        scratch.__enter__()
        mirror = scratch.root / 'mirror'
        files = {}
        for name, row in frozen['sources'].items():
            target = mirror / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(row['text'].encode())
            if sha(target.read_bytes()) != row['sha256']:
                raise RuntimeError('Mirror materialization differs')
            files[str(target)] = row['sha256']
        (mirror / 'server/node_modules').symlink_to(frozen['installedRoot'], target_is_directory=True)
        for package in frozen['installedPackages'].values():
            for row in package['files']:
                files[str(Path(package['realRoot']) / row['path'])] = row['sha256']
        runtime = scratch.root / 'runtime.json'
        resources.atomic_json(runtime, {'codeRevision': frozen['codeRevision'], 'files': files})
        tree.phase = 'verification'
        tree.snapshot()
        admit(args.admission_sha)
        tree.snapshot()
        tree.phase = 'execution'
        log = rdir / 'test.log'
        written = 0
        with log.open('xb') as stream:
            command = [frozen['nodeExecutable'], str(mirror / 'server/test/helpers/gcsp-comparison-launch.mjs'),
                str(mirror / 'server/test/helpers/gcsp-comparison-guard.mjs'), str(runtime),
                str(mirror / 'server/test/gcsp-comparison-current.test.js')]
            process = tree.launch(command, cwd=mirror, env=scratch.env(environment), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            os.set_blocking(process.stdout.fileno(), False)
            def drain():
                nonlocal written
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = 2 * MIB - written
                stream.write(block[:room])
                stream.flush()
                written += min(room, len(block))
                if len(block) > room:
                    raise RuntimeError('Combined child log cap reached')
                return bool(block)
            def sample():
                _rows, members, _child_rss = tree.observe()
                if len(members) != 1:
                    raise RuntimeError('Exactly one Node worker required')
                if time.monotonic() - started > 110:
                    raise RuntimeError('Execution budget reached; reserve10seconds for cleanup')
            sample()
            process.stdin.write(b'1')
            process.stdin.flush()
            process.stdin.close()
            while True:
                drain()
                sample()
                if process.poll() is not None:
                    break
                time.sleep(0.05)
            result['processAbsence'] = tree.stop_join()
            while drain():
                pass
            result.update(rc=process.returncode, logBytes=written)
        content = log.read_text()
        counts = {match.group(1): int(match.group(2)) for match in re.finditer(
            r'^# (tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', content, re.M)}
        names = [match.group(1) for match in re.finditer(r'^ok \d+ - (.+)$', content, re.M)]
        result.update(counts=counts, names=names, log={'path': str(log), 'bytes': log.stat().st_size, 'sha256': sha(log.read_bytes())})
        if process.returncode != 0 or counts != {'tests': 3, 'pass': 3, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0} \
                or names != frozen['testNames']:
            raise RuntimeError('Selected three-case TAP contract failed')
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        tree.phase = 'cleanup'
        process = process if process is not None else tree.process
        try:
            result['processAbsence'] = tree.stop_join(process)
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        if process is not None:
            for pipe in [process.stdin, process.stdout]:
                if pipe and not pipe.closed:
                    pipe.close()
        cleanup = finalizer.finish()
        result['elapsedSeconds'] = time.monotonic() - started
        tree.record.setdefault('accounting', {})['elapsedSeconds'] = result['elapsedSeconds']
    preserved = cleanup.get('pinsPreserved', False)
    candidate_passed = failure is None and cleanup['passed'] and preserved and result.get('rc') == 0
    tree.phase = 'final-output'
    account(None)
    receipt = {'identity': identity, 'grant': args.dispatcher_grant, 'passed': False,
        'candidatePassed': candidate_passed, 'completion': 'awaiting-independent-parent-audit', 'failure': failure,
        'result': result, 'cleanup': cleanup, 'pinsPreserved': preserved, 'manifest': str(scratch.manifest),
        'wallSeconds': time.monotonic() - started, 'proofBoundary': 'three real66 mechanics cases only; no route/cache/outcome/corpus/UI/native/full acceptance'}
    checkpoint = {'state': 'incomplete', 'candidatePassed': candidate_passed,
        'completion': 'awaiting-independent-parent-audit',
        'receipt': str(rdir / 'receipt.json'), 'manifest': str(scratch.manifest)}
    payloads = {'manifest': (scratch.manifest, scratch.record),
                'receipt': (rdir / 'receipt.json', receipt), 'checkpoint': (rdir / 'checkpoint.json', checkpoint)}
    counters = [0, 0]
    encoded = {name: completion.encode(value, completion.FILE_LIMITS[name], counters)
               for name, (_path, value) in payloads.items()}
    ticket = completion.encode({'candidatePassed': candidate_passed, 'controllerPid': os.getpid(),
        'startedMonotonic': started, 'admissionSHA256': args.admission_sha, 'run': str(rdir),
        'completionSHA256': frozen['nodes'][str(EVIDENCE / 'first-chunk-completion.py')]['sha256'],
        'reserveRamBytes': completion.RAM_RESERVE, 'reserveDiskBytes': completion.DISK_RESERVE,
        'files': {name: {'path': str(payloads[name][0]), 'bytes': len(data), 'sha256': sha(data)}
                  for name, data in encoded.items()}}, completion.TICKET_LIMIT)
    account(None)
    for name, data in encoded.items():
        completion.write_once(payloads[name][0], data)
        account(None)
    # The independent parent checks actual files/disk/time after this process has
    # exited0. These immutable on-disk candidates never assert completion alone.
    sys.stdout.buffer.write(ticket)
    sys.stdout.buffer.flush()
    account(None)
    if not candidate_passed:
        sys.exit(2)


if __name__ == '__main__':
    main()
