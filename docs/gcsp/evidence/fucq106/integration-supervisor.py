#!/usr/bin/env python3
"""Owned, bounded execution of the approved 39-module memory integration only."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher')
RECORDS = SHARED / '.claude/test-runs/fucq106'
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq106'
APPROVAL = SHARED / '.claude/test-runs/ownership/fucq106-source-review-2357.json'
CHECKPOINT = 'da4a2c824d7d73b118185c4cfc6395d4e9254e4f'
TEST = 'server/test/gcsp-offer-decisions-integration.test.js'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def sha(data):
    return hashlib.sha256(data).hexdigest()


R = module('fucq106_integration_resources', ROOT / '_tools/test_resources.py')
G = module('fucq106_integration_git', ROOT / '_tools/scaffold_git.py')
label = sys.argv[1] if len(sys.argv) > 1 else 'integration-v1'
if not re.fullmatch(r'[a-z0-9-]{1,80}', label):
    raise ValueError('Invalid owned run label')
pattern = sys.argv[2] if len(sys.argv) > 2 else None
ram_mib = int(os.environ.get('FUCQ106_RAM_MIB', '768'))
if not 96 <= ram_mib <= 768:
    raise ValueError('RAM budget outside approved range')
policy = R.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128,
                   'chunk_ram_mib': ram_mib, 'log_mib': 2})
host = R.HostBudget(policy)
source_path = EVIDENCE / 'integration-source-plan.json'
source_plan = json.loads(source_path.read_text())
approval = json.loads(APPROVAL.read_text())
if sha(source_path.read_bytes()) != approval['plan_sha256']:
    raise RuntimeError('Reviewed source plan identity mismatch')
selected = source_plan['reuse']['modules'] + source_plan['additional_106']
if len(selected) != 39 or any('/policy/' in row['path'] and row['stage'] != 'reuse-102' for row in selected):
    raise RuntimeError('Not the approved first 39-module closure')
contents = {}
for row in selected:
    ref = CHECKPOINT if row['source'] == 'v9-tested-worktree' else row['source']
    content = G.show(ROOT, ref, row['path']).encode()
    if sha(content) != row['sha256'] or len(content) != row['bytes']:
        raise RuntimeError('Immutable source identity mismatch')
    contents[row['path']] = content
    if row['source'] == 'v9-tested-worktree' and sha((ROOT / row['path']).read_bytes()) != row['sha256']:
        raise RuntimeError('Decision code differs from approved checkpoint')
test_bytes = (ROOT / TEST).read_bytes()
loader_bytes = (EVIDENCE / 'integration-loader.mjs').read_bytes()
file_inputs = {path: sha((ROOT / path).read_bytes()) for path in [
    'server/gcsp/policy/seed-v1.json',
    'docs/gcsp/evidence/fucq106/reviewed-offer-decline-reasons-v1.proposal.json']}
if file_inputs['server/gcsp/policy/seed-v1.json'] != source_plan['policy_adoption']['file_inputs'][0]['sha256']:
    raise RuntimeError('Seed input differs from reviewed source')
dep = source_plan['existing_pg'][0]
pg = Path(dep['path'])
if sha(pg.read_bytes()) != dep['sha256'] or (pg.stat().st_dev, pg.stat().st_ino) != (dep['device'], dep['inode']):
    raise RuntimeError('Existing read-only dependency identity mismatch')
env = {k: v for k, v in os.environ.items() if not (
    'DB' in k.upper() or 'DATABASE' in k.upper() or k.upper().startswith('PG')
    or 'POSTGRES' in k.upper() or 'SQL_URL' in k.upper()
    or k.upper() in ['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'DEBUG'])}
record_dir = RECORDS / label
record_dir.mkdir(parents=True, exist_ok=False)
scratch = R.Scratch(record_dir, str(ROOT), policy)
scratch.record.update(story='FUCQ-106', ports=[], profiles=[], dependency_links=[], processes=[],
                      supervisor_finalizer=str(Path(__file__).resolve()))
R.atomic_json(scratch.manifest, scratch.record)
plan = {'story': 'FUCQ-106', 'scope': 'Approved first 39-module actual producer/access/decision memory integration',
        'reviewed_plan_sha256': sha(source_path.read_bytes()), 'approval_sha256': sha(APPROVAL.read_bytes()),
        'base': '2b796010f54d1b720e8b13f044496c8e175c07a7', 'decision_checkpoint': CHECKPOINT,
        'test': {'path': TEST, 'sha256': sha(test_bytes), 'bytes': len(test_bytes)},
        'loader_sha256': sha(loader_bytes), 'supervisor_sha256': sha(Path(__file__).read_bytes()),
        'selection': pattern or 'all 12 dedicated integration cases',
        'reason': 'Real 100 producer and expiry, private 102 token/account authority, real stored-subject export and 106 transactional decisions; no synthetic offer inserts',
        'alternative_input': 'Reason-registry proposal supplied as explicit alternative PolicyService input only; no canonical adoption',
        'files': file_inputs, 'source_modules': selected, 'dependency': dep,
        'limits': {'seconds': 120, 'ramMiB': ram_mib, 'scratchAndOutputMiB': 128, 'logMiB': 2, 'workers': 1},
        'headroom': host.headroom(str(ROOT)), 'environment_digest': R.digest(env),
        'excluded': ['103 policy adoption/registration modules', 'central runtime', 'native PostgreSQL',
                     'remote adapters', 'actual 107/108 consumers', 'browser/listener', 'network/mail', 'full suite'],
        'finalizer': 'handled termination; stop/join launcher group and tracked descendants; identity-checked scratch teardown; audit dependency/files/groups/ownership; release reservation'}
R.atomic_json(record_dir / 'plan.json', plan)  # Test/hash/selection before allocation.
identities = {}


def process_snapshot():
    snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat='],
                              capture_output=True, text=True, check=True, timeout=3)
    rows = []
    for line in snapshot.stdout.splitlines():
        fields = line.split()
        if len(fields) == 5:
            rows.append(dict(zip(('pid', 'ppid', 'pgid', 'rss', 'stat'),
                                 [*(int(v) for v in fields[:4]), fields[4]])))
    owned = {row['pid'] for row in rows if row['pgid'] in scratch.record['groups']}
    previous = None
    while owned != previous:
        previous = set(owned)
        owned.update(row['pid'] for row in rows if row['ppid'] in owned)
    members = [row for row in rows if row['pid'] in owned and not row['stat'].startswith('Z')]
    for row in members:
        group = row['pgid']
        if any(other['pgid'] == group and other['pid'] not in owned for other in rows):
            raise RuntimeError('Foreign shared process group')
        if group not in scratch.record['groups']:
            scratch.record['groups'].append(group)
        started = R.process_identity(row['pid'])
        if started is not None:
            identities.setdefault(row['pid'], started)
    scratch.record['processes'] = [{'pid': pid, 'start': start} for pid, start in identities.items()]
    R.atomic_json(scratch.manifest, scratch.record)
    return sum(row['rss'] * 1024 for row in members)


R.group_rss = lambda _pgid: process_snapshot()
original_sample = scratch.sample


def sample():
    process_snapshot()
    return original_sample()


scratch.sample = sample
result = {}; failure = None; reserved = False; observed = []; audit = {}
try:
    with R.handled_termination():
        allocation = host.acquire(scratch.token, 128 * R.MIB, ram_mib * R.MIB, str(ROOT), root=scratch.root)
        reserved = True
        with scratch:
            modules = []
            for row in selected + [{'path': TEST, 'sha256': sha(test_bytes), 'source': 'owned-test', 'overlay': False}]:
                content = test_bytes if row['path'] == TEST else contents[row['path']]
                target = (scratch.root / 'bytes' / row['path']).with_suffix('.mjs')
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
                modules.append({**row, 'canonical': (ROOT / row['path']).as_uri(), 'bytesURL': target.as_uri(),
                                'overlay': row.get('overlay', False)})
            composition = {'modules': modules, 'journal': str(scratch.root / 'modules.jsonl'),
                           'sourceRoot': ROOT.as_uri() + '/', 'scratchRoot': scratch.root.as_uri() + '/',
                           'loaderSHA256': sha(loader_bytes),
                           'pg': {'url': pg.as_uri(), 'sha256': dep['sha256']}}
            mapping = scratch.root / 'modules.json'; R.atomic_json(mapping, composition)
            loader = scratch.root / 'integration-loader.mjs'; loader.write_bytes(loader_bytes)
            env['FUCQ106_MODULE_MAP'] = str(mapping)
            env['FUCQ106_ACCEPT_SAMPLE'] = str(scratch.root / 'accepted.json')
            env['FUCQ106_DECLINE_SAMPLE'] = str(scratch.root / 'declined.json')
            command = ['node', '--no-warnings', '--loader', str(loader), '--test',
                       '--test-reporter=tap', '--test-concurrency=1']
            if pattern:
                command.append('--test-name-pattern=' + pattern)
            command.append(TEST)
            plan['command'] = command; R.atomic_json(record_dir / 'plan.json', plan)
            log = scratch.root / 'checks.log'
            result = R.run_process(command, str(ROOT), env, log, scratch, policy,
                                   allocation['disk'], allocation['ram'], 120, host)
            output = log.read_text()
            result['summary'] = [line for line in output.splitlines() if re.match(r'^# (tests|pass|fail|skipped|duration_ms) ', line)]
            if result['rc'] or result['issue']:
                (record_dir / 'failure.log').write_text(output[-65536:])
            if Path(composition['journal']).exists():
                observed = [json.loads(line) for line in Path(composition['journal']).read_text().splitlines()]
            expected = {row['path']: row for row in modules}
            if any(row['path'] not in expected or row['sha256'] != expected[row['path']]['sha256']
                   or row['canonical'] != expected[row['path']]['canonical'] for row in observed):
                raise RuntimeError('Observed module journal identity mismatch')
            pairs = [(row['pid'], row['path']) for row in observed]
            if len(pairs) != len(set(pairs)):
                raise RuntimeError('Duplicate canonical module identity within a process')
            required = {row['path'] for row in modules if row['overlay']} | {
                'server/gcsp/offers/access.js', 'server/gcsp/offers/access-http.js',
                'server/gcsp/offers/decision.js', 'server/gcsp/offers/decision-http.js', TEST}
            if not required <= {row['path'] for row in observed}:
                raise RuntimeError('Required approved source was not loaded')
            R.atomic_json(record_dir / 'observed-modules.json', observed)
            for row in modules:
                if sha(Path(row['bytesURL'].removeprefix('file://')).read_bytes()) != row['sha256']:
                    raise RuntimeError('Module bytes changed during integration')
            for path, expected_sha in file_inputs.items():
                if sha((ROOT / path).read_bytes()) != expected_sha:
                    raise RuntimeError('Read-only file input changed during integration')
            if result['rc'] == 0 and not result['issue']:
                for name in ['accepted', 'declined']:
                    candidate = scratch.root / (name + '.json')
                    if candidate.exists():
                        R.atomic_json(record_dir / (name + '-representative.json'), json.loads(candidate.read_text()))
except BaseException as error:
    failure = type(error).__name__  # Do not persist provider/request exception payloads.
    if isinstance(error, R.CapacityError):
        result['capacity_headroom'] = error.headroom
finally:
    # The process launcher stops/joins its owned group before the scratch finalizer.
    # These tests contain no subprocess fixture or detached work; audit every sampled descendant.
    if reserved:
        host.release(scratch.token)
    live = [{'pid': pid, 'start': start} for pid, start in identities.items() if start is not None and R.process_identity(pid) == start]
    groups_absent = all(R.group_has_live_members(group) is False for group in scratch.record['groups'])
    open_scan = subprocess.run(['/usr/sbin/lsof', '-nP', '+D', str(scratch.root)],
                               capture_output=True, text=True, timeout=5)
    dependency_valid = sha(pg.read_bytes()) == dep['sha256'] and (pg.stat().st_dev, pg.stat().st_ino) == (dep['device'], dep['inode'])
    audit = {'scratchAbsent': not os.path.lexists(scratch.root), 'groupsAbsent': groups_absent,
             'liveOwnedProcesses': live, 'openFiles': open_scan.stdout.splitlines(),
             'reservationReleased': scratch.token not in R.read_json(host.path, {}),
             'existingDependencyPreserved': dependency_valid, 'dependencyLinksCreated': 0}
    result.update(failure=failure, cleanup=audit, manifest=str(scratch.manifest),
                  observed_module_count=len({row['path'] for row in observed}),
                  test_sha256=sha(test_bytes), loader_sha256=sha(loader_bytes))
    R.atomic_json(record_dir / 'result.json', result)
    R.atomic_json(RECORDS.parent / 'impact' / ('fucq106-' + label + '.json'), {
        'test': plan['test'], 'selection': plan['selection'], 'source': selected, 'file_inputs': file_inputs,
        'fixture_edges': ['actual100 local producer/expiry', 'actual102 private token/account authority',
                          'actual stored-subject evaluator', 'memory repository/PolicyService/clock/identity/Brief',
                          'in-process request streams; no listener/subprocess fixtures'],
        'excluded': plan['excluded'], 'result': result})
    print(json.dumps(result))
sys.exit(0 if result.get('rc') == 0 and not result.get('issue') and not failure
         and audit['scratchAbsent'] and groups_absent and not live and not audit['openFiles']
         and audit['reservationReleased'] and dependency_valid else 1)
