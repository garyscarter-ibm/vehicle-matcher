"""Freeze the complete directly typed unspent model-axis pool. No HTTP or source allocation."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, itertools, json, pathlib, subprocess

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
relative = lambda p: str(p.relative_to(ROOT))
def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

assert not (BASE / 'series-plan.json').exists(), 'preserve existing frozen preparation'
baseline = ROOT / 'docs/gcsp/evidence/fucq59/f70-trim-package-suffix-2026-11-07/actual'
index_pins = {
    'canonical': {'path': str(baseline / 'final-canonical-index.json'), 'sha256': 'e7d999556fddd2bb3e7170975272cc6a2da5880dc095d02a9e7bb3613468e6d1'},
    'spent': {'path': str(baseline / 'final-spent-request-index.json'), 'sha256': 'f1de84016579c549436231b111032853f73a919159ac14364e5cef005a594b3a'},
}
indexes = {}
for name, pin in index_pins.items():
    path = pathlib.Path(pin['path']); assert sha(path) == pin['sha256']
    indexes[name] = read(path); pin.update(digest=digest(indexes[name]), entries=len(indexes[name]['entries']))
admitted = sum(any(o['kind'] == 'admitted-source' for o in row['origins']) for row in indexes['canonical']['entries'])
assert (index_pins['canonical']['entries'], admitted, index_pins['spent']['entries']) == (1136, 1133, 1846)
index_pins['canonical']['admittedSourceEntries'] = admitted
used = {row['requestDigest'] for row in indexes['spent']['entries']}; assert len(used) == 1846
source = ROOT / 'docs/gcsp/evidence/fucq59/f70-remaining-options-qualification-2026-11-07'
prior_pilot = ROOT / 'docs/gcsp/evidence/fucq59/f70-model-breadth-pilot-plan-2026-11-07'
identifier = 'f70-model-axis790-20261107-once'
output = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output') / identifier
assert not output.exists(), 'new durable source root must remain absent before release'
supervisor = ROOT / '.claude/f58-63-overnight-20261106/f58/f70-model-axis790'
source_pins = {}; contexts = []; queues = {}; excluded = []
for code in ['1f7a', '1f7c', '1f7d', '1f7f']:
    basis = source / code; qualification = read(basis / 'qualification-plan.json')
    definitions = read(basis / 'options.json')['report']['candidates'][0]['definitions']
    good = [r for r in definitions if r['issues'] == [] and r.get('option') == r['code']]
    axes = {kind: sorted(r['code'] for r in good if r.get('optionType') == kind) for kind in ['paint', 'fabric', 'rim']}
    assert all(axes.values()) and all(len(values) == len(set(values)) for values in axes.values())
    model = qualification['modelRegistration']; line = qualification['lineRegistration']
    query = line['optionsQuery']; mandatory = [query['code']] if query['kind'] == 'trim' else []
    if mandatory:
        assert sum(r['code'] == mandatory[0] for r in good) == 1
    pool = []; counts = {'cartesian': 0, 'deferredS01H0': 0, 'spent': 0, 'unspent': 0}
    for values in itertools.product(*axes.values()):
        request = {'includedElements': sorted(set(values + tuple(mandatory))), 'mandatoryElements': mandatory}
        request_digest = digest({'modelRegistration': model, 'request': request})
        counts['cartesian'] += 1
        if 'S01H0' in values:
            counts['deferredS01H0'] += 1
            excluded.append({'modelCode': model['modelCode'], 'request': request, 'requestDigest': request_digest, 'reason': 'S01H0-explicit-deferral'})
        elif request_digest in used:
            counts['spent'] += 1
            excluded.append({'modelCode': model['modelCode'], 'request': request, 'requestDigest': request_digest, 'reason': 'already-spent-cumulative-index'})
        else:
            counts['unspent'] += 1
            pool.append({'candidateId': 'candidate-' + digest({'model': model['modelCode'], 'request': request})[:24],
                         'request': request, 'requestDigest': request_digest})
    queues[code] = sorted(pool, key=lambda row: row['requestDigest'])
    paths = [basis / n for n in ['qualification-plan.json', 'tree.json', 'options.json', 'line-relationships.json', 'receipt.json']]
    for path in paths: source_pins[relative(path)] = sha(path)
    contexts.append({'id': code, 'modelRegistration': model, 'lineRegistration': line, 'axes': axes, 'counts': counts,
        'typedBasisPath': relative(basis / 'options.json'), 'typedBasisSha256': sha(basis / 'options.json'),
        'typedDefinitions': [r for r in good if r.get('optionType') in axes],
        'lineDefinition': next((r for r in good if mandatory and r['code'] == mandatory[0]), None),
        'cataloguePhysicalProfile': 'unqualified: no inferred model-year, plant or WMI', 'constructibility': 'unverified-candidates-only'})
assert [c['counts']['unspent'] for c in contexts] == [143, 324, 194, 129]
assert sum(c['counts']['cartesian'] for c in contexts) == 996
assert sum(c['counts']['deferredS01H0'] for c in contexts) == 202
assert sum(c['counts']['spent'] for c in contexts) == 4
chunks = []; all_digests = []
while any(queues.values()):
    for context in contexts:
        code = context['id']; selected, queues[code] = queues[code][:8], queues[code][8:]
        if not selected: continue
        number = len(chunks) + 1; count = len(selected)
        plan = copy.deepcopy(read(prior_pilot / code / 'collection-plan.json'))
        plan.update(planId=identifier + '-session%03d' % number, seed='f70-model-axis790-direct-sorted-digests-20261107',
                    target=count, candidateCount=count, candidates=[{'candidateId': r['candidateId'], 'request': r['request']} for r in selected])
        plan['limits'].update(maxCandidates=count, sourceAttempts=count + 4, sourceBytes=4194304, checkpointBytes=4194304, deadlineMs=120000,
            requestBudgets={'page': 1, 'settings': 1, 'discover': 1, 'options': 1, 'solve': count})
        assert plan['source']['version'] == 'f59-model-batch-20261107.v1'
        template = BASE / 'templates' / ('session%03d.json' % number); put(template, plan)
        request_digests = [r['requestDigest'] for r in selected]; all_digests.extend(request_digests)
        chunks.append({'number': number, 'phase': 'pilot' if number <= 4 else 'suffix', 'cohort': (number - 1) // 4 + 1,
            'modelCode': context['modelRegistration']['modelCode'], 'candidates': count, 'maximumGets': count + 4,
            'decodedBytes': 4194304, 'requestDigests': request_digests, 'templatePath': relative(template), 'templateSha256': sha(template),
            'planDigest': digest(plan), 'outputDirectory': str(output / 'sessions' / ('session%03d' % number)),
            'supervisorOutput': str(supervisor / ('session%03d' % number))})
assert len(chunks) == 101 and len(all_digests) == len(set(all_digests)) == 790 and not used.intersection(all_digests)
cohorts = [{'number': n, 'phase': 'pilot' if n == 1 else 'suffix', 'sessions': [e['number'] for e in chunks if e['cohort'] == n],
    'solverCeiling': sum(e['candidates'] for e in chunks if e['cohort'] == n),
    'getCeiling': sum(e['maximumGets'] for e in chunks if e['cohort'] == n), 'maximumWallSeconds': 600}
    for n in sorted({e['cohort'] for e in chunks})]
assert all(c['solverCeiling'] <= 32 and c['getCeiling'] <= 48 for c in cohorts)
phases = {name: {'grantId': identifier + '-' + suffix, 'sessions': [e['number'] for e in chunks if e['phase'] == name],
    'solverCeiling': sum(e['candidates'] for e in chunks if e['phase'] == name),
    'getCeiling': sum(e['maximumGets'] for e in chunks if e['phase'] == name), 'maximumWallSeconds': seconds,
    'separateExactParentReleaseRequired': True, 'clockStartsAtConsumedMarkerAfterRelease': True}
    for name, suffix, seconds in [('pilot', 'pilot32', 300), ('suffix', 'suffix758', 3600)]}
assert (phases['pilot']['solverCeiling'], phases['pilot']['getCeiling'], phases['suffix']['solverCeiling'], phases['suffix']['getCeiling']) == (32, 48, 758, 1146)
manifest = {'schemaVersion': 'f70-model-axis790-candidate-manifest.v1', 'id': identifier, 'baseline': {'canonical': 1136, 'admittedSource': 1133, 'spent': 1846},
    'indexPins': index_pins, 'contexts': contexts, 'excludedRequests': excluded, 'sourcePins': source_pins,
    'requestDigests': all_digests, 'chunks': chunks, 'cohorts': cohorts, 'capacityCredit': 0, 'trafficExecuted': False}
put(BASE / 'candidate-manifest.json', manifest)
policy = read(ROOT / 'server/gcsp/policy/seed-v1.json')
def policy_lines(value):
    if isinstance(value, dict):
        if 'model' in value and 'engine' in value and 'FS&UK Choices' in value.get('basis', ''):
            yield (value['model'], value['engine'])
        for child in value.values(): yield from policy_lines(child)
    elif isinstance(value, list):
        for child in value: yield from policy_lines(child)
scheme = {}
for model, engine in sorted(set(policy_lines(policy))): scheme.setdefault(model, []).append(engine)
gap = {'schemaVersion': 'f70-model-axis790-scheme-context-gaps.v1',
    'basis': 'Existing FS&UK Choices October2024 policy transcription; model keys are demo assumptions, not BMW catalogue mappings.',
    'policyPath': 'server/gcsp/policy/seed-v1.json', 'policySha256': sha(ROOT / 'server/gcsp/policy/seed-v1.json'),
    'schemeModelLines': [{'modelLine': model, 'engines': engines,
        'sourceState': 'actual F70 catalogue/line/options context only; exact dated scheme-engine mapping remains separate' if model == 'F70 Sports Hatch' else 'not qualified by this series'} for model, engines in scheme.items()],
    'historicalDiscoveryLeadsOnly': [{'range': r, 'seed': s, 'observedDate': '2026-10-18'} for r, s in [('G42', '2PMC'), ('G21', 'T3PF'), ('U11', 'X1S0'), ('U10', 'IXS4'), ('G26E', 'I4PC'), ('I20', 'IXSC')]],
    'g42': {'furtherTraffic': 0, 'pendingBug': 'local Medium draft; parent owns Jira reference',
        'evidencePath': 'docs/gcsp/evidence/fucq59/g42-range-inventory-contract-2026-11-07',
        'primarySha256': '6525fcd590931c04ed47bfaacacc17de3217f6a174934bcc43eb0cc7cbe539e2',
        'spentFailures': ['source-inventory-line-limit', 'source-inventory-line-key'],
        'unknown': 'Exact rejected live line/variant key and path; no raw tree or safe diagnostic retained.'},
    'f44': 'One historical requested tree response was unmatched; this does not prove global unavailability.',
    'physicalProfile': {'status': 'unqualified', 'modelYear': None, 'plant': None, 'wmi': None, 'profileActivations': 0},
    'remainingToTarget': 10000 - 1133, 'maximumPossibleAfterThisSeries': 1133 + 790,
    'guaranteedAdmissions': 0, 'acceptance': False, 'dateHold': 'FUCQ-61 bulk target remains after12November2026 if still wanted.'}
put(BASE / 'scheme-context-gaps.json', gap)
code_paths = ['scripts/gcsp/bmw-public-registration.mjs', 'scripts/gcsp/public-bmw-source.mjs', 'scripts/gcsp/collection-session.mjs',
    'scripts/gcsp/collect-fleet.mjs', 'scripts/gcsp/configuration-key.mjs', 'scripts/gcsp/bmw-selection-binding.mjs', 'scripts/gcsp/capture-bmw-selection.mjs',
    'scripts/gcsp/bmw-source-qualification.mjs', 'scripts/gcsp/settings-shape-report.mjs', 'server/gcsp/repository/core.js',
    'server/gcsp/policy/index.js', 'server/gcsp/policy/file-provider.js', 'server/gcsp/policy/seed-v1.json', 'server/vehicle-evidence/bmw-catalogue-adapter.js',
    'server/vehicle-evidence/bmw-catalogue-v2.js', 'server/gcsp/repository/schema.js', '_tools/test_resources.py',
    'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py']
code_paths += [relative(BASE / n) for n in ['prepare.py', 'prepare-session.py', 'run-series.py', 'run-live.mjs', 'supervise.py', 'verify-retained.py',
    'reconcile-retained.py', 'live-check.test.mjs', 'actual-event-history.mjs', 'check-offline.py', 'check-prepared.mjs', 'README.md']]
code_pins = {p: sha(ROOT / p) for p in code_paths}
series = {'schemaVersion': 'f70-model-axis790-series-plan.v1', 'id': identifier, 'status': 'prepared-unspent; offline only until exact parent release',
    'codeCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'codePins': code_pins, 'sourcePins': source_pins,
    'candidateManifestSha256': sha(BASE / 'candidate-manifest.json'), 'schemeContextGapsSha256': sha(BASE / 'scheme-context-gaps.json'),
    'indexPins': index_pins, 'baseline': manifest['baseline'], 'candidateAllowance': 790, 'attemptAllowance': 1194, 'decodedBytes': len(chunks) * 4194304,
    'outputRoot': str(output), 'outputOwnershipManifest': str(supervisor / 'ownership' / 'durable-series.json'),
    'chunks': chunks, 'cohorts': cohorts, 'phases': phases, 'retries': 0, 'automaticRedirects': 0, 'browser': 0, 'images': 0, 'sourceWrites': 0,
    'producerPins': {'projectorSha256': code_pins['scripts/gcsp/capture-bmw-selection.mjs'], 'qualifierSha256': code_pins['scripts/gcsp/bmw-selection-binding.mjs'],
        'sessionSha256': code_pins['scripts/gcsp/collection-session.mjs'], 'policyVersion': 'gcsp-policy-v1'},
    'resources': {'workers': 1, 'hostRamBytes': 512 * 1024**2, 'childRamBytes': 448 * 1024**2, 'scratchBytes': 64 * 1024**2,
        'perSessionSeconds': 120, 'retainedCheckSeconds': 30, 'perCohortSeconds': 600, 'expectedRetainedBytes': 320 * 1024**2,
        'retainedBudgetBytes': 1024**3, 'perSessionRetainedShardBytes': 16 * 1024**2, 'peakIncludingRetainedBudgetBytes': 1024**3 + 64 * 1024**2,
        'largeOutputThresholdBytes': 256 * 1024**2, 'directOneDrive': True, 'scratchRootPolicy': 'resource-helper-owned-default'},
    'trafficExecuted': False, 'capacityCredit': 0, 'acceptance': False, 'noAutomaticContinuation': True,
    'stop': 'First failed, incomplete, duplicate-only or resource-incomplete session stops; preserve spent prefix, never retry or substitute.',
    'remaining': ['actual scheme model-line catalogue context beyond F70', 'qualified physical model-year/plant/WMI profiles',
        'actual strict source outcomes and canonical admission', 'F60 enrichment/publication/application integration', 'post12November F61 target10000 acceptance']}
put(BASE / 'series-plan.json', series)
print(json.dumps({'status': 'prepared-only', 'id': identifier, 'solverCeiling': 790, 'getCeiling': 1194, 'sessions': 101,
    'pilot': phases['pilot'], 'suffix': phases['suffix'], 'sourceTraffic': 0, 'sourceOutputAbsent': not output.exists()}))
