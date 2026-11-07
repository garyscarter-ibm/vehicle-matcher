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
for grant, message in [(None, 'separate exact parent phase traffic grant required'), (series['phases']['suffix']['grantId'], 'parent-release.json')]:
    env = dict(os.environ); env.pop('F70_OPTIONAL_AXIS_PHASE_GRANT', None)
    if grant: env['F70_OPTIONAL_AXIS_PHASE_GRANT'] = grant
    result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py'), 'suffix'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0 and message in result.stderr, result.stderr[-1000:]
    assert not pathlib.Path(series['outputRoot']).exists() and not pathlib.Path(series['outputOwnershipManifest']).with_name('durable-series-suffix.json').exists()
    passed()
result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py'), 'pilot'], cwd=ROOT, capture_output=True, text=True, timeout=10)
assert result.returncode != 0 and 'only separately released suffix5535' in result.stderr; passed()
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
    selected = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f70-optional-axis-pilot32-20261107-once/sessions/session004')
    release['strictProof'] = {'path': str(selected / 'live-validation.json'), 'sha256': sha(selected / 'live-validation.json')}
    selected_indexes = {}
    for name, filename in [('canonical', 'final-canonical-index.json'), ('spent', 'final-spent-request-index.json')]:
        path = selected / filename; value = read(path); selected_indexes[name] = value
        release['indexPins'][name] = {'path': str(path), 'sha256': sha(path), 'digest': V.digest(value), 'entries': len(value['entries'])}
    release['baseline'] = V.counts(selected_indexes['canonical'], selected_indexes['spent'])
    release_path = scratch / 'release.json'; put(release_path, release)
    actual = V.validate_release(series, release_path); assert actual[1:] == (selected_indexes['canonical'], selected_indexes['spent']); passed()
    for key in ['released', 'seriesPlanSha256', 'candidateManifestSha256', 'qualificationDate', 'finalGlobalUnionRequiredBeforeCumulativeCredit', 'acknowledgedPilotOuterDiagnostic']:
        changed = copy.deepcopy(release); changed[key] = False if isinstance(changed[key], bool) else 'invalid'
        put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['indexPins']['spent']['sha256'] = '0'*64
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['concurrentDisjointLane']['modelCodes'].append('1F7A')
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed_series = copy.deepcopy(series)
    changed_series['chunks'][0]['requestDigests'][0] = selected_indexes['spent']['entries'][-1]['requestDigest']
    put(release_path, release); refuses(lambda: V.validate_release(changed_series, release_path))
    # Re-run the five existing actual retained checks on untouched pilot004 artifacts.
    # Only the proof script and its series pointer are copied into owned scratch;
    # read-only symlinks preserve normal import/code-pin resolution, with no source call.
    for name in ['scripts', 'server', 'docs', '_tools']:
        (scratch / name).symlink_to(ROOT / name, target_is_directory=True)
    code = scratch / 'a/b/c/d/e'; code.mkdir(parents=True)
    for name in ['live-check.test.mjs', 'actual-event-history.mjs']:
        shutil.copyfile(BASE / name, code / name)
    put(code / 'series-plan.json', {'chunks': [{'outputDirectory': str(selected)}]})
    env = dict(os.environ); env['F70_OPTIONAL_AXIS_CHECK_SESSION'] = '1'
    proof_inputs = {str(path): sha(path) for path in selected.rglob('*') if path.is_file()}
    result = subprocess.run(['/opt/homebrew/bin/node', '--test', '--test-isolation=none', '--test-concurrency=1', '--test-reporter=tap', str(code / 'live-check.test.mjs')], cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0 and '# tests 5' in result.stdout and '# pass 5' in result.stdout and '# fail 0' in result.stdout, result.stdout[-6000:] + result.stderr[-1000:]
    assert proof_inputs == {str(path): sha(path) for path in selected.rglob('*') if path.is_file()}
    passed()
    # The reconciler is byte-identical to the pilot implementation already proved with
    # no-receipt interruption and mismatched actual-event refusal. Reuse that evidence.
    pilot = ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-pilot32-2026-11-07'
    assert sha(BASE / 'reconcile-retained.py') == sha(pilot / 'reconcile-retained.py')
    assert read(pilot / 'offline-validation.json')['result']['pass'] == 21
    passed()
assert not pathlib.Path(series['outputRoot']).exists() and not (BASE / 'parent-release.json').exists()
print(json.dumps({'scope': 'scoped suffix preparation, release guards, prefix preservation and consumed-pilot replay refusal; unchanged interrupted-source reconciler evidence reused', 'checks': count, 'pass': count, 'sourceTraffic': 0, 'sourceOutputAbsent': True, 'capacityCredit': 0}))
