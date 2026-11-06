"""Unexecuted FUCQ-102 harness; new exact admission/grant required before allocation.

Only stdlib runs before full admission. Owned resources copy is reviewed separately.
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

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq102'
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher')
SOURCE_SHA = 'fd2eb341905bba23414e799bb011c0d415564c0c4ac656a0b0047d82a8111c3a'
MIB = 1024 ** 2


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError('Duplicate JSON key')
            out[key] = value
        return out
    def constant(value):
        raise ValueError('Nonstandard JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def physical(path, expected):
    value, followed = path.lstat(), path.stat()
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
    data = (EVIDENCE / 'followup-entry-admission.json').read_bytes()
    if sha(data) != expected_sha:
        raise RuntimeError('Admission SHA differs from reviewed command')
    plan = strict_json(data)
    if plan['sourcePlanSHA256'] != SOURCE_SHA or plan['sourceModules'] != 44 or plan['sourceDataFiles'] != 7 or plan['selectedCases'] != 11:
        raise RuntimeError('Reviewed source boundary differs')
    if plan['pythonExecutable'] != sys.executable or plan['pythonVersion'] != sys.version:
        raise RuntimeError('Running Python interpreter differs')
    for name, expected in plan['nodes'].items():
        physical(Path(name), expected)
    for name in plan['absentResolutionCandidates']:
        if os.path.lexists(name):
            raise RuntimeError('Absent package resolution changed: ' + name)
    if os.path.lexists(ROOT / 'server/node_modules'):
        raise RuntimeError('Worktree dependency link must remain absent')
    return plan


def imported(plan, name, path):
    physical(path, plan['nodes'][str(path)])
    data = path.read_bytes()
    if sha(data) != plan['nodes'][str(path)]['sha256']:
        raise RuntimeError('Helper drift immediately before import')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


def sources(plan, sg):
    source = {}
    for name, row in {**plan['modules'], **plan['files']}.items():
        rc, content, error = sg.git(ROOT, ['show', row['sourceCommit'] + ':' + name])
        data = content.encode()
        if rc != 0 or sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Immutable source drift: ' + name)
        source[name] = data
    return source


def execute(frozen, args, resources, guard, sg, source_plan, source, environment):
    policy = resources.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128, 'log_mib': 2})
    rdir = SHARED / '.claude/test-runs/fucq102' / ('followup-' + uuid.uuid4().hex)
    identity = {'story': 'FUCQ-102', 'variant': frozen['variant'], 'admissionSHA256': args.admission_sha,
                'sourcePlanSHA256': SOURCE_SHA, 'implementationCommit': source_plan['implementationCommit'],
                'sources': {name: row['sha256'] for name, row in {**source_plan['modules'], **source_plan['files']}.items()},
                'environmentDigest': sha(json.dumps(environment, sort_keys=True).encode()), 'limits': source_plan['limits']}
    resources.atomic_json(rdir / 'plan.json', {'identity': identity, 'grant': args.dispatcher_grant,
        'selection': source_plan['selectedCases'], 'command': frozen['command'], 'excluded': source_plan['scope']})
    # The manifest and finalizer are established before reservation/scratch/child allocation.
    scratch = guard.make_scratch(resources, rdir, ROOT, policy)
    lock = frozen['nodes'][str(Path(frozen['ledgerDirectory']) / 'reservations.lock')]
    host = guard.make_budget(resources, policy, frozen['ledgerDirectory'], [lock['device'], lock['inode']])
    tree = guard.ProcessTree(resources, scratch)
    finalizer = guard.Finalizer(resources, scratch, tree, host)
    scratch.record.update(ports=[], profiles=[], dependency_links=[], supervisorFinalizer=str(Path(__file__).resolve()))
    resources.atomic_json(scratch.manifest, scratch.record)
    resources.atomic_json(rdir / 'checkpoint.json', {'state': 'incomplete', 'identity': identity, 'manifest': str(scratch.manifest)})
    process, failure, result = None, None, {}
    drain = None
    started = time.monotonic()
    try:
        host.acquire_owned(scratch, guard.allocated_bytes(rdir))
        scratch.__enter__()
        mirror = scratch.root / 'mirror'
        for name, data in source.items():
            target = mirror / name
            if name in source_plan['modules']:
                target = target.with_suffix('.mjs')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for owned, target in [('followup-entry-launch.mjs', 'launch.mjs'), ('followup-entry-loader.mjs', 'loader.mjs')]:
            path = EVIDENCE / owned
            physical(path, frozen['nodes'][str(path)])
            (scratch.root / target).write_bytes(path.read_bytes())
        mapping = {'entry': (ROOT / source_plan['entry']).as_uri(), 'selectedCases': source_plan['selectedCases'], 'modules': [
            {'path': name, 'canonical': (ROOT / name).as_uri(), 'url': (mirror / name).with_suffix('.mjs').as_uri(), 'sha256': row['sha256']}
            for name, row in source_plan['modules'].items()], 'edges': source_plan['importEdges'],
            'builtins': source_plan['builtins'], 'pgEntry': frozen['pgEntry'], 'journal': str(scratch.root / 'modules.jsonl')}
        map_path = scratch.root / 'modules.json'
        resources.atomic_json(map_path, mapping)
        child_env = scratch.env(environment)
        child_env.update(FUCQ102_FOLLOWUP_MODULE_MAP=str(map_path), FUCQ102_FOLLOWUP_MAP_SHA256=sha(map_path.read_bytes()))
        admit(args.admission_sha)
        log = rdir / 'test.log'
        written = 0
        line_tail = b''
        with log.open('xb') as stream:
            command = [frozen['nodeExecutable'], str(scratch.root / 'launch.mjs')]
            process = tree.launch(command, cwd=mirror, env=child_env, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            os.set_blocking(process.stdout.fileno(), False)
            def drain(stop_on_failure=True):
                nonlocal written, line_tail
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = 2 * MIB - written
                stream.write(block[:room])
                stream.flush()
                written += min(room, len(block))
                if len(block) > room:
                    result['logTruncated'] = True
                    raise RuntimeError('Combined child log cap reached')
                combined = line_tail + block
                line_tail = combined[-8192:]
                if stop_on_failure and re.search(rb'(?m)^not ok\s+\d+', combined):
                    raise RuntimeError('First failing TAP case observed; stop this chunk')
                return bool(block)
            def sample():
                rows, members, child_rss = tree.observe()
                owned = {row['pid'] for row in members}
                probe_rss = sum(row['rss'] for row in rows.values() if row['ppid'] == os.getpid() and row['pid'] not in owned)
                rss = child_rss + rows[os.getpid()]['rss'] + probe_rss
                used = scratch.sample() + guard.allocated_bytes(rdir)
                host.update_owned(scratch.token, used, rss)
                result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss),
                              peakCombinedBytes=max(result.get('peakCombinedBytes', 0), used))
                if rss > 768 * MIB or used > 128 * MIB:
                    raise RuntimeError('Aggregate RAM/combined disk cap reached')
                if time.monotonic() - started > 120:
                    raise RuntimeError('Follow-up chunk exceeded 120 seconds')
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
            result['processAbsence'] = tree.stop_join()
            while drain():
                pass
            result.update(rc=process.returncode, logBytes=written)
        if process.returncode != 0:
            raise RuntimeError('Focused entry failed; inspect original bounded TAP')
        tap = log.read_text()
        counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', tap, re.M)}
        names = re.findall(r'^# Subtest: (.+)$', tap, re.M)
        result.update(testCounts=counts, testNames=names, logSHA256=sha(log.read_bytes()))
        if counts != {'tests': 11, 'pass': 11, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0} or names != source_plan['selectedCases']:
            raise RuntimeError('Exact selected case names/counts did not pass')
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        # tree.launch may defer cancellation through registration and then raise
        # before the caller's assignment. Recover that owned handle for pipe cleanup.
        if process is None:
            process = tree.process
        try:
            result['processAbsence'] = tree.stop_join(process)
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        if process is not None:
            try:
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
                if drain is not None:
                    # The original with-block may have closed on a first failure.
                    # Reopen only the owned bounded log to preserve reached output.
                    with (rdir / 'test.log').open('ab') as stream:
                        while drain(False):
                            pass
                result['rc'] = process.returncode
            except (OSError, RuntimeError) as error:
                failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
            finally:
                process.stdout.close()
    log = rdir / 'test.log'
    if log.is_file():
        tap = log.read_text(errors='replace')
        result.update(logBytes=log.stat().st_size, logSHA256=sha(log.read_bytes()),
            testCounts={key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', tap, re.M)},
            testNames=re.findall(r'^# Subtest: (.+)$', tap, re.M))
    try:
        proof = tree.proof()
        if not all(proof[key] for key in ['joined', 'pidsAbsent', 'groupsAbsent']):
            raise RuntimeError('No process proof authorises journal retention')
        journal = scratch.root / 'modules.jsonl'
        if journal.exists():
            if journal.is_symlink() or journal.stat().st_size > 2 * MIB:
                raise RuntimeError('Owned module journal shape/cap differs')
            observed = [strict_json(line) for line in journal.read_text().splitlines()]
            if any(row.get('path') not in source_plan['modules'] or row.get('sha256') != source_plan['modules'][row['path']]['sha256'] for row in observed):
                raise RuntimeError('Observed module outside frozen graph')
            os.rename(journal, rdir / 'modules.jsonl')
            result['observedModules'] = sorted(set(row['path'] for row in observed))
            if failure is None and set(result['observedModules']) != set(source_plan['modules']):
                raise RuntimeError('Successful run did not observe the complete frozen source closure')
        elif failure is None:
            raise RuntimeError('Successful run has no module journal')
        admit(args.admission_sha)
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        cleanup = finalizer.finish()
    pins_preserved = False
    try:
        admit(args.admission_sha)
        if sources(source_plan, sg) != source:
            raise RuntimeError('Immutable source readback differs')
        pins_preserved = True
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    passed = failure is None and cleanup['passed'] and pins_preserved and result.get('rc') == 0
    summary = {'identity': identity, 'grant': args.dispatcher_grant, 'passed': passed, 'failure': failure,
               'result': result, 'cleanup': cleanup, 'pinsPreserved': pins_preserved, 'wall': time.monotonic() - started}
    resources.atomic_json(rdir / 'summary.json', summary)
    resources.atomic_json(rdir / 'checkpoint.json', {'state': 'complete' if passed else 'incomplete',
        'summary': str(rdir / 'summary.json'), 'manifest': str(scratch.manifest)})
    print(json.dumps({'run': str(rdir), 'passed': passed, 'failure': failure, 'cleanup': cleanup}))
    if not passed:
        sys.exit(2)


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
    if args.execute and not (args.dispatcher_grant or '').startswith('fucq102-followup-'):
        parser.error('Execution requires the new exact follow-up grant')
    frozen = admit(args.admission_sha)
    environment = {key: value for key, value in os.environ.items() if key in ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_CTYPE', 'TZ']}
    environment.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LC_ALL='C')
    os.environ.clear()
    os.environ.update(environment)
    resources = imported(frozen, 'fucq102_verified_resources', ROOT / '_tools/test_resources.py')
    sg = imported(frozen, 'fucq102_verified_git', ROOT / '_tools/scaffold_git.py')
    guard = imported(frozen, 'fucq102_owned_strict_resources', EVIDENCE / 'followup-entry-resources.py')
    source_plan = strict_json((EVIDENCE / 'followup-entry-execution-source-plan.json').read_bytes())
    source = sources(source_plan, sg)
    admit(args.admission_sha)
    if args.plan:
        print(json.dumps({'status': 'plan-only', 'allocation': 'none', 'modules': len(source_plan['modules']),
            'dataFiles': len(source_plan['files']), 'cases': len(source_plan['selectedCases']), 'frozenNodes': len(frozen['nodes'])}))
        return
    with resources.handled_termination():
        execute(frozen, args, resources, guard, sg, source_plan, source, environment)


if __name__ == '__main__':
    main()
