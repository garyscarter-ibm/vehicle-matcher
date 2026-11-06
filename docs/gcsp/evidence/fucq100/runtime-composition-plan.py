#!/usr/bin/env python3
"""Read-only product inspection; write the finite authoring proposal, never execute it."""
from pathlib import Path
import hashlib
import json
import posixpath
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as g

BASE = '38be4f5d95823b5f010a56c3d4b6cbda4eca55e8'
HERE = Path(__file__).resolve().parent
REFS = {'92': '15a79957e61d81612311d3aab7dbf77733dc4e0d',
        '103': 'f80fc61ca151cb46ad21cb2b19e704f4012d53de',
        '69': '891b750cc928be8476f19d1980013df217ad8550',
        '70': '73c645719f0536ff82e8004ade9b8844846ccef9',
        '122': '01546c49251df3182a4c164a45a10c7e82c9e2af',
        '126': 'a10ca742d56aa24b6639d5af380fa76316048d11'}
LEAVES = {
    '92': ['server/gcsp/stock/' + p for p in ['index.js', 'port.js', 'history-port.js', 'synthetic-provider.js']],
    '103': ['server/gcsp/policy/seed-v1.json', 'server/scenarios/employee/index.js',
            'server/gcsp/policy/reviewed-definitions.js'] + ['server/gcsp/policy/reviewed/' + p for p in
            ['fucq115-choice-model-v1.json', 'greg-publish-editor-v1.json', 'offer-decline-reasons-v1.json', 'presenter-controls-v1.json', 'offer-followup-questions-v1.json']],
    '69': ['server/gcsp/manual-gallery/stock-read.js'] + ['blocks/gcsp/manual-gallery/' + p for p in
           ['gcsp-manual-gallery.js', 'gcsp-manual-gallery.css', 'gallery-controller.js', 'gallery-model.js', 'claim-controller.js', 'http-adapter.js']],
    '70': ['server/gcsp/manual-review/' + p for p in ['index.js', 'validation.js', 'http.js']] + ['blocks/gcsp/manual-review/' + p for p in
           ['gcsp-manual-review.js', 'http-adapter.js', 'review-controller.js', 'review-model.js', 'manual-review.css']],
    '122': ['server/gcsp/cases/index.js', 'server/gcsp/cases/http.js'],
    '126': ['blocks/gcsp/presenter-controls/controls.js', 'blocks/gcsp/presenter-controls/http-adapter.js',
            'blocks/gcsp/kit/presenter-bar.js'],
}
IMPORTS = re.compile(r'''(?:^|\n)\s*(?:import|export)\s+(?:(?!;)[\s\S])*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]|(?:^|\n)\s*import\s*['"]([^'"\n]+)['"]|new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url''')
sha = lambda b: hashlib.sha256(b).hexdigest()


def git(args):
    with g.checkout_mutex(ROOT):
        rc, out, err = g.git(ROOT, args)
    if rc:
        raise RuntimeError((args, err))
    return out


def apply_patch(text):
    """Apply only the exact unified hunks in memory; reject every preimage mismatch."""
    lines = text.splitlines(True)
    result = {}
    i = 0
    while i < len(lines):
        assert lines[i].startswith('--- a/'), lines[i]
        path = lines[i][6:].strip()
        assert lines[i + 1] == '+++ b/' + path + '\n'
        original = baseline(path).decode().splitlines(True)
        output = []
        cursor = 0
        i += 2
        while i < len(lines) and not lines[i].startswith('--- a/'):
            m = re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*\n', lines[i])
            assert m, lines[i]
            start = int(m[1]) if m[2] == '0' else int(m[1]) - 1
            assert start >= cursor
            output.extend(original[cursor:start])
            cursor = start
            i += 1
            consumed = added = 0
            while i < len(lines) and not lines[i].startswith(('@@ ', '--- a/')):
                op, content = lines[i][0], lines[i][1:]
                assert op in ' +-'
                if op != '+':
                    assert original[cursor] == content, (path, cursor)
                    cursor += 1
                    consumed += 1
                if op != '-':
                    output.append(content)
                    added += 1
                i += 1
            assert consumed == int(m[2] or 1) and added == int(m[4] or 1)
        output.extend(original[cursor:])
        result[path] = ''.join(output).encode()
    return result


tracked = {line.split('\t', 1)[1]: line.split()[2] for line in git(['ls-tree', '-r', BASE]).splitlines()}
cache, pins, proposals = {}, {}, []


