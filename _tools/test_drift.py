#!/usr/bin/env python3
"""test_drift.py: scan a project's tests for known "test drift" patterns listed in _dev/test-drift.md.

  test_drift.py [--root DIR] [--list FILE] [--paths GLOB]... [--old VALUE]... [--diff BASE] [--json] [--stale DAYS]
  test_drift.py --init | --add "<name> | <concept> | <kind> | <arg>"

The list holds one drift per line: `- <name> | <concept> | <kind> | <arg>`; other lines are ignored. Kinds: clock-mix,
stale-pin, orphan-selector, contract-callers, regex. Output: `<drift> | <path>:<line> | <evidence>` per hit, then a summary.
Exit 0 no hits, 1 hits, 2 usage error or missing list. Never deletes anything. Standard library only.
"""
import argparse, fnmatch, json, os, re, subprocess, sys

VERSION = "1.1.0"
KINDS = ("clock-mix", "stale-pin", "orphan-selector", "contract-callers", "regex")      # the kit's; extensions add more (see `check` below)
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SKIP_DIRS = {"node_modules", ".git", "build", "target", "dist", "_tools", ".claude"}
MAX_BYTES = 2_000_000      # larger files are generated or data, not tests or sources
MAX_CONCEPT = 160          # one plain sentence; a longer concept is discovery history (chosen by the list's owner spec)
SOURCE_EXT = {".html", ".css", ".scss", ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".java", ".kt", ".py"}
DEFAULT_LIST = os.path.join("_dev", "test-drift.md")
SEED = """# Known test drift

Each line below names one way tests drift away from the code they check, so `_tools/test_drift.py` can find it before it
fails a suite. One drift per line: `- name | one-line concept in plain words | kind | arg`. Kinds: clock-mix, stale-pin,
orphan-selector, contract-callers, regex (arg is a Python regex run over test-file lines). Other lines are ignored.
Add a new drift with `_tools/test_drift.py --add "name | concept | kind | arg"`.

- clock-mix | A test pins a calendar date but the code under test compares it with today's date. | clock-mix | 
- stale-pin | A test still holds a value (version, hash, id) that the change replaced. | stale-pin | 
- orphan-selector | A test looks for a CSS class or test id that no template or style defines any more. | orphan-selector | 
- contract-callers | A changed public signature or contract whose callers' tests were not updated. | contract-callers | 
"""


class Usage(Exception):
    pass


# ---------------------------------------------------------------- the list
def parse_drift(text, extra=()):
    """(name, concept, kind, arg) from the text after "- ", or raise ValueError with the reason."""
    parts = [p.strip() for p in text.split("|", 3)]
    if len(parts) < 3:
        raise ValueError("needs name | concept | kind | arg")
    name, concept, kind = parts[:3]
    arg = parts[3] if len(parts) > 3 else ""
    if not NAME_RE.match(name):
        raise ValueError("name must be kebab-case")
    if not concept:
        raise ValueError("concept is empty")
    if kind not in KINDS and kind not in extra:
        raise ValueError("unknown kind " + repr(kind))
    if kind == "regex":
        try:
            re.compile(arg)
        except re.error as e:
            raise ValueError("bad regex: %s" % e)
        if not arg:
            raise ValueError("regex kind needs an arg")
    return name, concept, kind, arg


def read_list(path, extra=()):
    """([drift dicts], [(line no, reason)]); a malformed line is skipped, never fatal."""
    drifts, errors, seen = [], [], set()
    with open(path, encoding="utf-8", errors="replace") as f:
        for no, line in enumerate(f, 1):
            if not line.startswith("- "):
                continue
            try:
                name, concept, kind, arg = parse_drift(line[2:].rstrip("\n"), extra)
                if name in seen:
                    raise ValueError("duplicate name " + name)
            except ValueError as e:
                errors.append((no, str(e)))
                continue
            seen.add(name)
            drifts.append({"name": name, "concept": concept, "kind": kind, "arg": arg})
    return drifts, errors


# ---------------------------------------------------------------- files
def git(root, *args):
    r = subprocess.run(["git", "-C", root, *args], stdin=subprocess.DEVNULL, capture_output=True, text=True, errors="replace")
    return r.returncode, r.stdout, r.stderr


