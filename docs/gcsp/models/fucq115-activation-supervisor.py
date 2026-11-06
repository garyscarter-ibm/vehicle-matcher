"""Existing-artifact activation proposal; no execution without a new exact grant."""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / 'docs/gcsp/models'
spec = importlib.util.spec_from_file_location('fucq115_canonical_supervisor', MODELS / 'fucq115-canonical-supervisor.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
tr, sg, sha = common.tr, common.sg, common.sha
PLAN_SHA = 'f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa'
COMBINED = 128 * tr.MIB
RETAINED = 2 * tr.MIB


def dependency_identity():
    identities = []
    for path in [common.DEPENDENCIES, common.DEPENDENCIES / 'pg', common.DEPENDENCIES / 'pg/package.json']:
        followed, link = path.stat(), path.lstat()
        identities.append({'path': str(path), 'resolved': str(path.resolve()), 'device': followed.st_dev,
                           'inode': followed.st_ino, 'linkDevice': link.st_dev, 'linkInode': link.st_ino,
                           'sha256': sha(path) if path.is_file() else None})
    return identities


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--execute', action='store_true')
    parser.add_argument('--dispatcher-grant')
    args = parser.parse_args()
    if args.execute and not args.dispatcher_grant:
        parser.error('--execute requires the exact reviewed continuation grant')
    assert not os.path.lexists(ROOT / 'server/node_modules'), 'Worktree dependency link must be absent'
    plan_path = MODELS / 'fucq115-activation-source-plan.json'
    assert sha(plan_path) == PLAN_SHA
    plan = json.loads(plan_path.read_text())
    helper_paths = ['docs/gcsp/models/' + name for name in [
        'fucq115-activation-source-plan.py', 'fucq115-activation-source-plan.json',
        'fucq115-activation-run.mjs', 'fucq115-activation-supervisor.py', 'fucq115-canonical-supervisor.py',
        'fucq115-retained-source-plan.json']]
    helpers = {path: sha(ROOT / path) for path in helper_paths + ['_tools/test_resources.py', '_tools/scaffold_git.py']}
    assert helpers['docs/gcsp/models/fucq115-canonical-supervisor.py'] == '9ea84b3a04639d9a9e9c616f68524e5835831affe4f71b9097629e0a4cace8dc'
    source = {}
    local_sources = {}
    for path, row in plan['files'].items():
        rc, text, err = sg.git(ROOT, ['show', row['sourceCommit'] + ':' + path])
        assert rc == 0, (path, err[:200])
        data = text.encode()
        assert common.hashlib.sha256(data).hexdigest() == row['sha256'] and len(data) == row['bytes'], path
        if path.startswith('server/gcsp/predict/model/') or path == 'scripts/gcsp/train-choice-model.mjs' or path in plan['retainedInputPaths']:
            assert sha(ROOT / path) == row['sha256'], path
            local_sources[path] = row['sha256']
        source[path] = data
    pg = common.DEPENDENCIES / 'pg/package.json'
    assert sha(pg) == common.PG_SHA and json.loads(pg.read_text())['version'] == '8.23.1'
    dependencies = dependency_identity()
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith(('PG', 'GCSP_', 'NODE_'))
                   and not any(part in key.upper() for part in ['DATABASE', 'DB_URL', 'DEBUG', 'TRACE', 'PRELOAD'])
                   and key.upper() not in ['BASH_ENV', 'ENV', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD']}
    node = shutil.which('node', path=environment.get('PATH'))
    assert node
    identity = {'story': 'FUCQ-115', 'variant': 'retained-artifact-activation-v1', 'sourcePlanSHA256': PLAN_SHA,
                'helpers': helpers, 'sources': {path: row['sha256'] for path, row in plan['files'].items()},
                'localSourceIdentities': local_sources,
                'dependencyIdentities': dependencies, 'nodePath': node, 'nodeSHA256': sha(Path(node)),
                'environmentDigest': tr.digest(environment), 'workerCount': 1,
                'limits': {'seconds': 120, 'ramBytes': 768 * tr.MIB, 'combinedBytes': COMBINED,
                           'logBytes': 2 * tr.MIB, 'retainedBytes': RETAINED}}
    if args.plan:
        print(json.dumps({'status': 'plan-only', 'files': len(source), 'sourceBytes': sum(map(len, source.values())),
                          'identity': identity, 'allocation': 'none; no JavaScript imported'}))
        return
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128,
                        'unit_scratch_mib': 16, 'unit_ram_mib': 256, 'log_mib': 2})
    rdir = ROOT / '.claude/test-runs/fucq115' / ('artifact-activation-' + uuid.uuid4().hex)
    retained = rdir / 'retained'
    tr.atomic_json(rdir / 'plan.json', {'identity': identity, 'grant': args.dispatcher_grant, 'retainedRoot': str(retained),
                                      'argv': [node, '<owned-scratch>/entry.mjs', '<owned-scratch>/mirror', '<owned-scratch>/output'],
                                      'selection': 'Re-establish actual canonical learning/choice adoption and exact dated v4; verify captured snapshot/artifact; schedule reference v5 and read historical/active references; retry append-once.',
                                      'excluded': 'No generation, projection, baseline evaluation, training, settings change, full/native/browser/listener/network/corpus work, foreign source/provider/registry edits or production activation.'})
    retained.mkdir()

    def callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
        mirror = scratch.root / 'mirror'
        for path, data in source.items():
            target = mirror / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (mirror / 'server/node_modules').symlink_to(common.DEPENDENCIES, target_is_directory=True)
        entry = scratch.root / 'entry.mjs'
        entry.write_bytes((MODELS / 'fucq115-activation-run.mjs').read_bytes())
        result = tr.run_process([node, str(entry), str(mirror), str(scratch.root / 'output')], str(mirror),
                                environment, log, scratch, policy, min(disk_limit, COMBINED - 4 * tr.MIB),
                                min(ram_limit, 768 * tr.MIB), min(timeout, 120), host, cancel)
        output = scratch.root / 'output'
        selected = [output / name for name in ['run-summary.json', 'activation-command.json'] if (output / name).is_file()]
        assert all(path.resolve().is_relative_to(output.resolve()) and not path.is_symlink() for path in selected)
        assert sum(max(path.stat().st_size, path.stat().st_blocks * 512) for path in selected) <= RETAINED
        assert scratch.sample() + tr.allocated_bytes(rdir) <= COMBINED - tr.MIB
        receipt = []
        for path in selected:
            target = retained / path.relative_to(output)
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists() and path.stat().st_dev == retained.stat().st_dev
            digest = sha(path)
            os.rename(path, target)
            receipt.append({'path': str(target), 'bytes': target.stat().st_size, 'sha256': digest})
        result.update(retained=receipt, retainedAllocatedBytes=tr.allocated_bytes(retained))
        return result

    results, failure = None, None
    try:
        results = tr.execute([{'id': 'artifact-activation', 'disk': 16 * tr.MIB, 'ram': 256 * tr.MIB, 'seconds': 120}],
                             identity, 'vehicle-matcher-fucq115', rdir, rdir / 'logs', policy, 1, callback)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    cleanup = []
    for path in sorted((rdir / 'ownership').glob('*.json')):
        manifest = tr.read_json(path)
        cleanup.append({'manifest': str(path), 'scratchAbsent': not os.path.lexists(manifest['root']),
                        'manifestRemoved': manifest['state'] == 'removed',
                        'reservationAbsent': manifest['token'] not in tr.read_json(tr.HostBudget(policy).path, {}),
                        'ownedGroupsAbsent': all(tr.group_has_live_members(group) is False for group in manifest['groups'])})
    outputs = [item['result'] for item in (results or {}).get('completed', {}).values()]
    inputs_preserved = all(sha(ROOT / path) == digest for path, digest in helpers.items())
    inputs_preserved = inputs_preserved and all(sha(ROOT / path) == digest for path, digest in local_sources.items())
    dependencies_preserved = dependency_identity() == dependencies
    cleaned = bool(cleanup) and all(all(row[key] for key in ['scratchAbsent', 'manifestRemoved', 'reservationAbsent', 'ownedGroupsAbsent']) for row in cleanup)
    cleaned = cleaned and not os.path.lexists(ROOT / 'server/node_modules')
    passed = bool(outputs) and failure is None and cleaned and inputs_preserved and dependencies_preserved
    passed = passed and all(row['rc'] == 0 and row['issue'] is None for row in outputs)
    summary = {'identity': identity, 'grant': args.dispatcher_grant, 'results': results, 'cleanup': cleanup,
               'passed': passed, 'launcherFailure': failure, 'inputIdentityPreserved': inputs_preserved,
               'installedDependencyIdentityPreserved': dependencies_preserved,
               'retainedAllocatedBytes': tr.allocated_bytes(retained)}
    tr.atomic_json(rdir / 'summary.json', summary)
    print(json.dumps({'run': str(rdir), 'passed': passed, 'cleanup': cleanup,
                      'retainedAllocatedBytes': summary['retainedAllocatedBytes']}))
    if not passed:
        sys.exit(2)


if __name__ == '__main__':
    main()
