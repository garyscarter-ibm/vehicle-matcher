#!/usr/bin/env python3
"""Current composed source inspection only; does not load products or allocate test resources."""
import hashlib
import json
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G

REF = 'f179ae6043414a2b07de3edb2b425338299ea37b'
PRIOR = HERE / 'http-release-source-plan-38be4f5-2026-11-06.json'
DESTINATION = HERE / 'http-release-source-plan-f179ae6-2026-11-06.json'


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(data)
    return value.hexdigest()


def git(args):
    with G.checkout_mutex(ROOT):
        rc, out, error = G.git(ROOT, args)
    if rc:
        raise RuntimeError(error)
    return out


tree = {row.split('\t', 1)[1]: row.split('\t', 1)[0].split()[2]
        for row in git(['ls-tree', '-r', '-z', REF]).split('\0') if row}
overlays = {str(p.relative_to(ROOT)): p for p in [Path(__file__), HERE / 'http-release.integration.mjs',
            HERE / 'http-release-supervisor.py', HERE / 'cancellation-safe-child.py',
            ROOT / 'server/test/helpers/presenter-http-proof.js', ROOT / '_tools/test_resources.py',
            ROOT / '_tools/scaffold_git.py', ROOT / '_tools/test_stamp.py']}
cache = {}


def read(path):
    if path in overlays:
        return overlays[path].read_bytes()
    if path not in cache:
        data = git(['show', REF + ':' + path]).encode()
        if hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != tree[path]:
            raise RuntimeError('Git byte round trip changed: ' + path)
        cache[path] = data
    return cache[path]


published = json.loads(read('docs/gcsp/evidence/fucq100/runtime-adoption-closure.json'))
pending = [row['path'] for row in published['rows'] if row['path'] in tree]
pending += list(overlays) + ['server/index.js', 'server/gcsp/runtime.js',
                            'server/test/gcsp-buddy-runtime-integration.test.js',
                            'docs/gcsp/evidence/fucq100/runtime-composition-source-plan.json',
                            'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']
seen, edges, packages, unresolved, expressions, navigation = set(), [], set(), [], [], []


def follow(parent, target, kind):
    if target.startswith('node:'):
        return
    if not target.startswith('.'):
        packages.add(target)
        return
    path = posixpath.normpath(posixpath.join(posixpath.dirname(parent), target))
    edge = {'from': parent, 'to': path, 'kind': kind}; edges.append(edge)
    if kind == 'literal-url' and path == 'gcsp-presenter.html':
        navigation.append({**edge, 'presentAtCentralRef': path in tree, 'loadedBySelectedProof': False,
                           'boundary': 'Injected navigation callback only; actual delivered workspace/C5 remains separate.'})
        return
    if path in tree or path in overlays:
        pending.append(path)
    elif any(name.startswith(path.rstrip('/') + '/') for name in tree):
        edge['members'] = [name for name in tree if name.startswith(path.rstrip('/') + '/')]
        pending.extend(edge['members'])
    else:
        unresolved.append(edge)


while pending:
    path = pending.pop()
    if path in seen:
        continue
    seen.add(path); source = read(path).decode()
    if not path.endswith(('.js', '.mjs')):
        continue
    pattern = r'''(?m)^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"\n]+)\1'''
    for expression in [pattern, r'''\bimport\s*\(\s*(['"])([^'"\n]+)\1''']:
        for match in re.finditer(expression, source):
            follow(path, match[2], 'literal-module')
    for match in re.finditer(r'''new URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import.meta.url''', source):
        follow(path, match[2], 'literal-url')
    for line, value in enumerate(source.splitlines(), 1):
        if re.search(r'\b(readFile|readFileSync|readdir|readdirSync|createReadStream|import\s*\()', value):
            expressions.append({'path': path, 'line': line, 'expression': value.strip()})

