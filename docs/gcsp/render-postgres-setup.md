# GCSP PostgreSQL on Render: setup guide

For Gary, 5 November 2026. This unblocks FUCQ-83 (policy versions) and FUCQ-66 (manual claims and expiry). Their code is
built; it only needs a real database to prove against. The backend reads one setting, `GCSP_DATABASE_URL`
(`server/gcsp/repository/postgres.js`), and applies its own migrations on first open. You don't run any SQL by hand.

Allow about 15 minutes.

## 1. Create the database

1. Sign in at <https://dashboard.render.com> with the account that owns the GCSP environment.
2. Click **New**, then **Postgres**.
3. Fill in:
   - **Name:** `gcsp-db`
   - **Database:** `gcsp`
   - **User:** `gcsp`
   - **Region:** the same region as the GCSP backend service, if one exists. Otherwise pick Frankfurt (EU Central),
     which is closest to the UK.
   - **PostgreSQL version:** the default (16 or later).
   - **Plan:** Free is enough for the demo. A free database expires 30 days after it's created, so it lasts until
     early December. Choose a paid plan if it must outlive that.
4. Click **Create Database** and wait until its status is **Available**, which usually takes 1 to 3 minutes.

## 2. Copy the two connection strings

On the database's **Info** page, under **Connections**:
- **Internal Database URL:** for a Render service in the same region. Use this one on the GCSP backend.
- **External Database URL:** for connections from outside Render, such as the pollers on your Mac and Russell's.

Both look like `postgresql://gcsp:<password>@<host>/gcsp`. They contain the password, so treat them as secrets: never
paste them into Jira, Slack channels, git or a story file.

Under **Access Control**, check that inbound connections are allowed from anywhere (`0.0.0.0/0`, the default). If
it's restricted, add your Mac's and Russell's IP addresses, or the pollers can't connect.

## 3. Set it on the GCSP backend service

If the GCSP backend web service (built from the `gcsp-poc` branch) already exists:
1. Open it in the dashboard, then **Environment**.
2. Add `GCSP_DATABASE_URL`, with the **Internal Database URL** as its value.
3. Click **Save, rebuild and deploy**.

If there is no GCSP backend service yet, skip this step: the pollers can prove the stories locally (step 4). Creating
the service is a separate job, so tell me and I'll write it up.

Never add the URL to `render.yaml` with a value. Like `DEMO_ACCESS_KEY`, it belongs in the dashboard only.

## 4. Give it to the pollers

The blocked stories need the contract tests run against the real database. That happens on whichever Mac holds the
story.

**On your Mac**, save the External Database URL in a file that git ignores (everything under `.claude/` except
scaffolding is ignored). Run this in Terminal, pasting the URL between the quotes:

```bash
printf '%s\n' 'postgresql://PASTE-EXTERNAL-URL-HERE?sslmode=require' > ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url && chmod 600 ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url
```

Keep `?sslmode=require` on the end: Render accepts outside connections over SSL only.

**For Russell:** FUCQ-83 and FUCQ-66 are his poller's claims, so his Mac needs the same file in his clone. Send him the
External URL privately (a direct message, or in person), not in a shared channel.

Then tell me "the database URL is in place". I'll check that it connects without printing it, and tell Russell's
poller the stories can resume.

## 5. Check it worked (optional)

From the repo root on your Mac:

```bash
GCSP_DATABASE_URL="$(cat .claude/gcsp-database-url)" node --test server/test/gcsp-repository-contract.test.js
```

You should see no skips, and a pass for the native PostgreSQL constraint tests. With the URL unset those tests say
"GCSP_DATABASE_URL is unset" and are skipped. The suite creates and drops its own isolated test schemas, so it leaves
the database clean.

## Rotating or removing it

- **Rotate the password:** use **Rotate Password** on the database's Info page. Then update the backend's environment
  variable and both `.claude/gcsp-database-url` files.
- **After the demo:** delete the database from its **Settings** page. Nothing else depends on it.
