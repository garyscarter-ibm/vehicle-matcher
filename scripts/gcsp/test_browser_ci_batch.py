"""Focused CI selection/receipt regressions; never starts a browser or database."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

SCRIPT = Path(__file__).with_name('browser-ci-batch.py')
SPEC = importlib.util.spec_from_file_location('browser_ci_batch', SCRIPT)
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)
FAMILIES = ['f340', 'f548', 'f549', 'f550', 'f551', 'f552', 'f553', 'f554',
            'f555', 'f556', 'f557', 'f558', 'f559', 'f560', 'f561', 'f520', 'f521', 'f595']


class SelectionTest(unittest.TestCase):
    def plan(self, *arguments, selected=''):
        return subprocess.run([sys.executable, '-B', str(SCRIPT), '--plan', *arguments],
                              env={**os.environ, 'GCSP_BROWSER_CASE': selected},
                              capture_output=True, text=True, timeout=10)

    def test_no_selection_retains_the_entire_registered_union(self):
        result = self.plan()
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(list(plan['families']), FAMILIES)
        self.assertEqual(plan.get('selected_cases'), FAMILIES)
        self.assertEqual(plan.get('coverage_scope'), 'registered-union')

    def test_one_case_plans_only_that_family_and_discloses_the_full_registration(self):
        result = self.plan('--case', 'f340')
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan['families'], {'f340': 'apps/gcsp-web/e2e/suv-walkthrough.test.mjs'})
        self.assertEqual(plan['selected_cases'], ['f340'])
        self.assertEqual(list(plan['registered_families']), FAMILIES)
        self.assertEqual(plan['coverage_scope'], 'registered-subset')

    def test_workflow_environment_selects_one_and_repeated_cli_cases_deduplicate(self):
        result = self.plan(selected='f340')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout).get('selected_cases'), ['f340'])
        result = self.plan('--case', 'f555', '--case', 'f340', '--case', 'f555')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['selected_cases'], ['f555', 'f340'])

    def test_unknown_or_shell_shaped_selection_is_rejected_before_any_run(self):
        for value in ['f999', 'f340; touch /unowned', 'f340$(false)', 'f340 f555']:
            with self.subTest(value=value):
                result = self.plan(selected=value)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertIn('invalid choice', result.stderr)
        self.assertEqual(self.plan('--case', 'f999').returncode, 2)

    def test_subset_still_validates_the_entire_registration_before_planning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / 'apps/gcsp-web/e2e/run.py'
            entry.parent.mkdir(parents=True)
            entry.write_text("CASES = {'f340': 'apps/gcsp-web/e2e/suv-walkthrough.test.mjs'}\n")
            self.assertTrue(callable(getattr(batch, 'parse_options', None)), 'case-aware parser is missing')
            with patch.object(batch, 'ROOT', root), patch.dict(os.environ, {'GCSP_BROWSER_CASE': ''}):
                with contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaisesRegex(ValueError, 'Registered family union changed'):
                        batch.main(['--plan', '--case', 'f340'])


class ReceiptTest(unittest.TestCase):
    def summary(self, selected, executed=None):
        return {'source_revision': 'a' * 40, 'node_reference_revision': batch.REFERENCE,
                'selected_cases': selected, 'failure': None, 'cleanup': {'scratch_absent': True},
                'families': [{'family': name, 'complete': True, 'green': True,
                              'counts': {'tests': 1, 'suites': 0, 'pass': 1, 'fail': 0,
                                         'cancelled': 0, 'skipped': 0, 'todo': 0}}
                             for name in (selected if executed is None else executed)]}

    def finish(self, summary):
        self.assertTrue(callable(getattr(batch, 'finish_summary', None)), 'selected-run receipt finalizer is missing')
        batch.finish_summary(summary)
        return summary

    def test_successful_subset_is_complete_for_selection_without_full_union_coverage(self):
        result = self.finish(self.summary(['f340']))
        self.assertTrue(result['complete'])
        self.assertTrue(result['green'])
        self.assertFalse(result['full_union_complete'])
        self.assertEqual(result['unrun_selected_cases'], [])
        self.assertEqual(result['unselected_cases'], FAMILIES[1:])
        self.assertEqual(result['counts']['tests'], 1)
        self.assertEqual(result['source_revision'], 'a' * 40)
        self.assertEqual(result['node_reference_revision'], 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38')
        self.assertTrue(result['cleanup']['scratch_absent'])

    def test_complete_default_union_and_stopped_or_unclean_runs_remain_distinct(self):
        result = self.finish(self.summary(FAMILIES))
        self.assertTrue(result['complete'])
        self.assertTrue(result['full_union_complete'])
        self.assertEqual(result['counts']['pass'], 18)
        stopped = self.finish(self.summary(['f340', 'f555'], ['f340']))
        self.assertFalse(stopped['complete'])
        self.assertFalse(stopped['green'])
        self.assertEqual(stopped['unrun_selected_cases'], ['f555'])
        for change in [{'failure': 'setup failed'}, {'cleanup': {'scratch_absent': False}}]:
            with self.subTest(change=change):
                self.assertFalse(self.finish({**self.summary(['f340']), **change})['green'])

    def test_family_evidence_checks_actual_source_reference_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            receipt = {'source_revision': 'a' * 40, 'selected_cases': ['f340'], 'mode': 'automated',
                       'node_reference': {'revision': batch.REFERENCE}, 'finished': 1,
                       'scratch_removed': True, 'database_dropped': True, 'result': {'rc': 0}}
            (output / 'suite.log').write_text('\n'.join('# ' + name + ' ' + str(value) for name, value in
                [('tests', 1), ('suites', 0), ('pass', 1), ('fail', 0), ('cancelled', 0), ('skipped', 0), ('todo', 0)]))
            (output / 'process-cleanup.json').write_text('{"remaining": []}')
            for changes, expected in [({}, True), ({'source_revision': 'b' * 40}, False),
                                      ({'node_reference': {'revision': 'b' * 40}}, False),
                                      ({'scratch_removed': False}, False), ({'database_dropped': False}, False)]:
                with self.subTest(changes=changes):
                    (output / 'run-receipt.json').write_text(json.dumps({**receipt, **changes}))
                    result = batch.family_result(output, 'f340', 'a' * 40)
                    self.assertEqual(result['complete'], expected)
                    self.assertEqual(result['green'], expected)

    def test_incomplete_browser_cleanup_still_records_postgres_stop_and_preserves_scratch(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name, rc, postgres in [('stopped', 0, {'stopped': True}),
                                       ('refused', 0, {'refused': True, 'reason': 'owned database held'}),
                                       ('failed', 1, {'stopped': False, 'reason': 'stop failed'})]:
                with self.subTest(name=name):
                    output = base / name
                    root = output / 'scratch'
                    browser_root = output / 'browser-root'
                    root.mkdir(parents=True)
                    browser_root.mkdir()
                    browser_cleanup = {'complete': False, 'allocations': [],
                                       'leftovers': [{'root': str(browser_root), 'reason': 'open files'}]}
                    scratch = SimpleNamespace(root=root, __enter__=Mock(), env=lambda env: dict(env), __exit__=Mock())
                    browser_temps = SimpleNamespace(account=lambda scratch: contextlib.nullcontext(),
                                                    finalize=lambda: browser_cleanup)
                    summary = {'cleanup': {}}
                    stop_result = SimpleNamespace(returncode=rc, stdout=json.dumps(postgres))
                    with patch.object(batch.subprocess, 'run', return_value=stop_result) as stop:
                        with self.assertRaises(RuntimeError) as raised:
                            with batch.owned_stack(scratch, {}, summary, output, browser_temps):
                                pass
                    stop.assert_called_once()
                    self.assertEqual(stop.call_args.args[0], [sys.executable, '-B', '_tools/test_stack.py',
                                                             'pg', 'down', '--if-idle'])
                    self.assertEqual(summary['cleanup']['browser_temps'], browser_cleanup)
                    self.assertEqual(summary['cleanup']['postgres'], postgres)
                    self.assertEqual(json.loads((output / 'batch-receipt.json').read_text())['cleanup'], summary['cleanup'])
                    self.assertIn('Browser temp' if name == 'stopped' else 'PostgreSQL', str(raised.exception))
                    scratch.__exit__.assert_not_called()
                    self.assertTrue(root.exists())
                    self.assertTrue(browser_root.exists())


    def test_read_only_kit_cache_entries_in_the_owned_state_root_are_removed_with_scratch(self):
        # SCAF-71 review: the kit publishes clean builds read-only; the plain rmtree in Scratch.__exit__ must still work.
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            root = Path(directory) / 'scratch'
            entry = root / 'stack' / 'cache' / 'build-api' / 'k1' / 'output' / 'sub'
            entry.mkdir(parents=True)
            (entry / 'quarkus-run.jar').write_bytes(b'x')
            for path in [entry, *entry.parents]:
                if path == root:
                    break
                os.chmod(path, 0o555)
            scratch = SimpleNamespace(root=root, __enter__=Mock(), env=lambda env: dict(env),
                                      __exit__=lambda *a: batch.shutil.rmtree(root))
            browser_temps = SimpleNamespace(account=lambda scratch: contextlib.nullcontext(),
                                            finalize=lambda: {'complete': True, 'allocations': [], 'leftovers': []})
            stop_result = SimpleNamespace(returncode=0, stdout=json.dumps({'stopped': True}))
            env = {}
            with patch.object(batch.subprocess, 'run', return_value=stop_result):
                with batch.owned_stack(scratch, env, {'cleanup': {}}, output, browser_temps):
                    self.assertEqual(env['AGENT_TEST_STACK_DIR'], str(root / 'stack'))
            self.assertFalse(root.exists())

class BrowserTempsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name).resolve()
        self.output = self.base / 'output'
        self.family = self.output / 'f340'
        self.outer = self.base / 'outer'
        self.inner = self.outer / ('test-stamp-shard-' + 'b' * 32)
        self.inner.mkdir(parents=True)
        batch.resources.atomic_json(self.family / 'ownership' / ('b' * 32 + '.json'),
            {'version': 1, 'token': 'b' * 32, 'root': str(self.inner), 'state': 'active'})
        self.source = 'a' * 40
        self.open_files = patch.object(batch.subprocess, 'run',
            return_value=SimpleNamespace(returncode=1, stdout=b'', stderr=b''))
        self.open_files.start()
        self.addCleanup(self.open_files.stop)

    def allocation(self, token='c' * 32, **changes):
        root = self.base / ('gcsp-b-' + token)
        root.mkdir()
        (root / 'payload').write_bytes(b'x' * 9000)
        item = root.lstat()
        record = {'schema': 'gcsp-browser-temp/1', 'token': token, 'root': str(root),
                  'base': str(self.base), 'scratch': str(self.inner), 'source_revision': self.source,
                  'run_id': 'web-e2e-test', 'owner_pid': 987654321, 'state': 'active',
                  'device': item.st_dev, 'inode': item.st_ino, 'peak_bytes': 0, **changes}
        manifest = self.family / 'f340' / 'browser-temp-ownership' / (token + '.json')
        batch.resources.atomic_json(manifest, record)
        return root, manifest, record

    def tracker(self):
        self.assertTrue(callable(getattr(batch, 'BrowserTemps', None)), 'owned browser temp accounting is missing')
        return batch.BrowserTemps(self.output, self.source, self.base, self.outer)

    def cleanup_evidence(self, remaining=None):
        batch.resources.atomic_json(self.family / 'process-cleanup.json', {'remaining': remaining or []})

    def test_multiple_external_roots_are_added_to_existing_aggregate_sample(self):
        roots = [self.allocation(token)[0] for token in ['c' * 32, 'd' * 32]]
        tracker = self.tracker()
        scratch = SimpleNamespace(sample=lambda: 1234, record={'peak': 0})
        expected = 1234 + sum(batch.resources.allocated_bytes(root) for root in roots)
        with tracker.account(scratch):
            self.assertEqual(scratch.sample(), expected)
            self.assertEqual(scratch.record['peak'], expected)
        self.assertEqual(scratch.sample(), 1234)

    def test_dead_owner_is_recovered_only_after_verified_process_cleanup(self):
        root, manifest, _ = self.allocation()
        self.cleanup_evidence()
        with patch.object(batch.resources, 'process_alive', return_value=False):
            result = self.tracker().finalize()
        self.assertTrue(result['complete'])
        self.assertFalse(os.path.lexists(root))
        self.assertEqual(json.loads(manifest.read_text())['state'], 'removed')
        self.assertEqual(result['allocations'][0]['cleanup'], 'recovered')

    def test_live_owner_or_unverified_child_cleanup_preserves_root(self):
        root, _, _ = self.allocation()
        self.cleanup_evidence()
        with patch.object(batch.resources, 'process_alive', return_value=True):
            result = self.tracker().finalize()
        self.assertFalse(result['complete'])
        self.assertTrue(root.exists())
        self.assertIn('owner', result['leftovers'][0]['reason'])
        (self.family / 'process-cleanup.json').unlink()
        with patch.object(batch.resources, 'process_alive', return_value=False):
            self.assertFalse(self.tracker().finalize()['complete'])
        self.assertTrue(root.exists())

    def test_unjournalled_browser_users_or_unknown_open_files_preserve_root(self):
        root, manifest, _ = self.allocation()
        self.cleanup_evidence()
        for outcome in [SimpleNamespace(returncode=0, stdout=b'12345\n', stderr=b''),
                        SimpleNamespace(returncode=1, stdout=b'', stderr=b'unknown'),
                        OSError('lsof unavailable'), subprocess.TimeoutExpired('lsof', 5)]:
            with self.subTest(outcome=str(outcome)), patch.object(batch.resources, 'process_alive', return_value=False), \
                    patch.object(batch.subprocess, 'run', side_effect=outcome if isinstance(outcome, Exception) else None,
                                 return_value=outcome):
                result = self.tracker().finalize()
            self.assertFalse(result['complete'])
            self.assertTrue(root.exists())
            self.assertEqual(json.loads(manifest.read_text())['state'], 'cleanup-pending')

    def test_invalid_metadata_is_rejected_before_root_inspection(self):
        root, manifest, record = self.allocation()
        for changes in [{'root': '/Users/example/OneDrive/unowned'}, {'source_revision': 'e' * 40},
                        {'token': '../unowned'}, {'scratch': str(self.outer / 'unregistered')},
                        {'root': str(self.base / 'unowned')}, {'owner_pid': True}]:
            with self.subTest(changes=changes):
                batch.resources.atomic_json(manifest, {**record, **changes})
                with patch.object(batch, 'browser_root_stat', side_effect=AssertionError('root inspected')):
                    result = self.tracker().finalize()
                self.assertFalse(result['complete'])
                self.assertTrue(root.exists())

    def test_symlink_or_changed_identity_is_preserved(self):
        root, manifest, record = self.allocation()
        self.cleanup_evidence()
        for changes in [{'inode': record['inode'] + 1}, {'device': record['device'] + 1}]:
            batch.resources.atomic_json(manifest, {**record, **changes})
            with patch.object(batch.resources, 'process_alive', return_value=False):
                self.assertFalse(self.tracker().finalize()['complete'])
            self.assertTrue(root.exists())
        batch.resources.atomic_json(manifest, record)
        saved = root.with_name('saved-owned-root')
        root.rename(saved)
        root.symlink_to(saved, target_is_directory=True)
        with patch.object(batch.resources, 'process_alive', return_value=False):
            self.assertFalse(self.tracker().finalize()['complete'])
        self.assertTrue(root.is_symlink())
        self.assertTrue((saved / 'payload').exists())

    def test_already_removed_and_zero_allocation_are_truthful(self):
        self.assertEqual(self.tracker().finalize(), {'complete': True, 'allocations': [], 'leftovers': []})
        root, manifest, record = self.allocation()
        for file in root.iterdir():
            file.unlink()
        root.rmdir()
        batch.resources.atomic_json(manifest, {**record, 'state': 'removed'})
        result = self.tracker().finalize()
        self.assertTrue(result['complete'])
        self.assertEqual(result['allocations'][0]['cleanup'], 'removed')

    def test_native_base_is_captured_before_outer_environment_rewrite(self):
        self.assertTrue(callable(getattr(batch, 'native_temp_base', None)), 'native temp capture is missing')
        env = {'TMPDIR': str(self.base)}
        with patch.object(batch.tempfile, 'gettempdir', return_value=str(self.base)):
            captured = batch.native_temp_base(env)
        env['TMPDIR'] = str(self.outer)
        self.assertEqual(captured, self.base)
        for key in ['TMPDIR', 'TMP', 'TEMP']:
            with self.subTest(key=key), patch.object(batch.tempfile, 'gettempdir', side_effect=AssertionError('probed')):
                with self.assertRaises(ValueError):
                    batch.native_temp_base({key: '/Users/example/OneDrive/tmp'})

    def test_native_temp_symlink_is_rejected_before_tempfile_can_probe_it(self):
        alias = self.base / 'innocent-temp-alias'
        alias.symlink_to('/Users/example/OneDrive/forbidden', target_is_directory=True)
        with patch.object(batch.tempfile, 'gettempdir', side_effect=AssertionError('forbidden target probed')):
            with self.assertRaisesRegex(ValueError, 'forbidden'):
                batch.native_temp_base({'TMPDIR': str(alias)})


if __name__ == '__main__':
    unittest.main()