def is_test_path(rel):
    p = "/" + rel.replace(os.sep, "/")
    base = p.rsplit("/", 1)[-1]
    if any(s in p for s in ("/test/", "/tests/", "/e2e/", "/__tests__/")):
        return True
    return bool(re.search(r"\.(test|spec)\.[^/]+$|(Test|Tests)\.java$|^test_.*\.py$|_test\.py$|_test\.go$", base))


def list_files(root):
    """Relative posix paths of the project's files: tracked and untracked-not-ignored in a git repo, else a walk."""
    rc, out, _ = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    if rc == 0:
        rels = [r for r in out.split("\0") if r]
    else:
        rels = []
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            rels += [os.path.relpath(os.path.join(d, f), root) for f in files]
    keep = [r.replace(os.sep, "/") for r in rels]
    return sorted(r for r in keep if not (set(r.split("/")[:-1]) & SKIP_DIRS) and os.path.isfile(os.path.join(root, r)))


class Project:
    def __init__(self, root, paths):
        self.root, self.cache = root, {}
        files = list_files(root)
        self.tests = [f for f in files if is_test_path(f)]
        self.sources = [f for f in files if not is_test_path(f)]
        self.scanned = [f for f in self.tests if not paths or any(fnmatch.fnmatch(f, g) for g in paths)]

    def lines(self, rel):
        if rel not in self.cache:
            lines = []
            try:
                if os.path.getsize(os.path.join(self.root, rel)) <= MAX_BYTES:
                    with open(os.path.join(self.root, rel), "rb") as f:
                        data = f.read()
                    if b"\0" not in data[:1024]:
                        lines = data.decode("utf-8", "replace").splitlines()
            except OSError:
                pass
            self.cache[rel] = lines
        return self.cache[rel]

    def source_blob(self, exts=None):
        return "\n".join("\n".join(self.lines(f)) for f in self.sources if exts is None or os.path.splitext(f)[1] in exts)


def ev(text):
    text = " ".join(text.split())
    return text if len(text) <= 120 else text[:117] + "..."


def diff_removed(root, base):
    """{path: [removed lines]} and {path: [added lines]} for BASE..HEAD, paths relative to root."""
    rc, out, err = git(root, "diff", "--unified=0", "--relative", "--no-color", "--no-ext-diff", base, "HEAD", "--")
    if rc != 0:
        raise Usage("git diff %s HEAD failed: %s" % (base, err.strip()[:200]))
    rem, add, old, cur, hunk = {}, {}, None, None, False
    for l in out.splitlines():
        if l.startswith("diff --git"):
            hunk = False
        elif l.startswith("@@"):
            hunk = True
        elif hunk and l[:1] == "-":
            rem.setdefault(cur or old, []).append(l[1:])
        elif hunk and l[:1] == "+":
            add.setdefault(cur or old, []).append(l[1:])
        elif l.startswith("--- "):
            old = None if l[4:].strip() == "/dev/null" else l[4:].strip()[2:]
        elif l.startswith("+++ "):
            cur = None if l[4:].strip() == "/dev/null" else l[4:].strip()[2:]
    return rem, add


# ---------------------------------------------------------------- checkers: the `check` hook point (kit_ext.py, SCAF-72)
# The five kit checkers are default plugins (plugins/test_drift/<name>.py, ALWAYS_ON), each answering for its own kind. A
# project adds checkers (and kinds) as extensions, _tools/ext/test_drift/<name>.py listed in .claude/scaffolding.json
# extensions.test_drift; they only ADD: a name that is a kit kind is always answered by the kit's plugin, and a plugin that
# fails is skipped and reported on stderr. A drift whose kit plugin cannot run is a usage error (exit 2), never a clean scan.
#   def check(root, kind, project, arg, opts, helpers) -> [(path, line no, evidence)] | str (a usage error) | None (not mine)
#   def kinds(root) -> [kind names this extension adds]       (optional; the kit's five need none)
# helpers has ev, git, diff_removed, is_test_path, Usage and SOURCE_EXT. Without kit_ext.py beside this file the scan is refused.
_HERE = os.path.dirname(os.path.abspath(__file__))
_KE = []
_HOOKS = {}


