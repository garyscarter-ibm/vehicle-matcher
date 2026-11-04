"""affected/python.py -- test_stamp.py's Python plug-in: which unittest modules a change affects, and the sharded
unittest runner. Loaded by path from test_stamp.py (`affected/<language>.py` next to it); it is not a command.

The contract with test_stamp.py (a later language plug-in implements the same three functions)
  discover_modules(cwd, cfg)                                      -> sorted list of test module ids
  select_affected(cwd, cwd_rel, cfg, changed, is_t0, modules)     -> (kind, modules, notes)
  run(cwd, cfg, modules, jobs, rdir, log_dir, env, say, dry_run)  -> None (dry run) or (ok, ran, skipped, wall)
`cwd` is the directory the tests run in (the project root, or a sub-folder of it: `tests.cwd`); `cwd_rel` is that
folder relative to the project root ("." when they are the same); `changed` are project-root-relative git paths;
`is_t0(path)` says whether a path is docs-only; `rdir` is the shared test-runs folder; `log_dir` is a fresh folder
for this run's shard logs; `env` is the environment for the shards. kind is "none" (nothing to run), "some" (the
modules chosen) or "full" (fall back to the whole suite; notes[0] says why).

Settings (the "python" block of "tests" in .claude/scaffolding.json; every path is relative to `cwd`)
  roots          folders whose .py files make up the import graph (default ["."]).
  test_glob      where the test modules are: "<folder>/<file pattern>", e.g. "tests/test_*.py" (default
                 "tests/test*.py"). Sub-folders that are packages (have an __init__.py) are searched too, as
                 `python -m unittest discover` does.
  unittest_top   the top-level folder module ids are dotted from, like discover's -t (default ".").

Affected (conservative: when unsure, run more)
  A test module is affected when a changed .py file under a root is in its import closure (local modules only, found
  with `ast`; the packages' __init__ files count; `import_module("x")` and `__import__("x")` count; a bare
  `import helper` finds a helper.py in any root by its file name), or when a module in that closure names the
  changed script as a string ("build.py" run by subprocess, or "pkg.build"). A change to anything else falls back
  to the full suite and says why: a deleted .py, a .py that no test reaches, a non-.py file under a root (fixtures,
  html, shell), anything outside the roots that is not a T0 path. T0 paths run nothing.

Shards
  One process per shard, cwd `cwd`, environment as given except TMPDIR/TMP/TEMP point to a private temporary
  directory removed after the worker exits, running the same unittest machinery as `python3 -B -m unittest <ids...>`
  (through worker(), which only adds per-test timing). Each shard's output goes to a log file in `log_dir`. Shards
  are planned from the per-module and per-class seconds the last run recorded (timings.json in `rdir`): longest
  first, each onto the least-loaded shard; a module longer than total/(2 x jobs) is split into its TestCase classes
  (not when it defines load_tests, setUpModule or tearDownModule). With no recorded time, a module costs its file
  size.

Standard library only."""
import ast
import fnmatch
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack

sys.dont_write_bytecode = True

DEFAULTS = {"roots": ["."], "test_glob": "tests/test*.py", "unittest_top": "."}
SKIP_DIRS = {"__pycache__", "node_modules", "venv", "site-packages", "build", "dist"}
RAN_RE = re.compile(r"^Ran (\d+) tests? in ")
RESULT_RE = re.compile(r"^(OK|FAILED)(?: \((.*)\))?$")
HEADER_RE = re.compile(r"^(FAIL|ERROR): (.*)$")


def settings(raw):
    """The python block with defaults applied and the types checked. Raises ValueError with a plain message."""
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError('"python" must be an object')
    cfg = dict(DEFAULTS)
    cfg.update(raw)
    if not (isinstance(cfg["roots"], list) and cfg["roots"] and all(isinstance(r, str) and r for r in cfg["roots"])):
        raise ValueError('"python.roots" must be a non-empty list of folder names')
    for k in ("test_glob", "unittest_top"):
        if not isinstance(cfg[k], str) or not cfg[k]:
            raise ValueError('"python.%s" must be a non-empty string' % k)
    cfg["roots"] = [_norm(r) for r in cfg["roots"]]
    cfg["unittest_top"] = _norm(cfg["unittest_top"])
    return cfg


