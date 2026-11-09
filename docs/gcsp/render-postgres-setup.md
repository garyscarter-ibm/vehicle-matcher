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
| Static site | `gcsp-site` | The retail launcher and the component gallery, pointed at `gcsp-api`. Its live GCSP page addresses redirect to `gcsp-api`. |

All three build from `gcsp-poc` in Frankfurt, on free plans, and redeploy on every push to `gcsp-poc`.

**What works once it's live (FUCQ-180, 7 November 2026).** `gcsp-api` runs the whole GCSP demo runtime, the same
composition as the local launcher (`server/gcsp/host.js`), and serves the live GCSP pages from its own address:
`https://gcsp-api.onrender.com/gcsp-presenter.html` for the presenter, `/gcsp-account.html` for Paula, `/gcsp-greg.html`
for Greg, `/gcsp-outbox.html` for the captured emails and `/gcsp/offer` for emailed offer links. One origin keeps the
server-issued session cookies first-party; `gcsp-site` and `gcsp-api` are different sites on `onrender.com`, and Safari
would drop cross-site cookies. `gcsp-site` redirects those page addresses to `gcsp-api`. **Rule (FUCQ-181):** pages and the API must be
same-site or same-origin, because sessions use cookies; never point a signed-in page at `gcsp-api` from `gcsp-site`.
The design records the choice: `docs/design/gcsp-high-level-design.md`, "Technical deployment and recovery".
The demo runs in memory mode;
the database stays for the PostgreSQL proofs (FUCQ-83, FUCQ-66) and for `GCSP_REPOSITORY_MODE=postgres`.

`DEMO_ACCESS_KEY` is required with `GCSP_RUNTIME=1`. The first live page in each browser asks for it once ("Open the demo"), then remembers it
for 12 hours in an HttpOnly cookie. Emailed offer links (`/gcsp/offer`) never ask: they carry their own offer token.

### Backend settings on `gcsp-api`

| Setting | Where it is set | Value |
|---|---|---|
| `GCSP_RUNTIME` | Blueprint | `1` turns the GCSP runtime on. Without it the backend is the retail API only, and `/api/gcsp/*` answers 503. |
| `GCSP_REPOSITORY_MODE` | Blueprint | `memory` (default for the demo). `postgres` uses `gcsp-db`, at about 15 s a clock tick. |
| `GCSP_PUBLIC_ORIGIN` | Blueprint | `gcsp-api`'s own address, exactly. Pages and cookies are served on it. |
| `GCSP_PUBLIC_BASE_URL` | Blueprint | The same address: the base of emailed offer links. |
| `GCSP_ALLOWED_ORIGINS` | Blueprint | Extra origins allowed to call `/api/gcsp/*` (`gcsp-site`). `GCSP_PUBLIC_ORIGIN` is always allowed. |
| `GCSP_OFFLINE` | Blueprint | `1`: no live retailer warmers at boot. |
| `GCSP_DATABASE_URL` | Blueprint, from `gcsp-db` | Used only in postgres mode and by vehicle evidence. |
| `DEMO_ACCESS_KEY` | Dashboard only | The demo key. Required: without it `gcsp-api` refuses to start (`access-key-required`). |
| `GCSP_MAIL_TRANSPORT` | Dashboard only | `brevo` sends real email. Unset keeps every email captured in the outbox. |
| `GCSP_MAIL_FROM`, `GCSP_MAIL_FROM_NAME` | Dashboard only | The verified Brevo sender. |
| `GCSP_MAIL_RECIPIENTS` | Dashboard only | JSON map of demo principal to address. |
| `GCSP_BREVO_API_KEY` | Dashboard only | The Brevo API key. Never in git. |
| `GCSP_ENVIRONMENT_ID`, `GCSP_STOCK_SOURCE` | Optional, dashboard | Default `gcsp-hosted-demo`; stock chosen per run. |

**Free plan and memory mode.** The free instance sleeps after 15 minutes without traffic and takes about a minute to
wake. In memory mode a sleep or redeploy starts a fresh run, so any demo state is lost. Before presenting, open
`/health`, wait for `{"ok":true}`, then open the presenter page and press Reset so the run starts from the scenario's
beginning, and keep the page in use. A paid `starter` instance does not sleep; whether to pay is Gary's call.

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
5. It asks for one value, `DEMO_ACCESS_KEY`. Enter the demo password you want on the GCSP API. It is required: without
   it `gcsp-api` refuses to start. You can change it later on `gcsp-api`'s **Environment** page.
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
- `GCSP_API_URL`, under `gcsp-site`, to `gcsp-api`'s exact address, and the same address in `gcsp-site`'s redirect
  `destination` lines and in `GCSP_PUBLIC_ORIGIN` and `GCSP_PUBLIC_BASE_URL` under `gcsp-api`.

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
   - `/components.html` shows the component gallery.
   - `/gcsp-presenter.html` redirects to `gcsp-api`, asks for the demo key once, and opens the presenter workspace.

4. **Live demo**, on `gcsp-api`: Reset on the presenter page, a tick, Paula's offer and the outbox. The smoke steps
   are in the FUCQ-180 result.
