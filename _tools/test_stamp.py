#!/usr/bin/env python3
"""test_stamp.py -- the way to run a project's tests: only the affected ones while building, the whole suite once at
the end, and a stamp so a reviewer does not run it again. Vendored into a project's `_tools/` by project-scaffolding;
the project's own settings say what "the tests" are.

Usage (from anywhere; the project root is the parent of this file's folder unless --root is given)
  test_stamp.py --affected [BASE]  T1. The tests affected by what changed in BASE...HEAD plus uncommitted changes, for
                                   languages that have an affected-test plug-in (python today). Prints its choice,
                                   then runs it. For any other language it says so and runs the full suite instead.
                                   BASE defaults to the record's `base_branch`, else main, else master.
  test_stamp.py --full [--jobs N] [--force]
                                   T2. The whole suite, once, at the end of a story. On a tree that already has a
                                   passing stamp it prints the stamp and exits 0 without running, unless --force.
  test_stamp.py --status           Print the stamp that matches this tree, or `none` (exit 1).
  --variant NAME                   Run (or look up) a named variant of the suite: its extra environment, and its own
                                   stamp. Variants are declared in the settings, e.g. one with ACM_SITE=1 that makes
                                   the suite also exercise a live site; the stamp for it is separate.
  --command CMD                    Use CMD instead of the settings' test command.
  --dry-run (with --full or --affected)   print the plan and run nothing.

Settings: the "tests" block of <project>/.claude/scaffolding.json
  {"tests": {"command": "python3 -B -m unittest discover -s tests",   # run once for --full (through the shell)
             "cwd": ".",                                              # where it runs, relative to the project root
             "language": "python",                                    # picks the affected-test plug-in; free text else
             "t0_paths": ["docs/", "*.md", "backlog/"],               # docs-only paths: they run nothing, and a
                                                                      # change to them keeps a stamp
             "python": {"roots": ["tools", "tests"],                  # the python plug-in's settings
                        "test_glob": "tests/test_*.py", "unittest_top": "."},
             "variants": {"site": {"env": {"ACM_SITE": "1"}}},        # --variant site
             "jobs": 1}}                                              # default for --jobs
  Only `command` is needed. With no "tests" block the command falls back to `inbox.test` from the same record. With
  neither (and no --command) the run stops with exit 2 and says what to add.
  A t0_paths entry ending in "/" matches that folder from the project root, an entry with * ? [ matches the whole
  path as a glob (* also crosses folders, so "*.md" is every markdown file), anything else is one exact path.

Stamp
  A passing --full on a clean tree writes stamp-<key>-<variant>.json in <shared checkout>/.claude/test-runs/: the
  key, the real tree hash (HEAD^{tree}) and HEAD for information, time, Ran count (python only), wall seconds, the
  variant, the Python version. The key is the sha256 of `git ls-tree -r HEAD` without the docs-only (T0) paths, so a
  result block or doc edit committed after the run keeps the stamp, and any other change loses it. "Clean" ignores
  git-ignored files and uncommitted T0 files; any other uncommitted file means no stamp is recorded or reused. The
  shared checkout is found from `git rev-parse --git-common-dir`, so every worktree reads the same stamps. They are
  never committed (.claude/ should be git-ignored). $TEST_STAMP_DIR overrides the folder (the tests use it).

Running
  A command that is not run by the python plug-in runs once, through the shell, in `cwd`, with the variant's
  environment added; its output goes to the console and to a log in <test-runs>/logs/, and its exit status is the
  result. The python plug-in (affected/python.py next to this file) runs the tests in shards when the language is
  python, no --command is given and the command mentions unittest: per-module timings from the last run plan the
  shards (--jobs N parallel processes); see that file. Any other python command (pytest, say) runs once as above.

Exit codes
  0  tests passed (or reused a stamp, or nothing was affected, or --status found a stamp)
  1  the tests failed, errored or crashed; or --status found none
  2  bad usage, missing settings, or git failed

Standard library only."""
import argparse
import fnmatch
import hashlib
import importlib.util
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time

VERSION = "1.0.0"

sys.dont_write_bytecode = True
TOOLS = os.path.dirname(os.path.abspath(__file__))
DEFAULT_JOBS = 1
BASE_CANDIDATES = ("main", "master")
KEEP_LOG_FOLDERS = 6
DEFAULT_T0 = ["docs/", "*.md", "backlog/"]
UNSPECIFIED = "unspecified"


