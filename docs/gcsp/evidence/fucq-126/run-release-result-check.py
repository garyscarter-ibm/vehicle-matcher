#!/usr/bin/env python3
"""Frozen, scoped presenter checks; each chunk owns its resources and cleanup."""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SHARED = ROOT.parents[2]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R

RUN_ID = 'fucq126-release-result-20261106'
RUNS = SHARED / '.claude/test-runs' / RUN_ID
OWNER = RUNS.parent / 'ownership' / (RUN_ID + '.json')
PLAN = RUNS / 'plan.json'
NODE = Path('/opt/homebrew/bin/node')
BASE = '906aa44d2a277753327a4c5d0c8d9e77132f10d4'
SELECTED = {'controls': 'gcsp-presenter-controls-render.test.js', 'ratchet': 'ui-ratchet.test.js'}
POLICY = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2,
                   'local_scratch_reason': 'Small macOS Node IPC and bounded V8 coverage scratch.'})


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def inputs():
    # A conservative finite superset covers all literal/dynamic block imports and ratchet text reads.
    paths = {p for p in (ROOT / 'blocks').rglob('*') if p.is_file() and p.suffix in {'.js', '.mjs', '.css'}}
    paths.update(ROOT / p for p in ['package.json', 'package-lock.json', 'server/package.json',
                                   'server/package-lock.json', 'server/test/ui-ratchet.json',
                                   'gcsp-presenter.html', '_tools/test_resources.py', '_tools/scaffold_git.py'])
    paths.add(Path(__file__).resolve())
    paths.update(ROOT / 'server/test' / p for p in SELECTED.values())
    for name in ['node_modules', 'server/node_modules']:
        tree = ROOT / name
        if any(p.is_symlink() and p.is_dir() for p in tree.rglob('*')):
            raise RuntimeError('dependency directory symlink needs an explicit closure review')
        paths.update(p for p in tree.rglob('*') if p.is_file())
    records = {str(p.relative_to(ROOT)): {'sha256': sha(p), 'bytes': p.stat().st_size}
               for p in sorted(paths) if p.is_file()}
    if len(records) != len(paths):
        raise RuntimeError('a planned source input is missing')
    links = {}
    for name in ['node_modules', 'server/node_modules']:
        p = ROOT / name
        s = p.lstat()
        links[name] = {'target': str(p.resolve()), 'device': s.st_dev, 'inode': s.st_ino}
    executable = {'path': str(NODE), 'target': str(NODE.resolve()), 'sha256': sha(NODE)}
    return {'files': records, 'links': links, 'executable': executable}


def freeze():
    if RUNS.exists() or OWNER.exists():
        raise RuntimeError('run already exists; preserve its evidence')
    R.atomic_json(OWNER, {'version': 1, 'owner': R.owner(), 'root': str(RUNS), 'state': 'retained-summary',
                          'expectedBytes': 2 * R.MIB, 'purpose': 'source plan, checkpoints and bounded failure logs'})
    RUNS.mkdir()
    with G.checkout_mutex(ROOT):
        rc, head, error = G.git(ROOT, ['rev-parse', 'HEAD'])
    if rc:
        raise RuntimeError(error)
    identity = inputs()
    plan = {'base': BASE, 'head': head.strip(), 'root': str(ROOT), 'source': identity,
            'sourceDigest': R.digest(identity), 'created': time.time(),
            'commands': {name: [str(NODE), '--test', '--test-concurrency=1', 'server/test/' + file]
                         for name, file in SELECTED.items()},
            'limits': {'seconds': 120, 'ramMiB': 768, 'scratchMiB': 128, 'logMiB': 2, 'workers': 1},
            'changed': ['blocks/gcsp/presenter-controls/controls.js', 'server/test/gcsp-presenter-controls-render.test.js'],
            'regression': 'Real stock-release results contain orderUuids, not an unbound released integer.',
            'edges': ['controller -> HTTP adapter/workspace/kit DOM', 'jsdom -> installed dependencies',
                      'ratchet -> configured blocks/config/stylesheets; read only',
                      'Node test runner -> one serial file worker; V8 coverage -> owned scratch'],
            'selection': 'Explicit controller regression and required component ratchet; automatic JavaScript selection unsupported.',
            'excluded': ['Actual FUCQ-92/FUCQ-100 imports or execution', 'browser/listener/native database/full suite',
                         'source provider, registry or runtime edits', 'six unavailable business preparations'],
            'checkpoint': 'One receipt per serial check; no successful chunk rerun without changed identity.',
            'teardown': 'run_process stops/joins group; Scratch removes exact root; release reservation; independent --audit.'}
    R.atomic_json(PLAN, plan)
    R.atomic_json(RUNS.parent / 'impact' / (RUN_ID + '-plan.json'),
                  {key: plan[key] for key in ['base', 'head', 'sourceDigest', 'changed', 'commands', 'edges', 'excluded', 'selection']})
    print(json.dumps({'plan': str(PLAN), 'inputs': len(identity['files']), 'sourceDigest': plan['sourceDigest']}))


