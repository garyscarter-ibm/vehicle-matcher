"""Light runner CLI/readiness checks; never starts a composition or touches a database."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('gcsp_e2e_run', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerSelectionTest(unittest.TestCase):
    def test_manual_review_parity_combines_with_identity_and_handover_regressions(self):
        selected = runner.selected_cases(['--case', 'f554', '--case', 'f520', '--case', 'f553'])
        self.assertEqual(runner.suite_command('/node', selected), [
            '/node', '--test', '--test-concurrency=1',
            'apps/gcsp-web/e2e/manual-review-parity.test.mjs',
            'apps/gcsp-web/e2e/manual-review.test.mjs',
            'apps/gcsp-web/e2e/stock-choices-parity.test.mjs'])

    def test_default_and_repeated_automated_selection_stay_unchanged(self):
        self.assertEqual(runner.selected_cases([]), list(runner.CASES))
        selected = runner.selected_cases(['--case', 'f555', '--case', 'f548', '--case', 'f555'])
        self.assertEqual(selected, ['f555', 'f548'])
        self.assertEqual(runner.suite_command('/node', selected), [
            '/node', '--test', '--test-concurrency=1', runner.CASES['f555'], runner.CASES['f548']])

    def test_explicit_f340_manual_selects_only_the_held_entrypoint(self):
        options = runner.parse_options(['--case', 'f340', '--manual'])
        self.assertEqual(options.cases, ['f340'])
        self.assertTrue(options.manual)
        self.assertEqual(runner.suite_command('/node', options.cases, manual=True),
                         ['/node', 'apps/gcsp-web/e2e/suv-walkthrough.manual.mjs'])

    def test_manual_requires_f340_alone_and_never_defaults_to_all_cases(self):
        for args in [['--manual'], ['--case', 'f548', '--manual'],
                     ['--case', 'f340', '--case', 'f555', '--manual']]:
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    runner.parse_options(args)
                self.assertEqual(error.exception.code, 2)


class ManualReadinessTest(unittest.TestCase):
    retained = Path('/local/manual-output')
    run_token = 'web-e2e-unique'
    source = 'a' * 40

    def ready(self):
        return {'state': 'ready', 'run': self.run_token, 'sourceRevision': self.source,
                'origins': {'web': 'https://gcsp-web.localhost:7548', 'api': 'https://gcsp-api.localhost:8548'},
                'links': {'presenter': 'https://gcsp-web.localhost:7548/gcsp/presenter',
                          'paula': 'https://gcsp-web.localhost:7548/gcsp/preferences'},
                'stopFile': str(self.retained / 'f340' / ('manual-stop-' + self.run_token))}

    def test_announces_only_this_ready_run_and_its_exact_stop_marker(self):
        stale = {**self.ready(), 'run': 'previous-run'}
        stop = Mock()
        stop.wait.return_value = False
        output = io.StringIO()
        with patch.object(runner.resources, 'read_json', side_effect=[stale, self.ready()]) as read:
            with contextlib.redirect_stdout(output):
                runner.observe_manual_session(self.retained, self.run_token, self.source, stop)
        self.assertEqual(read.call_count, 2)
        self.assertIn(self.ready()['links']['presenter'], output.getvalue())
        self.assertIn(self.ready()['links']['paula'], output.getvalue())
        self.assertIn(self.ready()['origins']['api'] + '/api/gcsp/v1/context', output.getvalue())
        self.assertIn('touch -- ' + self.ready()['stopFile'], output.getvalue())
        self.assertNotIn('previous-run', output.getvalue())

    def test_stale_source_wrong_marker_and_nonlocal_links_are_not_announced(self):
        bad = [None, {**self.ready(), 'sourceRevision': 'b' * 40},
               {**self.ready(), 'state': 'starting'}, {**self.ready(), 'stopFile': '/another/run'},
               {**self.ready(), 'links': {**self.ready()['links'], 'paula': 'https://example.org/'}}]
        for record in bad:
            with self.subTest(record=record):
                self.assertFalse(runner.manual_ready(record, self.retained, self.run_token, self.source))

    def test_stopping_observer_joins_without_waiting_for_readiness(self):
        stop = threading.Event()
        stop.set()
        thread = threading.Thread(target=runner.observe_manual_session,
                                  args=(self.retained, self.run_token, self.source, stop))
        with patch.object(runner.resources, 'read_json') as read:
            thread.start()
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())
            read.assert_not_called()


class ProcessOwnershipTest(unittest.TestCase):
    def record(self):
        return {'name': 'api-f521-host', 'caseId': 'f521', 'pid': 12345, 'pgid': 12345,
                'start': 'Thu Nov 26 12:00:00 2026', 'executable': '/bin/sh',
                'execTransition': {'kind': 'f521-maven-to-java', 'expectedExecutable': '/owned/jdk/bin/java'}}

    def test_only_the_explicit_f521_java_transition_preserves_ownership(self):
        record = self.record()
        java = {**record, 'executable': '/owned/jdk/bin/java'}
        self.assertTrue(runner.same_identity(record, record))
        self.assertTrue(runner.same_identity(record, java))
        for field, wrong in [('pid', 2), ('pgid', 2), ('start', 'another start'), ('executable', '/other/bin/java')]:
            with self.subTest(field=field):
                self.assertFalse(runner.same_identity(record, {**java, field: wrong}))
        for changed in [{'caseId': 'f555-pending'}, {'name': 'api'}, {'execTransition': None},
                        {'pgid': 9}, {'execTransition': {'kind': 'unexpected', 'expectedExecutable': '/owned/jdk/bin/java'}}]:
            with self.subTest(changed=changed):
                self.assertFalse(runner.same_identity({**record, **changed}, java))
        ordinary = {**record, 'caseId': 'f548'}
        self.assertTrue(runner.same_identity(ordinary, ordinary))
        self.assertFalse(runner.same_identity(ordinary, java))

    def test_exec_group_is_counted_and_stopped_by_the_supervisor(self):
        with tempfile.TemporaryDirectory(prefix='f521-exec-', dir=os.environ.get('TMPDIR')) as directory:
            owned = Path(directory).resolve()
            executable = Path('/bin/sleep')
            process = subprocess.Popen(['/bin/sh', '-c', 'read -r ready; exec "$1" 30', 'f521-fixture', str(executable)],
                                       stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       start_new_session=True, text=True)
            reaper = threading.Thread(target=process.wait, daemon=True)
            reaper.start()
            try:
                record = {**self.record(), **runner.identity(process.pid)}
                record['execTransition'] = {'kind': 'f521-maven-to-java', 'expectedExecutable': str(executable)}
                self.assertEqual(record['pid'], record['pgid'])
                process.stdin.write('go\n')
                process.stdin.flush()
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    current = runner.identity(process.pid)
                    if current and current['executable'] == str(executable):
                        break
                    time.sleep(.02)
                self.assertTrue(runner.same_identity(record, current), 'The real exec preserves the registered ownership')
                self.assertNotEqual(current['executable'], record['executable'])
                scratch = Mock()
                scratch.record = {}
                scratch.manifest = owned / 'manifest.json'
                scratch.__enter__ = Mock(return_value=scratch)
                scratch.__exit__ = Mock()
                with patch.object(runner.resources, 'Scratch', return_value=scratch), \
                     patch.object(runner, 'journal_records', return_value=[record]), \
                     patch.object(runner.resources, 'group_rss', return_value=7) as rss, \
                     patch.object(runner.resources, 'atomic_json') as saved:
                    with runner.owned_scratch(owned, Mock()):
                        self.assertEqual(runner.resources.group_rss(os.getpgrp()), 14)
                        self.assertCountEqual([call.args[0] for call in rss.call_args_list], [os.getpgrp(), process.pid])
                    cleanup = saved.call_args.args[1]
                    self.assertEqual(cleanup['remaining'], [])
                    self.assertTrue(cleanup['signals'], f'The owned fixture must be alive until supervisor teardown; exit={process.poll()}')
                    self.assertEqual(cleanup['signals'][0]['identity']['executable'], str(executable))
                reaper.join(timeout=2)
                self.assertFalse(reaper.is_alive())
                self.assertIsNone(runner.identity(process.pid))
                self.assertFalse(runner.resources.group_has_live_members(process.pid))
            finally:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait(timeout=5)
                reaper.join(timeout=2)
                process.stdin.close()

    def test_leaderless_group_is_reported_unverified_without_signalling(self):
        record = self.record()
        with patch.object(runner, 'journal_records', return_value=[record]), \
             patch.object(runner, 'identity', return_value=None), \
             patch.object(runner.resources, 'group_has_live_members', return_value=True), \
             patch.object(runner.resources, 'atomic_json'), patch.object(runner.os, 'killpg') as kill:
            evidence = runner.stop_recorded(Path('/owned/retained'))
        kill.assert_not_called()
        self.assertEqual(evidence['signals'], [])
        self.assertEqual(evidence['remaining'][0]['reason'], 'leader absent; group state uncertain')


if __name__ == '__main__':
    unittest.main()