sources = [{'path': path, 'ref': 'owned-authoring' if path in overlays else REF,
            'blob': None if path in overlays else tree[path], 'sha256': hashlib.sha256(read(path)).hexdigest(),
            'bytes': len(read(path))} for path in sorted(seen)]
prior = json.loads(PRIOR.read_text())
for row in prior['dependencies']:
    path = ROOT / row['path']
    if not path.is_file() or path.stat().st_size != row['bytes'] or sha(path) != row['sha256']:
        raise RuntimeError('Existing dependency identity changed: ' + row['path'])
for name in ['node_modules', 'server/node_modules']:
    members = sorted(str(p.relative_to(ROOT)) for p in (ROOT / name).rglob('*') if p.is_file())
    expected = sorted(row['path'] for row in prior['dependencies'] if row['path'].startswith(name + '/'))
    if members != expected:
        raise RuntimeError('Existing dependency directory membership changed.')
host_evidence = [{'path': path, 'ref': REF, 'blob': tree[path], 'sha256': hashlib.sha256(read(path)).hexdigest(),
                  'bytes': len(read(path)), 'scope': 'Read-only C5 evidence, not a selected loaded module root'}
                 for path in ['gcsp-account.html', 'blocks/gcsp/account/harness.js', 'blocks/gcsp/manual-setup/journey.js']]
test_source = read(str((HERE / 'http-release.integration.mjs').relative_to(ROOT))).decode()
cases = re.findall(r"^test\('([^']+)'", test_source, re.M)
if len(cases) != 6 or len(set(cases)) != 6:
    raise RuntimeError('Expected exactly six authored cases.')
node = Path(prior['node']['path'])
if sha(node) != prior['node']['sha256']:
    raise RuntimeError('Node changed.')
plan = {'schemaVersion': 1, 'date': '2026-11-06', 'executionReady': False, 'executionAuthorized': False,
        'kind': 'Current composed product source plus owned test/supervisor authoring freeze', 'centralRef': REF,
        'sources': sources, 'edges': edges, 'unresolved': unresolved, 'navigationBoundaries': navigation, 'packages': sorted(packages),
        'readExpressionsToClassify': expressions, 'caseNames': cases, 'hostEvidence': host_evidence,
        'dependencyPins': {'path': str(PRIOR.relative_to(ROOT)), 'sha256': sha(PRIOR),
                           'count': len(prior['dependencies']), 'bytesAndMembershipUnchanged': True},
        'node': prior['node'], 'candidateRoot': None, 'readObserver': None, 'outputRoot': None,
        'profile': {'path': str((HERE / 'http-release.integration.mjs').relative_to(ROOT)),
                    'kind': 'TEST isolated existing pull-port input derived from actual bootstrap identities/facts',
                    'businessFactsInvented': False, 'releasedRowsRepaired': False,
                    'newRunSuccess': False, 'deliveredHostProfile': False},
        'resourceLimits': {'seconds': 120, 'ramMiB': 768, 'combinedDiskMiB': 128, 'logMiB': 2, 'workers': 1},
        'pending': ['Root review/admission of actual source union and owned harness',
                    'Read observer source/schema and complete literal/dynamic read allowlist',
                    'Concrete candidate root plus freshly pinned package resolution links/directory inventories',
                    'Flatten exact source/dependency/helper/profile files into launcher input manifest',
                    'Actual delivered C5 reset/principal subscription hook from sole central writer100',
                    'Trusted new-run source/preparation interface before positive post-reset or business acceptance'],
        'execution': 'No product imports, Node, tests, listeners, browser, native database or test reservations.',
        'inspectionHelpers': ['prepare-f179-http-freeze.py and scaffold_git.py are pinned in sources before any later execution.']}
DESTINATION.write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({'sources': len(sources), 'edges': len(edges), 'packages': sorted(packages),
                  'unresolved': unresolved, 'cases': cases, 'path': str(DESTINATION), 'sha256': sha(DESTINATION)}, indent=2))
