"""Finite isolated integration; --plan is read-only and --execute needs a grant.

Uses existing test_resources ownership/reservations/process-group finalizers. All
source and generated data starts in owned scratch. Only bounded selected results
are moved out after the child has stopped; successful duplicate CLI output is not
retained. No source is installed into the story checkout.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as sg
import test_resources as tr

MODEL_DIR = ROOT / 'docs/gcsp/models'
DEPENDENCIES = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules')
PG_SHA = 'b1e53333a3d0c2c47c49a5cb919d221135dc03145df740925b899bc2baacc435'
SOURCE_PLAN_SHA = '4736eb27feccd18d83c9f105d7a71d1130e1edd75006974c211fac208d1293a3'
COMBINED_LIMIT = 128 * tr.MIB
LOG_LIMIT = 2 * tr.MIB
RETAIN_LIMIT = 32 * tr.MIB


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(256 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--execute', action='store_true')
    parser.add_argument('--dispatcher-grant')
    args = parser.parse_args()
    if args.execute and not args.dispatcher_grant:
        parser.error('--execute requires the dispatcher-reviewed exact grant')
    plan_path = MODEL_DIR / 'fucq115-canonical-source-plan.json'
    assert sha(plan_path) == SOURCE_PLAN_SHA, 'Source catalogue changed: obtain a new review'
    plan = json.loads(plan_path.read_text())
    pg = DEPENDENCIES / 'pg/package.json'
    assert sha(pg) == PG_SHA and json.loads(pg.read_text())['version'] == '8.23.1'
    inputs = {p: sha(ROOT / p) for p in [
        'docs/gcsp/models/fucq115-canonical-source-plan.json',
        'docs/gcsp/models/fucq115-canonical-source-plan.py',
        'docs/gcsp/models/fucq115-canonical-run.mjs',
        'docs/gcsp/models/fucq115-canonical-supervisor.py',
        '_tools/test_resources.py', '_tools/scaffold_git.py']}
    source = {}
    for path, row in plan['files'].items():
        rc, text, err = sg.git(ROOT, ['show', row['sourceCommit'] + ':' + path])
        assert rc == 0, (path, err[:200])
        data = text.encode()
        assert hashlib.sha256(data).hexdigest() == row['sha256'] and len(data) == row['bytes'], path
        if path.startswith('server/gcsp/predict/model/') or path == 'scripts/gcsp/train-choice-model.mjs':
            assert sha(ROOT / path) == row['sha256'], 'Own model differs from reviewed pin: ' + path
        source[path] = data
    environment = {k: v for k, v in os.environ.items()
                   if not k.upper().startswith(('PG', 'GCSP_', 'NODE_'))
                   and not any(s in k.upper() for s in ['DATABASE', 'DB_URL', 'DEBUG', 'TRACE', 'PRELOAD'])
                   and k.upper() not in ['BASH_ENV', 'ENV', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD']}
    node = shutil.which('node', path=environment.get('PATH'))
    assert node
    identity = {'story': 'FUCQ-115', 'variant': 'canonical-80x4-v1', 'sourcePlan': SOURCE_PLAN_SHA,
                'inputs': inputs, 'sources': {p: row['sha256'] for p, row in plan['files'].items()},
                'nodePath': node, 'nodeSHA256': sha(Path(node)), 'pgPackageSHA256': PG_SHA,
                'environmentDigest': tr.digest(environment), 'workerCount': 1,
                'limits': {'seconds': 120, 'ramBytes': 768 * tr.MIB, 'combinedBytes': COMBINED_LIMIT,
                           'logBytes': LOG_LIMIT, 'retainedBytes': RETAIN_LIMIT}}
    if args.plan:
        print(json.dumps({'status': 'plan-only', 'files': len(source), 'sourceBytes': sum(map(len, source.values())),
                          'identity': identity, 'allocation': 'none; no JavaScript imported'}))
        return
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128,
                        'unit_scratch_mib': 32, 'unit_ram_mib': 256, 'log_mib': 2})
    run_id = 'canonical-80x4-' + uuid.uuid4().hex
    rdir = ROOT / '.claude/test-runs/fucq115' / run_id
    retained = rdir / 'retained'
    # The external execution plan identifies all retained output before allocation.
    tr.atomic_json(rdir / 'plan.json', {'identity': identity, 'grant': args.dispatcher_grant,
                                      'retainedRoot': str(retained), 'retainedLimitBytes': RETAIN_LIMIT,
                                      'argv': [node, '<owned-scratch>/entry.mjs', '<owned-scratch>/mirror', '<owned-scratch>/output'],
                                      'selection': 'actual canonical adoption/publication -> actual113 generation320 -> holdouts -> actual99/29 -> own optimizer/evaluation/artifact/CLI -> isolated model reference',
                                      'excluded': 'No old pilot rerun, full suite, native database, network, listener, browser, corpus collection, live activation, foreign source edits or dependency installation.'})
    assert not retained.exists()
    retained.mkdir()

    def callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
        mirror = scratch.root / 'mirror'
        for path, data in source.items():
            destination = mirror / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        (mirror / 'server/node_modules').symlink_to(DEPENDENCIES, target_is_directory=True)
        entry = scratch.root / 'entry.mjs'
        entry.write_bytes((MODEL_DIR / 'fucq115-canonical-run.mjs').read_bytes())
        result = tr.run_process([node, str(entry), str(mirror), str(scratch.root / 'output')], str(mirror),
                                environment, log, scratch, policy, min(disk_limit, COMBINED_LIMIT - 4 * tr.MIB),
                                min(ram_limit, 768 * tr.MIB), min(timeout, 120), host, cancel)
        # run_process has stopped and joined the owned group before any move.
        selected = ['run-summary.json', 'choice-training-dataset.json', 'training-policy.json',
                    'learning-snapshot.json', 'evaluation-summary.json', 'activation-command.json']
        generated_output = scratch.root / 'output'
        candidates = [generated_output / name for name in selected if (generated_output / name).is_file()]
        candidates.extend(sorted((generated_output / 'artifacts').glob('*.json')))
        assert all(p.resolve().is_relative_to(generated_output.resolve()) and not p.is_symlink() for p in candidates)
        allocated = sum(max(p.stat().st_size, p.stat().st_blocks * 512) for p in candidates)
        assert allocated <= RETAIN_LIMIT, 'Selected retained output exceeds reviewed bound'
        assert scratch.sample() + tr.allocated_bytes(rdir) <= COMBINED_LIMIT - tr.MIB
        receipt = []
        for path in candidates:
            relative = path.relative_to(generated_output)
            destination = retained / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            assert not destination.exists() and path.stat().st_dev == retained.stat().st_dev
            digest = sha(path)
            os.rename(path, destination)  # same-volume move; never duplicate generated data
            receipt.append({'path': str(destination), 'sha256': digest, 'bytes': destination.stat().st_size})
        result['retained'] = receipt
        result['retainedAllocatedBytes'] = tr.allocated_bytes(retained)
        result['sourceFiles'] = len(source)
        return result

    results = None
    launch_failure = None
    try:
        results = tr.execute([{'id': 'canonical-80x4', 'disk': 32 * tr.MIB, 'ram': 256 * tr.MIB, 'seconds': 120}],
                             identity, 'vehicle-matcher-fucq115', rdir, rdir / 'logs', policy, 1, callback)
    except BaseException as error:
        launch_failure = {'type': type(error).__name__, 'message': str(error)[:1024]}
    cleanup = []
    for path in sorted((rdir / 'ownership').glob('*.json')):
        manifest = tr.read_json(path)
        check = {'manifest': str(path), 'scratchAbsent': not os.path.lexists(manifest['root']),
                 'manifestRemoved': manifest['state'] == 'removed',
                 'reservationAbsent': manifest['token'] not in tr.read_json(tr.HostBudget(policy).path, {}),
                 'ownedGroupsAbsent': all(tr.group_has_live_members(group) is False for group in manifest['groups'])}
        cleanup.append(check)
    outputs = [item['result'] for item in (results or {}).get('completed', {}).values()]
    passed = bool(outputs) and launch_failure is None and all(result['rc'] == 0 and result['issue'] is None for result in outputs)
    cleanup_passed = all(all(check[k] for k in ['scratchAbsent', 'manifestRemoved', 'reservationAbsent', 'ownedGroupsAbsent']) for check in cleanup)
    identity_preserved = all(sha(ROOT / path) == digest for path, digest in inputs.items())
    dependencies_preserved = pg.is_file() and sha(pg) == PG_SHA
    passed = passed and cleanup_passed and identity_preserved and dependencies_preserved
    summary = {'identity': identity, 'grant': args.dispatcher_grant, 'results': results,
               'cleanup': cleanup, 'passed': passed, 'retainedAllocatedBytes': tr.allocated_bytes(retained),
               'installedDependenciesPreserved': dependencies_preserved,
               'launcherFailure': launch_failure, 'inputIdentityPreserved': identity_preserved}
    tr.atomic_json(rdir / 'summary.json', summary)
    print(json.dumps({'run': str(rdir), 'passed': passed, 'cleanup': cleanup,
                      'retainedAllocatedBytes': summary['retainedAllocatedBytes']}))
    if not passed:
        sys.exit(2)


if __name__ == '__main__':
    main()
