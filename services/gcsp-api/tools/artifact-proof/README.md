# Artifact proof (FUCQ-454, local startup)

`bash tools/artifact-proof/run.sh --scratch DIR --db-url JDBC_URL [--skip-build]`: builds the fast-jar once, then runs it
three times with env configuration only (bare, required-but-unconfigured, dev composition on a PostgreSQL you own).
It checks live/ready, the 401 `bearer-missing` context, readiness 503 then 200, paula's bearer on `/context` and
`/manual/account`, SIGTERM exit 143 with the stop log lines, and no Node (no children, no `.js`, no process spawn in app jars).
Run C needs an empty database (the demo scenario seeds on first start). Logs and a `summary.txt` go to DIR.
Not proved: hosted Render (its image, secrets, networking and real IdP), library-jar internals, load or soak.
Scratch holds a throwaway RSA key and self-signed cert; the JVM trusts it only through `-Djavax.net.ssl.trustStore` flags.
