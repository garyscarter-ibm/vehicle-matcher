"""Freeze one parent-reviewable1024-request series, without allocating output or traffic."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib, shutil
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(BASE / 'candidate-manifest.json')
assert manifest['maximumCandidates'] == 1024 and len(manifest['chunks']) == 32
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
output = pathlib.Path(manifest['resources']['outputRoot'])
assert cloud.is_dir() and cloud in output.resolve().parents and not output.exists()
assert shutil.disk_usage(cloud).free > 5 * 1024**3 + manifest['resources']['peakIncludingRetainedBudgetBytes']
pins = dict(manifest['sourceCodePins'])
for name in ['candidate-manifest.json', 'prepare-chunk.py', 'prepare-series.py', 'run-series.py', 'supervise.py', 'run-live.mjs', 'reconcile-retained.py', 'verify-retained.py', 'live-check.test.mjs', 'prepared-check.test.mjs', 'retained-route.test.mjs']:
    path = BASE / name; pins[str(path.relative_to(ROOT))] = sha(path)
for entry in manifest['chunks']:
    assert sha(ROOT / entry['templatePath']) == entry['templateSha256']
    pins[entry['templatePath']] = entry['templateSha256']
previous = pathlib.Path(manifest['baselineDirectory'])
for name in ['live-validation.json', 'collector-checkpoint.json', 'final-canonical-index.json', 'final-spent-request-index.json']:
    path = previous / name; pins[str(path.relative_to(ROOT))] = sha(path)
for core in manifest['actualCoreSelections']:
    for path, expected in [(core['proofPath'], core['proofSha256']), (core['sourcePrimary'], core['sourcePrimarySha256'])]:
        assert sha(ROOT / path) == expected; pins[path] = expected
assert all(sha(ROOT / path) == expected for path, expected in pins.items())
allocation = {'schemaVersion': 'f70-typed-axis-series-execution-plan.v1', 'id': manifest['allocationId'],
    'status': 'prepared-unspent; no source traffic grant', 'codePins': pins, 'candidateManifestSha256': sha(BASE / 'candidate-manifest.json'),
    'chunks': manifest['chunks'], 'candidateAllowance': 1024, 'attemptAllowance': 1152,
    'decodedBytes': manifest['maximumDecodedBytes'], 'maximumWallSeconds': manifest['maximumWallSeconds'],
    'responseBytes': 1048576, 'resources': manifest['resources'], 'outputRoot': str(output),
    'oneShotMarker': str(BASE / 'series-once.json'),
    'outputOwnershipManifest': '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-typed-axis1024-output-ownership.json',
    'sourceGrantEnvironment': {'F70_TYPED_AXIS_SERIES_SOURCE_GRANT': manifest['allocationId']},
    'commandAfterSeparateRelease': ['/usr/bin/python3', '-I', '-B', str(BASE / 'run-series.py')],
    'checkpoint': manifest['checkpoint'], 'retention': manifest['retention'], 'stop': manifest['stop'],
    'boundary': manifest['boundary'], 'remaining': manifest['remaining'], 'sourceCapacityCreditBeforeExecution': 0, 'acceptance': False}
with (BASE / 'series-plan.json').open('x') as stream:
    stream.write(json.dumps(allocation, indent=2) + '\n')
print(json.dumps({'seriesPlanSha256': sha(BASE / 'series-plan.json'), 'manifestSha256': allocation['candidateManifestSha256'], 'candidates': 1024, 'maxGets': 1152, 'sourceGrant': False, 'outputAllocated': False}))