def _norm(p):
    n = os.path.normpath(p).replace(os.sep, "/")
    return n


# ---------------------------------------------------------------- small file helpers

def _atomic_write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------- discovery

def discover_modules(cwd, cfg):
    """The test module ids `unittest discover -s <glob folder> -p <glob pattern> -t <top>` would load, as dotted ids
    from unittest_top: files matching the glob, and the same in sub-packages (folders with an __init__.py). Sorted."""
    folder, _, pattern = cfg["test_glob"].rpartition("/")
    start = os.path.join(cwd, folder) if folder else cwd
    top = os.path.join(cwd, cfg["unittest_top"])
    mods = []

    def walk(d):
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if os.path.isfile(p) and name.endswith(".py") and fnmatch.fnmatchcase(name, pattern):
                mods.append(os.path.relpath(p, top)[:-3].replace(os.sep, "."))
            elif os.path.isdir(p) and os.path.isfile(os.path.join(p, "__init__.py")):
                walk(p)
    if os.path.isdir(start):
        walk(start)
    return sorted(mods)


def module_rel(cfg, module):
    """The cwd-relative posix path of a test module's file."""
    return _norm(os.path.join(cfg["unittest_top"], *module.split("."))) + ".py"


def module_sizes(cwd, cfg, modules):
    out = {}
    for m in modules:
        try:
            out[m] = os.path.getsize(os.path.join(cwd, module_rel(cfg, m)))
        except OSError:
            out[m] = 1
    return out


_LIST_CODE = r'''
import json, sys, unittest
sys.path.insert(0, sys.argv[2])
m = __import__(sys.argv[1], fromlist=["x"])
if any(hasattr(m, n) for n in ("load_tests", "setUpModule", "tearDownModule")):
    print(json.dumps(None)); sys.exit(0)
counts = {}
def walk(s):
    for t in s:
        if isinstance(t, unittest.TestSuite):
            walk(t)
        else:
            c = type(t)
            if getattr(m, c.__name__, None) is not c:
                print(json.dumps(None)); sys.exit(0)
            counts[c.__name__] = counts.get(c.__name__, 0) + 1
walk(unittest.defaultTestLoader.loadTestsFromModule(m))
print(json.dumps(counts))
'''


