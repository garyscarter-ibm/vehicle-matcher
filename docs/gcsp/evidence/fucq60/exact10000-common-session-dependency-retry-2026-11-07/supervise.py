#!/usr/bin/env python3
"""Run only an exact parent-reviewed finite offline chunk; owns every allocation."""
import sys
sys.dont_write_bytecode = True
import argparse
import atexit
import uuid
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import subprocess

BASE = Path(__file__).resolve().parent
WORKTREE = BASE.parents[4]
ROOT = Path('/Users/usget/Claude/vehicle-matcher')
parser = argparse.ArgumentParser()
parser.add_argument('--phase', required=True, help='collector-bridge, chunk index0..156, or summarize')
parser.add_argument('--reviewed-plan-sha256', required=True)
parser.add_argument('--root-release', required=True, type=Path)
args = parser.parse_args()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_bytes())
plan_path = BASE / 'plan.json'
assert sha(plan_path) == args.reviewed_plan_sha256
plan = read(plan_path)
assert str(WORKTREE) == plan['executionWorktree']
assert args.root_release.is_absolute()
grant = read(args.root_release)
assert grant['authorized'] is True and grant['planSha256'] == args.reviewed_plan_sha256
assert grant['phase'] == args.phase and grant['sourceCalls'] == 0 and grant['networkCalls'] == 0
assert grant['codeIdentity'] == plan['codeIdentity']
assert grant['selectionManifestSha256'] == plan['selectionManifest']['sha256']
assert grant['acceptance'] is False
assert grant['dependencyIdentity'] == plan['dependency']['identity']
assert grant['retryOfPlanSha256'] == plan['retryOf']['planSha256']
for pin in [plan['selectionManifest'], *plan['codePins']]:
    path = Path(pin['path'])
    assert path.stat().st_size == pin['bytes'] and sha(path) == pin['sha256']
dependency = plan['dependency']
link = Path(dependency['linkPath'])
vendor = Path(dependency['vendorRoot'])
assert link == WORKTREE / 'server/node_modules' and not os.path.lexists(link), 'Dependency path must be absent; never replace an existing entry'
def verify_dependency():
    assert vendor.is_dir() and not vendor.is_symlink() and str(vendor.resolve()) == dependency['vendorRoot']
    entries = list(vendor.rglob('*'))
    assert not any(path.is_symlink() for path in entries), 'Pinned dependency tree cannot contain symlinks'
    assert sorted(str(path.relative_to(vendor)) for path in entries if path.is_file()) == dependency['members']
    for pin in [*dependency['filePins'], *dependency['lockPins']]:
        path = Path(pin['path'])
        assert path.stat().st_size == pin['bytes'] and sha(path) == pin['sha256'], 'Dependency bytes changed: ' + str(path)
verify_dependency()
for pin in plan['retryOf']['retainedFailurePins']:
    assert sha(Path(pin['path'])) == pin['sha256']
