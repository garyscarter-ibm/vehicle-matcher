"""Verify one retained context and supervisor cleanup without source traffic."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, os, pathlib

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
number = int(sys.argv[1]); assert 1 <= number <= 6
name = 'context%02d' % number; directory = BASE / name
OUT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-context') / name
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
manifest = read(BASE / 'stage1-plan.json')
assert digest(manifest) == 'ce14282252e10dbadedb6f7afcc69ba142947215c5b390fc485e124dd365725b'
frozen = manifest['contexts'][number - 1]
plan = read(directory / 'qualification-plan.json'); allocation = read(directory / 'execution-plan.json')
assert sha(directory / 'execution-plan.json') == frozen['allocationSha256']
assert digest(plan) == allocation['planDigest'] == frozen['planDigest']
assert {p: sha(ROOT / p) for p in allocation['codePins']} == allocation['codePins']
receipt = read(directory / 'receipt.json'); result = read(OUT / 'live-result.json'); cleanup = read(OUT / 'live-cleanup.json')
assert result['rc'] == 0 and result['issue'] is None
assert receipt['status'] == 'observed-context-only' and receipt['reason'] in ['source-trim-unknown', 'context-observed-options-unallocated']
assert receipt['actualAttempts'] == receipt['counts']['httpAttempts'] == receipt['counts']['sourceCalls'] == 3
assert receipt['counts']['operations'] == {'discover': 1, 'page': 1, 'settings': 1}
assert all(receipt['counts'][key] == 0 for key in ['failures', 'timeouts', 'substitutions'])
assert receipt['counts']['decodedBytes'] <= allocation['decodedBytes']
assert all(receipt[key] == 0 for key in ['newConfigurations', 'admitted', 'optionsRequests', 'solverRequests', 'retries', 'images', 'browser', 'sourceWrites'])
assert receipt['acceptance'] is False
assert receipt['allocationId'] == allocation['id'] and receipt['planDigest'] == allocation['planDigest']
marker = read(directory / 'execution-once.json'); assert marker['id'] == allocation['id'] and marker['planDigest'] == allocation['planDigest']
primary = directory / 'collector-checkpoint.json'; envelope = read(primary)
assert sha(primary) == receipt['checkpointSha256'] == cleanup['checkpointExport']['checkpointSha256']
assert primary.read_bytes() == (directory / 'collector-state.json').read_bytes()
assert digest(envelope['content']) == envelope['contentDigest']
artifact = envelope['content']['contextObservation']; tree = read(directory / 'tree.json')
assert tree == artifact['document'] and sha(directory / 'tree.json') == artifact['sha256']
assert (directory / 'tree.json').stat().st_size == artifact['bytes']
assert not envelope['content']['accepted'] and (directory / 'accepted.jsonl').stat().st_size == 0
registration = plan['modelRegistration']; report = tree['report']
assert report['aliasAppearances'] == len(registration['aliases']) == len(report['nodes'])
for alias, node in zip(registration['aliases'], report['nodes']):
    assert node['pointer'] == '/%s/modelRanges/%s/models/%s' % (alias, registration['catalogueRangeKey'], registration['modelCode'])
    for source_key, fact_key in [('modelCode', 'modelCode'), ('agModelCode', 'agModelCode'), ('rawModelRange', 'modelRange'), ('steering', 'steering'), ('orderDate', 'orderDate'), ('effectDate', 'effectDate')]:
        assert node['facts'][fact_key] == registration[source_key]
assert tree['observation']['transportKind'] == 'live' and tree['observation']['observedAt'].startswith(plan['qualificationDate'])
assert tree['observation']['capability'] == 'bmw-model-tree'
assert ('trim' in report['missingFields']) == (receipt['reason'] == 'source-trim-unknown')
events = [json.loads(line) for line in (directory / 'source-events.jsonl').read_text().splitlines()]
assert len(events) == 6
for attempt in range(1, 4):
    pair = [row for row in events if row['attempt'] == attempt]
    assert [row['phase'] for row in pair] == ['started', 'headers-received']
    assert pair[0]['method'] == pair[1]['method'] == 'GET' and pair[0]['url'] == pair[1]['url']
    assert pair[1]['status'] == 200 and not any(word in pair[0]['url'] for word in ['/options/', '/rulesolver/', 'S0337'])
assert all(cleanup[key] is True for key in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged', 'primaryExists'])
assert cleanup['retainedWriterMetadata'] == [] and cleanup['compatibility_exception'] is None
assert cleanup['checkpointExport']['status'] == 'exported' and cleanup['checkpointExport']['accepted'] == 0
assert not (directory / 'checkpoint-export-failure.json').exists()
assert not os.path.lexists(allocation['scratchRoot']) and not os.path.lexists(ROOT / 'server/node_modules')
summary = {'schemaVersion': 'f70-retained-context-verification.v1', 'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'scoped actual context observation; no configuration capacity or acceptance', 'context': name,
    'manifestDigest': digest(manifest), 'planDigest': digest(plan), 'reason': receipt['reason'], 'attempts': 3,
    'decodedBytes': receipt['counts']['decodedBytes'], 'sourceElapsedMs': receipt['elapsedMs'], 'modelCode': registration['modelCode'],
    'agModelCode': registration['agModelCode'], 'aliases': registration['aliases'], 'missingFields': report['missingFields'],
    'primarySha256': sha(primary), 'treeSha256': sha(directory / 'tree.json'), 'sourceEventsSha256': sha(directory / 'source-events.jsonl'),
    'supervisorResult': result, 'cleanup': cleanup, 'retainedBytesAtMeasurement': sum(p.stat().st_size for p in directory.rglob('*') if p.is_file()),
    'optionsRequests': 0, 'solverRequests': 0, 'capacityCredit': 0, 'acceptance': False, 'disposableLeftovers': []}
target = directory / 'live-validation.json'
assert not target.exists()
with target.open('x') as stream: stream.write(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({key: summary[key] for key in ['context', 'reason', 'attempts', 'decodedBytes', 'primarySha256', 'treeSha256', 'missingFields']}))
