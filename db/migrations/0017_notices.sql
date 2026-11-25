-- The outbox of news for reporters: one row per thing staff did that its reporter is told, written
-- in the batch of the act itself. It names what it tells (a history row or a reply) and holds no
-- words, so each door words it as it shows or sends it. Append-only.
CREATE TABLE notice (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  kind text NOT NULL CHECK (kind IN ('status', 'reply', 'actions', 'correction')),
  -- A row of ticket_history, which a later migration may make again, so it is no foreign key.
  history_id integer,
  reply_id integer REFERENCES report_reply (id),
  at text NOT NULL,
  CHECK ((kind = 'reply') = (reply_id IS NOT NULL)),
  CHECK ((kind = 'reply') = (history_id IS NULL))
);
CREATE INDEX notice_ticket ON notice (ticket_number, at);
CREATE TRIGGER notice_no_update BEFORE UPDATE ON notice
BEGIN SELECT RAISE(ABORT, 'notice is append-only'); END;
CREATE TRIGGER notice_no_delete BEFORE DELETE ON notice
BEGIN SELECT RAISE(ABORT, 'notice is append-only'); END;

-- How far a reporter has read a report's news, and whether they stopped it: while stopped, no
-- notice is written.
CREATE TABLE report_news (
  report_id text PRIMARY KEY REFERENCES report (id),
  read_at text NOT NULL,
  stopped integer NOT NULL DEFAULT 0 CHECK (stopped IN (0, 1)),
  changed_at text NOT NULL
);
