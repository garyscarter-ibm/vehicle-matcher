"""Unexecuted C4 proposal. Exact independent source/harness review is required.

No custom import, source mirror, ledger mutation or child before admission.
The only selected command is the four-case C4 file. No automatic retry.
"""
import argparse
import base64
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
HERE = Path(__file__).resolve().parent
OUT = ROOT.parents[2] / '.claude/test-runs/fucq122-c4'
MIB = 1024 ** 2
CANDIDATE = 'f179ae6043414a2b07de3edb2b425338299ea37b'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    def constant(value):
        raise ValueError('Nonstandard JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def physical(path, expected):
    value, target = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': target.st_dev, 'targetInode': target.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = path.read_bytes()
        row.update(sha256=sha(data), bytes=len(data))
    if row != {key: value for key, value in expected.items() if key != 'realpath'}:
        raise RuntimeError('Frozen physical/content identity differs: ' + str(path))


def admit(expected_sha):
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned checkout')
    data = (HERE / 'case-release-admission.json').read_bytes()
    if sha(data) != expected_sha:
        raise RuntimeError('Exact reviewed admission SHA differs')
    frozen = strict_json(data)
    if frozen['root'] != str(ROOT) or frozen['output'] != str(OUT) \
            or frozen['pythonExecutable'] != sys.executable or frozen['pythonVersion'] != sys.version:
        raise RuntimeError('Frozen execution location/interpreter differs')
    if frozen['limits'] != {'seconds': 120, 'rssMiB': 768, 'scratchAndRetainedMiB': 128, 'logAndJournalMiB': 2, 'workers': 1}:
        raise RuntimeError('C4 finite limits differ')
    for name, expected in frozen['nodes'].items():
        physical(Path(name), expected)
    for name in frozen['absence']:
        if os.path.lexists(name):
            raise RuntimeError('Frozen dependency absence differs')
    source_bytes = (HERE / 'case-release-source-plan.json').read_bytes()
    if sha(source_bytes) != frozen['sourcePlanSHA256']:
        raise RuntimeError('Frozen source plan differs')
    source = strict_json(source_bytes)
    if source['candidate'] != CANDIDATE or source['status'] != 'frozen-for-review' or source['pending'] \
            or source['test'] != 'server/test/gcsp-case-release-http.test.js' or len(source['expectedNames']) != 4:
        raise RuntimeError('C4 source/profile/test contract is incomplete')
    for name, row in source['installed']['files'].items():
        physical(Path(name), row)
    for row in source['installed']['absentOptional']:
        caller = Path(row['caller'])
        if any((ancestor / 'node_modules' / row['name'] / 'package.json').is_file() for ancestor in [caller, *caller.parents]):
            raise RuntimeError('Frozen optional dependency absence differs')
    return frozen, source


def imported(frozen, name, path):
    physical(path, frozen['nodes'][str(path)])
    data = path.read_bytes()
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


def source_audit(source, sg):
    for row in source['rows']:
        data = base64.b64decode(row['base64'], validate=True)
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        rc, out, error = sg.git(ROOT, ['rev-parse', row['ref'] + ':' + row['path']])
        if rc or out.strip() != blob or blob != row['gitBlob'] or sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Immutable source byte/object mismatch: ' + row['path'])
    return {'candidate': source['candidate'], 'profileRef': source['profileRef'], 'testRef': source['testRef'],
            'rows': len(source['rows']), 'verified': True}


def materialize(source, mirror):
    mirror.mkdir()
    for row in source['rows']:
        path = mirror / row['path']
        if not path.is_relative_to(mirror) or '..' in Path(row['path']).parts or Path(row['path']).is_absolute():
            raise RuntimeError('Source mirror path escapes owned scratch')
        path.parent.mkdir(parents=True, exist_ok=True)
        data = base64.b64decode(row['base64'], validate=True)
        if sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Mirror input differs')
        path.write_bytes(data)


def mirror_audit(source, mirror):
    expected = {row['path'] for row in source['rows']}
    actual = set()
    for folder, dirs, files in os.walk(mirror, followlinks=False):
        if any((Path(folder) / name).is_symlink() for name in dirs + files):
            raise RuntimeError('Source mirror contains an unexpected link')
        actual.update(str((Path(folder) / name).relative_to(mirror)) for name in files)
    if actual != expected:
        raise RuntimeError('Source mirror contains undeclared/missing files')
    for row in source['rows']:
        data = (mirror / row['path']).read_bytes()
        if sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Source mirror changed')


def report_tests(dest, source, mirror):
    raw = (dest / 'output.log').read_bytes()
    text = raw.decode('utf-8', errors='strict')
    names = re.findall(r'^(?:not )?ok \d+ - (.*)$', text, re.M)
    counts = {match[1]: int(match[2]) for match in re.finditer(r'^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', text, re.M)}
    if names != source['expectedNames'] or counts != {'tests': 4, 'suites': 0, 'pass': 4, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0} \
            or re.search(r'^not ok|^Bail out!|# (?:SKIP|TODO)', text, re.M):
        raise RuntimeError('Original TAP does not prove the exact four C4 cases')
    data = (dest / 'modules.jsonl').read_bytes()
    journal = [strict_json(line) for line in data.splitlines()]
    urls = {row['path']: (mirror / row['path']).as_uri() for row in source['rows']}
    wanted = {urls[row['path']]: row['sha256'] for row in source['rows'] if row['kind'] == 'module'}
    loads = {row['url']: row['sha256'] for row in journal if row['kind'] == 'application-load'}
    required = [source['test'], 'server/gcsp/runtime.js', 'server/index.js', 'server/gcsp/cases/index.js',
                'server/gcsp/stock/index.js', 'server/gcsp/manual-claims/index.js', 'server/gcsp/offers/buddy-hold.js',
                'server/test/helpers/runtime-composition-profile.js', 'blocks/gcsp/cases/http-adapter.js']
    if any(loads.get(urls[path]) != wanted[urls[path]] for path in required) or any(wanted.get(url) != digest for url, digest in loads.items()):
        raise RuntimeError('Required C4 actual modules were not admitted/loaded')
    if not any(row['kind'] == 'loader-registration' for row in journal):
        raise RuntimeError('Exact loader registration was not observed')
    return {'counts': counts, 'names': names, 'observedApplicationModules': len(loads),
            'declaredModules': len(wanted), 'outputSHA256': sha(raw), 'moduleJournalSHA256': sha(data),
            'installedCoverage': 'Static complete package inventory; no exhaustive CommonJS coverage claim.'}


def execute(frozen, source, args, tr, guard, sg):
    started = time.monotonic()
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128,
                        'log_mib': 2, 'reserve_free_gib': 5, 'ram_reserve_mib': 512})
    dest = OUT / ('case-http-' + uuid.uuid4().hex)
    scratch = guard.make_scratch(tr, dest, ROOT, policy)
    lock = frozen['nodes'][str(Path(frozen['ledgerDirectory']) / 'reservations.lock')]
    host = guard.make_budget(tr, policy, frozen['ledgerDirectory'], [lock['device'], lock['inode']])
    tree = guard.ProcessTree(tr, scratch)
    finalizer = guard.Finalizer(tr, scratch, tree, host)
    result, failure = {}, None
    mirror = scratch.root / 'source'
    try:
        tr.atomic_json(scratch.manifest, scratch.record)
        tr.atomic_json(dest / 'checkpoint.json', {'state': 'incomplete', 'selected': source['expectedNames']})
        tr.atomic_json(dest / 'plan.json', {'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant,
            'sourceBefore': source_audit(source, sg), 'limits': frozen['limits'], 'manifest': str(scratch.manifest),
            'owner': scratch.record['owner'], 'scope': 'actual C4 in-process HTTP; synthetic TEST input; no listener'})
        host.acquire_owned(scratch, guard.allocated_bytes(OUT))
        scratch.__enter__()
        materialize(source, mirror)
        mirror_audit(source, mirror)
        journal = dest / 'modules.jsonl'
        journal.touch(exist_ok=False)
        loader = HERE / 'case-release-loader.mjs'
        entry = mirror / source['test']
        command = ['/usr/bin/python3', '-I', '-B', str(HERE / 'case-release-launch.py'), frozen['node'],
                   '--loader', str(loader), '--test', '--test-reporter=tap', '--test-concurrency=1', str(entry)]
        env = scratch.env(dict(frozen['environment']))
        env.update(FUCQ122_C4_PLAN=str(HERE / 'case-release-source-plan.json'),
                   FUCQ122_C4_PLAN_SHA=frozen['sourcePlanSHA256'], FUCQ122_C4_MIRROR=str(mirror),
                   FUCQ122_C4_JOURNAL=str(journal), FUCQ122_C4_NODE=frozen['node'],
                   FUCQ122_C4_NODE_SHA=frozen['nodes'][frozen['node']]['sha256'], FUCQ122_C4_LOADER=str(loader),
                   FUCQ122_C4_LOADER_SHA=frozen['nodes'][str(loader)]['sha256'], FUCQ122_C4_ENTRY=str(entry))
        written, tail = 0, b''
        with (dest / 'output.log').open('xb') as stream:
            # launch() owns/retains its Popen handle inside deferred cancellation;
            # no local assignment/registration gap can orphan a gated child.
            process = tree.launch(command, cwd=ROOT, env=env, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            tree.register(process)
            os.set_blocking(process.stdout.fileno(), False)

            def drain():
                nonlocal written, tail
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = 2 * MIB - journal.stat().st_size - written
                if room < 0:
                    raise RuntimeError('Combined C4 log/journal cap reached')
                stream.write(block[:room]); stream.flush()
                written += min(room, len(block))
                if len(block) > room:
                    raise RuntimeError('Combined C4 log/journal cap reached')
                tail = (tail + block)[-131072:]
                if re.search(rb'(?m)^not ok|^Bail out!', tail):
                    raise RuntimeError('First original TAP failure; stop without retry')
                return bool(block)

            def sample():
                rows, members, child_rss = tree.observe()
                owned = {row['pid'] for row in members}
                probe_rss = sum(row['rss'] for row in rows.values() if row['ppid'] == os.getpid() and row['pid'] not in owned)
                rss = rows[os.getpid()]['rss'] + child_rss + probe_rss
                used = scratch.sample() + guard.allocated_bytes(OUT)
                host.update_owned(scratch.token, used, rss)
                result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss),
                              peakScratchAndRetainedBytes=max(result.get('peakScratchAndRetainedBytes', 0), used))
                if rss > 768 * MIB or used > 128 * MIB - 128 * 1024 or written + journal.stat().st_size > 2 * MIB:
                    raise RuntimeError('C4 aggregate resource cap reached')
                if time.monotonic() - started > 120 or guard.shutil.disk_usage(scratch.root).free < 5 * 1024 ** 3:
                    raise RuntimeError('C4 wall/disk emergency bound reached')

            sample()
            admit(args.admission_sha)
            mirror_audit(source, mirror)
            process.stdin.write(b'1'); process.stdin.flush(); process.stdin.close()
            while True:
                drain(); sample()
                if process.poll() is not None:
                    break
                time.sleep(0.05)
            result['processAbsence'] = tree.stop_join()
            while drain():
                pass
            result.update(rc=process.returncode, logBytes=written, command=command)
        if result['rc'] != 0:
            raise RuntimeError('C4 selected command failed; no retry authorised')
        mirror_audit(source, mirror)
        result['tests'] = report_tests(dest, source, mirror)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        try:
            result['processAbsence'] = tree.stop_join()
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        process = tree.process
        if process is not None:
            for pipe in [process.stdin, process.stdout]:
                if pipe is not None:
                    try:
                        pipe.close()
                    except OSError:
                        failure = failure or {'type': 'OSError', 'message': 'Owned child pipe close failed'}
        cleanup = finalizer.finish()
    preserved = False
    try:
        admit(args.admission_sha)
        result['sourceAfter'] = source_audit(source, sg)
        preserved = True
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    summary = {'story': 'FUCQ-122', 'scope': 'C4 actual release/case HTTP; labelled synthetic TEST input',
               'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant,
               'passed': failure is None and cleanup['passed'] and preserved and result.get('rc') == 0,
               'failure': failure, 'result': result, 'cleanup': cleanup, 'pinsPreserved': preserved,
               'manifest': str(scratch.manifest), 'ownedRoot': str(scratch.root), 'owner': scratch.record['owner'],
               'wallSeconds': time.monotonic() - started}
    tr.atomic_json(dest / 'summary.json', summary)
    tr.atomic_json(dest / 'checkpoint.json', {'state': 'complete' if summary['passed'] else 'incomplete', 'summary': str(dest / 'summary.json')})
    if guard.allocated_bytes(OUT) > 128 * MIB:
        summary.update(passed=False, failure={'type': 'ResourceError', 'message': 'Final retained cap exceeded'})
        tr.atomic_json(dest / 'summary.json', summary)
    print(json.dumps({'run': str(dest), 'passed': summary['passed'], 'failure': summary['failure'], 'cleanup': cleanup}))
    if not summary['passed']:
        raise SystemExit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--admission-sha', required=True)
    parser.add_argument('--dispatcher-grant', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.admission_sha) or not re.fullmatch('fucq122-c4-[A-Za-z0-9_-]+', args.dispatcher_grant):
        parser.error('Supply the exact reviewed admission SHA and new C4 dispatcher grant')
    frozen, source = admit(args.admission_sha)
    os.environ.clear(); os.environ.update(frozen['environment'])
    tr = imported(frozen, 'fucq122_c4_shared_resources', ROOT / '_tools/test_resources.py')
    sg = imported(frozen, 'fucq122_c4_git', ROOT / '_tools/scaffold_git.py')
    guard = imported(frozen, 'fucq122_c4_owned_resources', HERE / 'case-release-resources.py')
    source_audit(source, sg)
    with tr.handled_termination():
        execute(frozen, source, args, tr, guard, sg)


if __name__ == '__main__':
    main()
