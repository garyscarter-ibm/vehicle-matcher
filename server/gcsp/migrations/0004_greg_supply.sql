-- FUCQ-104: intent and actual production acknowledgement, distinct from released stock.
-- Existing F92 stock rows/receipts alone establish a release. No stock is created here.
CREATE TABLE future_order_requests (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  request_id text GENERATED ALWAYS AS (data->>'requestId') STORED NOT NULL,
  requested_by text GENERATED ALWAYS AS (data->>'requestedBy') STORED NOT NULL,
  command_id text GENERATED ALWAYS AS (data->>'commandId') STORED NOT NULL,
  provider_reference text GENERATED ALWAYS AS (data->>'providerReference') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY (run_id,request_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id),
  UNIQUE (run_id,requested_by,command_id),
  UNIQUE (run_id,provider_reference),
  CHECK (data->>'state' IN ('requested','partly-confirmed','confirmed','delayed')),
  CHECK ((data->>'quantity')::bigint > 0)
);

CREATE TABLE confirmed_supply (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  supply_id text GENERATED ALWAYS AS (data->>'supplyId') STORED NOT NULL,
  request_id text GENERATED ALWAYS AS (data->>'requestId') STORED NOT NULL,
  provider_reference text GENERATED ALWAYS AS (data->>'providerReference') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY (run_id,supply_id),
  FOREIGN KEY (run_id,request_id) REFERENCES future_order_requests(run_id,request_id),
  UNIQUE (run_id,provider_reference),
  CHECK (data->>'state' = 'confirmed'),
  CHECK ((data->>'quantity')::bigint > 0)
);