def _kit_ext():
    """(kit_ext module, '') or (None, why): kit_ext.py beside this file, loaded by path."""
    if not _KE:
        path, mod, why = os.path.join(_HERE, "kit_ext.py"), None, "is missing"
        if os.path.isfile(path):
            try:
                import importlib.util
                spec = importlib.util.spec_from_file_location("kit_ext_for_test_drift", path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                for needed in ("HookPoint", "run"):
                    if not hasattr(mod, needed):
                        raise AttributeError("no %s" % needed)
                why = ""
            except (Exception, SystemExit) as e:
                mod, why = None, "could not be loaded (%s: %s)" % (type(e).__name__, " ".join(str(e).split()))
        _KE.append((mod, why))
    return _KE[0]


def _check_answer(answer):
    if answer is None or isinstance(answer, str):
        return None
    if isinstance(answer, (list, tuple)) and all(isinstance(h, (tuple, list)) and len(h) == 3 and isinstance(h[0], str)
                                                 and isinstance(h[1], int) and isinstance(h[2], str) for h in answer):
        return None
    return "not a list of (path, line, evidence), a string or None"


def _check_kinds(answer):
    return None if answer is None or (isinstance(answer, (list, tuple)) and all(isinstance(k, str) for k in answer)) else "not a list of strings"


def _hook(name):
    if name not in _HOOKS:
        ke, _ = _kit_ext()
        _HOOKS[name] = (ke.HookPoint("test_drift", "check", ("root", "kind", "project", "arg", "opts", "helpers"), _check_answer, "skip",
                                     doc="hits, a usage error string, or None") if name == "check" else
                        ke.HookPoint("test_drift", "kinds", ("root",), _check_kinds, "skip", doc="the kinds an extension adds"))
    return _HOOKS[name]


def _run(root, name, *args):
    """([(plugin, answer)], {plugin: failure message}, why kit_ext is unusable or ''). The kit's default plugins (beside this
    file) first, then the project's extensions. Never raises."""
    ke, why = _kit_ext()
    if ke is None:
        return [], {}, "kit_ext.py " + why
    out, failed, seen = [], {}, set()
    kit_root = os.path.dirname(_HERE) if os.path.basename(_HERE) == "_tools" and os.path.isdir(os.path.join(_HERE, "plugins")) else None
    for r in dict.fromkeys([x for x in (kit_root, root) if x]):
        try:
            res = ke.run(r, _hook(name), r, *args)
        except Exception as e:      # a kit_ext.py older than this tool: report it, never crash the scan
            return out, failed, "kit_ext.py failed (%s: %s)" % (type(e).__name__, " ".join(str(e).split()))
        kind_of = getattr(res, "kind_of", lambda _name: None)
        for plugin, answer in res:
            if plugin in KIT_CHECKERS and kind_of(plugin) != "kit":
                # A project extension named like a kit check can never stand in for it: the kit check counts as not run.
                failed.setdefault(plugin, "answered by a project extension, not the kit's plugin")
                continue
            if plugin not in seen:
                seen.add(plugin)
                out.append((plugin, answer))
        for f in res.failures:
            failed.setdefault(f.name or "(record)", f.message)
    return out, failed, ""


class _Helpers(object):
    ev, git, diff_removed = staticmethod(ev), staticmethod(git), staticmethod(diff_removed)
    is_test_path, Usage, SOURCE_EXT = staticmethod(is_test_path), Usage, SOURCE_EXT


def extension_kinds(root):
    """The kinds the project's extensions add, besides the kit's five."""
    found, _, _ = _run(root, "kinds")
    return sorted({k for _, ks in found for k in (ks or []) if k not in KINDS and NAME_RE.match(k)})


def run_checker(root, kind, project, arg, opts):
    """[(path, line no, evidence)] for one drift. A kit kind needs its kit plugin: when that cannot run it is a usage error."""
    found, failed, why = _run(root, "check", kind, project, arg, opts, _Helpers)
    hits, answered = [], False
    for plugin, answer in found:
        if answer is None or (plugin not in KIT_CHECKERS and kind in KINDS):
            continue                                     # not its kind, or an extension trying to answer a kit kind: the kit wins
        if isinstance(answer, str):
            raise Usage(answer)
        answered = True
        hits += [tuple(h) for h in answer]
    if not answered and kind in KINDS:
        raise Usage("drift kind %s cannot run: its kit plugin plugins/test_drift/%s.py is missing or broken (%s); run inbox_setup.py update"
                    % (kind, kind.replace("-", "_"), why or failed.get(kind.replace("-", "_")) or "not loaded"))
    return hits


KIT_CHECKERS = {"clock_mix", "stale_pin", "orphan_selector", "contract_callers", "regex"}


# ---------------------------------------------------------------- commands
def add_line(path, spec, extra=()):
    if "\n" in spec or "\r" in spec:
        raise Usage("--add: the drift must be one line")
    try:
        name, concept, kind, arg = parse_drift(spec, extra)
    except ValueError as e:
        raise Usage("--add: %s" % e)
    if len(concept) > MAX_CONCEPT:
        raise Usage("--add: concept is %d characters; keep it to one sentence of %d or fewer" % (len(concept), MAX_CONCEPT))
    if not os.path.isfile(path):
        raise Usage("no drift list at %s; run --init first" % path)
    if name in {d["name"] for d in read_list(path, extra)[0]}:
        raise Usage("--add: a drift named %s already exists" % name)
    with open(path, "rb") as f:
        needs_nl = not f.read().endswith(b"\n")
    with open(path, "a", encoding="utf-8") as f:
        f.write(("\n" if needs_nl else "") + "- %s | %s | %s | %s\n" % (name, concept, kind, arg))
    return "added %s to %s" % (name, path)


def init_list(path):
    if os.path.exists(path):
        return "left %s (already there)" % path
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "x", encoding="utf-8") as f:
        f.write(SEED)
    return "created %s" % path


