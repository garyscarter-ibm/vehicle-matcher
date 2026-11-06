#!/usr/bin/env python3
"""Hash and classify an existing physical candidate; never load product code or allocate test resources."""
import hashlib
import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
PREFIX = str(HERE.relative_to(ROOT)) + '/'
DESTINATION = HERE / 'http-physical-candidate-isolated-2026-11-06.json'
HELPER_SHA256 = '3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d'
PRIOR = HERE / 'http-release-source-plan-38be4f5-2026-11-06.json'
VIRTUAL = HERE / 'http-release-source-plan-f179ae6-2026-11-06.json'
ADOPTION = HERE / 'http-candidate-adoption-f179ae6-2026-11-06.json'
REF = 'f179ae6043414a2b07de3edb2b425338299ea37b'


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(data)
    return value.hexdigest()


def pin(name, role):
    path = ROOT / name
    if not path.is_file():
        raise RuntimeError('Missing physical input: ' + name)
    return {'path': name, 'target': str(path.resolve()), 'sha256': sha(path), 'bytes': path.stat().st_size, 'role': role}


virtual = json.loads(VIRTUAL.read_text())
previous = json.loads(PRIOR.read_text())
adoption = json.loads(ADOPTION.read_text())
if adoption['state'] != 'adopted-exact-unexecuted' or adoption['sourceRef'] != REF:
    raise RuntimeError('Require the completed exact source-adoption receipt.')
for row in adoption['changed']:
    if sha(ROOT / row['path']) != row['sha256']:
        raise RuntimeError('Adopted file changed: ' + row['path'])
for name, expected in adoption['preservedBefore'].items():
    if sha(ROOT / name) != expected or expected != adoption['preservedAfter'][name]:
        raise RuntimeError('Accepted presenter file changed: ' + name)

case_file = PREFIX + 'http-release.integration.mjs'
pending = [case_file, PREFIX + 'http-release-supervisor.py', PREFIX + 'cancellation-safe-child.py',
           str(Path(__file__).relative_to(ROOT)), PREFIX + 'adopt-http-candidate-source.py',
           str(ADOPTION.relative_to(ROOT)), str(VIRTUAL.relative_to(ROOT)), str(PRIOR.relative_to(ROOT)),
           '_tools/test_resources.py', '_tools/test_stamp.py', '_tools/scaffold_git.py',
           PREFIX + 'strict-http-resources.py',
           'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']
seen, edges, unresolved, packages, navigation = set(), [], [], set(), []
directory_roots = {'node_modules', 'server/node_modules',
                   'server/data/gcsp/vehicle-evidence/lookup-reference.v1'}


def follow(parent, target, kind):
    if target.startswith('node:'):
        return
    if not target.startswith('.'):
        packages.add(target)
        return
    name = posixpath.normpath(posixpath.join(posixpath.dirname(parent), target))
    edge = {'from': parent, 'to': name, 'kind': kind}
    edges.append(edge)
    if name == 'gcsp-presenter.html' and kind == 'literal-url':
        navigation.append({**edge, 'loadedBySelectedProof': False,
                           'basis': 'Controller navigation is an injected callback; delivered workspace/C5 is separate.'})
    elif (ROOT / name).is_file():
        pending.append(name)
    elif (ROOT / name).is_dir():
        directory_roots.add(name)
        edge['members'] = sorted(str(p.relative_to(ROOT)) for p in (ROOT / name).rglob('*') if p.is_file())
        pending.extend(edge['members'])
    else:
        unresolved.append(edge)


while pending:
    name = pending.pop()
    if name in seen:
        continue
    seen.add(name)
    source = (ROOT / name).read_text()
    if not name.endswith(('.js', '.mjs')):
        continue
    pattern = r'''(?m)^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"\n]+)\1'''
    for expression in [pattern, r'''\bimport\s*\(\s*(['"])([^'"\n]+)\1''']:
        for match in re.finditer(expression, source):
            follow(name, match[2], 'literal-module')
    for match in re.finditer(r'''new URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import.meta.url''', source):
        follow(name, match[2], 'literal-url')
if unresolved:
    raise RuntimeError('Unresolved physical source edges: ' + json.dumps(unresolved))

# A local lookup is eagerly loaded by buildServer; pin its complete actual corpus,
# including directory membership, even though the selected requests use no vehicle route.
corpus_root = 'server/data/gcsp/vehicle-evidence/lookup-reference.v1'
seen.update(str(p.relative_to(ROOT)) for p in (ROOT / corpus_root).rglob('*') if p.is_file())
files = [pin(name, 'physical-source-data-helper-or-reference') for name in sorted(seen)]
published = {row['path']: row for row in virtual['sources']}
for row in files:
    old = published.get(row['path'])
    if old and old['ref'] == REF:
        if (row['sha256'], row['bytes']) != (old['sha256'], old['bytes']):
            raise RuntimeError('Physical candidate differs from canonical source: ' + row['path'])
        row.update(sourceRef=REF, blob=old['blob'])

