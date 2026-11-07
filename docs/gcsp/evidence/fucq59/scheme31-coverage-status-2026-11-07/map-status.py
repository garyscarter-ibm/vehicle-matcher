"""Read retained metadata only; no source requests, tests, proof replay or scratch."""
import sys
sys.dont_write_bytecode = True
import collections, datetime, hashlib, json, pathlib

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
EVIDENCE = BASE.parent
read = lambda p: json.loads(pathlib.Path(p).read_text())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
ledger_path = EVIDENCE / 'scheme-line-breadth-preparation-2026-11-07/target-ledger.json'
ledger = read(ledger_path)
plan_path = ROOT / ledger['targetPath']
plan = read(plan_path)
assert sha(plan_path) == ledger['targetSha256']
assert plan['coverage']['schemeModelLines'] == [r['schemeModelLine'] for r in ledger['entries']]
assert len(ledger['entries']) == 31
pins = [{'path': str(p), 'sha256': sha(p)} for p in [ledger_path, plan_path]]
parent_path = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/global-union8813-parent-audit.json')
parent = read(parent_path)
assert parent['status'] == 'parent-proved' and parent['errors'] == [] and parent['admittedSource'] == 8813
pins.append({'path': str(parent_path), 'sha256': sha(parent_path)})
models = {}
diagnostic_pins = {}
for name in ['g21', 'u11', 'u10', 'g26e']:
    p = EVIDENCE / 'scheme-line-breadth15-2026-11-07/actual' / name / 'diagnostic.json'
    diagnostic = read(p)
    diagnostic_pins[name] = {'path': str(p), 'sha256': sha(p), 'observedAt': diagnostic['observation']['observedAt']}
    pins.append(diagnostic_pins[name])
    for node in diagnostic['report']['modelNodes']:
        models[(name, node['facts']['modelCode'])] = node['facts']
contexts = []
for name in ['scheme-breadth-six-model-options-actual-2026-11-07', 'scheme-breadth-remaining24-model-options-actual-2026-11-07']:
    p = EVIDENCE / name / 'typed-axes-index.json'
    contexts.extend(read(p)['contexts'])
    pins.append({'path': str(p), 'sha256': sha(p)})
assert len(contexts) == 30
by_target = collections.defaultdict(list)
by_model_target = {}
for c in contexts:
    name = c['sourceContextId'].split('-')[0]
    registration = c['modelRegistration']
    facts = models[(name, registration['modelCode'])]
    assert registration['agModelCode'] == facts['agModelCode'] and registration['rawModelRange'] == facts['modelRange']
    literal = facts['derivative'].split()[0]
    if name == 'g21': index = 5
    elif name == 'u11':
        assert literal in ['X1', 'IX1']
        index = 18 if literal == 'IX1' else 12
    elif name == 'u10':
        assert literal in ['X2', 'IX2']
        index = 19 if literal == 'IX2' else 13
    else:
        assert name == 'g26e' and literal == 'I4'
        index = 20
    by_model_target[registration['modelCode']] = index
    by_target[index].append({'modelCode': registration['modelCode'], 'agModelCode': registration['agModelCode'], 'catalogueRangeKey': registration['catalogueRangeKey'], 'rawModelRange': registration['rawModelRange'], 'literalDerivative': facts['derivative'], 'aliases': registration['aliases'], 'lineKey': c['lineRegistration']['lineKey'], 'optionsQuery': c['lineRegistration']['optionsQuery'], 'sourcePin': diagnostic_pins[name], 'qualificationOnly': True})
actual_path = EVIDENCE / 'scheme-breadth30-phase02c-864-series-2026-11-07/actual-interruption-audit.json'
actual = read(actual_path)
assert sha(actual_path) == '6af7d6cffcac3b81c00b5958c5e105f84e0fe4c07a892bc82255bd8cae53eb2b' and actual['errors'] == []
receipt_path = pathlib.Path(actual['sourceReceiptPin']['path'])
assert sha(receipt_path) == actual['sourceReceiptPin']['sha256']
receipt = read(receipt_path)
counts = collections.Counter()
for session in receipt['completedSessions']:
    counts[by_model_target[session['model']]] += session['accepted']
