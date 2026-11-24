-- Staff on the desk. A seeded staff session names one staff account: its id, the label the desk
-- and the history show, and the region it may work (national, or one province or regency).
ALTER TABLE seeded_session ADD COLUMN staff_id text;
ALTER TABLE seeded_session ADD COLUMN staff_label text;
ALTER TABLE seeded_session ADD COLUMN scope_level text CHECK (scope_level IN ('national', 'province', 'regency'));
ALTER TABLE seeded_session ADD COLUMN scope_code text;

-- Ticket history gains staff as an actor. A check cannot be changed in place, so the table is
-- made again with its rows; its append-only triggers are made again with it.
CREATE TABLE ticket_history_next (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'staff')),
  actor_id text,
  actor_label text,
  note text,
  at text NOT NULL,
  CHECK ((actor = 'staff') = (actor_id IS NOT NULL AND actor_label IS NOT NULL))
);
INSERT INTO ticket_history_next (id, ticket_number, from_status, to_status, actor, note, at)
  SELECT id, ticket_number, from_status, to_status, actor, note, at FROM ticket_history;
DROP TABLE ticket_history;
ALTER TABLE ticket_history_next RENAME TO ticket_history;
CREATE INDEX ticket_history_ticket ON ticket_history (ticket_number, at);
CREATE TRIGGER ticket_history_no_update BEFORE UPDATE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;
CREATE TRIGGER ticket_history_no_delete BEFORE DELETE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;

-- One row per staff action on a report, written in the same batch as the action. Append-only.
CREATE TABLE staff_action (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  staff_kind text NOT NULL CHECK (staff_kind IN ('deskOfficer', 'regionalOfficer')),
  action text NOT NULL CHECK (
    action IN ('view', 'identityView', 'status', 'reply', 'fieldCheck', 'handlingAction', 'handlingProof', 'take')
  ),
  at text NOT NULL
);
CREATE INDEX staff_action_ticket ON staff_action (ticket_number, at);
CREATE TRIGGER staff_action_no_update BEFORE UPDATE ON staff_action
BEGIN SELECT RAISE(ABORT, 'staff_action is append-only'); END;
CREATE TRIGGER staff_action_no_delete BEFORE DELETE ON staff_action
BEGIN SELECT RAISE(ABORT, 'staff_action is append-only'); END;

-- The desk lists sent reports newest first.
CREATE INDEX report_sent ON report (sent_at);
