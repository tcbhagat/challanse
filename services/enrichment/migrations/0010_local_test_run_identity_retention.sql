ALTER TABLE local_test_runs
  ALTER COLUMN requested_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS local_test_runs_requested_by_fkey,
  ADD CONSTRAINT local_test_runs_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE local_operator_events
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS local_operator_events_user_id_fkey,
  ADD CONSTRAINT local_operator_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
