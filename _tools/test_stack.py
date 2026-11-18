#!/usr/bin/env python3
"""Shared GCSP test stack: one throwaway PostgreSQL, a machine-wide heavy-run queue, bounded Maven runs.

Standard library only. State lives in $GCSP_TEST_STACK_DIR or ~/Library/Caches/gcsp-test-stack (local, never synced).
"""
import argparse
import contextlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("test_stack_resources", HERE / "test_resources.py")
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)

PG_BIN = "/opt/homebrew/opt/postgresql@17/bin"
JAVA_HOME = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
PG_USER = "gcsp"
EX_TEMPFAIL = 75
SOCKET_LIMIT = 90  # macOS unix socket paths top out at 104 bytes
PG_SETTINGS = (
    ("fsync", "off"), ("synchronous_commit", "off"), ("full_page_writes", "off"),
    ("shared_buffers", "64MB"), ("max_connections", "60"), ("work_mem", "4MB"),
)
HELD_ENV = "GCSP_HEAVY_SLOT"


class StackError(RuntimeError):
    pass


# ---------------------------------------------------------------- state root

def stack_root(raw=None):
    """Resolve the state root and refuse any synced location."""
    raw = raw or os.environ.get("GCSP_TEST_STACK_DIR") or str(Path.home() / "Library/Caches/gcsp-test-stack")
    path = Path(raw).expanduser()
    resolved = path.resolve()
    banned = Path.home() / "Library/CloudStorage"  # never resolve(): that would stat the banned tree
    for candidate in (path, resolved):
        text = str(candidate)
        if "onedrive" in text.lower() or "cloudstorage" in text.lower() or \
                candidate == banned or banned in candidate.parents:
            raise StackError("refusing state root %s: synced (CloudStorage/OneDrive) locations are not allowed" % raw)
    return resolved


