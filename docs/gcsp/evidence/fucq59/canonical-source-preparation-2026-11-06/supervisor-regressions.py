"""Offline reservation port regressions; source supervisor main is never called."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

BASE = Path(__file__).resolve().parent
PROJECT = Path('/Users/usget/Claude/vehicle-matcher')
OLD = PROJECT / '.claude/worktrees/DEV-2026-11-04-032/docs/gcsp/evidence/fucq59/source-diagnostic-live-2026-11-06/supervise-live.py'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


current = load('four_get_port', BASE / 'supervise-live.py')
old = load('four_get_historical', OLD)
resources = load('four_get_trusted_resources', PROJECT / '_tools/test_resources.py')
proofs = []
coverage_contexts = {}


def extracted(module, path, terminal_only=False):
    """Compile only exact existing finalizer/terminal statements, never main/preflight/transport."""
    tree = ast.parse(path.read_text())
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    outer = next(n for n in main.body if isinstance(n, ast.With))
    finalizer = next(n for n in outer.body if isinstance(n, ast.Try)).finalbody
    terminal = main.body[-2:]
    assert isinstance(terminal[0], ast.Expr) and isinstance(terminal[1], ast.Return)
    names = 'failure outcome observed receipt reserved host scratch tr marker output allocation RDIR'.split()
    fn = ast.FunctionDef(name='exercise', args=ast.arguments(posonlyargs=[], args=[ast.arg(arg=n) for n in names],
        kwonlyargs=[], kw_defaults=[], defaults=[]), body=copy.deepcopy(terminal if terminal_only else finalizer + terminal), decorator_list=[])
    compiled = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
    namespace = dict(module.__dict__)
    exec(compile(compiled, str(path) + ':selected-AST-only', 'exec'), namespace)
    return namespace['exercise']


wire = extracted(current, BASE / 'supervise-live.py')
old_wire = extracted(old, OLD)
terminal = extracted(current, BASE / 'supervise-live.py', terminal_only=True)


class ReservationPortTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='four-get-port-', dir=os.environ['TMPDIR']))
        self.addCleanup(shutil.rmtree, self.root)
        self.policy = resources.Policy(dict(chunk_scratch_mib=64, chunk_ram_mib=384, chunk_seconds=120, log_mib=1))
        self.host = resources.HostBudget(self.policy, self.root / 'synthetic-ledger')
        self.token = 'synthetic-owned-token'
        resources.atomic_json(self.host.path, {self.token: {'synthetic': True}})
        self.scratch = SimpleNamespace(token=self.token, root=self.root / 'absent-scratch',
            manifest=self.root / 'removed-manifest.json', record={'groups': [], 'peak': 0})
        resources.atomic_json(self.scratch.manifest, {'state': 'removed'})
        self.calls = 0
        self.lines = set()
        target = str(BASE / 'supervise-live.py')
        def trace(frame, event, arg):
            if event == 'line' and frame.f_code.co_filename.startswith(target):
                self.lines.add((frame.f_code.co_name, frame.f_lineno))
            return trace
        sys.settrace(trace)

    def tearDown(self):
        sys.settrace(None)
        coverage_contexts[self.id()] = [{'function': name, 'line': line} for name, line in sorted(self.lines)]

    def release(self, mode):
        original = self.host.release
        def chosen(token):
            self.calls += 1
            if mode == 'raises':
                raise OSError('SYNTHETIC PRIVATE release')
            if mode != 'retains':
                original(token)
            if mode == 'raises-after-removal':
                raise OSError('SYNTHETIC PRIVATE release')
        return chosen

    def invoke(self, fn=wire, mode='success', reserved=True, failure=None, outcome=None, force_no_outcome=False):
        receipt = {}
        outcome = None if force_no_outcome else (outcome or {'rc': 0, 'issue': None})
        stream = io.StringIO()
        with mock.patch.object(self.host, 'release', self.release(mode)), contextlib.redirect_stdout(stream):
            rc = fn(failure, outcome, {'counts': None}, receipt, reserved, self.host, self.scratch,
                resources, self.root / 'absent-marker', self.root / 'absent-output', {}, self.root / 'receipt-dir')
        summary = json.loads(stream.getvalue())
        self.assertEqual(json.loads((self.root / 'receipt-dir/supervisor-receipt.json').read_text()), receipt)
        self.assertNotIn('SYNTHETIC PRIVATE', json.dumps([receipt, summary]))
        return receipt, summary, rc

    def assert_release(self, mode, status, absent, failure=None):
        receipt, summary, rc = self.invoke(mode=mode, failure=failure)
        expected = {'status': status, 'absent': absent}
        self.assertEqual(self.calls, 1)
        self.assertEqual(receipt['reservationRelease'], expected)
        self.assertEqual(summary['reservationRelease'], expected)
        self.assertEqual(receipt['leftovers'], [] if status == 'released' else ['reservation:' + self.token])
        self.assertEqual(summary['leftovers'], receipt['leftovers'])
        self.assertEqual(receipt['failure'], failure or (None if status == 'released' else 'reservation-cleanup-failed'))
        self.assertEqual(summary['failure'], receipt['failure'])
        self.assertEqual(rc, int(bool(failure or status != 'released')))
        self.assertTrue(receipt['scratchAbsent'])
        self.assertEqual(receipt['manifestState'], 'removed')
        proofs.append({'case': mode, 'receipt': receipt, 'summary': summary, 'rc': rc})

    def test_verified_absence_is_success(self):
        self.assert_release('success', 'released', True)

    def test_release_exception_is_named_failure(self):
        self.assert_release('raises', 'failed', False)

    def test_release_exception_after_removal_remains_failure(self):
        self.assert_release('raises-after-removal', 'failed', True)

    def test_successful_noop_retaining_token_is_named_failure(self):
        self.assert_release('retains', 'still-present', False)

    def test_readback_exception_is_unverified(self):
        with mock.patch.object(current, 'read_small', side_effect=OSError('SYNTHETIC PRIVATE readback')):
            # Extracted globals hold the same original function; replace that exact binding.
            with mock.patch.dict(wire.__globals__, read_small=current.read_small):
                self.assert_release('success', 'unverified', None)

    def test_bad_bounded_ledger_shapes_are_unverified(self):
        for value in ('{bad', '[]', 'x' * 131073, 'symlink'):
            with self.subTest(kind=value[:8]):
                if self.host.path.is_symlink():
                    self.host.path.unlink()
                if value == 'symlink':
                    self.host.path.unlink()
                    self.host.path.symlink_to(self.root / 'absent-target')
                else:
                    self.host.path.write_text(value)
                with mock.patch.object(self.host, 'release', lambda token: None):
                    result = current.release_reservation(self.host, self.token, resources)
                self.assertEqual(result, {'status': 'unverified', 'absent': None})

    def test_lock_failure_is_unverified_and_attempts_release_once(self):
        fake_resources = SimpleNamespace(locked=mock.Mock(side_effect=OSError('SYNTHETIC PRIVATE lock')))
        with mock.patch.object(self.host, 'release', self.release('success')):
            result = current.release_reservation(self.host, self.token, fake_resources)
        self.assertEqual(self.calls, 1)
        self.assertEqual(result, {'status': 'unverified', 'absent': None})

    def test_not_acquired_preserves_prior_failure_without_release(self):
        receipt, summary, rc = self.invoke(reserved=False, failure='supervisor-stopped', force_no_outcome=True)
        self.assertEqual(self.calls, 0)
        self.assertEqual(receipt['reservationRelease'], {'status': 'not-acquired', 'absent': None})
        self.assertEqual(summary['reservationRelease'], receipt['reservationRelease'])
        self.assertEqual(receipt['leftovers'], [])
        self.assertEqual(receipt['failure'], 'supervisor-stopped')
        self.assertEqual(rc, 1)

    def test_prior_failure_survives_release_failure(self):
        self.assert_release('raises', 'failed', False, 'handled-cancellation')

    def test_scratch_and_group_leftovers_survive_reservation_wiring(self):
        self.scratch.root.mkdir()
        self.scratch.record['groups'] = [123456789]
        with mock.patch.dict(wire.__globals__, group_absent=lambda pgid: False):
            receipt, summary, rc = self.invoke(mode='raises')
        self.assertEqual(receipt['leftovers'], [str(self.scratch.root), 'pgid:123456789', 'reservation:' + self.token])
        self.assertEqual(summary['leftovers'], receipt['leftovers'])
        self.assertEqual(rc, 1)

    def test_terminal_guard_independently_refuses_unresolved_status(self):
        for status in ('failed', 'unverified', 'still-present'):
            with self.subTest(status=status), contextlib.redirect_stdout(io.StringIO()):
                receipt = {'markerPresent': False, 'scratchAbsent': True, 'leftovers': [],
                    'reservationRelease': {'status': status, 'absent': None}}
                self.assertEqual(terminal(None, {'rc': 0, 'issue': None}, None, receipt, True,
                    None, None, None, None, None, None, None), 1)

    def test_historical_finalizer_reproduces_three_silent_cleanup_failures(self):
        for mode in ('raises', 'retains', 'unreadable-ledger'):
            with self.subTest(mode=mode):
                resources.atomic_json(self.host.path, {self.token: {'synthetic': True}})
                with mock.patch.object(old, 'read_small', side_effect=OSError('SYNTHETIC PRIVATE unreadable')):
                    receipt, summary, rc = self.invoke(fn=old_wire, mode='retains' if mode == 'unreadable-ledger' else mode)
                self.assertEqual(rc, 0)
                self.assertEqual(receipt['leftovers'], [])
                self.assertNotIn('reservationRelease', receipt)
                proofs.append({'historicalDefectReproduced': mode, 'rc': rc, 'leftovers': receipt['leftovers']})


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReservationPortTests))
    resources.atomic_json(BASE / 'regression-proof-summary.json', {'scope': 'offline-helper-and-exact-finalizer-terminal-AST-only',
        'sourceMainInvoked': False, 'sourceRequests': 0, 'tests': result.testsRun,
        'failures': len(result.failures), 'errors': len(result.errors), 'skipped': len(result.skipped),
        'coverageContexts': coverage_contexts, 'proofs': proofs})
    raise SystemExit(not result.wasSuccessful())
