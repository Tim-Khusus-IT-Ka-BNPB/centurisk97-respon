CREATE TABLE report (
  id text PRIMARY KEY,
  ticket_number text NOT NULL UNIQUE CHECK (
    ticket_number GLOB 'LA-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9]*' AND substr(ticket_number, 11) NOT GLOB '*[^0-9]*'
  ),
  -- One ticket per draft: the backstop behind the send batch.
  draft_id text NOT NULL UNIQUE REFERENCES report_draft (id),
  reporter_id text REFERENCES reporter (id) ON DELETE SET NULL,
  number_key text NOT NULL,
  owner_slot text NOT NULL,
  number_unverified integer NOT NULL CHECK (number_unverified IN (0, 1)),
  hazard_type text NOT NULL,
  village_code text NOT NULL,
  district_code text NOT NULL,
  regency_code text NOT NULL,
  province_code text NOT NULL,
  sent_at text NOT NULL
);
-- The rolling send limit counts sends of one number in one slot over the last 24 hours.
CREATE INDEX report_sends ON report (number_key, owner_slot, sent_at);

CREATE TABLE report_version (
  report_id text NOT NULL REFERENCES report (id),
  version integer NOT NULL CHECK (version >= 1),
  fields text NOT NULL CHECK (json_valid(fields)),
  reporter_name text NOT NULL,
  reporter_number text NOT NULL,
  reporter_role text NOT NULL CHECK (reporter_role IN ('citizen', 'claimedOfficer')),
  officer_regency text,
  officer_position text,
  privacy_version integer NOT NULL,
  consent_agreed_at text NOT NULL,
  complete_percent integer NOT NULL CHECK (complete_percent BETWEEN 0 AND 100),
  created_at text NOT NULL,
  PRIMARY KEY (report_id, version)
);

CREATE TABLE ticket (
  ticket_number text PRIMARY KEY REFERENCES report (ticket_number),
  report_id text NOT NULL UNIQUE REFERENCES report (id),
  status text NOT NULL CHECK (status IN ('new', 'seen', 'under_review', 'forwarded', 'in_handling', 'closed', 'invalid')),
  updated_at text NOT NULL
);

CREATE TABLE ticket_history (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system')),
  note text,
  at text NOT NULL
);
CREATE INDEX ticket_history_ticket ON ticket_history (ticket_number, at);

-- Sent versions and ticket history are append-only: nothing may change or remove a row.
CREATE TRIGGER report_version_no_update BEFORE UPDATE ON report_version
BEGIN SELECT RAISE(ABORT, 'report_version is append-only'); END;
CREATE TRIGGER report_version_no_delete BEFORE DELETE ON report_version
BEGIN SELECT RAISE(ABORT, 'report_version is append-only'); END;
CREATE TRIGGER ticket_history_no_update BEFORE UPDATE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;
CREATE TRIGGER ticket_history_no_delete BEFORE DELETE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;

-- Raised inside the send batch, so a rolled back send never uses a number.
CREATE TABLE ticket_day_counter (
  wib_date text PRIMARY KEY,
  last_n integer NOT NULL CHECK (last_n >= 1)
);
