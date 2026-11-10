#!/usr/bin/env python3
"""Bounded FUCQ-309 command launcher; scratch finalizers come from test_resources."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

WORKTREE = Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027')
RETAINED = Path('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110')
RUNS = RETAINED / 'fucq309-supervisor'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--id', required=True)
parser.add_argument('--seconds', type=int, default=600)
parser.add_argument('--ram-mib', type=int, default=1536)
parser.add_argument('--scratch-mib', type=int, default=64)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
if not command or '/' in args.id or '..' in args.id:
    parser.error('supply a simple run id and a command after --')
spec = importlib.util.spec_from_file_location('fucq309_resources', WORKTREE / '_tools/test_resources.py')
resources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resources)
policy = resources.Policy({'chunk_seconds': args.seconds, 'chunk_ram_mib': args.ram_mib,
    'chunk_scratch_mib': args.scratch_mib, 'unit_ram_mib': args.ram_mib,
    'unit_scratch_mib': args.scratch_mib, 'log_mib': 2,
    'output_root': '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude'})
git_spec = importlib.util.spec_from_file_location('fucq309_scaffold_git', WORKTREE / '_tools/scaffold_git.py')
scaffold_git = importlib.util.module_from_spec(git_spec)
git_spec.loader.exec_module(scaffold_git)
def git(*parts):
    rc, output, error = scaffold_git.git(str(WORKTREE), list(parts))
    if rc:
        raise RuntimeError('scaffold git identity read failed: ' + (error or output)[:300])
    return output.strip()
files = {}
for part in command:
    path = Path(part)
    path = path if path.is_absolute() else WORKTREE / path
    if path.is_file():
        files[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
identity = {'story': 'FUCQ-309', 'id': args.id, 'command': command,
    'head': git('rev-parse', 'HEAD'),
    'tracked_diff_sha256': hashlib.sha256(git('diff', 'HEAD', '--binary').encode()).hexdigest(),
    'command_files_sha256': files, 'limits': {'seconds': args.seconds,
        'ram_mib': args.ram_mib, 'scratch_mib': args.scratch_mib},
    'environment_sha256': resources.digest(dict(os.environ))}
RUNS.mkdir(parents=True, exist_ok=True)
resources.atomic_json(RUNS / (args.id + '-plan.json'), identity)
units = [{'id': args.id, 'seconds': args.seconds,
    'disk': args.scratch_mib * resources.MIB, 'ram': args.ram_mib * resources.MIB}]
def launch(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
    # This diagnostic's --seconds is an explicit hard limit, not only an estimated unit duration.
    effective_timeout = min(timeout, args.seconds)
    result = resources.run_process(command, str(WORKTREE), dict(os.environ), log,
        scratch, policy, disk_limit, ram_limit, effective_timeout, host, cancel)
    result['effective_timeout_seconds'] = effective_timeout
    transcript = Path(log).read_text(errors='replace')
    if result['rc'] == 0 and len(transcript) > 16384:
        Path(log).write_text('Successful command tail:\n' + transcript[-16384:])
    print(transcript[-16384:], flush=True)
    return result
try:
    # execute installs cancellation/join finalizers; Scratch writes its external ownership
    # manifest before mkdir, propagates TMPDIR/TMP/TEMP, and verifies removal in __exit__.
    data = resources.execute(units, identity, str(WORKTREE), str(RUNS),
        str(RUNS / 'logs' / args.id), policy, 1, launch)
    resources.atomic_json(RUNS / (args.id + '-receipt.json'), data)
    print(json.dumps({'receipt': str(RUNS / (args.id + '-receipt.json')),
        'state': data['state'], 'issues': data.get('issues', [])}), flush=True)
    completed = [chunk['result'] for chunk in data['completed'].values()]
    passed = data['state'] == 'complete' and all(result['rc'] == 0 for result in completed)
    sys.exit(0 if passed else 1)
except KeyboardInterrupt:
    print('Interrupted: supervisor joined children and attempted owned cleanup; inspect ownership manifest.', flush=True)
    sys.exit(130)
