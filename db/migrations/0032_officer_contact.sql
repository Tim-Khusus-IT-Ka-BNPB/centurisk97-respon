-- The BPBD officers a BNPB officer may call about a report (upstream PF-09, gap row 31). On the seeded
-- adapter a seeded officer's WhatsApp number; on the main site its profiles hold them.
ALTER TABLE seeded_session ADD COLUMN profile_number text;

-- Each time a BNPB officer opened an officer's full number, as upstream logs it.
CREATE TABLE officer_number_view (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  profile_id text NOT NULL,
  at text NOT NULL
);
CREATE INDEX officer_number_view_ticket ON officer_number_view (ticket_number, at);
CREATE TRIGGER officer_number_view_no_update BEFORE UPDATE ON officer_number_view
BEGIN SELECT RAISE(ABORT, 'officer_number_view is append-only'); END;
CREATE TRIGGER officer_number_view_no_delete BEFORE DELETE ON officer_number_view
BEGIN SELECT RAISE(ABORT, 'officer_number_view is append-only'); END;
