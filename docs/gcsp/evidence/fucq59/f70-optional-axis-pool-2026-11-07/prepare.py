"""Freeze actual-core optional-axis candidates. No network, live runner or source grant."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, itertools, json, pathlib, subprocess

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
relative = lambda path: str(path.relative_to(ROOT)) if ROOT in path.parents else str(path)
def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream: stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

assert not (BASE / 'series-plan.json').exists(), 'preserve frozen preparation'
need_path = ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-need-2026-11-07/observed-need.json'
assert sha(need_path) == '0cb2830ad6e992187e1f3742beb206d29d827896cec717bbb04daa59e7708506'
need = read(need_path)
prior_base = ROOT / 'docs/gcsp/evidence/fucq59/f70-model-axis790-plan-2026-11-07'
prior_manifest = read(prior_base / 'candidate-manifest.json')
g42 = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-035/docs/gcsp/evidence/fucq59/g42-typed-pilot48-2026-11-07')
index_pins = {
    'canonical': {'path': str(g42 / 'final-canonical-index.json'), 'sha256': '5812a9802afce48c77fead80fef9394de479fd44b34ea5ffa1ecd6f2ae26c1d7'},
    'spent': {'path': str(g42 / 'final-spent-request-index.json'), 'sha256': '507e73d4014348adb4ff1cf4e0728851fd90ef3e6aadaa56f03fac485ab4c373'},
}
indexes = {}
for name, pin in index_pins.items():
    path = pathlib.Path(pin['path']); assert sha(path) == pin['sha256']
    indexes[name] = read(path); pin.update(entries=len(indexes[name]['entries']), digest=digest(indexes[name]))
baseline = {'canonical': len(indexes['canonical']['entries']),
    'admittedSource': sum(any(origin['kind'] == 'admitted-source' for origin in row['origins']) for row in indexes['canonical']['entries']),
    'spent': len(indexes['spent']['entries'])}
assert baseline == {'canonical': 1974, 'admittedSource': 1971, 'spent': 2684}
spent = {row['requestDigest'] for row in indexes['spent']['entries']}; assert len(spent) == baseline['spent']
source_pins = {relative(need_path): sha(need_path), relative(prior_base / 'candidate-manifest.json'): sha(prior_base / 'candidate-manifest.json')}
def pin(path):
    source_pins[relative(path)] = sha(path)
    return {'path': relative(path), 'sha256': source_pins[relative(path)]}

contexts = []
for observed in need['contexts']:
    options_path = pathlib.Path(observed['freshOptionsPath']); assert sha(options_path) == observed['freshOptionsSha256']
    options = read(options_path); assert options['observation']['transportKind'] == 'live'
    definitions = options['report']['candidates'][0]['definitions']
    good = [row for row in definitions if row['issues'] == [] and row['option'] == row['code'] and row['pointer'] == '/' + row['code']]
    context = {'modelRegistration': observed['modelRegistration'], 'lineRegistration': observed['lineRegistration'],
        'typedBasis': pin(options_path), 'typedDefinitions': good, 'baseCores': []}
    assert context['modelRegistration']['catalogueRangeKey'] == 'F70'
    context['mandatory'] = [context['lineRegistration']['optionsQuery']['code']] if context['lineRegistration']['optionsQuery']['kind'] == 'trim' else []
    contexts.append(context)

for entry in prior_manifest['chunks']:
    directory = pathlib.Path(entry['outputDirectory']); proof_path = directory / 'live-validation.json'; proof = read(proof_path)
    assert proof['retainedChecks']['summary'] == {'tests': 5, 'pass': 5, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert sha(directory / 'collector-checkpoint.json') == proof['primarySha256']
    for cleanup in [proof['cleanup'], proof['retainedCleanup']]:
        assert all(cleanup[key] for key in ['scratch_absent', 'groups_absent', 'dependency_link_absent', 'reservation_absent', 'code_identity_unchanged'])
    plan_path = directory / 'collection-plan.json'; plan = read(plan_path)
    accepted_path = directory / 'accepted.jsonl'; accepted_pin = pin(accepted_path)
    assert proof['retainedChecks']['identity'][str(accepted_path)] == accepted_pin['sha256']
    assert len(plan['candidates']) == entry['candidates']
    context = next(row for row in contexts if row['modelRegistration'] == plan['modelRegistration'])
    assert context['lineRegistration'] == plan['lineRegistration']
    proof_pin = pin(proof_path); plan_pin = pin(plan_path)
    by_code = {row['code']: row for row in context['typedDefinitions']}
    records = [json.loads(line) for line in accepted_path.read_text().splitlines()]
    assert len(records) == entry['candidates']
    for record in records:
        assert record['admission'] and record['sourceKind'] == 'dated-snapshot'
        assert record['canonicalIdentity']['vgModelCode'] == context['modelRegistration']['modelCode']
        assert record['canonicalIdentity']['agModelCode'] == context['modelRegistration']['agModelCode']
        selected = record['canonicalIdentity']['factoryOptionCodes']
        core = {kind: [code for code in selected if by_code.get(code, {}).get('optionType') == kind] for kind in ['paint', 'fabric', 'rim']}
        assert all(len(values) == 1 for values in core.values())
        values = sorted(next(iter(codes)) for codes in core.values())
        assert 'S01H0' not in values and all(code in selected for code in context['mandatory'])
        original = next(candidate for candidate in plan['candidates'] if candidate['request']['includedElements'] == sorted(values + context['mandatory']))
        solver_path = directory / 'solver' / (original['candidateId'] + '.json')
        assert sha(solver_path) == record['sourceEvidence']['solver']
        core_digest = digest({'modelRegistration': context['modelRegistration'], 'baseCore': values})
        axes = sorted(code for code in selected if by_code.get(code, {}).get('optionType') in ['trim', 'package'])
        context['baseCores'].append({'coreDigest': core_digest, 'inputs': values, 'observedAxisSelection': axes,
            'actualCanonicalDigest': digest(record['canonicalIdentity']), 'actualCandidateId': original['candidateId'],
            'actualCandidateRequest': original['request'], 'sourceSelectionSha256': record['sourceEvidence']['solver'],
            'sourceSolverPath': str(solver_path), 'accepted': accepted_pin, 'retainedProof': proof_pin, 'actualPlan': plan_pin})

queues = {}; all_candidates = {}; counts = {}; exclusions = ['S01H0', 'S0337', 'S033B']
for context in contexts:
    model = context['modelRegistration']['modelCode']; cores = context['baseCores']
    assert len(cores) == next(row['all790SeriesObservedAdmissions'] for row in need['contexts'] if row['modelCode'] == model)
    assert len({row['coreDigest'] for row in cores}) == len(cores)
    defaults = sorted({code for core in cores for code in core['observedAxisSelection']})
    context['observedDefaultAxisCodes'] = defaults
    additional = {kind: sorted(row['code'] for row in context['typedDefinitions'] if row['optionType'] == kind
        and row['code'] not in defaults + context['mandatory'] + exclusions) for kind in ['trim', 'package']}
    context['additionalAxes'] = additional
    variants = [list(codes) for codes in itertools.product([None] + additional['trim'], [None] + additional['package']) if any(codes)]
    variants = [[code for code in codes if code] for codes in variants]
    pool = []
    for core in cores:
        for extra in variants:
            request = {'includedElements': sorted(core['inputs'] + context['mandatory'] + extra), 'mandatoryElements': context['mandatory']}
            request_digest = digest({'modelRegistration': context['modelRegistration'], 'request': request})
            assert request_digest not in spent and request_digest not in all_candidates
            candidate = {'candidateId': 'candidate-' + digest({'model': model, 'request': request})[:24], 'request': request,
                'requestDigest': request_digest, 'coreDigest': core['coreDigest'], 'optionalInputs': sorted(extra)}
            all_candidates[request_digest] = candidate; pool.append(candidate)
    queues[model] = sorted(pool, key=lambda row: row['requestDigest'])
    counts[model] = len(pool); context['counts'] = {'actualCores': len(cores), 'optionalVariantsPerCore': len(variants), 'unspent': len(pool)}
assert counts == {'1F7A': 715, '1F7C': 2268, '1F7D': 1552, '1F7F': 1032}
assert len(all_candidates) == 5567 and sum(len(context['baseCores']) for context in contexts) == 790
identifier = 'f70-optional-axis5567-20261107-once'
output = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output') / identifier
assert not output.exists(), 'source output stays absent'
supervisor = ROOT / '.claude/f58-63-overnight-20261106/f58/f70-optional-axis5567'
selected_pilot = {context['modelRegistration']['modelCode']: [] for context in contexts}
for row in need['illustrativeUnspentRequests']:
    candidate = all_candidates[row['requestDigest']]; assert candidate['request'] == row['request']
    selected_pilot[row['modelCode']].append(candidate)
pilot_digests = {row['requestDigest'] for rows in selected_pilot.values() for row in rows}; assert len(pilot_digests) == 32
for model in queues: queues[model] = [row for row in queues[model] if row['requestDigest'] not in pilot_digests]
chunks = []; request_bases = []
def chunk(context, rows, phase):
    number = len(chunks) + 1; count = len(rows); model = context['modelRegistration']['modelCode']
    basis = next(entry for entry in prior_manifest['chunks'] if entry['modelCode'] == model)
    plan = copy.deepcopy(read(ROOT / basis['templatePath']))
    plan.update(planId=identifier + '-session%03d' % number, seed='f70-actual790-optional-axis-direct-product-20261107',
        target=count, candidateCount=count, candidates=[{'candidateId': row['candidateId'], 'request': row['request']} for row in rows])
    plan['source']['version'] = 'f59-model-axis-batch-20261107.v1'
    plan['limits'].update(maxCandidates=count, sourceAttempts=count + 4, sourceBytes=4194304, checkpointBytes=4194304, deadlineMs=120000,
        requestBudgets={'page': 1, 'settings': 1, 'discover': 1, 'options': 1, 'solve': count})
    template = BASE / 'templates' / ('session%03d.json' % number); put(template, plan)
    chunks.append({'number': number, 'phase': phase, 'cohort': (number - 1) // 4 + 1, 'modelCode': model, 'candidates': count,
        'maximumGets': count + 4, 'decodedBytes': 4194304, 'requestDigests': [row['requestDigest'] for row in rows],
        'templatePath': relative(template), 'templateSha256': sha(template), 'planDigest': digest(plan),
        'outputDirectory': str(output / 'sessions' / ('session%03d' % number)), 'supervisorOutput': str(supervisor / ('session%03d' % number))})
    request_bases.extend({'requestDigest': row['requestDigest'], 'coreDigest': row['coreDigest'], 'optionalInputs': row['optionalInputs']} for row in rows)
for context in contexts:
    rows = selected_pilot[context['modelRegistration']['modelCode']]; assert len(rows) == 8
    chunk(context, rows, 'pilot')
while any(queues.values()):
    for context in contexts:
        model = context['modelRegistration']['modelCode']; rows, queues[model] = queues[model][:8], queues[model][8:]
        if rows: chunk(context, rows, 'suffix')
assert len(request_bases) == len({row['requestDigest'] for row in request_bases}) == 5567
cohorts = [{'number': number, 'sessions': [entry['number'] for entry in chunks if entry['cohort'] == number],
    'solverCeiling': sum(entry['candidates'] for entry in chunks if entry['cohort'] == number),
    'getCeiling': sum(entry['maximumGets'] for entry in chunks if entry['cohort'] == number), 'maximumWallSeconds': 600}
    for number in sorted({entry['cohort'] for entry in chunks})]
manifest = {'schemaVersion': 'f70-optional-axis-candidate-manifest.v1', 'id': identifier, 'baseline': baseline, 'indexPins': index_pins,
    'contexts': contexts, 'fixedExcludedCodes': exclusions, 'sourcePins': source_pins, 'requestBases': request_bases,
    'chunks': chunks, 'cohorts': cohorts, 'perModelCandidates': counts, 'unspentCandidates': 5567,
    'trafficExecuted': False, 'sourceTrafficGranted': False, 'capacityCredit': 0, 'canonicalNovelty': 'unproven'}
put(BASE / 'candidate-manifest.json', manifest)
code_paths = list(read(ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-implementation-2026-11-07/validation.json')['codeTestIdentity'])
code_paths += ['scripts/gcsp/collect-fleet.mjs', 'scripts/gcsp/configuration-key.mjs', 'server/gcsp/repository/core.js',
    'server/gcsp/policy/index.js', 'server/gcsp/policy/file-provider.js', 'server/gcsp/policy/seed-v1.json',
    'server/vehicle-evidence/bmw-catalogue-adapter.js', 'server/vehicle-evidence/bmw-catalogue-v2.js', '_tools/test_resources.py']
code_paths += [relative(BASE / name) for name in ['prepare.py', 'check-prepared.mjs', 'README.md']]
code_pins = {path: sha(ROOT / path) for path in sorted(set(code_paths))}
phases = {phase: {'grantId': identifier + '-' + phase, 'sessions': [entry['number'] for entry in chunks if entry['phase'] == phase],
    'solverCeiling': sum(entry['candidates'] for entry in chunks if entry['phase'] == phase),
    'getCeiling': sum(entry['maximumGets'] for entry in chunks if entry['phase'] == phase), 'separateExactParentReleaseRequired': True}
    for phase in ['pilot', 'suffix']}
assert phases['pilot']['solverCeiling'] == 32 and phases['pilot']['getCeiling'] == 48 and phases['suffix']['solverCeiling'] == 5535
series = {'schemaVersion': 'f70-optional-axis-preparation.v1', 'id': identifier, 'status': 'candidate preparation only; no live runner or grant',
    'codeCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'codePins': code_pins, 'sourcePins': source_pins,
    'candidateManifestSha256': sha(BASE / 'candidate-manifest.json'), 'indexPins': index_pins, 'baseline': baseline,
    'candidateAllowance': 5567, 'attemptAllowance': sum(entry['maximumGets'] for entry in chunks), 'chunks': chunks, 'cohorts': cohorts, 'phases': phases,
    'outputRoot': str(output), 'outputOwnershipManifest': str(supervisor / 'ownership/durable-series.json'),
    'producerPins': {'projectorSha256': code_pins['scripts/gcsp/capture-bmw-selection.mjs'], 'qualifierSha256': code_pins['scripts/gcsp/bmw-selection-binding.mjs'],
        'sessionSha256': code_pins['scripts/gcsp/collection-session.mjs'], 'policyVersion': 'gcsp-policy-v1'},
    'resourcesForLaterRelease': {'workers': 1, 'scratchBytes': 64 * 1024**2, 'hostRamBytes': 512 * 1024**2,
        'perSessionSeconds': 120, 'perCohortSeconds': 600, 'directOneDrive': True, 'releaseSpecificAggregateReservationRequired': True},
    'releaseDependencies': ['fresh current global canonical/spent indexes including other-lane actuals', 'independent source-route/code review',
        'separate exact pilot and suffix source grants with supervised runner, retained proof and finalizer pins'],
    'trafficExecuted': False, 'sourceTrafficGranted': False, 'capacityCredit': 0, 'acceptance': False, 'noAutomaticContinuation': True,
    'targetContext': {'originalTarget': 10000, 'unprovenMaximumAfterThisPool': baseline['admittedSource'] + 5567,
        'stillUncoveredWithoutOtherLanes': max(0, 10000 - baseline['admittedSource'] - 5567), 'dateHold': 'FUCQ-61 bulk target remains after12November2026'}}
put(BASE / 'series-plan.json', series)
print(json.dumps({'status': 'prepared-only', 'pool': 5567, 'perModel': counts, 'sessions': len(chunks),
    'wholeGetCeiling': series['attemptAllowance'], 'pilot': phases['pilot'], 'suffix': {key: value for key, value in phases['suffix'].items() if key != 'sessions'},
    'sourceTraffic': 0, 'sourceOutputAbsent': not output.exists()}))
