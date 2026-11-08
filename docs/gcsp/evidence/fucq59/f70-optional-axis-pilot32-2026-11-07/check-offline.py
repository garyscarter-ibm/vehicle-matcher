"""Scoped offline release/prefix and interrupted-source reconciliation checks. Zero HTTP."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, importlib.util, json, os, pathlib, shutil, subprocess, tempfile
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
put = lambda path, value: path.write_text(json.dumps(value, indent=2) + '\n')
spec = importlib.util.spec_from_file_location('release_context', BASE / 'release-context.py')
V = importlib.util.module_from_spec(spec); spec.loader.exec_module(V)
series = read(BASE / 'series-plan.json'); count = 0

def passed():
    global count
    count += 1

def refuses(fn):
    try: fn()
    except (AssertionError, FileNotFoundError, KeyError): passed(); return
    raise AssertionError('expected refusal')

subprocess.run(['/opt/homebrew/bin/node', str(BASE / 'check-prepared.mjs')], cwd=ROOT, check=True, timeout=30); passed()
for relative, expected in series['codePins'].items():
    path = ROOT / relative
    if path.suffix == '.py': compile(path.read_text(), str(path), 'exec')
    elif path.suffix == '.mjs': subprocess.run(['/opt/homebrew/bin/node', '--check', str(path)], check=True, timeout=5, capture_output=True)
    assert sha(path) == expected
passed()
assert not (BASE / 'parent-release.json').exists()
for grant, message in [(None, 'separate exact parent phase traffic grant required'), (series['phases']['pilot']['grantId'], 'parent-release.json')]:
    env = dict(os.environ); env.pop('F70_OPTIONAL_AXIS_PHASE_GRANT', None)
    if grant: env['F70_OPTIONAL_AXIS_PHASE_GRANT'] = grant
    result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py'), 'pilot'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0 and message in result.stderr, result.stderr[-1000:]
    assert not pathlib.Path(series['outputRoot']).exists() and not pathlib.Path(series['outputOwnershipManifest']).with_name('durable-series-pilot.json').exists()
    passed()
result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py'), 'suffix'], cwd=ROOT, capture_output=True, text=True, timeout=10)
assert result.returncode != 0 and 'only separately released pilot32' in result.stderr; passed()
base = {name: read(pathlib.Path(pin['path'])) for name, pin in series['preparedIndexPins'].items()}
V.validate_prefix(base['canonical'], base['spent'], base['canonical'], base['spent']); passed()
for mutation in ['canonical-id', 'canonical-origin', 'spent-order', 'duplicate-canonical', 'duplicate-spent']:
    canonical, spent = copy.deepcopy(base['canonical']), copy.deepcopy(base['spent'])
    if mutation == 'canonical-id': canonical['entries'].pop()
    elif mutation == 'canonical-origin': canonical['entries'][0]['origins'] = []
    elif mutation == 'spent-order': spent['entries'][0], spent['entries'][1] = spent['entries'][1], spent['entries'][0]
    elif mutation == 'duplicate-canonical': canonical['entries'].append(canonical['entries'][0])
    else: spent['entries'].append(spent['entries'][0])
    refuses(lambda: V.validate_prefix(base['canonical'], base['spent'], canonical, spent))
with tempfile.TemporaryDirectory(prefix='optional-axis-offline-', dir=os.environ.get('TMPDIR')) as temporary:
    scratch = pathlib.Path(temporary)
    release = read(BASE / 'parent-release.example.json'); release['released'] = True
    selected = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/g42-remaining-typed-pool-20261107-once/sessions/session001')
    release['strictProof'] = {'path': str(selected / 'live-validation.json'), 'sha256': sha(selected / 'live-validation.json')}
    selected_indexes = {}
    for name, filename in [('canonical', 'final-canonical-index.json'), ('spent', 'final-spent-request-index.json')]:
        path = selected / filename; value = read(path); selected_indexes[name] = value
        release['indexPins'][name] = {'path': str(path), 'sha256': sha(path), 'digest': V.digest(value), 'entries': len(value['entries'])}
    release['baseline'] = V.counts(selected_indexes['canonical'], selected_indexes['spent'])
    release_path = scratch / 'release.json'; put(release_path, release)
    actual = V.validate_release(series, release_path); assert actual[1:] == (selected_indexes['canonical'], selected_indexes['spent']); passed()
    for key in ['released', 'seriesPlanSha256', 'candidateManifestSha256', 'qualificationDate', 'finalGlobalUnionRequiredBeforeCumulativeCredit']:
        changed = copy.deepcopy(release); changed[key] = False if isinstance(changed[key], bool) else 'invalid'
        put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['indexPins']['spent']['sha256'] = '0'*64
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['concurrentDisjointLane']['modelCodes'].append('1F7A')
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    # Execute a copied read-only reconciler against a tiny primary with two reserved counts,
    # one actually started solver request and no final source receipt (interrupted executor).
    code = scratch / 'a/b/c/d/e'; code.mkdir(parents=True)
    shutil.copyfile(BASE / 'reconcile-retained.py', code / 'reconcile-retained.py')
    directory = scratch / 'actual'; directory.mkdir()
    put(code / 'series-plan.json', {'chunks': [{'outputDirectory': str(directory)}]})
    model = {'modelCode': '1F7A'}
    candidates = [{'candidateId': 'candidate-one', 'request': {'includedElements': ['FTEST', 'PTEST', 'S0337', 'STRIM', 'SWHEEL'], 'mandatoryElements': ['S0337']}}, {'candidateId': 'candidate-two', 'request': {'includedElements': ['FTEST', 'PTEST', 'S0337', 'SPACK', 'SWHEEL'], 'mandatoryElements': ['S0337']}}]
    plan = {'modelRegistration': model, 'candidates': candidates}
    prior = {'entries': [{'configurationId': 'base-id', 'origins': [{'kind': 'admitted-source', 'path': 'base'}]}]}; spent = {'entries': [{'requestDigest': 'old', 'outcome': 'accepted'}]}
    for filename, value in [('collection-plan.json', plan), ('prior-canonical-index.json', prior), ('spent-request-index.json', spent)]: put(directory / filename, value)
    state = {'accepted': [{'admission': True, 'sourceKind': 'dated-snapshot', 'configurationId': 'new-id'}], 'sourceCaptures': [{'candidateId': 'candidate-one'}], 'duplicates': [], 'rejected': [], 'counts': {'operations': {'solve': 2}}}
    envelope = {'content': state, 'contentDigest': V.digest(state)}
    put(directory / 'collector-checkpoint.json', envelope); shutil.copyfile(directory / 'collector-checkpoint.json', directory / 'collector-state.json')
    allocation = {'id': 'offline-fixture', 'codePins': {}, 'inputPins': {str(directory / filename): sha(directory / filename) for filename in ['collection-plan.json', 'prior-canonical-index.json', 'spent-request-index.json']}, 'priorIndexDigest': V.digest(prior), 'spentIndexDigest': V.digest(spent)}
    put(directory / 'execution-plan.json', allocation); put(directory / 'execution-once.json', {'id': allocation['id']}); put(directory / 'checkpoint-export.json', {'checkpointSha256': sha(directory / 'collector-checkpoint.json')})
    url = 'https://example.invalid/rulesolver/check/models/1F7A?included-elements=FTEST,PTEST,S0337,STRIM,SWHEEL&mandatory-elements=S0337'
    event = {'attempt': 1, 'phase': 'started', 'url': url}; (directory / 'source-events.jsonl').write_text(json.dumps(event) + '\n')
    result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(code / 'reconcile-retained.py'), '1'], capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    final = read(directory / 'final-spent-request-index.json'); assert len(final['entries']) == 2 and final['entries'][0] == spent['entries'][0]
    assert final['entries'][1]['requestDigest'] == V.digest({'modelRegistration': model, 'request': candidates[0]['request']})
    assert len(read(directory / 'final-canonical-index.json')['entries']) == 2; passed()
    for filename in ['final-spent-request-index.json', 'final-canonical-index.json', 'reconciliation-event-evidence.json']: (directory / filename).unlink()
    event['url'] = url.replace('STRIM', 'SOTHER'); (directory / 'source-events.jsonl').write_text(json.dumps(event) + '\n')
    result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(code / 'reconcile-retained.py'), '1'], capture_output=True, text=True, timeout=10)
    assert result.returncode != 0 and not (directory / 'final-spent-request-index.json').exists(); passed()
assert not pathlib.Path(series['outputRoot']).exists() and not (BASE / 'parent-release.json').exists()
print(json.dumps({'scope': 'scoped pilot preparation, release guards, prefix preservation and interrupted-source reconciliation', 'checks': count, 'pass': count, 'sourceTraffic': 0, 'sourceOutputAbsent': True, 'capacityCredit': 0}))
