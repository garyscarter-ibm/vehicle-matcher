#!/usr/bin/env python3
"""dev_mail.py: the two-way dev mailbox between Cowork and Claude Code for this project, and the guard that stops
it looping (the rules for Cowork are in the managed `dev-inbox` skill).

Cowork -> Code: a user story in _dev/code-inbox/ (written by Cowork).
Code -> Cowork: a thread in _dev/cowork-inbox/MSG-<date>-<nnn>.md (MSG-<date>-<PFX>-<nnn> in team mode), opened by this tool. Two kinds:
  question  Code needs a clarification to build a story. Cowork answers in the same file.
  job       a follow-on for Cowork once a story is built ("the route is done, now load all the data").
Cowork may spawn a user story from a thread it is working (a bug the job surfaced); the tool stamps it.

Every post goes through this tool, and the tool enforces the limits in _config/dev-mail.json, so neither side can
loop the other by choice or by mistake. The limits (change a number there to change the rule, no code):
  max_question_rounds_per_story         question threads one story may open (a round = one question and its answer)
  max_counter_questions_per_question    times Cowork's reply may ask back; terse, and it must say the reply format
  max_counter_question_chars            the length cap on a counter-question
  max_body_chars                        the length cap on every other turn
  max_jobs_per_story                    follow-on jobs one story may open
  max_chain_depth                       root story 0, a job from it 1, a story spawned from that job 2. Deeper is refused
  max_stories_spawned_per_thread        stories Cowork may spawn from one thread
  max_open_threads                      threads open at once, over the whole mailbox
  max_posts_per_day                     threads opened plus stories spawned in one day, a backstop
  stale_after_days                      `list` flags a thread older than this, so a poller that isn't running shows
Structural rules (not numbers): only a person starts a chain; one open question per story; a reply from Code is an
answer and never a question; a thread has one status that moves forward; a refusal is final, not retried (the
caller records it under "for <owner>" in the story's result block; the owner is `inbox.owner` in .claude/scaffolding.json).
Story fields (stories dated 2026-10-27 or later): a story carries `epic: none | B-<nnn>` (an item in backlog/), `priority: P<1-5>`
with `priority_reason: <rubric line>`, `size: XS|S|M|L|XL` and `depends_on: none | <story ids, comma separated>` (conditions that
aren't stories go in the optional `preconditions:`); its `title:` is 80 characters or fewer, no backticks, not starting `Site:` or
a story id. Earlier stories keep `priority: P<1-5>, <reason>` and `depends_on: <ids> [free text]`. Cowork may add
`expedite: <date>, by <owner>: <why>` (the owner's alone). `queue` ranks the waiting stories (expedite, then blockers, then
priority with ageing, then size) and holds the ones that can't be taken.

Team mode (optional; absent means single-player, everything as above). `team` in .claude/scaffolding.json lists the members by login
({"mode": "team", "members": {"<login>": {"name": "Russell", "prefix": ""}, ...}, "data_writers": ["<login>", ...], "owner": "<login>"});
a prefix is "" for at most one member (the owner, who keeps unprefixed ids) or 2-4 capital letters. `data_writers` are the members whose
Macs may change the model (the old string `data_writer` still reads as a one-item list; an empty list means nobody); with two or more they
take turns holding the pen (scaffold_git.py pen; `team` prints its state, read through the project's git tool). `owner` defaults to the empty-prefix member, else the first member listed, and alone may
`team --grant-writer LOGIN` / `--revoke-writer LOGIN`, which rewrite `data_writers` in scaffolding.json (commit and push it after). The git-ignored .claude/member.json ({"login": ...}) says which
member this machine is (`team --me LOGIN` writes it). Ids then carry the minter's prefix (DEV-<date>-GC-<nnn>, MSG-<date>-GC-<nnn>),
numbered among that prefix's ids only, so two machines never mint the same id. A story or thread belongs to the member whose prefix its
id carries (unprefixed: the owner); `list` shows only your own threads; `check-story` wants the owner member's name on the
`requested:` line. The story queue is shared (Russell, 2026-10-28): `queue` shows every member's waiting stories, and a claim takes a
lease on origin (scaffold_git.py claim), so the first Mac to claim a story builds it. A claimed story belongs to its `claimed_by:` member
(claimer_of), else the id's. A story with `needs: data-writer` is left out of the queue on a Mac that is not a data writer.

Jira mode (the record's backlog.backend is "jira"; the story sync is _tools/jira_sync.py, and this tool never calls Jira): an
imported story carries a `jira: <KEY>` line. For such a story `check-story` also wants every field in STORY_FIELDS, accepts
`priority_reason: set in Jira (<KEY>)` at any level P1-P5 (Jira owns priority), and takes `requested: <date>, by <name> via Jira <KEY>`
as its lineage (the person who filed it is the requester). `epic:` takes a key of backlog.project (`SCAF-3`) in place of
`B-<nnn>`; it is not looked up (this tool cannot read Jira), but another project's key is refused. `epics` then reports items
by Jira key from the stories alone (status is unknown; the verdict says what it should be), `waits_on` does not apply, and
`epics --sync` refuses (use jira_sync.py push).
A project that moved its file backlog to Jira (the backlog skill's migrate.py) keeps <root>/backlog/MIGRATED.json, {"B-007": "SCAF-12"}.
In Jira mode a story's `epic: B-007` (or a B- id found the old ways, in requested, title or priority_reason) resolves through it to
SCAF-12: `check-story` accepts it without a backlog/B-007.md, `queue` no longer holds the story for that, and `epics` reports the
stories under SCAF-12 (`epics --id B-007` works too). `epics` resolves closed stories too, so an item's last merge still counts. A B-
id that is not in the map keeps its old refusal ("epic: B-007 is not in backlog/"), which now names MIGRATED.json. The map is only
read; no story is rewritten.

A story that names a backlog item in `requested:` (or as `priority_reason: from B-<nnn>`) must carry that item as its `epic:`, or the
check refuses it. `epics` reads which stories belong to which backlog item (story_epic) and keeps each item's status in step.

Commands (exit 0 done, 1 error, 2 refused by a limit):
  limits                                          print the limits
  budget --story ID                               what ID may still open
  list --for code|cowork                          threads waiting on that side; `NOTHING` when none
  show THREAD
  open --kind question|job --story ID --subject S (--body T | --body-file F|-) [--reply-format R] [--after-merge]   (Code)
        --after-merge (jobs): Cowork's list hides the job until the story is in done/ (the route is on master)
  reply THREAD --as cowork|code --type answer|cannot-answer|counter-question|done|declined
        (--body T | --body-file F|-) [--reply-format R]
  close THREAD [--withdraw]                       (Code) file an answered thread; --withdraw drops one still waiting
  spawn-story --thread THREAD --file DRAFT.md     (Cowork) write a stamped story into _dev/code-inbox/
  check-story ID                                  verify a story before building it (Code, at claim): its lineage (who asked),
        a ui story's `ui:` line (when the project's components piece is on), and for new stories the epic, priority, size, depends_on, title and expedite lines; XL is a warning
  queue [--stats]                                 the waiting stories in claim order, then `held` lines and ALERT lines; `NOTHING`
        when none is ready; --stats adds the counts and how well sizes matched story points
  epics [--id B-nnn|KEY] [--sync] [--json]        per backlog item: its stories (done, open, rejected), the things it waits on (its
        `waits_on` header) and what its status should be (`ok`, `set In Progress`, `set In Review`, `awaiting review`, `waiting on <entries>`); --sync
        writes status, status_changed and status_note (and drops waits_on once the item goes In Review) in backlog/; without it
        nothing is written. STALE and UNKNOWN lines follow the items. `NOTHING` when no item has stories or waits_on.
        A Rejected item is never changed. --json prints the same data as a JSON list. In Jira mode the items are Jira
        keys, status is `unknown`, waits_on is empty and --sync is refused (exit 2)
  next-story-id                                   the next free DEV id for today, across inbox, in-progress, done, staged (any subfolder)
  team [--me LOGIN]                               team mode: print the members and who owns each in-progress story (`mode single` when
        off); --me writes .claude/member.json to say which member this machine is and keeps it out of git
        (the git tool's ensure_ignored, else a line in .git/info/exclude)
  version                                         print the version of this tool

waits_on (backlog header): `; `-separated entries, each `action:<id>` (a model action object), `MSG-...` (a thread), `DEV-...` (a
story that must be done first) or `<text> (since YYYY-MM-DD)`. `epics` resolves each to open, closed or unknown: a thread is closed
when its status is closed, a story when it is done or rejected, an action when `action_status(id)` says done or dropped (the Mail
argument, else `action_status(root, id)` in <root>/_tools/backlog_waits.py if that file exists; otherwise unknown), free text is
always open and goes stale after `stale_after_days`. An item with an open or unknown entry never goes In Review. `epics` never sets Done: a finished item goes In Review, and
only the owner moves it on (Done when accepted, In Progress when sent back; Russell, 2026-10-27).

The git tool: team-mode state (the pen) and the next-step hints come from the project's scaffold_git.py, the file named by `inbox.git_tool`
in .claude/scaffolding.json (a path from the project root; default _tools/scaffold_git.py). It is loaded by path, never through sys.path. When it
is missing or will not load, `team` says `pen: unknown (<tool> not found: run inbox_setup.py update)` and carries on. No other module of the
project is imported.

Run it from any checkout or worktree: the root is the project, found from this file's location (<root>/_tools/dev_mail.py).
"""
import argparse, datetime, glob, importlib.util, json, os, re, subprocess, sys

VERSION = "1.10.0"

CONFIG_REL = os.path.join("_config", "dev-mail.json")
LIMIT_MIN = {
    "max_question_rounds_per_story": 0, "max_counter_questions_per_question": 0, "max_counter_question_chars": 1,
    "max_body_chars": 1, "max_jobs_per_story": 0, "max_chain_depth": 0, "max_stories_spawned_per_thread": 0,
    "max_open_threads": 1, "max_posts_per_day": 1, "stale_after_days": 1,
}
STORY_FIELDS = ["title", "kind", "design_impact", "requested", "goal", "acceptance", "files_or_areas", "decided",
                "out_of_scope", "validate"]
HEAD_ORDER = ["id", "kind", "story", "chain", "depth", "status", "opened", "needs", "counter_questions_used", "spawned",
              "subject", "closed"]
COWORK_TYPES = {"question": ("answer", "cannot-answer", "counter-question"), "job": ("done", "declined")}
STORY_RE = re.compile(r"^DEV-\d{4}-\d{2}-\d{2}(?:-[A-Z]{2,4})?-\d{3}$")
PRIORITY_FROM = "2026-10-27"   # stories with ids dated before this carry no priority/size/depends_on rules
FIELDS_FROM = "2026-10-27"     # from this day a story keeps epic, priority, priority_reason, depends_on and title to one form each;
                               # ids dated earlier keep the older forms (combined `priority: P3, default`, depends_on with text, no epic)
SIZES = ("XS", "S", "M", "L", "XL")
SIZE_BANDS = {"XS": (1, 2), "S": (3, 3), "M": (5, 5), "L": (8, 8), "XL": (13, None)}   # story points each size means
AGE_DAYS = 7                   # a waiting story rises one priority level per 7 full days, never above P1
DEFAULT_PRIORITY, DEFAULT_SIZE = 3, "M"   # what the queue reads for a story with no (valid) line
ID = r"DEV-\d{4}-\d{2}-\d{2}(?:-[A-Z]{2,4})?-\d{3}"       # STORY_RE is this anchored; use ID inside other patterns (the optional part is a team member's prefix)
CLOSED_REJECTED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\s*[,;:]?\s*rejected\b", re.I)   # the dev board's rule for a rejected story
THREAD_RE = re.compile(r"^MSG-\d{4}-\d{2}-\d{2}(?:-[A-Z]{2,4})?-\d{3}$")
ID_PREFIX_RE = re.compile(r"^(?:DEV|MSG)-\d{4}-\d{2}-\d{2}-(?:([A-Z]{2,4})-)?\d{3}$")


