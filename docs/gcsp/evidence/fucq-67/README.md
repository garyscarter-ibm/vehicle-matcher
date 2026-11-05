# FUCQ-67 browser evidence

**Current checkpoint: actual-service smoke only.** Six full-page PNGs are captured in this folder (1,179,554 bytes). The read-only fixture matrix and no-current-car/no-history probes have not run yet, so this checkpoint does not claim the planned 16-capture set is complete.

The desktop capture shows the delivered account page with the fictional current BMW, contract dates and mileage, the no-image placeholder, allowance details, and order history. Keyboard navigation reached the contract and history disclosure summaries with Tab; Enter opened them, and the focused history summary showed its visible outline. The actual service flow saved a replacement intent, reloaded the account, resumed the journey, and used Back at desktop and 320 px width. The page retained `draftVersion: 1` with one start POST, and the original current-contract identifier remained unchanged through save, reload, resume, and Back. Neither viewport had horizontal overflow.

The page is backed by `createGcspRuntime` in memory and the real `buildServer` GCSP request handler. One ephemeral `127.0.0.1` listener composes static files and the API handler; the API server object never binds separately. Only the synthetic acting cookie is placed in the temporary browser context; the helper does not write or print cookie values. Non-local browser requests are blocked, and unrelated provider functions throw if called.

The API record contains two pre-save `GET /api/gcsp/manual/draft` responses with HTTP 404 and GCSP `not-found`. These are the expected empty-draft state and remain visible by route and GCSP status in the current API response list. The helper now classifies only these exact draft misses as expected and separates unexpected HTTP responses from browser console/page errors on its next run. The successful smoke run recorded no console errors, page errors, or external requests. A first smoke attempt exposed an ambiguous global replacement-button locator because both the current contract and its order-history record offer the same action; the helper now scopes the click to the current-car card.

The smoke matrix includes source SHA-256 values, six capture SHA-256 values, the ephemeral listener host and port, sanitized HTTP schema/status summaries, keyboard focus and details state, journey event details, and cleanup booleans. The supervisor receipt records `rc=0`, the Node process group and HostBudget reservation absent, and removed scratch. Its RSS peak covers the Node group only; detached Chrome groups were omitted. Before the next run, the external supervisor was corrected to track recursive ancestry, record Chrome groups in the manifest, and stop and verify every owned group. The full recursive memory and cleanup proof remains pending. No package installation or live-provider call was used.

To repeat only the actual-service smoke from the repository root:

```sh
python3 .claude/test-runs/fucq67/lead-supervisor.py command --owner runner --name fucq67-service-smoke --cwd root --command 'node docs/gcsp/evidence/fucq-67/capture-fucq-67.mjs --service-only'
```

The full fixture matrix remains pending a separate dispatcher lane grant and review of this smoke checkpoint.
