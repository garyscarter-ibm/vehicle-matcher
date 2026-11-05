#!/usr/bin/env python3
VERSION = "1.3.1+vehicle-matcher.1"  # Project-owned UI-plan fix; see docs/gcsp/poller-tooling-2026-11-05.md.
__doc__ = """jira_sync.py -- the story sync between a Jira-backed project's Jira issues and its dev inbox. Vendored into a
project's `_tools/` by project-scaffolding, beside scaffold_git.py and dev_mail.py, which it loads by path (sys.path is
never touched): `inbox.git_tool` in .claude/scaffolding.json names the first (default _tools/scaffold_git.py).

It never calls Jira. Python cannot reach the MCP, so the code poller fetches (searchJiraIssuesUsingJql) and writes
(comments, transitions) through the MCP, and this script decides what goes into git and what the poller posts.

Subcommands (exit 0 done, 2 refused, 3 git or tool failure)
  jql                      print {"jql": ..., "fields": [...]}: what the poller fetches. The JQL is
                           project = <P> AND issuetype in (<story_type>, <bug_type>) AND updated >= "<last pass>" ORDER BY updated ASC;
                           with no last pass the `updated` clause is left out. `reconcile_bugs` is null once the
                           versioned upgrade finished; while pending it is {version, jql, fields}, an open-Bug query
                           independent of the watermark. Fetch every page before pull --reconcile-bugs <version>.
  pull --issues FILE [--now ISO]
                           FILE is the JSON the poller got from searchJiraIssuesUsingJql: the tool's whole response
                           ({"data": {"issues": [...]}} or {"issues": [...]}) or a bare list of issues. After a
                           scaffold_git pull, under the checkout mutex, each issue is
                             new (no story in _dev/ carries `jira: <KEY>`): imported as _dev/code-inbox/<id>.md under a
                               create-only lease refs/leases/jira/<KEY> ({key, story, login, client, host, taken}); the
                               lease records the story id, so a run that stopped part-way resumes with the same id. If
                               another clone holds the lease: `SKIP <KEY>: imported by <login> as <story>`.
                             known, story in code-inbox: its Jira-owned fields are rewritten from the issue, every other
                               line is kept.
                             known, story in in-progress: nothing is changed but a `jira_changed: <date>: <fields>` line
                               after `jira:`, and a `notify` item for the poller to pass on.
                             known, story in done: ignored. A new issue that is already Done or Rejected in Jira is
                               skipped, not imported.
                           Then the last pass is set to --now (else the newest `updated` seen) in .claude/jira-sync.json.
                           Prints a JSON report: imported, updated, changed_in_progress, skipped, comments, notify, failed,
                           evidence_downloads. Each evidence item is {key, story, attachment_id, filename, mime_type, size?};
                           no URLs. Requests repeat for every open local Bug, even on an empty input page, until the
                           session verifies its local cache. Metadata is never treated as delivered bytes.
                           `comments` are the once-only comments the poller posts on issues whose description lacks
                           headings; the state file remembers which set of missing fields each issue was told about.
  push [--json] [--mark-done FILE]
                           git to Jira. Reads git only (the stories in _dev/ with a `jira:` line, the story leases
                           refs/leases/story/*, the base branch's `Merge dev/<id>` commits and the team members) and prints
                           the Jira operations the poller makes through the MCP, one per line (`NOTHING` when there are
                           none), or with --json as a JSON list. It journals pending Start dates in local state so retries
                           survive release/merge. It never calls Jira, writes no story and takes no lease. Ops:
                             {"op": "transition", "key", "to": <kit status>, "board_status": <the board's name>,
                              "label"?, "resolution"?, "clear_labels"?}
                               In Progress: the story is in in-progress/ or holds a story lease. In Review: it is merged
                               (a `Merge dev/<id>` commit on the base branch, or a `closed: ... merged` line) and in
                               done/. To Do: it is back in code-inbox with no lease, and a transition was pushed for it
                               before (a story never pushed is already To Do in Jira). Rejected: it is in done/ with a
                               `closed: <date> rejected` line (dev_mail's rule), a `rejected:` line or `status: rejected`.
                               An epic (a story's `epic: <KEY>`): In Review when every one of its stories is in done/ (a
                               rejected story counts as closed, at least one is done), In Progress when one is claimed and
                               not all are closed. Never Done: only the owner moves an item there.
                               `board_status` is the record's `statuses` entry for the kit name (a name, or {status, label,
                               resolution}); a name the record lacks falls back to the kit's own (In Review is In Progress
                               plus label `review`, Rejected is Done plus label `wont-do`). `label` and `resolution` are in
                               the op when the entry has them; `clear_labels` lists the labels of the other statuses, for
                               the poller to remove from the issue.
                             {"op": "start_date", "key", "date": "YYYY-MM-DD", "only_if_empty": true}
                               emitted from claim/history evidence for every adopted item and its epic, including
                               first sync after release, merge or rejection, independent of type, points or assignee.
                               Uses the first committed claim date, then lease date, else this sync's local day for
                               legacy records. Pending dates survive status changes. The poller resolves the Start date
                               field, reads its current value and sets it to `date` only when confirmed empty. An
                               existing date is preserved and acknowledged too; failed/unknown reads stay unmarked.
                               Once acknowledged this operation is never repeated, even on another day or adoption.
                             {"op": "assign", "key", "login", "name"?, "account_id", "note"?}
                               the claimer: the story lease's login, else the story's `claimed_by:`; with no team block (a
                               single owner: no leases, no claimed_by) it is the one login in `backlog.members`, and with
                               none or several of them the op has login "owner" and no account. `name` is the member's.
                               `account_id` is the member's Jira accountId from the record's `backlog.members.<login>.
                               jira_account_id` (set by `scaffold.py set-member`; else `team.members.<login>.jira_account_id`).
                               With none it is null and the op has a `note`: the poller UNASSIGNS the card (`assignee`
                               null), so a previous claimer is not shown, and the card stays unassigned until that machine
                               runs the Jira setup. The account id is part of the op's identity (null is distinct from any
                               id), so recording one later sends the op again. So does recording `points_field`: both are
                               sent again for every story with a Jira key, done ones included, once on each machine.
                             {"op": "fields", "key", "story_points": N, "field"?}   when the story has `story_points:`.
                               `field` is the record's `backlog.points_field` (customfield_NNNNN), the Story points field to
                               write. Without it the points go in the link comment, as before.
                             {"op": "labels", "key", "add": ["agent:<harness>", "host:<short host>"]}
                               for a story in progress, from the claimer's own clone only (the story lease's login and client
                               are this clone's; with no team block, always). Another machine emits nothing for that story,
                               so a label never names the wrong machine. The poller adds these to the issue's labels and keeps
                               the rest: editJiraIssue sets the whole list, so it computes each issue's final list once
                               (current - clear_labels + the transition's label + add, replacing only the label prefixes the
                               op carries) and writes it in one call. An op with no `agent:` entry leaves existing `agent:`
                               labels alone. The host is the story lease's `host` (first DNS label, lowercased, a-z 0-9 and -);
                               no lease, no host label. The harness is the story's `agent:` line (written at claim from
                               $SCAFFOLDING_HARNESS), else $SCAFFOLDING_HARNESS now (`claude` reads as `claude-code`), else
                               unknown: no agent label. Each token is cut at 64 characters. The label list is the op's
                               identity. Not built: a `team.members.<login>.agents` map naming an Atlassian service account
                               per harness.
                             {"op": "link", "key", "branch": "dev/<id>", "pr": <url or null>}
                               from a `pr:` or `branch:` line (Result block first), else the branch while it exists.
                           What was already pushed is in the state file (`pushed`: an op hash per key and op), so a stable
                           git state prints nothing on the next pass.
                           --mark-done FILE takes the ops the poller applied (the list push printed, or a subset) and records
                           them as pushed; ops not marked are printed again next time. Prints {"marked": [...]}.
  status                   print the state file and the import leases (refs/leases/jira/*).

State: <shared checkout>/.claude/jira-sync.json, per machine, kept out of git (scaffold_git's LOCAL_FILES):
  {"last_pass": "yyyy-MM-dd HH:mm", "commented": {"SCAF-12": "goal,validate"}, "told": {"SCAF-12": "<digest>"},
   "pushed": {"SCAF-12": {"transition": "<hash>", "assign": "<hash>", "fields": "<hash>", "labels": "<hash>",
                          "link": "<hash>"}}, "start_dates": {"SCAF-12": "yyyy-MM-dd"}}
  `commented`: the missing-fields comment each issue has had, keyed by the set it named. `told`: a digest of the last
  change to a claimed story that was reported, so the same change is not reported twice. `pushed`: the hash of each op
  acknowledged by the poller. `start_dates`: first planned dates still awaiting acknowledgement, retried independently
  of the current workflow status and removed only after the date operation is acknowledged.

Fields: Jira owns a story's title, kind, design_impact, ui, requested, epic, priority, priority_reason, size, depends_on,
preconditions, goal, acceptance, files_or_areas, decided, out_of_scope and validate; git owns the
claim (story_points, claimed_by, status). Bugs also carry work_item_type, related_story, story_link_basis,
reproduction_steps, expected_behaviour, actual_behaviour, optional environment and evidence metadata. Native configured
Story links are independent from the Epic parent and blocking links. Missing or conflicting origin is unresolved.
The description is read by markdown headings: Goal, Acceptance criteria (or
Acceptance), Files or areas, Decided, Out of scope, Validate. An explicit `ui:` line anywhere in the description
also supplies the top-level component plan. Any other line of a story (suggested_approach, say) is
left as it is. Text before the first heading is the
goal when there is no Goal heading. A field with no heading is left out, so dev_mail.py check-story names it.
Labels: kind:<code|data|ui|docs> (default code), design-impact, size:<XS|S|M|L|XL> (default M).
The priority comes back through the record's backlog.priorities map (level -> Jira name); an unknown name is P3.
`depends_on` lists the stories of imported issues this one "is blocked by"; a blocker not imported yet goes on a
`preconditions:` line as "Jira <KEY> done", and moves to depends_on when that blocker is imported.

Stdlib only; Python 3.9.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import re
import socket
import sys
import time

STATE_REL = os.path.join(".claude", "jira-sync.json")
LEASE_PREFIX = "jira/"
KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
FIELDS = ["summary", "description", "status", "issuetype", "parent", "labels", "priority", "updated", "created",
          "reporter", "issuelinks", "attachment"]
DEFAULT_GIT_TOOL = "_tools/scaffold_git.py"
RASTER_MIMES = frozenset(("image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"))

# Fields in the order a story file carries them; the ones after `jira` that Jira owns are OWNED.
ORDER = ["id", "jira", "title", "work_item_type", "related_story", "story_link_basis",
         "reproduction_steps", "expected_behaviour", "actual_behaviour", "environment", "evidence", "kind",
         "design_impact", "ui", "requested", "epic", "priority", "priority_reason", "size",
         "depends_on", "preconditions", "goal", "acceptance", "files_or_areas", "decided", "out_of_scope", "validate"]
OWNED = set(ORDER[2:])
SECTION_FIELDS = ["goal", "acceptance", "files_or_areas", "decided", "out_of_scope", "validate"]
SECTION_WORDS = {"goal": "Goal", "acceptance": "Acceptance criteria", "files_or_areas": "Files or areas",
                 "decided": "Decided", "out_of_scope": "Out of scope", "validate": "Validate"}
HEADINGS = {"goal": "goal", "acceptance criteria": "acceptance", "acceptance": "acceptance",
            "files or areas": "files_or_areas", "files and areas": "files_or_areas", "files": "files_or_areas",
            "areas": "files_or_areas", "decided": "decided", "out of scope": "out_of_scope", "validate": "validate",
            "validation": "validate"}
BUG_FIELDS = ("related_story", "story_link_basis", "reproduction_steps", "expected_behaviour", "actual_behaviour")
BUG_RECONCILIATION_VERSION = 1
SECTION_WORDS.update({"related_story": "Related story", "story_link_basis": "Story link basis",
                      "reproduction_steps": "Steps to reproduce", "expected_behaviour": "Expected behaviour",
                      "actual_behaviour": "Actual behaviour", "environment": "Environment"})
HEADINGS.update({v.lower(): k for k, v in SECTION_WORDS.items()})
KINDS = ("code", "data", "ui", "docs")
SIZES = ("XS", "S", "M", "L", "XL")
PRECOND_RE = re.compile(r"^Jira ([A-Z][A-Z0-9]+-\d+) done$")


class Refused(Exception):
    """A refusal, exit 2."""


class Failed(Exception):
    """A git or tool failure, exit 3."""


# ---------------------------------------------------------------- the two tools, loaded by path

def project_root(override=None):
    if override:
        return os.path.abspath(override)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_record(root):
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return {}
    return rec if isinstance(rec, dict) else {}


def _load(path, label):
    if not os.path.isfile(path):
        raise Refused("%s is missing: %s" % (label, path))
    try:
        spec = importlib.util.spec_from_file_location("_jira_sync_" + str(abs(hash(path))), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:
        raise Refused("%s will not load: %s" % (path, e))
    return mod


def load_tools(root):
    """(scaffold_git module, dev_mail module) of the project, loaded by path."""
    try:
        tool = read_record(root)["inbox"]["git_tool"]
    except (KeyError, TypeError):
        tool = None
    rel = tool.strip() if isinstance(tool, str) and tool.strip() else DEFAULT_GIT_TOOL
    return (_load(os.path.join(root, rel), "the git tool"),
            _load(os.path.join(root, "_tools", "dev_mail.py"), "dev_mail.py"))


def jira_record(root):
    """The record's Jira backlog block, or a refusal."""
    b = read_record(root).get("backlog")
    if not isinstance(b, dict) or b.get("backend") != "jira":
        raise Refused(".claude/scaffolding.json has no backlog block with backend jira")
    if not isinstance(b.get("project"), str) or not re.match(r"^[A-Z][A-Z0-9]+$", b["project"]):
        raise Refused("scaffolding.json backlog.project %r is not a Jira project key" % (b.get("project"),))
    for field in ("story_type", "bug_type", "story_link_type"):
        if field in b and (not isinstance(b[field], str) or not b[field].strip() or
                           any(ord(c) < 32 for c in b[field])):
            raise Refused("backlog.%s must be a nonempty single-line string" % field)
    return b


