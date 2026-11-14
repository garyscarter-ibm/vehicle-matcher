-- FUCQ-469: notification delivery state and the employee's own delivery email setting. V1 tables are unchanged.
-- The intent is an outbox_events row committed with the business change; this table is the delivery bookkeeping.

CREATE TABLE notification_deliveries (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  event_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('sending', 'retrying', 'sent', 'failed')),
  attempts integer NOT NULL CHECK (attempts >= 0),
  attempted_at timestamptz,
  next_attempt_at timestamptz,
  error text CHECK (error ~ '^[a-z][a-z0-9-]{0,63}$'),
  transport text CHECK (transport IN ('captured', 'configured')),
  message jsonb CHECK (message IS NULL OR jsonb_typeof(message) = 'object'),
  provider_operation_id text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'retrying') = (next_attempt_at IS NOT NULL)),
  CHECK ((state = 'sent') = (transport IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, event_id),
  FOREIGN KEY (environment_id, run_id, event_id) REFERENCES outbox_events (environment_id, run_id, event_id)
);
CREATE INDEX notification_deliveries_due ON notification_deliveries (environment_id, run_id, next_attempt_at)
  WHERE state = 'retrying';

-- The employee's own delivery address (written by a later endpoint); absent or null means no email.
CREATE TABLE notification_recipients (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  delivery_email text CHECK (length(delivery_email) <= 254),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id),
  FOREIGN KEY (environment_id, run_id, employee_id) REFERENCES employees (environment_id, run_id, employee_id)
);
