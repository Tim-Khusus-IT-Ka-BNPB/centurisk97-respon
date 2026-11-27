-- Comments on the Alun-alun's cards (upstream lapor_komen, row 30: K95, D136 to D140). Written by a
-- reporter known on the phone or in the session; shown to everyone as "Warga", never with a name or
-- number. Three reports from three people take one off the card until the desk decides.
CREATE TABLE feed_comment (
  id text PRIMARY KEY CHECK (length(id) = 16),
  card_id text NOT NULL CHECK (length(card_id) = 16),
  author_key text NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 2 AND 500),
  status text NOT NULL DEFAULT 'shown' CHECK (status IN ('shown', 'reported', 'hidden')),
  reports integer NOT NULL DEFAULT 0 CHECK (reports >= 0),
  created_at text NOT NULL
);
CREATE INDEX feed_comment_card ON feed_comment (card_id, created_at);
CREATE INDEX feed_comment_author ON feed_comment (author_key, status);

-- One report per person: a session's number, or a phone's network, since one phone may type numbers.
CREATE TABLE feed_comment_report (
  comment_id text NOT NULL REFERENCES feed_comment (id),
  reporter_key text NOT NULL,
  at text NOT NULL,
  PRIMARY KEY (comment_id, reporter_key)
);

-- A figure the model read from a comment, quoted from it; nothing changes until the desk takes it.
CREATE TABLE feed_comment_figure (
  id integer PRIMARY KEY,
  comment_id text NOT NULL REFERENCES feed_comment (id),
  figure text NOT NULL CHECK (figure IN ('dead', 'missing', 'injured', 'displaced', 'houses', 'flooded')),
  value integer NOT NULL CHECK (value BETWEEN 0 AND 100000),
  quote text NOT NULL CHECK (length(quote) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  UNIQUE (comment_id, figure)
);

-- What the desk decided, one row each time, never changed (D139).
CREATE TABLE feed_comment_decision (
  id integer PRIMARY KEY,
  comment_id text NOT NULL REFERENCES feed_comment (id),
  figure_id integer REFERENCES feed_comment_figure (id),
  action text NOT NULL CHECK (action IN ('accept', 'reject', 'hide', 'show')),
  ticket_number text,
  field_id text,
  reason text CHECK (reason IS NULL OR length(reason) <= 300),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL,
  CHECK ((action IN ('accept', 'reject')) = (figure_id IS NOT NULL))
);
CREATE INDEX feed_comment_decision_comment ON feed_comment_decision (comment_id, at);
CREATE TRIGGER feed_comment_decision_no_update BEFORE UPDATE ON feed_comment_decision
BEGIN SELECT RAISE(ABORT, 'feed_comment_decision is append-only'); END;
CREATE TRIGGER feed_comment_decision_no_delete BEFORE DELETE ON feed_comment_decision
BEGIN SELECT RAISE(ABORT, 'feed_comment_decision is append-only'); END;

-- A history row may tell of a figure taken from a comment. A check cannot be changed in place, so the
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
  event text CHECK (event IN ('fieldCheck', 'actions', 'take', 'followUp', 'released', 'commentFigure')),
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
