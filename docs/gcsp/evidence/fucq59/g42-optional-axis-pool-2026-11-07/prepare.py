"""Freeze a finite G42 optional-axis pool from48 actual pilot cores. Zero HTTP."""
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
    with path.open('x') as stream: stream.write(json.dumps(value, indent=2) + '\n')
assert not (BASE / 'series-plan.json').exists(), 'preserve frozen preparation'
pilot = ROOT / 'docs/gcsp/evidence/fucq59/g42-typed-pilot48-2026-11-07'
proof_path = pilot / 'actual-validation.json'; proof = read(proof_path)
assert proof['retainedProof']['tests'] == {'fail': 0, 'pass': 58, 'skipped': 0, 'tests': 58}
assert proof['retainedProof']['identityUnchanged'] and not proof['leftovers']
assert all(row['scratchAbsent'] and row['groupsAbsent'] and row['reservationAbsent'] for row in proof['independentFilesystemChecks'])
index_pins = {name: {'path': str(pilot / filename), 'sha256': expected} for name, filename, expected in [
    ('canonical', 'final-canonical-index.json', '5812a9802afce48c77fead80fef9394de479fd44b34ea5ffa1ecd6f2ae26c1d7'),
    ('spent', 'final-spent-request-index.json', '507e73d4014348adb4ff1cf4e0728851fd90ef3e6aadaa56f03fac485ab4c373')]}
indexes = {}
for name, pin in index_pins.items():
    path = pathlib.Path(pin['path']); assert sha(path) == pin['sha256']; indexes[name] = read(path)
    pin.update(entries=len(indexes[name]['entries']), digest=digest(indexes[name]))
baseline = {'canonical': len(indexes['canonical']['entries']), 'admittedSource': sum(any(o['kind'] == 'admitted-source' for o in r['origins']) for r in indexes['canonical']['entries']), 'spent': len(indexes['spent']['entries'])}
assert baseline == {'canonical': 1974, 'admittedSource': 1971, 'spent': 2684}
spent = {row['requestDigest'] for row in indexes['spent']['entries']}; assert len(spent) == baseline['spent']
source_pins = {}
def pin(path):
    key = relative(path); source_pins[key] = sha(path); return {'path': key, 'sha256': source_pins[key]}
