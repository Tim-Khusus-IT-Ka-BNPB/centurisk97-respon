-- The numbers the owner allowed into the WhatsApp pilot (K2). One allowed as BPBD of a regency
-- confirms what a claimed officer said of themself (D19).
CREATE TABLE pilot_number (
  number_key text PRIMARY KEY,
  number text NOT NULL CHECK (
    number GLOB '+628[0-9]*' AND length(number) BETWEEN 12 AND 16 AND substr(number, 2) NOT GLOB '*[^0-9]*'
  ),
  officer_regency text CHECK (officer_regency IS NULL OR length(officer_regency) BETWEEN 3 AND 80),
  -- The officer or the gateway that allowed it, as the list names them.
  added_by text NOT NULL,
  added_at text NOT NULL
);

-- Every number allowed or taken away, and by whom. Holds the number's key alone. Append-only.
CREATE TABLE pilot_change (
  id integer PRIMARY KEY,
  number_key text NOT NULL,
  change text NOT NULL CHECK (change IN ('allowed', 'removed')),
  by_kind text NOT NULL CHECK (by_kind IN ('staff', 'gateway')),
  by_id text NOT NULL,
  at text NOT NULL
);
CREATE INDEX pilot_change_number ON pilot_change (number_key, id);
CREATE TRIGGER pilot_change_no_update BEFORE UPDATE ON pilot_change
BEGIN SELECT RAISE(ABORT, 'pilot_change is append-only'); END;
CREATE TRIGGER pilot_change_no_delete BEFORE DELETE ON pilot_change
BEGIN SELECT RAISE(ABORT, 'pilot_change is append-only'); END;

-- A change of the list is one staff action, of no report. A check cannot be changed in place, so the
-- table is made again with its rows, its index and its triggers.
CREATE TABLE staff_action_next (
  id integer PRIMARY KEY,
  ticket_number text REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  staff_kind text NOT NULL CHECK (staff_kind IN ('deskOfficer', 'regionalOfficer')),
  action text NOT NULL CHECK (
    action IN (
      'view', 'identityView', 'status', 'reply', 'fieldCheck', 'handlingAction', 'handlingProof', 'take',
      'document', 'documentPack', 'pilotAllow', 'pilotRemove'
    )
  ),
  at text NOT NULL,
  CHECK ((action IN ('pilotAllow', 'pilotRemove')) = (ticket_number IS NULL))
);
INSERT INTO staff_action_next (id, ticket_number, staff_id, staff_label, staff_kind, action, at)
  SELECT id, ticket_number, staff_id, staff_label, staff_kind, action, at FROM staff_action;
DROP TABLE staff_action;
ALTER TABLE staff_action_next RENAME TO staff_action;
CREATE INDEX staff_action_ticket ON staff_action (ticket_number, at);
CREATE TRIGGER staff_action_no_update BEFORE UPDATE ON staff_action
BEGIN SELECT RAISE(ABORT, 'staff_action is append-only'); END;
CREATE TRIGGER staff_action_no_delete BEFORE DELETE ON staff_action
BEGIN SELECT RAISE(ABORT, 'staff_action is append-only'); END;
