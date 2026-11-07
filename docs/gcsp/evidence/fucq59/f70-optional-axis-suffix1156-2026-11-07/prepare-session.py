"""Freeze one exact session from original templates and actual proved cumulative indexes. Zero HTTP."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, os, pathlib, time

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def put(path, value):
    with path.open('x') as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n'); stream.flush(); os.fsync(stream.fileno())

series = read(BASE / 'series-plan.json')
assert os.environ.get('F70_OPTIONAL_AXIS_STAGE') == series['id'], 'parent-released-stage-required'
assert len(sys.argv) == 2 and sys.argv[1].isdigit()
number = int(sys.argv[1]); assert 1 <= number <= len(series['chunks'])
entry = series['chunks'][number - 1]; phase = series['phases'][entry['phase']]
assert os.environ.get('F70_OPTIONAL_AXIS_PHASE_GRANT') == phase['grantId']
marker = read(pathlib.Path(series['outputRoot']) / (entry['phase'] + '-once.json'))
assert marker['id'] == phase['grantId'] and marker['state'] == 'reserved-and-consumed'
assert 0 <= time.time() - datetime.datetime.fromisoformat(marker['reservedAt'].replace('Z', '+00:00')).timestamp() < phase['maximumWallSeconds']
assert datetime.datetime.now(datetime.timezone.utc) < datetime.datetime.fromisoformat(series['originalPhase']['deadlineAt']), 'original absolute phase deadline exhausted'
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
assert all(sha(ROOT / p) == h for p, h in series['sourcePins'].items())
assert sha(ROOT / series['candidateManifestPath']) == series['candidateManifestSha256']
manifest = read(ROOT / series['candidateManifestPath'])
original = manifest['chunks'][entry['poolNumber'] - 1]
assert entry['originalCohort'] == original['cohort'] and entry['originalSuffixNumber'] == entry['poolNumber'] - 4
assert all(entry[key] == original[key] for key in original if key not in ['number', 'cohort', 'outputDirectory', 'supervisorOutput'])
plan = read(ROOT / entry['templatePath'])
assert sha(ROOT / entry['templatePath']) == entry['templateSha256'] and digest(plan) == entry['planDigest']
assert plan['source']['version'] == 'f59-model-axis-batch-20261107.v1' and 1 <= plan['candidateCount'] <= 8
if number == 1:
    import importlib.util
    spec = importlib.util.spec_from_file_location('release_context', BASE / 'release-context.py')
    release_context = importlib.util.module_from_spec(spec); spec.loader.exec_module(release_context)
    release, prior, spent = release_context.validate_release(series, pathlib.Path(series['outputRoot']) / 'parent-release.json')
    previous_proof = None
else:
    previous = pathlib.Path(series['chunks'][number - 2]['outputDirectory'])
    proof = read(previous / 'live-validation.json'); receipt = read(previous / 'receipt.json')
    summary = proof['retainedChecks']['summary']
    assert summary['tests'] == summary['pass'] == 5 and summary['fail'] == summary['skipped'] == 0
    assert receipt['reason'] == 'queue-exhausted'
    assert receipt['processedCandidates'] == series['chunks'][number - 2]['candidates']
    assert sha(previous / 'collector-checkpoint.json') == proof['primarySha256'] == receipt['checkpointSha256']
    assert sha(previous / 'final-canonical-index.json') == proof['finalCanonicalIndexSha256']
    assert sha(previous / 'final-spent-request-index.json') == proof['finalSpentRequestIndexSha256']
    for cleanup in [proof['cleanup'], proof['retainedCleanup']]:
        assert all(cleanup[k] for k in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged'])
    assert read(previous / 'checkpoint-export.json')['checkpointSha256'] == receipt['checkpointSha256']
    assert not (previous / 'checkpoint-export-failure.json').exists()
    prior = read(previous / 'final-canonical-index.json'); spent = read(previous / 'final-spent-request-index.json')
    previous_proof = {'path': str(previous / 'live-validation.json'), 'sha256': sha(previous / 'live-validation.json')}
used = {r['requestDigest'] for r in spent['entries']}
requests = [digest({'modelRegistration': plan['modelRegistration'], 'request': r['request']}) for r in plan['candidates']]
assert len(used) == len(spent['entries']) and requests == entry['requestDigests'] and not used.intersection(requests)
context = next(c for c in manifest['contexts'] if c['modelRegistration']['modelCode'] == entry['modelCode'])
assert plan['modelRegistration'] == context['modelRegistration'] and plan['lineRegistration'] == context['lineRegistration']
definitions = {r['code']: r for r in read(pathlib.Path(context['typedBasis']['path']))['report']['candidates'][0]['definitions']}
query = plan['lineRegistration']['optionsQuery']; mandatory = [query['code']] if query['kind'] == 'trim' else []
for candidate in plan['candidates']:
    request = candidate['request']; included = request['includedElements']
    assert request['mandatoryElements'] == mandatory and 4 + len(mandatory) <= len(included) <= 5 + len(mandatory) and included == sorted(set(included))
    assert 'S01H0' not in included and all(definitions[c]['issues'] == [] and definitions[c]['option'] == c for c in included)
    extra = [code for code in included if code not in mandatory and definitions[code]['optionType'] not in ['paint', 'fabric', 'rim']]
    assert all(sum(definitions[c]['optionType'] == kind for c in included if c not in mandatory) == 1 for kind in ['paint', 'fabric', 'rim'])
    assert 1 <= len(extra) <= 2 and all(definitions[code]['optionType'] in ['trim', 'package'] for code in extra)
    assert all(sum(definitions[code]['optionType'] == kind for code in extra) <= 1 for kind in ['trim', 'package'])
output = pathlib.Path(series['outputRoot']); target = pathlib.Path(entry['outputDirectory'])
assert output.is_dir() and output in target.parents and not target.exists()
assert read(output / 'output-ownership.json')['allocationId'] == series['id']
owner_manifest = pathlib.Path(entry['supervisorOutput']) / 'ownership/durable-output.json'
owner_manifest.parent.mkdir(parents=True, exist_ok=True)
put(owner_manifest, {'allocationId': series['id'] + '-session%03d' % number, 'ownerPid': os.getpid(), 'root': str(target),
    'disposable': False, 'retainOnInterruption': True, 'state': 'planned'})
target.mkdir(parents=True)
put(target / 'collection-plan.json', plan); put(target / 'prior-canonical-index.json', prior); put(target / 'spent-request-index.json', spent)
retention = {'schemaVersion': 'typed-axis-retained-deliverables.v1', 'primary': str(target / 'collector-checkpoint.json'),
    'disposable': False, 'retainOnInterruption': True, 'exportBeforeScratchCleanup': True, 'oneDriveDirect': True,
    'sourceShardBytes': series['resources']['perSessionRetainedShardBytes'], 'boundary': 'Actual strict binding and cumulative canonical admission only.'}
allocation = {'schemaVersion': 'f70-optional-axis-suffix1156-session-execution.v1', 'id': series['id'] + '-session%03d' % number,
    'phase': entry['phase'], 'cohort': entry['cohort'], 'status': 'prepared-unspent under exact separate parent phase release',
    'codeCommit': series['codeCommit'], 'codePins': series['codePins'], 'producerPins': series['producerPins'],
    'inputPins': {str(target / n): sha(target / n) for n in ['collection-plan.json', 'prior-canonical-index.json', 'spent-request-index.json']},
    'planDigest': digest(plan), 'priorIndexDigest': digest(prior), 'spentIndexDigest': digest(spent),
    'snapshotVersion': 'bmw-gb-optional-axis-suffix-%03d-2026-11-07.v2' % number, 'attempts': entry['maximumGets'], 'decodedBytes': entry['decodedBytes'],
    'candidateAllowance': entry['candidates'], 'solverAllowance': entry['candidates'], 'checkpointFile': 'collector-checkpoint.json',
    'supervisorOutput': entry['supervisorOutput'], 'artifactDestination': str(target), 'retainedPrimary': retention['primary'],
    'retainedDeliverables': retention, 'scratchRootPolicy': 'resource-helper-owned-default', 'requestDigests': requests,
    'baseline': {'canonical': len(prior['entries']), 'admittedSource': sum(any(o['kind'] == 'admitted-source' for o in r['origins']) for r in prior['entries']), 'spent': len(spent['entries'])},
    'actualSourceBasis': {'candidateManifestSha256': series['candidateManifestSha256'], 'context': {key: context[key] for key in ['modelRegistration', 'lineRegistration', 'typedBasis', 'additionalAxes']}, 'previousProof': previous_proof}}
put(target / 'retained-deliverables.json', retention); put(target / 'execution-plan.json', allocation)
put(target / 'execution-reservation.json', {'allocationId': allocation['id'], 'executionPlanSha256': sha(target / 'execution-plan.json'), 'status': 'prepared-unspent-under-phase-release'})
print(json.dumps({'session': number, 'candidates': entry['candidates'], 'getCeiling': entry['maximumGets'], 'executionPlanSha256': sha(target / 'execution-plan.json')}), flush=True)
