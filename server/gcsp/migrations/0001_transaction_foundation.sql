-- FUCQ-81: run-scoped foundation storage. Policy tables are reserved for 0002.
-- JSONB retains additive domain fields; generated columns enforce business keys in PostgreSQL.

CREATE TABLE "runs" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "environment_id" text GENERATED ALWAYS AS (data->>'environmentId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id")
);

CREATE TABLE "employees" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "employee_id" text GENERATED ALWAYS AS (data->>'employeeId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "employee_id")
);

CREATE TABLE "entitlement_slots" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "entitlement_slot_id" text GENERATED ALWAYS AS (data->>'entitlementSlotId') STORED NOT NULL,
  "employee_id" text GENERATED ALWAYS AS (data->>'employeeId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "entitlement_slot_id")
);

CREATE TABLE "briefs" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "employee_id" text GENERATED ALWAYS AS (data->>'employeeId') STORED NOT NULL,
  "brief_version" bigint GENERATED ALWAYS AS ((data->>'briefVersion')::bigint) STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "employee_id", "brief_version")
);

CREATE TABLE "stock" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "order_uuid" text GENERATED ALWAYS AS (data->>'orderUuid') STORED NOT NULL,
  "order_number" text GENERATED ALWAYS AS (data->>'orderNumber') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "order_uuid")
);

CREATE UNIQUE INDEX "stock_order_number_unique" ON "stock" ("run_id", "order_number");

CREATE TABLE "holds" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "hold_id" text GENERATED ALWAYS AS (data->>'holdId') STORED NOT NULL,
  "order_uuid" text GENERATED ALWAYS AS (data->>'orderUuid') STORED,
  "employee_id" text GENERATED ALWAYS AS (data->>'employeeId') STORED,
  "entitlement_slot_id" text GENERATED ALWAYS AS (data->>'entitlementSlotId') STORED,
  "quote_id" text GENERATED ALWAYS AS (data->>'quoteId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "hold_id")
);

CREATE UNIQUE INDEX "holds_occupying_car_unique" ON "holds" (run_id, order_uuid) WHERE data->>'state' IN ('active', 'claim-pending', 'release-pending', 'selection-pending');

ALTER TABLE holds ADD CONSTRAINT holds_state_check CHECK (data->>'state' IN ('active', 'claim-pending', 'release-pending', 'selection-pending', 'released', 'expired', 'allocated', 'claim-failed'));

ALTER TABLE holds ADD CONSTRAINT holds_type_check CHECK (data->>'type' IN ('cart', 'buddy-offer'));

CREATE TABLE "claims" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "claim_id" text GENERATED ALWAYS AS (data->>'claimId') STORED NOT NULL,
  "hold_id" text GENERATED ALWAYS AS (data->>'holdId') STORED,
  "order_uuid" text GENERATED ALWAYS AS (data->>'orderUuid') STORED,
  "entitlement_slot_id" text GENERATED ALWAYS AS (data->>'entitlementSlotId') STORED,
  "employee_id" text GENERATED ALWAYS AS (data->>'employeeId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "claim_id")
);

CREATE UNIQUE INDEX "claims_hold_id_unique" ON "claims" ("run_id", "hold_id");

CREATE UNIQUE INDEX "claims_occupying_car_unique" ON "claims" (run_id, order_uuid) WHERE data->>'state' IN ('active', 'claim-pending', 'release-pending', 'selection-pending');

ALTER TABLE claims ADD CONSTRAINT claims_state_check CHECK (data->>'state' IN ('active', 'claim-pending', 'release-pending', 'selection-pending', 'released', 'expired', 'allocated', 'claim-failed'));

ALTER TABLE claims ADD CONSTRAINT claims_type_check CHECK (data->>'type' IN ('cart', 'buddy-offer'));

CREATE TABLE "quotes" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "quote_id" text GENERATED ALWAYS AS (data->>'quoteId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "quote_id")
);

CREATE TABLE "offers" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "offer_id" text GENERATED ALWAYS AS (data->>'offerId') STORED NOT NULL,
  "hold_id" text GENERATED ALWAYS AS (data->>'holdId') STORED,
  "quote_id" text GENERATED ALWAYS AS (data->>'quoteId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "offer_id")
);

CREATE UNIQUE INDEX "offers_hold_id_unique" ON "offers" ("run_id", "hold_id");

CREATE TABLE "decisions" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "decision_id" text GENERATED ALWAYS AS (data->>'decisionId') STORED NOT NULL,
  "command_id" text GENERATED ALWAYS AS (data->>'commandId') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "decision_id")
);

CREATE UNIQUE INDEX "decisions_command_id_unique" ON "decisions" ("run_id", "command_id");

