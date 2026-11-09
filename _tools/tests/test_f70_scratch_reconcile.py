"""FUCQ-154: the F70 options supervisor's scratch must stay reconcilable after an uncatchable kill.

Synthetic only: never imports or runs the supervisor, and touches no retained evidence."""
import ast
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR = ROOT / "docs/gcsp/evidence/fucq59/f70-options-qualification-2026-11-07/supervise.py"
OLD_FIXED_ROOT = "/tmp/vehicle-matcher-f58-63-20261106/f58/f70-options-qualification"
spec = importlib.util.spec_from_file_location("f70_reconcile_resources", ROOT / "_tools/test_resources.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


def dead_owner():
    child = subprocess.Popen(["/usr/bin/true"])
    start = R.process_identity(child.pid)
    child.wait()
    return {"pid": child.pid, "start": start or "gone"}, child.pid


class SupervisorScratchRoot(unittest.TestCase):
    def test_supervisor_keeps_the_standard_token_owned_root(self):
        tree = ast.parse(SUPERVISOR.read_text(), filename=str(SUPERVISOR))
        targets = [ast.unparse(t) for n in ast.walk(tree) if isinstance(n, (ast.Assign, ast.AugAssign, ast.AnnAssign))
                   for t in (n.targets if isinstance(n, ast.Assign) else [n.target])]
        self.assertFalse([t for t in targets if t.startswith("scratch.")], "supervisor overrides scratch state")
        self.assertNotIn(OLD_FIXED_ROOT, SUPERVISOR.read_text())
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "Scratch"]
        self.assertEqual(len(calls), 1)
        expected = {k.arg: k.value for k in calls[0].keywords}["expected"]
        self.assertLess(eval(compile(ast.Expression(expected), "expected", "eval"), {"R": R}), R.LARGE)


class AbandonedRootReconciliation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gc004-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.out = self.base / "supervisor-out"
        self.evidence = self.base / "evidence"
        self.evidence.mkdir()
        self.primary = self.evidence / "collector-checkpoint.json"
        self.marker = self.evidence / "execution-once.json"
        self.primary.write_text('{"content":"synthetic primary"}')
        self.marker.write_text('{"state":"reserved-and-consumed"}')
        # Scratch() puts local roots in /private/tmp on macOS; keep this run inside its owned TMPDIR.
        for patch in (mock.patch.object(R.sys, "platform", "linux"),
                      mock.patch.object(R.tempfile, "gettempdir", return_value=str(self.base))):
            patch.start()
            self.addCleanup(patch.stop)
        self.policy = R.Policy({"chunk_scratch_mib": 64, "chunk_ram_mib": 512, "chunk_seconds": 120, "log_mib": 1})

    def supervisor_scratch(self):
        """Build scratch exactly as supervise.py now does, then abandon it as a SIGKILL would."""
        scratch = R.Scratch(self.out, self.base, self.policy, expected=64 * R.MIB, checkpoint=self.primary)
        scratch.__enter__()
        (scratch.root / "child-tmp").write_bytes(b"tiny synthetic scratch")
        owner, pid = dead_owner()
        scratch.record.update(owner=owner, groups=[pid])
        R.atomic_json(scratch.manifest, scratch.record)
        return scratch

    def assert_evidence_kept(self):
        self.assertEqual(self.primary.read_text(), '{"content":"synthetic primary"}')
        self.assertEqual(self.marker.read_text(), '{"state":"reserved-and-consumed"}')

    def test_abandoned_owned_root_is_reconciled_and_evidence_kept(self):
        scratch = self.supervisor_scratch()
        self.assertEqual(scratch.root.name, "test-stamp-shard-" + scratch.token)
        R.reconcile(scratch.manifest)
        self.assertFalse(os.path.lexists(scratch.root))
        self.assertEqual(R.read_json(scratch.manifest)["state"], "removed")
        self.assert_evidence_kept()

    def test_old_fixed_basename_is_refused_by_the_standard_reconciler(self):
        scratch = self.supervisor_scratch()
        fixed = self.base / "f58" / "f70-options-qualification"
        fixed.parent.mkdir()
        scratch.root.rename(fixed)
        scratch.record["root"] = str(fixed)
        R.atomic_json(scratch.manifest, scratch.record)
        with self.assertRaisesRegex(R.ResourceError, "invalid owned scratch path"):
            R.reconcile(scratch.manifest)
        self.assertTrue((fixed / "child-tmp").exists())

    def test_foreign_root_is_refused(self):
        scratch = self.supervisor_scratch()
        foreign = self.base / "user-documents"
        foreign.mkdir()
        (foreign / "keep").write_text("keep")
        scratch.record["root"] = str(foreign)
        R.atomic_json(scratch.manifest, scratch.record)
        with self.assertRaisesRegex(R.ResourceError, "invalid owned scratch path"):
            R.reconcile(scratch.manifest)
        self.assertTrue((foreign / "keep").exists())
        self.assert_evidence_kept()

    def test_replaced_root_is_refused(self):
        scratch = self.supervisor_scratch()
        shutil.rmtree(scratch.root)
        scratch.root.mkdir()
        (scratch.root / "keep").write_text("replacement")
        with self.assertRaisesRegex(R.ResourceError, "identity is uncertain"):
            R.reconcile(scratch.manifest)
        self.assertTrue((scratch.root / "keep").exists())
        shutil.rmtree(scratch.root)
        target = self.base / "linked"
        target.mkdir()
        (target / "keep").write_text("keep")
        scratch.root.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(R.ResourceError, "symlink"):
            R.reconcile(scratch.manifest)
        self.assertTrue((target / "keep").exists())
        scratch.root.unlink()

    def test_root_with_open_file_is_refused(self):
        scratch = self.supervisor_scratch()
        with (scratch.root / "child-tmp").open("rb"):
            with self.assertRaisesRegex(R.ResourceError, "open files"):
                R.reconcile(scratch.manifest)
        self.assertTrue((scratch.root / "child-tmp").exists())
        R.reconcile(scratch.manifest)
        self.assertFalse(os.path.lexists(scratch.root))

    def test_live_owner_is_refused(self):
        scratch = self.supervisor_scratch()
        scratch.record["owner"] = R.owner()
        R.atomic_json(scratch.manifest, scratch.record)
        with self.assertRaisesRegex(R.ResourceError, "still active"):
            R.reconcile(scratch.manifest)
        self.assertTrue(scratch.root.exists())


if __name__ == "__main__":
    unittest.main()
