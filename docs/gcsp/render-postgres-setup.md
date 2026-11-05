# GCSP on Render: end-to-end setup

For Gary, 5 November 2026. This puts the `gcsp-poc` branch on Render as its own environment, separate from the
retail demo: a PostgreSQL database, a backend web service and a static site (HLD review Q1 and Q2). One Blueprint
file, [`render.gcsp.yaml`](../../render.gcsp.yaml), describes all three, so you apply it once. Allow 20 to 30 minutes,
most of it waiting for builds.

**Two Blueprints, kept apart.** The repo's `render.yaml` is the retail Blueprint, behind `bmw-matcher-api` and the
GitHub Pages demo on `main`. Don't apply it, edit it or rename that service. This guide applies the other file,
`render.gcsp.yaml`, which exists only on `gcsp-poc`.

## What you'll have at the end

| Render resource | Name | Purpose |
|---|---|---|
| PostgreSQL | `gcsp-db` | Durable GCSP store. Unblocks FUCQ-83 and FUCQ-66. |
| Web service | `gcsp-api` | The Node backend, from `server/`. Its `GCSP_DATABASE_URL` is filled in from `gcsp-db` automatically. |
| Static site | `gcsp-site` | The launcher, the GCSP pages and the component gallery, pointed at `gcsp-api`. |

All three build from `gcsp-poc` in Frankfurt, on free plans, and redeploy on every push to `gcsp-poc`.

**What works once it's live.** The GCSP pages (`gcsp-employee.html`, `gcsp-greg.html`, `gcsp-outbox.html`) and the
gallery run on built-in sample data (`?fixture=...`). The backend starts, passes its health check and serves the retail
matching API. It doesn't yet connect GCSP sign-in or the database to those pages, so `/api/gcsp/*` answers "GCSP
identity has not been configured". Connecting them is later stories' work. The database's job today is the PostgreSQL
proof that FUCQ-83 and FUCQ-66 need.

## Before you start

- A Render account at <https://dashboard.render.com>, with GitHub connected (**Account Settings > Git**) and access to
  `garyscarter-ibm/vehicle-matcher`.
- A workspace can only have one free PostgreSQL database. If yours already has one, change `plan: free` under
  `databases` in `render.gcsp.yaml` to `0.1c-256mb` (the smallest paid plan), and push that before step 1. Render
  allows only one active free database per workspace.
- Optional: the names `gcsp-api` and `gcsp-site` give the addresses `https://gcsp-api.onrender.com` and
  `https://gcsp-site.onrender.com`, which the file already uses. If either name is taken, Render adds a suffix; step 3
  covers that.

## Step 1. Apply the Blueprint

1. In the dashboard, click **New**, then **Blueprint**.
2. Pick `garyscarter-ibm/vehicle-matcher`.
3. Fill in:
   - **Blueprint Name:** `GCSP demo`
   - **Branch:** `gcsp-poc`
   - **Blueprint Path:** `render.gcsp.yaml`. This field matters most: left empty, Render reads the retail `render.yaml`.
4. Render lists what it will create: `gcsp-db`, `gcsp-api` and `gcsp-site`. If you see `bmw-matcher-api`, stop: the
   Blueprint Path is wrong.
5. It asks for one value, `DEMO_ACCESS_KEY`. Enter the demo password you want on the GCSP API, or leave it empty for
   an open API. You can change it later on `gcsp-api`'s **Environment** page.
6. Click **Apply**. Render creates the database first, then builds both services. Wait until all three show **Live**
   or **Available** (5 to 10 minutes).

You don't run any SQL. The backend applies its own migrations the first time it opens the database.

## Step 2. Check the addresses

Open `gcsp-api` and `gcsp-site`, and read the address under each name.

- **They're `https://gcsp-api.onrender.com` and `https://gcsp-site.onrender.com`:** nothing to do. Go to step 4.
- **Either has a suffix**, such as `https://gcsp-api-x1y2.onrender.com`: do step 3.

## Step 3. Only if Render added a suffix

The two services name each other, so the file's guesses must match the real addresses. In `render.gcsp.yaml` on
`gcsp-poc`, change one or both of these:
- `GCSP_ALLOWED_ORIGINS`, under `gcsp-api`, to `gcsp-site`'s exact address: `https://` included, no trailing slash;
- `GCSP_API_URL`, under `gcsp-site`, to `gcsp-api`'s exact address.

Commit and push. Render syncs the Blueprint and redeploys both. Or tell me the two addresses, and I'll make the change.

Change these in the file, not the dashboard. The Blueprint sets them, so a dashboard edit can be reset at the next
sync.

## Step 4. Give the database to the pollers

The blocked stories prove themselves against the real database from whichever Mac holds the story, so they need the
database's external address. Render filled in the internal one for `gcsp-api`.