# ---------------------------------------------------------------- the state file

def state_path(root, sg):
    return os.path.join(sg.shared_checkout(root), STATE_REL)


def load_state(root, sg):
    try:
        with open(state_path(root, sg), encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, ValueError):
        st = {}
    st = st if isinstance(st, dict) else {}
    for k in ("commented", "told", "evidence", "work_item_types", "start_dates"):
        if not isinstance(st.get(k), dict):
            st[k] = {}
    return st


def save_state(root, sg, st):
    sg.ensure_ignored(root)
    path = state_path(root, sg)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------- time

WALL = re.compile(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})")


def wall(s):
    """('yyyy-MM-dd', 'HH:mm') as written in an ISO stamp (its own offset is ignored: Jira reads JQL times in the
    user's zone, and its issues carry that zone), or None."""
    m = WALL.search(s or "")
    return (m.group(1), "%s:%s" % (m.group(2), m.group(3))) if m else None


def now_wall(now):
    if now:
        w = wall(now)
        if not w:
            raise Refused("--now %r is not an ISO time (yyyy-MM-ddTHH:mm...)" % now)
        return w
    n = datetime.datetime.now()
    return n.strftime("%Y-%m-%d"), n.strftime("%H:%M")


# ---------------------------------------------------------------- jql

def jql_name(value):
    return value if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", value) else json.dumps(value)


def build_jql(rec, last_pass):
    types = [jql_name(rec.get("story_type") or "Story"), jql_name(rec.get("bug_type") or "Bug")]
    parts = ["project = %s" % rec["project"], "issuetype in (%s)" % ", ".join(types)]
    if last_pass:
        parts.append('updated >= "%s"' % last_pass)
    return " AND ".join(parts) + " ORDER BY updated ASC"


# ---------------------------------------------------------------- reading an issue

def _text_of_adf(node):
    """A rough markdown for an Atlassian-document-format description (the MCP returns markdown by default)."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    kind, kids = node.get("type"), node.get("content") or []
    inner = "".join(_text_of_adf(k) for k in kids)
    if kind == "text":
        return node.get("text", "")
    if kind == "heading":
        return "%s %s\n\n" % ("#" * int((node.get("attrs") or {}).get("level", 2)), inner)
    if kind == "listItem":
        return "- " + inner.strip() + "\n"
    if kind in ("paragraph", "codeBlock"):
        return inner + "\n\n"
    if kind == "hardBreak":
        return "\n"
    return inner


def _name(v):
    if isinstance(v, dict):
        return v.get("name") or v.get("displayName") or v.get("key") or ""
    return v if isinstance(v, str) else ""


MD_ESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|<>~])")


def unescape_md(text):
    """Jira's markdown escapes punctuation (`\\_dev/`, `\\*`); a story line wants the plain character."""
    return MD_ESCAPE.sub(r"\1", text)


