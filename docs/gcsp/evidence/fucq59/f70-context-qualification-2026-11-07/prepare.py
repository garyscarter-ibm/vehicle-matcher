"""Freeze six evidence-derived qualification-only plans. Performs no HTTP."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, pathlib

ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032')
BASE = pathlib.Path(__file__).resolve().parent
read = lambda path: json.loads(path.read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()
digest = lambda value: sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())
def put(path, value):
    with path.open('x') as stream: stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
observation_path = ROOT / 'docs/gcsp/evidence/fucq-58/scheme-catalogue-2026-11-05/observation.json'
observation = read(observation_path)
models = next(row['models'] for row in observation['observations'] if row['requestedRange'] == 'F70')
models = sorted(models, key=lambda row: row['modelCode'])
assert [row['modelCode'] for row in models] == ['1F7A', '1F7B', '1F7C', '1F7D', '1F7E', '1F7F']
qualification_date = '2026-11-07'
source = {'id': 'bmw-uk-public', 'version': 'f59-context-qualification-20261107.v1', 'kind': 'public-bmw-uk'}
pilot = read(ROOT / 'docs/gcsp/evidence/fucq61/source-pilot10x32-2026-11-07/pilot-plan.json')
paths = list(pilot['sourceCodePins']) + [str((BASE / name).relative_to(ROOT)) for name in ['run-live.mjs', 'supervise.py']]
paths += ['_tools/test_resources.py', pilot['retention']['exporterPath']]
source_pins = {path: sha((ROOT / path).read_bytes()) for path in paths}
contexts = []
for index, model in enumerate(models, 1):
    name = 'context%02d' % index; target = BASE / name; target.mkdir(exist_ok=True)
    assert not (target / 'execution-once.json').exists() and not (target / 'collector-checkpoint.json').exists()
    aliases = sorted({path[0] for path in model['paths']})
    registration = {'schemaVersion': 'bmw-public-model-registration.v1', 'modelCode': model['modelCode'], 'agModelCode': model['agModelCode'],
       'catalogueRangeKey': model['catalogueRangeKey'], 'rawModelRange': model['modelRangeField'], 'aliases': aliases,
       'market': 'GB', 'locale': 'en-GB', 'steering': model['steeringLiteral'], 'catalogueDate': observation['requestedContext']['requestEffectDate'],
       'orderDate': model['orderDate'], 'effectDate': model['modelEffectDate']}
    limits = {'maxAttempts': 1, 'retryDelayMs': 0, 'concurrency': 1, 'imageRequests': 0, 'sourceAttempts': 3, 'sourceBytes': 4194304,
       'responseBytes': 1048576, 'operationTimeoutMs': 10000, 'deadlineMs': 90000, 'checkpointBytes': 4194304,
       'cacheEntries': 8, 'cacheRetentionMs': 86400000, 'requestBudgets': {'page': 1, 'settings': 1, 'discover': 1}}
    plan = {'schemaVersion': 'bmw-source-context-plan.v1', 'planId': 'f70-%s-context-20261107' % model['modelCode'].lower(),
       'qualificationDate': qualification_date, 'source': source, 'modelRegistration': registration, 'limits': limits}
    put(target / 'qualification-plan.json', plan)
    provenance = {'historicalCandidateSource': str(observation_path.relative_to(ROOT)), 'sourceSha256': sha(observation_path.read_bytes()),
       'sourceObservedAt': observation['observedAt'], 'actualModelPaths': model['paths'],
       'interpretation': 'Historical request/context pins only; every direct full fact and alias must be corroborated fresh before use; no trim/options/derivative/WMI/profile claim',
       'freshQualificationDate': qualification_date, 'optionsTrim': {'state': 'unknown', 'value': None}, 'optionsRequests': 0, 'solverRequests': 0}
    put(target / 'candidate-provenance.json', provenance)
    primary = target / 'collector-checkpoint.json'
    deliverables = {'schemaVersion': 'f70-retained-context-deliverables.v1', 'primary': str(primary), 'disposable': False,
       'retainOnInterruption': True, 'exportBeforeScratchCleanup': True, 'exporter': str(ROOT / pilot['retention']['exporterPath'])}
    put(target / 'retained-deliverables.json', deliverables)
    pins = {**source_pins, **{str((target / file).relative_to(ROOT)): sha((target / file).read_bytes()) for file in ['qualification-plan.json', 'candidate-provenance.json', 'retained-deliverables.json']}}
    allocation = {'schemaVersion': 'f70-context-execution-plan.v1', 'id': 'f70-context%02d-20261107-once' % index, 'status': 'prepared-unspent; root traffic review required',
       'codeCommit': '03f04ec812b0e8c6aa97850c2595173b6fa850d5', 'planDigest': digest(plan), 'sourceVersion': source['version'], 'codePins': pins,
       'attempts': 3, 'decodedBytes': 4194304, 'sourceDeadlineSeconds': 90, 'supervisorChildSeconds': 105, 'supervisorChunkSeconds': 120,
       'resources': {'workers': 1, 'scratchBytes': 67108864, 'hostRamBytes': 536870912, 'childRamBytes': 469762048, 'expectedRetainedBytes': 1048576},
       'scratchRoot': '/tmp/vehicle-matcher-f58-63-20261106/f58/f70-context/' + name,
       'supervisorOutput': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-context/' + name,
       'artifactDestination': str(target), 'retainedPrimary': str(primary), 'retainedDeliverables': deliverables,
       'oneShotMarker': str(target / 'execution-once.json'), 'solverAllowance': 0, 'optionsAllowance': 0,
       'sourceCapacityCredit': 0, 'acceptance': False}
    put(target / 'execution-plan.json', allocation)
    put(target / 'execution-reservation.json', {'status': 'prepared-unspent-no-traffic-grant', 'allocationId': allocation['id'],
       'planDigest': allocation['planDigest'], 'exclusiveMarkerCreatedOnlyByLiveRunner': allocation['oneShotMarker']})
    contexts.append({'context': name, 'modelCode': model['modelCode'], 'agModelCode': model['agModelCode'], 'directory': str(target),
       'planDigest': digest(plan), 'allocationSha256': sha((target / 'execution-plan.json').read_bytes()), 'attempts': 3, 'options': 0, 'solver': 0})
manifest = {'schemaVersion': 'f70-six-context-qualification-stage1.v1', 'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
   'status': 'prepared; no live traffic grant', 'sourceVersion': source['version'], 'contexts': contexts, 'codePins': source_pins,
   'preparerSha256': sha(pathlib.Path(__file__).read_bytes()), 'totalGetCeiling': 18, 'workers': 1, 'retries': 0,
   'optionsRequests': 0, 'solverRequests': 0, 'reservedButUnallocated': {'options': 6, 'solver': 48},
   'expectedRetainedBytes': 6291456, 'newConfigurationTarget': 0, 'acceptance': False,
   'stop': ['source/HTTP/shape/substitution/alias/date failure', 'resource ceiling', 'checkpoint export failure', 'identity mismatch'],
   'laterBudget': 'Fresh typed facts must freeze options/candidates. Any replacement settings/bootstrap calls need explicit accounting and a reviewed later allocation.'}
put(BASE / 'stage1-plan.json', manifest)
print(json.dumps({'contexts': len(contexts), 'gets': 18, 'options': 0, 'solver': 0, 'planDigest': digest(manifest), 'status': manifest['status']}))
