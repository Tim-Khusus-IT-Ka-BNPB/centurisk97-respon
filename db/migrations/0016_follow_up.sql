-- News a reporter adds to a report already sent. Its draft names the report; its photos join the
-- report's own when it is sent, each with the version it came with (none for the first).
ALTER TABLE report_draft ADD COLUMN follow_up_of text REFERENCES report (id);
ALTER TABLE draft_photo ADD COLUMN version integer CHECK (version IS NULL OR version >= 2);

-- A history row may tell of the reporter's own news. A check cannot be changed in place, so the
-- table is made again with its rows, its index and its triggers.
CREATE TABLE ticket_history_next (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'staff', 'reporter')),
  actor_id text,
  actor_label text,
  note text,
  at text NOT NULL,
  event text CHECK (event IN ('fieldCheck', 'actions', 'take', 'followUp')),
  detail text CHECK (detail IS NULL OR json_valid(detail)),
  CHECK ((actor = 'staff') = (actor_id IS NOT NULL AND actor_label IS NOT NULL)),
  CHECK (actor <> 'reporter' OR event IS 'followUp')
);
INSERT INTO ticket_history_next (id, ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at, event, detail)
  SELECT id, ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at, event, detail FROM ticket_history;
DROP TABLE ticket_history;
ALTER TABLE ticket_history_next RENAME TO ticket_history;
CREATE INDEX ticket_history_ticket ON ticket_history (ticket_number, at);
CREATE TRIGGER ticket_history_no_update BEFORE UPDATE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;
CREATE TRIGGER ticket_history_no_delete BEFORE DELETE ON ticket_history
BEGIN SELECT RAISE(ABORT, 'ticket_history is append-only'); END;