CREATE TABLE "pending_operations" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "operation_id" text GENERATED ALWAYS AS (data->>'operationId') STORED NOT NULL,
  "operation_type" text GENERATED ALWAYS AS (data->>'operationType') STORED,
  "idempotency_key" text GENERATED ALWAYS AS (data->>'idempotencyKey') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "operation_id")
);

CREATE UNIQUE INDEX "pending_operations_operation_type_idempotency_key_unique" ON "pending_operations" ("run_id", "operation_type", "idempotency_key");

CREATE TABLE "event_receipts" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "consumer_id" text GENERATED ALWAYS AS (data->>'consumerId') STORED NOT NULL,
  "event_id" text GENERATED ALWAYS AS (data->>'eventId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "consumer_id", "event_id")
);

CREATE TABLE "notification_outbox" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "job_id" text GENERATED ALWAYS AS (data->>'jobId') STORED NOT NULL,
  "idempotency_key" text GENERATED ALWAYS AS (data->>'idempotencyKey') STORED,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "job_id")
);

CREATE UNIQUE INDEX "notification_outbox_idempotency_key_unique" ON "notification_outbox" ("run_id", "idempotency_key");

CREATE TABLE "forecast_snapshots" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "forecast_id" text GENERATED ALWAYS AS (data->>'forecastId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "forecast_id")
);

CREATE TABLE "plan_snapshots" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "plan_id" text GENERATED ALWAYS AS (data->>'planId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "plan_id")
);

CREATE TABLE "identity_sessions" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "session_id_hash" text GENERATED ALWAYS AS (data->>'sessionIdHash') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "session_id_hash")
);

CREATE TABLE "tick_runs" (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  "run_id" text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  "tick_id" text GENERATED ALWAYS AS (data->>'tickId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY ("run_id", "tick_id")
);

CREATE UNIQUE INDEX runs_current_environment_unique ON runs (environment_id) WHERE data->>'current' = 'true' OR data->>'status' = 'active';

ALTER TABLE "employees" ADD CONSTRAINT "employees_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "entitlement_slots" ADD CONSTRAINT "entitlement_slots_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "entitlement_slots" ADD CONSTRAINT "entitlement_slots_employee_id_fk" FOREIGN KEY (run_id, "employee_id") REFERENCES "employees" (run_id, "employee_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "briefs" ADD CONSTRAINT "briefs_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "briefs" ADD CONSTRAINT "briefs_employee_id_fk" FOREIGN KEY (run_id, "employee_id") REFERENCES "employees" (run_id, "employee_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "stock" ADD CONSTRAINT "stock_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "holds" ADD CONSTRAINT "holds_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "holds" ADD CONSTRAINT "holds_order_uuid_fk" FOREIGN KEY (run_id, "order_uuid") REFERENCES "stock" (run_id, "order_uuid") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "holds" ADD CONSTRAINT "holds_employee_id_fk" FOREIGN KEY (run_id, "employee_id") REFERENCES "employees" (run_id, "employee_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "holds" ADD CONSTRAINT "holds_entitlement_slot_id_fk" FOREIGN KEY (run_id, "entitlement_slot_id") REFERENCES "entitlement_slots" (run_id, "entitlement_slot_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "holds" ADD CONSTRAINT "holds_quote_id_fk" FOREIGN KEY (run_id, "quote_id") REFERENCES "quotes" (run_id, "quote_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "claims" ADD CONSTRAINT "claims_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "claims" ADD CONSTRAINT "claims_hold_id_fk" FOREIGN KEY (run_id, "hold_id") REFERENCES "holds" (run_id, "hold_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "claims" ADD CONSTRAINT "claims_order_uuid_fk" FOREIGN KEY (run_id, "order_uuid") REFERENCES "stock" (run_id, "order_uuid") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "claims" ADD CONSTRAINT "claims_entitlement_slot_id_fk" FOREIGN KEY (run_id, "entitlement_slot_id") REFERENCES "entitlement_slots" (run_id, "entitlement_slot_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "claims" ADD CONSTRAINT "claims_employee_id_fk" FOREIGN KEY (run_id, "employee_id") REFERENCES "employees" (run_id, "employee_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "offers" ADD CONSTRAINT "offers_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "offers" ADD CONSTRAINT "offers_hold_id_fk" FOREIGN KEY (run_id, "hold_id") REFERENCES "holds" (run_id, "hold_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "offers" ADD CONSTRAINT "offers_quote_id_fk" FOREIGN KEY (run_id, "quote_id") REFERENCES "quotes" (run_id, "quote_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "pending_operations" ADD CONSTRAINT "pending_operations_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "event_receipts" ADD CONSTRAINT "event_receipts_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "plan_snapshots" ADD CONSTRAINT "plan_snapshots_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "tick_runs" ADD CONSTRAINT "tick_runs_run_fk" FOREIGN KEY (run_id) REFERENCES runs (run_id) DEFERRABLE INITIALLY DEFERRED;
