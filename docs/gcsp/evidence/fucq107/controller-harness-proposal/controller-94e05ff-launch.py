"""Gated handoff: parent records this exact PID/start/group before opening stdin.
No Node or product module is loaded before the one-byte gate. exec preserves the
owned PID and group; the supervisor recursively records Node test descendants.
"""
import os
import sys
EXPECTED = ['/opt/homebrew/Cellar/node/26.5.0/bin/node', '--loader', '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/controller-94e05ff-loader.mjs', '--test', '--test-reporter=tap', '--test-concurrency=1', 'server/test/gcsp-second-offer-controller.test.js']
if not sys.flags.isolated or not sys.dont_write_bytecode or sys.argv[1:] != EXPECTED:
    raise RuntimeError('Reviewed launch command differs')
if os.read(0, 1) != b'1':
    raise RuntimeError('Controller launch gate refused')
os.execve(EXPECTED[0], EXPECTED, dict(os.environ))