assert sum(counts.values()) == 513
pins.extend([{'path': str(actual_path), 'sha256': sha(actual_path)}, actual['sourceReceiptPin']])
entries = []
for prior in ledger['entries']:
    index = prior['index']
    row = {'index': index, 'schemeModelLine': prior['schemeModelLine'], 'targetPointer': prior['targetPointer'], 'eligibility': prior['eligibility'], 'priorState': prior['state'], 'schemeJoinQualified': False, 'coverageQualified': False, 'typedContexts': by_target[index], 'phase02cStrictAdmittedCandidates': counts[index], 'acceptance': False}
    if by_target[index]:
        row.update(state='actual literal range/model/options candidates; scheme join unqualified', requiredNext='Corroborate exact dated scheme/body/generation join and original profile/year/plant/five-WMI coverage.')
    elif index in [0, 2, 22]:
        row.update(state='retained actual source and strict solver candidates; scheme join unqualified', sourceEvidence=prior['sourceEvidence'], requiredNext='Corroborate exact scheme join from retained source evidence; source capacity is separate from scheme coverage.')
    elif index == 1:
        row.update(state='unresolved dated F44 gap', sourceEvidence=prior['sourceEvidence'], requiredNext='Preserve HTTP200 empty object and historical HTTP400 as limited observations. Obtain an evidence-backed exact F44 input; do not infer global unavailability or substitute a successor.')
    elif index == 23:
        p = EVIDENCE / 'scheme-line-breadth15-2026-11-07/actual/i20/receipt.json'
        observed = read(p)
        row.update(state='actual I20 inventory stopped at diagnostic alias limit; no qualified model inventory', sourceEvidence=[{'path': str(p), 'sha256': sha(p), 'reason': observed['reason'], 'actualAttempts': observed['actualAttempts']}], requiredNext='Review the retained failure and a separately authorized bounded discovery route; infer no model facts or successor.')
    else:
        row.update(state='unresolved; no retained exact discovery seed in this evidence slice', sourceEvidence=[], requiredNext='Obtain a separately authorized evidence-backed exact discovery seed; preserve generation/body labels and unknown model/AG/range/alias facts.')
    entries.append(row)
report = {'schemaVersion': 'original31-scheme-source-coverage-status.v1', 'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'read-only mapping of original31 targets to retained actual source metadata; zero source/test/proof replay', 'inputPins': pins, 'originalTargetCount': 31, 'schemeJoinsQualified': 0, 'coverageQualified': 0, 'actualTypedContexts': 30, 'typedContextCandidateRows': sum(bool(v) for v in by_target.values()), 'typedContextsByCandidateTarget': {str(k): len(v) for k, v in by_target.items() if v}, 'actualSourceCandidateRows': 9, 'explicitDatedOrDiagnosticGaps': 2, 'noRetainedSeedRows': 20, 'parentGlobalAdmitted': 8813, 'parentGlobalCountBasis': 'fixed parent union; running phase03 excluded', 'phase02cStrictAdmittedCandidateCount': 513, 'entries': entries, 'sourceRequests': 0, 'strictChecksReplayed': 0, 'scratchCreated': False, 'dependencyLinkTouched': False, 'newAdmissions': 0, 'capacityCredit': 0, 'acceptance': False, 'notes': ['30 typed contexts span four catalogue range keys and six candidate original scheme rows; they do not establish30 scheme joins.', 'G26 Gran Coupe is not satisfied by G26E/i4, and G61 Touring is not satisfied by G61E/i5.', 'Literal returned derivative facts separate X1/iX1 and X2/iX2 candidates; model-code prefixes are not classification evidence.', 'The20 no-seed statuses concern this retained evidence slice and do not claim source unavailability.']}
with (BASE / 'mapping.json').open('x') as stream:
    json.dump(report, stream, indent=2)
    stream.write('\n')
print(json.dumps({'path': str(BASE / 'mapping.json'), 'sha256': sha(BASE / 'mapping.json'), 'targets': 31, 'qualifiedJoins': 0, 'typedContexts': 30, 'typedCandidateRows': report['typedContextCandidateRows'], 'sourceCandidateRows': 9, 'explicitGaps': 2, 'noSeedRows': 20, 'phase02cAdmittedCandidates': 513, 'sourceTraffic': 0}))