1. Open `gcsp-db`. On its **Info** page, under **Connections**, copy the **External Database URL**. It looks like
   `postgresql://gcsp:<password>@<host>/gcsp` and contains the password, so never paste it into Jira, Slack channels,
   git or a story file.
2. On your Mac, save it in a file git ignores (`.claude/` is ignored, apart from its shared files). Paste the URL
   between the quotes:

   ```bash
   printf '%s\n' 'postgresql://PASTE-EXTERNAL-URL-HERE?sslmode=require' > ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url && chmod 600 ~/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url
   ```

   Keep `?sslmode=require` on the end: Render accepts connections from outside Render over SSL only.
3. **For Russell:** FUCQ-83 and FUCQ-66 are his poller's claims, so his Mac needs the same file in his clone. Send him
   the External URL privately (a direct message, or in person), not in a shared channel.

## Step 5. Check it end to end

1. **Health:** `https://gcsp-api.onrender.com/health` (or your suffixed address) shows `{"ok":true}`. On the free plan
   the service sleeps after 15 minutes with no traffic, and the next request takes about a minute while Render
   shows a loading page.
2. **Database:** from the repo root on your Mac, run:

   ```bash
   GCSP_DATABASE_URL="$(cat .claude/gcsp-database-url)" node --test server/test/gcsp-repository-contract.test.js
   ```

   Nothing should be skipped, and the native PostgreSQL constraint tests should pass. With no URL they're skipped with
   "GCSP_DATABASE_URL is unset". The suite creates and drops its own test schemas, so the database is left clean.
3. **Pages**, on `gcsp-site`:
   - `/` shows the launcher. Choosing Used cars runs the retail matcher against `gcsp-api`.
   - `/gcsp-employee.html` shows the employee shell and reviewed body.
   - `/gcsp-greg.html?fixture=populated` shows Greg's dashboard (FUCQ-101).
   - `/gcsp-outbox.html` shows the presenter outbox (FUCQ-97).
   - `/components.html` shows the component gallery.

   If you set `DEMO_ACCESS_KEY`, the first page that calls the API asks for it once.
4. Then tell me "Render is set up". I'll check that the database connects without printing the URL, and tell Russell's
   poller that FUCQ-83 and FUCQ-66 can resume.

## Keeping it up to date

- Every push to `gcsp-poc`, which is every merge the pollers make, redeploys `gcsp-api` and `gcsp-site`. To control
  timing, change `autoDeployTrigger: commit` to `off` for each service in the file, and use **Manual Deploy**.
- Build filters skip commits that can't change what runs. `gcsp-api` redeploys only for `server/` changes outside
  its tests and markdown. `gcsp-site` redeploys only for the files its build copies, so `_dev/` and `docs/` commits
  deploy nothing. If you add a file to the site's `cp` list, add it to `buildFilter.paths` too (a test checks).
- Change GCSP's Render settings by editing `render.gcsp.yaml` and pushing. The exception is `DEMO_ACCESS_KEY`, which
  lives only in the dashboard.
- `main`, GitHub Pages and `bmw-matcher-api` are unaffected.

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Step 1 lists `bmw-matcher-api` | Blueprint Path is empty or wrong | Cancel, and set it to `render.gcsp.yaml`. |
| Step 1 stops on the database plan | The workspace already has a free database | Change `plan: free` to `0.1c-256mb` in the file, push, and retry. |
| `gcsp-site` build fails at its first command | `GCSP_API_URL` isn't reaching the build | Check it's on `gcsp-site`'s **Environment** page. The command refuses to publish a site with no backend address. |
| A page says the API can't be reached | `GCSP_API_URL` doesn't match `gcsp-api`'s address, or the backend is asleep | Do step 3, then retry after a minute. |
| `/api/gcsp/*` returns "This origin is not allowed" | `GCSP_ALLOWED_ORIGINS` doesn't exactly match `gcsp-site`'s address | Do step 3. |
| `/api/gcsp/*` returns "GCSP identity has not been configured" | Expected today: the entry point doesn't connect GCSP yet | Nothing to fix. Later stories connect it. |
| Contract tests can't connect | URL is missing `?sslmode=require` | Add it to `.claude/gcsp-database-url`. |

## Rotating or removing

- **Rotate the database password:** **Rotate Password** on `gcsp-db`'s Info page. `gcsp-api` picks up the new internal
  URL from the Blueprint link; update both `.claude/gcsp-database-url` files by hand.
- **The free database expires** 30 days after creation, in early December. Render then gives 14 days to upgrade it to
  a paid plan before deleting it and its data. To keep the environment, upgrade before then.
- **After the demo:** delete the `GCSP demo` Blueprint, then `gcsp-site`, `gcsp-api` and `gcsp-db` from each one's
  **Settings** page. Deleting a Blueprint doesn't delete its resources.
