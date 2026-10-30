id: DEV-YYYY-MM-DD-001      (from `python3 -B _tools/dev_mail.py next-story-id`)
title: One line, what changes. From 2026-10-27: 80 characters or fewer, no backticks, not starting `Site:` or a story id (references/cowork.md, "Titles")
kind: code | data | ui | docs
design_impact: yes | no
ui: (kind ui only, when the project's components piece is on) the kit components the screen uses, from COMPONENTS.md, e.g. `pageHead, card, dataTable, emptyState`; a new one as `new: <name>, because <why none fits>`; `ui: none` when it changes no screen
requested: YYYY-MM-DD, by <owner> via Cowork
story_points: (left out by the author: the Code session that claims the story adds it, Fibonacci 1-21, complexity incl. tests)
epic: the backlog item the story belongs to, e.g. `B-014` (a file in `backlog/`), or `none` only when it belongs to no item. Stories dated from 2026-10-27 must carry it.
priority: the level alone, P1-P5, e.g. `P3`. From 2026-10-27 a story with a reason after the level (`P3, default`) is refused.
priority_reason: the rubric line the level comes from (the dev-inbox skill's references/cowork.md, "Priority"), e.g. `default`,
  `broken for a user: <what>`, `due 2026-11-14: <what>`, `waiting: <who> needs it for <what>`, `polish`, `idea`, `from B-034`.
  Required from 2026-10-27, and the same rules apply (a P1 needs a reason that allows P1).
  Stories dated before 2026-10-27 keep the one line `priority: P3, default`.
size: XS | S | M | L | XL, the author's guess at its size (references/cowork.md, "Size"); an XL is cut up first
depends_on: none, or the ids of the stories that must be merged first, separated by commas, nothing else, e.g.
  `DEV-2026-10-27-001, DEV-2026-10-27-002`. From 2026-10-27 text after the ids is refused (older stories may still carry it).
preconditions: (optional, free text) what has to hold that is not a story: data published, a person's action, e.g.
  `the owner confirms the export format`. Nothing reads it but the person doing the story.
goal: One sentence. The outcome the owner wants, not the method.
acceptance:
- [ ] A condition that can be checked, with the figure, field or screen it is checked on
- [ ] ...
files_or_areas: paths, modules or screens the change is expected to touch
decided: Rulings already made, so they are not reopened. "none" if none.
out_of_scope: What must not be touched. "none" if nothing.
validate: Exact commands, and what a pass looks like.
suggested_approach: |
  (Optional. Cowork's reasoning on how to build it: the steps, the pitfalls, the design docs and prior commits it
  relies on, the alternatives it rejected and why. A starting point, not a spec. Leave the field out if there is none.)
# A story spawned from a mailbox thread (dev_mail.py spawn-story) gets four more lines from the tool, never from the author:
# origin: MSG-..., chain: DEV-..., depth: 1|2, spawned: <date>. Leave them out of a draft.
# Two lines only the owner writes, never the author: `paused: <date>, by <owner>: <why>` holds a story, and
# `expedite: <date>, by <owner>: <why>` sends it ahead of every other (an emergency; one story at a time).
