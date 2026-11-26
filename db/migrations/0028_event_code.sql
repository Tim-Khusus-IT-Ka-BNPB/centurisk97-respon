-- One code per event its reporters confirmed (K66, D106, upstream lapor_kelompok): KJ-ddmmyy-NN from
-- the WIB date of its first report, numbered by day. An event holds two reports or more.
CREATE TABLE event_day_counter (
  wib_date text PRIMARY KEY,
  last_n integer NOT NULL CHECK (last_n >= 1)
);
CREATE TABLE report_event (
  ticket_number text PRIMARY KEY REFERENCES ticket (ticket_number),
  code text NOT NULL CHECK (code GLOB 'KJ-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9]*'),
  at text NOT NULL
);
CREATE INDEX report_event_code ON report_event (code);

-- A history row may tell of a report released from its event. A check cannot be changed in place,
-- so the table is made again with its rows, its index and its triggers.
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
  event text CHECK (event IN ('fieldCheck', 'actions', 'take', 'followUp', 'released')),
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
