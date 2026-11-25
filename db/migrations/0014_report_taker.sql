-- An officer's own profile behind a shared BPBD account, as the main site will name it.
ALTER TABLE seeded_session ADD COLUMN profile_id text;
ALTER TABLE seeded_session ADD COLUMN profile_name text;
ALTER TABLE seeded_session ADD COLUMN profile_position text;
ALTER TABLE seeded_session ADD COLUMN agency text;

-- Who took a report in hand: one BPBD officer, once. Never on the tracking page or a public answer.
CREATE TABLE report_taker (
  ticket_number text PRIMARY KEY REFERENCES ticket (ticket_number),
  profile_id text NOT NULL,
  staff_id text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 5 AND 300),
  at text NOT NULL
);
CREATE TRIGGER report_taker_no_update BEFORE UPDATE ON report_taker
BEGIN SELECT RAISE(ABORT, 'report_taker is append-only'); END;
CREATE TRIGGER report_taker_no_delete BEFORE DELETE ON report_taker
BEGIN SELECT RAISE(ABORT, 'report_taker is append-only'); END;
