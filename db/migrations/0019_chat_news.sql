-- The outbox may also hold a document to send in the chat: which version, no words. A check cannot
-- be changed in place, so the table is made again with its rows, its indexes and its triggers.
CREATE TABLE notice_next (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  kind text NOT NULL CHECK (kind IN ('status', 'reply', 'actions', 'correction', 'document')),
  -- A row of ticket_history, which a later migration may make again, so it is no foreign key.
  history_id integer,
  reply_id integer REFERENCES report_reply (id),
  version integer CHECK (version IS NULL OR version >= 1),
  at text NOT NULL,
  CHECK ((kind = 'reply') = (reply_id IS NOT NULL)),
  CHECK ((kind = 'document') = (version IS NOT NULL)),
  CHECK ((kind IN ('reply', 'document')) = (history_id IS NULL))
);
INSERT INTO notice_next (id, ticket_number, kind, history_id, reply_id, at)
  SELECT id, ticket_number, kind, history_id, reply_id, at FROM notice;
DROP TABLE notice;
ALTER TABLE notice_next RENAME TO notice;
CREATE INDEX notice_ticket ON notice (ticket_number, at);
CREATE INDEX notice_at ON notice (at);
CREATE TRIGGER notice_no_update BEFORE UPDATE ON notice
BEGIN SELECT RAISE(ABORT, 'notice is append-only'); END;
CREATE TRIGGER notice_no_delete BEFORE DELETE ON notice
BEGIN SELECT RAISE(ABORT, 'notice is append-only'); END;

-- What a gateway has sent of the outbox. Append-only.
CREATE TABLE notice_delivery (
  notice_id integer PRIMARY KEY REFERENCES notice (id),
  gateway_id text NOT NULL,
  at text NOT NULL
);
CREATE TRIGGER notice_delivery_no_update BEFORE UPDATE ON notice_delivery
BEGIN SELECT RAISE(ABORT, 'notice_delivery is append-only'); END;
CREATE TRIGGER notice_delivery_no_delete BEFORE DELETE ON notice_delivery
BEGIN SELECT RAISE(ABORT, 'notice_delivery is append-only'); END;

-- Whether a number wants news in its chat (D32): asked once, and each answer since. The newest row
-- holds; with none, or only asked, nothing is sent. Append-only.
CREATE TABLE news_choice (
  id integer PRIMARY KEY,
  number_key text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('asked', 'yes', 'no')),
  at text NOT NULL
);
CREATE INDEX news_choice_number ON news_choice (number_key, id);
CREATE TRIGGER news_choice_no_update BEFORE UPDATE ON news_choice
BEGIN SELECT RAISE(ABORT, 'news_choice is append-only'); END;
CREATE TRIGGER news_choice_no_delete BEFORE DELETE ON news_choice
BEGIN SELECT RAISE(ABORT, 'news_choice is append-only'); END;
