"""Freeze one finite core successor after verified prior proof. Never performs HTTP."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, json, pathlib

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def put(path, value):
    with path.open('x') as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

assert len(sys.argv) == 2 and sys.argv[1].isdigit(), 'select exactly one finite chunk number'
number = int(sys.argv[1])
manifest = read(BASE / 'continuation-plan.json')
assert 1 <= number <= len(manifest['chunks'])
selected = manifest['chunks'][number - 1]
target = pathlib.Path(selected['directory'])
assert target.parent == BASE.parent and target.is_dir()
assert not any((target / name).exists() for name in ['execution-once.json', 'collector-checkpoint.json', 'collection-plan.json', 'execution-plan.json'])
for path, expected in manifest['sourceCodePins'].items():
    assert sha(ROOT / path) == expected, path
for path, expected in selected['runtimePins'].items():
    assert sha(ROOT / path) == expected, path
template = ROOT / selected['planTemplatePath']
assert sha(template) == selected['planTemplateSha256']
plan = read(template)
assert digest(plan) == selected['planDigest'] and plan['modelRegistration'] == manifest['modelRegistration']

first = pathlib.Path(manifest['first32Directory'])
assert sha(first / 'execution-plan.json') == manifest['first32ExecutionPlanSha256']
previous = first if number == 1 else pathlib.Path(manifest['chunks'][number - 2]['directory'])
receipt = read(previous / 'receipt.json')
proof = read(previous / 'live-validation.json')
summary = proof['retainedChecks']['summary']
assert receipt['reason'] == 'queue-exhausted', 'prior chunk did not finish; stop this continuation'
assert summary['tests'] == summary['pass'] == 5 and summary['fail'] == summary['skipped'] == 0
assert proof['primarySha256'] == sha(previous / 'collector-checkpoint.json') == receipt['checkpointSha256']
assert proof['finalCanonicalIndexSha256'] == sha(previous / 'final-canonical-index.json')
assert proof['finalSpentRequestIndexSha256'] == sha(previous / 'final-spent-request-index.json')
assert not (previous / 'checkpoint-export-failure.json').exists()
assert read(previous / 'checkpoint-export.json')['checkpointSha256'] == receipt['checkpointSha256']
assert all(proof['cleanup'][key] for key in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent'])
prior = read(previous / 'final-canonical-index.json')
spent = read(previous / 'final-spent-request-index.json')
used = {row['requestDigest'] for row in spent['entries']}
assert len(used) == len(spent['entries'])
requests = [digest({'modelRegistration': plan['modelRegistration'], 'request': row['request']}) for row in plan['candidates']]
assert requests == selected['requestDigests'] and len(set(requests)) == len(requests)
assert not used.intersection(requests), 'spent solver requests cannot be replayed'

options_path = ROOT / manifest['actualTypedBasis']['actualOptionsPath']
assert sha(options_path) == manifest['actualTypedBasis']['actualOptionsSha256']
definitions = {row['code']: row for row in read(options_path)['report']['candidates'][0]['definitions']}
for candidate in plan['candidates']:
    request = candidate['request']
    assert request['mandatoryElements'] == ['S033B'] and len(request['includedElements']) == 4
    assert all(code in definitions and definitions[code]['issues'] == [] for code in request['includedElements'])
    assert all(sum(definitions[code]['optionType'] == kind for code in request['includedElements']) == 1 for kind in ['paint', 'fabric', 'rim'])

put(target / 'collection-plan.json', plan)
put(target / 'prior-canonical-index.json', prior)
put(target / 'spent-request-index.json', spent)
allocation = copy.deepcopy(read(first / 'execution-plan.json'))
allocation_id = 'f70-1f7e-core%02d-20261107-once' % number
retention = read(target / 'retained-deliverables.json')
pins = {**manifest['sourceCodePins'], **selected['runtimePins']}
for path in [template, BASE / 'prepare-core.py', BASE / 'continuation-plan.json']:
    pins[str(path.relative_to(ROOT))] = sha(path)
for name in ['collection-plan.json', 'prior-canonical-index.json', 'spent-request-index.json']:
    path = target / name
    pins[str(path.relative_to(ROOT))] = sha(path)
allocation.update(id=allocation_id, status='prepared-unspent; no traffic grant', codeCommit=manifest['codeCommit'],
                  planDigest=digest(plan), priorIndexDigest=digest(prior), spentIndexDigest=digest(spent),
                  codePins=pins, preparerSha256=sha(BASE / 'prepare-core.py'),
                  snapshotVersion='bmw-gb-1f7e-core%02d-2026-11-07.v2' % number,
                  attempts=selected['attempts'], candidateAllowance=selected['candidates'], solverAllowance=selected['candidates'],
                  requestSequence=['page', 'settings', 'discover', 'options', 'solve x%d' % selected['candidates']],
                  scratchRoot='/tmp/vehicle-matcher-f58-63-20261106/f58/f70-1f7e-core%02d-solver' % number,
                  supervisorOutput='/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-1f7e-core%02d-solver' % number,
                  artifactDestination=str(target), retainedPrimary=retention['primary'], retainedDeliverables=retention,
                  oneShotMarker=str(target / 'execution-once.json'), sourceGrantEnvironment={'F70_FIRST32_SOURCE_GRANT': allocation_id},
                  commandAfterSeparateRelease=['/usr/bin/python3', '-I', '-B', str(target / 'supervise.py'), 'live'],
                  actualSourceBasis={'finiteCoreContinuation': str((BASE / 'continuation-plan.json').relative_to(ROOT)),
                                     'previousProof': str((previous / 'live-validation.json').relative_to(ROOT)),
                                     'previousProofSha256': sha(previous / 'live-validation.json'),
                                     'actualTypedBasis': manifest['actualTypedBasis']})
put(target / 'execution-plan.json', allocation)
put(target / 'execution-reservation.json', {'status': 'prepared-unspent-no-traffic-grant', 'allocationId': allocation_id,
    'planDigest': allocation['planDigest'], 'executionPlanSha256': sha(target / 'execution-plan.json'),
    'exclusiveMarkerCreatedOnlyByLiveRunner': allocation['oneShotMarker']})
print(json.dumps({'chunk': number, 'candidates': selected['candidates'], 'attempts': selected['attempts'],
                  'executionPlanSha256': sha(target / 'execution-plan.json'), 'planDigest': allocation['planDigest'],
                  'priorIndexDigest': allocation['priorIndexDigest'], 'spentIndexDigest': allocation['spentIndexDigest'],
                  'sourceGrant': False}))
