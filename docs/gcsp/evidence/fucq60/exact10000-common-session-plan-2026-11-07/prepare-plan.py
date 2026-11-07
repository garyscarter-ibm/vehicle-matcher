#!/usr/bin/env python3
"""Seal preparation metadata only. Never executes integration/source work."""
import sys
sys.dont_write_bytecode = True
import hashlib
import json
import re
import subprocess
from pathlib import Path
BASE = Path(__file__).resolve().parent
WORKTREE = BASE.parents[4]
ROOT = Path('/Users/usget/Claude/vehicle-matcher')
sha = lambda value: hashlib.sha256(value).hexdigest()
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def pin(path):
    value = path.read_bytes()
    return {'path': str(path), 'bytes': len(value), 'sha256': sha(value)}
manifest_path = Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-retained-coverage-20261107/selection-manifest.json')
manifest_pin = pin(manifest_path)
assert manifest_pin['sha256'] == '216359c111a5169d15a98de1c476a5c62714a3b3a7ee71431c325a45c90f096f'
manifest = json.loads(manifest_path.read_bytes())
assert len(manifest['entries']) == 10000
assert max(row['sourceByteLength'] for row in manifest['entries']) <= 128 * 1024
roots = ['scripts/gcsp/enrich-fleet.mjs', 'scripts/gcsp/collection-session.mjs',
         'scripts/gcsp/collect-fleet.mjs',
         'scripts/gcsp/configuration-key.mjs', 'server/vehicle-evidence/bmw-catalogue-adapter.js',
         'server/vehicle-evidence/bmw-catalogue-v2.js', 'server/gcsp/policy/index.js',
         'server/gcsp/repository/core.js']
visited = set()
def visit(path):
    path = path.resolve()
    if path in visited:
        return
    assert path.is_relative_to(WORKTREE)
    visited.add(path)
    for reference in re.findall(r'''(?:from\s*|import\s*\(|export\s*[^;]*?from\s*)['"](\.[^'"]+)['"]''', path.read_text()):
        dependency = (path.parent / reference).resolve()
        if dependency.is_file():
            visit(dependency)
for path in roots:
    visit(WORKTREE / path)
visited.add(WORKTREE / 'server/gcsp/policy/seed-v1.json')
visited.add(WORKTREE / '_tools/test_resources.py')
visited.update(BASE / name for name in ['common.mjs', 'proof.mjs', 'collector-bridge.mjs', 'summarize.mjs', 'supervise.py', 'prepare-plan.py'])
pins = [pin(path) for path in sorted(visited)]
pilot_path = WORKTREE / 'docs/gcsp/evidence/fucq60/pilot311-replay-results/chunk01-receipt.json'
pilot = json.loads(pilot_path.read_bytes())
pilot_plan_path = WORKTREE / 'docs/gcsp/evidence/fucq60/pilot311-replay-plans/chunk01.json'
pilot_plan = json.loads(pilot_plan_path.read_bytes())
pilot_source = ROOT / pilot_plan['sourceRelativeDirectory']
accepted_line = (pilot_source / 'accepted.jsonl').open('rb').readline()
accepted = json.loads(accepted_line)
checkpoint = json.loads((pilot_source / 'collector-state.json').read_bytes())['content']
capture = next(row for row in checkpoint['sourceCaptures'] if row['solver']['sha256'] == accepted['sourceEvidence']['solver'])
solver_file = 'solver/' + capture['candidateId'] + '.json'
bridge_pins = {}
for name in ['accepted.jsonl', 'collection-plan.json', 'execution-plan.json', 'collector-state.json', 'tree.json', 'options.json', solver_file]:
    actual = pin(pilot_source / name)
    assert actual['sha256'] == pilot_plan['sourceFiles'][name]['sha256'] and actual['bytes'] == pilot_plan['sourceFiles'][name]['bytes']
    bridge_pins[name] = actual
