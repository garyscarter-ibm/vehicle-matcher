-- FUCQ-471: source-linked document and readiness items per exact order. The order row's version is the
-- documents revision every command checks; item changes always bump it in the same transaction.

CREATE TABLE document_orders (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  employee_id text NOT NULL CHECK (length(employee_id) BETWEEN 1 AND 128),
  entitlement_slot_id text CHECK (length(entitlement_slot_id) BETWEEN 1 AND 128),
  renewal_id text CHECK (length(renewal_id) BETWEEN 1 AND 128),
  renewal_authority text NOT NULL CHECK (renewal_authority IN ('validated', 'missing')),
  policy_version text NOT NULL,
  opened_at timestamptz NOT NULL,
  opening jsonb NOT NULL CHECK (jsonb_typeof(opening) = 'object'),
  last_observed_revision bigint NOT NULL CHECK (last_observed_revision > 0),
  provider_mode text NOT NULL,
  exception_types jsonb NOT NULL CHECK (jsonb_typeof(exception_types) = 'object'),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'array'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  CHECK (renewal_authority = 'validated' AND renewal_id IS NOT NULL AND entitlement_slot_id IS NOT NULL
         OR renewal_authority = 'missing' AND renewal_id IS NULL),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX document_orders_employee ON document_orders (environment_id, run_id, employee_id);

-- Employee items complete only with recorded acknowledgement evidence; provider items never carry one.
CREATE TABLE document_items (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  item_id text NOT NULL CHECK (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  position smallint NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('document', 'readiness')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  owner text NOT NULL CHECK (owner IN ('employee', 'scheme-team', 'retailer')),
  action text CHECK (length(action) BETWEEN 1 AND 120),
  status text NOT NULL,
  due_at timestamptz NOT NULL,
  progress_at timestamptz,
  operation_id text,
  fail boolean NOT NULL DEFAULT false,
  failure_reason text,
  provider_reference text,
  reason text,
  completed_at timestamptz,
  acknowledgement jsonb CHECK (acknowledgement IS NULL OR jsonb_typeof(acknowledgement) = 'object'),
  last_provider_outcome text,
  overdue_recorded_at timestamptz,
  assumption jsonb NOT NULL CHECK (jsonb_typeof(assumption) = 'object'),
  PRIMARY KEY (environment_id, run_id, order_uuid, item_id),
  UNIQUE (environment_id, run_id, order_uuid, position),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES document_orders (environment_id, run_id, order_uuid),
  CHECK (owner = 'employee' AND action IS NOT NULL AND operation_id IS NULL AND progress_at IS NULL AND NOT fail
           AND status IN ('waiting-for-employee', 'acknowledging', 'complete')
         OR owner <> 'employee' AND action IS NULL AND operation_id IS NOT NULL AND progress_at IS NOT NULL
           AND acknowledgement IS NULL AND status IN ('not-started', 'in-progress', 'complete', 'failed')),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL)),
  CHECK (owner <> 'employee' OR (status = 'complete') = (acknowledgement IS NOT NULL))
);
