#!/usr/bin/env python3
"""Own the finite, single-worker offline audit and its cleanup receipt."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
WORKTREE = Path(__file__).resolve().parents[5]
ROOT = Path('/Users/usget/Claude/vehicle-matcher')
RDIR = ROOT / '.claude/test-runs/f60-exact10000-retained-coverage-20261107'
PACKET = Path(__file__).resolve().parent
OUT = Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-retained-coverage-20261107')
spec = importlib.util.spec_from_file_location('resources', WORKTREE / '_tools/test_resources.py')
resources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resources)

script = PACKET / 'audit-selection.py'
identity = {'run': 'f60-exact10000-retained-coverage-20261107',
            'scriptSha256': hashlib.sha256(script.read_bytes()).hexdigest(),
            'python': sys.version, 'source': 'pinned-global-union10351', 'network': 'none'}
RDIR.mkdir(parents=True, exist_ok=True)
resources.atomic_json(RDIR / 'plan.json', {
    'identity': identity, 'changedPaths': [str(PACKET)], 'regression': 'selection drops baseline or observed categories',
    'boundaries': ['canonical source union', 'exact source row identity/selection', 'candidate historical-v2 split'],
    'selectedChecks': ['finite offline streaming inventory and selection invariants', '1949 pinned byte-range shard hashes'],
    'excluded': {'testSuite': 'documentation/evidence only; no production change',
                 'pilot311': 'reuse unchanged retained evidence', 'network': 'no reviewed source allocation'},
    'ownedOutputRoot': str(OUT), 'scratch': 'allocated by resources.Scratch with manifest and supervisor finalizer',
    'expected': {'scratchBytes': 64 * 1024**2, 'retainedOutputBytes': 32 * 1024**2,
                 'peakRamBytes': 448 * 1024**2, 'durationSeconds': 180, 'workers': 1},
    'cleanup': 'stop/join owned child group, remove owned scratch and verify absence; retain compact packet only',
})
policy = resources.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512,
                           'unit_ram_mib': 448, 'chunk_seconds': 300, 'log_mib': 2})

def callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
    result = resources.run_process([sys.executable, '-B', str(script)], WORKTREE,
        {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, log, scratch, policy,
        disk_limit, ram_limit, timeout, host, cancel)
    if result['rc'] != 0 and not result.get('issue'):
        result.update(issue='offline audit exited %s; inspect bounded log' % result['rc'], retryable=False)
    return result

result = resources.execute(
    [{'id': 'retained10351-select10000', 'disk': 64*1024**2, 'ram': 448*1024**2, 'seconds': 180}],
    identity, WORKTREE, RDIR, RDIR / 'logs', policy, 1, callback)
resources.atomic_json(RDIR / 'execution-result.json', result)
print(json.dumps(result))
