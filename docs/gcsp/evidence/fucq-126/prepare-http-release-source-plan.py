#!/usr/bin/env python3
"""Inspect pinned Git objects/dependencies only. Never import product modules or run tests."""
import hashlib
import json
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G

CENTRAL = '38be4f5d95823b5f010a56c3d4b6cbda4eca55e8'
RELEASE = '15a79957e61d81612311d3aab7dbf77733dc4e0d'
PRESENTER = 'a10ca742d56aa24b6639d5af380fa76316048d11'
DESTINATION = Path(__file__).with_name('http-release-source-plan-38be4f5-2026-11-06.json')


def git(args):
    with G.checkout_mutex(ROOT):
        rc, out, error = G.git(ROOT, args)
    if rc:
        raise RuntimeError(error)
    return out


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def tree(ref):
    return {row.split('\t', 1)[1]: row.split('\t', 1)[0].split()[2]
            for row in git(['ls-tree', '-r', '-z', ref]).split('\0') if row}


trees = {ref: tree(ref) for ref in [CENTRAL, RELEASE, PRESENTER]}
cache = {}


def read(ref, path):
    key = (ref, path)
    if key not in cache:
        raw = git(['show', ref + ':' + path]).encode('utf-8')
        # scaffold_git is a text API. Check round-trip bytes against the exact Git blob identity.
        oid = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        if oid != trees[ref][path]:
            raise RuntimeError('Git text round trip changed bytes: ' + path)
        cache[key] = raw
    return cache[key]


published = json.loads(read(CENTRAL, 'docs/gcsp/evidence/fucq100/runtime-adoption-closure.json'))
pending = [(CENTRAL, row['path']) for row in published['rows'] if row['path'] in trees[CENTRAL]]
pending += [(CENTRAL, p) for p in ['server/index.js', 'server/gcsp/runtime.js',
                                  'server/test/gcsp-buddy-runtime-integration.test.js',
                                  'docs/gcsp/evidence/fucq100/runtime-adoption-closure.json',
                                  'docs/gcsp/evidence/fucq100/next-runtime-source-plan.json',
                                  'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']]
pending += [(RELEASE, 'server/gcsp/stock/' + p) for p in ['index.js', 'port.js', 'synthetic-provider.js']]
pending += [(PRESENTER, 'blocks/gcsp/presenter-controls/' + p) for p in ['controls.js', 'http-adapter.js']]
pending += [(PRESENTER, p) for p in ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']]
seen, edges, packages, unresolved, dynamic = set(), [], set(), [], []


def reference(ref, parent, target, kind):
    if target.startswith('node:'):
        return
    if not target.startswith('.'):
        packages.add(target)
        return
    path = posixpath.normpath(posixpath.join(posixpath.dirname(parent), target))
    # The three release modules resolve shared server imports to the canonical graph, never a copied brand/core.
    chosen = RELEASE if path.startswith('server/gcsp/stock/') else CENTRAL if path.startswith('server/') else ref
    edge = {'fromRef': ref, 'from': parent, 'toRef': chosen, 'to': path, 'kind': kind}
    edges.append(edge)
    if path in trees[chosen]:
        pending.append((chosen, path))
    elif any(p.startswith(path.rstrip('/') + '/') for p in trees[chosen]):
        members = [p for p in trees[chosen] if p.startswith(path.rstrip('/') + '/')]
        edge['directoryMembers'] = members
        pending.extend((chosen, p) for p in members)
    else:
        unresolved.append(edge)


while pending:
    ref, path = pending.pop()
    if (ref, path) in seen:
        continue
    seen.add((ref, path))
    source = read(ref, path).decode('utf-8')
    if not path.endswith(('.js', '.mjs')):
        continue
    module_pattern = r'''(?m)^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"\n]+)\1'''
    for pattern in [module_pattern, r'''\bimport\s*\(\s*(['"])([^'"\n]+)\1''']:
        for match in re.finditer(pattern, source):
            reference(ref, path, match[2], 'literal-module')
    for match in re.finditer(r'''new URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import.meta.url''', source):
        reference(ref, path, match[2], 'literal-url')
    for n, line in enumerate(source.splitlines(), 1):
        if re.search(r'\b(readFile|readFileSync|readdir|readdirSync|createReadStream|import\s*\()', line):
            dynamic.append({'ref': ref, 'path': path, 'line': n, 'expression': line.strip()})

sources = [{'ref': ref, 'path': path, 'blob': trees[ref][path], 'sha256': hashlib.sha256(read(ref, path)).hexdigest(),
            'bytes': len(read(ref, path))} for ref, path in sorted(seen)]
by_path = {}
for row in sources:
    by_path.setdefault(row['path'], []).append(row)
collisions = [{key: row[key] for key in ['path', 'ref', 'sha256']} for rows in by_path.values()
              if len({r['sha256'] for r in rows}) > 1 for row in rows]
dependencies, links = [], {}
for name in ['node_modules', 'server/node_modules']:
    root = ROOT / name
    stat = root.lstat()
    links[name] = {'target': str(root.resolve()), 'device': stat.st_dev, 'inode': stat.st_ino}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() and path.is_dir():
            raise RuntimeError('dependency directory link requires explicit closure review')
        if path.is_file():
            dependencies.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(path), 'bytes': path.stat().st_size})
helpers = [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p), 'bytes': p.stat().st_size}
           for p in [Path(__file__), ROOT / '_tools/scaffold_git.py', ROOT / '_tools/test_resources.py', ROOT / '_tools/test_stamp.py']]
node = Path('/opt/homebrew/bin/node')
plan = {'schemaVersion': 1, 'date': '2026-11-06', 'kind': 'read-only source graph planning freeze',
        'executionReady': False, 'productImportsExecuted': False,
        'refs': {'central': CENTRAL, 'release': RELEASE, 'presenter': PRESENTER},
        'sources': sources, 'edges': edges, 'packages': sorted(packages), 'plannedHarnessPackages': ['jsdom'], 'unresolved': unresolved,
        'pathCollisions': collisions, 'readExpressionsToClassify': dynamic,
        'dependencies': dependencies, 'dependencyLinks': links, 'inspectionHelpers': helpers,
        'node': {'path': str(node), 'target': str(node.resolve()), 'sha256': sha(node)},
        'pendingExecutionPins': ['Next central composed checkpoint and its dependency closure',
                                 'Owned integration test source and exact test selection',
                                 'Owned supervisor/finalizer source and external source/impact/output ownership plan',
                                 'Trusted provider/new-run plan data and resolver/preparation contract'],
        'resourceProposal': {'secondsPerChunk': 120, 'ramMiB': 768, 'combinedDiskMiB': 128, 'logMiB': 2, 'workers': 1,
                             'allocationAuthorized': False, 'freshHostBudgetRequired': True,
                             'retention': 'Concise receipts with actual selected names/counts; bounded useful failure logs; owned scratch removed.'},
        'authority': '100 central runtime/server writer; 103 registry writer; no foreign source adoption or execution grant.',
        'limitations': ['Static source graph is a conservative planning input, not observed execution.',
                        'Nonliteral reads require reviewed classification before executable source freeze.',
                        '102-row published adoption manifest is an input only; every recorded blob is reread at 38be4f5.',
                        'No new-run factory or six atomic business preparations are inferred.']}
DESTINATION.write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({'path': str(DESTINATION), 'sources': len(sources), 'edges': len(edges), 'dependencies': len(dependencies),
                  'packages': sorted(packages), 'unresolved': unresolved, 'collisions': collisions,
                  'readExpressions': len(dynamic), 'sha256': sha(DESTINATION)}, indent=2))
