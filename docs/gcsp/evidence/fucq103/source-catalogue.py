#!/usr/bin/env python3
"""Refresh finite source identities without importing application code or allocating test scratch."""
import hashlib
import json
import posixpath
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
browser_path = HERE / 'browser-source-plan.json'
browser = json.loads(browser_path.read_text())
adoption = json.loads((HERE / 'runtime-adoption-plan.json').read_text())
selected = ['server/test/gcsp-runtime-publication.test.js',
            'server/test/gcsp-policy-consumer-adoption.test.js',
            'server/test/gcsp-greg-publish.test.js']
roots = sorted(set(browser['sources']) | {row['path'] for row in adoption['rows']} | set(selected) | {
    str(Path(__file__).relative_to(ROOT)), 'docs/gcsp/evidence/fucq103/scoped-supervisor.py',
    'docs/gcsp/evidence/fucq103/fucq115-dated-policy-command.json',
    'server/gcsp/policy/reviewed/offer-decline-reasons-v1.json',
    'server/gcsp/policy/reviewed/fucq115-choice-model-v1.json'})
pending = list(roots)
sources = {}
edges = []
packages = set()
manifests = set()
while pending:
    relative = pending.pop()
    if relative in sources:
        continue
    path = ROOT / relative
    if not path.is_file() or ROOT not in path.resolve().parents:
        raise ValueError('Missing or escaping source: ' + relative)
    sources[relative] = digest(path)
    if path.suffix not in ('.js', '.mjs', '.cjs'):
        continue
    for parent in path.parents:
        if ROOT != parent and ROOT not in parent.parents:
            break
        manifest = parent / 'package.json'
        if manifest.is_file():
            name = str(manifest.relative_to(ROOT))
            manifests.add(name)
            pending.append(name)
            break
    text = path.read_text()
    imports = re.findall(r'(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\bimport\s*\()\s*[\'\"]([^\'\"]+)[\'\"]', text)
    imports += re.findall(r'new\s+URL\(\s*[\'\"]([^\'\"]+)[\'\"]\s*,\s*import\.meta\.url', text)
    for specifier in sorted(set(imports)):
        if specifier.startswith('node:'):
            continue
        if not specifier.startswith('.'):
            packages.add(specifier)
            continue
        target = posixpath.normpath(posixpath.join(posixpath.dirname(relative), specifier))
        resolved = ROOT / target
        if resolved.is_dir():
            members = sorted(str(p.relative_to(ROOT)) for p in resolved.rglob('*') if p.is_file())
            edges.append({'from': relative, 'specifier': specifier, 'directory': target, 'members': members})
            pending.extend(members)
        else:
            edges.append({'from': relative, 'specifier': specifier, 'path': target})
            pending.append(target)

# Existing installed dependencies and executable identities must remain exact.
for absolute, expected in browser['dependencies']['sources'].items():
    if digest(Path(absolute)) != expected:
        raise ValueError('Installed dependency changed: ' + absolute)
installed = {str(p) for base in browser['dependencies']['roots'] for p in Path(base).rglob('*')
             if p.is_file() and not p.is_symlink() and '.bin' not in p.parts}
declared = {p for p in browser['dependencies']['sources']
            if any(Path(base) in Path(p).parents for base in browser['dependencies']['roots'])}
if installed != declared:
    raise ValueError('Installed dependency membership changed')
for name, item in browser['executables'].items():
    if digest(Path(item['path'])) != item['sha256']:
        raise ValueError('Executable changed: ' + name)

browser['sources'] = dict(sorted(sources.items()))
browser['runtimeAdoptionRevision'] = adoption['incomingCheckpoint']
browser['retained103Revision'] = adoption['localCheckpoint']
browser['sourceMethod'] = ('Prior reviewed frontend/asset closure plus final100 backend closure, '
    'selected combined-runtime tests and recursively resolved literal JS imports/exports/new URL resources. '
    'Nearest package manifests and installed membership/executables are pinned. '
    'Explicit audited dynamic logo edge retained. No runtime imports or browser launches.')
browser['relativeEdges'] = sorted(edges, key=lambda row: (row['from'], row['specifier']))
browser['packageSpecifiers'] = sorted(packages)
browser['packageResolutionManifests'] = sorted(manifests)
browser['captureContract'] = {'targetScroll': True, 'rectangleInsideViewport': True,
    'recordTextRectangleScrollViewport': True, 'preserveFocus': True,
    'surfaces': ['publish-heading-controls-status', 'preview-outcomes-changes',
                 'publication-details', 'employee-exact-monthly-points', 'no-suitable-reasons']}
browser_path.write_text(json.dumps(browser, indent=2) + '\n')
backend = {'schemaVersion': 1, 'scope': 'scoped-combined-runtime',
    'selectedTests': selected, 'sources': browser['sources'], 'relativeEdges': browser['relativeEdges'],
    'packageSpecifiers': browser['packageSpecifiers'], 'packageResolutionManifests': browser['packageResolutionManifests'],
    'dependencies': browser['dependencies'], 'executables': browser['executables'],
    'incomingRevision': adoption['incomingCheckpoint'], 'retained103Revision': adoption['localCheckpoint'],
    'selection': 'Combined runtime, exact106/115 registry, weighted preview and ordinary presenter/reset boundaries. '
                 'Explicit affected commands; no full-suite fallback. No optional pg-native selection.',
    'excluded': 'Browser, native, full suite, live/shared activation, actual decision/training and business-journey acceptance.'}
backend_path = HERE / 'runtime-combined-source-plan.json'
backend_path.write_text(json.dumps(backend, indent=2) + '\n')
print(json.dumps({'sourceFiles': len(sources), 'relativeEdges': len(edges), 'packages': sorted(packages),
    'browserPlanSha256': digest(browser_path), 'backendPlanSha256': digest(backend_path),
    'runtimeImports': 0, 'browserLaunches': 0}))