def baseline(path):
    b = (ROOT / path).read_bytes()
    assert path in tracked
    assert hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest() == tracked[path], ('base drift', path)
    return b


for lane, paths in LEAVES.items():
    for path in paths:
        b = git(['show', REFS[lane] + ':' + path]).encode()
        same = path in tracked and sha(baseline(path)) == sha(b)
        cache[path] = b
        pins[path] = {'ref': REFS[lane], 'sha256': sha(b), 'origin': lane, 'bytes': len(b), 'adoption': not same}
        proposals.append({'path': path, **pins[path]})
patch_path = HERE / 'runtime-composition-owned.patch'
drafts = apply_patch(patch_path.read_text())
for path, b in drafts.items():
    cache[path] = b
    pins[path] = {'ref': BASE, 'sha256': sha(b), 'before_sha256': sha(baseline(path)), 'origin': '100-virtual-draft', 'bytes': len(b)}


def read(path):
    if path not in cache:
        b = baseline(path)
        cache[path] = b
        pins[path] = {'ref': BASE, 'sha256': sha(b), 'origin': '100-base', 'bytes': len(b)}
    return cache[path]


# Explicit non-module input list reused from 69's published finite source handoff.
# The imported list is committed below; no mutable sibling-worktree dependency.
resources = json.loads((HERE / 'runtime-composition-resources.json').read_text())
roots = list(drafts) + ['blocks/gcsp/presenter-controls/controls.js']
queue = roots + list(cache) + resources
seen, edges, external, unresolved = set(), [], [], []


def edge(path, spec, kind):
    if spec.startswith(('node:', 'https:', 'http:', 'data:', '#')):
        edges.append({'from': path, 'specifier': spec, 'kind': kind, 'builtin': spec.startswith('node:')})
        return
    if not spec.startswith(('.', '/')):
        external.append({'from': path, 'specifier': spec, 'kind': kind})
        return
    target = posixpath.normpath(posixpath.join(posixpath.dirname(path), spec)) if not spec.startswith('/') else spec[1:]
    target = target.split('?', 1)[0].split('#', 1)[0]
    record = {'from': path, 'specifier': spec, 'target': target, 'kind': kind}
    if path == 'blocks/gcsp/presenter-controls/controls.js' and target == 'gcsp-presenter.html':
        record['boundary'] = 'navigation URL only; presenter page/workspace/shell not proposed for adoption by this controller composition'
    elif target == '.':
        record['boundary'] = 'trusted static host root; no directory traversal admitted'
    elif target in tracked or target in cache:
        queue.append(target)
    else:
        members = sorted(p for p in tracked if p.startswith(target.rstrip('/') + '/'))
        if members and kind == 'url-resource':
            record['directory_members'] = members
            queue.extend(members)
        else:
            unresolved.append(record)
    edges.append(record)


while queue:
    path = queue.pop(0)
    if path in seen:
        continue
    seen.add(path)
    b = read(path)
    if not path.endswith(('.js', '.mjs', '.html', '.css')):
        continue
    text = b.decode()
    if path.endswith(('.js', '.mjs')):
        for m in IMPORTS.finditer(text):
            edge(path, next(v for v in m.groups() if v is not None), 'url-resource' if m[4] is not None else 'module')
    elif path.endswith('.css'):
        for spec in re.findall(r'''url\(\s*['"]?([^\s'"\)]+)''', text):
            edge(path, spec, 'css-url')
        for spec in re.findall(r'''@import\s+['"]([^'"]+)''', text):
            edge(path, spec, 'css-import')
    else:
        for spec in re.findall(r'''(?:src|href)\s*=\s*['"]([^'"]+)''', text):
            edge(path, spec, 'html-asset')
for path in ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']:
    if path in tracked:
        read(path)
        seen.add(path)
prior_path = HERE / 'greg-eligibility-run-catalogue.json'
prior = json.loads(prior_path.read_text())
installed = {}
for path, entry in prior['installed']['files'].items():
    p = Path(path)
    st = p.stat()
    value = {'sha256': sha(p.read_bytes()), 'realpath': str(p.resolve()), 'device': st.st_dev, 'inode': st.st_ino, 'symlink': p.is_symlink()}
    assert value['sha256'] == entry['sha256']
    assert all(value[k] == prior['installed_identities'][path][k] for k in ['realpath', 'device', 'inode', 'symlink'])
    installed[path] = value