def scan(opts, list_path):
    drifts, errors = read_list(list_path, extension_kinds(opts.root))
    p = Project(opts.root, opts.paths)
    hits, idle = [], []
    for d in drifts:
        found = [(d["name"], rel, n, e) for rel, n, e in run_checker(opts.root, d["kind"], p, d["arg"], opts)]
        hits += found
        if not found:
            idle.append(d["name"])
    return drifts, errors, hits, idle


def main(argv=None):
    ap = argparse.ArgumentParser(description="Scan a project's tests for known test-drift patterns.")
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--list", dest="list_path", help="drift list (default: <root>/_dev/test-drift.md)")
    ap.add_argument("--paths", action="append", default=[], metavar="GLOB", help="narrow the scanned test files (repeatable)")
    ap.add_argument("--old", action="append", default=[], metavar="VALUE", help="a replaced value for stale-pin (repeatable)")
    ap.add_argument("--diff", metavar="BASE", help="git base for stale-pin and contract-callers (BASE..HEAD)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--init", action="store_true", help="create the list from the seed if absent")
    ap.add_argument("--add", metavar="LINE", help='append "name | concept | kind | arg" to the list')
    ap.add_argument("--stale", type=int, metavar="DAYS", help="also list drifts with no current hits as `idle <name>`")
    ap.add_argument("--version", action="version", version="test_drift.py " + VERSION)
    try:
        opts = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    try:
        opts.root = os.path.abspath(opts.root)
        if not os.path.isdir(opts.root):
            raise Usage("--root %s is not a folder" % opts.root)
        path = opts.list_path or os.path.join(opts.root, DEFAULT_LIST)
        if opts.stale is not None and opts.stale < 0:
            raise Usage("--stale DAYS must be 0 or more")
        if opts.init:
            print(init_list(path))
            return 0
        if opts.add is not None:
            print(add_line(path, opts.add, extension_kinds(opts.root)))
            return 0
        if not os.path.isfile(path):
            raise Usage("no drift list at %s; run with --init, or copy plugin/project/templates/test-drift.md there" % path)
        if opts.diff and git(opts.root, "rev-parse", "--verify", "--quiet", opts.diff + "^{commit}")[0] != 0:
            raise Usage("--diff %s is not a commit in %s" % (opts.diff, opts.root))
        drifts, errors, hits, idle = scan(opts, path)
    except Usage as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 2
    count = len({h[0] for h in hits})
    summary = "drift: %d hits across %d drifts; list %s (%d drifts)" % (len(hits), count, path, len(drifts))
    if errors:
        summary += "; %d list-errors" % len(errors)
    show_idle = idle if opts.stale is not None else []
    if opts.json:
        print(json.dumps({"hits": [{"drift": n, "path": r, "line": l, "evidence": e} for n, r, l, e in hits],
                          "list_errors": [{"line": n, "reason": r} for n, r in errors], "idle": show_idle,
                          "summary": summary}, indent=2))
    else:
        for n, reason in errors:
            print("list-error %d | %s" % (n, reason))
        for n, r, l, e in hits:
            print("%s | %s:%d | %s" % (n, r, l, e))
        for name in show_idle:
            print("idle %s" % name)
        print(summary)
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