for row in previous['dependencies']:
    current = pin(row['path'], 'installed-dependency')
    if (current['sha256'], current['bytes']) != (row['sha256'], row['bytes']):
        raise RuntimeError('Installed dependency changed: ' + row['path'])
    files.append(current)
directories = []
for name in sorted(directory_roots):
    folder = ROOT / name
    members = list(folder.rglob('*'))
    if any(p.is_symlink() and p.is_dir() for p in members):
        raise RuntimeError('Unexpected nested directory symlink: ' + name)
    inventory = sorted(str(p.relative_to(folder)) for p in members if p.is_file())
    if name in ['node_modules', 'server/node_modules']:
        expected = sorted(row['path'][len(name) + 1:] for row in previous['dependencies'] if row['path'].startswith(name + '/'))
        if inventory != expected:
            raise RuntimeError('Installed dependency membership changed: ' + name)
    directories.append({'path': name, 'files': inventory})
links = []
for name in ['node_modules', 'server/node_modules']:
    path = ROOT / name
    if not path.is_symlink():
        raise RuntimeError('Expected the existing dependency link: ' + name)
    info = path.lstat()
    links.append({'path': name, 'target': str(path.resolve()), 'device': info.st_dev, 'inode': info.st_ino})
node = dict(previous['node'])
node.update(target=str(Path(node['path']).resolve()))
if sha(Path(node['path'])) != node['sha256']:
    raise RuntimeError('Node executable bytes changed.')

groups = {
    'server/gcsp/policy/file-provider.js': ('selected-default-seed-read',
        'MemoryPolicyProvider seeds via FilePolicyProvider; default file only, no retained/custom paths are supplied.',
        ['server/gcsp/policy/seed-v1.json']),
    'server/gcsp/policy/reviewed-definitions.js': ('import-time-reviewed-json',
        'Six top-level readFile/new URL calls run when the policy adoption module is imported.',
        [edge['to'] for edge in edges if edge['from'] == 'server/gcsp/policy/reviewed-definitions.js' and edge['kind'] == 'literal-url']),
    'server/gcsp/migrations/index.js': ('outside-selected-memory-path',
        'Migrations enumerate SQL only when a PostgreSQL operation calls loadMigrations; explicit memory repository/policy selected.',
        ['server/gcsp/migrations']),
    'server/gcsp/vehicle-evidence/synthetic-registry.js': ('eager-local-load-and-unselected-writer-branches',
        'buildServer constructs local lookup and immediately calls registry.load: history/active/version reads are possible. '
        'Missing/corrupt state can inspect directory membership or last-good.json; pins include the complete corpus and absent fallback. '
        'acquireWriter/recoverStages/publication methods are outside selected calls.', [corpus_root]),
    'server/gcsp/vehicle-evidence/corpus-publisher.js': ('eager-local-corpus-validation-and-unselected-writes',
        'Local registry load can stat/read manifest and three CORPUS_FILES through validateCorpusDirectory. '
        'open wx/w and syncDirectory are publication-only methods, outside selected calls.', [corpus_root]),
    'server/gcsp/vehicle-evidence/vin-profiles.js': ('possible-eager-corpus-validation-read',
        'validateRows may resolve retained VIN profiles while the local corpus loads.',
        ['server/data/gcsp/vehicle-evidence/vin-profiles.v1.json']),
    'server/gcsp/vehicle-evidence/vin-allocation.js': ('outside-selected-allocation-path',
        'Allocation inventory read and lock/write opens occur in reserve/publish operations; local lookup validation does not allocate.', []),
    'server/vehicle-evidence/bmw-catalogue-adapter.js': ('possible-eager-corpus-validation-read',
        'validateRows may use the local catalogue snapshot; include its fixed version-map target.',
        ['server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json']),
    'server/stock.js': ('outside-selected-retail-path',
        'National cache, brand fixtures and colour sidecar reads are behind retail fetchers/warmers. '
        'Import is not the entry point, no listener/warmers are started, and six requests use GCSP controls/scenarios only.', []),
    case_file: ('selected-literal-dynamic-imports',
        'Two literal controller/adapter imports after JSDOM globals are set; both are pinned and required in V8 observations.',
        ['blocks/gcsp/presenter-controls/controls.js', 'blocks/gcsp/presenter-controls/http-adapter.js']),
}
sites, unclassified = [], []
calls = re.compile(r'(?<![\w.])(?:readFileSync|readFile|readdirSync|readdir|createReadStream|open|stat|access|existsSync)\s*\(|\bimport\s*\(')
for name in sorted(seen):
    if not name.endswith(('.js', '.mjs')):
        continue
    source = (ROOT / name).read_text()
    has_fs = bool(re.search(r'''from\s+['"]node:fs(?:/promises)?['"]''', source))
    for number, line in enumerate(source.splitlines(), 1):
        if calls.search(line) and (has_fs or re.search(r'\bimport\s*\(', line)):
            group = groups.get(name)
            row = {'path': name, 'line': number, 'expression': line.strip()}
            if not group:
                unclassified.append(row)
            else:
                row.update(classification=group[0], basis=group[1], targets=group[2])
                sites.append(row)
