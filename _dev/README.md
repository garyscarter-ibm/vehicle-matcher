# Development stories

**Keep this folder clear. It holds only the dev queue:** `README.md`, `story-template.md`, `code-inbox/`,
`cowork-inbox/`, `in-progress/` and `done/`. Hand-overs, notes and drafts go elsewhere in the project, never here.

Cowork posts a user story to `code-inbox/` when a request needs code. A Claude Code session started with "start the dev
poller" builds it on its own branch, merges it once its tests pass (or leaves it for review, if the project's merge
setting is `review`), and closes it. Code can ask Cowork to clarify a story, and hand Cowork a follow-on job, through
`cowork-inbox/`. Every post goes through `_tools/dev_mail.py`, which enforces the limits in `_config/dev-mail.json`.
The procedure for both sides is the managed `dev-inbox` skill.

| Folder | Holds |
|---|---|
| `code-inbox/` | Stories waiting (Cowork to Code), `<id>.md`. |
| `cowork-inbox/` | Threads from Code to Cowork (questions and follow-on jobs), `MSG-<date>-<nnn>.md`. Only `dev_mail.py` writes here. |
| `in-progress/` | Stories Code has claimed. The `## Result` block is on the story's branch until it merges. |
| `done/YYYY-MM/` | Stories merged or closed. |

Story id: `DEV-<yyyy-mm-dd>-<nnn>`; `python3 -B _tools/dev_mail.py next-story-id` prints the next free one.
Which story goes first: `python3 -B _tools/dev_mail.py queue` (expedite, then blockers, then priority, size and age).
The format is `story-template.md`.
