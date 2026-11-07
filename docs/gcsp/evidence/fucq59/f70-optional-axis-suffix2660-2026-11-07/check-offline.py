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
subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'check-exclusions.py')], cwd=ROOT, check=True, timeout=15); passed()
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
assert result.returncode != 0 and 'only separately released suffix2660' in result.stderr; passed()
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
    selected = pathlib.Path(series['preparedIndexPins']['canonical']['path']).parent
    release['strictProof'] = series['preparedStrictProof']
    selected_indexes = {}
    for name, filename in [('canonical', 'final-canonical-index.json'), ('spent', 'final-spent-request-index.json')]:
        path = selected / filename; value = read(path); selected_indexes[name] = value
        release['indexPins'][name] = {'path': str(path), 'sha256': sha(path), 'digest': V.digest(value), 'entries': len(value['entries'])}
    release['baseline'] = V.counts(selected_indexes['canonical'], selected_indexes['spent'])
    release_path = scratch / 'release.json'; put(release_path, release)
    actual = V.validate_release(series, release_path); assert actual[1] == selected_indexes['canonical']; assert actual[2]['entries'] == selected_indexes['spent']['entries'] + read(pathlib.Path(series['conservativeExclusions']['path']))['entries']; selected_indexes['spent'] = actual[2]; passed()
    for key in ['released', 'seriesPlanSha256', 'candidateManifestSha256', 'qualificationDate', 'finalGlobalUnionRequiredBeforeCumulativeCredit', 'acknowledgedOriginalStoppedDiagnostic', 'preserveOriginalPhaseDeadline', 'conservativeExclusionsSha256', 'executionBaseline']:
        changed = copy.deepcopy(release); changed[key] = False if isinstance(changed[key], bool) else 'invalid'
        put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['indexPins']['spent']['sha256'] = '0'*64
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    changed = copy.deepcopy(release); changed['concurrentDisjointLane']['modelCodes'].append(series['chunks'][0]['modelCode'])
    put(release_path, changed); refuses(lambda: V.validate_release(series, release_path))
    spec = importlib.util.spec_from_file_location('group_proof', BASE / 'group-proof.py')
    G = importlib.util.module_from_spec(spec); spec.loader.exec_module(G)
    resources = type('OfflineResources', (), {'atomic_json': staticmethod(put)})
    for values, expected in [([False], True), ([True], False), ([None, False], True), ([None, None, None], False)]:
        answers = iter(values); report = scratch / 'group-report.json'
        assert G.prove_groups_absent(resources, [12345], report, query=lambda _: next(answers), pause=lambda _: None) is expected
        assert [row['liveMembers'] for row in read(report)['queries']] == values
        passed()
    changed_series = copy.deepcopy(series)
    changed_series['chunks'][0]['requestDigests'][0] = selected_indexes['spent']['entries'][-1]['requestDigest']
    put(release_path, release); refuses(lambda: V.validate_release(changed_series, release_path))
    # Re-run the five existing actual retained checks on untouched strict session019 artifacts.
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
    # A complete synthetic rejected-only previous session must permit the next
    # exact immutable template, retaining the consumed previous eight digests.
    fixture_output = scratch / 'fixture-output'; fixture_output.mkdir()
    previous = fixture_output / 'previous'; previous.mkdir()
    canonical = selected_indexes['canonical']; spent = copy.deepcopy(selected_indexes['spent'])
    first_plan = read(ROOT / series['chunks'][0]['templatePath'])
    for candidate, request_digest in zip(first_plan['candidates'], series['chunks'][0]['requestDigests']):
        spent['entries'].append({'candidateId': candidate['candidateId'], 'requestDigest': request_digest, 'outcome': 'rejected'})
    for filename, value in [('collector-checkpoint.json', {'synthetic': 'complete rejected-only previous session; no source claim'}), ('final-canonical-index.json', canonical), ('final-spent-request-index.json', spent)]: put(previous / filename, value)
    primary_sha = sha(previous / 'collector-checkpoint.json')
    put(previous / 'receipt.json', {'reason': 'queue-exhausted', 'newlyAccepted': 0, 'processedCandidates': 8, 'checkpointSha256': primary_sha})
    clean = {key: True for key in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged']}
    put(previous / 'live-validation.json', {'retainedChecks': {'summary': {'tests': 5, 'pass': 5, 'fail': 0, 'skipped': 0}}, 'primarySha256': primary_sha, 'finalCanonicalIndexSha256': sha(previous / 'final-canonical-index.json'), 'finalSpentRequestIndexSha256': sha(previous / 'final-spent-request-index.json'), 'cleanup': clean, 'retainedCleanup': clean})
    put(previous / 'checkpoint-export.json', {'checkpointSha256': primary_sha})
    fixture = copy.deepcopy(series); fixture['outputRoot'] = str(fixture_output)
    fixture['chunks'][0]['outputDirectory'] = str(previous)
    fixture['chunks'][1]['outputDirectory'] = str(fixture_output / 'next')
    fixture['chunks'][1]['supervisorOutput'] = str(scratch / 'fixture-supervisor')
    put(code / 'series-plan.json', fixture); shutil.copyfile(BASE / 'prepare-session.py', code / 'prepare-session.py')
    import datetime
    put(fixture_output / 'suffix-once.json', {'id': series['phases']['suffix']['grantId'], 'state': 'reserved-and-consumed', 'reservedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    put(fixture_output / 'output-ownership.json', {'allocationId': series['id']})
    env = dict(os.environ); env.update(F70_OPTIONAL_AXIS_STAGE=series['id'], F70_OPTIONAL_AXIS_PHASE_GRANT=series['phases']['suffix']['grantId'])
    result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(code / 'prepare-session.py'), '2'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert read(fixture_output / 'next' / 'spent-request-index.json') == spent
    assert read(fixture_output / 'next' / 'execution-plan.json')['baseline']['admittedSource'] == series['preparedBaseline']['admittedSource']
    passed()
    # Execute only the new outer run function with synthetic local children.
    # No source executor, candidate, grant or original artifact is invoked.
    import ast,datetime,signal,time
    tree=ast.parse((BASE/'run-series.py').read_text()); function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
    fixture_root=scratch/'stderr-fixture'; fixture_root.mkdir()
    namespace={'current':None,'phase':series['phases']['suffix'],'started':time.monotonic(),'original_deadline':datetime.datetime.fromisoformat(series['originalPhase']['deadlineAt']),'cohort_started':time.monotonic(),'series':series,'output':fixture_root,'children':[],'ROOT':ROOT,'name':'suffix','R':resources,'sha':sha,'subprocess':subprocess,'os':os,'signal':signal,'time':time,'datetime':datetime}
    exec(compile(ast.Module(body=[function],type_ignores=[]),'<isolated-outer-run>','exec'),namespace)
    status=namespace['run'](['/usr/bin/python3','-I','-B','-c',"import sys; sys.stderr.write('x'*70000+'TAIL-END\\n'); sys.exit(3)"],dict(os.environ),5,allow_failure=True)
    child=namespace['children'][-1]; retained=pathlib.Path(child['stderrPath']).read_bytes()
    assert status==child['exitCode']==3 and child['joined'] and child['stderrTailOnly'] and len(retained)==65536 and retained.endswith(b'TAIL-END\n') and sha(pathlib.Path(child['stderrPath']))==child['stderrSha256']; passed()
    try: namespace['run'](['/usr/bin/python3','-I','-B','-c',"import sys; print('first-cause fixture',file=sys.stderr); sys.exit(4)"],dict(os.environ),5)
    except AssertionError: pass
    else: raise AssertionError('nonzero owned stage must stop')
    child=namespace['children'][-1]; assert child['joined'] and child['exitCode']==4 and pathlib.Path(child['stderrPath']).read_text()=='first-cause fixture\n'; passed()
    # The reconciler is byte-identical to the pilot implementation already proved with
    # no-receipt interruption and mismatched actual-event refusal. Reuse that evidence.
    pilot = ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-pilot32-2026-11-07'
    assert sha(BASE / 'reconcile-retained.py') == sha(pilot / 'reconcile-retained.py')
    assert read(pilot / 'offline-validation.json')['result']['pass'] == 21
    passed()
assert not pathlib.Path(series['outputRoot']).exists() and not (BASE / 'parent-release.json').exists()
print(json.dumps({'scope': 'scoped suffix preparation, release guards, prefix preservation and consumed-original-prefix replay refusal; unchanged interrupted-source reconciler evidence reused', 'checks': count, 'pass': count, 'sourceTraffic': 0, 'sourceOutputAbsent': True, 'capacityCredit': 0}))
