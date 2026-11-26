"""SCAF-80: the project's real test_stack configuration (.claude/scaffolding.json) and its gcsp_legacy extension still
give the database environment, JDK, builds and heavy-slot name the forked test stack used to give.

Replaces the tests deleted with the fork. Standard library only, temp dirs only: no PostgreSQL, Java, Maven, npm or network."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("project_test_stack", ROOT / "_tools/test_stack.py")
stack = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(stack)

TIMEOUT = 60


class ProjectTestStackConfig(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory(prefix="gcsp-ts-config-")
        self.addCleanup(self._temp.cleanup)
        self.root = Path(self._temp.name).resolve()
        self.project = self.root / "project"
        (self.project / ".claude").mkdir(parents=True)
        real = json.loads((ROOT / ".claude/scaffolding.json").read_text(encoding="utf-8"))
        record = {key: real[key] for key in ("test_stack", "extensions")}
        (self.project / ".claude/scaffolding.json").write_text(json.dumps(record), encoding="utf-8")
        ext = self.project / "_tools/ext/test_stack"
        ext.mkdir(parents=True)
        shutil.copy2(ROOT / "_tools/ext/test_stack/gcsp_legacy.py", ext / "gcsp_legacy.py")
        self.state = self.root / "state"
        self.fake_jdk = self.root / "jdk"
        self.fake_jdk.mkdir()
        (self.fake_jdk / "release").write_text('JAVA_VERSION="21.0.9"\n', encoding="utf-8")
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("GCSP_PG_BIN", None)
        os.environ.pop("JAVA_HOME", None)
        self.ctx = stack.Context(self.project, machine={}, state_root=self.state)
        stack.build_parser(self.ctx)       # loads the configured adapters, as the CLI does

    def cli_env(self, machine=None):
        machine_path = self.root / "machine.json"
        machine_path.write_text(json.dumps(machine or {}), encoding="utf-8")
        env = os.environ.copy()
        for name in ("AGENT_HEAVY_SLOT", "GCSP_HEAVY_SLOT", "TEST_RESOURCE_PARENT_RESERVATION", "AGENT_TEST_STACK_DIR",
                     "GCSP_TEST_STACK_DIR"):
            env.pop(name, None)
        home = self.root / "home"
        home.mkdir(exist_ok=True)
        env.update({"AGENT_TEST_STACK_MACHINE": str(machine_path), "TEST_RESOURCE_HOST_DIR": str(self.root / "host"),
                    "HOME": str(home)})
        return env

    def cli(self, env, *args):
        return subprocess.run([sys.executable, "-B", str(ROOT / "_tools/test_stack.py"), "--project", str(self.project),
                               "--state-root", str(self.state)] + list(args),
                              env=env, capture_output=True, text=True, timeout=TIMEOUT)

    def test_the_adapters_load(self):
        self.assertEqual(sorted(self.ctx._adapters), ["build", "gcsp_legacy", "maven", "node", "postgres"])

    def test_database_environment_is_the_forks(self):
        pg = self.ctx._adapters["postgres"].Pg(self.ctx)
        self.assertEqual(pg.env_pairs(5433, ["t_f1_abc123", "t_f1_def456"]), [
            ("GCSP_TEST_DATABASE_URL", "jdbc:postgresql://127.0.0.1:5433/t_f1_abc123?user=gcsp"),
            ("GCSP_TEST_RUNNING_DATABASE_URL", "jdbc:postgresql://127.0.0.1:5433/t_f1_def456?user=gcsp"),
            ("PROOF_DB_USER", "gcsp")])
        self.assertEqual(pg.fixed_names, ["gcsp_test_dev", "gcsp_test_running"])
        self.assertEqual(pg.settings["fsync"], "off")

    def test_postgres_bin_follows_the_machine(self):
        pg_module = self.ctx._adapters["postgres"]
        with mock.patch.dict(os.environ, {"GCSP_PG_BIN": "/usr/lib/postgresql/17/bin"}):
            self.assertEqual(pg_module.Pg(self.ctx).bin, "/usr/lib/postgresql/17/bin")
        os.environ.pop("GCSP_PG_BIN", None)
        self.assertEqual(pg_module.Pg(self.ctx).bin, "/opt/homebrew/opt/postgresql@17/bin")

    def test_maven_java_home_follows_the_machine(self):
        maven = self.ctx._adapters["maven"]
        with mock.patch.dict(os.environ, {"JAVA_HOME": str(self.fake_jdk)}):
            self.assertEqual(maven.tool_versions(self.ctx), {"jdk": "21.0.9"})
            plan = maven.java_test_plan(self.ctx, "/wt", [("GCSP_TEST_DATABASE_URL", "u")],
                                        ["-Dtest=gcsp.api.account.**"], base_env={"PATH": "/bin"})
        self.assertEqual(plan["command"], ["./mvnw", "-B", "test",
                                          "-DargLine=-Xmx1g -XX:+UseSerialGC -XX:ReservedCodeCacheSize=128m",
                                          "-Dtest=gcsp.api.account.**"])
        self.assertEqual(plan["cwd"], "/wt/services/gcsp-api")
        self.assertEqual(plan["env"]["JAVA_HOME"], str(self.fake_jdk))
        self.assertEqual(plan["env"]["MAVEN_OPTS"], "-Xmx512m")
        os.environ.pop("JAVA_HOME", None)
        self.assertEqual(os.path.realpath(str(maven._java_home(self.ctx))),
                         os.path.realpath("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"))

    def test_the_builds_name_the_forks_variables_and_paths(self):
        wt = self.root / "wt"
        for folder in ("services/gcsp-api", "apps/gcsp-web", "blocks/gcsp/shell"):
            (wt / folder).mkdir(parents=True)
        build = self.ctx._adapters["build"].Build(self.ctx)
        api, web = build._plan("api", wt), build._plan("web", wt)
        self.assertEqual((api["env_var"], api["output"], api["result"], api["inputs"], api["tools"]),
                         ("PROOF_API_JAR", "services/gcsp-api/target/quarkus-app", "quarkus-run.jar",
                          ["services/gcsp-api"], ["maven"]))
        self.assertFalse([item for item in api["command"] if item.startswith("JAVA_HOME=")], api["command"])
        self.assertEqual((web["env_var"], web["output"], web["inputs"], web["node"]),
                         ("PROOF_WEB_BROWSER", "apps/gcsp-web/dist/gcsp-web/browser",
                          ["apps/gcsp-web", "blocks/gcsp/shell"], "apps/gcsp-web"))
        self.assertEqual(web["command"][:6], ["npx", "-y", "-p", "node@24.22.3", "-p", "npm@11.19.1"])
        with mock.patch.dict(os.environ, {"JAVA_HOME": str(self.fake_jdk)}):
            self.assertEqual(self.ctx._adapters["maven"].tool_env(self.ctx), {"JAVA_HOME": str(self.fake_jdk)})

    def test_the_gcsp_legacy_extension_loads_and_reports(self):
        old = self.root / "old-gcsp"
        (old / "pg/data").mkdir(parents=True)
        env = self.cli_env({})
        env["GCSP_TEST_STACK_DIR"] = str(old)
        status = self.cli(env, "status")
        self.assertEqual(status.returncode, 0, status.stderr)
        report = json.loads(status.stdout)["adapters"]["gcsp_legacy"]
        self.assertEqual((report["present"], report["running"], report["dir"]), (True, False, str(old)))
        legacy = self.cli(env, "gcsp-legacy", "status")
        self.assertEqual(legacy.returncode, 0, legacy.stderr)

    def test_the_heavy_child_sees_the_kits_slot_name(self):
        env = self.cli_env({"test_stack": {"heavy_slots": 1}})
        env["AGENT_TEST_STACK_DIR"] = str(self.root / "agent-stack")
        child = ("import os,sys; sys.exit(0 if os.environ.get('AGENT_HEAVY_SLOT') "
                 "and not os.environ.get('GCSP_HEAVY_SLOT') else 3)")
        result = self.cli(env, "heavy", "--label", "t", "--", sys.executable, "-c", child)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
