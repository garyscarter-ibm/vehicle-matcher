"""Unit tests for the shared test-stack build cache. Synthetic: temp dirs, a temp git repo and fake installers."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import unittest.mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("test_stack_build", ROOT / "_tools/test_stack_build.py")
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


def fake_install(stage):
    (Path(stage) / "node_modules").mkdir()
    (Path(stage) / "node_modules" / "marker").write_text("x")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="stack-build-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = self.tmp / "state"

    def app(self, name="app", lock="lock-a"):
        app = self.tmp / name
        app.mkdir(parents=True, exist_ok=True)
        (app / "package.json").write_text("{}")
        (app / "package-lock.json").write_text(lock)
        return app


class RootAndKeys(Base):
    def test_refuses_synced_roots(self):
        for bad in ("/Users/x/Library/CloudStorage/OneDrive-IBM/c", "/tmp/my OneDrive/state"):
            with self.assertRaises(B.StackError):
                B.state_root({"GCSP_TEST_STACK_DIR": bad})

    def test_env_root_and_default(self):
        self.assertEqual(B.state_root({"GCSP_TEST_STACK_DIR": str(self.root)}), self.root)
        self.assertTrue(str(B.state_root({})).endswith("Library/Caches/gcsp-test-stack"))

    def test_node_key_follows_lockfile_and_pins(self):
        a, b = self.app("a", "one"), self.app("b", "one")
        self.assertEqual(B.node_key(a), B.node_key(b))
        (b / "package-lock.json").write_text("two")
        self.assertNotEqual(B.node_key(a), B.node_key(b))
        before = B.node_key(a)
        with unittest.mock.patch.object(B, "NPM_VERSION", "0.0.1"):
            self.assertNotEqual(before, B.node_key(a))


class NodeInstall(Base):
    def test_install_once_and_cache_hit(self):
        app, calls = self.app(), []
        def installer(stage):
            calls.append(stage)
            fake_install(stage)
        d1, installed1 = B.ensure_node(app, self.root, installer)
        d2, installed2 = B.ensure_node(app, self.root, installer)
        self.assertEqual((installed1, installed2, len(calls)), (True, False, 1))
        self.assertTrue((d1 / "node_modules/marker").is_file())
        self.assertTrue((d1 / "package-lock.json").is_file())
        self.assertEqual(d1, d2)

    def test_failed_install_leaves_no_key_or_stage(self):
        def boom(stage):
            raise RuntimeError("npm failed")
        with self.assertRaises(RuntimeError):
            B.ensure_node(self.app(), self.root, boom)
        self.assertEqual(list((self.root / "node").iterdir()), [])

    def test_two_installers_only_one_installs(self):
        app, calls = self.app(), []
        def slow(stage):
            calls.append(1)
            time.sleep(0.3)
            fake_install(stage)
        results = []
        threads = [threading.Thread(target=lambda: results.append(B.ensure_node(app, self.root, slow)[1])) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(calls), 1)
        self.assertEqual(sorted(results), [False, True])


class NodeLink(Base):
    def test_link_repoint_and_unlink(self):
        app = self.app()
        info = B.link_node(app, self.root, installer=fake_install)
        link = app / "node_modules"
        self.assertTrue(link.is_symlink() and (link / "marker").is_file())
        self.assertEqual(B.link_node(app, self.root, installer=fake_install)["state"], "already linked")
        (app / "package-lock.json").write_text("lock-b")
        info2 = B.link_node(app, self.root, installer=fake_install)
        self.assertEqual(info2["state"], "repointed")
        self.assertNotEqual(info["key"], info2["key"])
        self.assertTrue(B.unlink_node(app))
        self.assertFalse(link.exists() or link.is_symlink())
        self.assertTrue((self.root / "node" / info["key"] / "node_modules").is_dir())

    def test_real_directory_is_protected_unless_replace(self):
        app = self.app()
        (app / "node_modules").mkdir()
        (app / "node_modules" / "mine").write_text("keep")
        info = B.link_node(app, self.root, installer=fake_install)
        self.assertFalse(info["linked"])
        self.assertTrue((app / "node_modules/mine").is_file())
        info = B.link_node(app, self.root, replace=True, installer=fake_install)
        self.assertTrue(info["linked"] and (app / "node_modules").is_symlink())

    def test_unlink_ignores_real_directory(self):
        app = self.app()
        (app / "node_modules").mkdir()
        self.assertFalse(B.unlink_node(app))
        self.assertTrue((app / "node_modules").is_dir())


def git_repo(path):
    for cmd in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"], ["config", "core.hooksPath", "/dev/null"]):
        subprocess.run(["git", "-C", str(path)] + cmd, check=True)


def commit(path, msg="c"):
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-q", "-m", msg], check=True)


class Gc(Base):
    def test_gc_keeps_newest_and_linked_keys(self):
        repo = self.tmp / "repo"
        repo.mkdir()
        git_repo(repo)
        app = repo / "apps/gcsp-web"
        app.mkdir(parents=True)
        (repo / "x").write_text("x")
        commit(repo)
        keys = []
        for i in range(4):
            src = self.app(f"src{i}", f"lock-{i}")
            d, _ = B.ensure_node(src, self.root, fake_install)
            os.utime(d, (1000 + i, 1000 + i))
            keys.append(d.name)
        (app / "node_modules").symlink_to(self.root / "node" / keys[0] / "node_modules")
        removed, kept = B.gc_node(self.root, repo, keep=1)
        self.assertEqual(sorted(kept), sorted([keys[3], keys[0]]))
        self.assertEqual(sorted(removed), sorted([keys[1], keys[2]]))
        self.assertTrue((self.root / "node" / keys[0]).is_dir())

    def test_gc_build_keeps_newest(self):
        for i in range(4):
            d = self.root / "build/api" / f"k{i}"
            d.mkdir(parents=True)
            os.utime(d, (1000 + i, 1000 + i))
        removed, kept = B.gc_build(self.root, "api", keep=2)
        self.assertEqual(sorted(removed), ["k0", "k1"])
        self.assertEqual(kept, ["k3", "k2"])


class Builds(Base):
    def setUp(self):
        super().setUp()
        self.wt = self.tmp / "wt"
        (self.wt / "services/gcsp-api/src").mkdir(parents=True)
        (self.wt / "apps/gcsp-web/src").mkdir(parents=True)
        (self.wt / "blocks/gcsp/shell").mkdir(parents=True)
        (self.wt / "services/gcsp-api/src/A.java").write_text("a")
        (self.wt / "apps/gcsp-web/src/a.ts").write_text("a")
        (self.wt / "blocks/gcsp/shell/s.css").write_text("a")
        git_repo(self.wt)
        commit(self.wt)
        self.runs = []

    def fake_mvn(self, wt):
        self.runs.append("mvn")
        out = Path(wt) / "services/gcsp-api/target/quarkus-app"
        out.mkdir(parents=True, exist_ok=True)
        (out / "quarkus-run.jar").write_text("jar")

    def fake_ng(self, wt):
        self.runs.append("ng")
        out = Path(wt) / "apps/gcsp-web/dist/gcsp-web/browser"
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text("<html>")

    def test_api_key_is_service_tree_hash(self):
        expected = B.git(self.wt, "rev-parse", "HEAD:services/gcsp-api")
        r = B.build_api(self.wt, self.root, self.fake_mvn)
        self.assertEqual(r["key"], expected)
        self.assertEqual(r["PROOF_API_JAR"], str(self.root / "build/api" / expected / "quarkus-app/quarkus-run.jar"))
        self.assertTrue(Path(r["PROOF_API_JAR"]).is_file())

    def test_api_second_call_is_cache_hit_without_building(self):
        B.build_api(self.wt, self.root, self.fake_mvn)
        r = B.build_api(self.wt, self.root, self.fake_mvn)
        self.assertTrue(r["cached"])
        self.assertEqual(self.runs, ["mvn"])

    def test_api_dirty_tree_is_not_cached(self):
        (self.wt / "services/gcsp-api/src/A.java").write_text("changed")
        r = B.build_api(self.wt, self.root, self.fake_mvn)
        self.assertTrue(r["dirty"] and not r["cached"])
        self.assertIn("services/gcsp-api/target/quarkus-app/quarkus-run.jar", r["PROOF_API_JAR"])
        self.assertFalse((self.root / "build/api").exists())
        B.build_api(self.wt, self.root, self.fake_mvn)
        self.assertEqual(self.runs, ["mvn", "mvn"])

    def test_build_outputs_and_node_modules_symlink_are_not_dirty(self):
        self.fake_mvn(self.wt)
        self.fake_ng(self.wt)
        (self.wt / "apps/gcsp-web/node_modules").symlink_to(self.tmp)
        self.assertFalse(B.is_dirty(self.wt, [B.API_PATH]))
        self.assertFalse(B.is_dirty(self.wt, list(B.WEB_PATHS)))

    def test_untracked_file_counts_as_dirty(self):
        (self.wt / "services/gcsp-api/src/New.java").write_text("n")
        self.assertTrue(B.is_dirty(self.wt, [B.API_PATH]))

    def test_web_key_covers_app_and_shell_css(self):
        k1 = B.tree_key(self.wt, list(B.WEB_PATHS))
        (self.wt / "blocks/gcsp/shell/s.css").write_text("b")
        commit(self.wt)
        self.assertNotEqual(k1, B.tree_key(self.wt, list(B.WEB_PATHS)))

    def test_web_hit_and_dirty_shell_css(self):
        r1 = B.build_web(self.wt, self.root, self.fake_ng)
        r2 = B.build_web(self.wt, self.root, self.fake_ng)
        self.assertEqual((r1["cached"], r2["cached"], self.runs), (False, True, ["ng"]))
        self.assertTrue((Path(r2["PROOF_WEB_BROWSER"]) / "index.html").is_file())
        (self.wt / "blocks/gcsp/shell/s.css").write_text("dirty")
        self.assertTrue(B.build_web(self.wt, self.root, self.fake_ng)["dirty"])

    def test_two_builders_only_one_builds(self):
        def slow(wt):
            time.sleep(0.3)
            self.fake_mvn(wt)
        out = []
        threads = [threading.Thread(target=lambda: out.append(B.build_api(self.wt, self.root, slow)["cached"])) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(self.runs, ["mvn"])
        self.assertEqual(sorted(out), [False, True])

    def test_emit_formats(self):
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            B.emit({"PROOF_API_JAR": "/x/y.jar", "key": "k", "cached": True}, "env")
            B.emit({"PROOF_API_JAR": "/x/y.jar", "key": "k"}, "json")
        self.assertEqual(buf.getvalue().splitlines()[0], "PROOF_API_JAR=/x/y.jar")
        self.assertIn('"key": "k"', buf.getvalue())


if __name__ == "__main__":
    unittest.main()