def list_classes(cwd, cfg, module):
    """{TestCase class name: test count} for a module, or None when it must not be split (load_tests/setUpModule,
    an import failure, a class that cannot be named from the module, a single class)."""
    top = os.path.abspath(os.path.join(cwd, cfg["unittest_top"]))
    p = subprocess.run([sys.executable, "-B", "-c", _LIST_CODE, module, top], cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        return None
    try:
        res = json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None
    return res if res and len(res) > 1 else None


# ---------------------------------------------------------------- shard planning

def plan_shards(modules, jobs, timings, sizes, classes_fn=None):
    """Plan `jobs` shards. Returns a list of shards, each {"ids": [...], "planned": seconds}. Longest first, each
    onto the least-loaded shard; a module longer than total/(2*jobs) is split into its classes when classes_fn(module)
    gives them. timings: {"modules": {id: s}, "classes": {"module.Class": s}}; sizes: {module: bytes}.
    Costs are seconds when timed; a module with no recorded time costs its size at the rate of the timed ones (or
    just its size when nothing is timed, in which case planned values are relative, not seconds). Deterministic:
    ties break on the id."""
    tm = (timings or {}).get("modules", {})
    tc = (timings or {}).get("classes", {})
    known = [m for m in modules if m in tm]
    ksize = sum(sizes.get(m, 1) for m in known)
    rate = (sum(tm[m] for m in known) / ksize) if known and ksize else None
    cost = {}
    for m in modules:
        if m in tm:
            cost[m] = float(tm[m])
        elif rate is not None:
            cost[m] = sizes.get(m, 1) * rate
        else:
            cost[m] = float(sizes.get(m, 1))
    total = sum(cost.values())
    limit = total / (2 * jobs) if jobs > 0 else total
    units = []
    for m in modules:
        parts = None
        if cost[m] > limit and classes_fn is not None:
            classes = classes_fn(m)
            if classes:
                n = sum(classes.values()) or 1
                recorded = {c: tc.get("%s.%s" % (m, c)) for c in classes}
                if all(v is not None for v in recorded.values()):
                    parts = [("%s.%s" % (m, c), float(recorded[c])) for c in classes]
                else:
                    parts = [("%s.%s" % (m, c), cost[m] * k / n) for c, k in classes.items()]
        if parts:
            units.extend(parts)
        else:
            units.append((m, cost[m]))
    units.sort(key=lambda u: (-u[1], u[0]))
    shards = [{"ids": [], "planned": 0.0} for _ in range(max(1, min(jobs, len(units))))]
    for uid, c in units:
        s = min(shards, key=lambda x: x["planned"])
        s["ids"].append(uid)
        s["planned"] += c
    return [s for s in shards if s["ids"]]


def describe_plan(shards, timed):
    unit = "s" if timed else " (relative, no recorded timings)"
    lines = []
    for i, s in enumerate(shards, 1):
        ids = s["ids"]
        short = ", ".join(ids[:6])
        more = "" if len(ids) <= 6 else ", ... +%d more" % (len(ids) - 6)
        lines.append("  shard %d: planned %.0f%s, %d unit%s: %s%s" % (
            i, s["planned"], unit, len(ids), "" if len(ids) == 1 else "s", short, more))
    return lines


# ---------------------------------------------------------------- the worker (one shard process)

# Started with -c, not as a script, so sys.path[0] is the shard's cwd exactly as with `python -m unittest`; the
# top-level folder goes first, as with discover's -t.
WORKER_CODE = ("import importlib.util as u, sys; sys.path.insert(0, %r); "
               "s = u.spec_from_file_location('test_stamp_python_plugin', %r); m = u.module_from_spec(s); "
               "s.loader.exec_module(m); sys.exit(m.worker(sys.argv[1:]))")


def worker(argv):
    """worker OUT.json ID...: what `python3 -B -m unittest ID...` does, plus per-module and per-class seconds
    written to OUT.json. The time between one test's end and the next test's end counts to the next test's class,
    so setUpClass is included. Behaviour of the tests is not changed."""
    import unittest
    out, ids = argv[0], argv[1:]
    state = {}

    class TimedResult(unittest.TextTestResult):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.mods, self.classes = {}, {}
            self._last = time.monotonic()

        def stopTest(self, test):
            super().stopTest(test)
            now = time.monotonic()
            dt, self._last = now - self._last, now
            c = type(test)
            self.mods[c.__module__] = self.mods.get(c.__module__, 0.0) + dt
            k = "%s.%s" % (c.__module__, c.__name__)
            self.classes[k] = self.classes.get(k, 0.0) + dt
            state["result"] = self

    class Runner(unittest.TextTestRunner):
        resultclass = TimedResult

    prog = unittest.main(module=None, argv=["python -m unittest"] + ids, testRunner=Runner, exit=False)
    res = state.get("result")
    if res is not None:
        try:
            _atomic_write_json(out, {"modules": res.mods, "classes": res.classes})
        except OSError:
            pass
    return 0 if prog.result.wasSuccessful() else 1


# ---------------------------------------------------------------- running shards

def parse_log(text):
    """From a shard's output: ran, status (OK/FAILED), skipped, failing ids (FAIL/ERROR header lines)."""
    ran = None
    status = None
    skipped = 0
    bad = []
    for line in text.splitlines():
        m = RAN_RE.match(line)
        if m:
            ran = (ran or 0) + int(m.group(1))
            continue
        m = RESULT_RE.match(line)
        if m:
            status = m.group(1)
            sk = re.search(r"skipped=(\d+)", m.group(2) or "")
            if sk:
                skipped += int(sk.group(1))
            continue
        m = HEADER_RE.match(line)
        if m:
            bad.append("%s %s" % (m.group(1), m.group(2)))
    return {"ran": ran, "status": status, "skipped": skipped, "bad": bad}


def run_shards(cwd, top, shards, log_dir, env=None, say=print):
    """Start every shard, wait for all. Returns (results, wall). Each result: ids, planned, rc, wall, log,
    timings, plus parse_log's fields."""
    os.makedirs(log_dir, exist_ok=True)
    t0 = time.monotonic()
    procs = []
    worker_code = WORKER_CODE % (os.path.abspath(top), os.path.abspath(__file__))
    with ExitStack() as resources:
        for i, s in enumerate(shards, 1):
            scratch = resources.enter_context(tempfile.TemporaryDirectory(prefix="test-stamp-shard-"))
            shard_env = dict(os.environ if env is None else env)
            shard_env.update(dict.fromkeys(("TMPDIR", "TMP", "TEMP"), os.path.realpath(scratch)))
            log = os.path.join(log_dir, "shard-%d.log" % i)
            tfile = os.path.join(log_dir, "shard-%d.timings.json" % i)
            f = resources.enter_context(open(log, "w", encoding="utf-8"))
            p = subprocess.Popen([sys.executable, "-B", "-c", worker_code, tfile] + s["ids"],
                                 cwd=cwd, env=shard_env, stdout=f, stderr=subprocess.STDOUT)
            # LIFO cleanup waits for this worker before closing its log and removing its scratch, even if a
            # later spawn or the progress callback raises. Logs and timings live outside the owned scratch.
            resources.callback(_stop_worker, p)
            procs.append({"i": i, "p": p, "f": f, "log": log, "timings": tfile, "ids": s["ids"],
                          "planned": s["planned"], "t0": time.monotonic()})
        pending = list(procs)
        while pending:
            for x in list(pending):
                rc = x["p"].poll()
                if rc is not None:
                    x["f"].close()
                    x["rc"] = rc
                    x["wall"] = time.monotonic() - x["t0"]
                    pending.remove(x)
                    say("  shard %d finished in %.0fs (exit %d)" % (x["i"], x["wall"], rc))
            if pending:
                time.sleep(0.25)
    wall = time.monotonic() - t0
    results = []
    for x in procs:
        with open(x["log"], encoding="utf-8", errors="replace") as f:
            r = parse_log(f.read())
        r.update(ids=x["ids"], planned=x["planned"], rc=x["rc"], wall=x["wall"], log=x["log"], timings=x["timings"])
        results.append(r)
    return results, wall


def _stop_worker(p):
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()


def merge_timings(rdir, results):
    """Fold the shards' recorded seconds into timings.json. A unit that ran replaces its old figure; a module run
    in whole is its own time, a module split across shards is the sum of its classes' times."""
    path = os.path.join(rdir, "timings.json")
    cur = _read_json(path, {}) or {}
    mods, classes = cur.get("modules", {}), cur.get("classes", {})
    summed, seen = {}, False
    for r in results:
        data = _read_json(r["timings"], None)
        if not data:
            continue
        seen = True
        for k, v in data.get("modules", {}).items():
            summed[k] = summed.get(k, 0.0) + v
        for k, v in data.get("classes", {}).items():
            classes[k] = round(v, 3)
    for k, v in summed.items():
        mods[k] = round(v, 3)
    if seen:
        _atomic_write_json(path, {"modules": mods, "classes": classes,
                                  "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z")})