class MailError(Exception):
    exit_code = 1


class Refused(MailError):
    exit_code = 2


class ModeRefused(Refused):
    """A command the project's backlog mode does not support (epics --sync in Jira mode): refused (exit 2), not a limit."""


class TeamRefused(Refused):
    """A team-config change this machine may not make: refused (exit 2), but not a limit, so no "record it for the owner" line."""


def default_root():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    marker = os.sep + os.path.join(".claude", "worktrees") + os.sep
    return here.split(marker)[0]


def load_config(path):
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        raise MailError(f"{path} is missing: it holds the mailbox limits")
    bad = sorted(set(cfg) ^ set(LIMIT_MIN))
    if bad:
        raise MailError(f"{path}: unknown or missing keys {bad}")
    for k, lo in LIMIT_MIN.items():
        if not isinstance(cfg[k], int) or isinstance(cfg[k], bool) or cfg[k] < lo:
            raise MailError(f"{path}: {k} must be a whole number >= {lo}")
    return cfg


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _unlink_quietly(path):
    try:
        os.remove(path)
    except OSError:
        pass  # a mount that refuses unlink (Cowork's VM) leaves a stray *.tmp; readers only look at *.md


def _publish(path, text):
    """Write text so a reader never sees half a file, and never overwrite: False if path already exists.
    Falls back to an exclusive create where the mount refuses hard links."""
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        os.link(tmp, path)
        return True
    except FileExistsError:
        return False
    except OSError:
        try:
            with open(path, "x", encoding="utf-8") as f:
                f.write(text)
            return True
        except FileExistsError:
            return False
    finally:
        _unlink_quietly(tmp)


def _replace(path, text):
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except OSError:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        _unlink_quietly(tmp)


def _clean(body):
    return re.sub(r"(?m)^## Turn", " ## Turn", body.strip("\n"))


def parse_thread(text):
    head, *rest = re.split(r"(?m)^## Turn (\d+)\n", text)
    h = {}
    for line in head.splitlines():
        k, sep, v = line.partition(":")
        if sep:
            h[k.strip()] = v.strip()
    turns = []
    for i in range(0, len(rest), 2):
        hdr, _, body = rest[i + 1].partition("\n\n")
        t = {"body": body.strip("\n")}
        for line in hdr.splitlines():
            k, sep, v = line.partition(":")
            if sep:
                t[k.strip()] = v.strip()
        turns.append(t)
    return h, turns


def render_thread(h, turns):
    keys = [k for k in HEAD_ORDER if k in h] + [k for k in h if k not in HEAD_ORDER]
    out = [f"{k}: {h[k]}" for k in keys]
    for n, t in enumerate(turns, 1):
        out.append(f"\n## Turn {n}\nfrom: {t['from']}\ntype: {t['type']}\nat: {t['at']}")
        if t.get("reply_format"):
            out.append(f"reply_format: {t['reply_format']}")
        out.append(f"\n{t['body']}")
    return "\n".join(out) + "\n"


def story_header(text):
    top = text.split("\n## Result")[0]
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"(?m)^(id|origin|chain|depth|spawned):[ \t]*(.*)$", top)}


# A UI story names the kit components it uses (the project's COMPONENTS.md, see the component-kit skill), so the build
# reuses them rather than building its own: `ui:` lists the kit's components, and any new one as
# "new: <name>, because <why none fits>". A story needs the line only when the project has the components piece on
# (`pieces.components` is "on" in .claude/scaffolding.json); a line that is there is checked either way. Stories written
# before the field existed (ids dated before UI_FROM) are left as they were; their story-lead still makes the component
# plan the poller brief's component-plan step asks for.
UI_KINDS = ("ui", "dashboard")   # `dashboard` is the older name for kind `ui`
UI_FROM = "2026-10-26"


def components_on(root):
    """True if <root>/.claude/scaffolding.json has pieces.components == "on"; False if off, unset, or the file or JSON is bad."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            return json.load(f)["pieces"]["components"] == "on"
    except (OSError, ValueError, KeyError, TypeError):
        return False


def ui_problem(text, sid=None, components=False):
    """None if the story's `ui:` field is fine, else why not. A story of kind ui (or the older dashboard) needs one when the
    project's components piece is on (`components`); with it off, a `ui:` line that is there is still checked."""
    top = text.split("\n## Result")[0]
    kind = re.search(r"(?m)^kind:[ \t]*(\S+)", top)
    if not kind or kind.group(1) not in UI_KINDS:
        return None
    day = re.match(r"DEV-(\d{4}-\d{2}-\d{2})-", sid or "")
    if day and day.group(1) < UI_FROM:
        return None
    ui = re.search(r"(?m)^ui:[ \t]*(.*)$", top)
    if not ui or not ui.group(1).strip():
        if not components:
            return None
        return ("a ui story needs a `ui:` line naming the kit components it uses, from the project's COMPONENTS.md "
                "(e.g. `ui: pageHead, card, dataTable, emptyState`), or `ui: none` when it changes no screen")
    for part in re.findall(r"new:([^;\n]*)", ui.group(1)):
        if "because" not in part:
            return f"`ui:` asks for a new component ({part.strip()}) without saying why no existing one fits: 'new: <name>, because <why>'"
    return None


