"""FUCQ-160: the F62 .11 grant template must emit exactly the supervisor's filtered prior-receipt pins.

Runs the real prepare-grant.py and the sealed supervise.py preflight prefix in a synthetic tree; zero HTTP."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
PACKET = ROOT / "docs/gcsp/evidence/fucq62/fleet-dot11-8051-proof-plan"
REL = PACKET.relative_to(ROOT)
CLOUD_LITERAL = "pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude')"
FILTER_PREFIX = "assert grant['priorReceiptPins']=="
ACCEPTED = "RECEIPT_PINS_ACCEPTED"
PHASES = ['publish-restart', 'audit-direct', *[f'http{i}' for i in range(8)], 'rollback', 'summarize', 'descriptor']
LATER = ['strict-direct-audit-receipt.json', *[f'http-chunk{i}-receipt.json' for i in range(8)], 'rollback-receipt.json']
# Sealed identities this repair must not change (README PlanSHA and plan.json codePins).
SEALED = {
    PACKET / "plan.json": "53f75243e8be8c52be25e262aab3f896d1348773b1b9ea548ae545645afc8133",
    PACKET / "supervise.py": "e4a2e7d2e07b2a664d6f716ebc8aa638dc42b93fa300e43f2db362c7c6a56f57",
    ROOT / "docs/gcsp/evidence/fucq62/dot11-proof-grant-template-defect-2026-11-07.md":
        "082c808dc6fe5691b957983fb9c35b16b22d548810524782db95eec65fbe28f4",
}
SEALED_HELPER_PIN = "0956cb21c422cf732cd6edffe860d88431a13902a351a146fb66f82be6d369af"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data) if not isinstance(data, str) else data)
    return {'path': str(path), 'sha256': sha(path)}


class GrantTemplate(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gc010-")
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name).resolve()
        self.root, self.cloud = base / "wt", base / "cloud"
        self.base = self.root / REL
        self.base.mkdir(parents=True)
        (self.root / "_tools").mkdir()
        shutil.copy2(ROOT / "_tools/test_resources.py", self.root / "_tools/test_resources.py")
        for name in ["prepare-grant.py", "group-proof.py"]:
            shutil.copy2(PACKET / name, self.base / name)
        self.write_preflight()
        self.output = self.cloud / "output"
        self.build_inputs()

    def write_preflight(self):
        # The sealed supervisor's literal bytes up to its receipt-pin filter; nothing after it can allocate.
        text = (PACKET / "supervise.py").read_text()
        self.assertEqual(text.count(CLOUD_LITERAL), 1)
        lines = text.splitlines(keepends=True)
        stop = [i for i, line in enumerate(lines) if line.startswith(FILTER_PREFIX)]
        self.assertEqual(len(stop), 1)
        prefix = "".join(lines[:stop[0] + 1]).replace(CLOUD_LITERAL, f"pathlib.Path({str(self.cloud)!r})")
        (self.base / "supervise-prefix.py").write_text(prefix + f"print({ACCEPTED!r})\n")

    def build_inputs(self):
        out = self.output
        history, ordinary = self.cloud / "history", self.root / "fleet-source.v1"
        hist_pin = {**write(history / "versions/h1/manifest.json", {"h": 1}), 'relativePath': "versions/h1/manifest.json"}
        ord_pin = {**write(ordinary / "versions/o1/manifest.json", {"o": 1}), 'relativePath': "versions/o1/manifest.json"}
        manifest = {**write(out / "candidate/manifest.json", {"m": 1}), 'name': "manifest.json"}
        candidate = {
            'outputRoot': str(out),
            'canonical': write(self.cloud / "final-canonical-index.json", {}),
            'spent': write(self.cloud / "final-spent-request-index.json", {}),
            'technicalSupplement': write(self.root / "technical.json", {}),
            'baseline': {
                # Basename receipt.json: the sealed filter excludes it, which the original helper missed.
                'ordinaryActivationReceipt': write(self.cloud / "dot10/followthrough/ordinary/receipt.json", {"ok": 1}),
                'candidateReceipt': write(self.cloud / "dot10/candidate-receipt.json", {"dot10": 1}),
                'isolatedHistoryStore': str(history), 'isolatedHistoryPins': [hist_pin],
                'ordinaryBaseline': {'root': str(ordinary), 'pins': [ord_pin]},
                'descriptor': write(self.root / "descriptor-proposal.json", {}),
            },
        }
        candidate_plan = {**write(self.root / "candidate-plan.json", candidate), 'bytes': 1}
        receipt = write(out / "candidate-receipt.json", {'files': [manifest]})
        code = write(self.root / "code.js", "x")
        self.plan = {
            'executionWorktree': str(self.root), 'phases': PHASES, 'candidatePlan': candidate_plan,
            'candidateReceipt': receipt, 'expectedManifestDigest': "f" * 64, 'codePins': [code],
            'sourcePins': [write(self.root / "source.jsonl", "")], 'metadataRoot': str(self.root / "meta"),
        }
        write(self.base / "plan.json", self.plan)
        self.ordinary_receipt = candidate['baseline']['ordinaryActivationReceipt']

    def publish_outputs(self, later=False):
        # Mirrors what publish-restart (and, for later=True, every chunk and summarize) retains.
        write(self.output / "isolated-store/versions/h1/manifest.json", {"h": 1})
        write(self.output / "publish-restart-receipt.json", {"p": 1})
        if later:
            for name in [*LATER, "offline-proof-summary.json"]:
                write(self.output / name, {"n": name})

    def run_py(self, script, *args):
        return subprocess.run([sys.executable, "-I", "-B", str(self.base / script), *args],
                              capture_output=True, text=True, timeout=60)

    def template(self, phase):
        run = self.run_py("prepare-grant.py", phase)
        self.assertEqual(run.returncode, 0, run.stderr)
        grant = json.loads(run.stdout)
        self.assertIs(grant['authorized'], False)
        return grant

    def preflight(self, phase, grant):
        grant = {**grant, 'authorized': True}
        path = self.root / "grants" / f"{phase}-grant.json"
        write(path, grant)
        return self.run_py("supervise-prefix.py", phase, "--reviewed-plan-sha256", sha(self.base / "plan.json"),
                           "--candidate-receipt-sha256", self.plan['candidateReceipt']['sha256'],
                           "--root-release", str(path))

    def expected(self, phase):
        names = [] if phase == 'publish-restart' else ["publish-restart-receipt.json"]
        if phase in ['summarize', 'descriptor']:
            names += LATER
        if phase == 'descriptor':
            names.append("offline-proof-summary.json")
        return [{'path': str(p), 'sha256': sha(p)} for p in sorted((self.output / n for n in names), key=str)]

    def assert_refused_before_allocation(self, run, phase):
        self.assertNotEqual(run.returncode, 0)
        self.assertNotIn(ACCEPTED, run.stdout)
        self.assertIn("AssertionError", run.stderr)
        self.assertIn(FILTER_PREFIX, run.stderr)
        meta = Path(self.plan['metadataRoot']) / phase
        self.assertEqual(sorted(p.name for p in meta.iterdir()), ["invocation.log"])
        self.assertFalse((self.output / ".scratch").exists())
        self.assertFalse((self.root / "server/node_modules").exists())

    def test_template_passes_sealed_filter_for_publish_and_every_later_phase(self):
        grant = self.template('publish-restart')
        self.assertEqual(grant['priorReceiptPins'], [])
        run = self.preflight('publish-restart', grant)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn(ACCEPTED, run.stdout)
        self.publish_outputs(later=True)
        for phase in PHASES[1:]:
            with self.subTest(phase=phase):
                grant = self.template(phase)
                self.assertEqual(grant['priorReceiptPins'], self.expected(phase))
                self.assertEqual(grant['codePins'], self.plan['codePins'])
                run = self.preflight(phase, grant)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn(ACCEPTED, run.stdout)

    def test_original_extra_ordinary_receipt_entry_is_refused_before_allocation(self):
        # The exact entry the original helper emitted, on the publish grant and a later one.
        extra = {'path': self.ordinary_receipt['path'], 'sha256': self.ordinary_receipt['sha256']}
        grant = self.template('publish-restart')
        self.assert_refused_before_allocation(
            self.preflight('publish-restart', {**grant, 'priorReceiptPins': [extra]}), 'publish-restart')
        self.publish_outputs(later=True)
        grant = self.template('summarize')
        pins = sorted([*grant['priorReceiptPins'], extra], key=lambda p: p['path'])
        self.assert_refused_before_allocation(self.preflight('summarize', {**grant, 'priorReceiptPins': pins}),
                                              'summarize')

    def test_missing_prior_receipt_stops_the_template(self):
        write(self.output / "isolated-store/versions/h1/manifest.json", {"h": 1})
        run = self.run_py("prepare-grant.py", "audit-direct")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("Required prior phase receipt unavailable", run.stderr)

    def test_sealed_proof_pins_and_supervisor_are_unchanged(self):
        for path, digest in SEALED.items():
            with self.subTest(path=path.name):
                self.assertEqual(sha(path), digest)
        plan = json.loads((PACKET / "plan.json").read_text())
        pins = {Path(p['path']).name: p['sha256'] for p in plan['codePins'] if Path(p['path']).parent.name == PACKET.name}
        self.assertEqual(pins["prepare-grant.py"], SEALED_HELPER_PIN)
        self.assertEqual(pins["supervise.py"], SEALED[PACKET / "supervise.py"])
        text = (PACKET / "supervise.py").read_text()
        cut = text.index(FILTER_PREFIX)
        for marker in ["R.Scratch(", "R.HostBudget(", "selection.json", "ownership.json", "server/node_modules"]:
            self.assertGreater(text.index(marker), cut, marker)


if __name__ == "__main__":
    unittest.main()