def summarise(results, wall, log_dir, say=print):
    """Print the one summary. Returns (ok, ran, skipped)."""
    ok = True
    ran = 0
    skipped = 0
    bad = []
    for i, r in enumerate(results, 1):
        ran += r["ran"] or 0
        skipped += r["skipped"]
        if r["status"] == "FAILED":
            bad.extend(r["bad"])
        if r["ran"] is None:
            ok = False
            bad.append("SHARD %d CRASHED: no \"Ran N tests\" line (exit %d); see %s" % (i, r["rc"], r["log"]))
        elif r["status"] != "OK" or r["rc"] != 0:
            ok = False
            if r["status"] != "FAILED" or not r["bad"]:
                bad.append("SHARD %d: exit %d, result %s; see %s" % (i, r["rc"], r["status"], r["log"]))
    say("Ran %d tests in %d shard%s, %s%s, wall %.1fs" % (
        ran, len(results), "" if len(results) == 1 else "s", "OK" if ok else "FAILED",
        " (skipped=%d)" % skipped if skipped else "", wall))
    for b in bad:
        say("  " + b)
    say("logs: %s" % log_dir)
    return ok, ran, skipped


def run(cwd, cfg, modules, jobs, rdir, log_dir, env=None, say=print, dry_run=False, classes_fn=None):
    """Plan and run `modules`. Returns (ok, ran, skipped, wall) or None for a dry run."""
    timings = _read_json(os.path.join(rdir, "timings.json"), {}) or {}
    sizes = module_sizes(cwd, cfg, modules)
    if classes_fn is None:
        classes_fn = lambda m: list_classes(cwd, cfg, m)  # noqa: E731
    shards = plan_shards(modules, jobs, timings, sizes, classes_fn)
    timed = any(m in timings.get("modules", {}) for m in modules)
    say("plan: %d module%s in %d shard%s" % (len(modules), "" if len(modules) == 1 else "s",
                                             len(shards), "" if len(shards) == 1 else "s"))
    for line in describe_plan(shards, timed):
        say(line)
    if dry_run:
        return None
    results, wall = run_shards(cwd, os.path.join(cwd, cfg["unittest_top"]), shards, log_dir, env, say)
    try:
        merge_timings(rdir, results)
    except OSError as e:
        say("WARN could not record timings: %s" % e)
    ok, ran, skipped = summarise(results, wall, log_dir, say)
    return ok, ran, skipped, wall


