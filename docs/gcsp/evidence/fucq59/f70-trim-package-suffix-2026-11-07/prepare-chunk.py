"""Freeze one exact typed-axis chunk after prior strict proof; zero HTTP."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, json, os, pathlib
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def put(path, value):
    with path.open('x') as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
series = read(BASE / 'series-plan.json')
assert os.environ.get('F70_TRIM_PACKAGE_SUFFIX_STAGE') == series['id'], 'parent-released-series-stage-required'
assert len(sys.argv) == 2 and sys.argv[1].isdigit()
number = int(sys.argv[1]); assert 2 <= number <= 9
manifest = read(BASE / 'candidate-manifest.json')
assert sha(BASE / 'candidate-manifest.json') == series['candidateManifestSha256']
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
entry = series['chunks'][number - 2]
assert entry == manifest['chunks'][number - 2]
previous = pathlib.Path(manifest['baselineDirectory'] if number == 2 else series['chunks'][number - 3]['outputDirectory'])
proof = read(previous / 'live-validation.json'); receipt = read(previous / 'receipt.json')
summary = proof['retainedChecks']['summary']
assert summary['tests'] == summary['pass'] == 5 and summary['fail'] == summary['skipped'] == 0
assert receipt['reason'] == 'queue-exhausted'
assert sha(previous / 'collector-checkpoint.json') == proof['primarySha256'] == receipt['checkpointSha256']
assert sha(previous / 'final-canonical-index.json') == proof['finalCanonicalIndexSha256']
assert sha(previous / 'final-spent-request-index.json') == proof['finalSpentRequestIndexSha256']
for cleanup in [proof['cleanup'], proof['retainedCleanup']]:
    assert all(cleanup[k] for k in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged'])
assert read(previous / 'checkpoint-export.json')['checkpointSha256'] == receipt['checkpointSha256']
assert not (previous / 'checkpoint-export-failure.json').exists()
plan = read(ROOT / entry['templatePath'])
assert sha(ROOT / entry['templatePath']) == entry['templateSha256'] and digest(plan) == entry['planDigest']
prior = read(previous / 'final-canonical-index.json'); spent = read(previous / 'final-spent-request-index.json')
used = {r['requestDigest'] for r in spent['entries']}
requests = [digest({'modelRegistration': plan['modelRegistration'], 'request': r['request']}) for r in plan['candidates']]
assert len(used) == len(spent['entries']) and len(set(requests)) == entry['candidates']
assert requests == entry['requestDigests'] and not used.intersection(requests)
options_path = ROOT / manifest['actualTypedBasis']['optionsPath']
assert sha(options_path) == manifest['actualTypedBasis']['optionsSha256']
definitions = {r['code']: r for r in read(options_path)['report']['candidates'][0]['definitions']}
for candidate in plan['candidates']:
    request = candidate['request']; included = request['includedElements']
    assert request['mandatoryElements'] == ['S033B'] and 5 <= len(included) <= 7 and included == sorted(set(included))
    assert all(code in definitions and definitions[code]['issues'] == [] for code in included)
    assert all(sum(definitions[code]['optionType'] == kind for code in included) == 1 for kind in ['paint', 'fabric', 'rim'])
    assert 'S01H0' not in included
output_root = pathlib.Path(series['outputRoot'])
target = pathlib.Path(entry['outputDirectory'])
assert output_root.is_dir() and output_root in target.parents and not target.exists()
assert read(output_root / 'output-ownership.json')['allocationId'] == series['id']
owner_manifest=pathlib.Path(entry['supervisorOutput'])/'ownership/durable-output.json'
owner_manifest.parent.mkdir(parents=True,exist_ok=True)
with owner_manifest.open('x') as stream:
    json.dump({'allocationId':series['id']+'-chunk%02d'%number,'ownerPid':os.getpid(),'root':str(target),'disposable':False,'retainOnInterruption':True,'state':'planned'},stream);stream.write('\n');stream.flush();os.fsync(stream.fileno())
target.mkdir(parents=True)
put(target / 'collection-plan.json', plan); put(target / 'prior-canonical-index.json', prior); put(target / 'spent-request-index.json', spent)
allocation = copy.deepcopy(read(pathlib.Path(manifest['baselineDirectory']) / 'execution-plan.json'))
retention = {'schemaVersion': 'typed-axis-retained-deliverables.v1', 'primary': str(target / 'collector-checkpoint.json'), 'disposable': False,
             'retainOnInterruption': True, 'exportBeforeScratchCleanup': True, 'oneDriveDirect': True,
             'sourceShardBytes': 33554432, 'boundary': 'Only actual strict solver binding and cumulative canonical dedup establish capacity.'}
allocation.update(id=series['id'] + '-chunk%02d' % number, status='prepared-unspent under exact parent series release',
    codeCommit=manifest['codeCommit'], codePins=series['codePins'],
    inputPins={str(target / name): sha(target / name) for name in ['collection-plan.json', 'prior-canonical-index.json', 'spent-request-index.json']},
    planDigest=digest(plan), priorIndexDigest=digest(prior), spentIndexDigest=digest(spent),
    preparerSha256=sha(BASE / 'prepare-chunk.py'), snapshotVersion='bmw-gb-trim-package-%02d-2026-11-07.v2' % number,
    attempts=entry['maximumGets'], candidateAllowance=entry['candidates'], solverAllowance=entry['candidates'],
    requestSequence=['page', 'settings', 'discover', 'options', 'solve x%d' % entry['candidates']],
    scratchRoot=entry['scratchRoot'], supervisorOutput=entry['supervisorOutput'], artifactDestination=str(target),
    retainedPrimary=retention['primary'], retainedDeliverables=retention, oneShotMarker=str(target / 'execution-once.json'),
    sourceGrantEnvironment={'F70_TRIM_PACKAGE_SUFFIX_SOURCE_GRANT': series['id'] + '-chunk%02d' % number},
    commandAfterSeparateRelease=['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), str(number)],
    actualSourceBasis={'candidateManifestSha256': series['candidateManifestSha256'], 'previousProof': str(previous / 'live-validation.json'),
                      'previousProofSha256': sha(previous / 'live-validation.json'), 'actualTypedBasis': manifest['actualTypedBasis']})
allocation.update(continuationReleased=True, requestDigests=requests,
    baseline={'canonical':len(prior['entries']), 'admittedSource':sum(any(o['kind']=='admitted-source' for o in row['origins']) for row in prior['entries']), 'spent':len(spent['entries'])},
    indexPins={name:{'path':str(target/file),'sha256':sha(target/file),'digest':digest(value),'entries':len(value['entries'])}
      for name,file,value in [('canonical','prior-canonical-index.json',prior),('spent','spent-request-index.json',spent)]})
put(target / 'retained-deliverables.json', retention); put(target / 'execution-plan.json', allocation)
put(target / 'execution-reservation.json', {'allocationId': allocation['id'], 'executionPlanSha256': sha(target / 'execution-plan.json'), 'status': 'prepared-unspent-under-series-release'})
print(json.dumps({'chunk': number, 'candidateAllowance': entry['candidates'], 'attemptAllowance': entry['maximumGets'], 'executionPlanSha256': sha(target / 'execution-plan.json')}), flush=True)
