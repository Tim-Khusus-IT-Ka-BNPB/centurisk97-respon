-- Two officers may work one ticket at once: each change names the revision it read, and the second
-- is refused. Every status change adds one.
ALTER TABLE ticket ADD COLUMN revision integer NOT NULL DEFAULT 0;

-- What an officer wrote back to the reporter. Append-only.
CREATE TABLE report_reply (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  at text NOT NULL
);
CREATE INDEX report_reply_ticket ON report_reply (ticket_number, at);
CREATE TRIGGER report_reply_no_update BEFORE UPDATE ON report_reply
BEGIN SELECT RAISE(ABORT, 'report_reply is append-only'); END;
CREATE TRIGGER report_reply_no_delete BEFORE DELETE ON report_reply
BEGIN SELECT RAISE(ABORT, 'report_reply is append-only'); END;