if unclassified:
    raise RuntimeError('Unclassified finite product read/import sites: ' + json.dumps(unclassified))
absent = [corpus_root + '/last-good.json']
if any((ROOT / name).exists() for name in absent):
    raise RuntimeError('Fallback file is present; pin and reclassify it.')
cases = re.findall(r"^test\('([^']+)'", (ROOT / case_file).read_text(), re.M)
expected_cases = list(virtual['caseNames'])
expected_cases[2] = 'release-http: the isolated TEST source window reports zero after its offered stock is exhausted'
expected_cases[5] = 'release-http: actual reset renews presenter cookies and the old run-bound TEST provider is refused'
if cases != expected_cases or len(cases) != 6:
    raise RuntimeError('Exact six-case selection changed.')
resolved = {}
for row in files:
    identity = (row['sha256'], row['bytes'])
    if row['target'] in resolved and resolved[row['target']] != identity:
        raise RuntimeError('Conflicting pins for an installed file alias: ' + row['path'])
    resolved[row['target']] = identity
if sha(ROOT / '_tools/test_resources.py') != HELPER_SHA256:
    raise RuntimeError('Shared helper differs from the unchanged planning pin.')
plan = {
    'schemaVersion': 1, 'date': '2026-11-06', 'kind': 'Physical exact-source six-case candidate; statically validated and unexecuted',
    'centralRef': REF, 'candidateRoot': str(ROOT), 'executionAuthorized': False, 'executionReady': False, 'outputRoot': None,
    'files': files, 'directories': directories, 'absentFiles': absent, 'dependencyLinks': links, 'node': node,
    'resourceHelper': '_tools/test_resources.py', 'strictResourceWrapper': PREFIX + 'strict-http-resources.py',
    'childGuard': PREFIX + 'cancellation-safe-child.py',
    'supervisor': PREFIX + 'http-release-supervisor.py', 'caseFile': case_file, 'profileFiles': [case_file],
    'hostRegistryRoot': str((Path.home() / '.cache/agent-scaffolding/test-resources').resolve()), 'parentReservation': None,
    'resourceContractRequirement': {'mode': 'story-owned-strict-seven-key', 'helperSha256': HELPER_SHA256,
        'wrapperSha256': sha(HERE / 'strict-http-resources.py'), 'sharedHelperModified': False,
        'ledgerKeys': ['owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'],
        'state': 'Isolated wrapper authored only; independent review and fresh execution admission required'},
    'hostBudget': {'directory': str((Path.home() / '.cache/agent-scaffolding/test-resources').resolve()),
        'anchors': None, 'diskBytes': 128 * 1024 ** 2, 'ramBytes': 768 * 1024 ** 2,
        'emergencyReserveBytes': 5 * 1024 ** 3, 'ramReserveBytes': 512 * 1024 ** 2,
        'preferredFreeBytes': 30 * 1024 ** 3,
        'admission': 'Fresh strict ALL-row read and physical directory/lock anchors remain required; none collected here'},
    'fleetRisk': 'Other unpatched launchers can still reap a dead supervisor owner row while its child/scratch survives. '
        'The story wrapper never reaps; only a coordinated upstream fleet rollout closes this risk.',
    'strictWrapperLineage': {'basis': 'FUCQ-103 reviewed Budget/Tree, adapted as story-owned source; no import or execution', 'path': 'docs/gcsp/evidence/fucq103/scoped-resources.py', 'sourceWorktree': 'DEV-2026-11-04-066', 'sha256': '1e128d8d538b3d6ac9255adec1d2c8e05e9707ad66e965dd74ca0462f4b1231c'},
    'previousAbsenceCheckpoint': {'publishedRevision': 'a5b50abd3880b181916d313c8b9c0b73dbbd39cc', 'freezeSha256': '0d280b1cd6e7ddb140fa8479bf2e25e370329579eabb49afa16f75db29f3646f', 'parentStaticReviewReceipt': '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq126-absence-review-1029.json', 'parentStaticReviewReceiptSha256': 'd35497dffabbf9c7594559cabcd8171be156e4ab52c10a8b421d1f70d187b8c2', 'scope': 'Prior root936 static absence review retained; not rerun and not runtime evidence for this wrapper.'},
    'isolatedRouteReview': {'path': '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/results/claude-assist-fucq126-2026-11-06-01.md', 'sha256': '732756a21acd6f36b87d478c9ee683ff47e35ce6f2a5fb67e802ae80e0772059'},
    'manifestBinding': 'Future launch requires path plus explicit SHA256 of the final admitted manifest bytes; flags/output edits produce a new binding.',
    'caseNames': cases, 'edges': edges, 'unresolved': unresolved, 'packages': sorted(packages),
    'vehicleEvidenceRoot': corpus_root, 'navigationBoundaries': navigation,
    'readClassification': {'method': 'finite-static-source-review', 'filesystemReadsObserved': False,
        'sites': sites, 'unclassifiedSites': [],
        'coverageLimits': ['Finite enumeration of known product fs call bindings and literal dynamic imports; not a general JavaScript parser or filesystem observer.',
            'Dependency/Node-internal filesystem reads are not individually classified; all 1975 installed files and memberships are pinned.',
            'V8 observes loaded modules, not filesystem reads or whether an individual callsite ran.',
            'Static path reasoning does not prove excluded branches never execute; no six-case execution result exists.',
            'Supervisor/resource-helper reads of process state, owned logs, host registry and scratch are lifecycle operations outside the product data classification.']},
    'profile': virtual['profile'], 'resourceLimits': {**virtual['resourceLimits'], 'workSeconds': 90, 'finalizationSeconds': 30,
        'coverageFileMiB': 8, 'coverageTotalMiB': 64, 'coverageFiles': 128},
    'sourceAdoption': {'receipt': str(ADOPTION.relative_to(ROOT)), 'sha256': sha(ADOPTION), 'changedFiles': adoption['changedCount'], 'preservedFiles': 9},
    'counts': {'sourceDataHelperReferenceFiles': len(seen), 'installedDependencyFiles': len(previous['dependencies']),
               'allFiles': len(files), 'distinctResolvedFiles': len(resolved), 'literalEdges': len(edges), 'classifiedSites': len(sites)},
    'historicalSourcePlan': {'path': str(VIRTUAL.relative_to(ROOT)), 'sha256': sha(VIRTUAL),
        'basis': 'Immutable virtual planning checkpoint; this physical manifest supersedes its pending root/observer requirements.'},
    'excludedReferenceRoots': ['server/test/gcsp-buddy-runtime-integration.test.js',
        'server/test/helpers/employee-recommendation.js', 'docs/gcsp/evidence/fucq100/runtime-composition-source-plan.json'],
    'optional100Profile': {'ref': '46fa208e84a85ddc5cca843af59bb9794f63cada',
        'path': 'server/test/helpers/runtime-composition-profile.js',
        'sha256': '01c07f817d322ba7e33734ee58483d10afe1291c2eef0f055fa9b1d66b169925',
        'state': 'Inspected, not adopted; own isolated bootstrap-derived count profile needs no delivered/new-run profile.'},
    'reviewRepairOf': {'commit': '5adba2eac990028eda5113cea5a118c67818d131',
        'manifest': PREFIX + 'http-physical-candidate-f179ae6-2026-11-06.json',
        'sha256': 'efdb32a33413919315b4dbcc9a09c6b5e5be0d27602b1a9c2d8ac51801b84437',
        'independentReport': '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/reviews/fucq126-claude-review-2026-11-06.md',
        'reportBytes': 11779, 'reportSha256': '7bb9ed97476951bdc12ba43a217e5df740c28a6d67b10bd3f7bcbe7ee132c216',
        'verdict': 'HOLD retained; repairs are authored and unexecuted'},
    'pendingExecutionInputs': ['Independent review of story-owned strict budget, recursive tree/probes, scratch finalizer and supervisor integration',
        'Independent review of replacement candidate/harness/static classification',
        'Explicit six-case execution admission, fresh strict ALL-row host budget and physical directory/lock anchors, absolute external output/impact/ownership plan'],
    'separateAcceptanceGates': ['C5 delivered host subscription/navigation remains central100 work; not a six-case admission prerequisite.',
        'Trusted positive new-run source and six atomic business preparations remain open; no FUCQ77/78 or business acceptance.',
        'Browser/native/full execution lanes and paused96 unchanged.'],
    'execution': 'No product imports, Node, tests, probes, browser, native database, scratch or reservations.',
}
DESTINATION.write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({'path': str(DESTINATION), 'sha256': sha(DESTINATION), 'counts': plan['counts'],
                  'admission': False, 'executed': False}))
