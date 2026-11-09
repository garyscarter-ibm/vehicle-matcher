"""Frozen, strict activation harness. No helper imports before complete admission.

--plan performs hash/physical/source checks only. --execute additionally needs a
new exact grant. This owns its adapter and leaves shared test_resources unchanged.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / 'docs/gcsp/models'
MIB = 1024 ** 2
SOURCE_SHA = 'f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa'


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
    value = path.lstat()
    followed = path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=sha(data))
    if 'children' in expected:
        row['children'] = sorted(item.name for item in path.iterdir())
    if row != expected:
        raise RuntimeError('Frozen physical/content identity differs: ' + str(path))


def admit(expected_sha):
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use the reviewed /usr/bin/python3 -I -B command')
    data = (MODELS / 'fucq115-activation-admission.json').read_bytes()
    if sha(data) != expected_sha:
        raise RuntimeError('Admission SHA differs from reviewed command')
    plan = strict_json(data)
    if plan['sourcePlanSHA256'] != SOURCE_SHA or plan['sourceFiles'] != 77 or plan['sourceBytes'] != 4349951:
        raise RuntimeError('Reviewed77-source boundary differs')
    if plan['pythonExecutable'] != sys.executable or plan['pythonVersion'] != sys.version:
        raise RuntimeError('Running Python interpreter differs')
    # Every helper, executable, dependency file/directory and missing resolution
    # candidate is checked before executing any custom imported helper bytes.
    for name, expected in plan['nodes'].items():
        physical(Path(name), expected)
    for name in plan['absentResolutionCandidates']:
        if os.path.lexists(name):
            raise RuntimeError('Absent package resolution changed: ' + name)
    if os.path.lexists(ROOT / 'server/node_modules'):
        raise RuntimeError('Worktree dependency link must remain absent')
    return plan


def imported(plan, name, path):
    expected = plan['nodes'][str(path)]
    physical(path, expected)
    data = path.read_bytes()
    if sha(data) != expected['sha256']:
        raise RuntimeError('Helper drift immediately before import')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # Execute exactly the already hashed bytes rather than reopening the path
    # inside a loader after the admission check.
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
        parser.error('Supply the exact externally reviewed admission SHA')
    if args.execute and not (args.dispatcher_grant or '').startswith('fucq115-activation-'):
        parser.error('Execution requires the new exact activation grant')
    frozen = admit(args.admission_sha)
    # A small allowlist strips all database/PG/GCSP/NODE/Python/debug/profiling
    # and native loader injection variables, including every DYLD_/LD_ prefix.
    environment = {key: value for key, value in os.environ.items()
                   if key in ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_CTYPE', 'TZ']}
    environment.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LC_ALL='C')
    os.environ.clear()
    os.environ.update(environment)
    tr = imported(frozen, 'fucq115_verified_resources', ROOT / '_tools/test_resources.py')
    sg = imported(frozen, 'fucq115_verified_git', ROOT / '_tools/scaffold_git.py')
    guard = imported(frozen, 'fucq115_owned_strict_resources', MODELS / 'fucq115-activation-resources.py')
    source_plan = strict_json((MODELS / 'fucq115-activation-source-plan.json').read_bytes())
    source = {}
    for name, row in source_plan['files'].items():
        rc, content, error = sg.git(ROOT, ['show', row['sourceCommit'] + ':' + name])
        data = content.encode()
        if rc != 0 or sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Immutable source drift: ' + name)
        source[name] = data
    identity = {'story': 'FUCQ-115', 'variant': frozen['variant'], 'admissionSHA256': args.admission_sha,
                'sourcePlanSHA256': SOURCE_SHA, 'sourceFiles': len(source), 'sourceBytes': sum(map(len, source.values())),
                'sources': {name: row['sha256'] for name, row in source_plan['files'].items()},
                'environmentDigest': sha(json.dumps(environment, sort_keys=True).encode()),
                'limits': {'seconds': 120, 'ramBytes': 768 * MIB, 'combinedBytes': 128 * MIB,
                           'logBytes': 2 * MIB, 'retainedBytes': 2 * MIB, 'workerCount': 1}}
    admit(args.admission_sha)
    if args.plan:
        print(json.dumps({'status': 'plan-only', 'identity': identity, 'frozenNodes': len(frozen['nodes']),
                          'installedPackages': len(frozen['installedPackages']),
                          'allocation': 'none; all identities verified before custom imports; no JavaScript/OS proof/test launched'}))
        return
    with tr.handled_termination():
        with guard.CancellationScope() as cancellation:
            execute(frozen, args, tr, guard, source, identity, environment, cancellation)

def execute(frozen, args, tr, guard, source, identity, environment, cancellation):
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128, 'log_mib': 2})
    rdir = ROOT / '.claude/test-runs/fucq115' / ('artifact-activation-v2-' + uuid.uuid4().hex)
    retained = rdir / 'retained'
    tr.atomic_json(rdir / 'plan.json', {'identity': identity, 'grant': args.dispatcher_grant,
        'command': frozen['commands']['child'], 'retainedRoot': str(retained),
        'selection': 'Unchanged actual canonical activation entry on original artifact/dates/provenance.',
        'exclusions': 'No generator/training/baseline/settings/metrics rerun, production edit, native/database/browser/listener/network/corpus/full execution.'})
    retained.mkdir()
    scratch = guard.make_scratch(tr, rdir, ROOT, policy)
    lock = frozen['nodes'][str(Path(frozen['ledgerDirectory']) / 'reservations.lock')]
    host = guard.make_budget(tr, policy, frozen['ledgerDirectory'], [lock['device'], lock['inode']])
    tree = guard.ProcessTree(tr, scratch)
    finalizer = guard.Finalizer(tr, scratch, tree, host, cancellation)
    tr.atomic_json(scratch.manifest, scratch.record)
    tr.atomic_json(rdir / 'checkpoint.json', {'state': 'incomplete', 'identity': identity, 'manifest': str(scratch.manifest)})
    process, failure, result = None, None, {}
    started = time.monotonic()
    try:
        cancellation.check()
        host.acquire_owned(scratch, guard.allocated_bytes(rdir))
        scratch.__enter__()
        mirror = scratch.root / 'mirror'
        for name, data in source.items():
            target = mirror / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (mirror / 'server/node_modules').symlink_to('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules', target_is_directory=True)
        for name, target in [('fucq115-activation-run.mjs', 'entry.mjs'), ('fucq115-activation-launch.mjs', 'launch.mjs')]:
            data = (MODELS / name).read_bytes()
            if sha(data) != frozen['nodes'][str(MODELS / name)]['sha256']:
                raise RuntimeError('Entry/launcher drift before copying')
            (scratch.root / target).write_bytes(data)
        admit(args.admission_sha)
        log = rdir / 'test.log'
        written = 0
        with log.open('xb') as stream:
            cancellation.check()
            command = ['/opt/homebrew/bin/node', str(scratch.root / 'launch.mjs'), str(scratch.root / 'entry.mjs'), str(mirror), str(scratch.root / 'output')]
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
                cancellation.check()
                rows, members, child_rss = tree.observe()
                owned = {row['pid'] for row in members}
                probe_rss = sum(row['rss'] for row in rows.values()
                                if row['ppid'] == os.getpid() and row['pid'] not in owned)
                rss = child_rss + rows[os.getpid()]['rss'] + probe_rss
                used = scratch.sample() + guard.allocated_bytes(rdir)
                host.update_owned(scratch.token, used, rss)
                result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss),
                              peakCombinedBytes=max(result.get('peakCombinedBytes', 0), used))
                if rss > 768 * MIB or used > 128 * MIB:
                    raise RuntimeError('Aggregate RAM/combined disk cap reached')
                if time.monotonic() - started > 120:
                    raise RuntimeError('Activation chunk exceeded120seconds')
                if guard.shutil.disk_usage(scratch.root).free < policy.reserve:
                    raise RuntimeError('Host disk emergency reserve reached')
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
            proof = tree.stop_join()
            while drain():
                pass
            result.update(rc=process.returncode, logBytes=written, processAbsence=proof)
        if process.returncode != 0:
            raise RuntimeError('Activation entry failed; inspect retained phase/report')
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        # Deferred cancellation may escape before launch returns to this local.
        # The tree already owns the handle and its persisted registration.
        if process is None:
            process = tree.process
        try:
            result['processAbsence'] = tree.stop_join()
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        if process is not None:
            try:
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
                process.stdout.close()
            except OSError as error:
                failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    # Retain reached diagnostics only after a fresh stop/join/absence proof.
    # On successful execution, defer scratch deletion until selected files move.
    try:
        if result.get('processAbsence') and os.path.lexists(scratch.root):
            proof = tree.proof()
            if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
                raise RuntimeError('No process proof authorises output retention')
            selected = []
            for name in ['run-summary.json', 'activation-command.json']:
                path = scratch.root / 'output' / name
                if path.is_file():
                    if path.is_symlink() or path.resolve().parent != (scratch.root / 'output').resolve():
                        raise RuntimeError('Retained output escapes owned output')
                    selected.append(path)
            if sum(max(path.stat().st_size, path.stat().st_blocks * 512) for path in selected) > 2 * MIB:
                raise RuntimeError('Retained output cap reached')
            receipts = []
            for path in selected:
                target = retained / path.name
                if os.path.lexists(target) or path.stat().st_dev != retained.stat().st_dev:
                    raise RuntimeError('Retained same-volume move refused')
                data = path.read_bytes()
                os.rename(path, target)
                receipts.append({'path': str(target), 'bytes': len(data), 'sha256': sha(data)})
            result['retained'] = receipts
            admit(args.admission_sha)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        cleanup = finalizer.finish()
    pins_preserved = False
    try:
        cancellation.check()
        admit(args.admission_sha)
        pins_preserved = True
        cancellation.check()
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    passed = failure is None and cleanup['passed'] and pins_preserved and result.get('rc') == 0
    summary = {'identity': identity, 'grant': args.dispatcher_grant, 'passed': passed,
               'failure': failure, 'result': result, 'cleanup': cleanup, 'pinsPreserved': pins_preserved,
               'wall': time.monotonic() - started, 'retainedAllocatedBytes': guard.allocated_bytes(retained)}
    tr.atomic_json(rdir / 'summary.json', summary)
    tr.atomic_json(rdir / 'checkpoint.json', {'state': 'complete' if passed else 'incomplete', 'summary': str(rdir / 'summary.json'), 'manifest': str(scratch.manifest)})
    print(json.dumps({'run': str(rdir), 'passed': passed, 'failure': failure, 'cleanup': cleanup}))
    if not passed:
        sys.exit(2)


if __name__ == '__main__':
    main()