def supported_screenshot(filename, mime):
    return (isinstance(filename, str) and bool(filename.strip()) and filename not in (".", "..") and
            "/" not in filename and "\\" not in filename and isinstance(mime, str) and
            mime.casefold() in RASTER_MIMES and not any(ord(c) < 32 for c in filename + mime))


def parse_issue(raw):
    """The parts of an issue the sync reads, as a flat dict. Raises ValueError for something that is not an issue."""
    if not isinstance(raw, dict) or not isinstance(raw.get("key"), str) or not KEY_RE.match(raw["key"]):
        raise ValueError("not a Jira issue: %r" % (str(raw)[:60],))
    f = raw.get("fields") if isinstance(raw.get("fields"), dict) else {}
    desc = f.get("description")
    status = f.get("status")
    cat = ((status.get("statusCategory") or {}).get("key") if isinstance(status, dict) else None) or ""
    parent = f.get("parent")
    blockers, relationships = [], []
    for link in f.get("issuelinks") or []:
        if not isinstance(link, dict):
            continue
        t = link.get("type") if isinstance(link.get("type"), dict) else {}
        for direction in ("inwardIssue", "outwardIssue"):
            other = link.get(direction)
            if isinstance(other, dict) and isinstance(other.get("key"), str):
                relationships.append({"key": other["key"], "link_type": t.get("name") or "",
                                      "issue_type": _name((other.get("fields") or {}).get("issuetype"))})
        if not isinstance(link.get("inwardIssue"), dict):
            continue
        if (t.get("inward") or "").lower() == "is blocked by" or (t.get("name") or "").lower() == "blocks":
            other = link["inwardIssue"]
            ostat = (other.get("fields") or {}).get("status")
            ocat = ((ostat.get("statusCategory") or {}).get("key") if isinstance(ostat, dict) else None) or ""
            if other.get("key") and ocat != "done" and _name(ostat).lower() not in ("done", "rejected"):
                blockers.append(other["key"])
    attachments = []
    for item in f.get("attachment") or []:
        if not isinstance(item, dict):
            continue
        aid, filename, mime = str(item.get("id", "")), item.get("filename"), item.get("mimeType")
        if not re.fullmatch(r"[0-9]+", aid) or not isinstance(filename, str) or not filename.strip() or \
                not isinstance(mime, str) or not mime.strip():
            continue
        if not supported_screenshot(filename, mime):
            continue
        meta = {"attachment_id": aid, "filename": filename, "mime_type": mime.casefold()}
        if isinstance(item.get("size"), int) and not isinstance(item["size"], bool) and item["size"] >= 0:
            meta["size"] = item["size"]
        attachments.append(meta)
    attachments.sort(key=lambda a: (int(a["attachment_id"]), a["filename"]))
    return {"key": raw["key"], "summary": f.get("summary") or "",
            "issue_type": _name(f.get("issuetype")), "relationships": relationships, "attachments": attachments,
            "attachments_known": isinstance(f.get("attachment"), list),
            "description": unescape_md(_text_of_adf(desc) if isinstance(desc, dict) else (desc or "")),
            "status": _name(status), "status_category": cat,
            "labels": [l for l in (f.get("labels") or []) if isinstance(l, str)],
            "priority": _name(f.get("priority")), "updated": f.get("updated") or "", "created": f.get("created") or "",
            "reporter": _name(f.get("reporter")), "parent": parent.get("key") if isinstance(parent, dict) else None,
            "blockers": blockers}


def read_issues(path):
    """The issues in the poller's file: the tool's whole response or a bare list."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise Refused("cannot read %s: %s" % (path, e))
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        data = data["data"]
    if isinstance(data, dict):
        data = data.get("issues")
    if not isinstance(data, list):
        raise Refused("%s holds no list of issues (expected a list, or an object with `issues`)" % path)
    out = []
    for raw in data:
        out.append(parse_issue(raw))
    return out


# ---------------------------------------------------------------- the description's sections

HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$")


def sections(desc):
    """{field: text} from the description's headings; see the module doc."""
    lines = (desc or "").replace("\r\n", "\n").split("\n")
    preamble, found, order, cur = [], {}, [], None
    for line in lines:
        m = HEADING_RE.match(line)
        if m:
            title = re.sub(r"[*_`:]", "", m.group(1)).strip().lower()
            if title in HEADINGS:
                cur = HEADINGS[title]
                if cur not in found:
                    found[cur] = []
                    order.append(cur)
                continue
            if cur is not None:                 # a heading of its own inside a section stays with it
                found[cur].append(m.group(1).strip() + ":")
                continue
            preamble.append(line)
            continue
        (found[cur] if cur is not None else preamble).append(line)
    if "goal" not in found and "".join(preamble).strip():
        found["goal"] = preamble
    out = {}
    for k, v in found.items():
        text = "\n".join(v).strip("\n")
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            out[k] = text
    return out


BULLET_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)$")


def acceptance_lines(text):
    """`- [ ] ...` lines for the bullets of an acceptance section; text under a bullet continues it."""
    items = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        m = BULLET_RE.match(line)
        if m and (len(m.group(1)) < 2 or not items):
            items.append([m.group(2).strip()])
        elif items:
            items[-1].append(line.strip() if not m else m.group(2).strip())
        else:
            items.append([line.strip()])
    out = []
    for it in items:
        out.append("- [ ] " + it[0])
        out += ["  " + x for x in it[1:] if x]
    return out


def block(key, lines):
    """The file lines of one field: `key: value`, or `key:` and the lines below it (indented, so that none reads as a
    key line)."""
    if key == "acceptance":
        return ["acceptance:"] + lines
    if len(lines) == 1:
        return ["%s: %s" % (key, lines[0])]
    return ["%s:" % key] + [("  " + l) if l.strip() else "" for l in lines]


# ---------------------------------------------------------------- a story from an issue

def clean_title(summary, key):
    t = re.sub(r"\s+", " ", (summary or "").replace("`", "")).strip()
    while True:
        n = re.sub(r"^(?:site\s*:\s*|DEV-\S*\s*[:\-–—]*\s*)", "", t, flags=re.I).strip()
        if n == t:
            break
        t = n
    if not t:
        return key
    if len(t) > 80:
        cut = t[:77]
        if " " in cut[40:]:
            cut = cut[:cut.rfind(" ")]
        t = cut.rstrip(" ,;:-") + "..."
    return t


def priority_level(name, rec):
    for level, jname in (rec.get("priorities") or {}).items():
        if isinstance(jname, str) and jname.lower() == (name or "").lower() and str(level) in "12345" and len(str(level)) == 1:
            return int(level)
    return 3


def label_value(labels, prefix, allowed):
    for l in labels:
        if l.lower().startswith(prefix):
            v = l[len(prefix):].strip()
            for a in allowed:
                if v.lower() == a.lower():
                    return a
    return None


def bug_origin(issue, rec, key_to_story, secs):
    """Keep origin independent from hierarchy and blockers; conflicting candidates hold implementation."""
    project = rec["project"] + "-"
    native = {r["key"] for r in issue.get("relationships", [])
              if r["link_type"].casefold() == (rec.get("story_link_type") or "Relates").casefold()
              and r["issue_type"].casefold() == (rec.get("story_type") or "Story").casefold()
              and r["key"].startswith(project)}
    stated = secs.get("related_story", "").strip()
    if stated:
        if stated.startswith("unresolved:"):
            return stated
        reverse = {sid: key for key, sid in key_to_story.items()}
        stated = reverse.get(stated, stated)
        if not KEY_RE.fullmatch(stated) or not stated.startswith(project):
            return "unresolved: Related story must name a same-project Story or resolved DEV Story ID"
        typed = [r for r in issue.get("relationships", []) if r["key"] == stated and r["issue_type"]]
        if typed and any(r["issue_type"].casefold() != (rec.get("story_type") or "Story").casefold() for r in typed):
            return "unresolved: Related story names an issue that is not a Story"
        if stated not in native:
            return "unresolved: configured native Story link missing or linked issue type unconfirmed; fetch its issue type"
    if len(native) != 1:
        return "unresolved: " + ("conflicting originating Stories" if native else "originating Story not established")
    return next(iter(native))


