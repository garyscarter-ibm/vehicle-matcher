#!/usr/bin/env python3
"""Run the real full stamp under FUCQ-98's registered outer supervisor."""
import importlib.util
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
COMMAND = "node --test --test-concurrency=1 'server/test/**/*.test.js'"
RUN = 'fucq98-20261105-brevo-transport-full-inner'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

git = module('f98_safe_git', ROOT / '_tools/scaffold_git.py')
stamp = module('f98_test_stamp', ROOT / '_tools/test_stamp.py')
resources = module('f98_stamp_resources', ROOT / '_tools/test_resources.py')

def safe_git(root, args):
    with git.checkout_mutex(root):
        rc, out, error = git.git(root, list(args))
    if rc:
        raise stamp.RunError('Safe Git read failed: ' + (error or out)[:300])
    return out

stamp._git = safe_git

def ref_exists(root, ref):
    with git.checkout_mutex(root):
        return git.git(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])[0] == 0

stamp.ref_exists = ref_exists
OriginalScratch = resources.Scratch

class RunScratch(OriginalScratch):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.token = RUN
        self.root = Path('/private/tmp') / ('test-stamp-shard-' + RUN)
        self.manifest = Path(stamp.runs_dir(str(ROOT))) / 'ownership' / (RUN + '.json')
        self.record.update(token=RUN, root=str(self.root), finalizer=str(Path(__file__).resolve()))

resources.Scratch = RunScratch
stamp.resource_module = lambda: resources
original_settings = stamp.load_settings

def settings(root, command_override=None):
    configured = original_settings(root, command_override or COMMAND)
    configured.resources = {**configured.resources, 'chunk_scratch_mib': 24, 'unit_scratch_mib': 24,
        'chunk_ram_mib': 640, 'unit_ram_mib': 640, 'chunk_seconds': 570, 'log_mib': 2,
        'inputs': ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json',
            '.claude/scaffolding.json', 'docs/gcsp/evidence/fucq98/validate-full.py']}
    return configured

stamp.load_settings = settings
if '--full' in sys.argv:
    assert os.environ.get('TEST_RESOURCE_PARENT_RESERVATION') == 'fucq98-20261105-brevo-transport', 'Use the registered outer full supervisor.'
raise SystemExit(stamp.main(['--root', str(ROOT), *sys.argv[1:]]))
