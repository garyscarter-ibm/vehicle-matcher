#!/usr/bin/env python3
"""Seal an offline dependency-link retry; never executes proof or installs dependencies."""
import sys
sys.dont_write_bytecode = True
import hashlib
import json
import os
from pathlib import Path
BASE = Path(__file__).resolve().parent
WORKTREE = BASE.parents[4]
ROOT = Path('/Users/usget/Claude/vehicle-matcher')
ORIGINAL = BASE.parent / 'exact10000-common-session-plan-2026-11-07'
ORIGINAL_SHA = '27452f15da2cc3900832815efb811387a982e7197a0d4bcfa67694b10e6cddcc'
sha = lambda value: hashlib.sha256(value).hexdigest()
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def pin(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': sha(data)}
assert pin(ORIGINAL / 'plan.json')['sha256'] == ORIGINAL_SHA
plan = json.loads((ORIGINAL / 'plan.json').read_bytes())
for item in [plan['selectionManifest'], *plan['codePins']]:
    assert pin(Path(item['path'])) == item, item['path']
for name in ['common.mjs', 'collector-bridge.mjs', 'proof.mjs', 'summarize.mjs']:
    assert (BASE / name).read_bytes() == (ORIGINAL / name).read_bytes(), 'Reuse unchanged script bytes'
metadata = ROOT / '.claude/test-runs/f60-exact10000-common-session-20261107/collector-bridge'
failed = json.loads((metadata / 'execution-result.json').read_bytes())
cleanup = json.loads((metadata / 'cleanup.json').read_bytes())
assert failed['state'] == 'incomplete' and failed['completed'] == {}
assert failed['identity']['planSha256'] == ORIGINAL_SHA
assert cleanup['scratchAbsent'] and cleanup['groupsAbsent'] and cleanup['reservationAbsent']
assert cleanup['removedScratchPeakBytes'] == cleanup['retainedLogicalBytes'] == 0 and cleanup['leftovers'] == []
assert not (Path(plan['outputRoot']) / 'collector-bridge-receipt.json').exists()
retained_failure = []
for original, name in [('logs/chunk-0001.log', 'module-import.log'), ('execution-result.json', 'execution-result.json'), ('cleanup.json', 'cleanup.json')]:
    assert (metadata / original).read_bytes() == (BASE / 'prior-failure' / name).read_bytes()
    retained_failure.append(pin(BASE / 'prior-failure' / name))
assert 'ERR_MODULE_NOT_FOUND' in (BASE / 'prior-failure/module-import.log').read_text()
assert "Cannot find package 'pg'" in (BASE / 'prior-failure/module-import.log').read_text()
vendor = Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
link = WORKTREE / 'server/node_modules'
assert vendor.is_dir() and not vendor.is_symlink() and not os.path.lexists(link)
entries = sorted(vendor.rglob('*'))
assert not any(path.is_symlink() for path in entries)
files = [path for path in entries if path.is_file()]
assert sum(path.stat().st_size for path in files) < 2 * 1024 * 1024
pg_package = json.loads((vendor / 'pg/package.json').read_bytes())
assert pg_package['name'] == 'pg' and pg_package['version'] == '8.23.1'
assert pg_package['exports']['.']['import'] == './esm/index.mjs'
dependency = {'linkPath': str(link), 'vendorRoot': str(vendor),
    'policy': 'Refuse an occupied link path. After child stop/join, unlink only the exact created symlink device/inode/target; never modify vendor, existing dependencies or installed environments.',
    'members': sorted(str(path.relative_to(vendor)) for path in files),
    'filePins': [pin(path) for path in files],
    'lockPins': [pin(path) for path in [vendor.parent / 'package-lock.json', vendor.parent / 'package.json', WORKTREE / 'server/package-lock.json', WORKTREE / 'server/package.json']],
    'package': {'name': pg_package['name'], 'version': pg_package['version'], 'exports': pg_package['exports']},
    'logicalBytes': sum(path.stat().st_size for path in files), 'installs': 0, 'sourceCalls': 0}
dependency['identity'] = sha(canonical(dependency))
old_code = plan['codePins']
new_code = []
for item in old_code:
    path = Path(item['path'])
    if path.parent == ORIGINAL:
        name = 'prepare-retry-plan.py' if path.name == 'prepare-plan.py' else path.name
        path = BASE / name
    new_code.append(pin(path))
new_code.sort(key=lambda item: item['path'])
plan.update(schemaVersion='f60-exact10000-common-session-dependency-retry.v1', status='prepared-unrun',
    runId='f60-exact10000-common-session-20261107-dependencyretry1',
    codePins=new_code, codeIdentity=sha(canonical(new_code)), dependency=dependency,
    outputRoot='/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-common-session-20261107-dependencyretry1',
    metadataRoot=str(ROOT / '.claude/test-runs/f60-exact10000-common-session-20261107-dependencyretry1'),
    retryOf={'plan': pin(ORIGINAL / 'plan.json'), 'planSha256': ORIGINAL_SHA,
             'state': 'incomplete', 'rc': 1, 'completedRows': 0, 'passCredit': 0,
             'retainedFailurePins': retained_failure,
             'originalFailurePins': [pin(metadata / name) for name in ['logs/chunk-0001.log', 'execution-result.json', 'cleanup.json']],
             'retryBasis': 'Static pg module-resolution failure before proof evaluation, original source replay or any enrichment row; fresh plan/grant/run identity, no successful work repeated.'})
assert not Path(plan['outputRoot']).exists() and not Path(plan['metadataRoot']).exists()
plan['resources']['dependencyLink'] = 'One owned symlink at032/server/node_modules; full139-file vendor tree is read-only and pinned; no archive/install/copy. Manifest before allocation, exact ownership removal after children stop, finally/termination finalizer and absence receipt.'
plan['resources']['cleanup'] += '; additionally remove only exact owned dependency symlink after group absence, verify vendor pins and record link absence'
plan['regression'] = 'Offline proof cannot resolve statically imported pg from policy/index.js in worktree032; bind existing installed vendor without changing proof semantics or production code'
plan['affectedCallers'] += ['Supervisor-only Node module resolution for statically imported pg; FilePolicyProvider remains selected']
plan['integrationBoundaries'] += ['Supervisor-owned server/node_modules link -> exact installed pg exports/transitive files; no Pool construction, SQL operation, install or source traffic']
plan['authority'] = 'Preparation confers no execution authority. Exact new plan SHA, dependency identity, predecessor plan SHA and per-phase parent release required; original failed run retains no pass credit.'
(BASE / 'plan.json').write_bytes(json.dumps(plan, indent=2).encode() + b'\n')
example = {'authorized': False, 'phase': 'collector-bridge', 'planSha256': pin(BASE / 'plan.json')['sha256'],
    'codeIdentity': plan['codeIdentity'], 'dependencyIdentity': dependency['identity'], 'retryOfPlanSha256': ORIGINAL_SHA,
    'selectionManifestSha256': plan['selectionManifest']['sha256'], 'selectedEntriesSha256': plan['chunks'][0]['selectedEntriesSha256'],
    'sourceCalls': 0, 'networkCalls': 0, 'acceptance': False, 'priorReceiptPins': [],
    'warning': 'Unauthorized example. Parent supplies exact reviewed per-phase release; no proof execution occurred during preparation.'}
(BASE / 'parent-release.UNAUTHORIZED.example.json').write_bytes(json.dumps(example, indent=2).encode() + b'\n')
print(json.dumps({'planSha256': pin(BASE / 'plan.json')['sha256'], 'codeIdentity': plan['codeIdentity'],
    'codePins': len(new_code), 'dependencyIdentity': dependency['identity'], 'dependencyFiles': len(files),
    'dependencyBytes': dependency['logicalBytes'], 'proofExecuted': False, 'linkCreated': False, 'scratchCreated': False}))