def issue_blocks(issue, rec, key_to_story):
    """{field: file lines} for the fields Jira owns, from a parsed issue. `key_to_story` maps an imported issue's key to
    its story id."""
    key, labels = issue["key"], issue["labels"]
    blocks = {"title": ["title: " + clean_title(issue["summary"], key)]}
    is_bug = issue.get("issue_type", "").casefold() == (rec.get("bug_type") or "Bug").casefold()
    blocks["work_item_type"] = ["work_item_type: " + ("bug" if is_bug else "story")]
    blocks["kind"] = ["kind: " + (label_value(labels, "kind:", KINDS) or "code")]
    blocks["design_impact"] = ["design_impact: " + ("yes" if "design-impact" in [l.lower() for l in labels] else "no")]
    day = (wall(issue["created"]) or ("", ""))[0] or issue["created"][:10]
    blocks["requested"] = ["requested: %s, by %s via Jira %s" % (day, issue["reporter"] or "Jira", key)]
    blocks["epic"] = ["epic: " + (issue["parent"] or "none")]
    blocks["priority"] = ["priority: P%d" % priority_level(issue["priority"], rec)]
    blocks["priority_reason"] = ["priority_reason: set in Jira (%s)" % key]
    blocks["size"] = ["size: " + (label_value(labels, "size:", SIZES) or "M")]
    ids, waits = [], []
    for b in issue["blockers"]:
        if b in key_to_story:
            if key_to_story[b] not in ids:
                ids.append(key_to_story[b])
        elif "Jira %s done" % b not in waits:
            waits.append("Jira %s done" % b)
    blocks["depends_on"] = ["depends_on: " + (", ".join(sorted(ids)) if ids else "none")]
    if waits:
        blocks["preconditions"] = ["preconditions: " + "; ".join(waits)]
    secs = sections(issue["description"])
    ui = re.search(r"(?m)^[ \t]*ui:[ \t]*([^\n]*)$", issue["description"])
    if ui and ui.group(1).strip():
        blocks["ui"] = ["ui: " + ui.group(1).strip()]
    if is_bug:
        blocks["related_story"] = ["related_story: " + bug_origin(issue, rec, key_to_story, secs)]
        blocks["evidence"] = ["evidence: " + json.dumps(issue.get("attachments", []), sort_keys=True)]
    for field in SECTION_FIELDS + (list(BUG_FIELDS[1:]) + ["environment"] if is_bug else []):
        if field not in secs:
            continue
        if field == "acceptance":
            blocks[field] = block(field, acceptance_lines(secs[field]))
        else:
            blocks[field] = block(field, secs[field].split("\n"))
    return blocks


def missing_fields(blocks):
    required = SECTION_FIELDS + (list(BUG_FIELDS) if blocks.get("work_item_type") == ["work_item_type: bug"] else [])
    return [f for f in required if f not in blocks or
            (f == "related_story" and blocks[f][0].startswith("related_story: unresolved:"))]


def comment_body(key, missing):
    words = [SECTION_WORDS[f] for f in missing]
    if len(words) > 1:
        names = ", ".join(words[:-1]) + " and " + words[-1]
    else:
        names = words[0]
    return ("This story can't be built yet: its description needs headings for %s. Write each as a heading (for "
            "example \"## %s\") with its text below it; where there is nothing to say under Decided or Out of scope, "
            "write \"none\"." % (names, words[0]))


def render_new(key, story_id, blocks):
    lines = ["id: " + story_id, "jira: " + key]
    for k in ORDER[2:]:
        if k in blocks:
            lines += blocks[k]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- editing a story file

KEYLINE = re.compile(r"^([a-z_]+):")


def split_story(text):
    """(blocks, tail, trailing_newline): the top of the file as [key or None, lines] blocks, and the `## Result` part."""
    i = text.find("\n## Result")
    top, tail = (text, "") if i < 0 else (text[:i], text[i:])
    lines = top.split("\n")
    nl = lines[-1] == ""
    if nl:
        lines.pop()
    blocks = []
    for line in lines:
        m = KEYLINE.match(line)
        if m or not blocks:
            blocks.append([m.group(1) if m else None, [line]])
        else:
            blocks[-1][1].append(line)
    return blocks, tail, nl


def join_story(blocks, tail, nl):
    return "\n".join(l for _, ls in blocks for l in ls) + ("\n" if nl else "") + tail


def norm(lines):
    out = [l.rstrip() for l in lines]
    while out and not out[-1]:
        out.pop()
    return out


def jira_key_of(text):
    m = re.search(r"(?m)^jira:[ \t]*([A-Z][A-Z0-9]+-\d+)\b", text.split("\n## Result")[0])
    return m.group(1) if m else None


def merge_owned(text, blocks_new):
    """The story text with its Jira-owned blocks replaced by blocks_new (a field Jira lacks is removed), every other
    line kept."""
    blocks, tail, nl = split_story(text)
    out, seen = [], set()
    for key, lines in blocks:
        if key in OWNED:
            if key in blocks_new:
                out.append([key, blocks_new[key]])
                seen.add(key)
        else:
            out.append([key, lines])
    for key in ORDER:
        if key in OWNED and key in blocks_new and key not in seen:
            rank = ORDER.index(key)
            at = -1
            for i, (k, _) in enumerate(out):
                if k in ORDER and ORDER.index(k) < rank:
                    at = i
            out.insert(at + 1, [key, blocks_new[key]])
    return join_story(out, tail, nl)


def differing(text, blocks_new):
    """The Jira-owned fields (in file order) the issue has and the story's text has differently."""
    have = {k: norm(ls) for k, ls in split_story(text)[0] if k in OWNED}
    return [k for k in ORDER[2:] if (k in blocks_new or k in have) and
            have.get(k) != (norm(blocks_new[k]) if k in blocks_new else None)]


def with_jira_changed(text, day, names):
    """The story text with its `jira_changed:` line set (replacing any) right after `jira:`."""
    blocks, tail, nl = split_story(text)
    blocks[:] = [b for b in blocks if b[0] != "jira_changed"]
    at = next((i for i, (k, _) in enumerate(blocks) if k == "jira"), 0)
    blocks.insert(at + 1, ["jira_changed", ["jira_changed: %s: %s" % (day, ", ".join(names))]])
    return join_story(blocks, tail, nl)


# ---------------------------------------------------------------- the pass

