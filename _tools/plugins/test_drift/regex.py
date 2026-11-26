"""test_drift kit checker for kind(s) regex. Moved out of test_drift.py (SCAF-72), unchanged. A kit default plugin (ALWAYS_ON):
runs in every project. check() answers None for a kind that is not its own, else the hits, or a string for a usage error."""
import re

ALWAYS_ON = True
KINDS = ("regex",)
PROVIDES = ("check",)


_H = None      # the host's helpers (ev, git, diff_removed, is_test_path, Usage, SOURCE_EXT), set by check()


def check_regex(p, arg, opts):
    rx = re.compile(arg)
    for rel in p.scanned:
        for n, l in enumerate(p.lines(rel), 1):
            if rx.search(l):
                yield rel, n, _H.ev(l)


def check(root, kind, project, arg, opts, helpers):
    """The hits [(path, line no, evidence)] for a drift of this kind, a string for a usage error, None for any other kind."""
    global _H
    if kind != "regex":
        return None
    _H = helpers
    try:
        return list(check_regex(project, arg, opts))
    except helpers.Usage as e:
        return str(e)
