"""Admitted FUCQ-103 scoped checks. Standard-library admission precedes custom imports.

Only the frozen eligibility modes are executable here. Historical receipts remain
unchanged. --plan checks bytes only; --execute requires external SHA/revision/grant.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import types
import uuid
import json

project = Path(__file__).resolve().parents[4]
here = Path(__file__).resolve().parent
checks = {
    'eligibility-core': ['server/test/gcsp-greg-driver-eligibility.test.js', 'server/test/gcsp-greg-demand.test.js'],
    'eligibility-default': ['server/test/gcsp-runtime-publication.test.js'],
    'eligibility-weighted': ['server/test/gcsp-runtime-publication.test.js'],
    'eligibility-runtime': ['server/test/gcsp-runtime-publication.test.js'],
    'eligibility-publish': ['server/test/gcsp-greg-publish.test.js'],
    'eligibility-activation': ['server/test/gcsp-policy-activation.test.js', 'server/test/gcsp-greg-publish-http.test.js'],
    'eligibility-editor': ['server/test/gcsp-greg-publish-editor.test.js'],
    'eligibility-dashboard': ['server/test/gcsp-greg-dashboard-data.test.js'],
    'eligibility-registry': ['server/test/gcsp-policy-consumer-adoption.test.js', 'server/test/gcsp-policy-adoption.test.js', 'server/test/gcsp-policy-learning-adoption.test.js'],
}
MIB = 1024 ** 2


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate admission JSON key: ' + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError('Nonstandard admission JSON constant: ' + value)
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def anchor(path):
    value = path.lstat()
    if path.is_symlink() or not (stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode)):
        raise RuntimeError('Host accounting anchor is not physical')
    return {'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
            'kind': 'directory' if stat.S_ISDIR(value.st_mode) else 'file', 'resolved': str(path.resolve(strict=True))}


def dependency_entries(roots):
    entries = {}
    for absolute in roots:
        root = Path(absolute)
        for path in (root, *root.parents):
            if not stat.S_ISDIR(path.lstat().st_mode):
                raise RuntimeError('Dependency ancestor must be a physical directory')
        entries[str(root)] = 'directory'
        pending = [root]
        while pending:
            folder = pending.pop()
            with os.scandir(folder) as scan:
                children = sorted(scan, key=lambda item: item.name)
            for child in children:
                mode = child.stat(follow_symlinks=False).st_mode
                if stat.S_ISDIR(mode):
                    entries[child.path] = 'directory'
                    pending.append(Path(child.path))
                elif stat.S_ISREG(mode):
                    entries[child.path] = 'file'
                else:
                    raise RuntimeError('Dependency symlink or special entry is not admitted')
    return dict(sorted(entries.items()))


def admit(expected):
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use the pinned Python with -I -B')
    data = (here / 'eligibility-combined-source-plan.json').read_bytes()
    if sha(data) != expected:
        raise RuntimeError('Source-plan SHA differs from the external reviewed command')
    plan = strict_json(data)
    if plan['executables']['python']['path'] != sys.executable:
        raise RuntimeError('Running Python differs from the admitted interpreter')
    loaded = {}
    for relative, expected_hash in plan['sources'].items():
        path = project / relative
        if Path(relative).is_absolute() or '..' in Path(relative).parts or project not in path.resolve().parents:
            raise RuntimeError('Source path escapes the worktree')
        data = path.read_bytes()
        if sha(data) != expected_hash:
            raise RuntimeError('Admitted source differs: ' + relative)
        loaded[relative] = data
    required = {'_tools/test_resources.py', '_tools/scaffold_git.py', str(Path(__file__).relative_to(project)),
                'docs/gcsp/evidence/fucq103/scoped-resources.py', 'docs/gcsp/evidence/fucq103/scoped-test-launch.mjs'}
    if not required <= loaded.keys():
        raise RuntimeError('Source plan omits an executable helper')
    dependencies = plan['dependencies']
    entries = dependency_entries(dependencies['roots'])
    if entries != dependencies['entries']:
        raise RuntimeError('Installed file/directory membership differs')
    members = {name for name, kind in entries.items() if kind == 'file'}
    declared = {name for name in dependencies['sources']
                if any(Path(base) in Path(name).parents for base in dependencies['roots'])}
    if members != declared:
        raise RuntimeError('Installed dependency membership differs')
    for absolute in dependencies['resolverAbsences']:
        if os.path.lexists(absolute):
            raise RuntimeError('Unadmitted package resolution candidate exists: ' + absolute)
    for absolute, identity in dependencies['resolverSearchDirectories'].items():
        if anchor(Path(absolute)) != identity:
            raise RuntimeError('Package resolution directory identity differs')
    for absolute, expected_hash in dependencies['sources'].items():
        if sha(Path(absolute).read_bytes()) != expected_hash:
            raise RuntimeError('Installed dependency differs')
    for relative, expected_members in plan['directoryResources'].items():
        members = sorted(str(path.relative_to(project)) for path in (project / relative).rglob('*') if path.is_file())
        if members != expected_members:
            raise RuntimeError('Source directory membership differs: ' + relative)
    for name, item in plan['executables'].items():
        if sha(Path(item['path']).read_bytes()) != item['sha256']:
            raise RuntimeError('Admitted executable differs: ' + name)
    for name, expected_anchor in plan['hostBudget']['anchors'].items():
        if anchor(Path(name)) != expected_anchor:
            raise RuntimeError('Host accounting anchor differs')
    if any(os.path.lexists(project / name) for name in ('node_modules', 'server/node_modules')):
        raise RuntimeError('Worktree dependency resolution must remain absent; use the owned mirror')
    if set(checks) != {chunk['mode'] for chunk in plan['chunks']}:
        raise RuntimeError('Selected modes differ')
    return plan, loaded


def imported(loaded, relative, name):
    data = loaded[relative]
    # Execute exactly the already admitted bytes; never reopen via an import loader.
    module = types.ModuleType(name)
    module.__file__ = str(project / relative)
    sys.modules[name] = module
    exec(compile(data, module.__file__, 'exec'), module.__dict__)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=sorted(checks))
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--plan', action='store_true')
    action.add_argument('--execute', action='store_true')
    parser.add_argument('--source-plan-sha', required=True)
    parser.add_argument('--revision')
    parser.add_argument('--dispatcher-grant')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.source_plan_sha):
        parser.error('Supply the externally admitted source-plan SHA')
    if args.execute and (not re.fullmatch('[a-f0-9]{40}', args.revision or '')
                         or not (args.dispatcher_grant or '').startswith('fucq103-' + args.mode + '-')):
        parser.error('Execution needs the exact reviewed revision and a new grant for this mode')
    plan, loaded = admit(args.source_plan_sha)
    chunk = next(item for item in plan['chunks'] if item['mode'] == args.mode)
    command = [plan['executables']['node']['path'], '--test', '--test-concurrency=1']
    if chunk.get('namePattern'):
        command.append('--test-name-pattern=' + chunk['namePattern'])
    command.extend(checks[args.mode])
    if command != chunk['command'] or checks[args.mode] != chunk['tests']:
        raise RuntimeError('Selected command differs from the admitted graph')
    if args.plan:
        print(json.dumps({'state': 'plan-only', 'sourcePlanSHA256': args.source_plan_sha, 'chunk': chunk,
                          'customImports': 0, 'scratchAllocations': 0, 'testRuns': 0}))
        return
    # Closed allowlist removes every inherited loader/native/database/debug family.
    environment = {key: value for key, value in os.environ.items()
                   if key in ('USER', 'LOGNAME', 'LANG', 'LC_CTYPE', 'TZ')}
    environment.update(HOME=plan['dependencies']['resolverHome'], PATH='/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL='C', PYTHONDONTWRITEBYTECODE='1', SCAFFOLDING_HARNESS='codex')
    os.environ.clear()
    os.environ.update(environment)
    resources = imported(loaded, '_tools/test_resources.py', 'fucq103_admitted_resources')
    git = imported(loaded, '_tools/scaffold_git.py', 'fucq103_admitted_git')
    guard = imported(loaded, 'docs/gcsp/evidence/fucq103/scoped-resources.py', 'fucq103_owned_guard')
    for query in (['rev-parse', 'HEAD'], ['rev-parse', '@{upstream}']):
        rc, value, error = git.git(project, query)
        if rc or value.strip() != args.revision:
            raise RuntimeError('Execution revision is not exact published upstream HEAD')
    rc, value, error = git.git(project, ['status', '--porcelain'])
    if rc or value:
        raise RuntimeError('Execution requires a clean owned worktree')
    with resources.handled_termination():
        execute(args, plan, loaded, chunk, command, environment, resources, guard)


def execute(args, plan, loaded, chunk, command, environment, resources, guard):
    shared = Path(plan['resourceContract']['sharedOutput'])
    run = 'fucq103-backend-' + uuid.uuid4().hex
    retained = shared / 'fucq103-backend' / run
    policy = resources.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 1024, 'chunk_seconds': 120, 'log_mib': 2,
                               'reserve_free_gib': 5, 'ram_reserve_mib': 512, 'preferred_free_gib': 30})
    if policy.reserve != plan['hostBudget']['emergencyReserveBytes'] or int(policy.ram_reserve_mib * MIB) != plan['hostBudget']['ramReserveBytes']:
        raise RuntimeError('Resource helper reserve differs from explicit admission')
    scratch = guard.make_scratch(resources, shared, project, policy)
    scratch.manifest = shared / 'ownership' / (run + '-manifest.json')
    scratch.record.update(run=run, retainedRoot=str(retained), sourcePlanSHA256=args.source_plan_sha,
                          grant=args.dispatcher_grant, revision=args.revision, command=command)
    budget = guard.Budget(resources, policy, plan['hostBudget'])
    tree = guard.Tree(resources, scratch)
    finalizer = guard.Finalizer(resources, scratch, tree, budget)
    # External manifest and finalizer precede the reservation, scratch and retained root.
    resources.atomic_json(scratch.manifest, scratch.record)
    result, failure, process = {}, None, None
    started = time.monotonic()
    try:
        budget.acquire(scratch, scratch.manifest.stat().st_size)
        retained.mkdir(parents=True, exist_ok=False)
        resources.atomic_json(retained / 'checkpoint.json', {'state': 'incomplete', 'mode': args.mode,
            'sourcePlanSHA256': args.source_plan_sha, 'revision': args.revision, 'manifest': str(scratch.manifest)})
        scratch.__enter__()
        mirror = scratch.root / 'mirror'
        for name, data in loaded.items():
            target = mirror / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (mirror / 'server/node_modules').symlink_to(plan['executionContract']['serverDependencies'], target_is_directory=True)
        admit(args.source_plan_sha)
        launcher = mirror / 'docs/gcsp/evidence/fucq103/scoped-test-launch.mjs'
        launch = [command[0], str(launcher), *command[1:]]
        log = scratch.root / 'test.log'
        written = 0
        with log.open('xb') as stream:
            with guard.creation_window(scratch.record):
                process = subprocess.Popen(launch, cwd=mirror, env=scratch.env(environment), stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
                tree.register(process)
            os.set_blocking(process.stdout.fileno(), False)
            def drain():
                nonlocal written
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = 2 * MIB - written
                stream.write(block[:room]); stream.flush()
                written += min(room, len(block))
                if len(block) > room:
                    raise RuntimeError('Child log cap exceeded')
                return bool(block)
            def sample():
                rows, members = tree.observe()
                tree.sample_ports(members)
                owned = {row['pid'] for row in members}
                rss = sum(row['rss'] for row in members) + rows[os.getpid()]['rss'] + sum(
                    row['rss'] for row in rows.values() if row['ppid'] == os.getpid() and row['pid'] not in owned)
                used = scratch.sample() + guard.allocated_bytes(retained) + scratch.manifest.stat().st_size
                budget.update(scratch.token, used, rss)
                result.update(peakAggregateRSS=max(result.get('peakAggregateRSS', 0), rss),
                              peakCombinedBytes=max(result.get('peakCombinedBytes', 0), used))
                if rss > 1024 * MIB or used > 128 * MIB or time.monotonic() - started > 120:
                    raise RuntimeError('Aggregate RAM/disk/time budget exceeded')
                if guard.shutil.disk_usage(scratch.root).free < plan['hostBudget']['emergencyReserveBytes']:
                    raise RuntimeError('Host emergency disk reserve reached')
            sample()
            process.stdin.write(b'1'); process.stdin.flush(); process.stdin.close()
            while True:
                drain()
                if process.poll() is not None:
                    break
                sample()
                time.sleep(0.1)
            proof = tree.stop_join()
            while drain():
                pass
            result.update(rc=process.returncode, logBytes=written, processAbsence=proof)
        transcript = log.read_text(errors='replace')
        count = re.search(r'^(?:# |ℹ )pass\s+(\d+)', transcript, re.M)
        result['matchedTestCount'] = int(count.group(1)) if count else None
        result['summary'] = transcript[-12000:] if process.returncode else '\n'.join(
            line for line in transcript.splitlines() if re.match(r'^(?:# |ℹ )(?:tests|pass|fail|skipped|duration)', line))
        if process.returncode != 0 or result['matchedTestCount'] != chunk['expectedMatchedTests']:
            raise RuntimeError('Scoped test failure or unexpected matched-test count')
        admit(args.source_plan_sha)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    finally:
        try:
            process = process or tree.process
            if process is not None:
                tree.retain_direct(process)
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
                if process.stdout:
                    process.stdout.close()
        except BaseException as error:
            failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
        finally:
            def preserve_output():
                log = scratch.root / 'test.log'
                if not os.path.lexists(log):
                    result['retainedTestLog'] = {'state': 'not-created'}
                    return
                fd = os.open(log, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as source:
                    identity = os.fstat(source.fileno())
                    if not stat.S_ISREG(identity.st_mode) or identity.st_size > 2 * MIB:
                        raise RuntimeError('Owned original log is not a bounded regular file')
                    data = source.read(2 * MIB + 1)
                    if len(data) != identity.st_size:
                        raise RuntimeError('Original bounded log changed during retention')
                receipt_headroom = plan['resourceContract']['retainedReceiptHeadroomKiB'] * 1024
                before = scratch.sample() + guard.allocated_bytes(retained) + scratch.manifest.stat().st_size
                if before + len(data) + receipt_headroom > 128 * MIB:
                    raise RuntimeError('Full original log and receipt headroom exceed combined budget')
                destination = retained / 'test.log'
                with destination.open('xb') as output:
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                digest = sha(data)
                if destination.stat().st_size != len(data) or sha(destination.read_bytes()) != digest:
                    raise RuntimeError('Original log retention readback differs')
                result['retainedTestLog'] = {'path': str(destination), 'byteCount': len(data),
                    'sha256': digest, 'entireBoundedOriginal': True, 'truncated': False}
                used = scratch.sample() + guard.allocated_bytes(retained) + scratch.manifest.stat().st_size
                budget.update(scratch.token, used, result.get('peakAggregateRSS', 0))
                result['peakCombinedBytes'] = max(result.get('peakCombinedBytes', 0), used)
            cleanup = finalizer.finish(preserve_output)
    preserved = False
    try:
        admit(args.source_plan_sha)
        preserved = True
    except BaseException as error:
        failure = failure or {'type': type(error).__name__, 'message': str(error)[:1024]}
    passed = failure is None and cleanup['passed'] and preserved and result.get('rc') == 0
    summary = {'run': run, 'scope': 'scoped', 'revision': args.revision, 'grant': args.dispatcher_grant,
               'sourcePlanSHA256': args.source_plan_sha, 'chunk': chunk, 'passed': passed,
               'failure': failure, 'result': result, 'cleanup': cleanup, 'sourcesPreserved': preserved,
               'impactMap': plan['impactMap'], 'exclusions': plan['excluded'],
               'environmentSHA256': sha(json.dumps(environment, sort_keys=True).encode()), 'wallSeconds': time.monotonic() - started}
    summary_path = shared / 'ownership' / (run + '-summary.json')
    resources.atomic_json(summary_path, summary)
    if retained.is_dir():
        resources.atomic_json(retained / 'checkpoint.json', {'state': 'complete' if passed else 'incomplete',
            'summary': str(summary_path), 'manifest': str(scratch.manifest)})
    impact_path = shared / 'impact' / (args.source_plan_sha + '-' + args.mode + '.json')
    if passed:
        resources.atomic_json(impact_path, {
            'sourcePlanSHA256': args.source_plan_sha, 'mode': args.mode, 'summary': str(summary_path),
            'functions': plan['impactMap'], 'coverage': 'Reviewed finite imports/callers; no measured per-test coverage.'})
    log_path = retained / 'test.log'
    original_log_bytes = max(log_path.stat().st_size, log_path.stat().st_blocks * 512) if log_path.is_file() else 0
    retained_bytes = guard.allocated_bytes(retained) + summary_path.stat().st_size + scratch.manifest.stat().st_size
    if passed:
        retained_bytes += impact_path.stat().st_size
    receipt_bytes = retained_bytes - original_log_bytes
    if receipt_bytes > plan['resourceContract']['retainedReceiptHeadroomKiB'] * 1024 or retained_bytes > 2 * MIB + 256 * 1024:
        passed = False
        summary.update(passed=False, retentionFailure='Retained receipt headroom exceeded; original log preserved')
        resources.atomic_json(summary_path, summary)
        if retained.is_dir():
            resources.atomic_json(retained / 'checkpoint.json', {'state': 'incomplete',
                'summary': str(summary_path), 'manifest': str(scratch.manifest)})
    print(json.dumps({'summary': str(summary_path), 'manifest': str(scratch.manifest), 'passed': passed, 'cleanup': cleanup}))
    if not passed:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
