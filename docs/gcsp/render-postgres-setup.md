# GCSP on Render: end-to-end setup

For Gary, 5 November 2026. This puts the `gcsp-poc` branch on Render as its own environment, separate from the
retail demo: a backend web service, a PostgreSQL database and a static site (HLD review Q1 and Q2). Allow 30 to 45
minutes, most of it waiting for builds.

**Leave the retail service alone.** The existing `bmw-matcher-api` service and GitHub Pages serve the retail demo from
`main`. Don't edit, redeploy or rename them, and don't use **New > Blueprint** for this. The repo's `render.yaml` is the
retail blueprint, and applying it would create a second `bmw-matcher-api`.

## What you'll have at the end

| Render resource | Name | Built from | Purpose |
|---|---|---|---|
| PostgreSQL | `gcsp-db` | n/a | Durable GCSP store. Unblocks FUCQ-83 and FUCQ-66. |
| Web service | `gcsp-api` | `gcsp-poc`, folder `server/` | The Node backend. |
| Static site | `gcsp-site` | `gcsp-poc`, repo root | The launcher, the GCSP pages and the component gallery. |

**What works once it's live.** The GCSP pages (`gcsp-employee.html`, `gcsp-greg.html`, `gcsp-outbox.html`) and the
gallery run on built-in sample data (`?fixture=...`). The backend starts, passes its health check and serves the retail
matching API. It doesn't yet connect GCSP sign-in or the database to those pages, so `/api/gcsp/*` answers "GCSP
identity has not been configured". Connecting them is later stories' work. The database's job today is the PostgreSQL
proof that FUCQ-83 and FUCQ-66 need.

## Before you start

- A Render account at <https://dashboard.render.com>, with GitHub connected (**Account Settings > Git**) and access to
  `garyscarter-ibm/vehicle-matcher`.
- Pick one region and use it for all three resources. Frankfurt (EU Central) is closest to the UK.
- Optional: in the dashboard, create a **Project** called `GCSP` and make all three resources inside it, to keep them
  together and apart from the retail service.

## Step 1. Create the database

1. Click **New**, then **Postgres**.
2. Fill in:
   - **Name:** `gcsp-db`
   - **Database:** `gcsp`
   - **User:** `gcsp`
   - **Region:** your chosen region.
   - **PostgreSQL version:** the default (16 or later).
   - **Plan:** Free is enough for the demo. A free database expires 30 days after it's created, so it lasts until
     early December. Choose a paid plan if it must last longer.
3. Click **Create Database**, and wait until it shows **Available** (1 to 3 minutes).
4. On its **Info** page, under **Connections**, note:
   - **Internal Database URL:** used by `gcsp-api` in step 2.
   - **External Database URL:** used by the pollers on your Mac and Russell's in step 4.

   Both look like `postgresql://gcsp:<password>@<host>/gcsp`. They contain the password, so never paste them into Jira,
   Slack channels, git or a story file.
5. Under **Access Control**, leave inbound connections open to `0.0.0.0/0`, the default. If it's restricted, add your
   IP address and Russell's.

You don't run any SQL. The backend applies its own migrations the first time it opens the database.

## Step 2. Create the backend web service

