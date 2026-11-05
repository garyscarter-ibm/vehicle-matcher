# Remaining Claude scaffolding installation — 5 November 2026

Codex reports scaffolding 0.7.1 installed and enabled. The project has the new map helpers,
assets and generated instructions; the project-owned Jira importer is preserved. The source
clone is current at `5ad376a` when checked. Doctor and the installer were run.

The system-managed Claude files already match the staged source; only its installation manifest
needs an administrator update. `sudo -n` confirms that a private administrator password is required.
The stage contains no managed-policy or agent changes. In Terminal, run:

```sh
sudo sh "/Users/usget/Claude/agent-scaffolding/tools/apply.sh" --staging "/Users/usget/Claude/agent-scaffolding/.claude/install-runs/vehicle-matcher-20261105/staging" --machine "/Users/usget/.config/agent-scaffolding/machine.json" --plan-id "eb633def46e67ca3"
```

Enter the administrator password only at Terminal's private prompt. If the pinned stage is
reported stale, regenerate with `tools/install`; do not bypass the plan identity check.

Then update Claude Desktop's plugin pin from Terminal:

```sh
/usr/bin/python3 -I -B "/Users/usget/Claude/agent-scaffolding/tools/pin-marketplace" --ref 5ad376a
```

When it prints the wait message, quit Claude Desktop normally with Cmd+Q. The tool updates its
pin and reopens Desktop. The agent has not started a waiter or restarted either application.
This step affects Claude's plugin cache; it does not require restarting the active Codex task.

After these steps, run `tools/doctor --project /Users/usget/Claude/vehicle-matcher` and verify the
managed manifest, Desktop pin/cache and active gateway. Codex's live IBM Global check already
passes. Doctor's Claude default-endpoint failure is a separate harness observation and does not
establish that the active Codex session is outside IBM.
