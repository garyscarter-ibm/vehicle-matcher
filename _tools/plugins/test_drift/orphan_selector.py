"""test_drift kit checker for kind(s) orphan-selector. Moved out of test_drift.py (SCAF-72), unchanged. A kit default plugin (ALWAYS_ON):
runs in every project. check() answers None for a kind that is not its own, else the hits, or a string for a usage error."""
import re

ALWAYS_ON = True
KINDS = ("orphan-selector",)
PROVIDES = ("check",)


_H = None      # the host's helpers (ev, git, diff_removed, is_test_path, Usage, SOURCE_EXT), set by check()


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
            blob = p.source_blob(_H.SOURCE_EXT) if blob is None else blob
            if not re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(name), blob):
                yield rel, n, _H.ev("no source defines '%s': %s" % (name, l))


def check(root, kind, project, arg, opts, helpers):
    """The hits [(path, line no, evidence)] for a drift of this kind, a string for a usage error, None for any other kind."""
    global _H
    if kind != "orphan-selector":
        return None
    _H = helpers
    try:
        return list(check_orphan_selector(project, arg, opts))
    except helpers.Usage as e:
        return str(e)
