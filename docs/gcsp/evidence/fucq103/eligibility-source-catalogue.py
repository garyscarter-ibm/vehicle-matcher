#!/usr/bin/env python3
"""Author a finite candidate graph; reads source bytes only, imports no application, allocates no test scratch."""
import ast
import hashlib
import json
import posixpath
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G

BASE = 'd644288865f2dc799dd539be6429ee05833ed555'
REPAIR = '38be4f5d95823b5f010a56c3d4b6cbda4eca55e8'
FOLLOWUP = '16839323f070f7c0ab81eb1ebf728627d283c71d'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
prior = json.loads((HERE / 'browser-source-plan.json').read_text())
node = prior['executables']['node']['path']
chunks = [
    ('eligibility-core', ['gcsp-greg-driver-eligibility', 'gcsp-greg-demand'], None, 25),
    ('eligibility-default', ['gcsp-runtime-publication'], '^default Paula HTTP', 1),
    ('eligibility-weighted', ['gcsp-runtime-publication'], '^delivered memory runtime', 1),
    ('eligibility-runtime', ['gcsp-runtime-publication'], '^(combined runtime|explicit file policy|runtime closes|explicit postgres)', 4),
    ('eligibility-publish', ['gcsp-greg-publish'], None, 15),
    ('eligibility-activation', ['gcsp-policy-activation', 'gcsp-greg-publish-http'], None, 9),
    ('eligibility-editor', ['gcsp-greg-publish-editor'], None, 3),
    ('eligibility-dashboard', ['gcsp-greg-dashboard-data'], '^(real service:|every fixture projection)', 3),
    ('eligibility-registry', ['gcsp-policy-consumer-adoption', 'gcsp-policy-adoption', 'gcsp-policy-learning-adoption'], None, 16),
]
selected = []
for mode, names, pattern, count in chunks:
    tests = ['server/test/' + name + '.test.js' for name in names]
    command = [node, '--test', '--test-concurrency=1']
    if pattern:
        command.append('--test-name-pattern=' + pattern)
    command.extend(tests)
    selected.append({'mode': mode, 'tests': tests, 'namePattern': pattern, 'expectedMatchedTests': count, 'command': command,
        'supervisedCommand': [prior['executables']['python']['path'], '-B', 'docs/gcsp/evidence/fucq103/scoped-supervisor.py', mode]})
roots = set(prior['sources']) | {name for chunk in selected for name in chunk['tests']} | {
    str(Path(__file__).relative_to(ROOT)), '.claude/scaffolding.json',
    'server/gcsp/manual-context/recommendation-facts.js', 'server/gcsp/policy/reviewed/offer-followup-questions-v1.json'}
# readFile template in the registry test is a finite definitions[] lookup, not an open runtime path.
explicit = list(prior['explicitDynamicEdges']) + [
    {'from': 'server/test/gcsp-policy-consumer-adoption.test.js',
     'to': 'server/gcsp/policy/reviewed/' + name,
     'reason': 'Finite definitions[] path substituted into readFile(new URL(...)).'}
    for name in ('offer-decline-reasons-v1.json', 'offer-followup-questions-v1.json', 'fucq115-choice-model-v1.json')]
