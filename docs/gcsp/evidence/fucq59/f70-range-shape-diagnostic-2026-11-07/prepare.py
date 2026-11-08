"""Prepare one new bounded shape diagnostic; exclusive files, no source requests."""
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
prior = ROOT / 'docs/gcsp/evidence/fucq59/f70-context-qualification-2026-11-07'
plan = read(prior / 'context01/qualification-plan.json')
plan['planId'] = 'f70-1f7a-range-shape-20261107'
put(BASE / 'qualification-plan.json', plan)
retention = {'schemaVersion': 'f70-shape-retained-deliverables.v1', 'primary': str(BASE / 'collector-checkpoint.json'),
    'disposable': False, 'retainOnInterruption': True, 'exportBeforeScratchCleanup': True,
    'exporter': str(ROOT / 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py'),
    'embeddedShape': 'Primary retains the exact contextObservation/rangeShape artifacts even if standalone export is interrupted.'}
put(BASE / 'retained-deliverables.json', retention)
old = read(prior / 'stage1-plan.json')
pins = {p: sha(ROOT / p) for p in old['codePins'] if not p.startswith(str(prior.relative_to(ROOT)) + '/')}
for name in ['diagnostic-source.mjs', 'run-live.mjs', 'supervise.py', 'qualification-plan.json', 'retained-deliverables.json']:
    path = BASE / name; pins[str(path.relative_to(ROOT))] = sha(path)
allocation = {'schemaVersion': 'f70-one-context-range-shape-execution-plan.v1', 'id': 'f70-1f7a-range-shape-20261107-once',
    'status': 'prepared-unspent; no traffic grant', 'codeCommit': 'ad92507fd4091bc3bcbb5d00be093ce006171eaf',
    'planDigest': digest(plan), 'sourceVersion': plan['source']['version'], 'codePins': pins, 'preparerSha256': sha(pathlib.Path(__file__)),
    'actualSourceBasis': {'priorContextProjection': str((prior / 'context01/tree.json').relative_to(ROOT)),
        'priorContextSha256': sha(prior / 'context01/tree.json'),
        'historicalSiblingShape': 'docs/gcsp/evidence/fucq-58/steering-diagnostic-2026-11-05/evidence/projection.json',
        'historicalSiblingShapeSha256': sha(ROOT / 'docs/gcsp/evidence/fucq-58/steering-diagnostic-2026-11-05/evidence/projection.json'),
        'boundary': 'Historical G61E lines/defaultModel shape motivates inspection only; it supplies no F70 trim or label.'},
    'attempts': 3, 'requestSequence': ['page', 'settings', 'discover'], 'optionsAllowance': 0, 'solverAllowance': 0,
    'decodedBytes': 4194304, 'responseBytes': 1048576, 'projectionBytes': 98304, 'projectedRows': 768,
    'projection': 'Target1F7A full model nested structure and containing F70 range keys/types, known label/configuration containers only; other full model records and pricing/imagery/WLTP children excluded. Relevant primitive labels are source literals, never inferred trim.',
    'forecast': {'decodedBytes': 751668, 'retainedBytes': 2097152, 'childRamBytes': 134217728, 'sourceSeconds': 5},
    'sourceDeadlineSeconds': 90, 'supervisorChildSeconds': 105, 'supervisorChunkSeconds': 120,
    'resources': {'workers': 1, 'retries': 0, 'scratchBytes': 67108864, 'hostRamBytes': 536870912, 'childRamBytes': 469762048},
    'scratchRoot': '/tmp/vehicle-matcher-f58-63-20261106/f58/f70-range-shape',
    'supervisorOutput': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-range-shape',
    'retainedPrimary': str(BASE / 'collector-checkpoint.json'), 'retainedDeliverables': retention,
    'oneShotMarker': str(BASE / 'execution-once.json'), 'sourceCapacityCredit': 0, 'acceptance': False,
    'commandAfterSeparateRelease': ['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), 'live'],
    'stop': ['access/rate/HTTP/shape/substitution/alias/date failure', 'projection/resource ceiling', 'identity mismatch', 'checkpoint export/cleanup failure'],
    'laterWork': 'Review exact source relationships before proposing any options route; no options or solver request is allocated here.'}
put(BASE / 'execution-plan.json', allocation)
put(BASE / 'execution-reservation.json', {'status': 'prepared-unspent-no-traffic-grant', 'allocationId': allocation['id'],
    'planDigest': allocation['planDigest'], 'executionPlanSha256': sha(BASE / 'execution-plan.json'),
    'exclusiveMarkerCreatedOnlyByLiveRunner': allocation['oneShotMarker']})
print(json.dumps({'allocationSha256': sha(BASE / 'execution-plan.json'), 'planDigest': digest(plan), 'sourceGrant': False}))