# ---------------------------------------------------------------- affected

class Graph:
    """The local import graph of every .py under the roots, found with ast. Paths are cwd-relative posix paths."""

    def __init__(self, cwd, roots):
        self.cwd = cwd
        self.roots = [r for r in roots if r != "."]
        self.files = {}      # cwd-relative posix path -> abs path
        for root in roots:
            for dirpath, dirs, fns in os.walk(os.path.join(cwd, root)):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
                for fn in fns:
                    if fn.endswith(".py"):
                        ab = os.path.join(dirpath, fn)
                        self.files[os.path.relpath(ab, cwd).replace(os.sep, "/")] = ab
        self.by_stem = {}
        for rel in self.files:
            self.by_stem.setdefault(os.path.basename(rel)[:-3], []).append(rel)
        self.by_base = {}
        for rel in self.files:
            if os.path.basename(rel) != "__init__.py":
                self.by_base.setdefault(os.path.basename(rel), []).append(rel)
        self._deps = {}

    def _module_files(self, dotted):
        """The files `import dotted` could load: the package __init__ files on the way, then the module (or
        package), looked up from the working folder and from each root. When the dotted path is not found, fall
        back to files of that last name anywhere (a test that puts a folder on sys.path and imports `helper`)."""
        parts = dotted.split(".")
        found = []
        exact = False
        for prefix in [""] + [r + "/" for r in self.roots]:
            for i in range(1, len(parts) + 1):
                base = prefix + "/".join(parts[:i])
                for f in (base + "/__init__.py", base + ".py"):
                    if f in self.files:
                        found.append(f)
                        exact = True
        if not exact:
            found.extend(self.by_stem.get(parts[-1], []))
        return found

    def deps(self, rel):
        """Direct dependencies (cwd-relative paths) of one file."""
        if rel in self._deps:
            return self._deps[rel]
        out = set()
        self._deps[rel] = out
        try:
            with open(self.files[rel], encoding="utf-8") as f:
                tree = ast.parse(f.read())
        except (OSError, SyntaxError, ValueError):
            return out
        pkg = os.path.dirname(rel).replace("/", ".")
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    out.update(self._module_files(a.name))
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    base = pkg.split(".") if pkg else []
                    base = base[:len(base) - (node.level - 1)] if node.level > 1 else base
                    mod = ".".join(base + ([node.module] if node.module else []))
                else:
                    mod = node.module or ""
                if mod:
                    out.update(self._module_files(mod))
                for a in node.names:
                    sub = (mod + "." if mod else "") + a.name
                    if a.name != "*":
                        out.update(f for f in self._module_files(sub) if f.endswith("/" + a.name + ".py")
                                   or f.endswith("/" + a.name + "/__init__.py") or f == a.name + ".py")
            elif isinstance(node, ast.Call):
                fn = node.func
                name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
                if name in ("import_module", "__import__") and node.args \
                        and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    out.update(self._module_files(node.args[0].value))
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                v = node.value
                if len(v) > 300 or "\n" in v:
                    continue
                if v.endswith(".py") and os.path.basename(v) != "__init__.py":
                    out.update(r for r in self.by_base.get(os.path.basename(v), [])
                               if r == v or r.endswith("/" + v) or "/" not in v)
                elif "." in v and re.fullmatch(r"[A-Za-z_][\w]*(\.[A-Za-z_]\w*)+", v):
                    path = v.replace(".", "/")
                    out.update(f for f in (path + ".py", path + "/__init__.py") if f in self.files)
        out.discard(rel)
        return out

    def closure(self, rel):
        seen, todo = {rel}, [rel]
        # importing tests.test_x imports the tests package first
        for init in self._module_files(rel[:-3].replace("/", ".")):
            if init not in seen:
                seen.add(init)
                todo.append(init)
        while todo:
            cur = todo.pop()
            for d in self.deps(cur):
                if d not in seen:
                    seen.add(d)
                    todo.append(d)
        return seen


