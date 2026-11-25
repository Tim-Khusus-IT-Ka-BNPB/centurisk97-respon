-- A history row may tell of work on a report as well as a status: what was found on site, or what
-- was done. Its detail is what the desk shows for it.
ALTER TABLE ticket_history ADD COLUMN event text CHECK (event IN ('fieldCheck', 'actions', 'take'));
ALTER TABLE ticket_history ADD COLUMN detail text CHECK (detail IS NULL OR json_valid(detail));

-- What an officer found on site. A correction makes a new version of the report's values; the
-- reporter's own stay as they were sent.
CREATE TABLE field_check (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  result text NOT NULL CHECK (result IN ('valid', 'partly', 'notValid')),
  note text NOT NULL CHECK (length(note) BETWEEN 5 AND 1000),
  -- The version the correction made, or null with none.
  version integer,
  at text NOT NULL
);
CREATE INDEX field_check_ticket ON field_check (ticket_number, at);
CREATE TRIGGER field_check_no_update BEFORE UPDATE ON field_check
BEGIN SELECT RAISE(ABORT, 'field_check is append-only'); END;
CREATE TRIGGER field_check_no_delete BEFORE DELETE ON field_check
BEGIN SELECT RAISE(ABORT, 'field_check is append-only'); END;

-- What was done about a report: an action of its hazard's catalogue, or one in the officer's words.
CREATE TABLE handling_action (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  code text,
  label text NOT NULL CHECK (length(label) BETWEEN 3 AND 120),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL,
  UNIQUE (ticket_number, label)
);
CREATE TRIGGER handling_action_no_update BEFORE UPDATE ON handling_action
BEGIN SELECT RAISE(ABORT, 'handling_action is append-only'); END;
CREATE TRIGGER handling_action_no_delete BEFORE DELETE ON handling_action
BEGIN SELECT RAISE(ABORT, 'handling_action is append-only'); END;

-- Photos of the work, apart from the reporter's: their own rows and their own place in the store.
CREATE TABLE handling_proof (
  id text PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  store_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  lat real CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon real CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  accuracy_m real,
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  received_at text NOT NULL,
  CHECK ((lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (accuracy_m IS NULL))
);
CREATE INDEX handling_proof_ticket ON handling_proof (ticket_number, received_at);
CREATE TRIGGER handling_proof_no_update BEFORE UPDATE ON handling_proof
BEGIN SELECT RAISE(ABORT, 'handling_proof is append-only'); END;
CREATE TRIGGER handling_proof_no_delete BEFORE DELETE ON handling_proof
BEGIN SELECT RAISE(ABORT, 'handling_proof is append-only'); END;