class Pass:
    def __init__(self, root, sg, dm, rec, issues, now):
        self.root, self.sg, self.dm, self.rec, self.issues = root, sg, dm, rec, issues
        self.day, self.hhmm = now
        self.nowgiven = False
        self.reconcile_bugs = False
        self.state = load_state(root, sg)
        self.login = sg.member_login(root)
        self.team = sg.team_block(root)
        self.report = {"imported": [], "updated": [], "changed_in_progress": [], "skipped": [], "comments": [],
                       "notify": [], "failed": [], "evidence_downloads": []}
        self.known = {}
        self.reserved = set()

    # --- what is in _dev/
    def scan(self):
        found = {}
        rank = {"in-progress": 0, "code-inbox": 1, "done": 2}
        for where, pat in (("in-progress", "in-progress"), ("code-inbox", "code-inbox"), ("done", "done")):
            base = os.path.join(self.root, "_dev", pat)
            for dirpath, _, names in os.walk(base):
                for n in sorted(names):
                    if not (n.startswith("DEV-") and n.endswith(".md")):
                        continue
                    path = os.path.join(dirpath, n)
                    try:
                        with open(path, encoding="utf-8") as f:
                            key = jira_key_of(f.read())
                    except OSError:
                        continue
                    if key and (key not in found or rank[where] < rank[found[key][1]]):
                        found[key] = (n[:-3], where, path)
        self.known = found

    def rel(self, path):
        return os.path.relpath(path, self.root)

    def read(self, path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    def write(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    # --- git
    def commit(self, rel, message):
        return self.sg.commit_paths(self.root, message, [rel])

    def publish(self):
        rc, msg = self.sg.push(self.root)
        if rc == 2:
            prc, pmsg = self.sg.pull(self.root)
            if prc != 0:
                return prc, "pull before the push failed: %s" % pmsg
            rc, msg = self.sg.push(self.root)
        return rc, msg

    def ahead(self):
        sg = self.sg
        rc, o, _ = sg.git(self.root, ["rev-list", "--count", "%s/%s..%s" % (sg.remote_name(self.root),
                                                                              sg.base_branch(self.root),
                                                                              sg.base_branch(self.root))])
        return rc == 0 and o.strip().isdigit() and int(o.strip()) > 0

    def fail(self, issue, story, phase, msg):
        self.report["failed"].append({"key": issue["key"], "story": story, "phase": phase, "error": msg})

    # --- ids
    def mint(self):
        today = datetime.date.fromisoformat(self.day)
        sid = self.dm.Mail(self.root, today=today).next_story_id()
        while sid in self.reserved:
            m = re.match(r"^(.*-)(\d{3})$", sid)
            sid = "%s%03d" % (m.group(1), int(m.group(2)) + 1)
        return sid

    def key_to_story(self):
        return {k: v[0] for k, v in self.known.items()}

    # --- the comment, once per set of missing fields
    def note_gap(self, issue, blocks):
        missing = missing_fields(blocks)
        key, seen = issue["key"], self.state["commented"]
        if not missing:
            seen.pop(key, None)
            return
        tag = ",".join(missing)
        if seen.get(key) != tag:
            seen[key] = tag
            self.report["comments"].append({"key": key, "body": comment_body(key, missing)})

    def plan_evidence(self, issue, sid):
        is_bug = issue.get("issue_type", "").casefold() == (self.rec.get("bug_type") or "Bug").casefold()
        self.state.setdefault("work_item_types", {})[issue["key"]] = "bug" if is_bug else "story"
        if is_bug:
            # This is remote metadata, never a downloaded/delivered marker. It also supersedes the
            # preserved body of a claimed report when attachments were removed in Jira.
            self.state.setdefault("evidence", {})[issue["key"]] = issue.get("attachments", [])
        else:
            self.state.setdefault("evidence", {}).pop(issue["key"], None)

    def pending_evidence(self):
        """Repeat requests until the session verifies its local cache, including on an empty Jira page."""
        for key, (sid, where, path) in sorted(self.known.items()):
            if where == "done" or self.state.get("work_item_types", {}).get(key) == "story":
                continue
            latest = self.state.get("evidence", {})
            if key in latest:
                evidence = latest[key]
            else:
                try:
                    fields = dict(split_story(self.read(path))[0])
                    if fields.get("work_item_type") != ["work_item_type: bug"]:
                        continue
                    evidence = json.loads(fields.get("evidence", ["evidence: []"])[0].split(":", 1)[1])
                except (OSError, ValueError, IndexError):
                    continue
            if not isinstance(evidence, list):
                continue
            for item in evidence:
                if not isinstance(item, dict) or not isinstance(item.get("attachment_id"), str) or not \
                        re.fullmatch(r"[0-9]+", item["attachment_id"]):
                    continue
                if not supported_screenshot(item.get("filename"), item.get("mime_type")):
                    continue
                plan = {k: item[k] for k in ("attachment_id", "filename", "mime_type")}
                plan["mime_type"] = plan["mime_type"].casefold()
                if isinstance(item.get("size"), int) and not isinstance(item["size"], bool) and item["size"] >= 0:
                    plan["size"] = item["size"]
                self.report["evidence_downloads"].append(dict(plan, key=key, story=sid))

    # --- one issue
    def new_issue(self, issue):
        key = issue["key"]
        if issue["status_category"] == "done" or issue["status"].lower() in ("done", "rejected") \
                or "wont-do" in [l.lower() for l in issue["labels"]]:
            self.report["skipped"].append("SKIP %s: already %s in Jira, not imported" % (key, issue["status"] or "done"))
            return
        sg, ref = self.sg, "refs/leases/%s%s" % (LEASE_PREFIX, key)
        rc, msg, held = sg.lease_read(self.root, ref)
        if rc != 0:
            return self.fail(issue, None, "lease", msg)
        login = self.login or "local"
        if held and not sg.lease_ours(self.root, held, login):
            self.report["skipped"].append("SKIP %s: imported by %s as %s" % (key, held.get("login", "?"),
                                                                              held.get("story", "?")))
            return
        if held:
            sid = held.get("story")
            if not isinstance(sid, str) or not self.dm.STORY_RE.match(sid):
                return self.fail(issue, None, "lease", "our lease %s names no usable story id" % ref)
        else:
            sid = self.mint()
            rec = {"key": key, "story": sid, "login": login, "client": sg.client_id(self.root),
                   "host": socket.gethostname(), "taken": sg.iso(time.time())}
            rc, msg, sha = sg.lease_commit(self.root, rec)
            if rc != 0:
                return self.fail(issue, sid, "lease", msg)
            rc, msg = sg.lease_push(self.root, ref, sha, "")
            if rc != 0:
                rc2, _, h2 = sg.lease_read(self.root, ref)
                if rc2 == 0 and h2 and h2.get("sha") == sha:
                    pass                                       # git said failed, but our lease is on the remote
                elif rc2 == 0 and h2 and not sg.lease_ours(self.root, h2, login):
                    self.report["skipped"].append("SKIP %s: imported by %s as %s" % (key, h2.get("login", "?"),
                                                                                      h2.get("story", "?")))
                    return
                else:
                    return self.fail(issue, sid, "lease", "push of the import lease failed: %s" % msg)
        self.reserved.add(sid)
        blocks = issue_blocks(issue, self.rec, self.key_to_story())
        path = os.path.join(self.root, sg.INBOX, sid + ".md")
        try:
            self.write(path, render_new(key, sid, blocks))
        except OSError as e:
            return self.fail(issue, sid, "write", str(e))
        rc, msg = self.commit(self.rel(path), "dev: import %s as %s" % (key, sid))
        if rc != 0:
            return self.fail(issue, sid, "commit", msg)
        self.known[key] = (sid, "code-inbox", path)
        self.report["imported"].append({"key": key, "story": sid})
        rc, msg = self.publish()
        if rc != 0:
            self.fail(issue, sid, "push", msg)
        self.note_gap(issue, blocks)
        self.plan_evidence(issue, sid)

    def dirty(self, path):
        try:
            lines = self.sg.status_lines(self.root, [self.rel(path)])
        except RuntimeError:
            return None
        return lines

    def known_issue(self, issue):
        key = issue["key"]
        sid, where, path = self.known[key]
        if where == "done":
            return
        try:
            text = self.read(path)
        except OSError as e:
            return self.fail(issue, sid, "read", str(e))
        blocks = issue_blocks(issue, self.rec, self.key_to_story())
        if where == "in-progress":
            names = differing(text, blocks)
            if not names:
                self.plan_evidence(issue, sid)
                return
            digest = hashlib.sha1(json.dumps(blocks, sort_keys=True).encode()).hexdigest()[:12]
            if self.state["told"].get(key) == digest:
                self.plan_evidence(issue, sid)
                return                                 # this very change was reported already
            self.state["told"][key] = digest
            new = with_jira_changed(text, self.day, names)
            self.write(path, new)
            rc, msg = self.commit(self.rel(path), "dev: note Jira change to %s from %s" % (sid, key))
            if rc != 0:
                self.state["told"].pop(key, None)
                return self.fail(issue, sid, "commit", msg)
            self.plan_evidence(issue, sid)
            self.note_gap(issue, blocks)
            self.report["changed_in_progress"].append({"key": key, "story": sid, "fields": names})
            self.report["notify"].append({
                "key": key, "story": sid, "fields": names,
                "message": "%s changed in Jira after %s was claimed (%s); the story is untouched except for a "
                           "jira_changed line. Tell its story-lead and its owner." % (key, sid, ", ".join(names))})
            return
        state = self.dirty(path)
        if state is None:
            return self.fail(issue, sid, "status", "git status failed")
        if state and not all(l.startswith("??") for l in state):
            self.report["skipped"].append("SKIP %s: %s has uncommitted changes" % (key, sid))
            return
        new = merge_owned(text, blocks)
        if new != text:
            self.write(path, new)
        if new != text or state:
            resumed = bool(state)                      # an import that stopped before its commit left the file untracked
            rc, msg = self.commit(self.rel(path), ("dev: import %s as %s" % (key, sid)) if resumed
                                  else "dev: update %s from %s" % (sid, key))
            if rc != 0:
                return self.fail(issue, sid, "commit", msg)
            if resumed:
                self.report["imported"].append({"key": key, "story": sid})
            else:
                self.report["updated"].append({"key": key, "story": sid})
        self.note_gap(issue, blocks)
        self.plan_evidence(issue, sid)

    # --- blockers imported after their dependants
    def resolve_preconditions(self):
        k2s = self.key_to_story()
        for key, (sid, where, path) in sorted(self.known.items()):
            if where != "code-inbox":
                continue
            try:
                text = self.read(path)
            except OSError:
                continue
            blocks, tail, nl = split_story(text)
            pre = next((ls for k, ls in blocks if k == "preconditions"), None)
            if not pre:
                continue
            items = [i.strip() for i in pre[0].split(":", 1)[1].split(";") if i.strip()]
            keep, got = [], []
            for it in items:
                m = PRECOND_RE.match(it)
                if m and m.group(1) in k2s:
                    got.append(k2s[m.group(1)])
                else:
                    keep.append(it)
            if not got:
                continue
            dep = next((ls for k, ls in blocks if k == "depends_on"), None)
            have = [] if not dep or dep[0].split(":", 1)[1].strip().lower() == "none" else \
                re.split(r"\s*,\s*", dep[0].split(":", 1)[1].strip())
            ids = ", ".join(sorted(set(have + got)))
            out = []
            for k, ls in blocks:
                if k == "preconditions":
                    if keep:
                        out.append([k, ["preconditions: " + "; ".join(keep)]])
                elif k == "depends_on":
                    out.append([k, ["depends_on: " + ids]])
                else:
                    out.append([k, ls])
            self.write(path, join_story(out, tail, nl))
            rc, msg = self.commit(self.rel(path), "dev: update %s from %s" % (sid, key))
            if rc != 0:
                self.fail({"key": key}, sid, "commit", msg)
            elif not any(u["key"] == key for u in self.report["updated"]):
                self.report["updated"].append({"key": key, "story": sid})

    def ordered(self):
        """The issues with a blocker ahead of what it blocks, otherwise in the order given."""
        by_key = {i["key"]: i for i in self.issues}
        out, done, active = [], set(), set()

        def visit(issue):
            k = issue["key"]
            if k in done or k in active:
                return
            active.add(k)
            for b in issue["blockers"]:
                if b in by_key:
                    visit(by_key[b])
            active.discard(k)
            done.add(k)
            out.append(issue)
        for issue in self.issues:
            visit(issue)
        return out

    def run(self):
        sg = self.sg
        self.scan()
        rc, msg, leases = sg.lease_list(self.root, LEASE_PREFIX)
        if rc != 0:
            raise Failed("listing the import leases failed: %s" % msg)
        self.reserved = {l["story"] for l in leases if isinstance(l.get("story"), str)}
        for issue in self.ordered():
            allowed_types = {(self.rec.get("bug_type") or "Bug").casefold(),
                             (self.rec.get("story_type") or "Story").casefold()}
            if issue.get("issue_type", "").casefold() not in allowed_types:
                known = self.known.get(issue["key"])
                self.fail(issue, known[0] if known else None, "hydrate",
                          "issuetype is missing or unsupported; fetch the configured Story/Bug type before pull")
                continue
            if (issue.get("issue_type", "").casefold() == (self.rec.get("bug_type") or "Bug").casefold() and
                    issue.get("attachments_known") is False):
                known = self.known.get(issue["key"])
                self.fail(issue, known[0] if known else None, "hydrate",
                          "attachment metadata is unknown; fetch fields ['attachment'] with view 'full' before pull")
                continue
            if issue["key"] in self.known:
                self.known_issue(issue)
            else:
                self.new_issue(issue)
        self.resolve_preconditions()
        if self.ahead():
            rc, msg = self.publish()
            if rc != 0:
                self.report["failed"].append({"key": None, "story": None, "phase": "push", "error": msg})
        if not self.report["failed"]:
            newest = max((w for w in (wall(i["updated"]) for i in self.issues) if w), default=None)
            if self.nowgiven:
                self.state["last_pass"] = "%s %s" % (self.day, self.hhmm)
            elif newest:
                self.state["last_pass"] = max(self.state.get("last_pass", ""), "%s %s" % newest)
            if self.reconcile_bugs and not self.report["skipped"]:
                self.state["bug_reconciliation_version"] = BUG_RECONCILIATION_VERSION
        self.pending_evidence()
        save_state(self.root, sg, self.state)
        return self.report


def pull_issues(root, issues, now=None, sg=None, dm=None, reconcile_bugs=False):
    """Run the pull for parsed `issues`; returns the report dict. Raises Refused or Failed."""
    if sg is None or dm is None:
        sg, dm = load_tools(root)
    rec = jira_record(root)
    day = now_wall(now)
    try:
        with sg.checkout_mutex(root):
            if sg.team_block(root) and not sg.member_login(root):
                raise Refused("this machine has no team member set (dev_mail.py team --me <login>)")
            rc, msg = sg.pull(root)
            if rc != 0:
                raise (Refused if rc == 2 else Failed)("the pull failed: %s" % msg)
            p = Pass(root, sg, dm, rec, issues, day)
            p.nowgiven = bool(now)
            p.reconcile_bugs = reconcile_bugs
            return p.run()
    except sg.MutexBusy as e:
        raise Refused(str(e))
    except sg.SettingsError as e:
        raise Refused(str(e))
    except dm.MailError as e:
        raise Refused(str(e))


# ---------------------------------------------------------------- push: git to Jira

KIT_STATUSES = ("To Do", "In Progress", "In Review", "Done", "Rejected")
# What a status the record does not map falls back to (the design's board map: no In Review column means In Progress plus a label).
DEFAULT_STATUSES = {"To Do": {"status": "To Do"}, "In Progress": {"status": "In Progress"},
                    "In Review": {"status": "In Progress", "label": "review"}, "Done": {"status": "Done"},
                    "Rejected": {"status": "Done", "label": "wont-do"}}
CLOSED_REJECTED = re.compile(r"^\d{4}-\d{2}-\d{2}\s*[,;:]?\s*rejected\b", re.I)    # dev_mail's CLOSED_REJECTED_RE
CLOSED_MERGED = re.compile(r"^\d{4}-\d{2}-\d{2}\s*[,;:]?\s*merged\b", re.I)
MERGE_SUBJECT = re.compile(r"^Merge (dev/\S+)$")
OP_NAMES = ("transition", "assign", "fields", "labels", "link", "start_date")
OP_IDENTITY = {"transition": ("to", "board_status", "label", "resolution"), "assign": ("login", "account_id"),
               "fields": ("story_points", "field"), "labels": ("add",), "link": ("branch", "pr"),
               "start_date": ("date", "only_if_empty")}
POINTS_FIELD_RE = re.compile(r"^customfield_\d+$")
TOKEN_MAX = 64
HARNESS_ALIASES = {"claude": "claude-code"}


def label_token(text):
    """A harness name made safe for a Jira label (lowercase a-z 0-9 . _ -, at most 64 characters; `claude` is
    `claude-code`), '' when nothing is left."""
    tok = re.sub(r"[^a-z0-9._-]", "", (text or "").strip().split("\n")[0].strip().lower())[:TOKEN_MAX]
    return HARNESS_ALIASES.get(tok, tok)


def short_host(host):
    """The first DNS label of a host name, lowercased, keeping a-z 0-9 and -; '' when nothing is left."""
    if not isinstance(host, str):
        return ""
    return re.sub(r"[^a-z0-9-]", "", host.strip().split(".")[0].lower())[:TOKEN_MAX].strip("-")


def board_entry(rec, kit):
    """{status, label?, resolution?} the record maps the kit status `kit` to, else the kit's own fallback."""
    v = (rec.get("statuses") or {}).get(kit)
    if isinstance(v, str) and v.strip():
        return {"status": v}
    if isinstance(v, dict) and isinstance(v.get("status"), str) and v["status"].strip():
        return {k: v[k] for k in ("status", "label", "resolution") if isinstance(v.get(k), str) and v[k].strip()}
    return dict(DEFAULT_STATUSES[kit])


def transition_op(rec, key, kit):
    entry = board_entry(rec, kit)
    op = {"op": "transition", "key": key, "to": kit, "board_status": entry["status"]}
    for k in ("label", "resolution"):
        if k in entry:
            op[k] = entry[k]
    mine = entry.get("label")
    others = sorted({board_entry(rec, k).get("label") for k in KIT_STATUSES if k != kit} - {None, mine})
    if others:
        op["clear_labels"] = others
    return op


def op_hash(op):
    """A short hash of what the op says (its identity fields, not the notes the poller may drop)."""
    ident = {"op": op["op"], "key": op["key"]}
    ident.update({k: op.get(k) for k in OP_IDENTITY[op["op"]] if k in op})
    return hashlib.sha1(json.dumps(ident, sort_keys=True).encode()).hexdigest()[:12]


def section_line(text, key):
    """The value of a `key:` line in the story's Result block (as `- key: v` or `key: v`), else of a top-level one; None."""
    top, _, result = text.partition("\n## Result")
    for part in (result, top):
        m = re.search(r"(?m)^[-*]?\s*%s:[ \t]*(.*)$" % key, part)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None


class Push:
    def __init__(self, root, sg, dm, rec):
        self.root, self.sg, self.dm, self.rec = root, sg, dm, rec
        self.project = rec["project"]
        self.team = sg.team_block(root)
        self.stories = {}                     # id -> {id, where, path, text, fields}

    # --- reading git
    def scan(self):
        rank = {"done": 0, "in-progress": 1, "code-inbox": 2}
        for where in ("done", "in-progress", "code-inbox"):
            for dirpath, _, names in os.walk(os.path.join(self.root, "_dev", where)):
                for n in sorted(names):
                    if not (n.startswith("DEV-") and n.endswith(".md")):
                        continue
                    sid = n[:-3]
                    if sid in self.stories and rank[self.stories[sid]["where"]] <= rank[where]:
                        continue
                    path = os.path.join(dirpath, n)
                    try:
                        with open(path, encoding="utf-8") as f:
                            text = f.read()
                    except OSError:
                        continue
                    self.stories[sid] = {"id": sid, "where": where, "path": path, "text": text,
                                         "fields": self.dm.story_fields(text)}

    def merged_branches(self):
        sg, base = self.sg, self.sg.base_branch(self.root)
        rc, out, err = sg.git(self.root, ["log", base, "--first-parent", "--merges", "--format=%s"])
        if rc != 0:
            raise Failed("reading the merges of %s failed: %s" % (base, (err or out).strip()[:300]))
        found = set()
        for line in out.splitlines():
            m = MERGE_SUBJECT.match(line.strip())
            if m:
                found.add(m.group(1))
        return found

    def leases(self):
        rc, msg, found = self.sg.lease_list(self.root, "story/")
        if rc != 0:
            raise Failed("listing the story leases failed: %s" % msg)
        out = {}
        for h in found:
            sid = h.get("ref", "")[len(self.sg.story_lease_ref("")):]
            if sid:
                out[sid] = h
        return out

    def branch_exists(self, sid):
        sg = self.sg
        for ref in ("refs/heads/dev/" + sid, "refs/remotes/%s/dev/%s" % (sg.remote_name(self.root), sid)):
            if sg.git(self.root, ["show-ref", "--verify", "--quiet", ref])[0] == 0:
                return True
        return False

    # --- what a story is
    def is_rejected(self, s):
        if s["where"] != "done":
            return False
        f = s["fields"]
        if CLOSED_REJECTED.match(f.get("closed", "")) or (f.get("rejected") or "").strip():
            return True
        status = section_line(s["text"], "status")
        return bool(status and status.split()[0].lower().strip(",;.") == "rejected")

    def claimer(self, s, lease):
        login = (lease or {}).get("login") or (s["fields"].get("claimed_by") or "").strip().split("\n")[0].strip()
        return login or None

    def epic_of(self, s):
        v = (s["fields"].get("epic") or "").strip()
        return v if re.match(r"^%s-\d+$" % re.escape(self.project), v) else None

    def adoption_date(self, s, lease):
        """First committed claim date, then lease date; legacy claim evidence falls back to this sync's local day."""
        path = "_dev/in-progress/" + s["id"] + ".md"
        rc, out, err = self.sg.git(self.root, ["log", "--all", "--no-renames", "--diff-filter=A", "--format=%cs", "--", path])
        if rc != 0:
            raise Failed("reading claim history failed: %s" % (err or out).strip()[:300])
        dates = [line for line in out.splitlines() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", line)]
        if dates:
            return min(dates)
        taken = self.sg.parse_iso((lease or {}).get("taken"))
        if taken is not None:
            return datetime.datetime.fromtimestamp(taken).date().isoformat()
        if lease or s["where"] == "in-progress" or s["fields"].get("claimed_by") \
                or CLOSED_MERGED.match(s["fields"].get("closed", "")):
            return datetime.date.today().isoformat()
        return None

    # --- members and labels
    def member_entries(self, login):
        """The record's entries for `login`: backlog.members first, then team.members (each a dict, or absent)."""
        out = []
        for members in ((self.rec.get("members") if isinstance(self.rec.get("members"), dict) else {}),
                        (self.team or {}).get("members") or {}):
            m = members.get(login)
            if isinstance(m, dict):
                out.append(m)
        return out

    def sole_member(self):
        """The one login in backlog.members, else None (none, or more than one)."""
        members = self.rec.get("members") if isinstance(self.rec.get("members"), dict) else {}
        logins = [l for l, m in members.items() if isinstance(m, dict)]
        return logins[0] if len(logins) == 1 else None

    def assign_op(self, key, login):
        """`login` None (a single-owner project that cannot tell who the owner is) gives an op with no account."""
        if login is None:
            members = self.rec.get("members") if isinstance(self.rec.get("members"), dict) else {}
            return {"op": "assign", "key": key, "login": "owner", "account_id": None,
                    "note": "no jira_account_id for the owner (backlog.members has %d entries, one is needed): "
                            "run project-scaffolding's Jira setup" % len(members)}
        op = {"op": "assign", "key": key, "login": login}
        entries = self.member_entries(login)
        name = next((m["name"] for m in reversed(entries) if isinstance(m.get("name"), str) and m["name"].strip()), None)
        if name:
            op["name"] = name
        account = next((m["jira_account_id"].strip() for m in entries
                        if isinstance(m.get("jira_account_id"), str) and m["jira_account_id"].strip()), None)
        if account:
            op["account_id"] = account
        else:
            op["account_id"] = None
            op["note"] = "no jira_account_id for %s: run project-scaffolding's Jira setup on that machine" % login
        return op

    def agent_labels(self, s, lease, login):
        """["agent:<harness>", "host:<short host>"] for a story this clone claimed, leaving out what git cannot say; []
        for another machine's claim (the lease's login and client are not ours) or a story with no lease in a team."""
        if self.team and not self.sg.lease_ours(self.root, lease or {}, self.sg.member_login(self.root)):
            return []
        labels = []
        harness = label_token(s["fields"].get("agent") or "") or label_token(os.environ.get("SCAFFOLDING_HARNESS") or "")
        if harness:
            labels.append("agent:" + harness)
        host = short_host((lease or {}).get("host"))
        if host:
            labels.append("host:" + host)
        return labels

    # --- ops
    def story_ops(self, s, key, lease, merged):
        rec, f, sid = self.rec, s["fields"], s["id"]
        ops = []
        if self.is_rejected(s):
            return [transition_op(rec, key, "Rejected")]
        if s["where"] == "done":
            if "dev/" + sid in merged or CLOSED_MERGED.match(f.get("closed", "")):
                ops.append(transition_op(rec, key, "In Review"))
        elif s["where"] == "in-progress" or lease:
            ops.append(transition_op(rec, key, "In Progress"))
        else:
            ops.append(transition_op(rec, key, "To Do"))
        login = self.claimer(s, lease)
        if self.team:
            claimed = bool(login and (s["where"] != "code-inbox" or lease))
        else:                                  # single owner: no leases and no claimed_by; the one member claims
            claimed = s["where"] != "code-inbox"
            login = login or self.sole_member()
        if claimed:
            ops.append(self.assign_op(key, login))
        pts = re.search(r"\d+", f.get("story_points") or "")
        if pts:
            op = {"op": "fields", "key": key, "story_points": int(pts.group(0))}
            field = rec.get("points_field")
            if isinstance(field, str) and POINTS_FIELD_RE.match(field):
                op["field"] = field
            ops.append(op)
        if claimed and s["where"] != "done" and login:
            labels = self.agent_labels(s, lease, login)
            if labels:
                ops.append({"op": "labels", "key": key, "add": labels})
        pr_text, branch_text = section_line(s["text"], "pr"), section_line(s["text"], "branch")
        url = re.search(r"https?://\S+", pr_text or "")
        branch = (branch_text or "").split()[0] if branch_text else ""
        if not branch.startswith("dev/"):
            branch = ""
        if url or branch or self.branch_exists(sid):
            ops.append({"op": "link", "key": key, "branch": branch or "dev/" + sid,
                        "pr": url.group(0).rstrip(".,;)") if url else None})
        return ops

    def epic_ops(self):
        groups = {}
        for s in self.stories.values():
            key = self.epic_of(s)
            if key:
                groups.setdefault(key, []).append(s)
        ops = []
        for key in sorted(groups, key=lambda k: int(k.rsplit("-", 1)[1])):
            members = groups[key]
            closed = [s for s in members if s["where"] == "done"]
            done = [s for s in closed if not self.is_rejected(s)]
            if len(closed) == len(members) and done:
                ops.append(transition_op(self.rec, key, "In Review"))
            elif any(s["where"] == "in-progress" or s["id"] in self.lease_map for s in members if s["where"] != "done"):
                ops.append(transition_op(self.rec, key, "In Progress"))
        return ops

    def run(self):
        self.scan()
        self.lease_map = self.leases()
        merged = self.merged_branches()
        by_key = {}
        for s in self.stories.values():
            key = jira_key_of(s["text"])
            if key and key.startswith(self.project + "-"):
                by_key[key] = s
        ops, dates = [], {}
        for key in sorted(by_key, key=lambda k: int(k.rsplit("-", 1)[1])):
            s = by_key[key]
            lease = self.lease_map.get(s["id"]) if s["where"] != "done" else None
            ops += self.story_ops(s, key, lease, merged)
            date = self.adoption_date(s, lease)
            if date:
                dates[key] = date
                epic = self.epic_of(s)
                if epic:
                    dates[epic] = min(date, dates.get(epic, date))
        ops += self.epic_ops()
        # Claim history survives merge, release and rejection, including when Jira was unavailable throughout.
        return ops + [{"op": "start_date", "key": key, "date": date, "only_if_empty": True}
                      for key, date in dates.items()]


def pending(ops, pushed):
    """The ops the state's `pushed` record does not already hold. A To Do transition only counts for a story that has had
    a transition pushed before (one never pushed is already To Do in Jira)."""
    out = []
    for op in ops:
        have = (pushed.get(op["key"]) or {})
        if op["op"] == "start_date" and "start_date" in have:
            continue                         # ensure once, rather than rewriting the first date on later days
        if op["op"] == "transition" and op["to"] == "To Do" and "transition" not in have:
            continue
        if have.get(op["op"]) != op_hash(op):
            out.append(op)
    return out


def push_ops(root, sg=None, dm=None):
    """The Jira operations git calls for and the state file does not already hold, as a list of dicts."""
    if sg is None or dm is None:
        sg, dm = load_tools(root)
    rec = jira_record(root)
    try:
        with sg.checkout_mutex(root):
            ops = Push(root, sg, dm, rec).run()
            state = load_state(root, sg)
            dates, pushed = state["start_dates"], state.get("pushed") or {}
            before = dict(dates)
            for op in ops:
                if op["op"] == "start_date" and "start_date" not in (pushed.get(op["key"]) or {}):
                    dates.setdefault(op["key"], op["date"])
            # Retain the first planned date until confirmed, even when the item has since moved or disappeared.
            ops = [op for op in ops if op["op"] != "start_date"]
            for key, date in dates.items():
                if not isinstance(key, str) or not KEY_RE.fullmatch(key) or not key.startswith(rec["project"] + "-"):
                    raise Refused("invalid issue key in pending Start dates")
                try:
                    datetime.date.fromisoformat(date)
                except (TypeError, ValueError):
                    raise Refused("invalid pending Start date for %s" % key)
            ops += [{"op": "start_date", "key": key, "date": dates[key], "only_if_empty": True}
                    for key in sorted(dates, key=lambda k: int(k.rsplit("-", 1)[1]))]
            if dates != before:
                save_state(root, sg, state)
            return pending(ops, pushed)
    except sg.MutexBusy as e:
        raise Refused(str(e))
    except sg.SettingsError as e:
        raise Refused(str(e))
    except dm.MailError as e:
        raise Refused(str(e))


def read_ops(path):
    """The ops in the poller's file: the list push printed, or an object with `ops`."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise Refused("cannot read %s: %s" % (path, e))
    if isinstance(data, dict):
        data = data.get("ops")
    if not isinstance(data, list):
        raise Refused("%s holds no list of ops (expected the list push printed)" % path)
    for op in data:
        if not isinstance(op, dict) or op.get("op") not in OP_NAMES or not isinstance(op.get("key"), str) \
                or not KEY_RE.match(op["key"]) or any(k not in op for k in OP_IDENTITY[op["op"]][:1]):
            raise Refused("not a push op: %s" % json.dumps(op)[:120])
    return data


def mark_done(root, ops, sg=None):
    """Record `ops` as pushed in the state file. Returns the list of {key, op} marked."""
    if sg is None:
        sg, _ = load_tools(root)
    try:
        with sg.checkout_mutex(root):
            st = load_state(root, sg)
            pushed = st.setdefault("pushed", {})
            if not isinstance(pushed, dict):
                pushed = st["pushed"] = {}
            marked = []
            for op in ops:
                if not isinstance(pushed.get(op["key"]), dict):
                    pushed[op["key"]] = {}
                pushed[op["key"]][op["op"]] = op_hash(op)
                if op["op"] == "start_date":
                    st["start_dates"].pop(op["key"], None)
                marked.append({"key": op["key"], "op": op["op"]})
            save_state(root, sg, st)
            return marked
    except sg.MutexBusy as e:
        raise Refused(str(e))


def op_line(op):
    k = op["op"]
    if k == "transition":
        extra = "".join(" %s=%s" % (x, op[x]) for x in ("label", "resolution") if x in op)
        return "TRANSITION %s -> %s (board: %s%s)" % (op["key"], op["to"], op["board_status"], extra)
    if k == "assign":
        who = " (%s)" % op["name"] if op.get("name") else ""
        return "ASSIGN %s to %s%s%s" % (op["key"], op["login"], who,
                                        " account=" + op["account_id"] if op.get("account_id") else " UNASSIGN: " + op.get("note", ""))
    if k == "fields":
        return "FIELDS %s story_points=%s%s" % (op["key"], op["story_points"], " field=" + op["field"] if op.get("field") else "")
    if k == "labels":
        return "LABELS %s add %s" % (op["key"], " ".join(op["add"]))
    if k == "start_date":
        return "START_DATE %s %s (only if empty)" % (op["key"], op["date"])
    return "LINK %s branch=%s pr=%s" % (op["key"], op["branch"], op["pr"] or "none")


# ---------------------------------------------------------------- commands

def cmd_jql(args, root):
    sg, _ = load_tools(root)
    rec = jira_record(root)
    sg.ensure_ignored(root)
    state = load_state(root, sg)
    reconciliation = None
    if state.get("bug_reconciliation_version") != BUG_RECONCILIATION_VERSION:
        reconciliation = {"version": BUG_RECONCILIATION_VERSION, "jql":
            "project = %s AND issuetype = %s AND statusCategory != Done ORDER BY updated ASC" %
            (rec["project"], jql_name(rec.get("bug_type") or "Bug")), "fields": FIELDS}
    print(json.dumps({"jql": build_jql(rec, state.get("last_pass")), "fields": FIELDS,
                      "reconcile_bugs": reconciliation}, indent=2))
    return 0


def cmd_pull(args, root):
    try:
        issues = read_issues(args.issues)
    except ValueError as e:
        raise Refused(str(e))
    report = pull_issues(root, issues, args.now, reconcile_bugs=bool(args.reconcile_bugs))
    for line in report["skipped"]:
        if line.startswith("SKIP "):
            print(line, file=sys.stderr)
    print(json.dumps(report, indent=2))
    return 3 if report["failed"] else 0


def cmd_push(args, root):
    if args.mark_done:
        marked = mark_done(root, read_ops(args.mark_done))
        print(json.dumps({"marked": marked}, indent=2))
        return 0
    ops = push_ops(root)
    if args.json:
        print(json.dumps(ops, indent=2))
    else:
        print("\n".join(op_line(o) for o in ops) if ops else "NOTHING")
    return 0


def cmd_status(args, root):
    sg, _ = load_tools(root)
    rc, msg, leases = sg.lease_list(root, LEASE_PREFIX)
    if rc != 0:
        raise Failed(msg)
    print(json.dumps({"state": load_state(root, sg), "leases": leases}, indent=2))
    return 0


def build_parser():
    ap = argparse.ArgumentParser(prog="jira_sync.py", description="Jira stories into the dev inbox (offline; the poller "
                                                                  "does the fetching and the writing to Jira).")
    ap.add_argument("--root", help="the project folder (default: the parent of this file's folder)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("jql", help="print the poller's JQL and field list").set_defaults(func=cmd_jql)
    p = sub.add_parser("pull", help="import and update stories from the issues the poller fetched")
    p.add_argument("--issues", required=True, metavar="FILE")
    p.add_argument("--reconcile-bugs", type=int, choices=[BUG_RECONCILIATION_VERSION],
                   help="mark this reconciliation version complete; supply only after fetching every query page")
    p.add_argument("--now", metavar="ISO", help="the time to record as the last pass (default: the newest `updated` seen)")
    p.set_defaults(func=cmd_pull)
    p = sub.add_parser("push", help="print the Jira operations git calls for (offline), or record the ones applied")
    p.add_argument("--json", action="store_true", help="print the operations as a JSON list")
    p.add_argument("--mark-done", metavar="FILE", help="record the ops in FILE (the list push printed, or a subset) as pushed")
    p.set_defaults(func=cmd_push)
    sub.add_parser("status", help="print the state file and the import leases").set_defaults(func=cmd_status)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    root = project_root(args.root)
    try:
        return args.func(args, root)
    except Refused as e:
        print("ERR %s" % e, file=sys.stderr)
        return 2
    except Failed as e:
        print("ERR %s" % e, file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
