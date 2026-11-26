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
from unittest.mock import patch

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


if __name__ == '__main__':
    unittest.main()
