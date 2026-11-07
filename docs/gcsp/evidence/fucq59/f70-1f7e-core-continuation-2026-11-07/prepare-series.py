"""Freeze a parent-reviewable111-request finite series. No HTTP or grant."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(BASE / 'continuation-plan.json')
series = manifest['series']
assert series['chunks'] == [1, 2, 3, 4]
assert sum(manifest['chunks'][number - 1]['candidates'] for number in series['chunks']) == series['maximumCandidates'] == 111
assert sum(manifest['chunks'][number - 1]['attempts'] for number in series['chunks']) == series['maximumGets'] == 127
first = pathlib.Path(manifest['first32Directory'])
proof = read(first / 'live-validation.json')
assert proof['retainedChecks']['summary']['pass'] == proof['retainedChecks']['summary']['tests'] == 5
assert proof['primarySha256'] == sha(first / 'collector-checkpoint.json')
assert proof['finalCanonicalIndexSha256'] == sha(first / 'final-canonical-index.json')
assert proof['finalSpentRequestIndexSha256'] == sha(first / 'final-spent-request-index.json')
pins = dict(manifest['sourceCodePins'])
for number in series['chunks']:
    entry = manifest['chunks'][number - 1]
    assert entry['releaseStage'] == 'priority-observed-rims'
    assert not any((pathlib.Path(entry['directory']) / name).exists() for name in ['execution-plan.json', 'execution-once.json', 'collector-checkpoint.json'])
    pins.update(entry['runtimePins'])
    pins[entry['planTemplatePath']] = entry['planTemplateSha256']
for name in ['continuation-plan.json', 'prepare-core.py', 'run-series.py', 'verify-retained.py', 'prepare-series.py', 'prepared-check.test.mjs']:
    path = BASE / name
    pins[str(path.relative_to(ROOT))] = sha(path)
for name in ['live-validation.json', 'final-canonical-index.json', 'final-spent-request-index.json']:
    path = first / name
    pins[str(path.relative_to(ROOT))] = sha(path)
for path, expected in pins.items():
    assert sha(ROOT / path) == expected, path
allocation = {'schemaVersion': 'f70-core-series-execution-plan.v1', 'id': series['allocationId'],
    'status': 'prepared-unspent; no source grant', 'codeCommit': manifest['codeCommit'], 'codePins': pins,
    'continuationPlanSha256': sha(BASE / 'continuation-plan.json'), 'chunks': series['chunks'],
    'candidateAllowance': 111, 'attemptAllowance': 127, 'decodedBytes': series['maximumDecodedBytes'],
    'responseBytes': 1048576, 'freshBootstrapPerChunk': ['page', 'settings', 'discover', 'options'],
    'sourceGrantEnvironment': {'F70_CORE_SERIES_SOURCE_GRANT': series['allocationId']},
    'oneShotMarker': str(BASE / 'series-once.json'),
    'supervisorOutput': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-1f7e-priority-core-series',
    'commandAfterSeparateRelease': ['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py')],
    'resources': manifest['resources'], 'maximumWallSeconds': 720,
    'forecast': {'sourceAndVerificationSeconds': 120, 'retainedBytes': 33554432, 'peakHostRamBytes': 536870912,
                 'peakScratchBytes': 67108864, 'parallelChunks': False},
    'retention': 'Each durable primary starts in its declared evidence directory; export, cumulative reconciliation, five strict retained checks and cleanup precede the next chunk. Source bodies and bootstrap values are never retained.',
    'checkpoint': 'Series stage and process ownership are retained outside per-chunk scratch. A stopped series is never replayed; preserve any spent primary for parent reconciliation.',
    'deferredRequests': 52, 'deferredChunks': [5, 6], 'sourceCapacityCreditBeforeExecution': 0, 'acceptance': False,
    'stop': manifest['stop'], 'boundary': '111 exact finite requests on two source-observed rims; no presumed constructibility, distinctness or acceptance. One parent series release suffices for its four reviewed chunks.'}
with (BASE / 'series-plan.json').open('x') as stream:
    stream.write(json.dumps(allocation, indent=2) + '\n')
print(json.dumps({'seriesExecutionPlanSha256': sha(BASE / 'series-plan.json'), 'manifestSha256': allocation['continuationPlanSha256'],
                  'chunks': series['chunks'], 'candidates': 111, 'maxGets': 127, 'sourceGrant': False}))
