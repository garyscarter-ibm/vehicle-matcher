"""test_drift kit checker for kind(s) clock-mix. Moved out of test_drift.py (SCAF-72), unchanged. A kit default plugin (ALWAYS_ON):
runs in every project. check() answers None for a kind that is not its own, else the hits, or a string for a usage error."""
import re

ALWAYS_ON = True
KINDS = ("clock-mix",)
PROVIDES = ("check",)


_H = None      # the host's helpers (ev, git, diff_removed, is_test_path, Usage, SOURCE_EXT), set by check()


DATE_RE = re.compile(r"\b(?:19|20)\d\d-\d\d-\d\d\b|LocalDate\.of\(\s*\d{4}\s*,|new Date\(\s*\d{4}\s*,")
CLOCK_RE = re.compile(r"Instant\.now|LocalDate\.now|LocalDateTime\.now|Date\.now\(|new Date\(\)|\bclock\b|\brunNow\b|\bRunClock\b",
                      re.I)


def check_clock_mix(p, arg, opts):
    """A test file with a literal date that also reads a live clock. A non-empty arg replaces the live-clock regex, so a
    project whose tests say "clock" everywhere can narrow it with a one-line list edit."""
    try:
        clock = re.compile(arg, re.I) if arg.strip() else CLOCK_RE
    except re.error as e:
        raise _H.Usage("clock-mix arg is not a valid regex: %s" % e)
    for rel in p.scanned:
        lines = p.lines(rel)
        first = next(((n, l) for n, l in enumerate(lines, 1) if DATE_RE.search(l)), None)
        if first and any(clock.search(l) for l in lines):
            yield rel, first[0], _H.ev(first[1]) + "  [file also uses the live clock]"


def check(root, kind, project, arg, opts, helpers):
    """The hits [(path, line no, evidence)] for a drift of this kind, a string for a usage error, None for any other kind."""
    global _H
    if kind != "clock-mix":
        return None
    _H = helpers
    try:
        return list(check_clock_mix(project, arg, opts))
    except helpers.Usage as e:
        return str(e)