executables = {k: prior[k] for k in ['node', 'python']}
for value in executables.values():
    assert value['sha256'] == sha(Path(value['path']).read_bytes())
    p = Path(value['path'])
    st = p.stat()
    value.update(realpath=str(p.resolve()), device=st.st_dev, inode=st.st_ino, symlink=p.is_symlink())
plan = {'schemaVersion': 1, 'kind': 'author-only source proposal; not execution admission or acceptance',
        'date': '2026-11-06', 'base': BASE, 'consumer_refs': REFS,
        'live_product_unchanged': True, 'leaf_adoption_granted': False, 'execution_granted': False,
        'owned_draft_paths': list(drafts), 'patch_sha256': sha(patch_path.read_bytes()),
        'authoring_inputs': {p.name: sha(p.read_bytes()) for p in [Path(__file__), HERE / 'runtime-composition-resources.json']},
        'leaf_proposals': proposals, 'roots': roots, 'sources': {p: pins[p] for p in sorted(seen)},
        'literal_edges': edges, 'external_packages': external, 'unresolved_literal_edges': unresolved,
        'method': 'Static literal import/export/dynamic import/new URL and HTML/CSS assets; exact preimage/hunk validation in memory. No product imports or provider calls.',
        'dynamic_boundaries': ['trusted stockProvider pull and immutable per-run source/preparation profile missing',
                               'host static resource requests and caller root require actual requested asset allowlist',
                               'configured vehicle evidence lookup root is excluded from first composition check',
                               'no CLI secret file read, database connection or native variant admitted',
                               'optional gallery/review adapters and clock subscription use trusted host options'],
        'prior_pg_catalogue_sha256': sha(prior_path.read_bytes()), 'installed_pg_rechecked': installed,
        'prospective_helpers': {p: sha(Path(p).read_bytes()) for p in prior['helpers'] if Path(p).exists()},
        'executables': executables,
        'limits': {'seconds': 120, 'aggregate_rss_bytes': 805306368, 'scratch_bytes': 134217728, 'combined_logs_bytes': 2097152, 'workers': 1},
        'selected_check_groups': [
            {'id': 'C1', 'owner': '100', 'proposed_test_path': 'server/test/gcsp-runtime-composition.test.js',
             'cases': ['shared authority and raw claims receivers', 'release registers once before seal and startup releases nothing',
                       'committed92 IDs reach decorated manual HTTP and history', 'no provider means no synthetic release fallback',
                       'registration refusal participates in guarded503', 'reset rejects stale context and missing newrun source fails closed']},
            {'id': 'C2', 'owner': '103', 'proposal_ref': REFS['103'],
             'cases': ['default Paula HTTP parity and privacy suppression', 'separate five-subject weighted active/draft/publish and quote pins']},
            {'id': 'C3', 'owner': '69/70', 'proposed_test_path': 'server/test/gcsp-manual-gallery-review-journey.test.js',
             'cases': ['actual released claimInput through rendered gallery callback into current review',
                       'existing active quoted reload without descriptor, invented command or POST',
                       'blocked Back retains attempt; actual terminal release returns fresh gallery',
                       'host setup-ready and disposal ignore duplicate/old callbacks']},
            {'id': 'C4', 'owner': '122', 'cases': ['actual92 canonical snapshot and persisted driver through cases HTTP',
                                                 'actual manual/buddy occupancy removes exact option; remedy does not claim']},
            {'id': 'C5', 'owner': '126', 'cases': ['actual92 presenter HTTP/controller new IDs, replay, empty and refusal',
                                                 'later-handler pending preserves committed result; newrun source or truthful unavailable']},
        ],
        'selection_status': 'Exact behavioral selection only. Proposed new tests/helpers are not authored or admitted by this source catalogue. No test count or result is claimed.',
        'execution_freeze_missing': ['selected test/supervisor/loader bytes and complete imports', 'trusted source profile and per-newrun preparation',
                                   'fresh host budget, strict external manifests, sanitizer and independent teardown audit',
                                   'approved exact source adoption; separately owned103/69/70/122/126 plans'],
        'exclusions': ['no business test, service, browser, native, full or source collection run', 'no unchanged9/25 rerun', 'no frozen66 or paused96 edits']}
(HERE / 'runtime-composition-source-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({'sources': len(seen), 'literal_edges': len(edges), 'leaf_candidates': len(proposals),
                  'changed_leaf_candidates': sum(p['adoption'] for p in proposals), 'unresolved': unresolved,
                  'external_packages': external, 'pg_identities': len(installed),
                  'source_plan_sha256': sha((HERE / 'runtime-composition-source-plan.json').read_bytes())}, indent=2))