def select_affected(cwd, cwd_rel, cfg, changed, is_t0, modules):
    """Which test modules a change set affects. Returns (kind, modules, notes):
    kind "none" (T0 only), "some" (the modules chosen) or "full" (fall back; notes[0] says why)."""
    graph = Graph(cwd, cfg["roots"])
    closures = None
    chosen, notes, t0 = set(), [], []
    prefix = "" if cwd_rel in ("", ".") else cwd_rel.rstrip("/") + "/"
    roots = cfg["roots"]
    for path in sorted(set(changed)):
        if is_t0(path):
            t0.append(path)
            continue
        if not path.startswith(prefix):
            return "full", [], ["%s is outside the test folder %s and outside the T0 paths" % (path, cwd_rel)]
        rel = path[len(prefix):]
        if not any(r == "." or rel.startswith(r + "/") for r in roots):
            return "full", [], ["%s is outside the T0 paths and outside the python roots (%s)" % (path, ", ".join(roots))]
        if not rel.endswith(".py"):
            return "full", [], ["%s is not a .py file (a fixture, page or script the tests may read)" % path]
        if rel not in graph.files:
            return "full", [], ["%s no longer exists, so its dependants cannot be found" % path]
        if closures is None:
            closures = {m: graph.closure(module_rel(cfg, m)) for m in modules}
        hit = sorted(m for m, c in closures.items() if rel in c)
        if not hit:
            return "full", [], ["%s is in no test module's import closure" % path]
        chosen.update(hit)
        notes.append("%s -> %d module%s" % (path, len(hit), "" if len(hit) == 1 else "s"))
    if not chosen:
        return "none", [], ["T0 only: " + ", ".join(t0)] if t0 else ["nothing changed"]
    return "some", sorted(chosen), notes
