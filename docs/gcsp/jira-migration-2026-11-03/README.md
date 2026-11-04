# Jira migration — 3 November 2026

The active backlog is now [FUCQ on ibm-consulting.atlassian.net](https://ibm-consulting.atlassian.net/jira/software/projects/FUCQ/), board **2336**. `.claude/scaffolding.json` routes future reads and writes there. All scaffolding remains on.

All **75 source issues — 21 Epics, 53 Stories and 1 Bug — were copied and verified** from `ibm-consulting-sandbox003.atlassian.net`, board 2132. The existing destination FUCQ-1 Bug was preserved. The migrated issues occupy FUCQ-2 through FUCQ-76. [mapping.json](mapping.json) records every actual source/destination ID and key returned by Jira; use it when reading historical evidence. For example, discovery context is now **FUCQ-2**, and the old FUCQ-75 test Bug is now FUCQ-76.

| Restored status | Migrated issues |
|---|---:|
| To Do | 57 |
| In Progress | 11 |
| In Review | 1 |
| Done | 2 |
| Rejected | 4 |

Verification covered every migrated title, issue type, description, label, priority, assignee/reporter, parent, native link, comment, estimate, start/due date and resolution. It confirmed **53 parent relationships, 108 directed/related links and 24 original comments**. Rich descriptions retain headings, lists, code, links and acceptance checkboxes. Embedded issue references now use the destination identities. The two Done issues retain native Done resolutions. The source contained no attachments or populated native story-point estimates; the new board's Story point estimate feature is enabled.

Jira's native creation, update, resolution and copied-comment timestamps reflect the migration. Original timestamps and authors are recorded in the copied content, with the full original records and **313 audit-history entries** preserved in the private export. Native rank and history were not recreated as Jira history.

The complete `source-export.json` is attached to [the new discovery-context issue, FUCQ-2](https://ibm-consulting.atlassian.net/browse/FUCQ-2), attachment **84118**. It was downloaded again and its bytes matched the source export:

```text
bytes: 2630708
SHA-256: f6a96cd22c96c52d63f4d5531a7b30c7af305600b5be520a0fd89b2738f9cb2c
```

The local `source-export.json` beside this record is intentionally Git-ignored. The repository is public; keep the full export in Jira or private storage. [verification.json](verification.json) contains the per-issue check results and semantic description hashes without publishing the original comments or history.

Active documentation, structured story drafts and the canonical draw.io source have been remapped. Existing filenames, dated publication/readback evidence, supplied assets and historical snapshots retain their original names and keys. Consult the mapping when those old identities appear. Pre-existing working-copy changes were preserved; only the migration's changes to tracked documents were staged.

Project configuration/board checks passed, the offline Jira push preview was empty, and no local Jira leases or imported issue state needed remapping. No poller was started. Other clones must pull this cutover and check their own `.claude/jira-sync.json`, imported story IDs and leases before resuming writers; Gary's separate clone was not inspected.

The old board is ready for Russell to retire. Future work in this checkout uses the new site. The wider installation doctor separately reported an older `dev_mail.py` and Claude's default gateway setting; those were outside this migration and were not changed. Codex's IBM Global gateway check passed.
