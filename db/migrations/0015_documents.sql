-- A document downloaded by staff is one staff action: the file leaves the desk. A check cannot be
-- changed in place, so the table is made again with its rows, its index and its triggers.
CREATE TABLE staff_action_next (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  staff_kind text NOT NULL CHECK (staff_kind IN ('deskOfficer', 'regionalOfficer')),
  action text NOT NULL CHECK (
    action IN (
      'view', 'identityView', 'status', 'reply', 'fieldCheck', 'handlingAction', 'handlingProof', 'take',
      'document'
    )
  ),
  at text NOT NULL
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
