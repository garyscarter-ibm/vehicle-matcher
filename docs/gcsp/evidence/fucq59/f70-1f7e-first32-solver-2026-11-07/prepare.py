"""Freeze the finite actual-type F70 candidates and latest cumulative index copies. No HTTP."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def put(path, value):
    with path.open('x') as stream: stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

plan = read(BASE / 'collection-plan.json'); prior = read(BASE / 'prior-canonical-index.json'); spent = read(BASE / 'spent-request-index.json')
provenance = read(BASE / 'candidate-provenance.json'); actual = read(ROOT / provenance['actualOptionsPath'])
assert sha(ROOT / provenance['actualOptionsPath']) == provenance['actualOptionsSha256']
assert len(plan['candidates']) == 32 and plan['limits']['sourceAttempts'] == 36
definitions = {row['code']: row for row in actual['report']['candidates'][0]['definitions']}
used = {row['requestDigest'] for row in spent['entries']}; planned = []
for row in plan['candidates']:
    request = row['request']; request_digest = digest({'modelRegistration': plan['modelRegistration'], 'request': request})
    assert request_digest not in used and request_digest not in planned
    assert len(request['includedElements']) == 4 and request['mandatoryElements'] == ['S033B']
    assert all(sum(definitions[code]['optionType'] == kind for code in request['includedElements']) == 1 for kind in ['paint', 'fabric', 'rim'])
    planned.append(request_digest)
old = read(BASE.parent / 'f70-options-qualification-2026-11-07/execution-plan.json')
prefix = str((BASE.parent / 'f70-options-qualification-2026-11-07').relative_to(ROOT)) + '/'
pins = {path: sha(ROOT / path) for path in old['codePins'] if not path.startswith(prefix)}
for name in ['prepare.py', 'run-live.mjs', 'supervise.py', 'prepared-check.test.mjs', 'collection-plan.json', 'prior-canonical-index.json', 'spent-request-index.json', 'retained-deliverables.json', 'candidate-provenance.json']:
    path = BASE / name; pins[str(path.relative_to(ROOT))] = sha(path)
retention = read(BASE / 'retained-deliverables.json')
allocation = {'schemaVersion': 'f70-first32-source-execution-plan.v1', 'id': 'f70-1f7e-first32-20261107-once',
    'status': 'prepared-unspent; no traffic grant', 'codeCommit': '89576947f193bc63c1ec5f1cec0912a26953f85c',
    'planDigest': digest(plan), 'priorIndexDigest': digest(prior), 'spentIndexDigest': digest(spent),
    'sourceVersion': plan['source']['version'], 'codePins': pins, 'preparerSha256': sha(pathlib.Path(__file__)),
    'producerPins': {'projectorSha256': sha(ROOT / 'scripts/gcsp/capture-bmw-selection.mjs'), 'qualifierSha256': sha(ROOT / 'scripts/gcsp/bmw-selection-binding.mjs'), 'sessionSha256': sha(ROOT / 'scripts/gcsp/collection-session.mjs'), 'policyVersion': plan['policyRead']['policyVersion']},
    'snapshotVersion': 'bmw-gb-1f7e-first32-2026-11-07.v2', 'attempts': 36, 'requestSequence': ['page', 'settings', 'discover', 'options', 'solve x32'],
    'optionsAllowance': 1, 'solverAllowance': 32, 'candidateAllowance': 32, 'decodedBytes': 8388608, 'responseBytes': 1048576,
    'sourceDeadlineSeconds': 120, 'supervisorChildSeconds': 165, 'supervisorChunkSeconds': 180,
    'forecast': {'decodedBytes': 1048576, 'retainedBytes': 8388608, 'childRamBytes': 268435456, 'sourceSeconds': 45},
    'resources': {'workers': 1, 'retries': 0, 'scratchBytes': 67108864, 'hostRamBytes': 536870912, 'childRamBytes': 469762048},
    'scratchRoot': '/tmp/vehicle-matcher-f58-63-20261106/f58/f70-1f7e-first32-solver',
    'supervisorOutput': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-1f7e-first32-solver',
    'artifactDestination': str(BASE), 'checkpointFile': 'collector-checkpoint.json', 'retainedPrimary': retention['primary'], 'retainedDeliverables': retention,
    'oneShotMarker': str(BASE / 'execution-once.json'), 'sourceCapacityCreditBeforeExecution': 0, 'acceptance': False,
    'sourceGrantEnvironment': {'F70_FIRST32_SOURCE_GRANT': 'f70-1f7e-first32-20261107-once'},
    'commandAfterSeparateRelease': ['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), 'live'],
    'actualSourceBasis': provenance, 'stop': ['access/rate/HTTP/shape/substitution/date/definition failure', 'resource or deadline ceiling', 'identity mismatch', 'checkpoint export or cleanup failure'],
    'knownDefects': ['FUCQ-151 Medium throughput; independently prioritised.', 'FUCQ-154 Medium fixed-scratch reconciliation; explicitly deferred, parent owns manual reconciliation if killed.'],
    'boundary': 'Only durable constructible source captures that pass existing strict binding and cumulative canonical deduplication count. Unknown optional model facts remain unknown. No full-story, publication or runtime acceptance.'}
put(BASE / 'execution-plan.json', allocation)
put(BASE / 'execution-reservation.json', {'status': 'prepared-unspent-no-traffic-grant', 'allocationId': allocation['id'],
    'planDigest': allocation['planDigest'], 'executionPlanSha256': sha(BASE / 'execution-plan.json'), 'exclusiveMarkerCreatedOnlyByLiveRunner': allocation['oneShotMarker']})
print(json.dumps({'executionPlanSha256': sha(BASE / 'execution-plan.json'), 'planDigest': allocation['planDigest'], 'priorIndexDigest': allocation['priorIndexDigest'], 'spentIndexDigest': allocation['spentIndexDigest'], 'sourceGrant': False}))