class RunError(Exception):
    pass


# ---------------------------------------------------------------- git and the shared folder

def _git(root, args):
    p = subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True)
    if p.returncode != 0:
        raise RunError("git %s failed: %s" % (" ".join(args), (p.stderr or p.stdout).strip()[:300]))
    return p.stdout


def tree_hash(root):
    return _git(root, ["rev-parse", "HEAD^{tree}"]).strip()


def head_commit(root):
    return _git(root, ["rev-parse", "HEAD"]).strip()


def dirty_lines(root):
    """Uncommitted changes, git-ignored files left out: (status code, path) pairs, renames giving both paths."""
    out = _git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])
    parts = out.split("\0")
    res, i = [], 0
    while i < len(parts):
        e = parts[i]
        i += 1
        if len(e) < 4:
            continue
        code, path = e[:2], e[3:]
        res.append((code, path))
        if "R" in code or "C" in code:
            if i < len(parts) and parts[i]:
                res.append((code, parts[i]))
            i += 1
    return res


def dirty_code_lines(root, is_t0):
    """dirty_lines without the docs-only (T0) paths: what blocks recording or reusing a stamp."""
    return [(c, p) for c, p in dirty_lines(root) if not is_t0(p)]


def stamp_key(root, is_t0):
    """What a stamp is keyed on: sha256 of HEAD's tree without the docs-only (T0) paths: mode, type, object id and
    path of every other entry. A result block or doc edit committed after the run leaves it unchanged."""
    out = _git(root, ["ls-tree", "-r", "-z", "HEAD"])
    h = hashlib.sha256()
    for entry in out.split("\0"):
        if not entry:
            continue
        meta, _, path = entry.partition("\t")
        if is_t0(path):
            continue
        h.update(("%s\t%s\0" % (meta, path)).encode("utf-8", "surrogateescape"))
    return h.hexdigest()


def shared_checkout(root):
    common = _git(root, ["rev-parse", "--git-common-dir"]).strip()
    return os.path.dirname(os.path.normpath(os.path.join(root, common)))


def runs_dir(root):
    env = os.environ.get("TEST_STAMP_DIR")
    if env:
        return os.path.abspath(env)
    return os.path.join(shared_checkout(root), ".claude", "test-runs")


def ref_exists(root, ref):
    p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "--quiet", ref + "^{commit}"],
                       capture_output=True, text=True)
    return p.returncode == 0


def changed_files(root, base):
    """The paths that differ between base and HEAD: what HEAD's branch changed since it left base (three-dot)."""
    return [l for l in _git(root, ["diff", "--name-only", "%s...HEAD" % base]).splitlines() if l]


def changed_paths(root, base):
    paths = set(changed_files(root, base))
    for _code, p in dirty_lines(root):
        paths.add(p)
    return sorted(paths)


def resolve_base(root, requested, record_base):
    """BASE for --affected: the one asked for, else the record's base branch, else main, else master."""
    if requested:
        return requested
    for cand in ([record_base] if record_base else []) + list(BASE_CANDIDATES):
        if ref_exists(root, cand):
            return cand
    raise RunError("no base branch found (tried %s); pass one: --affected BASE"
                   % ", ".join(([record_base] if record_base else []) + list(BASE_CANDIDATES)))


# ---------------------------------------------------------------- files

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


def _prune_logs(log_root):
    try:
        names = sorted(n for n in os.listdir(log_root) if os.path.isdir(os.path.join(log_root, n)))
    except OSError:
        return
    for n in names[:-KEEP_LOG_FOLDERS]:
        d = os.path.join(log_root, n)
        for fn in os.listdir(d):
            try:
                os.unlink(os.path.join(d, fn))
            except OSError:
                pass
        try:
            os.rmdir(d)
        except OSError:
            pass


# ---------------------------------------------------------------- settings

