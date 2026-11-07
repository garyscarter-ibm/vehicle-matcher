"""Freeze one explicit-trim options inspection allocation. Preparation makes no requests."""
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

context = ROOT / 'docs/gcsp/evidence/fucq59/f70-context-qualification-2026-11-07/context02'
diagnostic = ROOT / 'docs/gcsp/evidence/fucq59/f70-range-shape-diagnostic-2026-11-07'
full = read(context / 'tree.json'); tree = read(diagnostic / 'tree.json'); shape = read(diagnostic / 'range-shape.json')
assert full['observation']['responseSha256'] == tree['observation']['responseSha256'], 'historical full facts and line relationship require one exact response identity'
rows = {row['pointer']: row for row in shape['rows']}
relationship = {'/1/modelRanges/F70/lines/S0337/option': 'S0337',
    '/1/modelRanges/F70/lines/S0337/defaultModel/modelCode': '1F7B',
    '/1/modelRanges/F70/lines/S0337/defaultModel/agModelCode': '82GE',
    '/1/modelRanges/F70/lines/S0337/includedTransmissionVariants/3/configuration/modelCode': '1F7B'}
for pointer, value in relationship.items(): assert rows[pointer]['value'] == value
element = '/1/modelRanges/F70/lines/S0337/includedTransmissionVariants/3/configuration/elements/S0337'
assert rows[element]['type'] == 'object'
plan = read(context / 'qualification-plan.json')
plan.update(schemaVersion='bmw-source-options-plan.v1', planId='f70-1f7b-options-20261107')
plan['source']['version'] = 'f59-options-qualification-20261107.v1'
plan['modelRegistration']['optionsTrim'] = 'S0337'
plan['limits'].update(sourceAttempts=4, sourceBytes=4194304, responseBytes=1048576, deadlineMs=90000,
    checkpointBytes=4194304, requestBudgets={'page': 1, 'settings': 1, 'discover': 1, 'options': 1})
put(BASE / 'qualification-plan.json', plan)
provenance = {'schemaVersion': 'f70-options-source-relationship-provenance.v1',
    'fullContext': str((context / 'tree.json').relative_to(ROOT)), 'fullContextSha256': sha(context / 'tree.json'),
    'lineDiagnostic': str((diagnostic / 'range-shape.json').relative_to(ROOT)), 'lineDiagnosticSha256': sha(diagnostic / 'range-shape.json'),
    'lineDiagnosticContext': str((diagnostic / 'tree.json').relative_to(ROOT)), 'lineDiagnosticContextSha256': sha(diagnostic / 'tree.json'),
    'sharedRawTreeResponseSha256': full['observation']['responseSha256'], 'explicitSourceRelationships': relationship,
    'includedTrimElementPointer': element, 'elementTypes': 'Unobserved; no prefix-based classification is allowed.',
    'boundary': 'Historical actual source facts justify the exact options route only. All full model/AG/date/alias and line relationships must be freshly corroborated before the fourth GET. No constructibility or configuration count is established.'}
put(BASE / 'source-relationship-provenance.json', provenance)
retention = {'schemaVersion': 'f70-options-retained-deliverables.v1', 'primary': str(BASE / 'collector-checkpoint.json'),
    'disposable': False, 'retainOnInterruption': True, 'exportBeforeScratchCleanup': True,
    'exporter': str(ROOT / 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py'),
    'embeddedArtifacts': ['contextObservation', 'trimRelationships', 'optionsObservation'],
    'boundary': 'Retain the primary from its first write. The supervisor joins the child, invokes the existing checkpoint exporter and exports every durable safe artifact before scratch cleanup. No callback or lost response is capacity evidence.'}
put(BASE / 'retained-deliverables.json', retention)
old = read(diagnostic / 'execution-plan.json')
pins = {p: sha(ROOT / p) for p in old['codePins'] if not p.startswith(str(diagnostic.relative_to(ROOT)) + '/')}
for name in ['prepare.py', 'run-live.mjs', 'supervise.py', 'prepared-check.test.mjs', 'qualification-plan.json', 'retained-deliverables.json', 'source-relationship-provenance.json']:
    path = BASE / name; pins[str(path.relative_to(ROOT))] = sha(path)
pins['server/test/gcsp-bmw-options-qualification.test.js'] = sha(ROOT / 'server/test/gcsp-bmw-options-qualification.test.js')
allocation = {'schemaVersion': 'f70-one-context-options-execution-plan.v1', 'id': 'f70-1f7b-options-20261107-once',
    'status': 'prepared-unspent; no traffic grant', 'codeCommit': '924e8baecf31039373b500a9e2547b84d81cfee8',
    'planDigest': digest(plan), 'sourceVersion': plan['source']['version'], 'codePins': pins, 'preparerSha256': sha(pathlib.Path(__file__)),
    'actualSourceBasis': provenance, 'attempts': 4, 'requestSequence': ['page', 'settings', 'discover', 'options'],
    'optionsAllowance': 1, 'solverAllowance': 0, 'candidateAllowance': 0,
    'decodedBytes': 4194304, 'responseBytes': 1048576, 'operationProjectionBytes': 131072,
    'projection': 'Fresh full registered model/AG/dates and complete aliases; exact same-response explicit line/default/included relationship; directly keyed option/optionType/optional safe description definitions. No inferred types or configurations.',
    'forecast': {'decodedBytes': 1048576, 'retainedBytes': 2097152, 'childRamBytes': 134217728, 'sourceSeconds': 5},
    'sourceDeadlineSeconds': 90, 'supervisorChildSeconds': 105, 'supervisorChunkSeconds': 120,
    'resources': {'workers': 1, 'retries': 0, 'scratchBytes': 67108864, 'hostRamBytes': 536870912, 'childRamBytes': 469762048},
    'scratchRoot': '/tmp/vehicle-matcher-f58-63-20261106/f58/f70-options-qualification',
    'supervisorOutput': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-options-qualification',
    'retainedPrimary': str(BASE / 'collector-checkpoint.json'), 'retainedDeliverables': retention,
    'oneShotMarker': str(BASE / 'execution-once.json'), 'sourceCapacityCredit': 0, 'acceptance': False,
    'sourceGrantEnvironment': {'F70_OPTIONS_SOURCE_GRANT': 'f70-1f7b-options-20261107-once'},
    'commandAfterSeparateRelease': ['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), 'live'],
    'stop': ['access/rate/HTTP/shape/substitution/alias/date/relationship failure', 'projection/resource ceiling', 'identity mismatch', 'checkpoint export/cleanup failure'],
    'laterWork': 'Review actual typed definitions before proposing eight exact solver candidates. Fresh bootstrap replacement GETs belong to a separately counted later allocation; this plan grants zero solver traffic.'}
put(BASE / 'execution-plan.json', allocation)
put(BASE / 'execution-reservation.json', {'status': 'prepared-unspent-no-traffic-grant', 'allocationId': allocation['id'],
    'planDigest': allocation['planDigest'], 'executionPlanSha256': sha(BASE / 'execution-plan.json'),
    'exclusiveMarkerCreatedOnlyByLiveRunner': allocation['oneShotMarker']})
print(json.dumps({'allocationSha256': sha(BASE / 'execution-plan.json'), 'planDigest': digest(plan), 'sourceGrant': False}))
