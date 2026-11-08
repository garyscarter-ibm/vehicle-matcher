#!/usr/bin/env python3
"""Authorized exact source adoption only; never imports products or executes tests."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G

SOURCE = HERE / 'http-release-source-plan-f179ae6-2026-11-06.json'
RECEIPT = HERE / 'http-candidate-adoption-f179ae6-2026-11-06.json'
if RECEIPT.exists():
    raise RuntimeError('Preserve the original source-adoption receipt; inspect rather than replay.')
plan = json.loads(SOURCE.read_text()); ref = plan['centralRef']
preserved = ['blocks/gcsp/presenter-controls/controls.js', 'blocks/gcsp/presenter-controls/http-adapter.js',
             'blocks/gcsp/kit/presenter-bar.js', 'server/gcsp/presenter-controls/commands.js',
             'server/gcsp/presenter-controls/http.js', 'server/gcsp/presenter-controls/index.js',
             'server/gcsp/scenarios/index.js', 'server/gcsp/clock/index.js', 'server/gcsp/policy/seed-v1.json']
before = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in preserved}
changes = []; payloads = {}
for row in plan['sources']:
    name = row['path']
    # Reference documents and upstream tests are not imports needed by this owned six-case target.
    if row['ref'] != ref or not name.startswith(('server/', 'blocks/')) or name.startswith('server/test/'):
        continue
    path = ROOT / name
    current = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    if current == row['sha256']:
        continue
    if name in preserved:
        raise RuntimeError('An accepted presenter leaf conflicts with canonical source: ' + name)
    with G.checkout_mutex(ROOT):
        rc, out, error = G.git(ROOT, ['show', ref + ':' + name])
    if rc:
        raise RuntimeError(error)
    data = out.encode()
    if hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != row['blob'] \
            or hashlib.sha256(data).hexdigest() != row['sha256'] or len(data) != row['bytes']:
        raise RuntimeError('Published source bytes do not match: ' + name)
    payloads[name] = data
    changes.append({**row, 'beforeSha256': current, 'operation': 'add' if current is None else 'replace-exact'})
receipt = {'date': '2026-11-06', 'state': 'planned', 'sourceRef': ref,
           'authorization': 'Dispatcher authorized minimum adoption into owned126 tree for exact candidate; no execution grant.',
           'changed': changes, 'preservedBefore': before,
           'excluded': ['Upstream tests/reference documents', 'C5 host/shell/launcher integration',
                        'New reset/event API', 'Business facts/atomic preparation', 'TEST46fa profile not needed by isolated count cases'],
           'execution': 'No product imports, Node, tests, probes or test-resource allocations.'}
RECEIPT.write_text(json.dumps(receipt, indent=2) + '\n')
for name, data in payloads.items():
    path = ROOT / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
for name, expected in before.items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
        raise RuntimeError('Accepted leaf changed: ' + name)
for row in changes:
    if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
        raise RuntimeError('Adopted source did not persist exactly: ' + row['path'])
receipt.update(state='adopted-exact-unexecuted', preservedAfter=before, changedCount=len(changes),
               adoptedBytes=sum(len(data) for data in payloads.values()))
RECEIPT.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'changed': len(changes), 'bytes': receipt['adoptedBytes'], 'receipt': str(RECEIPT),
                  'preserved': len(before), 'executed': False}))