class Settings:
    """What to run, read from <root>/.claude/scaffolding.json (plus --command)."""

    def __init__(self, root, command, cwd_rel, language, t0, python, variants, jobs, base_branch):
        self.root, self.command, self.cwd_rel, self.language = root, command, cwd_rel, language
        self.t0_patterns, self.python, self.variants, self.jobs = t0, python, variants, jobs
        self.base_branch = base_branch
        self.cwd = os.path.normpath(os.path.join(root, cwd_rel))

    def is_t0(self, path):
        for pat in self.t0_patterns:
            if pat.endswith("/"):
                if path.startswith(pat):
                    return True
            elif any(c in pat for c in "*?["):
                if fnmatch.fnmatchcase(path, pat):
                    return True
            elif path == pat:
                return True
        return False


def load_settings(root, command_override=None):
    path = os.path.join(root, ".claude", "scaffolding.json")
    record = None
    if os.path.isfile(path):
        record = _read_json(path, None)
        if not isinstance(record, dict):
            raise RunError("%s is not a JSON object" % path)
    record = record or {}
    tests = record.get("tests")
    if tests is not None and not isinstance(tests, dict):
        raise RunError('"tests" in %s must be an object' % path)
    tests = tests or {}
    inbox = record.get("inbox") if isinstance(record.get("inbox"), dict) else {}
    command = command_override or tests.get("command") or inbox.get("test")
    if not command or not isinstance(command, str):
        raise RunError(
            'no test command: add a "tests" block to %s, e.g. {"tests": {"command": "python3 -B -m unittest discover '
            '-s tests"}}, or set "inbox.test", or pass --command' % path)
    cwd_rel = tests.get("cwd", ".")
    t0 = tests.get("t0_paths", DEFAULT_T0)
    variants = tests.get("variants", {})
    jobs = tests.get("jobs", DEFAULT_JOBS)
    if not isinstance(cwd_rel, str) or os.path.isabs(cwd_rel) or ".." in cwd_rel.split("/"):
        raise RunError('"tests.cwd" must be a folder inside the project, relative to its root')
    if not (isinstance(t0, list) and all(isinstance(p, str) for p in t0)):
        raise RunError('"tests.t0_paths" must be a list of strings')
    if not isinstance(variants, dict) or not all(isinstance(v, dict) and isinstance(v.get("env", {}), dict)
                                                 for v in variants.values()):
        raise RunError('"tests.variants" must map a name to {"env": {...}}')
    if not isinstance(jobs, int) or isinstance(jobs, bool) or jobs < 1:
        raise RunError('"tests.jobs" must be a whole number of at least 1')
    language = tests.get("language") or UNSPECIFIED
    python = tests.get("python")
    base = record.get("base_branch") if isinstance(record.get("base_branch"), str) else None
    return Settings(root, command, cwd_rel.rstrip("/") or ".", str(language), t0, python, variants, jobs, base)


def variant_env(st, name):
    """(stamp suffix, extra environment) for --variant NAME."""
    if not name:
        return "default", {}
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise RunError("--variant %r: use letters, digits, - _ . only" % name)
    if name not in st.variants:
        known = ", ".join(sorted(st.variants)) or "none declared"
        raise RunError('--variant %s is not in "tests.variants" (%s)' % (name, known))
    env = st.variants[name].get("env", {})
    return name, {str(k): str(v) for k, v in env.items()}


# ---------------------------------------------------------------- plug-ins

def load_plugin(language):
    """The affected-test plug-in for `language` (affected/<language>.py next to this file), or None."""
    if not re.fullmatch(r"[a-z][a-z0-9_]*", language or ""):
        return None
    path = os.path.join(TOOLS, "affected", language + ".py")
    if not os.path.isfile(path):
        return None
    spec = importlib.util.spec_from_file_location("test_stamp_affected_" + language, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def plugin_for_run(st, command_overridden):
    """(plug-in, its settings) when the sharded runner drives this suite, else (None, None)."""
    if st.language != "python" or command_overridden or "unittest" not in st.command:
        return None, None
    plugin = load_plugin("python")
    if plugin is None:
        return None, None
    try:
        return plugin, plugin.settings(st.python)
    except ValueError as e:
        raise RunError("tests.%s" % e)


# ---------------------------------------------------------------- stamps

def stamp_path(rdir, key, variant):
    return os.path.join(rdir, "stamp-%s-%s.json" % (key, variant))


def find_stamp(rdir, key, variant):
    return _read_json(stamp_path(rdir, key, variant), None)


def format_stamp(s):
    ran = "%d tests Ran" % s["ran"] if s.get("ran") is not None else "tests passed"
    return "stamp: key %s (tree %s, HEAD %s), %s, wall %.0fs, %s, variant %s, Python %s" % (
        s["key"][:12], s["tree"][:12], s["head"][:8], ran, s["wall"], s["time"], s["variant"], s["python"])


def record_stamp(rdir, root, key, variant, ran, wall, skipped=0):
    s = {"key": key, "tree": tree_hash(root), "head": head_commit(root), "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
         "ran": ran, "skipped": skipped, "wall": round(wall, 1), "variant": variant, "python": platform.python_version()}
    _atomic_write_json(stamp_path(rdir, key, variant), s)
    return s


# ---------------------------------------------------------------- running

def new_log_dir(rdir):
    log_root = os.path.join(rdir, "logs")
    os.makedirs(log_root, exist_ok=True)
    d = tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=log_root)
    _prune_logs(log_root)
    return d