@contextlib.contextmanager
def file_lock(path, timeout=60):
    """Exclusive flock with a bounded wait; the lock file is never removed."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise StackError("timed out waiting for lock %s" % path)
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def sanitise(run_id):
    text = re.sub(r"[^a-z0-9]+", "_", str(run_id).lower()).strip("_")
    return (text or "run")[:32]


def db_name(run_id, suffix=None):
    return "t_%s_%s" % (sanitise(run_id), suffix or secrets.token_hex(3))


def jdbc_url(port, name, user=PG_USER):
    return "jdbc:postgresql://127.0.0.1:%d/%s?user=%s" % (port, name, user)


def env_pairs(port, names, user=PG_USER):
    """names is [test database] or [test database, running database]; returns ordered env pairs."""
    names = list(names) + [None]
    pairs = [("GCSP_TEST_DATABASE_URL", jdbc_url(port, names[0], user))]
    if names[1]:
        pairs.append(("GCSP_TEST_RUNNING_DATABASE_URL", jdbc_url(port, names[1], user)))
    pairs.append(("PROOF_DB_USER", user))
    return pairs


def format_env(pairs, fmt):
    if fmt == "json":
        return json.dumps(dict(pairs), indent=2)
    prefix = "export " if fmt == "export" else ""
    return "\n".join("%s%s=%s" % (prefix, k, shlex.quote(v)) for k, v in pairs)


# ---------------------------------------------------------------- PostgreSQL

class Pg:
    def __init__(self, root):
        self.root = Path(root)
        self.pg = self.root / "pg"
        self.data = self.pg / "data"
        self.sock = self.pg / "sock"
        self.state_path = self.pg / "state.json"
        self.db_path = self.root / "databases.json"
        self.bin = os.environ.get("GCSP_PG_BIN", PG_BIN)

    # tools
    def tool(self, name):
        found = Path(self.bin) / name
        if found.exists():
            return str(found)
        on_path = shutil.which(name)
        if on_path:
            return on_path
        raise StackError("%s not found: install PostgreSQL 17 or set GCSP_PG_BIN" % name)

    def tool_env(self):
        env = dict(os.environ)
        env["LC_ALL"] = "C"
        return env

    def run_tool(self, name, *args, check=True):
        p = subprocess.run([self.tool(name)] + list(args), capture_output=True, text=True,
                           env=self.tool_env(), timeout=120)
        if check and p.returncode != 0:
            raise StackError("%s failed (%d): %s" % (name, p.returncode, (p.stderr or p.stdout).strip()[:400]))
        return p

    # cluster
    def port(self):
        return (R.read_json(self.state_path, {}) or {}).get("port")

    def running(self):
        if not (self.data / "PG_VERSION").exists():
            return False
        return self.run_tool("pg_ctl", "status", "-D", str(self.data), check=False).returncode == 0

    @staticmethod
    def free_port():
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    @staticmethod
    def port_free(port):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False

    def write_conf(self, port):
        lines = ["# written by _tools/test_stack.py; test-only durability settings",
                 "listen_addresses = '127.0.0.1'", "port = %d" % port,
                 "unix_socket_directories = '%s'" % self.sock]
        lines += ["%s = %s" % kv for kv in PG_SETTINGS]
        (self.data / "gcsp-test.conf").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def initdb(self):
        if len(str(self.sock)) > SOCKET_LIMIT:
            raise StackError("socket directory %s is too long for a unix socket; use a shorter "
                             "GCSP_TEST_STACK_DIR" % self.sock)
        self.pg.mkdir(parents=True, exist_ok=True)
        self.sock.mkdir(parents=True, exist_ok=True)
        self.run_tool("initdb", "-D", str(self.data), "-U", PG_USER, "-E", "UTF8", "--locale=C", "-A", "trust")
        hba = ("local all all trust\nhost all all 127.0.0.1/32 trust\n")
        (self.data / "pg_hba.conf").write_text(hba, encoding="utf-8")
        with open(self.data / "postgresql.conf", "a", encoding="utf-8") as f:
            f.write("\ninclude_if_exists = 'gcsp-test.conf'\n")

    def up(self):
        with file_lock(self.pg / "up.lock"):
            if not (self.data / "PG_VERSION").exists():
                self.initdb()
            state = R.read_json(self.state_path, {}) or {}
            if not self.running():
                port = state.get("port")
                if not port or not self.port_free(port):
                    port = self.free_port()
                self.sock.mkdir(parents=True, exist_ok=True)
                self.write_conf(port)
                R.atomic_json(self.state_path, {"port": port, "user": PG_USER})
                self.run_tool("pg_ctl", "start", "-D", str(self.data), "-w", "-t", "60",
                              "-l", str(self.pg / "server.log"))
            elif not state.get("port"):
                raise StackError("cluster is running but %s has no port; run pg down --force" % self.state_path)
            state = R.read_json(self.state_path, {})
            return {"port": state["port"], "user": PG_USER, "data": str(self.data)}

    def sql(self, statement, database="postgres"):
        port = self.port()
        if not port:
            raise StackError("no cluster state: run pg up first")
        p = self.run_tool("psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", str(port),
                          "-U", PG_USER, "-d", database, "-c", statement)
        return p.stdout

    # database registry
    def read_dbs(self):
        data = R.read_json(self.db_path, {}) or {}
        return data.get("databases", {})

    @contextlib.contextmanager
    def registry(self):
        with file_lock(self.root / "databases.lock"):
            dbs = self.read_dbs()
            yield dbs
            R.atomic_json(self.db_path, {"databases": dbs})

    def create_dbs(self, run_id, running=False, owner=None, names=None):
        owner = owner or R.owner()
        if names is None:
            names = [db_name(run_id)] + ([db_name(run_id)] if running else [])
        else:
            names = list(names[:2 if running else 1])
            for name in names:  # fixed names: only under the heavy slot, so a leftover is stale
                self.sql('DROP DATABASE IF EXISTS "%s" WITH (FORCE)' % name)
        with self.registry() as dbs:
            # Record first, so a crash between create and record leaves a gc-able entry rather than a leak.
            for name in names:
                dbs[name] = {"name": name, "run": str(run_id), "owner": owner, "created": time.time()}
        for name in names:
            self.sql('CREATE DATABASE "%s"' % name)
        return port_names(self.port(), names)

    def drop_names(self, names):
        for name in names:
            self.sql('DROP DATABASE IF EXISTS "%s" WITH (FORCE)' % name)
        with self.registry() as dbs:
            for name in names:
                dbs.pop(name, None)

    def drop_run(self, run_id):
        with self.registry() as dbs:
            names = [n for n, d in dbs.items() if d.get("run") == str(run_id)]
        self.drop_names(names)
        return names

    def gc(self):
        with self.registry() as dbs:
            dead = [n for n, d in dbs.items() if not R.process_alive(d.get("owner", {}))]
        self.drop_names(dead)
        return dead

    def down(self, if_idle=False, force=False):
        if not self.running():
            return {"stopped": False, "reason": "not running"}
        self.gc()
        live = list(self.read_dbs())
        if live and (if_idle or not force):
            return {"stopped": False, "reason": "databases held by live owners: %s" % ", ".join(sorted(live)),
                    "databases": live, "refused": True}
        self.run_tool("pg_ctl", "stop", "-D", str(self.data), "-m", "fast", "-w", "-t", "60")
        if live:
            with self.registry() as dbs:
                dbs.clear()
        return {"stopped": True, "databases": []}

    def status(self):
        running = self.running()
        size = R.allocated_bytes(self.data) if self.data.exists() else 0
        return {"running": running, "port": self.port(), "databases": self.read_dbs(),
                "data": str(self.data), "data_bytes": size}


def port_names(port, names):
    return {"port": port, "names": names}


def owner_for_pid(pid):
    if pid is None:
        return None
    return {"pid": pid, "start": R.process_identity(pid)}


# ---------------------------------------------------------------- heavy queue

def host_dir():
    return Path(os.environ.get("TEST_RESOURCE_HOST_DIR") or Path.home() / ".cache/agent-scaffolding/test-resources")


class Slots:
    """Machine-wide heavy slots: lease records under an flock, dead owners reclaimed."""
    def __init__(self, directory=None, slots=1):
        self.directory = Path(directory or host_dir())
        self.path = self.directory / "heavy-slots.json"
        self.lock = self.directory / "heavy-slots.lock"
        self.slots = slots

    def _update(self, mutate):
        with file_lock(self.lock, timeout=30):
            leases = R.read_json(self.path, {}) or {}
            leases = {k: v for k, v in leases.items() if R.process_alive(v.get("owner", {}))}
            result = mutate(leases)
            R.atomic_json(self.path, leases)
            return result

    def try_acquire(self, token, label, owner=None):
        def take(leases):
            if len(leases) >= self.slots:
                return False
            leases[token] = {"owner": owner or R.owner(), "label": label, "since": time.time()}
            return True
        return self._update(take)

    def release(self, token):
        self._update(lambda leases: leases.pop(token, None))

    def holders(self):
        return self._update(lambda leases: dict(leases))


class Terminated(Exception):
    def __init__(self, signum):
        super().__init__("terminated by signal %d" % signum)
        self.signum = signum


def wait_for_slot(slots, budget, token, label, ram, wait_min, volume, out=sys.stderr, poll=1.0, clock=time.monotonic):
    """Take a slot, then the RAM reservation; give the slot back while waiting for RAM."""
    deadline = clock() + wait_min * 60
    next_status = clock()
    while True:
        if slots.try_acquire(token, label):
            if not ram or budget is None:
                return
            try:
                budget.acquire(token, 0, int(ram * R.GIB), volume)
                return
            except R.ResourceError as error:
                slots.release(token)
                reason = str(error)
        else:
            held = ", ".join("%s (pid %s)" % (v.get("label"), v.get("owner", {}).get("pid"))
                             for v in slots.holders().values())
            reason = "slot held by " + held
        if clock() >= deadline:
            raise StackError("heavy slot not available after %g min: %s" % (wait_min, reason))
        if clock() >= next_status:
            print("[heavy] waiting for %s: %s" % (label, reason), file=out, flush=True)
            next_status = clock() + 60
        time.sleep(poll)


def heavy_run(command, label="heavy", ram_gib=2.0, wait_min=30, slots=1, env=None, cwd=None, out=sys.stderr):
    """Run command inside the queue; returns its exit code (128+n for a signal)."""
    if os.environ.get(HELD_ENV):
        return subprocess.call(command, env=env, cwd=cwd)
    directory = host_dir()
    queue = Slots(directory, slots)
    budget = R.HostBudget(R.Policy({"output_root": str(directory)}), directory) if ram_gib else None
    token = "heavy-%d-%s" % (os.getpid(), uuid.uuid4().hex[:8])
    child = {"p": None}

    def on_signal(signum, frame):
        if child["p"] is not None and child["p"].poll() is None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(child["p"].pid, signum)
        raise Terminated(signum)

    old = {s: signal.signal(s, on_signal) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        try:
            wait_for_slot(queue, budget, token, label, ram_gib, wait_min, tempfile.gettempdir(), out=out)
        except StackError as error:
            print("[heavy] %s" % error, file=out, flush=True)
            return EX_TEMPFAIL
        child_env = dict(env if env is not None else os.environ)
        child_env[HELD_ENV] = token
        child["p"] = subprocess.Popen(command, env=child_env, cwd=cwd, start_new_session=True)
        last = 0
        while child["p"].poll() is None:
            time.sleep(0.2)
            if budget is not None and time.monotonic() - last > 5:
                budget.update(token, 0, R.group_rss(child["p"].pid))
                last = time.monotonic()
        code = child["p"].returncode
        return 128 + -code if code < 0 else code
    except Terminated as stop:
        p = child["p"]
        if p is not None:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                R.stop_group(p)
        return 128 + stop.signum
    finally:
        for s, h in old.items():
            signal.signal(s, h)
        if child["p"] is not None and child["p"].poll() is None:
            R.stop_group(child["p"])
        with contextlib.suppress(Exception):
            if budget is not None:
                budget.release(token)
        with contextlib.suppress(Exception):
            queue.release(token)


# ---------------------------------------------------------------- java-test

def java_test_plan(worktree, db_env, maven_args, heap="1g", java_home=JAVA_HOME, base_env=None):
    """Pure: the Maven command line, working directory and environment for a bounded focused run."""
    arg_line = "-Xmx%s -XX:+UseSerialGC -XX:ReservedCodeCacheSize=128m" % heap
    env = dict(base_env if base_env is not None else os.environ)
    env["JAVA_HOME"] = java_home
    env["MAVEN_OPTS"] = "-Xmx512m"
    env.update(dict(db_env))
    command = ["./mvnw", "-B", "test", "-DargLine=" + arg_line] + list(maven_args)
    return {"command": command, "cwd": str(Path(worktree) / "services/gcsp-api"), "env": env}


# The *HttpTest profiles pin gcsp.database.expected-name, so java-test uses the README's fixed names.
FIXED_DBS = ("gcsp_test_dev", "gcsp_test_running")


def java_test(args, maven_args):
    if not os.environ.get(HELD_ENV):  # take the slot first: fixed names are safe only one run at a time
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "java-test", "--worktree", args.worktree,
                   "--run", args.run, "--heap", args.heap] + (["--running"] if args.running else []) \
            + ["--"] + list(maven_args)
        return heavy_run(command, label="java-test " + args.run, ram_gib=args.ram_gib,
                         wait_min=args.wait_min, slots=args.slots)
    pg = Pg(stack_root())
    pg.up()
    created = pg.create_dbs(args.run, args.running, owner=R.owner(), names=FIXED_DBS)
    try:
        plan = java_test_plan(args.worktree, env_pairs(created["port"], created["names"]), maven_args, args.heap)
        return subprocess.call(plan["command"], env=plan["env"], cwd=plan["cwd"])
    finally:
        with contextlib.suppress(Exception):
            pg.drop_names(created["names"])


# ---------------------------------------------------------------- CLI

def build_parser():
    p = argparse.ArgumentParser(
        prog="test_stack.py", description="Shared GCSP test stack: one local PostgreSQL 17, a machine-wide "
        "queue for heavy runs, and bounded focused Maven runs. State root: $GCSP_TEST_STACK_DIR or "
        "~/Library/Caches/gcsp-test-stack.")
    sub = p.add_subparsers(dest="cmd", required=True, metavar="{pg,heavy,java-test}")

    pg = sub.add_parser("pg", help="manage the long-lived PostgreSQL cluster and per-run databases",
                        description="One cluster on 127.0.0.1 (role gcsp, trust auth, test-only durability "
                        "settings) and one database per run.")
    pgs = pg.add_subparsers(dest="pg_cmd", required=True, metavar="{up,db,gc,down,status}")
    pgs.add_parser("up", help="initdb once, start if stopped, print {port, user, data} as JSON")
    db = pgs.add_parser("db", help="create or drop a run's databases")
    dbs = db.add_subparsers(dest="db_cmd", required=True, metavar="{create,drop}")
    c = dbs.add_parser("create", help="create database t_<run>_<hex> and print the GCSP_TEST_* env",
                       description="Prints GCSP_TEST_DATABASE_URL (and GCSP_TEST_RUNNING_DATABASE_URL with "
                       "--running) plus PROOF_DB_USER. The owner defaults to the parent process; pass "
                       "--owner-pid for a longer-lived owner, since gc drops databases whose owner has exited.")
    c.add_argument("--run", required=True, help="run id (sanitised into the database name)")
    c.add_argument("--running", action="store_true", help="also create the second 'running' database")
    c.add_argument("--format", choices=("env", "export", "json"), default="env",
                   help="env: shell-quoted KEY=VALUE lines (default); export: with an export prefix; json")
    c.add_argument("--owner-pid", type=int, help="process whose exit makes the database collectable")
    d = dbs.add_parser("drop", help="drop every database recorded for a run (DROP ... WITH (FORCE))")
    d.add_argument("--run", required=True)
    pgs.add_parser("gc", help="drop databases whose owner process is dead")
    dn = pgs.add_parser("down", help="stop the cluster (refuses while a live owner holds a database)")
    dn.add_argument("--if-idle", action="store_true", help="gc first, stop only if no databases remain")
    dn.add_argument("--force", action="store_true", help="stop even with live owners, forgetting their databases")
    pgs.add_parser("status", help="JSON: running, port, databases, data dir size")

    h = sub.add_parser("heavy", help="run a command inside the machine-wide heavy-run queue",
                       usage="test_stack.py heavy [options] -- COMMAND [ARG ...]",
                       description="Waits for a heavy slot (Java, PostgreSQL-heavy, Chrome), runs the command "
                       "with TMPDIR passed through, forwards SIGINT/SIGTERM to its process group, releases the "
                       "slot on any exit and exits with the command's code (75 if the wait times out).")
    add_queue_options(h)
    h.add_argument("--label", default="heavy", help="name shown to other waiters")
    h.add_argument("command", nargs=argparse.REMAINDER, help="-- followed by the command")

    j = sub.add_parser("java-test", help="focused Maven test run against a per-run database",
                       usage="test_stack.py java-test --worktree WT --run ID [options] -- MAVEN_ARGS",
                       description="pg up, create the run's database, run './mvnw -B test' in "
                       "<worktree>/services/gcsp-api inside the heavy queue (MAVEN_OPTS=-Xmx512m, test JVM "
                       "-Xmx1g with the serial GC), then drop the database.")
    j.add_argument("--worktree", required=True, help="checkout containing services/gcsp-api")
    j.add_argument("--run", required=True, help="run id for the database name")
    j.add_argument("--running", action="store_true", help="also create the 'running' database")
    j.add_argument("--heap", default="1g", help="test JVM -Xmx (default 1g)")
    add_queue_options(j)
    j.add_argument("maven", nargs=argparse.REMAINDER, help="-- followed by Maven args, e.g. -Dtest='gcsp.api.account.**'")
    return p


def add_queue_options(p):
    p.add_argument("--ram-gib", type=float, default=2.0, help="RAM to reserve in the host budget; 0 skips (default 2)")
    p.add_argument("--wait-min", type=float, default=30, help="minutes to wait for a slot before exiting 75")
    p.add_argument("--slots", type=int, default=1, help="concurrent heavy runs allowed machine-wide (default 1)")


def strip_dashes(rest):
    return rest[1:] if rest and rest[0] == "--" else rest


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.cmd == "pg":
            pg = Pg(stack_root())
            if args.pg_cmd == "up":
                print(json.dumps(pg.up()))
            elif args.pg_cmd == "db" and args.db_cmd == "create":
                info = pg.up()
                created = pg.create_dbs(args.run, args.running, owner=owner_for_pid(args.owner_pid or os.getppid()))
                print(format_env(env_pairs(info["port"], created["names"]), args.format))
            elif args.pg_cmd == "db":
                print(json.dumps({"dropped": pg.drop_run(args.run)}))
            elif args.pg_cmd == "gc":
                print(json.dumps({"dropped": pg.gc()}))
            elif args.pg_cmd == "down":
                result = pg.down(args.if_idle, args.force)
                print(json.dumps(result))
                return 1 if result.get("refused") and not args.if_idle else 0
            else:
                print(json.dumps(pg.status(), indent=2))
            return 0
        rest = strip_dashes(args.command if args.cmd == "heavy" else args.maven)
        if not rest and args.cmd == "heavy":
            parser.error("heavy needs a command after --")
        if args.cmd == "heavy":
            return heavy_run(rest, args.label, args.ram_gib, args.wait_min, args.slots)
        return java_test(args, rest)
    except (StackError, R.ResourceError) as error:
        print("test_stack: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