assert any(row['configurationId'] == accepted['configurationId'] for row in manifest['entries'])
reuse = []
for path, old in pilot['runtimePins'].items():
    current = pin(WORKTREE / path)
    reuse.append({'path': path, 'oldSha256': old, 'currentSha256': current['sha256'], 'unchanged': old == current['sha256']})
node = '/opt/homebrew/bin/node'
node_version = subprocess.check_output([node, '--version'], text=True).strip()
plan = {
    'schemaVersion': 'f60-exact10000-common-session-plan.v1', 'status': 'prepared-unrun',
    'runId': 'f60-exact10000-common-session-20261107', 'executionWorktree': str(WORKTREE), 'node': node,
    'environment': {'node': node_version, 'platform': 'darwin', 'arch': 'arm64', 'offline': True},
    'selectionManifest': manifest_pin, 'codePins': pins, 'codeIdentity': sha(canonical(pins)),
    'outputRoot': '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-common-session-20261107',
    'metadataRoot': str(ROOT / '.claude/test-runs/f60-exact10000-common-session-20261107'),
    'asOf': '2026-11-07', 'policyRead': {'runId': 'f60-retained10000-proof', 'asOf': '2026-11-07T00:00:00.000Z', 'policyVersion': 'gcsp-policy-v1'},
    'sessionLimits': {'requestBudgets': {'catalogue': 1}, 'maxAttempts': 1, 'operationTimeoutMs': 5000,
                      'deadlineMs': 15000, 'retryDelayMs': 0, 'concurrency': 1, 'imageRequests': 0,
                      'cacheEntries': 1, 'cacheRetentionMs': 86400000, 'checkpointBytes': 1048576},
    'collectorBridge': {'phase': 'collector-bridge', 'rows': 1, 'pilotPlanPin': pin(pilot_plan_path),
                        'sourceFiles': bridge_pins, 'acceptedLineBytes': len(accepted_line),
                        'acceptedLineSha256': sha(accepted_line), 'configurationIdSha256': sha(accepted['configurationId'].encode()),
                        'candidateId': capture['candidateId'], 'solverFile': solver_file,
                        'replayPlanId': 'f60-current-collector-one-bridge-20261107',
                        'purpose': 'Current actual collector admits one exact retained source capture, and F60 enriches through that same actual session with durable cache/deadline/reopen assertions. No source/live replay or additional cohort count.'},
    'chunks': [{'index': index, 'start': start, 'end': min(start + 64, 10000),
                'selectedEntriesSha256': sha(canonical(manifest['entries'][start:start + 64]))}
               for index, start in enumerate(range(0, 10000, 64))],
    'regression': 'Current F60 silently rejects, substitutes or loses exact retained context/selection; shared accounting/cache/cursor not durable',
    'affectedCallers': ['createConfigurationKey/PolicyService', 'createBmwCatalogueAdapter/strict V2 qualifier',
                        'createCollectionSession actual executor/checkpoint', 'enrichFleet current stage'],
    'integrationBoundaries': [
        'External sealed raw accepted-row SHA/offset/length authority -> exact original schema2 row, including historical source row',
        'Exact retained admission -> explicit initialState.accepted handoff in actual session; original collector admission is not replayed',
        'Actual catalogue adapter -> exact externally anchored V2 envelope qualification -> shared offline executor -> actual current F60',
        'Separate one-row pinned retained pilot capture -> current actual collector admission -> its same session -> current F60; current code identity and original exact capture/context verified',
        'Every row exact request/lookup/context/identity/full selection/accessory quantities/optional facts/paint/upholstery and five explicit technical unknowns',
        'Every row actual persisted accepted record, counts, cursor and output; first global row only durable-cache interrupt/reopen/deadline and finished-stage idempotence',
        'Exact ordered union10000/nonoverlap/current code/environment/manifest identity; historical candidate representation and supplements untouched',
    ],
    'resources': {'workers': 1, 'chunkRows': 64, 'chunks': 157, 'nodeHeapMiB': 256,
                  'groupRamMiB': 384, 'supervisorRamMiB': 128, 'hostReservationMiB': 512,
                  'scratchMiBCap': 16, 'scratchMiBMinimum': 2, 'checkpointMiBPerBulkRow': 1, 'chunkSecondsHard': 180,
                  'collectorBridge': 'One independent phase, same512MiB/16MiB/180s allocation, original finite source-plan limits but no HTTP operation installed',
                  'expectedRetainedOutputMiB': 16, 'estimatedTotalMinutes': '15-35; calibrate after first chunk; no unchanged replay',
                  'checkpoint': 'Atomic compact progress after each completed row outside scratch; matching incomplete chunk resumes completed prefix',
                  'placement': 'Retained compact outputs directly OneDrive; bounded active per-row JSON checkpoint in owned local scratch',
                  'compatibilityException': None,
                  'lowHeadroom': 'Only one row checkpoint lives at a time; resource supervisor automatically reduces the16MiB cap to available headroom above5GiB emergency reserve, with2MiB minimum for atomic checkpoint+staging. Exact minimum and incomplete scope recorded if indivisible row cannot fit; retain prefixes and continue independent safe work.',
                  'cleanup': 'Registered resource supervisor finalizer stop/join owned group, verify absence/open files, remove scratch, release reservation and retain bounded progress/failure receipts'},
    'reuse': {'pilotReceipt': pin(pilot_path), 'pilotRows': 311, 'pilotRuntimeComparison': reuse,
        'validScope': 'Unchanged policy/signature/V2 components and retained admission/cache observations at historical code identity only. Does not credit old311 outcomes as current whole-pipeline passes. Exactly one old retained capture is selected for a new current collector bridge.',
             'qualifiedImageTechnical': 'Retain exact existing qualified observations separately; no broadcast or bulk image/technical operation.'},
    'expected': {'rows': 10000, 'schema2AcceptedRows': 10000, 'historicalCandidateV1Rows': 1,
                 'strictV2CandidateRows': 9999, 'retainedObservedGroups': len(manifest['coverageGroups']),
                 'offlineCatalogueCalls': 10000, 'catalogueCacheHits': 1, 'partial': 10000, 'rejected': 0,
                 'unknownTechnicalRows': 10000, 'unknownImageRows': 10000},
    'sourceCalls': 0, 'networkCalls': 0,
    'excluded': ['Source/network/provider traffic and broad source admission replay', 'Original live-session enrichment/source qualification claim',
                 'Image/technical acquisition or guessed/broadcast facts', 'Production code/export changes',
                 'Historical candidateV1 representation, existing image associations and exact supplement mutation',
                 'Corpus publication/active HTTP consumer proof (Mike proof12 owns it)',
                 'Full suite, native stock/current-run/orderUUID, F58/profile/WMI gaps and Story acceptance'],
    'unrun': ['One-row current collector bridge', 'Every integration chunk', 'Current common-session final summary', 'Source/live/consumer/native/full suite'],
    'authority': 'Preparation confers no execution authority. Exact parent-reviewed plan SHA and per-phase release required.',
    'acceptance': False,
}
(BASE / 'plan.json').write_bytes(json.dumps(plan, indent=2).encode() + b'\n')
example = {'authorized': False, 'phase': 'collector-bridge', 'planSha256': sha((BASE / 'plan.json').read_bytes()),
           'codeIdentity': plan['codeIdentity'], 'selectionManifestSha256': manifest_pin['sha256'],
           'selectedEntriesSha256': plan['chunks'][0]['selectedEntriesSha256'],
           'sourceCalls': 0, 'networkCalls': 0, 'acceptance': False,
           'priorReceiptPins': [], 'warning': 'Unauthorized example only; parent creates exact reviewed release outside packet.'}
(BASE / 'parent-release.UNAUTHORIZED.example.json').write_bytes(json.dumps(example, indent=2).encode() + b'\n')
print(json.dumps({'planSha256': sha((BASE / 'plan.json').read_bytes()), 'codePins': len(pins), 'chunks': len(plan['chunks']),
                  'proofExecuted': False, 'sourceCalls': 0, 'scratchCreated': False}))