proof_pin = pin(proof_path)
for pin_row in index_pins.values(): pin(pathlib.Path(pin_row['path']))
models = ['2PMA', '2PMB', '2PPA', '2PPB', '2PMC', '2PBC']
contexts = []; all_candidates = {}; queues = {}; counts = {}; exclusions = ['S01H0', 'S0337', 'S033B', 'S07MU']; packages = ['S07A2', 'S07VK']
for model in models:
    directory = pilot / model.lower(); plan_path = directory / 'collection-plan.json'; plan = read(plan_path)
    primary_path = directory / 'collector-checkpoint.json'; envelope = read(primary_path); state = envelope['content']; receipt = read(directory / 'receipt.json')
    assert envelope['contentDigest'] == digest(state) and sha(primary_path) == receipt['checkpointSha256']
    assert receipt['reason'] == 'queue-exhausted' and receipt['admitted'] == receipt['processedCandidates'] == 8
    assert not state['duplicates'] and not state['rejected']
    assert read(directory / 'checkpoint-export.json')['checkpointSha256'] == receipt['checkpointSha256']
    assert plan['source']['version'] == 'f59-model-batch-20261107.v1' and plan['modelRegistration']['modelCode'] == model
    options_path = directory / 'options.json'; options = read(options_path)
    assert sha(options_path) == state['batchEvidence']['options']['sha256'] and options['observation']['transportKind'] == 'live'
    definitions = [row for row in options['report']['candidates'][0]['definitions'] if row['issues'] == [] and row['option'] == row['code'] and row['pointer'] == '/' + row['code']]
    by_code = {row['code']: row for row in definitions}; query = plan['lineRegistration']['optionsQuery']; mandatory = [query['code']] if query['kind'] == 'trim' else []
    accepted_path = directory / 'accepted.jsonl'; records = [json.loads(line) for line in accepted_path.read_text().splitlines()]
    assert records == state['accepted'] and len(records) == 8
    context = {'modelRegistration': plan['modelRegistration'], 'lineRegistration': plan['lineRegistration'], 'typedBasis': pin(options_path), 'typedDefinitions': definitions,
        'mandatory': mandatory, 'actualPlan': pin(plan_path), 'actualPrimary': pin(primary_path), 'actualReceipt': pin(directory / 'receipt.json'), 'actualExport': pin(directory / 'checkpoint-export.json'),
        'retainedProof': proof_pin, 'accepted': pin(accepted_path), 'baseCores': []}
    pin(directory / 'tree.json'); pin(directory / 'source-events.jsonl')
    for record in records:
        assert record['admission'] and record['sourceKind'] == 'dated-snapshot'
        assert record['canonicalIdentity']['vgModelCode'] == model and record['canonicalIdentity']['agModelCode'] == plan['modelRegistration']['agModelCode']
        capture = next(row for row in state['sourceCaptures'] if row['solver']['sha256'] == record['sourceEvidence']['solver'])
        original = next(row for row in plan['candidates'] if row['candidateId'] == capture['candidateId'])
        selected = record['canonicalIdentity']['factoryOptionCodes']
        core = {kind: [code for code in selected if by_code.get(code, {}).get('optionType') == kind] for kind in ['paint', 'fabric', 'rim']}
        assert all(len(rows) == 1 for rows in core.values()); inputs = sorted(rows[0] for rows in core.values())
        assert original['request'] == {'includedElements': sorted(inputs + mandatory), 'mandatoryElements': mandatory}
        solver_path = directory / 'solver' / (capture['candidateId'] + '.json'); assert sha(solver_path) == record['sourceEvidence']['solver']; pin(solver_path)
        context['baseCores'].append({'coreDigest': digest({'modelRegistration': plan['modelRegistration'], 'baseCore': inputs}), 'inputs': inputs,
            'observedAxisSelection': sorted(code for code in selected if by_code.get(code, {}).get('optionType') in ['trim', 'package']),
            'actualCanonicalDigest': digest(record['canonicalIdentity']), 'actualConfigurationId': record['configurationId'], 'actualCandidateId': original['candidateId'], 'actualCandidateRequest': original['request'],
            'sourceSelectionSha256': record['sourceEvidence']['solver'], 'sourceSolverPath': relative(solver_path)})
    assert len({core['coreDigest'] for core in context['baseCores']}) == 8
    defaults = sorted({code for core in context['baseCores'] for code in core['observedAxisSelection']}); context['observedDefaultAxisCodes'] = defaults
    axes = {kind: sorted(row['code'] for row in definitions if row['optionType'] == kind and row['code'] not in defaults + mandatory + exclusions
        and (kind != 'package' or row['code'] in packages)) for kind in ['trim', 'package']}
    assert axes['package'] == packages and len(axes['trim']) == (5 if model in models[:4] else 4)
    context['additionalAxes'] = axes
    variants = [[code for code in pair if code] for pair in itertools.product([None] + axes['trim'], [None] + axes['package']) if any(pair)]
    candidates = []
    for core in context['baseCores']:
        for optional in variants:
            request = {'includedElements': sorted(core['inputs'] + mandatory + optional), 'mandatoryElements': mandatory}
            request_digest = digest({'modelRegistration': plan['modelRegistration'], 'request': request})
            assert request_digest not in spent and request_digest not in all_candidates
            row = {'candidateId': 'candidate-' + digest({'model': model, 'request': request})[:24], 'request': request, 'requestDigest': request_digest, 'coreDigest': core['coreDigest'], 'optionalInputs': sorted(optional)}
            candidates.append(row); all_candidates[request_digest] = row
    queues[model] = sorted(candidates, key=lambda row: row['requestDigest']); counts[model] = len(candidates)
    context['counts'] = {'actualCores': 8, 'optionalVariantsPerCore': len(variants), 'unspent': len(candidates)}; contexts.append(context)