def run_command(st, command, env_extra, rdir, say=print, dry_run=False):
    """Run the test command once, through the shell, in the settings' cwd. Returns (ok, ran, skipped, wall) or None
    for a dry run. Output goes to `say` and to a log file."""
    say("command: %s (in %s)" % (command, st.cwd_rel))
    if dry_run:
        return None
    env = dict(os.environ)
    env.update(env_extra)
    log_dir = new_log_dir(rdir)
    log = os.path.join(log_dir, "command.log")
    t0 = time.monotonic()
    with open(log, "w", encoding="utf-8") as f:
        p = subprocess.Popen(command, shell=True, cwd=st.cwd, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, errors="replace")
        try:
            for line in p.stdout:
                f.write(line)
                say(line.rstrip("\n"))
        except BaseException:
            p.kill()
            raise
        finally:
            p.stdout.close()
            rc = p.wait()
    wall = time.monotonic() - t0
    say("%s (exit %d), wall %.1fs" % ("OK" if rc == 0 else "FAILED", rc, wall))
    say("logs: %s" % log_dir)
    return rc == 0, None, 0, wall


def run_suite(st, args, modules, rdir, say, classes_fn=None):
    """Run `modules` (None for the whole suite) the way the settings say. Returns (ok, ran, skipped, wall) or None."""
    _suffix, env_extra = variant_env(st, args.variant)
    plugin, pcfg = plugin_for_run(st, bool(args.command))
    if plugin is None:
        return run_command(st, st.command, env_extra, rdir, say, args.dry_run)
    env = dict(os.environ)
    env.update(env_extra)
    if modules is None:
        modules = plugin.discover_modules(st.cwd, pcfg)
        if not modules:
            raise RunError("no test modules found by test_glob %r under %s" % (pcfg["test_glob"], st.cwd))
    say("running %d module%s, jobs %d" % (len(modules), "" if len(modules) == 1 else "s", args.jobs))
    log_dir = os.path.join(rdir, "logs", "dry-run") if args.dry_run else new_log_dir(rdir)
    kw = {"classes_fn": classes_fn} if classes_fn else {}
    return plugin.run(st.cwd, pcfg, modules, args.jobs, rdir, log_dir, env, say, args.dry_run, **kw)


# ---------------------------------------------------------------- commands

def _context(args):
    root = os.path.abspath(args.root) if args.root else os.path.dirname(TOOLS)
    st = load_settings(root, args.command)
    suffix, _env = variant_env(st, args.variant)
    return root, st, suffix


def cmd_status(args, say=print):
    root, st, variant = _context(args)
    rdir = runs_dir(root)
    if dirty_code_lines(root, st.is_t0):
        say("none (the working tree has uncommitted changes, so no stamp applies)")
        return 1
    s = find_stamp(rdir, stamp_key(root, st.is_t0), variant)
    if not s:
        say("none (no passing --full run is stamped for this tree, variant %s)" % variant)
        return 1
    say(format_stamp(s))
    return 0