output = Path(plan['outputRoot'])
cloud = Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents
metadata = Path(plan['metadataRoot']) / args.phase
metadata.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('resources', WORKTREE / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
identity = {'run': plan['runId'], 'phase': args.phase, 'planSha256': args.reviewed_plan_sha256,
            'grantSha256': sha(args.root_release), 'codeIdentity': plan['codeIdentity'],
            'selectionManifestSha256': plan['selectionManifest']['sha256'],
            'environment': plan['environment'], 'python': sys.version,
            'dependencyIdentity': dependency['identity'], 'retryOfPlanSha256': plan['retryOf']['planSha256']}
link_manifest = metadata / ('dependency-ownership-' + uuid.uuid4().hex + '.json')
link_identity = None
link_record = {'owner': R.owner(), 'run': plan['runId'], 'phase': args.phase,
               'path': str(link), 'target': str(vendor), 'dependencyIdentity': dependency['identity'],
               'state': 'planned', 'device': None, 'inode': None}
R.atomic_json(link_manifest, link_record)
def ensure_dependency_link():
    global link_identity
    verify_dependency()
    assert link_identity is None and not os.path.lexists(link), 'Dependency path became occupied; preserve it'
    link.symlink_to(vendor, target_is_directory=True)
    st = link.lstat(); link_identity = (st.st_dev, st.st_ino)
    assert link.is_symlink() and link.resolve() == vendor
    link_record.update(state='created', device=st.st_dev, inode=st.st_ino)
    R.atomic_json(link_manifest, link_record)
def remove_dependency_link(groups_absent):
    global link_identity
    if link_identity is None:
        return []
    if not groups_absent:
        return ['owned dependency link retained because child group absence is unproved']
    try:
        st = link.lstat()
        assert link.is_symlink() and (st.st_dev, st.st_ino) == link_identity and link.resolve() == vendor
        link.unlink(); link_identity = None
        link_record.update(state='removed', absent=not os.path.lexists(link))
        R.atomic_json(link_manifest, link_record)
        return []
    except Exception as error:
        return ['owned dependency link cleanup unproved: ' + type(error).__name__]
def emergency_link_finalizer():
    ownership = [read(path) for path in (metadata / 'ownership').glob('*.json')]
    groups_absent = all(R.group_has_live_members(group) is False for row in ownership for group in row['groups'])
    issues = remove_dependency_link(groups_absent)
    if issues:
        R.atomic_json(metadata / 'dependency-cleanup-issue.json', {'issues': issues, 'manifest': str(link_manifest)})
atexit.register(emergency_link_finalizer)
is_summary = args.phase == 'summarize'
is_bridge = args.phase == 'collector-bridge'
if is_summary:
    assert len(grant['priorReceiptPins']) == len(plan['chunks']) + 1
    assert [p['path'] for p in grant['priorReceiptPins']] == [str(output / 'collector-bridge-receipt.json'), *[str(output / ('chunk-%d-receipt.json' % i)) for i in range(len(plan['chunks']))]]
    for pin in grant['priorReceiptPins']:
        assert sha(Path(pin['path'])) == pin['sha256']
    command = [plan['node'], '--max-old-space-size=256', str(BASE / 'summarize.mjs')]
elif is_bridge:
    for pin in plan['collectorBridge']['sourceFiles'].values():
        assert Path(pin['path']).stat().st_size == pin['bytes'] and sha(Path(pin['path'])) == pin['sha256']
    command = [plan['node'], '--max-old-space-size=256', str(BASE / 'collector-bridge.mjs')]
else:
    index = int(args.phase)
    assert str(index) == args.phase and 0 <= index < len(plan['chunks'])
    chunk = plan['chunks'][index]
    assert grant['selectedEntriesSha256'] == chunk['selectedEntriesSha256']
    assert grant['priorReceiptPins'] == [{'path': str(output / 'collector-bridge-receipt.json'),
                                        'sha256': sha(output / 'collector-bridge-receipt.json')}]
    assert read(output / 'collector-bridge-receipt.json')['status'] == 'scoped-passed'
    command = [plan['node'], '--max-old-space-size=256', str(BASE / 'proof.mjs'), args.phase]
selected = {'identity': identity, 'scope': 'scoped offline current-F60 common-session integration',
            'changedPaths': [str(BASE)], 'regression': plan['regression'],
            'affectedCallers': plan['affectedCallers'], 'integrationBoundaries': plan['integrationBoundaries'],
            'selectedCommands': [command], 'excluded': plan['excluded'], 'resourceBudget': plan['resources'],
            'ownedOutputRoot': str(output), 'ownedScratch': 'R.Scratch manifest outside absolute run-owned root',
            'cleanup': 'supervisor finalizer stops/joins group, checks open files and absence, removes owned dependency link and scratch',
            'dependencyIdentity': dependency['identity'], 'dependencyOwnershipManifest': str(link_manifest),
            'acceptance': False}
R.atomic_json(metadata / 'selection.json', selected)
policy = R.Policy({'chunk_scratch_mib': 16, 'chunk_ram_mib': 512,
                   'unit_ram_mib': 512, 'chunk_seconds': 180, 'log_mib': 1})
def callback(units, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
    ensure_dependency_link()
    result = R.run_process(command, WORKTREE,
        {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'TZ': 'UTC',
         'GCSP_OFFLINE': '1', 'REVIEWED_F60_PLAN_SHA256': args.reviewed_plan_sha256,
         'F60_CHUNK_INDEX': args.phase}, log, scratch, policy,
        min(disk_limit, 16 * R.MIB), min(ram_limit, 384 * R.MIB), 180, host, cancel)
    group_results = {str(group): R.group_has_live_members(group) for group in scratch.record['groups']}
    assert all(value is False for value in group_results.values()), 'Owned process group absence unproved'
    opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=10)
    assert opened.returncode in (0, 1) and not opened.stdout.strip(), 'Owned scratch still open'
    result['groupsAbsent'] = group_results
    if result['rc'] != 0 and not result.get('issue'):
        result.update(issue='proof phase exited %s; preserve partial progress and bounded failure log' % result['rc'], retryable=False)
    if result.get('issue'):
        result['retryable'] = False
    return result

result = None
try:
    # One live row is streamed at a time. Low disk headroom automatically reduces
    # the reservation from the16MiB cap to the2MiB atomic-checkpoint minimum.
    result = R.execute([{'id': args.phase, 'disk': 2 * R.MIB, 'ram': 512 * R.MIB, 'seconds': 180}],
        identity, WORKTREE, metadata, metadata / 'logs', policy, 1, callback, resume=True)
    R.atomic_json(metadata / 'execution-result.json', result)
finally:
    ownership = [read(path) for path in (metadata / 'ownership').glob('*.json')]
    scratch_absent = all(row['state'] == 'removed' and not os.path.lexists(row['root']) for row in ownership)
    groups_absent = all(R.group_has_live_members(group) is False for row in ownership for group in row['groups'])
    own_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    host_state = R.read_json(R.HostBudget(policy).path, {}) or {}
    reservations_absent = all(row['token'] not in host_state for row in ownership)
    leftovers = ([] if scratch_absent else ['owned scratch absence unproved']) + ([] if groups_absent else ['owned group absence unproved'])
    leftovers += remove_dependency_link(groups_absent)
    vendor_preserved = True
    try:
        verify_dependency()
    except Exception as error:
        vendor_preserved = False
        leftovers.append('immutable dependency bytes changed: ' + type(error).__name__)
    if os.path.lexists(link):
        leftovers.append('dependency path remains occupied; preserve entry unless exact ownership is established')
    if not reservations_absent:
        leftovers.append('owned host reservation remains')
    cleanup = {'scratchRoots': [row['root'] for row in ownership], 'scratchAbsent': scratch_absent,
               'groupsAbsent': groups_absent, 'reservationAbsent': reservations_absent,
               'removedScratchPeakBytes': sum(row['peak'] for row in ownership if row['state'] == 'removed'),
               'supervisorPeakRSSBytes': own_rss, 'retainedOutputRoot': str(output),
               'retainedLogicalBytes': sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),
               'dependencyOwnershipManifest': str(link_manifest), 'ownedDependencyLinkAbsent': not os.path.lexists(link),
               'dependencyIdentity': dependency['identity'], 'vendorPreserved': vendor_preserved,
               'compatibilityException': None, 'leftovers': leftovers, 'acceptance': False}
    R.atomic_json(metadata / 'cleanup.json', cleanup)
    assert not leftovers and own_rss < 128 * R.MIB
    atexit.unregister(emergency_link_finalizer)
R.atomic_json(ROOT / '.claude/test-runs/impact' / ('f60-exact10000-common-session-dependencyretry1-' + args.phase + '.json'),
    {'schemaVersion': 'test-impact.v1', 'scope': 'scoped', 'identity': identity,
     'selected': command, 'boundaries': plan['integrationBoundaries'], 'excluded': plan['excluded'],
     'completed': result['state'] == 'complete', 'timings': result['completed'], 'acceptance': False})
print(json.dumps({'phase': args.phase, 'state': result['state'], 'cleanup': cleanup}))
sys.exit(0 if result['state'] == 'complete' else 1)