5. Then tell me "Render is set up". I'll check that the database connects without printing the URL, and tell Russell's
   poller that FUCQ-83 and FUCQ-66 can resume.

## Fleet artifact restore (7 November 2026)

The GCSP API uses the complete repository checkout so its pinned root image assets and operator modules are available. Its build and start commands enter `server` explicitly. The build restores the checksum-pinned fleet release after `npm install`. The build downloads public immutable artifacts into its local cache; runtime lookup and restart use local files offline. The `.4` release contains349 admitted source configurations,350 total records and1 preserved VIN, with no images. See [actual CLI proof](evidence/fucq62/render-build-restore-2026-11-07/README.md). The original public tag predates the empty-asset transport repair, so use the current application checkout with the immutable descriptor. A newer release must update the descriptor and Blueprint digest together.

The command has passed with actual public assets and an offline restart locally. Confirm the deployed build separately; a Blueprint commit does not itself prove Render executed it. Native PostgreSQL setup remains a separate credential-dependent step.

## Stored route comparison (FUCQ-288)

Greg's route comparison panel reads a result prepared offline. It is committed at `server/data/gcsp/comparison/process-only.json` and loaded at boot through `GCSP_COMPARISON_RESULT_FILE` (set in `render.gcsp.yaml`; the local launcher defaults to the same file).

To refresh it, run from the repo root:

`NODE_OPTIONS=--max-old-space-size=2048 node scripts/gcsp-comparison.mjs --experiment process --out <new file>`

It takes about 28 minutes and about 1.5 GB. The default 128 MB worker job fails (FUCQ-309). Then replace the committed file. Refresh it whenever the policy seed or the replay changes; until then the panel shows its older-policy note. Never start it live in the demo.

## Keeping it up to date

- Every push to `gcsp-poc`, which is every merge the pollers make, redeploys `gcsp-api` and `gcsp-site`. To control
  timing, change `autoDeployTrigger: commit` to `off` for each service in the file, and use **Manual Deploy**.
- Build filters skip commits that can't change what runs. `gcsp-api` redeploys for API code, GCSP operator modules and pinned vehicle-image assets, excluding
  its tests and server markdown. `gcsp-site` redeploys only for the files its build copies, so `_dev/` and `docs/` commits
  deploy nothing. If you add a file to the site's `cp` list, add it to `buildFilter.paths` too (a test checks).
- Change GCSP's Render settings by editing `render.gcsp.yaml` and pushing. The exceptions are `DEMO_ACCESS_KEY` and
  the mail settings (`GCSP_MAIL_*`, `GCSP_BREVO_API_KEY`), which live only in the dashboard.
- `main`, GitHub Pages and `bmw-matcher-api` are unaffected.

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Step 1 lists `bmw-matcher-api` | Blueprint Path is empty or wrong | Cancel, and set it to `render.gcsp.yaml`. |
| Step 1 stops on the database plan | The workspace already has a free database | Change `plan: free` to `0.1c-256mb` in the file, push, and retry. |
| `gcsp-site` build fails at its first command | `GCSP_API_URL` isn't reaching the build | Check it's on `gcsp-site`'s **Environment** page. The command refuses to publish a site with no backend address. |
| A page says the API can't be reached | `GCSP_API_URL` doesn't match `gcsp-api`'s address, or the backend is asleep | Do step 3, then retry after a minute. |
| `/api/gcsp/*` returns "This origin is not allowed" | `GCSP_ALLOWED_ORIGINS` doesn't exactly match `gcsp-site`'s address | Do step 3. |
| `/api/gcsp/*` returns "GCSP identity has not been configured" | `GCSP_RUNTIME` isn't `1` on `gcsp-api` | Check the Blueprint synced; redeploy. |
| Deploy fails with "GCSP hosted startup: invalid (public-origin-required)" | `GCSP_PUBLIC_ORIGIN` is missing or not an exact `https://` origin | Set it to `gcsp-api`'s address, no trailing slash.
| Deploy fails with "GCSP hosted startup: invalid (access-key-required)" | `DEMO_ACCESS_KEY` is empty on `gcsp-api` | Add it on the **Environment** page; redeploy. | |
| Live pages show stale or empty state after a break | The free instance slept, so memory mode started a new run | Wait for `/health`, then Reset on the presenter page. |
| Contract tests can't connect | URL is missing `?sslmode=require` | Add it to `.claude/gcsp-database-url`. |

## Rotating or removing

- **Rotate the database password:** **Rotate Password** on `gcsp-db`'s Info page. `gcsp-api` picks up the new internal
  URL from the Blueprint link; update both `.claude/gcsp-database-url` files by hand.
- **The free database expires** 30 days after creation, in early December. Render then gives 14 days to upgrade it to
  a paid plan before deleting it and its data. To keep the environment, upgrade before then.
- **After the demo:** delete the `GCSP demo` Blueprint, then `gcsp-site`, `gcsp-api` and `gcsp-db` from each one's
  **Settings** page. Deleting a Blueprint doesn't delete its resources.
