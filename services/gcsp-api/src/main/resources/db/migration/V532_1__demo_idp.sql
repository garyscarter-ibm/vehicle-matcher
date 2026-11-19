-- FUCQ-532: the built-in demo sign-in issuer's signing key, sign-in sessions and refresh tokens. Not run-scoped:
-- a run reset leaves them alone, so a reset does not sign anyone out or change the key.

CREATE TABLE demo_idp_signing_keys (
  kid text PRIMARY KEY CHECK (length(kid) BETWEEN 1 AND 200),
  private_key_pkcs8 text NOT NULL,
  public_jwk text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX demo_idp_signing_keys_one_active ON demo_idp_signing_keys ((true)) WHERE active;

CREATE TABLE demo_idp_sessions (
  session_id text PRIMARY KEY CHECK (length(session_id) BETWEEN 1 AND 200),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  auth_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE demo_idp_refresh_tokens (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  session_id text NOT NULL REFERENCES demo_idp_sessions (session_id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_idp_refresh_tokens_session ON demo_idp_refresh_tokens (session_id);
