"""Authored, unexecuted lifecycle fault cases. Fakes create no real child, scratch or reservation."""
from pathlib import Path
import importlib.util
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('owned105_lifecycle', Path(__file__).with_name('decision-mixed-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


class Process:
    pid = 12345

    def __init__(self):
        self.returncode = None
        self.waits = 0

    def poll(self):
        return self.returncode

    def wait(self):
        self.waits += 1
        return self.returncode


class Resources:
    ResourceError = RuntimeError

    def __init__(self):
        self.persist_failure = False
        self.identity_failure = False
        self.group = True
        self.descendant_alive = False
        self.stops = 0
        self.writes = 0

    def atomic_json(self, path, record):
        self.writes += 1
        if self.persist_failure:
            raise OSError('Simulated ownership persistence failure')

    def process_identity(self, pid):
        if self.identity_failure:
            raise KeyboardInterrupt('Simulated interruption before initial registration persisted')
        return 'fake-start'

    def group_has_live_members(self, pid):
        return self.group

    def process_alive(self, row):
        return self.descendant_alive

    def stop_group(self, process):
        self.stops += 1
        process.returncode = 0
        if self.group is not None:
            self.group = False
        process.wait()


class LaunchCases(unittest.TestCase):
    def setUp(self):
        self.resources = Resources()
        self.scratch = SimpleNamespace(record={'groups': [], 'processes': []}, manifest='fake-only', sample=lambda: 0)
        self.ownership = lifecycle.LaunchOwnership(self.resources, self.scratch)
        self.process = Process()

    def test_no_attempt_is_explicitly_distinct_from_unknown_attempt(self):
        self.assertTrue(self.ownership.finish())
        self.assertEqual(self.ownership.record['state'], 'not-started')
        self.ownership.begin()
        self.assertFalse(self.ownership.finish())
        self.assertEqual(self.ownership.record['state'], 'unresolved')
        self.assertFalse(self.ownership.record['joined'])
        self.assertEqual(self.scratch.record['groups'], [])
        with self.assertRaises(RuntimeError):
            self.ownership.require_safe()

    def test_begin_records_intent_before_any_child_can_be_created(self):
        self.ownership.begin()
        self.assertEqual(self.resources.writes, 1)
        self.assertTrue(self.ownership.record['attempted'])
        self.assertFalse(self.ownership.safe)
        self.assertEqual(self.ownership.record['state'], 'creating')
        # Defensive adoption still stops a supplied handle if a caller omitted begin().
        other = lifecycle.LaunchOwnership(self.resources, self.scratch)
        other.register(self.process)
        self.assertTrue(other.attempted)
        self.assertTrue(other.finish())
        self.assertEqual(self.resources.stops, 1)

    def test_registration_persistence_failure_keeps_handle_and_stops_it(self):
        self.ownership.begin()
        self.resources.persist_failure = True
        with self.assertRaises(OSError):
            self.ownership.register(self.process)
        self.assertIs(self.ownership.process, self.process)
        self.resources.persist_failure = False
        self.assertTrue(self.ownership.finish())
        self.assertEqual(self.resources.stops, 1)
        self.assertTrue(self.ownership.record['joined'])

    def test_interruption_after_capture_before_registration_is_adopted_and_joined(self):
        self.ownership.begin()
        self.resources.identity_failure = True
        with self.assertRaises(KeyboardInterrupt):
            self.ownership.register(self.process)
        self.assertIs(self.ownership.process, self.process)
        self.resources.identity_failure = False
        self.assertTrue(self.ownership.finish())
        self.assertEqual(self.resources.stops, 1)

    def test_unknown_group_status_never_counts_as_absent(self):
        self.ownership.begin()
        self.ownership.register(self.process)
        self.resources.group = None
        self.assertFalse(self.ownership.finish())
        self.assertEqual(self.resources.stops, 1)
        self.assertEqual(self.ownership.record['state'], 'unresolved')

    def test_known_live_descendant_blocks_cleanup_even_after_leader_and_group_exit(self):
        self.ownership.begin()
        self.ownership.register(self.process)
        self.resources.descendant_alive = True
        self.assertFalse(self.ownership.finish())
        self.assertFalse(self.ownership.record['joined'])

    def test_final_persistence_failure_blocks_cleanup_after_stop(self):
        self.ownership.begin()
        self.ownership.register(self.process)
        self.resources.persist_failure = True
        self.assertFalse(self.ownership.finish())
        self.assertEqual(self.process.returncode, 0)
        self.assertFalse(self.ownership.record['joined'])

    def test_handled_signals_defer_to_cancel_event_and_restore_handlers(self):
        previous = {2: object(), 15: object()}
        current = dict(previous)
        signals = SimpleNamespace(SIGINT=2, SIGTERM=15, getsignal=lambda number: current[number],
                                  signal=lambda number, handler: current.__setitem__(number, handler))
        cancelled = []
        cancel = SimpleNamespace(set=lambda: cancelled.append(True))
        with self.assertRaises(ValueError):
            with lifecycle.deferred_cancellation(cancel, signals):
                self.ownership.begin()
                # Same boundary as a signal after Popen returns, before register persists ownership.
                current[15](15, None)
                self.ownership.register(self.process)
                current[2](2, None)
                self.assertTrue(self.ownership.finish())
                raise ValueError('Restore handlers on exceptional exit too')
        self.assertEqual(current, previous)
        self.assertEqual(len(cancelled), 2)
        self.assertTrue(self.ownership.record['joined'])


if __name__ == '__main__':
    unittest.main()
