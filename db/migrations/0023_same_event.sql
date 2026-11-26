-- A report its reporter confirmed is of the same event as one sent before (K66, D106): it joins
-- that report's cluster on the desk and the feed. Only reports, never an official event.
CREATE TABLE report_link (
  ticket_number text PRIMARY KEY REFERENCES ticket (ticket_number),
  same_as text NOT NULL REFERENCES ticket (ticket_number),
  at text NOT NULL,
  CHECK (same_as <> ticket_number)
);
CREATE INDEX report_link_same_as ON report_link (same_as);
