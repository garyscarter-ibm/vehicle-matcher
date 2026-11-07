"""Freeze a pilot-only execution allocation referencing immutable actual-core pool templates. Zero HTTP."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, json, pathlib, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
put = lambda path, value: path.write_text(json.dumps(value, indent=2) + '\n')
assert not (BASE / 'series-plan.json').exists(), 'preserve original frozen allocation'
pool_base = ROOT / 'docs/gcsp/evidence/fucq59/f70-optional-axis-pool-2026-11-07'
pool = read(pool_base / 'series-plan.json')
assert sha(pool_base / 'series-plan.json') == '49dc5d0fa91dca87df94a8b01ea998089198c884d8d0ef5a4950b4f6f6e49b2e'
assert sha(pool_base / 'candidate-manifest.json') == pool['candidateManifestSha256'] == 'e6711d1863472aedadf0f64a6b15c8b8e9b48ed51c09c7341e38eaca478e8319'
identifier = 'f70-optional-axis-pilot32-20261107-once'
output = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output') / identifier
supervisor = ROOT / '.claude/f58-63-overnight-20261106/f58/f70-optional-axis-pilot32'
assert not output.exists() and not (BASE / 'parent-release.json').exists()
chunks = copy.deepcopy(pool['chunks'][:4])
for entry in chunks:
    entry.update(outputDirectory=str(output / 'sessions' / ('session%03d' % entry['number'])), supervisorOutput=str(supervisor / ('session%03d' % entry['number'])))
old = read(ROOT / 'docs/gcsp/evidence/fucq59/f70-model-axis790-plan-2026-11-07/series-plan.json')
paths = [p for p in old['codePins'] if not p.startswith('docs/gcsp/evidence/fucq59/f70-model-axis790-plan-2026-11-07/')]
paths += [str(path.relative_to(ROOT)) for path in BASE.iterdir() if path.suffix in ['.py', '.mjs'] or path.name == 'README.md']
code_pins = {path: sha(ROOT / path) for path in sorted(set(paths))}
source_pins = dict(pool['sourcePins'])
source_pins.update({str((pool_base / name).relative_to(ROOT)): sha(pool_base / name) for name in ['series-plan.json', 'candidate-manifest.json', 'offline-validation.json']})
for entry in chunks: source_pins[entry['templatePath']] = entry['templateSha256']
phase = {'grantId': identifier + '-pilot32', 'sessions': [1, 2, 3, 4], 'solverCeiling': 32, 'getCeiling': 48, 'maximumWallSeconds': 300, 'separateExactParentReleaseRequired': True, 'clockStartsAtConsumedMarkerAfterRelease': True}
series = {'schemaVersion': 'f70-optional-axis-pilot32-series-plan.v1', 'id': identifier, 'status': 'prepared-unspent; explicit parent release and exact environment grant required',
    'codeCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'codePins': code_pins, 'sourcePins': source_pins,
    'candidateManifestPath': str((pool_base / 'candidate-manifest.json').relative_to(ROOT)), 'candidateManifestSha256': pool['candidateManifestSha256'],
    'preparedIndexPins': pool['indexPins'], 'preparedBaseline': pool['baseline'], 'candidateAllowance': 32, 'attemptAllowance': 48, 'chunks': chunks, 'phases': {'pilot': phase},
    'outputRoot': str(output), 'outputOwnershipManifest': str(supervisor / 'ownership/durable-series.json'),
    'producerPins': {'projectorSha256': code_pins['scripts/gcsp/capture-bmw-selection.mjs'], 'qualifierSha256': code_pins['scripts/gcsp/bmw-selection-binding.mjs'], 'sessionSha256': code_pins['scripts/gcsp/collection-session.mjs'], 'policyVersion': 'gcsp-policy-v1'},
    'resources': {'workers': 1, 'hostRamBytes': 512*1024**2, 'childRamBytes': 448*1024**2, 'scratchBytes': 64*1024**2, 'perSessionSeconds': 120, 'retainedCheckSeconds': 30,
        'perCohortSeconds': 300, 'expectedRetainedBytes': 32*1024**2, 'retainedBudgetBytes': 128*1024**2, 'perSessionRetainedShardBytes': 16*1024**2, 'peakIncludingRetainedBudgetBytes': 192*1024**2, 'directOneDrive': True, 'scratchRootPolicy': 'resource-helper-owned-default'},
    'retries': 0, 'automaticRedirects': 0, 'browser': 0, 'images': 0, 'sourceWrites': 0, 'trafficExecuted': False, 'sourceTrafficGranted': False, 'capacityCredit': 0, 'acceptance': False,
    'noAutomaticContinuation': True, 'finalGlobalUnionRequiredBeforeCumulativeCredit': True,
    'remaining': ['separately reviewed release/allocation for prepared5535 suffix candidates', 'final global F70+G42 canonical/spent union proof', 'F60 enrichment/F54 publication/application integration', 'post12November F61 target10000 acceptance and physical distribution']}
put(BASE / 'series-plan.json', series)
example = {'schemaVersion': 'f70-optional-axis-parent-release.v1', 'released': False, 'allocationId': identifier, 'grantId': phase['grantId'],
    'seriesPlanSha256': sha(BASE / 'series-plan.json'), 'candidateManifestSha256': pool['candidateManifestSha256'], 'codePins': code_pins,
    'qualificationDate': '2026-11-07', 'indexPins': {'canonical': {'path': 'PARENT_SELECTS_ABSOLUTE_PROVED_PATH', 'sha256': 'PARENT_PINS', 'digest': 'PARENT_PINS', 'entries': 0}, 'spent': {'path': 'PARENT_SELECTS_ABSOLUTE_PROVED_PATH', 'sha256': 'PARENT_PINS', 'digest': 'PARENT_PINS', 'entries': 0}},
    'strictProof': {'path': 'PARENT_SELECTS_ABSOLUTE_MATCHING_PROOF', 'sha256': 'PARENT_PINS'}, 'baseline': {'canonical': 0, 'admittedSource': 0, 'spent': 0},
    'concurrentDisjointLane': {'permitted': True, 'catalogueRangeKey': 'G42', 'modelCodes': ['2PMA', '2PMB', '2PPA', '2PPB', '2PMC', '2PBC']},
    'finalGlobalUnionRequiredBeforeCumulativeCredit': True}
put(BASE / 'parent-release.example.json', example)
print(json.dumps({'prepared': True, 'sessions': 4, 'candidates': 32, 'maximumGets': 48, 'seriesPlanSha256': sha(BASE / 'series-plan.json'), 'sourceTraffic': 0}))
