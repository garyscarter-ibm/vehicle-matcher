# Technical readiness for story pickup

Gary Carter directed on 5 November 2026 that the dispatcher assess actual technical blockers rather than use Jira
`depends_on` links as automatic pickup gates. The links may express functional journey order. This instruction
supersedes the dev-inbox procedure's dependency-only admission rule for this project.

For each candidate, inspect its acceptance criteria, the current implementation, agreed interfaces and active file
ownership. Record the API, event, data shape or shared component that makes independent implementation possible,
the files it can own, and any missing technical edge. A concrete missing interface, unresolved incompatible contract,
or conflicting writer can still block that scope. Another ticket's unfinished status alone does not.

Keep implementation readiness distinct from completion readiness. Build independent capability against an agreed
interface and validate it meaningfully. Retain any unexercised producer, live-service or end-to-end acceptance as
outstanding; synthetic fixtures and mock success do not satisfy those checks. Do not mark a ticket built until its
acceptance is met.

Explicit pauses and date holds, source/access permissions, existing claims and leases, safe resource ownership,
and serial full-suite and merge coordination remain in force. FUCQ-27/28 and FUCQ-61 retain their agreed post-demo
timing. Do not take another collaborator's active claim through this readiness change.

Keep the Jira links as context. This instruction changes execution admission; it does not request Jira relationship
edits or add backlog scope. Record the assessment in each claimed story's `decided`/Result and in the dispatcher's
current-run state. Pass the rule and relevant interface evidence to every story chat and descendant.