assert counts == {'2PMA': 136, '2PMB': 136, '2PPA': 136, '2PPB': 136, '2PMC': 112, '2PBC': 112} and len(all_candidates) == 768
identifier = 'g42-optional-axis-actual48-20261107-preparation'
output = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output') / identifier
assert not output.exists()
chunks = []; request_bases = []
while any(queues.values()):
    for context in contexts:
        model = context['modelRegistration']['modelCode']; rows, queues[model] = queues[model][:8], queues[model][8:]
        if not rows: continue
        number = len(chunks) + 1; plan = copy.deepcopy(read(ROOT / context['actualPlan']['path']))
        plan.update(planId=identifier + '-session%03d' % number, seed='g42-actual48-optional-axis-direct-product-20261107', target=len(rows), candidateCount=len(rows), candidates=[{'candidateId': row['candidateId'], 'request': row['request']} for row in rows])
        plan['source']['version'] = 'f59-model-axis-batch-20261107.v1'
        plan['limits'].update(maxCandidates=len(rows), sourceAttempts=len(rows)+4, sourceBytes=4194304, checkpointBytes=4194304, deadlineMs=120000, requestBudgets={'page':1,'settings':1,'discover':1,'options':1,'solve':len(rows)})
        template = BASE / 'templates' / ('session%03d.json' % number); put(template, plan)
        chunks.append({'number':number,'modelCode':model,'candidates':len(rows),'maximumGets':len(rows)+4,'decodedBytes':4194304,'requestDigests':[row['requestDigest'] for row in rows], 'templatePath':relative(template),'templateSha256':sha(template),'planDigest':digest(plan)})
        request_bases.extend({'requestDigest':row['requestDigest'],'coreDigest':row['coreDigest'],'optionalInputs':row['optionalInputs']} for row in rows)
assert len(chunks) == 96 and sum(entry['maximumGets'] for entry in chunks) == 1152
need = {'schemaVersion':'g42-actual48-optional-axis-observed-need.v1','sourceProof':proof_pin,'baseline':baseline,'contexts':[{key:context[key] for key in ['modelRegistration','lineRegistration','typedBasis','observedDefaultAxisCodes','additionalAxes','counts']} for context in contexts],
    'illustrativeUnspentRequests':[{'modelCode':entry['modelCode'], 'requestDigest':value, 'request':all_candidates[value]['request']} for entry in chunks[:6] for value in entry['requestDigests']],
    'coreCount':48,'unspentPool':768,'sourceTraffic':0,'capacityCredit':0,'liveConstructibility':'unproven','futureActualContinuationCores':'excluded from this48-core manifest'}
put(BASE / 'observed-need.json', need)
manifest = {'schemaVersion':'g42-actual48-optional-axis-candidate-manifest.v1','id':identifier,'baseline':baseline,'indexPins':index_pins,'contexts':contexts,'fixedExcludedCodes':exclusions,'optionalPackageAllowlist':packages,'sourcePins':source_pins,'requestBases':request_bases,'chunks':chunks,'perModelCandidates':counts,'unspentCandidates':768,'actualCores':48,'trafficExecuted':False,'sourceTrafficGranted':False,'capacityCredit':0,'canonicalNovelty':'unproven'}
put(BASE / 'candidate-manifest.json', manifest)
production = read(ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-pilot32-2026-11-07/series-plan.json')
paths = [path for path in production['codePins'] if not path.startswith('docs/gcsp/evidence/fucq59/f70-optional-axis-pilot32-2026-11-07/')]
paths += [relative(BASE / name) for name in ['prepare.py','check-prepared.mjs','README.md']]
code_pins = {path:sha(ROOT / path) for path in sorted(set(paths))}
series = {'schemaVersion':'g42-actual48-optional-axis-preparation.v1','id':identifier,'status':'offline candidate preparation only; no live runner or grant','codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'codePins':code_pins,'sourcePins':source_pins,
    'candidateManifestSha256':sha(BASE / 'candidate-manifest.json'),'observedNeedSha256':sha(BASE / 'observed-need.json'),'indexPins':index_pins,'baseline':baseline,'candidateAllowance':768,'attemptAllowance':1152,'chunks':chunks,
    'illustrativeSessions':[1,2,3,4,5,6],'outputRootForLaterRelease':str(output),'trafficExecuted':False,'sourceTrafficGranted':False,'capacityCredit':0,'acceptance':False,'noAutomaticContinuation':True,
    'resourcesForLaterRelease':{'workers':1,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048,'perSessionSeconds':120,'directOneDrive':True,'releaseSpecificAggregateReservationRequired':True},
    'releaseDependencies':['fresh parent-selected immutable global canonical/spent prefix and strict proof','independent pool/route review','separate source allocation/grant with retained proof and resource finalizer','final global union before cumulative capacity credit']}
put(BASE / 'series-plan.json', series)
print(json.dumps({'status':'prepared-only','actualCores':48,'candidates':768,'perModel':counts,'sessions':96,'maximumGets':1152,'sourceTraffic':0,'capacityCredit':0}))
