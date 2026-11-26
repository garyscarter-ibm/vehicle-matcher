"""test_drift kit checker for kind(s) contract-callers. Moved out of test_drift.py (SCAF-72), unchanged. A kit default plugin (ALWAYS_ON):
runs in every project. check() answers None for a kind that is not its own, else the hits, or a string for a usage error."""
import re

ALWAYS_ON = True
KINDS = ("contract-callers",)
PROVIDES = ("check",)


_H = None      # the host's helpers (ev, git, diff_removed, is_test_path, Usage, SOURCE_EXT), set by check()


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
    rem, add = _H.diff_removed(p.root, opts.diff)
    rc, out, _ = _H.git(p.root, "diff", "--name-only", "--relative", opts.diff, "HEAD", "--")
    changed_files = set(out.split())
    changed = set()
    for path, lines in rem.items():
        if not path or _H.is_test_path(path):
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
                    yield rel, n, _H.ev("signature of %s changed; test not changed: %s" % (name, l))
                    break


def check(root, kind, project, arg, opts, helpers):
    """The hits [(path, line no, evidence)] for a drift of this kind, a string for a usage error, None for any other kind."""
    global _H
    if kind != "contract-callers":
        return None
    _H = helpers
    try:
        return list(check_contract_callers(project, arg, opts))
    except helpers.Usage as e:
        return str(e)
