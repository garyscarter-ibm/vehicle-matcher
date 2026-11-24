#!/usr/bin/env python3
"""test_drift.py: scan a project's tests for known "test drift" patterns listed in _dev/test-drift.md.

  test_drift.py [--root DIR] [--list FILE] [--paths GLOB]... [--old VALUE]... [--diff BASE] [--json] [--stale DAYS]
  test_drift.py --init | --add "<name> | <concept> | <kind> | <arg>"

The list holds one drift per line: `- <name> | <concept> | <kind> | <arg>`; other lines are ignored. Kinds: clock-mix,
stale-pin, orphan-selector, contract-callers, regex. Output: `<drift> | <path>:<line> | <evidence>` per hit, then a summary.
Exit 0 no hits, 1 hits, 2 usage error or missing list. Never deletes anything. Standard library only.
"""
import argparse, fnmatch, json, os, re, subprocess, sys

VERSION = "1.0.1"
KINDS = ("clock-mix", "stale-pin", "orphan-selector", "contract-callers", "regex")
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
def parse_drift(text):
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
    if kind not in KINDS:
        raise ValueError("unknown kind " + repr(kind))
    if kind == "regex":
        try:
            re.compile(arg)
        except re.error as e:
            raise ValueError("bad regex: %s" % e)
        if not arg:
            raise ValueError("regex kind needs an arg")
    return name, concept, kind, arg


def read_list(path):
    """([drift dicts], [(line no, reason)]); a malformed line is skipped, never fatal."""
    drifts, errors, seen = [], [], set()
    with open(path, encoding="utf-8", errors="replace") as f:
        for no, line in enumerate(f, 1):
            if not line.startswith("- "):
                continue
            try:
                name, concept, kind, arg = parse_drift(line[2:].rstrip("\n"))
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


# ---------------------------------------------------------------- checkers; each yields (path, line no, evidence)
DATE_RE = re.compile(r"\b(?:19|20)\d\d-\d\d-\d\d\b|LocalDate\.of\(\s*\d{4}\s*,|new Date\(\s*\d{4}\s*,")
CLOCK_RE = re.compile(r"Instant\.now|LocalDate\.now|LocalDateTime\.now|Date\.now\(|new Date\(\)|\bclock\b|\brunNow\b|\bRunClock\b",
                      re.I)


def check_clock_mix(p, arg, opts):
    """A test file with a literal date that also reads a live clock. A non-empty arg replaces the live-clock regex, so a
    project whose tests say "clock" everywhere can narrow it with a one-line list edit."""
    try:
        clock = re.compile(arg, re.I) if arg.strip() else CLOCK_RE
    except re.error as e:
        raise Usage("clock-mix arg is not a valid regex: %s" % e)
    for rel in p.scanned:
        lines = p.lines(rel)
        first = next(((n, l) for n, l in enumerate(lines, 1) if DATE_RE.search(l)), None)
        if first and any(clock.search(l) for l in lines):
            yield rel, first[0], ev(first[1]) + "  [file also uses the live clock]"


HEX_RE = r"(?=[0-9a-f]*\d)[0-9a-f]{6,}"     # a hex run must hold a digit, so words like "facade" are not hashes
TOKEN_RE = re.compile(r"(?<![\w.])(?:%s|v?\d+\.\d+\.\d+|policy[-_A-Za-z0-9]+)(?![\w])" % HEX_RE)


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


def check_stale_pin(p, arg, opts):
    values = list(opts.old)
    if opts.diff:
        rem, _ = diff_removed(p.root, opts.diff)
        blob = None
        for path, lines in rem.items():
            if path and not is_test_path(path):
                for tok in TOKEN_RE.findall("\n".join(lines)):
                    if len(tok) >= 6 and tok not in values:
                        blob = p.source_blob() if blob is None else blob
                        if tok not in blob:
                            values.append(tok)
    for value in values:
        for rel in p.scanned:
            for n, l in enumerate(p.lines(rel), 1):
                if value in l:
                    yield rel, n, ev("old value %s: %s" % (value, l))
                    break