class OwnedScratch(R.Scratch):
    def child(self, process):
        self.record.setdefault('childIdentities', []).append({'pid': process.pid, 'start': R.process_identity(process.pid)})
        super().child(process)


def check(name):
    plan = R.read_json(PLAN)
    if not plan or inputs() != plan['source']:
        raise RuntimeError('frozen input identity changed or absent; replan before execution')
    receipt, log = RUNS / (name + '.json'), RUNS / (name + '.log')
    if receipt.exists():
        raise RuntimeError('chunk receipt exists; preserve completed/failure evidence')
    host = R.HostBudget(POLICY)
    R.atomic_json(receipt, {'state': 'planned', 'sourceDigest': plan['sourceDigest'], 'health': host.headroom(ROOT),
                            'owner': R.owner(), 'command': plan['commands'][name]})
    contexts = []
    outcome = {'rc': 1, 'issue': 'chunk did not start'}
    started = time.monotonic()
    scratch = OwnedScratch(RUNS, ROOT, POLICY, expected=128 * R.MIB, checkpoint=receipt)
    with R.handled_termination():
        try:
            with scratch:
                reserved = False
                try:
                    host.acquire(scratch.token, 128 * R.MIB, 768 * R.MIB, ROOT, root=scratch.root)
                    reserved = True
                    env = scratch.env(os.environ)
                    for key in list(env):
                        if key.startswith(('PG', 'NODE_', 'NPM_', 'npm_')) or re.search(r'(DATABASE|POSTGRES|DB|SQL).*URL', key, re.I):
                            env.pop(key, None)
                    env['NODE_V8_COVERAGE'] = str(scratch.root / 'coverage')
                    outcome = R.run_process(plan['commands'][name], ROOT, env, log, scratch, POLICY,
                                            128 * R.MIB, 768 * R.MIB, 120, host=host)
                    for source in (scratch.root / 'coverage').glob('*.json'):
                        for script in json.loads(source.read_text()).get('result', []):
                            if script['url'].startswith('file://' + str(ROOT / 'blocks')):
                                contexts.append({'file': script['url'].removeprefix('file://' + str(ROOT) + '/'),
                                                 'functions': [f['functionName'] for f in script['functions']
                                                               if any(r['count'] for r in f['ranges'])]})
                finally:
                    if reserved:
                        host.release(scratch.token)
        except (Exception, KeyboardInterrupt) as error:
            outcome = {**outcome, 'rc': 130 if isinstance(error, KeyboardInterrupt) else 1,
                       'issue': type(error).__name__ + ': ' + str(error)}
        lines = log.read_text().splitlines() if log.exists() else []
        cleanup = {'scratch': str(scratch.root), 'manifest': str(scratch.manifest),
                   'scratchAbsent': not os.path.lexists(scratch.root),
                   'groupsAbsent': all(R.group_has_live_members(g) is False for g in scratch.record['groups']),
                   'reservationAbsent': scratch.token not in R.read_json(host.path, {}),
                   'removedBytes': scratch.record['peak']}
        same = inputs() == plan['source']
        passed = outcome['rc'] == 0 and not outcome.get('issue') and same and all(cleanup[k] for k in
                   ['scratchAbsent', 'groupsAbsent', 'reservationAbsent'])
        if passed:
            log.unlink(missing_ok=True)
        summary = {'state': 'passed' if passed else 'failed', 'scope': 'selected module only', 'sourceDigest': plan['sourceDigest'],
                   'command': plan['commands'][name], 'outcome': outcome, 'sourceUnchanged': same, 'cleanup': cleanup,
                   'wallSeconds': time.monotonic() - started, 'environment': 'Owned TMP; Node/npm options and DB/PG aliases removed.',
                   'summary': [s for s in lines if re.match(r'# (tests|pass|fail|skipped|duration)', s)],
                   'failures': [s for s in lines if s.startswith(('not ok', '  error:', '  expected:', '  actual:'))]}
        R.atomic_json(receipt, summary)
        R.atomic_json(RUNS.parent / 'impact' / (RUN_ID + '-' + name + '.json'),
                      {'sourceDigest': plan['sourceDigest'], 'command': plan['commands'][name], 'observed': contexts,
                       'limitation': 'File-worker function observations, not per-assertion coverage; other paths unknown.',
                       'state': summary['state'], 'wallSeconds': summary['wallSeconds']})
        print(json.dumps(summary, indent=2))
        return 0 if passed else 1


