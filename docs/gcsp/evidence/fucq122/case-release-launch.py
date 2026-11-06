"""One gated child. No Node/application import before parent PID registration."""
import hashlib
import os
from pathlib import Path
import sys

if not sys.flags.isolated or not sys.dont_write_bytecode or len(sys.argv) != 8:
    raise RuntimeError('C4 launch shape differs')
expected = [os.environ['FUCQ122_C4_NODE'], '--loader', os.environ['FUCQ122_C4_LOADER'],
            '--test', '--test-reporter=tap', '--test-concurrency=1', os.environ['FUCQ122_C4_ENTRY']]
if sys.argv[1:] != expected or os.read(0, 1) != b'1':
    raise RuntimeError('C4 launch gate refused')
for path, digest in [(expected[0], os.environ['FUCQ122_C4_NODE_SHA']),
                     (expected[2], os.environ['FUCQ122_C4_LOADER_SHA']),
                     (os.environ['FUCQ122_C4_PLAN'], os.environ['FUCQ122_C4_PLAN_SHA'])]:
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
        raise RuntimeError('C4 pre-exec pin differs')
os.execve(expected[0], expected, dict(os.environ))