SEL_CALL_RE = re.compile(r"""(?:querySelector(?:All)?|locator|By\.css(?:Selector)?)\(\s*(['"`])(.*?)\1""")
TESTID_CALL_RE = re.compile(r"""getByTestId\(\s*(['"`])(.*?)\1""")
TESTID_ATTR_RE = re.compile(r"""\[data-testid\s*[~|^$*]?=\s*["']?([^"'\]]+)""")
CLASS_RE = re.compile(r"\.([A-Za-z_][\w-]*)")


def selector_names(line):
    names = set(TESTID_ATTR_RE.findall(line)) | {m.group(2) for m in TESTID_CALL_RE.finditer(line)}
    for m in SEL_CALL_RE.finditer(line):
        sel = m.group(2)
        if re.match(r"\s*(text|xpath|role|id)=|\s*//", sel):
            continue
        sel = re.sub(r"\[[^\]]*\]|\"[^\"]*\"|'[^']*'", " ", sel)
        names |= set(CLASS_RE.findall(sel))
    return names


def check_orphan_selector(p, arg, opts):
    blob = None
    for rel in p.scanned:
        found = {}
        for n, l in enumerate(p.lines(rel), 1):
            for name in selector_names(l):
                found.setdefault(name, (n, l))
        for name, (n, l) in found.items():
            blob = p.source_blob(SOURCE_EXT) if blob is None else blob
            if not re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(name), blob):
                yield rel, n, ev("no source defines '%s': %s" % (name, l))


SIG_RES = (
    re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z]\w*)\s*\("),                                  # python, public only
    re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\("),   # js/ts
    re.compile(r"^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
    re.compile(r"^\s*public\s+(?:(?:static|final|abstract|synchronized|default)\s+)*[\w<>\[\],.? ]+?\s+([A-Za-z_]\w*)\s*\("),  # java
    re.compile(r"^\s*(?!(?:private|protected|internal)\b)(?:\w+\s+)*fun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)\s*\("),    # kotlin
    re.compile(r"^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)\s*\("),                                   # go, exported
)


def signature_name(line):
    for rx in SIG_RES:
        m = rx.match(line)
        if m:
            return m.group(1)
    return None


def check_contract_callers(p, arg, opts):
    if not opts.diff:
        return
    rem, add = diff_removed(p.root, opts.diff)
    rc, out, _ = git(p.root, "diff", "--name-only", "--relative", opts.diff, "HEAD", "--")
    changed_files = set(out.split())
    changed = set()
    for path, lines in rem.items():
        if not path or is_test_path(path):
            continue
        added = {l.strip() for l in add.get(path, [])}
        for l in lines:
            name = signature_name(l)
            if name and len(name) >= 3 and not name.startswith("_") and l.strip() not in added:
                changed.add(name)
    for name in sorted(changed):
        rx = re.compile(r"\b%s\b" % re.escape(name))
        for rel in p.scanned:
            if rel in changed_files:
                continue
            for n, l in enumerate(p.lines(rel), 1):
                if rx.search(l):
                    yield rel, n, ev("signature of %s changed; test not changed: %s" % (name, l))
                    break


def check_regex(p, arg, opts):
    rx = re.compile(arg)
    for rel in p.scanned:
        for n, l in enumerate(p.lines(rel), 1):
            if rx.search(l):
                yield rel, n, ev(l)


CHECKERS = {"clock-mix": check_clock_mix, "stale-pin": check_stale_pin, "orphan-selector": check_orphan_selector,
            "contract-callers": check_contract_callers, "regex": check_regex}


# ---------------------------------------------------------------- commands
def add_line(path, spec):
    if "\n" in spec or "\r" in spec:
        raise Usage("--add: the drift must be one line")
    try:
        name, concept, kind, arg = parse_drift(spec)
    except ValueError as e:
        raise Usage("--add: %s" % e)
    if len(concept) > MAX_CONCEPT:
        raise Usage("--add: concept is %d characters; keep it to one sentence of %d or fewer" % (len(concept), MAX_CONCEPT))
    if not os.path.isfile(path):
        raise Usage("no drift list at %s; run --init first" % path)
    if name in {d["name"] for d in read_list(path)[0]}:
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
    drifts, errors = read_list(list_path)
    p = Project(opts.root, opts.paths)
    hits, idle = [], []
    for d in drifts:
        found = [(d["name"], rel, n, e) for rel, n, e in CHECKERS[d["kind"]](p, d["arg"], opts)]
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
            print(add_line(path, opts.add))
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