roots.update(edge['to'] for edge in explicit)
sources, edges, directories, packages, manifests = {}, [], {}, set(), set()
pending = list(roots)
while pending:
    relative = pending.pop()
    if relative in sources:
        continue
    path = ROOT / relative
    if not path.is_file() or ROOT not in path.resolve().parents:
        raise ValueError('Missing or escaping source: ' + relative)
    sources[relative] = sha(path)
    if path.suffix == '.py':
        ast.parse(path.read_text(), filename=relative)
    if path.suffix not in ('.js', '.mjs', '.cjs', '.html', '.css'):
        continue
    text = path.read_text()
    imports = []
    if path.suffix in ('.js', '.mjs', '.cjs'):
        for parent in path.parents:
            if ROOT != parent and ROOT not in parent.parents:
                break
            manifest = parent / 'package.json'
            if manifest.is_file():
                manifests.add(str(manifest.relative_to(ROOT))); pending.append(str(manifest.relative_to(ROOT))); break
        imports = re.findall(r'(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\bimport\s*\()\s*[\'\"]([^\'\"]+)[\'\"]', text)
        imports += re.findall(r'new\s+URL\(\s*[\'\"]([^\'\"]+)[\'\"]\s*,\s*import\.meta\.url', text)
    else:
        imports = re.findall(r'(?:src|href)\s*=\s*[\'\"]([^\'\"]+)[\'\"]', text) if path.suffix == '.html' else []
        imports += re.findall(r'url\(\s*[\'\"]?([^\s\)\'\"]+)', text)
    for spec in sorted(set(imports)):
        if spec.startswith(('node:', '#', 'data:', 'https:', 'http:', '//')):
            continue
        if path.suffix in ('.js', '.mjs', '.cjs') and not spec.startswith('.'):
            packages.add(spec); continue
        target = posixpath.normpath(posixpath.join(posixpath.dirname(relative), spec)) if not spec.startswith('/') else spec[1:]
        resolved = ROOT / target
        if resolved.is_dir():
            members = sorted(str(p.relative_to(ROOT)) for p in resolved.rglob('*') if p.is_file())
            directories[target] = members; pending.extend(members)
            edges.append({'from': relative, 'specifier': spec, 'directory': target, 'members': members})
        else:
            pending.append(target); edges.append({'from': relative, 'specifier': spec, 'path': target})

# Installed code/executables are read from the prior actual inventory, not installed or launched.
for absolute, expected in prior['dependencies']['sources'].items():
    if sha(Path(absolute)) != expected:
        raise ValueError('Installed dependency changed: ' + absolute)
installed = {str(p) for base in prior['dependencies']['roots'] for p in Path(base).rglob('*')
             if p.is_file() and not p.is_symlink() and '.bin' not in p.parts}
declared = {p for p in prior['dependencies']['sources'] if any(Path(base) in Path(p).parents for base in prior['dependencies']['roots'])}
if installed != declared:
    raise ValueError('Installed dependency membership changed')
for name, item in prior['executables'].items():
    if sha(Path(item['path'])) != item['sha256']:
        raise ValueError('Executable changed: ' + name)

incoming = ['server/gcsp/manual-context/recommendation-facts.js', 'server/gcsp/greg/index.js',
    'server/gcsp/greg/publish/index.js', 'server/gcsp/greg/publish/fit.js',
    'server/test/gcsp-greg-driver-eligibility.test.js', 'server/test/gcsp-greg-demand.test.js']
retained = ['server/gcsp/runtime.js', 'server/index.js', 'server/gcsp/policy/seed-v1.json',
    'server/scenarios/employee/index.js', 'server/gcsp/manual-context/fixtures.js',
    'server/gcsp/policy/reviewed/offer-decline-reasons-v1.json', 'server/gcsp/policy/reviewed/fucq115-choice-model-v1.json']
def exact(ref, path, destination=None):
    rc, value, error = G.git(ROOT, ['show', ref + ':' + path])
    if rc:
        raise ValueError(error[:300])
    actual = sha(ROOT / (destination or path))
    if hashlib.sha256(value.encode()).hexdigest() != actual:
        raise ValueError('Immutable source differs: ' + path)
    return {'ref': ref, 'path': path, 'destination': destination or path, 'sha256': actual}
provenance = [exact(REPAIR, path) for path in incoming] + [exact(BASE, path) for path in retained]
provenance += [exact(FOLLOWUP, 'server/gcsp/offers/followup-policy-definitions.json',
    'server/gcsp/policy/reviewed/offer-followup-questions-v1.json')]
