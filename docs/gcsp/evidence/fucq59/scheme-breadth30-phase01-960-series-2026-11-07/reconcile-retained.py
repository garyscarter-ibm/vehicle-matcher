"""Extend cumulative indexes from this durable actual primary; never performs HTTP."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib

CODE = pathlib.Path(__file__).resolve().parent
ROOT = CODE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def put(name, value):
    with (BASE / name).open('x') as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

series=read(CODE/'series-plan.json')
assert len(sys.argv)==2 and sys.argv[1].isdigit()
number=int(sys.argv[1]); assert 1<=number<=len(series['chunks'])
BASE=pathlib.Path(series['chunks'][number-1]['outputDirectory'])
allocation = read(BASE / 'execution-plan.json')
assert all(sha(pathlib.Path(p)) == expected for p, expected in allocation['inputPins'].items())
plan = read(BASE / 'collection-plan.json')
envelope = read(BASE / 'collector-checkpoint.json')
state = envelope['content']
receipt = read(BASE / 'receipt.json')
assert envelope['contentDigest'] == digest(state)
assert receipt['checkpointSha256'] == sha(BASE / 'collector-checkpoint.json')
assert sha(BASE / 'collector-state.json') == receipt['checkpointSha256']
assert receipt['allocationId'] == allocation['id'] and receipt['planDigest'] == digest(plan)
assert read(BASE / 'execution-once.json')['id'] == allocation['id']
assert read(BASE / 'checkpoint-export.json')['checkpointSha256'] == receipt['checkpointSha256']
assert not (BASE / 'checkpoint-export-failure.json').exists()
for path, expected in allocation['codePins'].items():
    assert sha(ROOT / path) == expected, path

prior = read(BASE / 'prior-canonical-index.json')
spent = read(BASE / 'spent-request-index.json')
assert digest(prior) == allocation['priorIndexDigest'] and digest(spent) == allocation['spentIndexDigest']
known = {row['configurationId']: row for row in prior['entries']}
for row in state['accepted']:
    assert row['admission'] is True and row['sourceKind'] == 'dated-snapshot'
    assert row['configurationId'] not in known
    known[row['configurationId']] = {'configurationId': row['configurationId'], 'origins': [
        {'path': str(BASE / 'accepted.jsonl'), 'kind': 'admitted-source'}]}
prior['entries'] = list(known.values())

events_by_key = {}; raw_by_key = {}; event_sources = []
for path in sorted(BASE.glob('source-events*.jsonl')):
    rows = path.read_text().splitlines()
    event_sources.append({'file': path.name, 'sha256': sha(path), 'rows': len(rows)})
    for raw in rows:
        row = json.loads(raw); key = (row['attempt'], row['phase'])
        assert row['phase'] in ['started', 'headers-received', 'transport-refused']
        if key in raw_by_key: assert raw_by_key[key] == raw
        else: raw_by_key[key] = raw; events_by_key[key] = row
assert events_by_key, 'actual source events required'
events = sorted(events_by_key.values(), key=lambda r: (r['attempt'], 0 if r['phase'] == 'started' else 1))
starts=[row for row in events if row['phase']=='started']
# Exact sequential registered protocol has four bootstrap attempts before every solver prefix.
started=starts[4:]
assert len(starts)==receipt['actualAttempts']
# The executor's exact registered membership plus single sequential worker establishes this prefix.
assert len(started) == state['counts']['operations'].get('solve', 0) <= len(plan['candidates'])
assert [row['attempt'] for row in events if row['phase'] == 'started'] == list(range(1, receipt['actualAttempts'] + 1))
used = {row['requestDigest'] for row in spent['entries']}
for candidate in plan['candidates'][:len(started)]:
    request_digest = digest({'modelRegistration': plan['modelRegistration'], 'request': candidate['request']})
    assert request_digest not in used
    used.add(request_digest)
    outcome = ('accepted' if any(row['candidateId'] == candidate['candidateId'] for row in state['sourceCaptures'])
               else 'rejected' if any(row['candidateId'] == candidate['candidateId'] for row in state['rejected']) else 'stopped')
    if any(row['candidateId'] == candidate['candidateId'] for row in state['duplicates']):
        outcome = 'duplicate'
    spent['entries'].append({'candidateId': candidate['candidateId'], 'requestDigest': request_digest, 'outcome': outcome})
assert len(used) == len(spent['entries'])
put('reconciliation-event-evidence.json', {'scope':'read-only actual rows; no synthesized events','sources':event_sources})
put('final-canonical-index.json', prior)
put('final-spent-request-index.json', spent)
print(json.dumps({'canonicalEntries': len(prior['entries']),
                  'admittedSourceConfigurations': sum(any(origin['kind'] == 'admitted-source' for origin in row['origins']) for row in prior['entries']),
                  'spentSolverRequests': len(spent['entries']), 'newlyAccepted': len(state['accepted']),
                  'strictBindingVerificationStillRequired': True}))