def cmd_full(args, say=print, classes_fn=None):
    root, st, variant = _context(args)
    rdir = runs_dir(root)
    clean = not dirty_code_lines(root, st.is_t0)
    key = stamp_key(root, st.is_t0)
    if clean and not args.force:
        s = find_stamp(rdir, key, variant)
        if s:
            say("this tree already passed the full suite; not running it again (--force to run anyway)")
            say(format_stamp(s))
            return 0
    if not clean:
        say("working tree has uncommitted changes: no stamp will be recorded or reused")
    say("full suite%s" % ("" if variant == "default" else " (variant %s)" % variant))
    res = run_suite(st, args, None, rdir, say, classes_fn)
    if res is None:
        return 0
    ok, ran, skipped, wall = res
    if ok and clean and not dirty_code_lines(root, st.is_t0):
        s = record_stamp(rdir, root, key, variant, ran, wall, skipped)
        say("recorded " + format_stamp(s))
    elif ok:
        say("passed, but no stamp recorded: the working tree is dirty" if not clean
            else "passed, but no stamp recorded: the run left uncommitted changes in the working tree")
    return 0 if ok else 1


def cmd_affected(args, say=print, classes_fn=None):
    root, st, _variant = _context(args)
    rdir = runs_dir(root)
    plugin = load_plugin(st.language)
    if plugin is None or args.command:
        why = "--command overrides the settings' command" if plugin is not None else \
            "no affected-test plug-in for %s" % st.language
        say("%s; running the full suite" % why)
        args.force = False
        return cmd_full(args, say, classes_fn)
    plugin, pcfg = plugin_for_run(st, False)
    if plugin is None:
        say("the python affected-test plug-in drives unittest only and the test command does not use it; "
            "running the full suite")
        args.force = False
        return cmd_full(args, say, classes_fn)
    base = resolve_base(root, args.affected if args.affected != "" else None, st.base_branch)
    modules = plugin.discover_modules(st.cwd, pcfg)
    changed = changed_paths(root, base)
    kind, chosen, notes = plugin.select_affected(st.cwd, st.cwd_rel, pcfg, changed, st.is_t0, modules)
    if kind == "none":
        say("no tests affected (%s)" % notes[0])
        return 0
    if kind == "full":
        say("falling back to the full suite: %s" % notes[0])
        args.force = False
        return cmd_full(args, say, classes_fn)
    say("affected: %d of %d test modules (changes: %d file%s, base %s)" % (
        len(chosen), len(modules), len(changed), "" if len(changed) == 1 else "s", base))
    for n in notes:
        say("  " + n)
    say("modules: " + ", ".join(chosen))
    res = run_suite(st, args, chosen, rdir, say, classes_fn)
    if res is None:
        return 0
    return 0 if res[0] else 1


def build_parser():
    ap = argparse.ArgumentParser(description="Run the project's tests: affected ones, or the whole suite once with a "
                                 "stamp. Settings: the \"tests\" block of .claude/scaffolding.json.")
    ap.add_argument("--version", action="version", version="test_stamp.py " + VERSION)
    ap.add_argument("--root", help="project root (default: the parent of this file's folder)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--affected", nargs="?", const="", metavar="BASE",
                   help="run the tests affected by BASE...HEAD plus uncommitted changes (BASE default: the record's "
                        "base_branch, else main, else master)")
    g.add_argument("--full", action="store_true", help="run the whole suite once and stamp a pass")
    g.add_argument("--status", action="store_true", help="print the stamp for this tree, or none (exit 1)")
    ap.add_argument("--variant", metavar="NAME", help="a variant from tests.variants: its env, and its own stamp")
    ap.add_argument("--command", help="test command, instead of the settings' one")
    ap.add_argument("--jobs", type=int, default=None, help="parallel shards, python only (default: tests.jobs, else %d)"
                    % DEFAULT_JOBS)
    ap.add_argument("--force", action="store_true", help="run --full even when this tree has a stamp")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and run nothing")
    return ap


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    args = build_parser().parse_args(argv)
    if args.jobs is not None and args.jobs < 1:
        print("ERR --jobs must be at least 1", file=sys.stderr)
        return 2
    try:
        if args.jobs is None:
            root = os.path.abspath(args.root) if args.root else os.path.dirname(TOOLS)
            args.jobs = load_settings(root, args.command).jobs
        if args.status:
            return cmd_status(args)
        if args.full:
            return cmd_full(args)
        return cmd_affected(args)
    except (RunError, RuntimeError) as e:
        print("ERR %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