impact = {
    'projectRecommendationFacts and both Greg stable-read slot fences': ['eligibility-core'],
    'actual createLocalSession/manual account/HTTP brief and pure bound-driver parity; canonical suppression': ['eligibility-default'],
    'coherent five-subject weighted fit/no writes, ordinary HTTP publication and same-cookie terms/pinned history': ['eligibility-weighted', 'eligibility-publish'],
    'retained same-provider runtime/scenario reset/lifecycles and explicit missing-connection refusal': ['eligibility-runtime'],
    'canonical helper -> publishFixture -> activation, HTTP, editor and dashboard real-service projections': ['eligibility-activation', 'eligibility-editor', 'eligibility-dashboard'],
    'additive exact107 registry, missing-only activation/original retry/tuned-key preservation; retain106/113/115': ['eligibility-registry'],
    'browser fixture canonical preparation and complete slot clones': ['future separately admitted prep, desktop journey, narrow320 journey'],
}
common = {'schemaVersion': 1, 'state': 'frozen-authoring-proposal-awaiting-execution-review',
    'runtimeBaseRevision': BASE, 'repairRevision': REPAIR, 'followupRevision': FOLLOWUP,
    'sources': dict(sorted(sources.items())), 'relativeEdges': sorted(edges, key=lambda r: (r['from'], r['specifier'])),
    'explicitDynamicEdges': explicit, 'directoryResources': directories, 'packageSpecifiers': sorted(packages),
    'packageResolutionManifests': sorted(manifests), 'dependencies': prior['dependencies'], 'executables': prior['executables'],
    'composition': provenance, 'impactMap': impact,
    'sourceMethod': 'Prior audited frontend/asset roots plus current literal import/export/new URL and HTML/CSS resource closure; finite dynamic edges and directory membership explicit. Python AST only; no application imports or execution.',
    'deltaFromPriorBrowser': [{'path': name, 'before': prior['sources'].get(name), 'after': value}
        for name, value in sorted(sources.items()) if prior['sources'].get(name) != value]}
backend = {**common, 'scope': 'proposed-scoped-combined-eligibility-and-registration', 'chunks': selected,
    'selectedTests': sorted({name for chunk in selected for name in chunk['tests']}),
    'expectedMatchedTests': sum(chunk['expectedMatchedTests'] for chunk in selected),
    'impact': 'Exact100 repair with retained103 weighted scoring/runtime/seed; canonical actual default preparation and coherent synthetic cohort; additive107 same-provider registration proposal.',
    'excluded': 'Browser, full suite, native database/PostgreSQL connection, deployed/live systems, producer92/69/122/126 journeys,105→107 decision lookup/reload,113corpus/115training acceptance.',
    'resourceContract': {'workers': 1, 'chunkSeconds': 120, 'chunkScratchMiB': 128, 'chunkRamMiB': 768, 'chunkLogMiB': 2,
        'sharedOutput': '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs',
        'require': ['fresh HostBudget reservation', 'owned root and external manifest before allocation', 'registered finalizer',
            'TMPDIR/TMP/TEMP inherited', 'before/after graph identity', 'stop at first failure', 'independent filesystem/process/group/link/port/reservation cleanup review']}}
browser = {**prior, **common, 'purpose': 'Candidate canonical preparation plus weighted preview/publication journey; no execution grant.',
    'runtimeAdoptionRevision': REPAIR, 'retained103Revision': BASE,
    'boundaries': [backend['excluded'], 'Future static preparation then separate desktop/narrow320 admissions; old smoke proves only its old source.'],
    'requiredBeforeAllocation': ['backend source/result review and grant', 'candidate source/adoption review',
        'exact HEAD and fresh grant/HostBudget/ownership manifest', 'one prep then one admitted browser chunk, cleanup reviewed between chunks']}
with G.checkout_mutex(ROOT):
    for name, value in [('eligibility-combined-source-plan.json', backend), ('eligibility-browser-source-plan.json', browser)]:
        (HERE / name).write_text(json.dumps(value, indent=2) + '\n')
print(json.dumps({'sourceFiles': len(sources), 'edges': len(edges), 'selectedTests': len(backend['selectedTests']),
    'expectedMatchedTests': backend['expectedMatchedTests'], 'installedFiles': len(prior['dependencies']['sources']),
    'executables': len(prior['executables']), 'runtimeImports': 0, 'testRuns': 0, 'browserLaunches': 0,
    'backendSha256': sha(HERE / 'eligibility-combined-source-plan.json'), 'browserSha256': sha(HERE / 'eligibility-browser-source-plan.json')}))
