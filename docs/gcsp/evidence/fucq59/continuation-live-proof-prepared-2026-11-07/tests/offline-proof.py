"""Synthetic protocol only; a forced child stop must preserve the actual durable primary."""
import sys
sys.dont_write_bytecode = True
import hashlib, importlib.util, json, os, pathlib, unittest
BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[4]
spec = importlib.util.spec_from_file_location('proof_supervisor', BASE / 'supervise-proof.py')
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
OUT = pathlib.Path(os.environ['PROOF_TEST_OUTPUT'])
class ConcreteRunnerProof(unittest.TestCase):
    def grant(self, name):
        home = OUT / name; home.mkdir(parents=True)
        value = {'schemaVersion': 'f59-proof-executable-grant.v1', 'mode': 'offline-contract',
            'authorization': 'root-grant-after-review-and-source-lane-clear', 'sourceLaneClear': True,
            'runId': 'offline-' + name, 'allocations': {'A': 'offline-' + name + '-a', 'B': 'offline-' + name + '-b'},
            'contractSha256': S.sha((BASE / 'execution-contract.json').read_bytes()), 'inputsRoot': str(ROOT),
            'retainedRoot': str(home / 'retained'), 'metadataRoot': str(home / 'metadata'),
            'dependencyDirectory': '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'}
        path = home / 'grant.json'; path.write_text(json.dumps(value)); return path, value
    def test_forced_stop_retains_primary_and_exactly_one_continuation(self):
        path, grant = self.grant('forced'); retained = pathlib.Path(grant['retainedRoot'])
        a = S.execute_phase(path, 'A', force_after_ready=True)
        self.assertTrue(a['proofReady'], a)
        self.assertEqual(a['resourceResult']['rc'], -9)
        before = (retained / 'phase-a/collector-checkpoint.json').read_bytes()
        self.assertEqual(before, (retained / 'phase-a/collector-state.json').read_bytes())
        self.assertEqual(a['counts']['httpAttempts'], 5)
        b = S.execute_phase(path, 'B'); self.assertTrue(b['proofReady'], b)
        self.assertEqual(b['counts']['httpAttempts'], 5)
        self.assertEqual(b['cumulativeCounts']['httpAttempts'], 10)
        self.assertEqual(b['phaseReceipt']['replayCalls'], 0)
        self.assertEqual(before, (retained / 'phase-a/collector-checkpoint.json').read_bytes())
        self.assertEqual(b['actualSourceRequests'], 0)
        self.assertEqual(b['phaseReceipt']['classification'], 'scripted-contract-only')
        for phase in ('A', 'B'):
            clean = json.loads((pathlib.Path(grant['metadataRoot']) / (phase + '-cleanup.json')).read_text())
            self.assertTrue(clean['scratchAbsent'] and clean['groupsAbsent'] and clean['reservationAbsent'], clean)
            self.assertEqual(clean['cleanupIssues'], [])
        for phase in ('A', 'B'):
            with self.assertRaises(FileExistsError): S.execute_phase(path, phase)
        self.assertEqual(before, (retained / 'phase-a/collector-checkpoint.json').read_bytes())
    def test_graceful_interruption_exits75_after_committed_cursor1(self):
        path, grant = self.grant('graceful')
        a = S.execute_phase(path, 'A')
        self.assertTrue(a['proofReady'], a)
        self.assertEqual(a['resourceResult']['rc'], 75)
        self.assertTrue(a['phaseReceipt']['interrupted'])
        self.assertEqual(a['phaseReceipt']['cursor'], 1)
        self.assertEqual(a['actualSourceRequests'], 0)
    def test_refuses_missing_grant_and_changed_contract_before_allocation(self):
        path, grant = self.grant('refused')
        for field, value in [('sourceLaneClear', False), ('mode', 'not-granted'), ('contractSha256', '0' * 64)]:
            changed = dict(grant); changed[field] = value; path.write_text(json.dumps(changed))
            with self.assertRaises(ValueError): S.execute_phase(path, 'A')
            self.assertFalse(pathlib.Path(grant['retainedRoot']).exists())
            self.assertFalse(pathlib.Path(grant['metadataRoot']).exists())
if __name__ == '__main__': unittest.main()
