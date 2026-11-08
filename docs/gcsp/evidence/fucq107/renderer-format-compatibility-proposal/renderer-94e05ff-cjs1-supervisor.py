"""Unexecuted FUCQ-107 renderer9 proposal; exact external review is required.

No custom imports, ledger access, scratch or child before complete admission.
Shared test_resources remains unchanged; its permissive lifecycle is never used.
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

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-085')
OUT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107')
PREFIX = 'renderer-94e05ff-cjs1-'
MIB = 1024 ** 2
SOURCE_COMMIT = '94e05ff9070aa19f5deb3e9997dfed96cc268473'


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
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=sha(data))
    if 'entries' in expected:
        row['entries'] = sorted(item.name for item in path.iterdir())
    if row != expected:
        raise RuntimeError('Frozen physical/content identity differs: ' + str(path))


def admit(expected_sha):
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use /usr/bin/python3 -I -B')
    data = (OUT / (PREFIX + 'admission.json')).read_bytes()
    if sha(data) != expected_sha:
        raise RuntimeError('Admission SHA differs from exact reviewed command')
    plan = strict_json(data)
    if plan['sourceCommit'] != SOURCE_COMMIT or plan['sourceFiles'] != 22 or plan['expectedCases'] != 9:
        raise RuntimeError('Renderer9 source boundary differs')
    if plan['pythonExecutable'] != sys.executable or plan['pythonVersion'] != sys.version:
        raise RuntimeError('Running interpreter differs')
    if Path.cwd() != ROOT or not ROOT.is_dir():
        raise RuntimeError('Run only in the owned worktree')
    for name, expected in plan['nodes'].items():
        physical(Path(name), expected)
    for path in plan['absentPaths']:
        if os.path.lexists(path):
            raise RuntimeError('Frozen absent resolution candidate appeared: ' + path)
    for variable, expected in plan['environment'].items():
        if not isinstance(variable, str) or not isinstance(expected, str):
            raise RuntimeError('Environment schema differs')
    return plan


def imported(plan, name, path):
    expected = plan['nodes'][str(path)]
    physical(path, expected)
    data = path.read_bytes()
    if sha(data) != expected['sha256']:
        raise RuntimeError('Helper drift before import')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


def source_audit(source, sg):
    for row in source['rows']:
        data = (ROOT / row['path']).read_bytes()
        rc, content, error = sg.git(ROOT, ['show', SOURCE_COMMIT + ':' + row['path']])
        if rc != 0 or content.encode() != data or len(data) != row['bytes'] or sha(data) != row['sha256']:
            raise RuntimeError('Immutable/current source differs: ' + row['path'])
    return {'sourceCommit': SOURCE_COMMIT, 'files': len(source['rows']), 'unchanged': True}


def report_tests(dest, source):
    data = (dest / 'output.log').read_bytes()
    text = data.decode('utf-8', errors='strict')
    names = re.findall(r'^(?:not )?ok \d+ - (.*)$', text, re.M)
    counts = {}
    for match in re.finditer(r'^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', text, re.M):
        if match[1] in counts:
            raise RuntimeError('Duplicate TAP count')
        counts[match[1]] = int(match[2])
    expected = {'tests': 9, 'suites': 0, 'pass': 9, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    if counts != expected or names != source['expectedNames'] or re.search(r'^not ok|^Bail out!|# (?:SKIP|TODO)', text, re.M):
        raise RuntimeError('Original TAP does not prove all exact renderer9 cases')
    journal_bytes = (dest / 'modules.jsonl').read_bytes()
    journal = [strict_json(line) for line in journal_bytes.splitlines()]
    dependencies = strict_json((OUT / (PREFIX + 'dependencies.json')).read_bytes())
    wanted = {row['url']: row['sha256'] for row in source['rows'] if row['kind'] == 'module'}
    dependency = {Path(row['path']).as_uri(): row for row in dependencies['files']}
    formats = strict_json((OUT / (PREFIX + 'formats.json')).read_bytes())
    hints = {Path(row['path']).as_uri(): row for row in formats['rows']}
    if len(hints) != len(formats['rows']) or len(hints) != 205:
        raise RuntimeError('Reviewed finite CommonJS hints differ')
    def format_permitted(row):
        if set(row) != {'kind', 'url', 'sha256', 'bytes', 'format', 'inputFormat', 'formatHint'}:
            return False
        incoming = row['inputFormat']
        nullish = incoming in [{'type': 'undefined'}, {'type': 'null'}]
        if not nullish and incoming not in [{'type': 'string', 'value': value} for value in ['module', 'commonjs', 'json']]:
            return False
        if row['format'] not in ['module', 'commonjs', 'json']:
            return False
        hint = hints.get(row['url'])
        if hint is None:
            return row['formatHint'] is None
        return (row['kind'] == 'dependency-load' and row['sha256'] == hint['sha256'] and row['bytes'] == hint['bytes']
            and hint['format'] == row['format'] == 'commonjs'
            and (row['formatHint'] == 'commonjs' if nullish else
                incoming == {'type': 'string', 'value': 'commonjs'} and row['formatHint'] is None))
    roots = sorted((row['path'] for row in dependencies['packages']), key=len, reverse=True)
    def package(url):
        return next((root for root in roots if url.startswith(Path(root).as_uri() + '/')), None)
    def permitted(row):
        parent, specifier, target = row['parentURL'], row['specifier'], row.get('url')
        if parent not in dependency:
            return False
        if row['kind'] == 'optional-miss':
            name = '/'.join(specifier.split('/')[:2]) if specifier.startswith('@') else specifier.split('/')[0]
            return row['code'] in ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'] and any(edge['from'] == package(parent)
                and edge['name'] == name and not edge['required'] and edge['target'] is None for edge in dependencies['resolutionEdges'])
        if target.startswith('node:'):
            return specifier == target or 'node:' + specifier == target
        if target not in dependency:
            return False
        if specifier.startswith(('.', '/', 'file:')):
            return package(parent) == package(target)
        name = '/'.join(specifier.split('/')[:2]) if specifier.startswith('@') else specifier.split('/')[0]
        if any(row['path'] == package(parent) and row['name'] == name for row in dependencies['packages']):
            return package(parent) == package(target)
        return any(edge['from'] == package(parent) and edge['name'] == name and edge['target'] == package(target)
            for edge in dependencies['resolutionEdges'])
    loads = {row['url']: row['sha256'] for row in journal if row['kind'] == 'application-load'}
    paths = {row['path']: row['url'] for row in source['rows']}
    wanted_edges = {(paths[edge['from']], edge['specifier'], edge['to'] if edge['to'].startswith(('node:', 'file:')) else paths[edge['to']]) for edge in source['edges']}
    edges = {(row['parentURL'], row['specifier'], row['url']) for row in journal if row['kind'] == 'application-resolution'}
    if loads != wanted or edges != wanted_edges:
        raise RuntimeError('Original module journal differs from exact renderer source graph')
    for row in journal:
        kind = row['kind']
        if kind in ['application-load', 'dependency-load']:
            expected_row = next((value for value in source['rows'] if value['url'] == row['url'] and value['kind'] == 'module'), None) if kind == 'application-load' else dependency.get(row['url'])
            if (not expected_row or row['sha256'] != expected_row['sha256'] or row['bytes'] != expected_row['bytes']
                or not format_permitted(row) or kind == 'application-load' and row['format'] != 'module'):
                raise RuntimeError('Unlisted/changed executable load')
        elif kind in ['dependency-resolution', 'optional-miss']:
            if not permitted(row):
                raise RuntimeError('Dependency resolve/miss differs from reviewed inventory')
        elif kind == 'application-resolution':
            if (row['parentURL'], row['specifier'], row['url']) not in wanted_edges:
                raise RuntimeError('Unlisted application resolution')
        else:
            raise RuntimeError('Refused or unknown loader journal event')
    dependency_loads = {row['url'] for row in journal if row['kind'] == 'dependency-load'}
    if Path(dependencies['entry']).as_uri() not in dependency_loads:
        raise RuntimeError('Exact JSDOM dependency entry was not observed')
    return {'counts': counts, 'names': names, 'applicationModules': len(loads), 'edges': len(edges),
            'dependencyModules': len(dependency_loads),
            'output': {'bytes': len(data), 'sha256': sha(data)},
            'journal': {'bytes': len(journal_bytes), 'sha256': sha(journal_bytes)}}

def execute(frozen, args, tr, guard, sg, source, environment):
    started = time.monotonic()
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 384, 'chunk_scratch_mib': 128,
                        'log_mib': 2, 'reserve_free_gib': 5, 'ram_reserve_mib': 512})
    dest = OUT / ('renderer9-' + uuid.uuid4().hex)
    # Scratch construction establishes the absolute root; finalizer registration
    # precedes retained-directory creation, ledger mutation and scratch creation.
    scratch = guard.make_scratch(tr, dest, ROOT, policy)
    lock = frozen['nodes'][str(Path(frozen['ledgerDirectory']) / 'reservations.lock')]
    host = guard.make_budget(tr, policy, frozen['ledgerDirectory'], [lock['device'], lock['inode']])
    tree = guard.ProcessTree(tr, scratch)
    finalizer = guard.Finalizer(tr, scratch, tree, host)
    result, failure, process = {}, None, None
    try:
        tr.atomic_json(scratch.manifest, scratch.record)
        tr.atomic_json(dest / 'plan.json', {'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant,
            'sourceCommit': SOURCE_COMMIT, 'command': frozen['commands']['child'], 'limits': frozen['limits'],
            'identityBefore': source_audit(source, sg), 'environment': environment,
            'retainedChargedRoot': str(OUT), 'manifest': str(scratch.manifest), 'owner': scratch.record['owner']})
        tr.atomic_json(dest / 'checkpoint.json', {'state': 'incomplete', 'selected': source['tests']})
        host.acquire_owned(scratch, guard.allocated_bytes(OUT))
        scratch.__enter__()
        admit(args.admission_sha)
        journal = dest / 'modules.jsonl'
        journal.touch(exist_ok=False)
        env = scratch.env(environment)
        env['FUCQ107_MODULE_JOURNAL'] = str(journal)
        written = 0
        with (dest / 'output.log').open('xb') as stream:
            process = tree.launch(frozen['commands']['child'], cwd=ROOT, env=env,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            tree.register(process)
            os.set_blocking(process.stdout.fileno(), False)

            def drain():
                nonlocal written
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = 2 * MIB - journal.stat().st_size - written
                if room < 0:
                    raise RuntimeError('Combined original log/journal cap reached')
                stream.write(block[:room])
                stream.flush()
                written += min(room, len(block))
                if len(block) > room:
                    raise RuntimeError('Combined original log/journal cap reached')
                return bool(block)

            def sample():
                rows, members, child_rss = tree.observe()
                owned = {row['pid'] for row in members}
                probe_rss = sum(row['rss'] for row in rows.values() if row['ppid'] == os.getpid() and row['pid'] not in owned)
                rss = child_rss + rows[os.getpid()]['rss'] + probe_rss
                used = scratch.sample() + guard.allocated_bytes(OUT)
                host.update_owned(scratch.token, used, rss)
                result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss),
                              peakCombinedBytes=max(result.get('peakCombinedBytes', 0), used))
                if rss > 384 * MIB or used > 128 * MIB - 128 * 1024:
                    raise RuntimeError('Aggregate RAM/combined disk cap reached')
                if written + journal.stat().st_size > 2 * MIB:
                    raise RuntimeError('Combined original log/journal cap reached')
                if time.monotonic() - started > 120:
                    raise RuntimeError('Renderer9 chunk exceeded120seconds')
                if guard.shutil.disk_usage(scratch.root).free < 5 * 1024 ** 3:
                    raise RuntimeError('Host5GiB disk emergency reserve reached')

            sample()
            # Recheck every reviewed executable/helper/source before gate open.
            admit(args.admission_sha)
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
            raise RuntimeError('Renderer9 failed; no repair/retry authorised')
        result['tests'] = report_tests(dest, source)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        try:
            result['processAbsence'] = tree.stop_join()
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        process = tree.process
        if process is not None:
            try:
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
                if process.stdout:
                    process.stdout.close()
            except OSError as error:
                failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        cleanup = finalizer.finish()
    pins_preserved = False
    try:
        admit(args.admission_sha)
        result['identityAfter'] = source_audit(source, sg)
        pins_preserved = True
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    passed = failure is None and cleanup['passed'] and pins_preserved and result.get('rc') == 0
    summary = {'schemaVersion': 1, 'story': 'FUCQ-107', 'scope': 'renderer9-only',
        'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant, 'sourceCommit': SOURCE_COMMIT,
        'passed': passed, 'failure': failure, 'result': result, 'cleanup': cleanup, 'pinsPreserved': pins_preserved,
        'manifest': str(scratch.manifest), 'ownedRoot': str(scratch.root), 'owner': scratch.record['owner'],
        'wall': time.monotonic() - started, 'allStoryRetainedBytes': guard.allocated_bytes(OUT)}
    tr.atomic_json(dest / 'summary.json', summary)
    tr.atomic_json(dest / 'checkpoint.json', {'state': 'complete' if passed else 'incomplete',
        'summary': str(dest / 'summary.json'), 'manifest': str(scratch.manifest)})
    if guard.allocated_bytes(OUT) > 128 * MIB:
        summary.update(passed=False, failure={'type': 'ResourceError', 'message': 'Final retained cap exceeded'})
        tr.atomic_json(dest / 'summary.json', summary)
    print(json.dumps({'run': str(dest), 'passed': summary['passed'], 'failure': summary['failure'], 'cleanup': cleanup}))
    if not summary['passed']:
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--admission-sha', required=True)
    parser.add_argument('--dispatcher-grant', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.admission_sha) or not args.dispatcher_grant.startswith('fucq107-renderer9-'):
        parser.error('Supply the exact reviewed admission SHA and new renderer9 grant')
    frozen = admit(args.admission_sha)
    environment = dict(frozen['environment'])
    os.environ.clear()
    os.environ.update(environment)
    tr = imported(frozen, 'fucq107_verified_resources', ROOT / '_tools/test_resources.py')
    sg = imported(frozen, 'fucq107_verified_git', ROOT / '_tools/scaffold_git.py')
    guard = imported(frozen, 'fucq107_owned_strict_resources', OUT / (PREFIX + 'resources.py'))
    source = strict_json((OUT / (PREFIX + 'source.json')).read_bytes())
    source_audit(source, sg)
    admit(args.admission_sha)
    with tr.handled_termination():
        execute(frozen, args, tr, guard, sg, source, environment)


if __name__ == '__main__':
    main()
