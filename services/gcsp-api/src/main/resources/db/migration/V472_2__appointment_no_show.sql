-- FUCQ-472: the handover no-show outcome and rebooking. A no-show row may move (rebook) by version + 1;
-- a completed one stays final (appointments_guard is unchanged). History and operation inputs stay append-only.

ALTER TABLE appointments
  DROP CONSTRAINT appointments_state_check,
  DROP CONSTRAINT appointments_pending_step_check,
  DROP CONSTRAINT appointments_check1,
  DROP CONSTRAINT appointments_check3;
ALTER TABLE appointments
  ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ADD COLUMN previous_attempts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(previous_attempts) = 'array'),
  ADD CONSTRAINT appointments_state_check CHECK (state IN ('not-requested', 'requested', 'change-proposed', 'scheduled',
    'completed', 'no-show')),
  ADD CONSTRAINT appointments_pending_step_check CHECK (pending_step IN ('request', 'confirm', 'accept', 'complete', 'no-show')),
  ADD CONSTRAINT appointments_check1 CHECK (state NOT IN ('scheduled', 'completed', 'no-show') OR slot IS NOT NULL),
  ADD CONSTRAINT appointments_check3 CHECK ((state IN ('completed', 'no-show')) = (outcome IS NOT NULL));

ALTER TABLE appointment_history DROP CONSTRAINT appointment_history_state_check;
ALTER TABLE appointment_history ADD CONSTRAINT appointment_history_state_check
  CHECK (state IN ('requested', 'change-proposed', 'scheduled', 'completed', 'no-show'));

-- One input per step and attempt: a rebooking (attempt n > 1) writes under its own operation ids.
ALTER TABLE appointment_operation_inputs
  DROP CONSTRAINT appointment_operation_inputs_step_check,
  DROP CONSTRAINT appointment_operation_inputs_environment_id_run_id_order_uu_key;
ALTER TABLE appointment_operation_inputs
  ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ADD CONSTRAINT appointment_operation_inputs_step_check CHECK (step IN ('request', 'confirm', 'accept', 'complete', 'no-show')),
  ADD CONSTRAINT appointment_operation_inputs_order_step_attempt_key UNIQUE (environment_id, run_id, order_uuid, step, attempt);
