-- A person not yet found (upstream K105, LA-80, LA-82): a report of its own, never a ticket, seen
-- only by BNPB and the BPBD of its region. Closed two years ago, it keeps no name, number or photo.
CREATE TABLE missing_person (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES reporter (id),
  number_key text NOT NULL,
  owner_slot text NOT NULL,
  reporter_name text,
  village_code text NOT NULL,
  regency_code text NOT NULL,
  place text NOT NULL CHECK (json_valid(place)),
  name text,
  nickname text,
  relation text NOT NULL,
  sex text NOT NULL,
  age integer CHECK (age IS NULL OR age BETWEEN 0 AND 120),
  clothes text,
  marks text,
  last_seen_date text NOT NULL,
  last_seen_time text,
  person_number text,
  contact_number text,
  wait_place text,
  photo_key text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'foundSafe', 'foundDead', 'toSar', 'closed')),
  created_at text NOT NULL,
  closed_at text,
  anonymised_at text
);
CREATE INDEX missing_person_region ON missing_person (regency_code, created_at);
CREATE INDEX missing_person_number ON missing_person (number_key, created_at);
CREATE INDEX missing_person_owner ON missing_person (reporter_id, owner_slot, created_at);

CREATE TABLE missing_person_history (
  id integer PRIMARY KEY,
  missing_id text NOT NULL REFERENCES missing_person (id),
  from_status text,
  to_status text NOT NULL,
  note text,
  staff_id text,
  staff_label text,
  at text NOT NULL
);
CREATE INDEX missing_person_history_missing ON missing_person_history (missing_id, at);
CREATE TRIGGER missing_person_history_no_update BEFORE UPDATE ON missing_person_history
BEGIN SELECT RAISE(ABORT, 'missing_person_history is append-only'); END;
CREATE TRIGGER missing_person_history_no_delete BEFORE DELETE ON missing_person_history
BEGIN SELECT RAISE(ABORT, 'missing_person_history is append-only'); END;
