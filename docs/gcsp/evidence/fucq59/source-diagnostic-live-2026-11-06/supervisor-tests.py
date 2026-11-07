"""Offline fallback receipt regressions. Never calls main or the source executor."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('f59_supervisor_under_test', Path(__file__).with_name('supervise-live.py'))
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class FallbackReceiptTests(unittest.TestCase):
    def setUp(self):
        self.output = Path(tempfile.mkdtemp(prefix='synthetic-observation-', dir=os.environ['TMPDIR']))
        self.allocation = {'id': 'fixture', 'producerCommit': 'a' * 40, 'planSha256': 'b' * 64,
                           'planDigest': 'c' * 64, 'attempts': 4}

    def write_receipt(self, value):
        (self.output / 'receipt.json').write_text(json.dumps(value))

    def receipt(self):
        return {'schemaVersion': 'f59-live-diagnostic-receipt.v1', 'allocation': self.allocation['id'],
            **{key: self.allocation[key] for key in ('producerCommit', 'planSha256', 'planDigest')},
            'admission': False, 'accepted': [],
            'counts': {'sourceCalls': 2, 'httpAttempts': 2, 'decodedBytes': 100}}

    def observe(self):
        return supervisor.safe_observation(self.output, self.allocation)

    def test_nonobject_json_is_unknown_without_raising(self):
        for value in ([], None, 'synthetic-private-error', 7, True):
            with self.subTest(value=value):
                self.write_receipt(value)
                self.assertIsNone(self.observe()['counts'])
                self.assertNotIn('synthetic-private-error', json.dumps(self.observe()))

    def test_missing_and_malformed_receipts_are_unknown(self):
        self.assertIsNone(self.observe()['counts'])
        (self.output / 'receipt.json').write_text('{bad')
        self.assertIsNone(self.observe()['counts'])

    def test_only_pinned_numeric_accounting_is_selected(self):
        value = self.receipt()
        value['counts']['unexpected'] = 'synthetic-private-error'
        self.write_receipt(value)
        self.assertEqual(self.observe()['counts'], {'sourceCalls': 2, 'httpAttempts': 2, 'decodedBytes': 100})

    def test_bad_identity_or_counters_cannot_enter_receipt(self):
        for field, bad in (('producerCommit', 'wrong'), ('counts', []),
                           ('counts', {'sourceCalls': True, 'httpAttempts': 2, 'decodedBytes': 100}),
                           ('counts', {'sourceCalls': 5, 'httpAttempts': 5, 'decodedBytes': 100})):
            with self.subTest(field=field, bad=bad):
                value = self.receipt(); value[field] = bad; self.write_receipt(value)
                self.assertIsNone(self.observe()['counts'])

    def test_export_io_failure_does_not_break_finalization(self):
        (self.output / 'tree.json').write_text('{}')
        with mock.patch.object(supervisor, 'digest', side_effect=OSError('synthetic-private-error')):
            result = self.observe()
        self.assertTrue(result['partialExportMetadataUnavailable'])
        self.assertIsNone(result['counts'])
        self.assertNotIn('synthetic-private-error', json.dumps(result))

    def test_partial_export_retains_metadata_without_contents(self):
        (self.output / 'tree.json').write_text('synthetic-private-error')
        result = self.observe()
        self.assertEqual(result['partialExports'][0]['file'], 'tree.json')
        self.assertNotIn('synthetic-private-error', json.dumps(result))
        self.assertIsNone(result['counts'])


if __name__ == '__main__':
    unittest.main()
