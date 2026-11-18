"""Unit tests for _tools/test_stack.py: temp dirs and fakes only, no PostgreSQL, Java or OneDrive.

The optional real smoke is gated by GCSP_TEST_STACK_SMOKE=1."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("test_stack_under_test", ROOT / "_tools/test_stack.py")
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)
R = T.R
SCRIPT = str(ROOT / "_tools/test_stack.py")


def dead_pid():
    p = subprocess.Popen(["/usr/bin/true"])
    p.wait()
    return p.pid


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tstack-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)


class RootRefusal(Base):
    def test_refuses_cloudstorage_and_onedrive(self):
        home = Path.home()
        for raw in (str(home / "Library/CloudStorage/anything"),
                    str(home / "Library/CloudStorage"),
                    str(self.tmp / "OneDrive-IBM" / "x"),
                    str(self.tmp / "onedrive")):
            with self.assertRaises(T.StackError, msg=raw):
                T.stack_root(raw)

    def test_refuses_symlink_into_cloudstorage_name(self):
        link = self.tmp / "innocent"
        target = self.tmp / "OneDrive-IBM"
        target.mkdir()
        link.symlink_to(target)
        with self.assertRaises(T.StackError):
            T.stack_root(str(link))

    def test_accepts_local_and_env_default(self):
        self.assertEqual(T.stack_root(str(self.tmp / "ok")), (self.tmp / "ok").resolve())
        old = os.environ.get("GCSP_TEST_STACK_DIR")
        os.environ["GCSP_TEST_STACK_DIR"] = str(self.tmp / "env")
        try:
            self.assertEqual(T.stack_root(), (self.tmp / "env").resolve())
        finally:
            if old is None:
                del os.environ["GCSP_TEST_STACK_DIR"]
            else:
                os.environ["GCSP_TEST_STACK_DIR"] = old


class Naming(unittest.TestCase):
    def test_sanitises(self):
        self.assertRegex(T.db_name("FUCQ-465 / run;DROP"), r"^t_fucq_465_run_drop_[0-9a-f]{6}$")
        self.assertRegex(T.db_name("!!!"), r"^t_run_[0-9a-f]{6}$")
        self.assertLessEqual(len(T.db_name("x" * 200)), 3 + 32 + 1 + 6)

    def test_unique_per_call(self):
        self.assertNotEqual(T.db_name("a"), T.db_name("a"))

    def test_env_shape(self):
        pairs = T.env_pairs(5432, ["t_a_000001", "t_a_000002"])
        self.assertEqual([k for k, _ in pairs],
                         ["GCSP_TEST_DATABASE_URL", "GCSP_TEST_RUNNING_DATABASE_URL", "PROOF_DB_USER"])
        self.assertEqual(dict(pairs)["GCSP_TEST_DATABASE_URL"],
                         "jdbc:postgresql://127.0.0.1:5432/t_a_000001?user=gcsp")
        self.assertEqual([k for k, _ in T.env_pairs(5432, ["t_a_000001", None])],
                         ["GCSP_TEST_DATABASE_URL", "PROOF_DB_USER"])
        self.assertEqual([k for k, _ in T.env_pairs(5432, ["t_a_000001"])], ["GCSP_TEST_DATABASE_URL", "PROOF_DB_USER"])
        text = T.format_env(pairs, "env")
        self.assertIn("GCSP_TEST_DATABASE_URL='jdbc:postgresql://127.0.0.1:5432/t_a_000001?user=gcsp'", text)
        self.assertIn("PROOF_DB_USER=gcsp", text)
        self.assertTrue(T.format_env(pairs, "export").startswith("export GCSP_TEST_DATABASE_URL="))
        self.assertEqual(json.loads(T.format_env(pairs, "json"))["PROOF_DB_USER"], "gcsp")


class FakePg(T.Pg):
    """Records SQL instead of calling psql; the cluster is never started."""
    def __init__(self, root):
        super().__init__(root)
        self.statements = []
        T.R.atomic_json(self.state_path, {"port": 55999, "user": "gcsp"})

    def sql(self, statement, database="postgres"):
        self.statements.append(statement)
        return ""


class Registry(Base):
    def test_create_records_owner_and_drop_forgets(self):
        pg = FakePg(self.tmp)
        made = pg.create_dbs("run-1", running=True, owner=R.owner())
        self.assertEqual(len(made["names"]), 2)
        self.assertEqual(set(pg.read_dbs()), set(made["names"]))
        for entry in pg.read_dbs().values():
            self.assertEqual(entry["run"], "run-1")
            self.assertEqual(entry["owner"]["pid"], os.getpid())
        self.assertEqual(pg.statements, ['CREATE DATABASE "%s"' % n for n in made["names"]])
        pg.drop_run("run-1")
        self.assertEqual(pg.read_dbs(), {})
        self.assertTrue(all("WITH (FORCE)" in s for s in pg.statements[2:]))

    def test_gc_drops_only_dead_owners(self):
        pg = FakePg(self.tmp)
        live = pg.create_dbs("live", owner=R.owner())["names"][0]
        dead = pg.create_dbs("dead", owner={"pid": dead_pid(), "start": None})["names"][0]
        self.assertEqual(pg.gc(), [dead])
        self.assertEqual(set(pg.read_dbs()), {live})

    def test_reused_pid_with_other_start_is_dead(self):
        pg = FakePg(self.tmp)
        name = pg.create_dbs("x", owner={"pid": os.getpid(), "start": "Thu Jan  1 00:00:00 1970"})["names"][0]
        self.assertEqual(pg.gc(), [name])

    def test_concurrent_creates_do_not_lose_records(self):
        code = ("import importlib.util,sys;s=importlib.util.spec_from_file_location('m',%r);m=importlib.util.module_from_spec(s);"
                "s.loader.exec_module(m);\nclass P(m.Pg):\n  def sql(self,*a,**k): return ''\n"
                "p=P(sys.argv[1]);p.create_dbs(sys.argv[2],owner=m.R.owner())" % SCRIPT)
        FakePg(self.tmp)
        procs = [subprocess.Popen([sys.executable, "-B", "-c", code, str(self.tmp), "r%d" % i]) for i in range(8)]
        for p in procs:
            self.assertEqual(p.wait(timeout=60), 0)
        self.assertEqual(len(FakePg(self.tmp).read_dbs()), 8)

    def test_down_refuses_live_owner_unless_forced(self):
        pg = FakePg(self.tmp)
        stops = []
        pg.running = lambda: True
        pg.run_tool = lambda *a, **k: stops.append(a)
        pg.create_dbs("busy", owner=R.owner())
        self.assertTrue(pg.down()["refused"])
        self.assertTrue(pg.down(if_idle=True)["refused"])
        self.assertEqual(stops, [])
        self.assertTrue(pg.down(force=True)["stopped"])
        self.assertEqual(pg.read_dbs(), {})
        self.assertEqual(len(stops), 1)

    def test_down_if_idle_gcs_dead_then_stops(self):
        pg = FakePg(self.tmp)
        pg.running = lambda: True
        pg.run_tool = lambda *a, **k: None
        pg.create_dbs("gone", owner={"pid": dead_pid(), "start": None})
        self.assertTrue(pg.down(if_idle=True)["stopped"])


class Heavy(Base):
    def slots(self, n=1):
        return T.Slots(self.tmp / "host", n)

    def test_exclusive_and_second_owner_gets_it_after_release(self):
        slots = self.slots()
        self.assertTrue(slots.try_acquire("a", "first"))
        self.assertFalse(slots.try_acquire("b", "second"))
        slots.release("a")
        self.assertTrue(slots.try_acquire("b", "second"))

    def test_slots_option_allows_two(self):
        slots = self.slots(2)
        self.assertTrue(slots.try_acquire("a", "x"))
        self.assertTrue(slots.try_acquire("b", "y"))
        self.assertFalse(slots.try_acquire("c", "z"))

    def test_dead_lease_is_reclaimed(self):
        slots = self.slots()
        self.assertTrue(slots.try_acquire("ghost", "crashed", owner={"pid": dead_pid(), "start": None}))
        self.assertTrue(slots.try_acquire("b", "second"))
        self.assertEqual(list(slots.holders()), ["b"])

    def test_two_fake_owners_hold_one_slot(self):
        a = subprocess.Popen(["/bin/sleep", "30"])
        self.addCleanup(a.kill)
        slots = self.slots()
        self.assertTrue(slots.try_acquire("a", "a", owner=T.owner_for_pid(a.pid)))
        self.assertFalse(slots.try_acquire("b", "b"))
        a.kill()
        a.wait()
        self.assertTrue(slots.try_acquire("b", "b"))

    def test_wait_times_out_with_status_line(self):
        slots = self.slots()
        slots.try_acquire("a", "holder")
        lines = []

        class Out:
            def write(self, s):
                lines.append(s)

            def flush(self):
                pass
        now = [0.0]

        def clock():
            return now[0]
        orig = time.sleep
        time.sleep = lambda s: now.__setitem__(0, now[0] + 30)
        try:
            with self.assertRaises(T.StackError) as ctx:
                T.wait_for_slot(slots, None, "b", "second", 0, 1.0, str(self.tmp), out=Out(), clock=clock)
        finally:
            time.sleep = orig
        self.assertIn("holder", str(ctx.exception))
        self.assertTrue(any("waiting for second" in s for s in lines))

    def run_heavy(self, *args, **popen):
        env = dict(os.environ, TEST_RESOURCE_HOST_DIR=str(self.tmp / "host"))
        env.pop(T.HELD_ENV, None)
        return subprocess.Popen([sys.executable, "-B", SCRIPT, "heavy", "--ram-gib", "0"] + list(args),
                                env=env, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, **popen)

    def test_cli_second_run_waits_and_exit_code_passes_through(self):
        marker = self.tmp / "m"
        first = self.run_heavy("--label", "one", "--wait-min", "1", "--", "/bin/sh", "-c",
                               "touch %s; sleep 2; exit 3" % marker)
        deadline = time.time() + 20
        while not marker.exists() and time.time() < deadline:
            time.sleep(0.05)
        started = time.time()
        second = self.run_heavy("--label", "two", "--wait-min", "1", "--", "/bin/sh", "-c", "exit 0")
        self.assertEqual(first.wait(timeout=30), 3)
        self.assertEqual(second.wait(timeout=30), 0)
        self.assertGreater(time.time() - started, 0.5)
        first.communicate()
        second.communicate()

    def test_cli_timeout_exits_75(self):
        slots = T.Slots(self.tmp / "host", 1)
        slots.try_acquire("a", "holder")
        p = self.run_heavy("--wait-min", "0.01", "--", "/bin/sh", "-c", "exit 0")
        _, err = p.communicate(timeout=30)
        self.assertEqual(p.returncode, 75)
        self.assertIn("not available", err)

    def test_signal_forwarded_and_slot_released(self):
        marker = self.tmp / "started"
        p = self.run_heavy("--", "/bin/sh", "-c", "touch %s; exec sleep 6012" % marker)
        deadline = time.time() + 20
        while not marker.exists() and time.time() < deadline:
            time.sleep(0.05)
        self.assertTrue(marker.exists())
        slots = T.Slots(self.tmp / "host", 1)
        self.assertEqual(len(slots.holders()), 1)
        p.send_signal(signal.SIGTERM)
        p.communicate(timeout=30)
        self.assertEqual(p.returncode, 128 + signal.SIGTERM)
        self.assertEqual(slots.holders(), {})
        self.assertEqual(subprocess.run(["/usr/bin/pgrep", "-f", "sleep 6012"], capture_output=True).returncode, 1)

    def test_nested_heavy_runs_inline_instead_of_deadlocking(self):
        slots = T.Slots(self.tmp / "host", 1)
        slots.try_acquire("a", "outer")
        env = dict(os.environ, TEST_RESOURCE_HOST_DIR=str(self.tmp / "host"), **{T.HELD_ENV: "a"})
        p = subprocess.run([sys.executable, "-B", SCRIPT, "heavy", "--", "/bin/sh", "-c", "exit 5"],
                           env=env, capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 5)


class JavaPlan(unittest.TestCase):
    def test_command_cwd_and_env(self):
        db_env = T.env_pairs(5433, ["t_a_000001", "t_a_000002"])
        plan = T.java_test_plan("/wt", db_env, ["-Dtest=ManualDraftsDbTest"], base_env={"PATH": "/bin", "X": "1"})
        self.assertEqual(plan["cwd"], "/wt/services/gcsp-api")
        self.assertEqual(plan["command"][:3], ["./mvnw", "-B", "test"])
        self.assertEqual(plan["command"][3],
                         "-DargLine=-Xmx1g -XX:+UseSerialGC -XX:ReservedCodeCacheSize=128m")
        self.assertEqual(plan["command"][4:], ["-Dtest=ManualDraftsDbTest"])
        env = plan["env"]
        self.assertEqual(env["MAVEN_OPTS"], "-Xmx512m")
        self.assertEqual(env["JAVA_HOME"], T.JAVA_HOME)
        self.assertEqual(env["GCSP_TEST_DATABASE_URL"], "jdbc:postgresql://127.0.0.1:5433/t_a_000001?user=gcsp")
        self.assertEqual(env["GCSP_TEST_RUNNING_DATABASE_URL"], "jdbc:postgresql://127.0.0.1:5433/t_a_000002?user=gcsp")
        self.assertEqual((env["PROOF_DB_USER"], env["X"]), ("gcsp", "1"))
        self.assertNotIn("MaxMetaspaceSize", " ".join(plan["command"]))

    def test_heap_override_and_no_running_db(self):
        plan = T.java_test_plan("/wt", T.env_pairs(1, ["d", None]), [], heap="2g", base_env={})
        self.assertIn("-Xmx2g", plan["command"][3])
        self.assertNotIn("GCSP_TEST_RUNNING_DATABASE_URL", plan["env"])


class Help(unittest.TestCase):
    def test_every_help_exits_zero(self):
        for argv in ([], ["pg"], ["pg", "up"], ["pg", "db"], ["pg", "db", "create"], ["pg", "db", "drop"],
                     ["pg", "gc"], ["pg", "down"], ["pg", "status"], ["heavy"], ["java-test"]):
            p = subprocess.run([sys.executable, "-B", SCRIPT] + argv + ["--help"], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, argv)
            self.assertIn("usage:", p.stdout, argv)


@unittest.skipUnless(os.environ.get("GCSP_TEST_STACK_SMOKE") == "1", "set GCSP_TEST_STACK_SMOKE=1 for the real PostgreSQL smoke")
class RealPostgres(Base):
    def test_up_create_query_drop_down(self):
        root = self.tmp / "s"
        env = dict(os.environ, GCSP_TEST_STACK_DIR=str(root))

        def cli(*a):
            return subprocess.run([sys.executable, "-B", SCRIPT] + list(a), env=env, capture_output=True, text=True, timeout=180)
        self.addCleanup(cli, "pg", "down", "--force")
        up = cli("pg", "up")
        self.assertEqual(up.returncode, 0, up.stderr)
        made = cli("pg", "db", "create", "--run", "smoke", "--running", "--owner-pid", str(os.getpid()), "--format", "json")
        self.assertEqual(made.returncode, 0, made.stderr)
        self.assertEqual(len(json.loads(cli("pg", "status").stdout)["databases"]), 2)
        self.assertEqual(cli("pg", "db", "drop", "--run", "smoke").returncode, 0)
        self.assertEqual(cli("pg", "down").returncode, 0)


if __name__ == "__main__":
    unittest.main()
