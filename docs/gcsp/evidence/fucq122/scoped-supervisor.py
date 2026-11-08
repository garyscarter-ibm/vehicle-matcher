#!/usr/bin/env python3
"""Run explicit FUCQ-122 checks with owned process/scratch and bounded resources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
from test_resources import HostBudget, Policy, Scratch, allocated_bytes, atomic_json, group_has_live_members, handled_termination, read_json, run_process

parser = argparse.ArgumentParser()
parser.add_argument('--name', required=True)
parser.add_argument('--rss-mib', type=int, choices=(384, 512, 768), default=768)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
if not command:
    parser.error('supply an explicit check command after --')
shared = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122-options')
run_id = args.name + '-' + uuid.uuid4().hex[:10]
run = shared / run_id
run.mkdir(parents=True)
rss_bytes = args.rss_mib * 1024 * 1024
policy = Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': args.rss_mib, 'chunk_seconds': 120, 'log_mib': 2})
host = HostBudget(policy)
scratch = Scratch(shared, ROOT, policy, expected=128 * 1024 * 1024)
scratch.root = Path('/tmp/fucq122-options-' + run_id)
scratch.record['root'] = str(scratch.root)
env = {key: value for key, value in os.environ.items()
       if not ('DATABASE' in key.upper() or 'DB_URL' in key.upper() or key.upper().startswith('PG'))}
dependency = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/node_modules').resolve()
dependency_stat = dependency.stat()
lock = ROOT / 'package-lock.json'
receipt = {'runId': run_id, 'command': command, 'cwd': str(ROOT), 'limits': {'seconds': 120, 'rssMiB': args.rss_mib, 'scratchMiB': 128, 'logMiB': 2, 'workers': 1},
           'dependencyAdoption': {'path': str(dependency), 'allocatedBytes': allocated_bytes(dependency), 'device': dependency_stat.st_dev, 'inode': dependency_stat.st_ino, 'packageLockSha256': hashlib.sha256(lock.read_bytes()).hexdigest()},
           'serverDependencyAdoption': {'path': str((ROOT / 'server/node_modules').resolve()), 'allocatedBytes': allocated_bytes((ROOT / 'server/node_modules').resolve()), 'device': (ROOT / 'server/node_modules').stat().st_dev, 'inode': (ROOT / 'server/node_modules').stat().st_ino},
           'databaseEnvironmentRemoved': True, 'scope': 'Explicit named checks; synthetic loopback HTTP permitted, no external live integration or full suite.'}
try:
    with handled_termination():
        host.acquire(scratch.token, 128 * 1024 * 1024, rss_bytes, '/tmp', root=scratch.root)
        try:
            with scratch:
                receipt['result'] = run_process(command, ROOT, env, run / 'check.log', scratch, policy,
                                                128 * 1024 * 1024, rss_bytes, 120, host=host)
        finally:
            host.release(scratch.token)
finally:
    receipt['groupsAbsent'] = all(not group_has_live_members(pgid) for pgid in scratch.record['groups'])
    receipt['reservationAbsent'] = scratch.token not in (read_json(host.path, {}) or {})
    receipt['scratchAbsent'] = not os.path.lexists(scratch.root)
    receipt['manifest'] = str(scratch.manifest)
    atomic_json(run / 'summary.json', receipt)
    print(json.dumps(receipt, indent=2))
sys.exit(0 if receipt.get('result', {}).get('rc') == 0 and not receipt['result'].get('issue') and all(receipt[key] for key in ['scratchAbsent', 'groupsAbsent', 'reservationAbsent']) else 1)
