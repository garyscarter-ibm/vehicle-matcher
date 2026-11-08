#!/usr/bin/python3
"""One bounded offline check chunk; never makes source requests."""
import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[5]
spec = importlib.util.spec_from_file_location('owned_resources', ROOT / '_tools/test_resources.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
phase = sys.argv[1]
assert phase in ('red', 'green', 'green2', 'green3', 'prepared', 'prepared-red', 'prepared-red2', 'prepared-red3', 'prepared-green', 'prepared-green2', 'retained')
files = ['server/test/gcsp-bmw-model-options-qualification.test.js']
if phase == 'retained':
    files = ['docs/gcsp/evidence/fucq59/f70-remaining-options-qualification-2026-11-07/retained-check.test.mjs']
if phase.startswith('prepared'):
    files = ['docs/gcsp/evidence/fucq59/f70-remaining-options-qualification-2026-11-07/prepared-check.test.mjs']
if phase.startswith('green'):
    files += ['server/test/gcsp-bmw-options-qualification.test.js', 'server/test/gcsp-bmw-context-qualification.test.js', 'server/test/gcsp-fleet-collector.test.js']
output = ROOT / '.claude/f58-63-overnight-20261106/f58/f70-remaining-options/offline' / phase
output.mkdir(parents=True, exist_ok=False)
policy = r.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 1024 if phase in ('prepared-red','prepared-red2','prepared-red3','prepared-green','prepared-green2') else 512, 'chunk_seconds': 60, 'log_mib': 1})
host = r.HostBudget(policy)
scratch = r.Scratch(output, ROOT, policy, expected=8*r.MIB)
# Registered before allocation; Scratch owns inode verification and cleanup.
owned_link = None
receipt = {'phase': phase, 'selected': files, 'sourceTraffic': False, 'result': None}
def finalize():
    global owned_link
    if owned_link is not None:
        link = ROOT / 'server/node_modules'
        assert link.is_symlink() and link.lstat().st_ino == owned_link
        link.unlink(); owned_link = None
        receipt['dependencyLinkRemoved'] = not os.path.lexists(link)
    host.release(scratch.token)
    receipt['cleanup'] = {'root': str(scratch.root), 'absent': not os.path.lexists(scratch.root), 'manifest': str(scratch.manifest)}
    r.atomic_json(output / 'receipt.json', receipt)
atexit.register(finalize)
env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'TZ': 'UTC', 'NODE_OPTIONS': '--max-old-space-size=320'}
command = ['/opt/homebrew/bin/node', '--test', '--test-concurrency=1', *files]
receipt['identity'] = {path: hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in files + ['scripts/gcsp/bmw-public-registration.mjs', 'scripts/gcsp/public-bmw-source.mjs', 'scripts/gcsp/collect-fleet.mjs', 'scripts/gcsp/collection-session.mjs']}
try:
    host.acquire(scratch.token, (128 if phase in ('prepared-red','prepared-red2','prepared-red3','prepared-green','prepared-green2') else 64)*r.MIB, (1024 if phase in ('prepared-red','prepared-red2','prepared-red3','prepared-green','prepared-green2') else 512)*r.MIB, '/private/tmp', root=scratch.root)
    with r.handled_termination(), scratch:
        if phase.startswith('green'):
            link = ROOT / 'server/node_modules'
            assert not os.path.lexists(link)
            r.atomic_json(output/'dependency-link.json', {'path':str(link),'state':'planned','source':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'})
            link.symlink_to('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules', target_is_directory=True)
            owned_link = link.lstat().st_ino
            r.atomic_json(output/'dependency-link.json', {'path':str(link),'inode':owned_link,'state':'active'})
        receipt['result'] = r.run_process(command, ROOT, env, output/'test.log', scratch, policy, 64*r.MIB, (900 if phase in ('prepared-red','prepared-red2','prepared-red3','prepared-green','prepared-green2') else 448)*r.MIB, 60, host=host)
finally:
    finalize()
print(json.dumps(receipt, sort_keys=True))
sys.exit(0 if receipt['result'] and receipt['result']['rc'] == 0 and not receipt['result']['issue'] else 1)