def load_owner(root):
    """inbox.owner from <root>/.claude/scaffolding.json, stripped; None if the file, key or JSON is missing or bad."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            owner = json.load(f)["inbox"]["owner"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return owner.strip() or None if isinstance(owner, str) else None


JIRA_KEY = r"[A-Z][A-Z0-9]+-\d+"
JIRA_KEY_RE = re.compile(rf"^{JIRA_KEY}$")


def jira_project(root):
    """The Jira project key (backlog.project) when <root>/.claude/scaffolding.json has backlog.backend "jira", else None
    (file mode; also for a missing or bad file or block, which is not this tool's to judge)."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            b = json.load(f)["backlog"]
        project = b["project"] if b["backend"] == "jira" else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return project if isinstance(project, str) and re.match(r"^[A-Z][A-Z0-9]+$", project) else None


def story_jira_key(fields):
    """The Jira key on a story's `jira:` line, or None."""
    m = re.match(rf"^\s*({JIRA_KEY})\b", fields.get("jira") or "")
    return m.group(1) if m else None


NO_MEMBER = "this machine has no team member set: run dev_mail.py team --me <login>"


def load_team(root):
    """The `team` block of <root>/.claude/scaffolding.json as {"members": {login: {"name", "prefix"}}, "data_writers": [login],
    "owner": login} (the legacy string `data_writer` reads as a one-item list; `owner` defaults to the empty-prefix member, else the
    first listed), or None when there is none (single-player). A bad block is a MailError naming the problem."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            team = json.load(f).get("team")
    except (OSError, ValueError, AttributeError):
        return None
    if team is None or (isinstance(team, dict) and team.get("mode") == "single"):
        return None
    where = "scaffolding.json team"
    if not isinstance(team, dict) or team.get("mode") != "team":
        raise MailError(f"{where}: mode must be 'team' (or 'single')")
    raw = team.get("members")
    if not isinstance(raw, dict) or not raw:
        raise MailError(f"{where}: members must be an object of login -> {{name, prefix}}")
    members, seen = {}, {}
    for login, m in raw.items():
        name = m.get("name") if isinstance(m, dict) else None
        pfx = m.get("prefix") if isinstance(m, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise MailError(f"{where}: member {login} needs a name")
        if not isinstance(pfx, str) or not re.fullmatch(r"(?:[A-Z]{2,4})?", pfx):
            raise MailError(f"{where}: member {login} prefix must be '' or 2-4 capital letters, not {pfx!r}")
        if pfx in seen:
            raise MailError(f"{where}: members {seen[pfx]} and {login} share the prefix {pfx!r}"
                            if pfx else f"{where}: only one member may have an empty prefix ({seen[pfx]} and {login} do)")
        seen[pfx] = login
        members[login] = {"name": name.strip(), "prefix": pfx}
    writers = team.get("data_writers", team.get("data_writer"))
    writers = [] if writers is None else [writers] if isinstance(writers, str) else writers
    if not isinstance(writers, list) or not all(isinstance(w, str) for w in writers):
        raise MailError(f"{where}: data_writers must be a list of member logins")
    for w in writers:
        if w not in members:
            raise MailError(f"{where}: data_writer {w!r} is not a member")
    dup = sorted({w for w in writers if writers.count(w) > 1})
    if dup:
        raise MailError(f"{where}: data_writers lists {', '.join(dup)} more than once")
    owner = team.get("owner")
    if owner is None:
        owner = seen.get("") or next(iter(members))
    elif owner not in members:
        raise MailError(f"{where}: owner {owner!r} is not a member")
    return {"members": members, "data_writers": writers, "owner": owner}


DEFAULT_GIT_TOOL = "_tools/scaffold_git.py"
LOCAL_FILES = (".claude/member.json", ".claude/pen.json", ".claude/pen.json.released", ".claude/pen-wanted.json",
               ".claude/jira-sync.json")   # the per-machine files scaffold_git.py keeps out of git (its LOCAL_FILES)


def git_tool_rel(root):
    """inbox.git_tool from <root>/.claude/scaffolding.json (a path from the project root), else DEFAULT_GIT_TOOL."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            tool = json.load(f)["inbox"]["git_tool"]
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_GIT_TOOL
    return tool.strip() if isinstance(tool, str) and tool.strip() else DEFAULT_GIT_TOOL


def load_git_tool(root):
    """(module, rel): the project's scaffold_git.py, loaded by path (sys.path is left alone). The module is None when the
    file is missing or will not load."""
    rel = git_tool_rel(root)
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return None, rel
    try:
        spec = importlib.util.spec_from_file_location("_scaffold_git_" + str(abs(hash(path))), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException:
        return None, rel
    return mod, rel


def pen_state(root):
    """The `team` listing's pen line, from the project's git tool; never raises."""
    mod, rel = load_git_tool(root)
    if mod is None:
        return f"pen: unknown ({rel} not found: run inbox_setup.py update)"
    try:
        return mod.pen_line(root)
    except Exception as e:
        return f"pen: unknown ({rel} could not read the pen: {e}; run inbox_setup.py update)"


def keep_ignored(root):
    """Keep the per-machine .claude files (member.json first) out of git: the git tool's ensure_ignored when it loads, else
    the same names appended to the shared checkout's .git/info/exclude here. Best effort; True when covered."""
    mod, _ = load_git_tool(root)
    if mod is not None and hasattr(mod, "ensure_ignored"):
        try:
            return bool(mod.ensure_ignored(root))
        except Exception:
            pass
    try:
        r = subprocess.run(["git", "-C", root, "rev-parse", "--git-path", "info/exclude"], capture_output=True, text=True)
        if r.returncode != 0 or not r.stdout.strip():
            return False
        path = os.path.join(root, r.stdout.strip())
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            text = ""
        have = {l.strip().lstrip("/") for l in text.splitlines()}
        missing = [n for n in LOCAL_FILES if n not in have]
        if missing:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(("\n" if text and not text.endswith("\n") else "") + "".join(n + "\n" for n in missing))
        return True
    except OSError:
        return False


def whoami(root, team):
    """This machine's member login from <root>/.claude/member.json; None when not in team mode, or the file is missing, bad
    or names someone who is not a member."""
    if not team:
        return None
    try:
        with open(os.path.join(root, ".claude", "member.json"), encoding="utf-8") as f:
            login = json.load(f)["login"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return login if isinstance(login, str) and login in team["members"] else None


def claimer_of(text):
    """The `claimed_by:` login of a claimed story's file (before `## Result`), or None for a story claimed before claims named one."""
    m = re.search(r"(?m)^claimed_by:[ \t]*(\S+)", text.split("\n## Result")[0])
    return m.group(1) if m else None


def owner_of(xid, team):
    """The member login whose prefix the story or thread id carries (unprefixed: the team's owner);
    None when there is no team, the id does not parse, or its prefix is nobody's."""
    m = ID_PREFIX_RE.match(xid or "")
    if not team or not m:
        return None
    pfx = m.group(1) or ""
    for login, mem in team["members"].items():
        if mem["prefix"] == pfx:
            return login
    return team["owner"] if not pfx else None


# --- story priority: the fields a story carries, and the queue they make -----------------------------------------
def story_fields(text):
    """Every top-level `key: value` before `## Result`; a value runs on to the next key line (the dev board's rule)."""
    fields, key, buf = {}, None, []
    for line in text.split("\n## Result")[0].split("\n"):
        km = re.match(r"^([a-z_]+):(.*)$", line)
        if km:
            if key is not None:
                fields[key] = "\n".join(buf).strip()
            key, buf = km.group(1), [km.group(2)]
        elif key is not None:
            buf.append(line.rstrip())
    if key is not None:
        fields[key] = "\n".join(buf).strip()
    return fields


def story_day(sid):
    m = re.match(r"DEV-(\d{4})-(\d{2})-(\d{2})(?:-[A-Z]{2,4})?-\d{3}$", sid or "")
    try:
        return datetime.date(*map(int, m.groups())) if m else None
    except ValueError:
        return None


def is_new(sid):
    day = story_day(sid)
    return day is not None and day >= datetime.date.fromisoformat(PRIORITY_FROM)


def fields_new(sid):
    day = story_day(sid)
    return day is not None and day >= datetime.date.fromisoformat(FIELDS_FROM)


def _working_days(a, b):
    n = 0
    while a < b:
        a += datetime.timedelta(days=1)
        n += a.weekday() < 5
    return n


def _due_best(day, due):
    """The best (lowest) level a `due` date allows: P1 within 5 working days of the story's date, P2 within 28 days, else P3."""
    days = (due - day).days
    if days <= 0 or _working_days(day, due) <= 5:
        return 1
    return 2 if days <= 28 else 3


PRIORITY_FORMS = ("broken for a user: <what> | due <yyyy-mm-dd>: <what> | waiting: <who> needs it for <what> | default | "
                  "polish | idea | from B-<nnn> | by <name>: <why>")


def parse_priority(value, sid, owner=None, spawned=False, backlog_priority=None):
    """(level, None) if the combined `priority: P<n>, <reason>` value (stories dated before FIELDS_FROM) is valid, else (None, problem)."""
    first = (value or "").split("\n")[0].strip()
    m = re.match(r"^P([1-5])\s*,\s*(\S.*)$", first)
    if not m:
        return None, f"priority: write 'P<1-5>, <reason>' with a reason of the form {PRIORITY_FORMS}"
    return check_reason(int(m.group(1)), m.group(2), sid, owner, spawned, backlog_priority)


def parse_priority_split(level_value, reason_value, sid, owner=None, spawned=False, backlog_priority=None, jira_key=None):
    """(level, None) for the pair `priority: P<n>` and `priority_reason: <rubric line>`, else (None, problem)."""
    m = re.match(r"^P([1-5])$", (level_value or "").split("\n")[0].strip())
    if not m:
        return None, "priority: write the level alone, 'P<1-5>'; the rubric line goes in 'priority_reason:'"
    why = (reason_value or "").split("\n")[0].strip()
    if not why:
        return None, f"priority_reason: missing (write the rubric line, one of {PRIORITY_FORMS})"
    return check_reason(int(m.group(1)), why, sid, owner, spawned, backlog_priority, jira_key)


def priority_of(fields, sid, owner=None, spawned=False, backlog_priority=None):
    """(level, problem) from a story's fields: the split form when `priority_reason` is present, else the combined form."""
    if "priority_reason" in fields:
        return parse_priority_split(fields.get("priority"), fields["priority_reason"], sid, owner, spawned, backlog_priority,
                                    story_jira_key(fields))
    return parse_priority(fields.get("priority"), sid, owner, spawned, backlog_priority)


def check_reason(level, why, sid, owner=None, spawned=False, backlog_priority=None, jira_key=None):
    """(level, None) if the rubric line `why` allows `level`, else (None, problem). `jira_key` is the story's `jira:` key:
    `set in Jira (<KEY>)` is allowed at any level when it names that key (Jira owns a Jira story's priority)."""
    best, name = None, None
    jm = re.match(rf"set in jira\s*\(\s*({JIRA_KEY})\s*\)\s*$", why, re.I)
    if jm:
        if jira_key and jm.group(1) == jira_key:
            return level, None
        return None, (f"priority: 'set in Jira ({jm.group(1)})' needs a 'jira: {jm.group(1)}' line in the story"
                      if not jira_key else f"priority: 'set in Jira ({jm.group(1)})' does not match the story's jira: {jira_key}")
    if re.match(r"broken for a user\s*:\s*\S", why, re.I):
        best, name = 1, "broken for a user"
    elif re.match(r"due\b", why, re.I):
        d = re.match(r"due\s+(\d{4}-\d{2}-\d{2})\s*:\s*\S", why, re.I)
        try:
            due = datetime.date.fromisoformat(d.group(1)) if d else None
        except ValueError:
            due = None
        if due is None:
            return None, "priority: 'due' needs a real date and what is due: 'due <yyyy-mm-dd>: <what>'"
        day = story_day(sid)
        best, name = (_due_best(day, due) if day else 1), f"due {due.isoformat()}"
    elif re.match(r"waiting\s*:\s*\S", why, re.I):
        best, name = 2, "waiting"
    elif re.match(r"default\s*(:.*)?$", why, re.I):
        best, name = 3, "default"
    elif re.match(r"polish\s*(:.*)?$", why, re.I):
        best, name = 4, "polish"
    elif re.match(r"idea\s*(:.*)?$", why, re.I):
        best, name = 5, "idea"
    elif re.match(r"from\s+B-\d+\b", why, re.I):
        bid = "B-" + re.search(r"\d+", why).group(0)
        bp = backlog_priority(bid) if backlog_priority else None
        if bp is not None and bp != level:
            return None, f"priority: {bid} is P{bp}; the story says P{level}: use the item's level, or a rubric line"
        return level, None
    elif re.match(r"by\s+[^:]+?\s*:\s*\S", why, re.I):
        who = re.match(r"by\s+([^:]+?)\s*:", why, re.I).group(1)
        if spawned:
            return None, "priority: 'by <name>' is the owner's own ruling and not allowed in a spawned story"
        if owner and owner.lower() not in who.lower():
            return None, f"priority: 'by {who}' is not {owner}: only the owner can rule a level"
        return level, None
    else:
        return None, f"priority: unknown reason {why[:40]!r}; use one of {PRIORITY_FORMS}"
    if level < best:
        return None, f"priority: P{level} is higher than a '{name}' reason allows (P{best} at best)"
    return level, None


def parse_size(value):
    m = re.match(r"^(XS|S|M|L|XL)\b", (value or "").split("\n")[0].strip(), re.I)
    return (m.group(1).upper(), None) if m else (None, "size: write one of XS, S, M, L, XL (optionally ', <note>')")


def depends_on(value):
    """(ids, ok): ids the leading list names; ok = the value starts with `none` or an id list (else it is free text)."""
    v = value or ""
    if re.match(r"\s*none\b", v, re.I):
        return [], True
    m = re.match(rf"^\s*({ID}(?:\s*(?:,|and|&)\s*{ID})*)", v)
    return (re.findall(ID, m.group(1)), True) if m else ([], False)


def parse_expedite(value, owner=None, spawned=False):
    """((date, name, why), None) if valid, else (None, problem)."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2}),\s*by\s+([^:]+?)\s*:\s*(\S.*)$", (value or "").split("\n")[0].strip())
    try:
        datetime.date.fromisoformat(m.group(1)) if m else None
    except ValueError:
        m = None
    if not m:
        return None, "expedite: write 'expedite: <yyyy-mm-dd>, by <owner>: <why>'"
    if spawned:
        return None, "expedite: is the owner's alone and not allowed in a spawned story"
    if owner and owner.lower() not in m.group(2).lower():
        return None, f"expedite: 'by {m.group(2)}' is not {owner}: it is the owner's alone"
    return m.groups(), None


EPIC_ID_RE = re.compile(r"B-\d+")
FROM_EPIC_RE = re.compile(r"\bfrom\s+(B-\d+)")
EPIC_NONE_RE = re.compile(r"^\s*none\b", re.I)
REASON_AFTER_LEVEL_RE = re.compile(r"^P[1-5]\b(.*)$", re.S)
LEAD_PUNCT_RE = re.compile(r"^[\s,;:.\-\u2013\u2014]+")
COMBINED_PRIORITY_RE = re.compile(r"^(P[1-5])\s*,\s*(\S.*)$")
DEPENDS_IDS_RE = re.compile(rf"^{ID}(?:\s*,\s*{ID})*$")
TITLE_RULE = 'see "Titles" in _skill/dev-requests.md (generic: the dev-inbox skill\'s references/cowork.md)'


def _priority_reason_text(fields):
    """The `priority_reason:` field, else the text after the level in an older combined `priority: P2, from B-014` line
    (the dev board's rule); '' when there is nothing."""
    own = (fields.get("priority_reason") or "").strip()
    if own:
        return own
    m = REASON_AFTER_LEVEL_RE.match((fields.get("priority") or "").strip())
    return LEAD_PUNCT_RE.sub("", m.group(1)).strip() if m else ""


VIA_JIRA_RE = re.compile(rf"\bvia\s+Jira\s+{JIRA_KEY}\b", re.I)


def _requested_text(fields, jira=None):
    """The `requested:` text to look for backlog items in. In Jira mode a `via Jira <KEY>` is where the story came from, not an epic."""
    text = fields.get("requested", "")
    return VIA_JIRA_RE.sub("via Jira", text) if jira else text


def epic_regexes(jira=None):
    """(id, from) patterns for a backlog item named in a story: B-<nnn>, and in Jira mode (`jira` = the project key) also
    <PROJECT>-<n>. `from` captures the id after 'from'."""
    if not jira:
        return EPIC_ID_RE, FROM_EPIC_RE
    ident = rf"(?:B-\d+|{re.escape(jira)}-\d+)"
    return re.compile(rf"\b{ident}\b"), re.compile(rf"\bfrom\s+({ident})\b")


def load_migrated(root, jira):
    """In Jira mode, {B-id: Jira key} from <root>/backlog/MIGRATED.json (written by the backlog skill's migrate.py); keys that are
    not B-<nnn>, values that are not keys of `jira`, and values two entries share are dropped. Anything else (no Jira mode, no file, a bad file): {}."""
    if not jira:
        return {}
    try:
        with open(os.path.join(root, "backlog", "MIGRATED.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    good = {k: v for k, v in data.items()
            if isinstance(k, str) and isinstance(v, str) and re.match(r"^B-\d+$", k) and re.match(rf"^{re.escape(jira)}-\d+$", v)}
    seen = [v for v in good.values()]
    return {k: v for k, v in good.items() if seen.count(v) == 1}      # a key two items share would merge them: use neither


def story_epic(fields, jira=None, migrated=None):
    """The backlog item id a story belongs to, or None: the `epic:` field (`none` gives None), else for older stories the first
    B-<nnn> in `requested`, then in `title`, then a `from B-<nnn>` in the priority reason. The dev board's epic_of agrees
    (it also drops an id with no backlog file; this does not look at backlog/). In Jira mode (`jira` = the project key) an id may
    also be a key of that project (`SCAF-3`); the story's own `jira:` key is never taken for its epic. `migrated` ({B-id: key},
    see load_migrated) turns a B- id into the Jira key its item moved to."""
    id_re, from_re = epic_regexes(jira)
    own = story_jira_key(fields)
    migrated = migrated or {}
    if "epic" in fields:
        v = fields["epic"]
        m = None if EPIC_NONE_RE.match(v) else id_re.search(v)
        return migrated.get(m.group(0), m.group(0)) if m else None
    for text, rx in ((_requested_text(fields, jira), id_re), (fields.get("title", ""), id_re),
                     (_priority_reason_text(fields), from_re)):
        for m in rx.finditer(text):
            found = m.group(1) if rx is from_re else m.group(0)
            if found != own:
                return migrated.get(found, found)
    return None


def _named_epic_problems(fields, epic, has_backlog, jira=None, migrated=None):
    """A new story whose `requested` (any B-<nnn> in it) or `priority_reason` (`from B-<nnn>`) names a backlog item must have
    that item as its epic; with several named in requested, any one will do."""
    out = []
    migrated = migrated or {}
    canon = lambda x: migrated.get(x, x)         # a migrated B- id and its Jira key are the same item
    id_re, from_re = epic_regexes(jira)
    own = story_jira_key(fields)
    for where, text, rx in (("requested", _requested_text(fields, jira), re.compile(r"\b(?:B-\d{3}|%s)\b" % (re.escape(jira) + r"-\d+" if jira else r"(?!)"))),
                            ("priority_reason", _priority_reason_text(fields), from_re)):
        named = []
        for m in rx.finditer(text):
            bid = m.group(1) if rx is from_re else m.group(0)
            if bid == own:
                continue
            if bid not in named and (has_backlog is None or not bid.startswith("B-") or has_backlog(bid)):
                named.append(bid)
        if named and canon(epic) not in [canon(n) for n in named]:
            first = named[0]
            others = f" (or {' or '.join(named[1:])})" if named[1:] else ""
            out.append(f"epic: {where} names {', '.join(named)} but epic is {epic}: write 'epic: {first}'{others}, "
                       f"or take {first if not named[1:] else 'them'} out of {where} if the story is not part of it")
    return out


def _new_epic_priority_problems(fields, sid, owner, spawned, backlog_priority, has_backlog, jira=None, migrated=None):
    """Rules for stories dated from FIELDS_FROM: epic, then priority + priority_reason. `jira`: the Jira project key in Jira
    mode, where `epic:` also takes a key of that project (not looked up: this tool cannot read Jira)."""
    out = []
    epic = fields.get("epic", "").strip()
    form = "epic: write 'epic: none' or 'epic: B-<nnn>' naming an item in backlog/"
    if jira:
        form = f"epic: write 'epic: none' or 'epic: {jira}-<n>' naming a {jira} epic in Jira"
    ok = rf"^(none|B-\d+|{re.escape(jira)}-\d+)$" if jira else r"^(none|B-\d+)$"
    other = JIRA_KEY_RE.match(epic) if jira else None
    if "epic" not in fields:
        out.append(form.replace("epic: write", "epic: missing, write", 1))
    elif other and not epic.startswith(jira + "-"):
        out.append(f"epic: {epic} is a key of project {epic.rsplit('-', 1)[0]}, but this project's Jira project is {jira}: "
                   f"{form[len('epic: '):]}")
    elif not re.match(ok, epic):
        out.append(f"{form} (got {epic[:40]!r})")
    elif epic.startswith("B-") and has_backlog is not None and not has_backlog(epic):
        out.append(f"epic: {epic} is not in backlog/ (no backlog/{epic}.md"
                   + (", and not in backlog/MIGRATED.json" if jira else "") + f"): {form[len('epic: '):]}")
    if re.match(ok, epic):
        out += _named_epic_problems(fields, epic, has_backlog, jira, migrated)
    if "priority" not in fields:
        out.append("priority: missing (write e.g. 'priority: P3' and 'priority_reason: default'; the rubric is in dev-requests.md)")
    elif "priority_reason" in fields:
        out += [p] if (p := parse_priority_split(fields["priority"], fields["priority_reason"], sid, owner, spawned, backlog_priority,
                                                 story_jira_key(fields))[1]) else []
    else:
        first = fields["priority"].split("\n")[0].strip()
        m = COMBINED_PRIORITY_RE.match(first)
        if m:
            out.append(f"priority: from {FIELDS_FROM} the level and the reason are separate fields: write 'priority: {m.group(1)}' "
                       f"and 'priority_reason: {m.group(2)}'")
        elif re.match(r"^P[1-5]$", first):
            out.append(f"priority_reason: missing (write the rubric line, one of {PRIORITY_FORMS})")
        else:
            out.append("priority: write the level alone, 'P<1-5>'; the rubric line goes in 'priority_reason:'")
    return out


def _new_depends_title_problems(fields):
    out = []
    if "depends_on" not in fields:
        out.append("depends_on: missing (write 'depends_on: none', or the story ids it needs)")
    else:
        v = fields["depends_on"].strip()
        if not (v.lower() == "none" or DEPENDS_IDS_RE.match(v)):
            out.append("depends_on: write 'none', or story ids separated by commas, nothing else "
                       "(e.g. 'DEV-2026-10-27-001, DEV-2026-10-27-002'); put conditions that aren't stories in `preconditions:`")
    if "title" in fields:
        t = fields["title"].strip()
        why = ("is over 80 characters" if len(t) > 80 else "has a backtick" if "`" in t
               else "starts with 'Site:'" if re.match(r"site:", t, re.I) else "starts with a story id" if re.match(r"DEV-", t, re.I) else None)
        if why:
            out.append(f"title: {why} (80 characters or fewer, no backticks, not starting 'Site:' or a story id): {TITLE_RULE}")
    return out


def field_problems(fields, sid, owner=None, spawned=False, backlog_priority=None, has_backlog=None, jira=None, migrated=None):
    """Problems with a story's epic, priority, size, depends_on, title and expedite lines. New stories (see PRIORITY_FROM) must carry
    priority, size and depends_on; stories dated from FIELDS_FROM also carry epic and priority_reason and keep each field to its one form.
    has_backlog: bid -> bool, to check that an epic names a backlog item; None skips that check. jira: the Jira project key
    in Jira mode (epic may then be a key of that project, never looked up), else None."""
    new, out = is_new(sid), []
    if fields_new(sid):
        out += _new_epic_priority_problems(fields, sid, owner, spawned, backlog_priority, has_backlog, jira, migrated)
    elif "priority" in fields:
        out += [p] if (p := priority_of(fields, sid, owner, spawned, backlog_priority)[1]) else []
    elif new:
        out.append("priority: missing (write e.g. 'priority: P3, default'; the rubric is in dev-requests.md)")
    if "size" in fields:
        out += [p] if (p := parse_size(fields["size"])[1]) else []
    elif new:
        out.append("size: missing (write e.g. 'size: M'; XS, S, M, L or XL)")
    if fields_new(sid):
        out += _new_depends_title_problems(fields)
    elif new:
        if "depends_on" not in fields:
            out.append("depends_on: missing (write 'depends_on: none', or the story ids it needs)")
        elif not depends_on(fields["depends_on"])[1]:
            out.append("depends_on: must start with `none` or the story ids it needs, e.g. "
                       "`depends_on: DEV-2026-10-27-001, DEV-2026-10-27-002 merged to master`")
    if "expedite" in fields:
        out += [p] if (p := parse_expedite(fields["expedite"], owner, spawned)[1]) else []
    return out


def field_warnings(fields):
    return ["size XL: cut it into smaller stories before posting (13+ points)"] if parse_size(fields.get("size"))[0] == "XL" else []


def _problems(s, owner, backlog_priority, has_backlog=None, jira=None, migrated=None):
    f = s.get("fields") or {}
    return field_problems(f, s["id"], owner, "origin" in f, backlog_priority, has_backlog, jira, migrated)


def open_expedites(stories, owner=None, backlog_priority=None, has_backlog=None, jira=None, migrated=None):
    """[(date, id)] of the open expedite stories, first to go first: waiting ones, and claimed ones not blocked or failed.
    A story whose file has problems is held for those, so it doesn't count."""
    out = []
    for s in stories:
        f = s.get("fields") or {}
        if "expedite" not in f:
            continue
        if s["where"] == "in-progress":
            if s.get("status") in ("blocked", "failed"):
                continue
        elif s["where"] != "code-inbox" or "paused" in f:
            continue
        ex = parse_expedite(f["expedite"], owner, "origin" in f)[0]
        if ex and not _problems(s, owner, backlog_priority, has_backlog, jira, migrated):
            out.append((ex[0], s["id"]))
    return sorted(out)


def rank(stories, today, owner=None, backlog_priority=None, has_backlog=None, jira=None, migrated=None):
    """stories: [{"id", "where": "code-inbox"|"in-progress"|"done"|"staged", "fields": dict, "rejected": bool,
                  "status": str|None}]  # status: the Result block's `- status:` word, if known (built|blocked|failed|waiting)
    Duplicates are resolved by the caller. Returns {"order": [ready ids in claim order], "held": [(id, why)],
    "info": {id: {priority, priority_now, size, expedite, deps, waits_for, blocks, state, why, age_days, problems}},
    "alerts": [str]}."""
    state, info, deps = {}, {}, {}
    for s in stories:
        f = s.get("fields") or {}
        if s["where"] == "done" or s["where"] == "staged":
            state[s["id"]] = "rejected" if s.get("rejected") else ("merged" if s["where"] == "done" else "staged")
        elif s["where"] == "in-progress":
            state[s["id"]] = "claimed"
        else:
            state[s["id"]] = "paused" if "paused" in f else "waiting"
    waiting = sorted(i for i, st in state.items() if st == "waiting")
    for s in stories:
        sid, f = s["id"], s.get("fields") or {}
        spawned = "origin" in f
        deps[sid] = depends_on(f.get("depends_on"))[0]
        pr = priority_of(f, sid, owner, spawned, backlog_priority)[0] if "priority" in f else None
        sz = parse_size(f["size"])[0] if "size" in f else None
        age = max(0, (today - story_day(sid)).days) if state[sid] in ("waiting", "paused") and story_day(sid) else None
        now = max(1, (pr or DEFAULT_PRIORITY) - (age or 0) // AGE_DAYS) if state[sid] in ("waiting", "paused") else pr
        info[sid] = {"priority": pr, "priority_now": now, "size": sz,
                     "expedite": "expedite" in f and parse_expedite(f["expedite"], owner, spawned)[0] is not None,
                     "deps": deps[sid], "waits_for": [d for d in deps[sid] if state.get(d) != "merged"], "blocks": 0,
                     "state": state[sid], "why": None, "age_days": age,
                     "problems": [] if state[sid] in ("merged", "rejected") else _problems(s, owner, backlog_priority, has_backlog, jira, migrated)}
    closure = {}
    for sid in state:
        seen, stack = set(), list(deps[sid])
        while stack:
            d = stack.pop()
            if d in seen or d not in state or state[d] == "merged":
                continue
            seen.add(d)
            stack.extend(deps[d])
        closure[sid] = seen
    for y in waiting:
        for x in closure[y] - {y}:
            info[x]["blocks"] += 1
    exp = open_expedites(stories, owner, backlog_priority, has_backlog, jira, migrated)
    first = exp[0] if exp else None
    held, alerts, cycles = {}, [], set()
    fixes, seconds = [], []
    for sid in waiting:
        if info[sid]["problems"]:
            held[sid] = "fix: " + "; ".join(info[sid]["problems"])
            fixes.append(f"{sid} is held until its file is fixed: " + "; ".join(info[sid]["problems"]))
        elif first and sid in [i for _, i in exp] and sid != first[1]:
            held[sid] = f"second expedite: {first[1]} has it; this one goes when that is merged, or remove its expedite line"
            seconds.append(f"{sid} carries a second expedite while {first[1]} has one")
        elif sid in closure[sid]:
            ring = sorted({z for z in closure[sid] if sid in closure[z]} | {sid})
            held[sid] = "dependency cycle through " + ", ".join(ring)
            cycles.add(tuple(ring))
        elif info[sid]["waits_for"]:
            held[sid] = ""
    words = {"claimed": "in progress", "staged": "staged", "rejected": "rejected", "paused": "paused"}
    for sid in waiting:
        if held.get(sid) == "":
            held[sid] = "needs " + ", ".join(
                f"{d} ({words.get(state.get(d), 'held' if d in held else 'waiting') if d in state else 'not found'})"
                for d in info[sid]["waits_for"])
    alerts += fixes + seconds + ["dependency cycle: " + ", ".join(c) for c in sorted(cycles)]
    for sid in waiting:
        for d in info[sid]["deps"]:
            if d not in state or state[d] == "rejected":
                alerts.append(f"{sid} needs {d}, which " + ("isn't on the board" if d not in state else "was rejected"))
    p1 = sum(1 for i in waiting if info[i]["priority"] == 1)
    if len(waiting) >= 3 and 3 * p1 > len(waiting):
        alerts.append(f"{p1} of {len(waiting)} waiting stories are P1 (over a third): tell {owner or 'the owner'}, once a day")
    for sid in waiting:
        info[sid]["state"] = "held" if sid in held else "ready"
        info[sid]["why"] = held.get(sid)

    def key(sid):
        i = info[sid]
        group = 0 if i["expedite"] else (1 if i["blocks"] > 0 else 2)
        return (group, -i["blocks"] if group == 1 else 0, i["priority_now"], SIZES.index(i["size"] or DEFAULT_SIZE), sid)
    return {"order": sorted((i for i in waiting if i not in held), key=key),
            "held": [(i, held[i]) for i in waiting if i in held], "info": info, "alerts": alerts}


WAIT_ACTION_RE = re.compile(r"^action:[A-Za-z0-9][A-Za-z0-9._\-]*$")
WAIT_TEXT_RE = re.compile(r"^(?P<text>\S(?:.*\S)?) \(since (?P<date>\d{4}-\d{2}-\d{2})\)$")


def parse_waits_on(value):
    """A backlog item's `waits_on` value as [(kind, ref)]: ('action', id), ('msg', MSG id), ('story', DEV id) and
    ('text', (text, datetime.date)). Entries are separated by `; `. Raises ValueError naming the first bad entry."""
    out = []
    for entry in value.split("; "):
        m = WAIT_TEXT_RE.match(entry)
        if WAIT_ACTION_RE.match(entry):
            out.append(("action", entry[len("action:"):]))
        elif THREAD_RE.match(entry):
            out.append(("msg", entry))
        elif STORY_RE.match(entry):
            out.append(("story", entry))
        elif m and ";" not in m.group("text"):
            try:
                out.append(("text", (m.group("text"), datetime.date.fromisoformat(m.group("date")))))
            except ValueError:
                raise ValueError(f"waits_on entry has a date that is not real: {entry!r}")
        else:
            raise ValueError(f"waits_on entry is not action:<id>, MSG-..., DEV-... or '<text> (since YYYY-MM-DD)' "
                             f"(no ';' in the text): {entry!r}")
    return out


def _requester(requested):
    m = re.search(r"\bby\s+(.+?)(?:\s+via\b|\s+from\b|[,;(]|$)", requested or "", re.I)
    return m.group(1).strip() if m else "unknown"


def format_queue(stories, result, stats=False):
    """The `queue` command's output lines."""
    titles = {s["id"]: (s.get("fields") or {}).get("title", "") for s in stories}
    info, out = result["info"], []
    for sid in result["order"]:
        i = info[sid]
        tags = ["expedite"] if i["expedite"] else ([f"blocks {i['blocks']}"] if i["blocks"] else [])
        now, w, d = i["priority_now"], i["priority"], i["age_days"]
        aged = d is not None and d >= AGE_DAYS
        if w is None:
            tags.append(f"P{now} (no priority line{f', waiting {d} days' if aged else ''})")
        else:
            tags.append(f"P{now}" if now == w else f"P{now} (written P{w}, waiting {d} days)")
        tags.append(i["size"] or f"{DEFAULT_SIZE} (no size line)")
        out.append(f"{sid} | {' · '.join(tags)} | {titles[sid]}")
    if not result["order"]:
        out.insert(0, "NOTHING")
    out += [f"held {sid} | {why} | {titles[sid]}" for sid, why in result["held"]]
    out += ["ALERT: " + a for a in result["alerts"]]
    if stats:
        wait = [i for i in info.values() if i["state"] in ("ready", "held")]
        pr, now = ({k: sum(1 for i in wait if i[f] == k) for k in [*range(1, 6), None]} for f in ("priority", "priority_now"))
        sz = {k: sum(1 for i in wait if i["size"] == k) for k in [*SIZES, None]}
        out.append(f"stats: {len(wait)} waiting: {len(result['order'])} ready, {len(result['held'])} held; "
                   f"{sum(1 for i in info.values() if i['state'] == 'paused')} paused; {sum(1 for i in wait if i['expedite'])} expedite; "
                   f"{sum(1 for i in wait if i['blocks'])} blocking others")
        out.append("stats: priority as written: " + ", ".join(f"P{k} {pr[k]}" for k in range(1, 6)) + f", none {pr[None]}; now: "
                   + ", ".join(f"P{k} {now[k]}" for k in range(1, 6)))
        out.append("stats: size: " + ", ".join(f"{k} {sz[k]}" for k in SIZES) + f", none {sz[None]}")
        by = {}
        for s in stories:
            f, i = s.get("fields") or {}, info[s["id"]]
            pts = re.search(r"\d+", f.get("story_points", ""))
            if i["state"] == "merged" and i["size"] and pts:
                by.setdefault(_requester(f.get("requested")), []).append((i["size"], int(pts.group(0))))
        parts = []
        for name in sorted(by):
            ok = sum(1 for size, p in by[name] if SIZE_BANDS[size][0] <= p and (SIZE_BANDS[size][1] is None or p <= SIZE_BANDS[size][1]))
            seen = "; ".join(f"{z} " + ",".join(str(p) for p in sorted({p for s, p in by[name] if s == z})) for z in SIZES
                             if any(s == z for s, _ in by[name]))
            parts.append(f"{name} {ok} of {len(by[name])} in band ({seen})")
        out.append("stats: sizing, merged stories: " + ("; ".join(parts) if parts else "none has both a size and story points yet"))
    return out


def format_epics(items):
    lines, notes = [], []
    for it in items:
        counts = f"done {len(it['done'])}, open {len(it['open'])}, rejected {len(it['rejected'])}"
        lines.append(f"{it['id']} {it['status']} | {counts} | {it['verdict']}")
        if it["changed"]:
            lines.append(f"CHANGED {it['id']} {it['status']} -> {it['new_status']}")
        notes += it["notes"]
    return lines + [n for n in notes if n.startswith("STALE")] + [n for n in notes if n.startswith("UNKNOWN")]


BACKLOG_STATUSES = ("To Do", "In Progress", "In Review", "Done", "Rejected")
EPICS_JSON_KEYS = ("id", "status", "done", "open", "rejected", "waits_on", "verdict", "changed")


class Mail:
    def __init__(self, root, today=None, action_status=None):
        self.root = root
        self._action_status = action_status   # id -> "open"|"done"|"dropped"|None; else the project's _tools/backlog_waits.py
        self._hook = None
        self.today = today or datetime.date.today()
        self.dev = os.path.join(root, "_dev")
        self.box = os.path.join(self.dev, "cowork-inbox")
        self.closed_dir = os.path.join(self.box, "closed")
        self.stories_dir = os.path.join(self.dev, "code-inbox")
        self.cfg = load_config(os.path.join(root, CONFIG_REL))
        self.owner = load_owner(root)
        self.team = load_team(root)
        self.me = whoami(root, self.team)
        self.jira = jira_project(root)       # the Jira project key in Jira mode, else None

    # --- team mode -----------------------------------------------------------------------------------------
    def _need_me(self):
        if self.team and not self.me:
            raise MailError(NO_MEMBER)

    def _id_tag(self):
        """'' in single-player or for the empty-prefix member, else 'GC-': what goes between the date and the number."""
        if not self.team:
            return ""
        self._need_me()
        pfx = self.team["members"][self.me]["prefix"]
        return pfx + "-" if pfx else ""

    def _mine(self, xid):
        return not self.team or owner_of(xid, self.team) == self.me

    def _set_writers(self, writers):
        """Rewrite team.data_writers in scaffolding.json, dropping the legacy `data_writer` (kept at its key's place) and every other
        key as it was, in the file's own indent (2 today; the first of 2, 1, 4 that reproduces the file as read)."""
        path = os.path.join(self.root, ".claude", "scaffolding.json")
        text = _read(path)
        rec = json.loads(text)
        indent = next((n for n in (2, 1, 4) if json.dumps(rec, indent=n) + "\n" == text), 2)
        team, out = rec["team"], {}
        for k, v in team.items():
            if k == "data_writer":
                continue
            out[k] = v
            if k == "members":
                out["data_writers"] = writers
        out["data_writers"] = writers
        rec["team"] = out
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(rec, indent=indent) + "\n")
        self.team = load_team(self.root)

    def grant_or_revoke(self, login, grant):
        """`team --grant-writer|--revoke-writer LOGIN`: the owner's alone. Returns the lines to print (a NOOP changes nothing)."""
        if not self.team:
            raise MailError("no team is set in .claude/scaffolding.json")
        t = self.team
        if self.me != t["owner"]:
            raise TeamRefused(f"only the owner ({t['owner']}) grants or revokes data writers; this machine is {self.me or 'no member'}")
        if login not in t["members"]:
            raise TeamRefused(f"{login!r} is not a team member (members: {', '.join(t['members'])})")
        has = login in t["data_writers"]
        if has == grant:
            return [f"NOOP {login} {'already writes' if grant else 'is not a data writer'}"] + self.team_lines()
        writers = t["data_writers"] + [login] if grant else [w for w in t["data_writers"] if w != login]
        self._set_writers(writers)
        out = [f"{'GRANTED' if grant else 'REVOKED'} {login}"]
        if not writers:
            out.append("WARNING: nobody is a data writer now; no Mac can change the model until the owner grants one")
        return out + self.team_lines() + [
            f"NEXT: commit .claude/scaffolding.json with {git_tool_rel(self.root)} (commit --paths .claude/scaffolding.json) and push, "
            "so the other Macs see it"]

    def team_lines(self, me=None):
        """The `team` command's output; with `me`, first records this machine's member."""
        if not self.team:
            if me:
                raise MailError("no team is set in .claude/scaffolding.json")
            return ["mode single"]
        if me:
            if me not in self.team["members"]:
                raise MailError(f"{me!r} is not a team member (members: {', '.join(self.team['members'])})")
            os.makedirs(os.path.join(self.root, ".claude"), exist_ok=True)
            with open(os.path.join(self.root, ".claude", "member.json"), "w", encoding="utf-8") as f:
                json.dump({"login": me}, f)
                f.write("\n")
            keep_ignored(self.root)
            self.me = me
            return [f"ME {me}"]
        pf = lambda login: self.team["members"][login]["prefix"] or "-"
        out = ["mode team", f"me {self.me} prefix {pf(self.me)}" if self.me else "me none"]
        out += [f"member {login} {m['name']} prefix {pf(login)}" + (" data-writer" if login in self.team["data_writers"] else "") + (" owner" if login == self.team["owner"] else "")
                for login, m in self.team["members"].items()]
        out.append(pen_state(self.root))
        for p in sorted(glob.glob(os.path.join(self.dev, "in-progress", "DEV-*.md"))):
            sid = os.path.basename(p)[:-3]
            who = claimer_of(_read(p)) or owner_of(sid, self.team)
            out.append(f"in-progress {sid} " + ("mine" if who and who == self.me else who or "unknown"))
        return out

    # --- reading -------------------------------------------------------------------------------------------
    def _thread_files(self):
        return sorted(glob.glob(os.path.join(self.box, "MSG-*.md")) + glob.glob(os.path.join(self.closed_dir, "*", "MSG-*.md")))

    def threads(self):
        for p in self._thread_files():
            h, turns = parse_thread(_read(p))
            yield h, turns, p

    def load(self, tid):
        if not THREAD_RE.match(tid):
            raise MailError(f"{tid!r} is not a thread id")
        for h, turns, p in self.threads():
            if h.get("id") == tid:
                return h, turns, p
        raise MailError(f"no thread {tid}")

    def story_files(self):
        pats = [os.path.join(self.dev, d, "DEV-*.md") for d in ("code-inbox", "in-progress")]
        pats.append(os.path.join(self.dev, "done", "*", "DEV-*.md"))
        return sorted(f for p in pats for f in glob.glob(p))

    def find_story(self, sid, active_only=False):
        if not STORY_RE.match(sid):
            raise MailError(f"{sid!r} is not a story id")
        for p in self.story_files():
            if os.path.basename(p) == sid + ".md":
                if active_only and f"{os.sep}done{os.sep}" in p:
                    break
                hd = story_header(_read(p))
                return {"path": p, "chain": hd.get("chain", sid), "depth": int(hd.get("depth", "0") or 0),
                        "origin": hd.get("origin")}
        raise MailError(f"no {'active ' if active_only else ''}story {sid} (code-inbox, in-progress{'' if active_only else ', done'})")

    def posts_today(self):
        day = self.today.isoformat()
        n = sum(1 for h, _, _ in self.threads() if h.get("opened") == day)
        n += sum(1 for p in self.story_files() if story_header(_read(p)).get("spawned") == day)
        return n

    def _used(self, story, kind):
        return sum(1 for h, _, _ in self.threads() if h.get("story") == story and h.get("kind") == kind)

    def _need_room(self):
        open_n = sum(1 for h, _, _ in self.threads() if h.get("status") != "closed")
        if open_n >= self.cfg["max_open_threads"]:
            raise Refused(f"{open_n} threads are already open (max_open_threads {self.cfg['max_open_threads']})")
        if self.posts_today() >= self.cfg["max_posts_per_day"]:
            raise Refused(f"today's posting cap is reached (max_posts_per_day {self.cfg['max_posts_per_day']})")

    def _now(self):
        return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M")

    def _check_body(self, body, limit_key="max_body_chars"):
        if not body or not body.strip():
            raise MailError("the body is empty")
        if len(body.strip()) > self.cfg[limit_key]:
            raise MailError(f"the body is {len(body.strip())} characters; {limit_key} is {self.cfg[limit_key]}. Make it terser")

    def _next_id(self, prefix, names):
        day, tag = self.today.isoformat(), self._id_tag()
        used = [int(m.group(1)) for n in names for m in [re.match(rf"{prefix}-{day}-{tag}(\d{{3}})", n)] if m]
        return max(used, default=0) + 1

    def next_story_id(self):
        names = [os.path.basename(p) for p in glob.glob(os.path.join(self.dev, "**", "DEV-*.md"), recursive=True)]
        names += [os.path.basename(p) for p in glob.glob(os.path.join(self.root, "_design", "staged-stories", "**", "DEV-*.md"), recursive=True)]
        n = self._next_id('DEV', names)
        return f"DEV-{self.today.isoformat()}-{self._id_tag()}{n:03d}"

    # --- budget --------------------------------------------------------------------------------------------
    def budget(self, story):
        s = self.find_story(story, active_only=True)
        c = self.cfg
        return {"story": story, "chain": s["chain"], "depth": s["depth"], "max_chain_depth": c["max_chain_depth"],
                "question_rounds_left": max(0, c["max_question_rounds_per_story"] - self._used(story, "question")),
                "jobs_left": 0 if s["depth"] + 1 > c["max_chain_depth"] else max(0, c["max_jobs_per_story"] - self._used(story, "job"))}

    # --- Code opens a thread -------------------------------------------------------------------------------
    def open(self, kind, story, subject, body, reply_format=None, after_merge=False):
        if kind not in COWORK_TYPES:
            raise MailError(f"kind must be question or job, not {kind!r}")
        if after_merge and kind != "job":
            raise MailError("--after-merge is for jobs only")
        s = self.find_story(story, active_only=True)
        c = self.cfg
        self._check_body(body)
        subject = " ".join(subject.split())
        if not subject:
            raise MailError("a thread needs a subject")
        if kind == "question":
            if not reply_format:
                raise MailError("a question must say the reply format it needs (--reply-format), e.g. 'one of A | B' or 'a date'")
            if self._used(story, "question") >= c["max_question_rounds_per_story"]:
                raise Refused(f"{story} has used its {c['max_question_rounds_per_story']} question rounds (max_question_rounds_per_story)")
            if any(h.get("story") == story and h.get("kind") == "question" and h.get("status") != "closed" for h, _, _ in self.threads()):
                raise Refused(f"{story} already has a question open: wait for its answer")
            depth = s["depth"]
        else:
            if s["depth"] + 1 > c["max_chain_depth"]:
                raise Refused(f"{story} is at chain depth {s['depth']} and a job would be depth {s['depth'] + 1} (max_chain_depth {c['max_chain_depth']})")
            if self._used(story, "job") >= c["max_jobs_per_story"]:
                raise Refused(f"{story} has opened its {c['max_jobs_per_story']} jobs (max_jobs_per_story)")
            depth = s["depth"] + 1
        self._need_room()
        os.makedirs(self.box, exist_ok=True)
        n = self._next_id("MSG", [os.path.basename(p) for p in self._thread_files()])
        while True:
            tid = f"MSG-{self.today.isoformat()}-{self._id_tag()}{n:03d}"
            h = {"id": tid, "kind": kind, "story": story, "chain": s["chain"], "depth": str(depth), "status": "awaiting-cowork",
                 "opened": self.today.isoformat(), "counter_questions_used": "0", "spawned": "none", "subject": subject}
            turn = {"from": "code", "type": kind, "at": self._now(), "body": _clean(body)}
            if reply_format:
                turn["reply_format"] = " ".join(reply_format.split())
            if after_merge:
                h["needs"] = "story-merged"
            if _publish(os.path.join(self.box, tid + ".md"), render_thread(h, [turn])):
                return tid
            n += 1

    # --- a reply -------------------------------------------------------------------------------------------
    def reply(self, tid, who, typ, body, reply_format=None):
        h, turns, path = self.load(tid)
        if who not in ("code", "cowork"):
            raise MailError("--as must be code or cowork")
        status, kind, c = h["status"], h["kind"], self.cfg
        if status == "closed" or status == "answered":
            raise MailError(f"{tid} is {status}: nothing to reply to")
        turn = {"from": who, "type": typ, "at": self._now()}
        if who == "cowork":
            if status != "awaiting-cowork":
                raise MailError(f"{tid} is {status}: not Cowork's turn")
            if typ not in COWORK_TYPES[kind]:
                raise MailError(f"on a {kind} thread Cowork replies with one of {', '.join(COWORK_TYPES[kind])}, not {typ!r}")
            if typ == "counter-question":
                used = int(h["counter_questions_used"])
                if used >= c["max_counter_questions_per_question"]:
                    raise Refused(f"{tid} has used its {c['max_counter_questions_per_question']} counter-questions "
                                  "(max_counter_questions_per_question): answer with what you have, or reply cannot-answer")
                if not reply_format:
                    raise MailError("a counter-question must say the reply format it needs (--reply-format)")
                self._check_body(body, "max_counter_question_chars")
                h["counter_questions_used"] = str(used + 1)
                h["status"] = "awaiting-code"
                turn["reply_format"] = " ".join(reply_format.split())
            else:
                self._check_body(body)
                h["status"] = "answered"
        else:
            if status != "awaiting-code":
                raise MailError(f"{tid} is {status}: not Code's turn")
            if typ != "answer":
                raise MailError("Code replies to a counter-question with an answer, never a question")
            self._check_body(body)
            h["status"] = "awaiting-cowork"
        turn["body"] = _clean(body)
        _replace(path, render_thread(h, turns + [turn]))
        return h["status"]

    # --- Code files a thread -------------------------------------------------------------------------------
    def close(self, tid, withdraw=False):
        h, turns, path = self.load(tid)
        if h["status"] == "closed":
            raise MailError(f"{tid} is already closed")
        if h["status"] != "answered" and not withdraw:
            raise MailError(f"{tid} is {h['status']}: close only an answered thread (--withdraw drops one still waiting)")
        h["status"] = "closed"
        h["closed"] = self.today.isoformat() + (" withdrawn" if withdraw else "")
        dest = os.path.join(self.closed_dir, self.today.strftime("%Y-%m"))
        os.makedirs(dest, exist_ok=True)
        _replace(path, render_thread(h, turns))
        os.rename(path, os.path.join(dest, tid + ".md"))  # rename, not copy and delete: the mount refuses unlink

    # --- Cowork spawns a story -----------------------------------------------------------------------------
    def spawn_story(self, tid, draft_text):
        h, turns, path = self.load(tid)
        c = self.cfg
        if h["status"] != "awaiting-cowork":
            raise MailError(f"{tid} is {h['status']}: Cowork spawns a story only while it is working the thread")
        depth = int(h["depth"]) + 1
        if depth > c["max_chain_depth"]:
            raise Refused(f"a story spawned from {tid} would be chain depth {depth} (max_chain_depth {c['max_chain_depth']}): "
                          f"put it under 'for {self.owner or 'the owner'}' instead")
        spawned = [] if h["spawned"] == "none" else h["spawned"].split(", ")
        if len(spawned) >= c["max_stories_spawned_per_thread"]:
            raise Refused(f"{tid} has spawned {len(spawned)} stories (max_stories_spawned_per_thread)")
        missing = [f for f in STORY_FIELDS if not re.search(rf"(?m)^{f}:", draft_text)]
        if missing:
            raise MailError(f"the draft lacks required story fields: {', '.join(missing)}")
        bad = field_problems(story_fields(draft_text), f"DEV-{self.today.isoformat()}-000", self.owner, True, self.backlog_priority,
                           self.has_backlog, self.jira, load_migrated(self.root, self.jira))
        if bad:
            raise MailError("the draft: " + "; ".join(bad))
        self._need_room()
        body = re.sub(r"(?m)^(id|origin|chain|depth|spawned|requested):.*\n?", "", draft_text).lstrip("\n")
        os.makedirs(self.stories_dir, exist_ok=True)
        names = [os.path.basename(p) for p in glob.glob(os.path.join(self.dev, "**", "DEV-*.md"), recursive=True)]
        names += [os.path.basename(p) for p in glob.glob(os.path.join(self.root, "_design", "staged-stories", "**", "DEV-*.md"), recursive=True)]
        n = self._next_id("DEV", names)
        while True:
            sid = f"DEV-{self.today.isoformat()}-{self._id_tag()}{n:03d}"
            stamp = (f"id: {sid}\norigin: {tid}\nchain: {h['chain']}\ndepth: {depth}\nspawned: {self.today.isoformat()}\n"
                     f"requested: {self.today.isoformat()}, spawned by Cowork from {tid} (story {h['story']}), not a new request from {self.owner or 'the owner'}\n")
            if _publish(os.path.join(self.stories_dir, sid + ".md"), stamp + body):
                break
            n += 1
        h["spawned"] = ", ".join(spawned + [sid])
        _replace(path, render_thread(h, turns))
        return sid, depth

    # --- story priority -------------------------------------------------------------------------------------
    def backlog_priority(self, bid):
        try:
            m = re.search(r"(?m)^priority:\s*P([1-5])\b", _read(os.path.join(self.root, "backlog", bid + ".md")))
        except OSError:
            return None
        return int(m.group(1)) if m else None

    def has_backlog(self, bid):
        """A B- item exists: its backlog/<id>.md is there, or (Jira mode) the item moved to Jira and is in MIGRATED.json."""
        return os.path.isfile(os.path.join(self.root, "backlog", bid + ".md")) or bid in load_migrated(self.root, self.jira)

    def _rejected_staged(self, path):
        """True for a draft under _design/staged-stories/shelved/ or withdrawn/ (the staged pattern also reaches them)."""
        rel = os.path.relpath(path, os.path.join(self.root, "_design", "staged-stories")).split(os.sep)
        return len(rel) > 1 and rel[0] in ("shelved", "withdrawn")

    def queue_stories(self):
        """Every story the queue looks at, one per id (done > in-progress > code-inbox > staged), as rank() wants them."""
        places = [("done", os.path.join(self.dev, "done", "*", "DEV-*.md"), False),
                  ("in-progress", os.path.join(self.dev, "in-progress", "DEV-*.md"), False),
                  ("code-inbox", os.path.join(self.dev, "code-inbox", "DEV-*.md"), False),
                  ("staged", os.path.join(self.root, "_design", "staged-stories", "**", "DEV-*.md"), False)]
        places += [("staged", os.path.join(self.root, "_design", "staged-stories", d, "**", "DEV-*.md"), True) for d in ("shelved", "withdrawn")]
        found = {}
        for where, pat, shelved in places:
            for p in sorted(glob.glob(pat, recursive=True)):
                if where == "staged" and not shelved and self._rejected_staged(p):
                    continue
                sid = os.path.basename(p)[:-3]
                if sid in found:
                    continue
                text = _read(p)
                fields = story_fields(text)
                rejected = shelved or (where == "done" and bool(CLOSED_REJECTED_RE.match(fields.get("closed", ""))))
                status = None
                if where == "in-progress":
                    wt = os.path.join(self.root, ".claude", "worktrees", sid, "_dev", "in-progress", sid + ".md")
                    for src in (wt, p):
                        try:
                            res = _read(src).partition("\n## Result")[2]
                        except OSError:
                            continue
                        m = re.search(r"(?m)^- status:\s*(\w+)", res)
                        status = m.group(1).lower() if m else None
                        break
                found[sid] = {"id": sid, "where": where, "fields": fields, "rejected": rejected, "status": status}
        return [found[k] for k in sorted(found)]

    # --- backlog items follow their stories ---------------------------------------------------------------------
    def _backlog_ids(self):
        return sorted(os.path.basename(p)[:-3] for p in glob.glob(os.path.join(self.root, "backlog", "B-*.md"))
                      if re.match(r"^B-\d+\.md$", os.path.basename(p)))

    @staticmethod
    def _backlog_head(text):
        """The header lines of a backlog file (up to the first blank line) as {key: value}."""
        head = {}
        for line in text.split("\n"):
            if not line:
                break
            k, sep, v = line.partition(": ")
            if sep:
                head[k] = v
        return head

    @staticmethod
    def _backlog_rewrite(text, status, changed, note, drop_waits=False):
        """text with the status and status_changed header lines replaced and, when note is given, status_note replaced or
        added as the last header line (right after status_changed); with drop_waits the waits_on line is removed. Nothing
        else in the file moves."""
        lines = text.split("\n")
        end = lines.index("") if "" in lines else len(lines)
        at = {}
        for i, line in enumerate(lines[:end]):
            k = line.partition(": ")[0] if ": " in line else line.rstrip(":")
            at.setdefault(k, i)
        if "status" not in at or "status_changed" not in at:
            raise MailError("the backlog file has no status or status_changed header line")
        lines[at["status"]] = f"status: {status}"
        lines[at["status_changed"]] = f"status_changed: {changed}"
        if note is not None:
            if "status_note" in at:
                lines[at["status_note"]] = f"status_note: {note}"
            else:
                lines.insert(at["status_changed"] + 1, f"status_note: {note}")
                at = {k: i + 1 if i > at["status_changed"] else i for k, i in at.items()}
        if drop_waits and "waits_on" in at:
            del lines[at["waits_on"]]
        return "\n".join(lines)

    # --- what a backlog item waits on -------------------------------------------------------------------------
    def _action_resolver(self):
        """The function id -> "open"|"done"|"dropped"|None, or None when the project has none."""
        if self._action_status is not None:
            return self._action_status
        if self._hook is None:
            self._hook = False
            path = os.path.join(self.root, "_tools", "backlog_waits.py")
            if os.path.isfile(path):
                keep, sys.dont_write_bytecode = sys.dont_write_bytecode, True
                try:
                    spec = importlib.util.spec_from_file_location("backlog_waits_hook", path)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                except Exception as e:
                    raise MailError(f"{path} would not load: {e}")
                finally:
                    sys.dont_write_bytecode = keep
                fn = getattr(mod, "action_status", None)
                if callable(fn):
                    self._hook = lambda aid: fn(self.root, aid)
        return self._hook or None

    def wait_state(self, kind, ref, cache):
        """'open', 'closed', 'unknown' or (free text past stale_after_days) 'stale' for one parsed waits_on entry.
        `cache` is a dict the caller keeps for one run, so the mailbox and the stories are read once."""
        if kind == "text":
            return "stale" if (self.today - ref[1]).days > self.cfg["stale_after_days"] else "open"
        if kind == "msg":
            if "threads" not in cache:
                cache["threads"] = {h.get("id"): h.get("status") for h, _, _ in self.threads()}
            st = cache["threads"].get(ref)
            return "unknown" if st is None else "closed" if st == "closed" else "open"
        if kind == "story":
            if "stories" not in cache:
                cache["stories"] = {s["id"]: s for s in self.queue_stories()}
            s = cache["stories"].get(ref)
            return "unknown" if s is None else "closed" if s["rejected"] or s["where"] == "done" else "open"
        fn = self._action_resolver()
        st = fn(ref) if fn else None
        return "closed" if st in ("done", "dropped") else "open" if st == "open" else "unknown"

    def epics_data(self, only=None, sync=False, now=None):
        """Per backlog item that has stories or a waits_on: [{id, status, done, open, rejected, waits_on: [{entry, state}],
        verdict, changed}] (done/open/rejected are story ids; state is open, closed, unknown or stale; changed is True when
        sync wrote the file). Each item also carries new_status (what sync writes, else None) and notes (its STALE and
        UNKNOWN lines). A Rejected item is never changed. Nothing is written unless sync.
        In Jira mode the items are the Jira keys the stories name (see jira_epics_data); sync is refused."""
        if self.jira:
            if sync:
                raise ModeRefused("epics --sync writes backlog/ files; in Jira mode use jira_sync.py push")
            return self.jira_epics_data(only)
        if only is not None:
            if not re.match(r"^B-\d+$", only):
                raise MailError(f"{only!r} is not a backlog item id (B-<nnn>)")
            if only not in self._backlog_ids():
                raise MailError(f"no backlog item {only} (backlog/{only}.md)")
        by = {}
        for s in self.queue_stories():
            bid = story_epic(s["fields"])
            if bid:
                b = by.setdefault(bid, {"done": [], "open": [], "rejected": []})
                b["rejected" if s["rejected"] else "done" if s["where"] == "done" else "open"].append(s["id"])
        now = now or datetime.datetime.now().astimezone()
        cache, out = {}, []
        for bid in [only] if only else self._backlog_ids():
            st = by.get(bid) or {"done": [], "open": [], "rejected": []}
            path = os.path.join(self.root, "backlog", bid + ".md")
            text = _read(path)
            head = self._backlog_head(text)
            status, note = head.get("status", ""), head.get("status_note", "")
            has_stories = bool(st["done"] or st["open"] or st["rejected"])
            entries = head["waits_on"].split("; ") if head.get("waits_on") else []
            try:
                parsed, waits_err = parse_waits_on("; ".join(entries)) if entries else [], None
            except ValueError as e:
                parsed, waits_err = [], str(e)
            if not (has_stories or entries) and bid != only:
                continue
            states = [self.wait_state(k, r, cache) for k, r in parsed]
            entries = entries if parsed else []
            closed = [e for e, x in zip(entries, states) if x == "closed"]
            blockers = [f"{e} ({x})" for e, x in zip(entries, states) if x != "closed"]
            blocked = "; ".join(blockers)
            new_status = new_note = None
            drop = False
            if waits_err:
                verdict = f"unreadable: {waits_err}"
            elif status not in BACKLOG_STATUSES:
                verdict = f"unreadable: status is {status!r}"
            elif status == "Rejected":
                verdict = "ok"
            elif st["open"]:
                verdict = "set In Progress" if status in ("To Do", "In Review", "Done") else "ok"
                if status in ("To Do", "In Review", "Done"):
                    new_status = "In Progress"
                    new_note = None if note and status == "To Do" else f"stories {', '.join(st['open'])} open"   # a reopened item's note is stale
            elif blockers:
                verdict = f"waiting on {blocked}"
                if status in ("To Do", "In Review", "Done"):   # an item with an open blocker isn't finished; a To Do one is under way
                    verdict += " -> set In Progress"
                    new_status = "In Progress"
                    new_note = "reopened: waits_on still has open entries" if status != "To Do" else None
            elif st["done"] and status in ("To Do", "In Progress"):
                verdict = "set In Review"          # never Done: only the owner accepts an item (Russell, 2026-10-27)
                new_status = "In Review"
                new_note = (f"{', '.join(st['done'])} merged; In Review since {self.today.isoformat()}, "
                            "for the owner to accept or send back")
                if closed:
                    new_note += f"; waits_on cleared: {', '.join(closed)}"
                    drop = True
            elif status == "In Review" and has_stories:
                verdict = "awaiting review"
            elif entries and not has_stories:
                verdict = "waits_on cleared, no stories"
            else:
                verdict = "ok" if has_stories else "no stories"
            if closed and status != "Rejected" and verdict not in ("waits_on cleared, no stories", "set In Review") and not waits_err:
                verdict += f"; cleared: {', '.join(closed)}"
            notes = []
            if status != "Rejected":
                for (k, r), e, x in zip(parsed, entries, states):
                    if x == "stale":
                        notes.append(f"STALE {bid} waits on {r[0]!r} since {r[1].isoformat()} ({(self.today - r[1]).days} days)")
                    elif x == "unknown":
                        why = ("no such action" if self._action_resolver() else "no way to look up actions: give Mail an "
                               "action_status or add _tools/backlog_waits.py") if k == "action" else \
                              "no such thread" if k == "msg" else "no such story"
                        notes.append(f"UNKNOWN {bid} {e} ({why})")
            changed = False
            if sync and new_status:
                _replace(path, self._backlog_rewrite(text, new_status, now.isoformat(timespec="seconds"), new_note, drop))
                changed = True
            out.append({"id": bid, "status": status, "done": st["done"], "open": st["open"], "rejected": st["rejected"],
                        "waits_on": [{"entry": e, "state": x} for e, x in zip(entries, states)], "verdict": verdict,
                        "changed": changed, "new_status": new_status, "notes": notes})
        return out

    def jira_epics_data(self, only=None):
        """Jira mode: per Jira epic key named by a story's `epic:`: the same item shape as epics_data. `status` is "unknown"
        (this tool cannot read Jira); the verdict says what it should be from the stories alone: `set In Review` when every
        story is done (a rejected story counts as closed), `set In Progress` when any is open. waits_on is empty. Nothing is
        written."""
        migrated = load_migrated(self.root, self.jira)
        if only in migrated:
            only = migrated[only]
        if only is not None and not re.match(rf"^{re.escape(self.jira)}-\d+$", only):
            raise MailError(f"{only!r} is not an epic key of the Jira project {self.jira} ({self.jira}-<n>)"
                            + (" (or a B- id in backlog/MIGRATED.json)" if re.match(r"^B-\d+$", only) else ""))
        by = {}
        for s in self.queue_stories():
            key = story_epic(s["fields"], self.jira, migrated)
            if key and JIRA_KEY_RE.match(key) and (only is None or key == only):
                b = by.setdefault(key, {"done": [], "open": [], "rejected": []})
                b["rejected" if s["rejected"] else "done" if s["where"] == "done" else "open"].append(s["id"])
        if only is not None:
            by.setdefault(only, {"done": [], "open": [], "rejected": []})
        out = []
        for key in sorted(by, key=lambda k: int(k.rsplit("-", 1)[1])):
            st = by[key]
            if st["open"]:
                verdict, new = "set In Progress", "In Progress"
            elif st["done"]:
                verdict, new = "set In Review", "In Review"
            else:
                verdict, new = ("ok" if st["rejected"] else "no stories"), None
            out.append({"id": key, "status": "unknown", "done": st["done"], "open": st["open"], "rejected": st["rejected"],
                        "waits_on": [], "verdict": verdict, "changed": False, "new_status": new, "notes": []})
        return out

    def epics(self, only=None, sync=False, now=None):
        """The output lines of epics_data(): an item line each (then a CHANGED line when sync wrote it), then the STALE and
        UNKNOWN lines of all items."""
        return format_epics(self.epics_data(only, sync, now))

    def queue_view(self):
        """(stories, rank result) as `queue` shows them. In team mode, another member's story still waiting in code-inbox is
        listed whoever minted it (the queue is shared; claims are leased by the git tool's claim), except that a story with `needs:
        data-writer` is dropped from the lists and the stats on a Mac whose member is not a data writer. rank() has counted
        every story for dependencies and blocks either way."""
        stories = self.queue_stories()
        result = rank(stories, self.today, self.owner, self.backlog_priority, self.has_backlog, self.jira,
                      load_migrated(self.root, self.jira))
        if not self.team:
            return stories, result
        self._need_me()
        writer = self.me in self.team["data_writers"]
        theirs = {s["id"] for s in stories if s["where"] == "code-inbox" and not writer
                  and "data-writer" in (s["fields"].get("needs") or "")}
        result = dict(result, order=[i for i in result["order"] if i not in theirs],
                      held=[(i, w) for i, w in result["held"] if i not in theirs],
                      info={k: v for k, v in result["info"].items() if k not in theirs},
                      alerts=[a for a in result["alerts"] if a.split(" ")[0] not in theirs])
        return [s for s in stories if s["id"] not in theirs], result

    def queue(self):
        return self.queue_view()[1]

    def check_warnings(self, sid):
        return field_warnings(story_fields(_read(self.find_story(sid)["path"])))

    def check_story(self, sid):
        s = self.find_story(sid)
        text = _read(s["path"])
        fields = story_fields(text)
        if story_jira_key(fields):       # a Jira-born story is imported as it stands: it may lack what spawn-story would insist on
            gone = [f for f in STORY_FIELDS if not (fields.get(f) or "").strip()]
            if gone:
                raise MailError(f"{sid}: a story from Jira {story_jira_key(fields)} lacks required fields: {', '.join(gone)} "
                                "(the description needs a heading for each; the sync comments on the issue)")
        ui = ui_problem(text, sid, components_on(self.root))
        if ui:
            raise MailError(f"{sid}: {ui}")
        bad = field_problems(fields, sid, self.owner, bool(s["origin"]), self.backlog_priority, self.has_backlog, self.jira,
                             load_migrated(self.root, self.jira))
        if bad:
            raise MailError(f"{sid}: " + "; ".join(bad))
        if is_new(sid) or "expedite" in fields:
            stories = self.queue_stories()
            known = {x["id"] for x in stories}
            for d in (depends_on(fields.get("depends_on"))[0] if is_new(sid) else []):
                if d not in known:
                    raise MailError(f"{sid}: depends_on names {d}, which is not in code-inbox, in-progress, done or staged")
            if "expedite" in fields:
                ahead = [e for e in open_expedites(stories, self.owner, self.backlog_priority, self.has_backlog, self.jira,
                                         load_migrated(self.root, self.jira)) if e[1] != sid]
                mine = (parse_expedite(fields["expedite"])[0][0], sid)
                if ahead and ahead[0] < mine:
                    raise MailError(f"{sid}: only one story may carry expedite at a time, and {ahead[0][1]} has it (since {ahead[0][0]})")
        if not s["origin"]:
            if s["depth"] != 0:
                raise MailError(f"{sid} claims chain depth {s['depth']} but names no origin thread")
            req = re.search(r"(?m)^requested:(.*)$", text)
            line = req.group(1).lower() if req else ""
            member = owner_of(sid, self.team)
            asker = self.team["members"][member]["name"] if member else self.owner   # team mode: the member who owns the id
            key = story_jira_key(fields)
            via = re.search(rf"\bby\s+\S.*?\s+via\s+jira\s+({JIRA_KEY})\b", req.group(1) if req else "", re.I)
            if via and key and via.group(1).upper() == key and "spawned" not in line:
                return f"root story (filed in Jira as {key}; the person who filed it is the requester)"
            if "by " not in line or "spawned" in line or (asker and asker.lower() not in line):
                who = f"name {asker} and " if asker else ""
                raise MailError(f"{sid} has no origin thread and its 'requested' line does not {who}say who asked ('by <name>', "
                                "without 'spawned'): a story that answers an inbox thread must be made with spawn-story")
            return f"root story (written for {asker or 'the owner'}'s request)"
        h, _, _ = self.load(s["origin"])
        if sid not in h["spawned"].split(", "):
            raise MailError(f"{sid} names origin {s['origin']}, which did not spawn it")
        if s["depth"] != int(h["depth"]) + 1 or s["chain"] != h["chain"]:
            raise MailError(f"{sid}'s chain or depth does not match its origin thread {s['origin']}")
        return f"spawned from {s['origin']} (chain {s['chain']}, depth {s['depth']})"

    # --- who is waiting ------------------------------------------------------------------------------------
    def story_merged(self, sid):
        return bool(glob.glob(os.path.join(self.dev, "done", "*", sid + ".md")))

    def waiting(self, side):
        want = {"code": ("awaiting-code", "answered"), "cowork": ("awaiting-cowork",)}[side]
        out, held = [], 0
        if self.team:
            self._need_me()
        for h, turns, _ in self.threads():
            if h.get("status") in want and self._mine(h.get("id")):
                if side == "cowork" and h.get("needs") == "story-merged" and not self.story_merged(h["story"]):
                    held += 1
                    continue
                age = (self.today - datetime.date.fromisoformat(h["opened"])).days
                flag = " STALE" if age >= self.cfg["stale_after_days"] else ""
                out.append(f"{h['id']} {h['kind']} {h['status']} story={h['story']} depth={h['depth']}{flag} | {h['subject']}")
        if held:
            out.append(f"({held} job(s) held until their story is merged)") if out else None
        return out


def _body(args):
    if args.body_file:
        return sys.stdin.read() if args.body_file == "-" else _read(args.body_file)
    if args.body is not None:
        return args.body
    raise MailError("give --body or --body-file")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Two-way dev mailbox between Cowork and Claude Code, with loop limits.")
    ap.add_argument("--root", "--corpus", dest="root", default=default_root(),
                    help="the project folder (default: found from this file's location)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("limits")
    sub.add_parser("version")
    p = sub.add_parser("queue"); p.add_argument("--stats", action="store_true")
    sub.add_parser("next-story-id")
    p = sub.add_parser("budget"); p.add_argument("--story", required=True)
    p = sub.add_parser("list"); p.add_argument("--for", dest="side", choices=["code", "cowork"], required=True)
    p = sub.add_parser("show"); p.add_argument("thread")
    p = sub.add_parser("open")
    p.add_argument("--kind", required=True, choices=["question", "job"]); p.add_argument("--story", required=True)
    p.add_argument("--subject", required=True); p.add_argument("--body"); p.add_argument("--body-file"); p.add_argument("--reply-format")
    p.add_argument("--after-merge", action="store_true")
    p = sub.add_parser("reply"); p.add_argument("thread"); p.add_argument("--as", dest="who", required=True, choices=["code", "cowork"])
    p.add_argument("--type", required=True, choices=["answer", "cannot-answer", "counter-question", "done", "declined"])
    p.add_argument("--body"); p.add_argument("--body-file"); p.add_argument("--reply-format")
    p = sub.add_parser("close"); p.add_argument("thread"); p.add_argument("--withdraw", action="store_true")
    p = sub.add_parser("spawn-story"); p.add_argument("--thread", required=True); p.add_argument("--file", required=True)
    p = sub.add_parser("check-story"); p.add_argument("story")
    p = sub.add_parser("epics"); p.add_argument("--id"); p.add_argument("--sync", action="store_true"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("team"); p.add_argument("--me")
    p.add_argument("--grant-writer", metavar="LOGIN"); p.add_argument("--revoke-writer", metavar="LOGIN")
    a = ap.parse_args(argv)
    if a.cmd == "version":
        print(VERSION)
        return 0
    try:
        m = Mail(a.root)
        if a.cmd == "limits":
            print(json.dumps(m.cfg, indent=2))
        elif a.cmd == "next-story-id":
            print(m.next_story_id())
        elif a.cmd == "budget":
            print(json.dumps(m.budget(a.story), indent=2))
        elif a.cmd == "list":
            lines = m.waiting(a.side)
            print("\n".join(lines) if lines else "NOTHING")
        elif a.cmd == "show":
            print(_read(m.load(a.thread)[2]), end="")
        elif a.cmd == "open":
            tid = m.open(a.kind, a.story, a.subject, _body(a), a.reply_format, a.after_merge)
            print(f"OPENED {tid} (awaiting-cowork)")
        elif a.cmd == "reply":
            print(f"REPLIED {a.thread} now {m.reply(a.thread, a.who, a.type, _body(a), a.reply_format)}")
        elif a.cmd == "close":
            m.close(a.thread, a.withdraw)
            print(f"CLOSED {a.thread}")
        elif a.cmd == "spawn-story":
            sid, depth = m.spawn_story(a.thread, _read(a.file))
            print(f"SPAWNED {sid} (depth {depth}) from {a.thread}")
        elif a.cmd == "check-story":
            print("OK", m.check_story(a.story))
            for w in m.check_warnings(a.story):
                print(f"WARNING: {a.story}: {w}", file=sys.stderr)
        elif a.cmd == "epics":
            items = m.epics_data(a.id, a.sync)
            if a.json:
                print(json.dumps([{k: it[k] for k in EPICS_JSON_KEYS} for it in items], indent=2))
            else:
                lines = format_epics(items)
                print("\n".join(lines) if lines else "NOTHING")
        elif a.cmd == "team":
            if a.grant_writer or a.revoke_writer:
                if a.me or (a.grant_writer and a.revoke_writer):
                    raise MailError("give one of --me, --grant-writer, --revoke-writer")
                print("\n".join(m.grant_or_revoke(a.grant_writer or a.revoke_writer, bool(a.grant_writer))))
            else:
                print("\n".join(m.team_lines(a.me)))
        elif a.cmd == "queue":
            stories, result = m.queue_view()
            print("\n".join(format_queue(stories, result, a.stats)))
    except MailError as e:
        print(("REFUSED: " if isinstance(e, Refused) else "ERROR: ") + str(e), file=sys.stderr)
        if isinstance(e, Refused) and not isinstance(e, (TeamRefused, ModeRefused)):
            print(f"Final. Do not retry or work round it: record it under 'for {load_owner(a.root) or 'the owner'}' in the story's result.", file=sys.stderr)
        return e.exit_code
    return 0


if __name__ == "__main__":
    sys.exit(main())