def audit():
    plan = R.read_json(PLAN)
    records = [R.read_json(p) for p in (RUNS / 'ownership').glob('*.json')]
    snapshot = subprocess.run(['/usr/sbin/lsof', '-nP', '-F', 'pn'], capture_output=True, text=True, timeout=30)
    roots = [r['root'] for r in records]
    open_paths = [line[1:] for line in snapshot.stdout.splitlines() if line.startswith('n')
                  and any(line[1:].startswith(root) for root in roots)]
    reservations = R.read_json(R.HostBudget(POLICY).path, {})
    rows = [{'manifest': str(RUNS / 'ownership' / (r['token'] + '.json')), 'root': r['root'],
             'ownerAbsent': not R.process_alive(r['owner']),
             'childIdentitiesAbsent': all(not R.process_alive(c) for c in r.get('childIdentities', [])),
             'groupsAbsent': all(R.group_has_live_members(g) is False for g in r['groups']),
             'scratchAbsent': not os.path.lexists(r['root']), 'reservationAbsent': r['token'] not in reservations,
             'removedBytes': r['peak']} for r in records]
    good = bool(rows) and all(all(row[k] for k in ['ownerAbsent', 'childIdentitiesAbsent', 'groupsAbsent',
                                                  'scratchAbsent', 'reservationAbsent']) for row in rows)
    result = {'state': 'passed' if good and not open_paths and snapshot.returncode == 0 and not snapshot.stderr else 'failed',
              'sourceDigest': plan['sourceDigest'], 'sourceUnchanged': inputs() == plan['source'],
              'rows': rows, 'lsof': {'rc': snapshot.returncode, 'stderrEmpty': not snapshot.stderr,
                                    'matchingOwnedPaths': open_paths},
              'successfulLogsAbsent': all(not (RUNS / (name + '.log')).exists() for name in SELECTED),
              'retained': ['plan.json', 'controls.json', 'ratchet.json', 'audit.json', 'ownership manifests and impact summaries']}
    if not result['sourceUnchanged'] or not result['successfulLogsAbsent']:
        result['state'] = 'failed'
    R.atomic_json(RUNS / 'audit.json', result)
    print(json.dumps(result, indent=2))
    return 0 if result['state'] == 'passed' else 1


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == '--plan':
        freeze()
    elif mode == '--audit':
        raise SystemExit(audit())
    elif mode in SELECTED:
        raise SystemExit(check(mode))
    else:
        raise SystemExit('select --plan, controls, ratchet or --audit')