1. Click **New**, then **Web Service**, and pick `garyscarter-ibm/vehicle-matcher`.
2. Fill in:
   - **Name:** `gcsp-api`. Your backend URL becomes `https://gcsp-api.onrender.com`, or that name plus a suffix if
     it's taken. Note the exact URL Render shows.
   - **Branch:** `gcsp-poc`
   - **Region:** the same as the database.
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install` (installs `pg`, the only runtime dependency)
   - **Start Command:** `npm start`
   - **Plan:** Free works, but it sleeps after about 15 minutes idle, and the first request then takes 30 to 50
     seconds. Choose Starter if the demo can't wait for that.
3. Under **Advanced**, set **Health Check Path** to `/health`.
4. Under **Environment Variables**, add:

   | Key | Value | Why |
   |---|---|---|
   | `NODE_VERSION` | `20` | Matches the retail service. |
   | `GCSP_DATABASE_URL` | the **Internal Database URL** from step 1 | The GCSP store. |
   | `GCSP_OFFLINE` | `1` | Stops the backend hitting the live retailer feeds at startup. Retail matching still works, but fetches on first request. |
   | `DEMO_ACCESS_KEY` | a demo password you choose | Optional. When set, every `/api/*` call needs it, and the pages prompt for it once. `/health` stays open. |

   Leave `GCSP_ALLOWED_ORIGINS` for step 3, when you know the static site's address. Don't set `PORT`: Render sets it.
5. Click **Create Web Service**, and wait for the deploy to show **Live** (3 to 5 minutes).
6. Check it: open `https://<your gcsp-api URL>/health`. It should show `{"ok":true}`.

## Step 3. Create the static site

1. Click **New**, then **Static Site**, and pick `garyscarter-ibm/vehicle-matcher` again.
2. Fill in:
   - **Name:** `gcsp-site`
   - **Branch:** `gcsp-poc`
   - **Root Directory:** leave empty (the repo root).
   - **Build Command:** paste this as one line, replacing `GCSP-API-URL` with your backend URL from step 2:

     ```
     mkdir -p _site && cp -R index.html block.html components.html gcsp-employee.html gcsp-greg.html gcsp-outbox.html gcsp-employee.css blocks assets _site/ && sed -i 's|https://bmw-matcher-api.onrender.com|GCSP-API-URL|' _site/blocks/demo-launcher/boot.js && sed -i 's|data-api="http://localhost:8787"|data-api="GCSP-API-URL"|' _site/block.html
     ```

     It copies only the files a browser needs: about 3 MB, not the 169 MB of stock fixtures. It also points the
     launcher and `block.html` at the GCSP backend, not the retail one.
   - **Publish Directory:** `_site`
3. Click **Create Static Site**, and wait for **Live** (1 to 2 minutes). Note its address, for example
   `https://gcsp-site.onrender.com`.
4. Go back to `gcsp-api`, then **Environment**. Add `GCSP_ALLOWED_ORIGINS` with the static site's address exactly:
   `https://` included, no trailing slash, and commas between several addresses. Click **Save, rebuild and deploy**.

## Step 4. Give the database to the pollers

The blocked stories prove themselves against the real database from whichever Mac holds the story.

**On your Mac**, save the External Database URL in a file git ignores (`.claude/` is ignored, apart from its shared
files). Paste the URL between the quotes:

```bash
printf '%s\n' 'postgresql://PASTE-EXTERNAL-URL-HERE?sslmode=require' > ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url && chmod 600 ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url
```

Keep `?sslmode=require` on the end: Render accepts connections from outside Render over SSL only.

**For Russell:** FUCQ-83 and FUCQ-66 are his poller's claims, so his Mac needs the same file in his clone. Send him the
External URL privately (a direct message, or in person), not in a shared channel.

## Step 5. Check it end to end

1. **Health:** `https://<gcsp-api URL>/health` shows `{"ok":true}`.
2. **Database:** from the repo root on your Mac, run:

   ```bash
   GCSP_DATABASE_URL="$(cat .claude/gcsp-database-url)" node --test server/test/gcsp-repository-contract.test.js
   ```

   Nothing should be skipped, and the native PostgreSQL constraint tests should pass. With no URL they're skipped with
   "GCSP_DATABASE_URL is unset". The suite creates and drops its own test schemas, so the database is left clean.
3. **Pages**, on the static site:
   - `/` shows the launcher. Choosing Used cars runs the retail matcher against `gcsp-api`.
   - `/gcsp-employee.html` shows the employee shell and reviewed body.
   - `/gcsp-greg.html?fixture=populated` shows Greg's dashboard (FUCQ-101).
   - `/gcsp-outbox.html` shows the presenter outbox (FUCQ-97).
   - `/components.html` shows the component gallery.

   If you set `DEMO_ACCESS_KEY`, the first page that calls the API asks for it once.
4. Then tell me "Render is set up". I'll check that the database connects without printing the URL, and tell Russell's
   poller that FUCQ-83 and FUCQ-66 can resume.

## Keeping it up to date

- Render redeploys `gcsp-api` and `gcsp-site` on every push to `gcsp-poc`, which is every merge the pollers make. To
  control timing instead, turn **Auto-Deploy** off on each and use **Manual Deploy**.
- `main`, GitHub Pages and `bmw-matcher-api` are unaffected.

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend deploy fails at `npm install` | Root Directory isn't `server` | Set it to `server`, and redeploy. |
| `/health` takes about 40 seconds | Free plan waking from sleep | Expected. Use Starter to avoid it. |
| A page says the API can't be reached | Build command URL is wrong, or the backend is asleep | Check the `sed` values in step 3 match the backend URL, then redeploy the site. |
| `/api/gcsp/*` returns "This origin is not allowed" | `GCSP_ALLOWED_ORIGINS` doesn't exactly match the site address | Fix the value (scheme included, no trailing slash) and redeploy the backend. |
| `/api/gcsp/*` returns "GCSP identity has not been configured" | Expected today: the entry point doesn't connect GCSP yet | Nothing to fix. Later stories connect it. |
| Contract tests can't connect | URL is missing `?sslmode=require`, or Access Control blocks your IP | Add the suffix, or allow your IP in step 1.5. |

## Rotating or removing

- **Rotate the database password:** **Rotate Password** on the database's Info page. Then update `GCSP_DATABASE_URL`
  on `gcsp-api` and both `.claude/gcsp-database-url` files.
- **After the demo:** delete `gcsp-site`, `gcsp-api` and `gcsp-db` from each one's **Settings** page. Nothing else
  depends on them.
