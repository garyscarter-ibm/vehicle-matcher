"""Offline typed-fallback and actual synthetic launcher-death teardown checks; never main."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

BASE = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
supervisor = load('settings_supervisor_test', BASE / 'supervise-settings.py')
resources = load('settings_resources_test', '/Users/usget/Claude/vehicle-matcher/_tools/test_resources.py')
proofs = []

class SettingsSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='settings-supervisor-', dir=os.environ['TMPDIR']))
        self.output = self.root / 'output'
        self.output.mkdir()
        self.allocation = dict(id='f59-settings-shape-observation-20261106.v1', producerCommit='a' * 40,
            codeTestIdentity='b' * 64, planSha256='c' * 64, planDigest='d' * 64, runnerSha256='e' * 64,
            transportKind='fixture', qualificationDate='2026-11-06')

    def receipt(self):
        counts = dict(sourceCalls=0, failures=0, timeouts=0, substitutions=0, cacheEvictions=0, httpAttempts=2, decodedBytes=100,
                      operations=dict(page=1, settings=1, discover=0, options=0), cacheHits=dict.fromkeys(supervisor.NAMES, 0), operationBytes=dict(page=20, settings=80, discover=0, options=0))
        return dict(schemaVersion='f59-settings-observation-receipt.v1', runnerVersion='f59-settings-shape-runner.v1',
            qualification='unqualified-structural-observation', admission=False, accepted=[], distinctConfigurations=0,
            provenance=dict(allocation=self.allocation['id'], **{k:v for k,v in self.allocation.items() if k!='id'}),
            status='strict-settings-inconclusive', stopCode='source-attempt-budget', cancelled=False, counts=counts,
            countBasis='validated-final-checkpoint', checkpoint=dict(status='valid', bytes=1024, sha256='f'*64),
            settingsExport=dict(status='not-available', bytes=None, sha256=None), constraints=dict(supervisor.CONSTRAINTS),
            reviewRequired='source-layout-and-qualification-before-admission-or-new-date-publication')

    def save(self, value):
        (self.output / 'receipt.json').write_text(json.dumps(value))

    def observe(self):
        return supervisor.safe_observation(self.output, self.allocation)

    def test_missing_malformed_and_nonobject_receipt_remain_unknown(self):
        self.assertIsNone(self.observe()['counts'])
        for value in ([], None, 'SYNTHETIC PRIVATE', 5, True):
            self.save(value)
            self.assertIsNone(self.observe()['counts'])
        (self.output / 'receipt.json').write_text('{bad')
        self.assertIsNone(self.observe()['counts'])

    def test_only_exact_typed_pinned_accounting_reaches_fallback(self):
        self.save(self.receipt())
        self.assertEqual(self.observe()['counts'], dict(sourceCalls=0, httpAttempts=2, decodedBytes=100))
        self.assertEqual(self.observe()['outcome'], 'strict-settings-inconclusive')

    def test_boolean_extra_fields_admission_and_array_coercion_refuse(self):
        changes = [lambda r:r.update(extra='SYNTHETIC PRIVATE'), lambda r:r.update(admission=True),
                   lambda r:r.update(status=['settings-refused']), lambda r:r['counts'].update(httpAttempts=True), lambda r:r['counts'].update(sourceCalls=1),
                   lambda r:r['constraints'].update(rawRetention=False), lambda r:r['provenance'].update(transportKind='live'),
                   lambda r:r['counts']['operations'].update(discover=1), lambda r:r['counts'].update(httpAttempts=3),
                   lambda r:r['checkpoint'].update(status='invalid'), lambda r:r['counts'].update(extra='SYNTHETIC PRIVATE')]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                value=self.receipt();change(value);self.save(value);observed=self.observe()
                self.assertIsNone(observed['counts']);self.assertNotIn('SYNTHETIC PRIVATE',json.dumps(observed))

    def test_truthful_threshold_overrun_is_not_clamped_to_plan(self):
        value=self.receipt();value['counts']['decodedBytes']=2097200;value['counts']['operationBytes']['settings']=2097180
        value.update(status='source-stopped', stopCode='source-byte-budget');self.save(value)
        self.assertEqual(self.observe()['counts']['decodedBytes'],2097200)

    def test_export_requires_matching_bounded_file_not_receipt_claim_alone(self):
        value=self.receipt();value['settingsExport']=dict(status='exported',bytes=2,sha256='a'*64);self.save(value)
        self.assertIsNone(self.observe()['counts'])
        path=self.output/'settings-shape.json';path.write_text('{}');value['settingsExport']['sha256']=supervisor.digest(path);self.save(value)
        self.assertEqual(self.observe()['settingsExport']['status'],'exported')
        with mock.patch.object(supervisor,'digest',side_effect=OSError('SYNTHETIC PRIVATE')):
            self.assertIsNone(self.observe()['counts'])

    def test_invalid_receipt_io_and_symlink_never_break_fallback(self):
        with mock.patch.object(supervisor,'read_small',side_effect=OSError('SYNTHETIC PRIVATE')):
            observed=self.observe();self.assertIsNone(observed['counts']);self.assertNotIn('SYNTHETIC PRIVATE',json.dumps(observed))
        path=self.output/'receipt.json';path.symlink_to(self.root/'absent')
        self.assertIsNone(self.observe()['counts'])

    def test_exclusive_registration_prevents_duplicate_invocation_after_prelaunch_failure(self):
        path=self.root/'registration.json'
        supervisor.register_once(path,dict(allocationState='reserved-and-consumed'))
        before=path.read_bytes()
        with self.assertRaises(FileExistsError):
            supervisor.register_once(path,dict(allocationState='reset-forbidden'))
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_actual_launcher_identity_death_stops_joins_and_removes_owned_group(self):
        # This synthetic owner is the same identity interface main fills from its real synchronous parent.
        owner=subprocess.Popen([sys.executable,'-I','-B','-c','import time; time.sleep(30)'])
        identity=dict(pid=owner.pid,start=resources.process_identity(owner.pid))
        output=self.root/'observation';marker=self.root/'new-once.json';started=self.root/'child-started'
        def kill_when_started():
            deadline=time.monotonic()+4
            while not started.exists() and time.monotonic()<deadline:
                time.sleep(.02)
            owner.terminate();owner.wait(timeout=3)
        thread=threading.Thread(target=kill_when_started);thread.start()
        code='import pathlib,os,time; pathlib.Path('+repr(str(started))+').write_text("synthetic"); pathlib.Path(os.environ["TMPDIR"],"owned").write_text("synthetic"); time.sleep(30)'
        try:
            receipt=supervisor.supervise_once(command=[sys.executable,'-I','-B','-c',code],cwd=self.root,
                rdir=self.root/'supervision',output=output,marker=marker,allocation=self.allocation,
                launcher_owner=identity,resources=resources,disk=8*1048576,ram=128*1048576,seconds=10)
            self.assertTrue(started.exists());self.assertTrue(receipt['launcherAbsent'])
            self.assertTrue(receipt['scratchAbsent']);self.assertEqual(receipt['manifestState'],'removed');self.assertEqual(receipt['leftovers'],[])
            self.assertTrue(receipt['groups']);self.assertTrue(all(g['absent'] for g in receipt['groups']))
            self.assertEqual(receipt['process']['stopIssue'],'bounded-process-stop');self.assertIsNone(receipt['observation']['counts'])
            record=resources.read_json(receipt['ownershipManifest']);ledger=resources.read_json(Path.home()/'.cache/agent-scaffolding/test-resources/reservations.json',{})
            self.assertNotIn(record['token'],ledger);proofs.append(dict(receipt=receipt,ownership=record,reservationAbsent=True))
        finally:
            if owner.poll() is None:owner.terminate()
            owner.wait(timeout=3);thread.join(timeout=5);self.assertFalse(thread.is_alive())

if __name__=='__main__':
    try:
        unittest.main()
    finally:
        resources.atomic_json(BASE/'supervisor-proof-summary.json',proofs)
