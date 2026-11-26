"""test_drift kit checker for kind(s) stale-pin. Moved out of test_drift.py (SCAF-72), unchanged. A kit default plugin (ALWAYS_ON):
runs in every project. check() answers None for a kind that is not its own, else the hits, or a string for a usage error."""
import re

ALWAYS_ON = True
KINDS = ("stale-pin",)
PROVIDES = ("check",)


_H = None      # the host's helpers (ev, git, diff_removed, is_test_path, Usage, SOURCE_EXT), set by check()


HEX_RE = r"(?=[0-9a-f]*\d)[0-9a-f]{6,}"     # a hex run must hold a digit, so words like "facade" are not hashes
TOKEN_RE = re.compile(r"(?<![\w.])(?:%s|v?\d+\.\d+\.\d+|policy[-_A-Za-z0-9]+)(?![\w])" % HEX_RE)


def check_stale_pin(p, arg, opts):
    values = list(opts.old)
    if opts.diff:
        rem, _ = _H.diff_removed(p.root, opts.diff)
        blob = None
        for path, lines in rem.items():
            if path and not _H.is_test_path(path):
                for tok in TOKEN_RE.findall("\n".join(lines)):
                    if len(tok) >= 6 and tok not in values:
                        blob = p.source_blob() if blob is None else blob
                        if tok not in blob:
                            values.append(tok)
    for value in values:
        for rel in p.scanned:
            for n, l in enumerate(p.lines(rel), 1):
                if value in l:
                    yield rel, n, _H.ev("old value %s: %s" % (value, l))
                    break


def check(root, kind, project, arg, opts, helpers):
    """The hits [(path, line no, evidence)] for a drift of this kind, a string for a usage error, None for any other kind."""
    global _H
    if kind != "stale-pin":
        return None
    _H = helpers
    try:
        return list(check_stale_pin(project, arg, opts))
    except helpers.Usage as e:
        return str(e)
