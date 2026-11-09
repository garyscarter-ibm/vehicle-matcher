"""FUCQ-157: the F70 retained verifier must keep the first lifecycle error and finish proof after a transient one.

Runs the real verify-retained.py bytes against a synthetic tree; zero HTTP, no retained evidence touched."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/gcsp/evidence/fucq59/f70-optional-axis-suffix5535-2026-11-07"
spec = importlib.util.spec_from_file_location("f70_finalizer_resources", ROOT / "_tools/test_resources.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)

SHIM = '''import importlib.util, json, pathlib
_spec = importlib.util.spec_from_file_location("real_resources", %r)
_real = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_real)
globals().update({k: v for k, v in vars(_real).items() if not k.startswith("__")})
_plan = json.loads((pathlib.Path(__file__).resolve().parent / "fault-plan.json").read_text())
_calls = [0]
def group_has_live_members(pgid):
    # Fault injection lives in this fixture only: report live members for the first N queries.
    _calls[0] += 1
    if _plan.get("always") or _calls[0] <= _plan.get("true_calls", 0):
        return True
    return _real.group_has_live_members(pgid)
'''
CHECKS = "import test from 'node:test';\n" + "".join("test('t%d', () => {});\n" % n for n in range(1, 6))
FIRST_MESSAGE = "owned retained-check process group absence not proved"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RetainedFinalizer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gc007-")
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.remove_scratch)
        self.base = Path(self.temp.name).resolve()

    def remove_scratch(self):
        # The persistent case preserves scratch by design; remove only the recorded absolute root.
        for manifest in (self.out / "ownership").glob("*.json") if hasattr(self, "out") else []:
            root = Path(json.loads(manifest.read_text())["root"])
            if os.path.lexists(root):
                self.assertTrue(root.name.startswith("test-stamp-shard-"))
                shutil.rmtree(root)

    def run_case(self, fault=None, receipt_without_counts=False):
        root = self.base / "root"
        evidence = root / "docs/gcsp/evidence/fucq59/f70-fixture"
        self.directory = self.base / "out/session001"
        self.out = self.base / "out/session001-supervisor"
        self.host = self.base / "host"
        for path in (evidence, root / "server", root / "_tools", self.directory, self.out, self.host):
            path.mkdir(parents=True)
        for name in ("verify-retained.py", "group-proof.py"):
            shutil.copyfile(EVIDENCE / name, evidence / name)
        (evidence / "live-check.test.mjs").write_text(CHECKS)
        (evidence / "series-plan.json").write_text(json.dumps({"chunks": [{"outputDirectory": str(self.directory)}]}))
        (root / "_tools/test_resources.py").write_text(SHIM % str(ROOT / "_tools/test_resources.py"))
        (root / "_tools/fault-plan.json").write_text(json.dumps(fault or {}))
        (self.directory / "execution-plan.json").write_text(json.dumps(
            {"supervisorOutput": str(self.out), "codePins": []}))
        (self.out / "live-cleanup.json").write_text(json.dumps(
            {"groups_absent": True, "scratch_absent": True, "dependency_link_absent": True,
             "reservation_absent": True, "checkpointExport": True, "retainedWriterMetadata": False}))
        receipt = {"actualAttempts": 3, "counts": {"operations": {"solve": 2}, "decodedBytes": 10}, "newlyAccepted": 1,
                   "duplicates": 0, "rejected": 0, "reason": "synthetic", "status": "complete"}
        if receipt_without_counts:
            del receipt["counts"]
        (self.directory / "collector-checkpoint.json").write_text('{"content":"synthetic primary"}')
        (self.directory / "receipt.json").write_text(json.dumps(receipt))
        (self.directory / "final-canonical-index.json").write_text(
            json.dumps({"entries": [{"origins": [{"kind": "admitted-source"}]}]}))
        (self.directory / "final-spent-request-index.json").write_text(json.dumps({"entries": []}))
        self.primary_sha = sha(self.directory / "collector-checkpoint.json")
        env = {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "TMPDIR": os.environ.get("TMPDIR", "/private/tmp"),
               "TEST_RESOURCE_HOST_DIR": str(self.host)}
        self.proc = subprocess.run(["/usr/bin/python3", "-I", "-B", str(evidence / "verify-retained.py"), "1"],
                                   env=env, capture_output=True, text=True, timeout=60)
        self.root, self.link = root, root / "server/node_modules"
        manifests = sorted((self.out / "ownership").glob("*.json"))
        self.assertEqual(len(manifests), 1, self.proc.stderr[-2000:])
        self.record = json.loads(manifests[0].read_text())

    def load(self, name):
        return json.loads((self.out / name).read_text())

    def assert_checks_intact(self):
        self.assertEqual(self.load("retained-result.json")["summary"],
                         {"tests": 5, "pass": 5, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0})
        self.assertEqual(sha(self.directory / "collector-checkpoint.json"), self.primary_sha)

    def assert_cleaned(self):
        self.assertFalse(os.path.lexists(self.record["root"]))
        self.assertFalse(os.path.lexists(self.link))
        rows = json.loads((self.host / "reservations.json").read_text())
        self.assertNotIn(self.record["token"], rows)

    def test_transient_group_query_failure_is_retried_and_recorded(self):
        self.run_case({"true_calls": 1})
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr[-2000:])
        proof = json.loads((self.directory / "live-validation.json").read_text())
        self.assert_checks_intact()
        first = self.load("retained-first-error.json")
        self.assertEqual((first["stage"], first["message"]), ("finalize", FIRST_MESSAGE))
        cleanup = self.load("retained-cleanup.json")
        self.assertEqual(cleanup["first_lifecycle_error"], first)
        self.assertEqual(cleanup["finalize_attempts"], 2)
        self.assertEqual(proof["retainedCleanup"]["first_lifecycle_error"], first)
        # Each attempt keeps its own tri-state query evidence.
        self.assertFalse(self.load("retained-group-queries.json")["allGroupsAbsent"])
        self.assertTrue(self.load("retained-group-queries-2.json")["allGroupsAbsent"])
        self.assert_cleaned()
        self.assertTrue(self.record["groups"])
        for pgid in self.record["groups"]:
            for _ in range(3):
                live = R.group_has_live_members(pgid)
                if live is not None:
                    break
                time.sleep(0.1)
            self.assertIs(live, False)

    def test_persistent_group_query_failure_keeps_first_error_and_no_proof(self):
        self.run_case({"always": True})
        self.assertNotEqual(self.proc.returncode, 0)
        self.assertFalse((self.directory / "live-validation.json").exists())
        self.assert_checks_intact()
        receipt = self.out / "retained-first-error.json"
        self.assertLess(receipt.stat().st_size, 16 * 1024)
        first = json.loads(receipt.read_text())
        self.assertEqual((first["stage"], first["message"]), ("finalize", FIRST_MESSAGE))
        self.assertTrue(os.path.lexists(self.record["root"]), "scratch is preserved when absence is not proved")

    def test_proof_assembly_failure_is_recorded_after_clean_cleanup(self):
        self.run_case(receipt_without_counts=True)
        self.assertNotEqual(self.proc.returncode, 0)
        self.assertFalse((self.directory / "live-validation.json").exists())
        self.assert_checks_intact()
        first = self.load("retained-first-error.json")
        self.assertEqual((first["stage"], first["type"]), ("proof-assembly", "KeyError"))
        cleanup = self.load("retained-cleanup.json")
        self.assertIsNone(cleanup["first_lifecycle_error"])
        self.assertEqual(cleanup["finalize_attempts"], 1)
        self.assert_cleaned()

    def test_clean_run_publishes_proof_without_a_first_error(self):
        self.run_case()
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr[-2000:])
        self.assertTrue((self.directory / "live-validation.json").exists())
        self.assert_checks_intact()
        self.assertFalse((self.out / "retained-first-error.json").exists())
        self.assertEqual(self.load("retained-cleanup.json")["finalize_attempts"], 1)
        self.assert_cleaned()


if __name__ == "__main__":
    unittest.main()
