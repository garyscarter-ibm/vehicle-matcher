#!/usr/bin/env python3
"""REVIEW PROPOSAL ONLY: gated isolated canonical-adoption consumer proof."""
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
APPROVAL = SHARED / '.claude/test-runs/ownership/fucq106-canonical-source-review.json'
TEST = 'server/test/gcsp-offer-decisions-canonical-adoption.test.js'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def sha(data):
    return hashlib.sha256(data).hexdigest()


R = module('fucq106_integration_resources', ROOT / '_tools/test_resources.py')
G = module('fucq106_integration_git', ROOT / '_tools/scaffold_git.py')
label = sys.argv[1] if len(sys.argv) > 1 else 'canonical-adoption-v1'
if not re.fullmatch(r'[a-z0-9-]{1,80}', label):
    raise ValueError('Invalid owned run label')
if len(sys.argv) != 2:
    raise ValueError('Use one new owned run label; all three consumer assertions are selected')
ram_mib = 768
source_path = EVIDENCE / 'canonical-adoption-source-plan.json'
source_plan = json.loads(source_path.read_text())
approval = json.loads(APPROVAL.read_text())  # Missing approval stops before any allocation.
if (approval.get('status') != 'PASS' or approval.get('execution_allowed') is not True
        or approval.get('scope') != 'fucq106-canonical-adoption'
        or sha(source_path.read_bytes()) != approval.get('plan_sha256')):
    raise RuntimeError('Exact canonical source/harness execution approval is absent')
for entry in source_plan['harness']:
    if sha((ROOT / entry['path']).read_bytes()) != entry['sha256']:
        raise RuntimeError('Harness identity mismatch')
policy = R.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128,
                   'chunk_ram_mib': ram_mib, 'log_mib': 2})
host = R.HostBudget(policy)
selected = source_plan['modules']
if len(selected) != 42 or len({row['path'] for row in selected}) != 42:
    raise RuntimeError('Not the reviewed 42-module singleton composition')
contents = {}
for row in selected + source_plan['files']:
    content = G.show(ROOT, row['source'], row['path']).encode()
    if sha(content) != row['sha256'] or len(content) != row['bytes']:
        raise RuntimeError('Immutable source/input identity mismatch')
    contents[row['path']] = content
test_bytes = (ROOT / source_plan['test']['sourcePath']).read_bytes()
if (source_plan['test']['canonicalPath'] != TEST or sha(test_bytes) != source_plan['test']['sha256']
        or len(test_bytes) != source_plan['test']['bytes']):
    raise RuntimeError('Proposed test identity mismatch')
loader_bytes = (EVIDENCE / 'canonical-adoption-loader.proposal.mjs').read_bytes()
file_inputs = {row['path']: row['sha256'] for row in source_plan['files']}
dep = source_plan['dependency']
pg = Path(dep['path'])
if sha(pg.read_bytes()) != dep['sha256'] or (pg.stat().st_dev, pg.stat().st_ino) != (dep['device'], dep['inode']):
    raise RuntimeError('Existing read-only dependency identity mismatch')
env = {k: v for k, v in os.environ.items() if not (
    'DB' in k.upper() or 'DATABASE' in k.upper() or k.upper().startswith('PG')
    or 'POSTGRES' in k.upper() or 'SQL_URL' in k.upper()
    or k.upper().startswith(('NODE_', 'FUCQ106_')) or any(term in k.upper() for term in ['PRELOAD', 'COVERAGE', 'DEBUG', 'TRACE']))}
record_dir = RECORDS / label
record_dir.mkdir(parents=True, exist_ok=False)
scratch = R.Scratch(record_dir, str(ROOT), policy)
scratch.record.update(story='FUCQ-106', ports=[], profiles=[], dependency_links=[], processes=[],
                      supervisor_finalizer=str(Path(__file__).resolve()))
R.atomic_json(scratch.manifest, scratch.record)
plan = {'story': 'FUCQ-106', 'scope': 'Approved isolated canonical-adoption consumer integration only',
        'reviewed_plan_sha256': sha(source_path.read_bytes()), 'approval_sha256': sha(APPROVAL.read_bytes()),
        'test': {'path': TEST, 'sha256': sha(test_bytes), 'bytes': len(test_bytes)},
        'loader_sha256': sha(loader_bytes), 'supervisor_sha256': sha(Path(__file__).read_bytes()),
        'selection': 'all 3 new canonical consumer cases; no rerun of the accepted 25/12 cases',
        'reason': 'Same-provider canonical adoption and activation reaches actual 106 decisions/projection with retained quote provenance',
        'files': file_inputs, 'source_modules': selected, 'dependency': dep,
        'limits': {'seconds': 120, 'ramMiB': 768, 'scratchAndOutputMiB': 128, 'logMiB': 2, 'workers': 1},
        'headroom': host.headroom(str(ROOT)), 'environment_digest': R.digest(env),
        'excluded': ['central runtime', 'native PostgreSQL', 'remote adapters', 'actual 107/108 consumers',
                     'browser/listener', 'network/mail', 'FUCQ115 adoption/generation/training', 'full suite'],
        'finalizer': 'stop/join owned group and descendants; identity-checked scratch teardown; audit dependency/files/groups/ownership; release reservation'}
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
            canonical_root = scratch.root / 'canonical'
            modules = []
            for row in selected + [{'path': TEST, 'sha256': sha(test_bytes), 'source': 'owned-test', 'overlay': False}]:
                content = test_bytes if row['path'] == TEST else contents[row['path']]
                target = canonical_root / row['path']
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
                modules.append({**row, 'canonical': target.as_uri(), 'bytesURL': target.as_uri(),
                                'overlay': row.get('overlay', False)})
            for row in source_plan['files']:
                target = canonical_root / row['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(contents[row['path']])
            composition = {'modules': modules, 'journal': str(scratch.root / 'modules.jsonl'),
                           'sourceRoot': canonical_root.as_uri() + '/', 'projectRoot': ROOT.as_uri() + '/',
                           'scratchRoot': scratch.root.as_uri() + '/', 'loaderSHA256': sha(loader_bytes),
                           'pg': {'url': pg.as_uri(), 'sha256': dep['sha256']}}
            mapping = scratch.root / 'modules.json'; R.atomic_json(mapping, composition)
            loader = scratch.root / 'canonical-loader.mjs'; loader.write_bytes(loader_bytes)
            env['FUCQ106_CANONICAL_MODULE_MAP'] = str(mapping)
            command = ['node', '--no-warnings', '--loader', str(loader), '--test',
                       '--test-reporter=tap', '--test-concurrency=1', str(canonical_root / TEST)]
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
            required = {row['path'] for row in modules}
            if not required <= {row['path'] for row in observed}:
                raise RuntimeError('Required approved source was not loaded')
            R.atomic_json(record_dir / 'observed-modules.json', observed)
            for row in modules:
                if sha(Path(row['bytesURL'].removeprefix('file://')).read_bytes()) != row['sha256']:
                    raise RuntimeError('Module bytes changed during integration')
            for path, expected_sha in file_inputs.items():
                if sha((canonical_root / path).read_bytes()) != expected_sha:
                    raise RuntimeError('Read-only file input changed during integration')
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
                          'canonical same-provider adoption/publication/activation', 'in-process reason projection; no listener/subprocess fixtures'],
        'excluded': plan['excluded'], 'result': result})
    print(json.dumps(result))
sys.exit(0 if result.get('rc') == 0 and not result.get('issue') and not failure
         and audit['scratchAbsent'] and groups_absent and not live and not audit['openFiles']
         and audit['reservationReleased'] and dependency_valid else 1)
