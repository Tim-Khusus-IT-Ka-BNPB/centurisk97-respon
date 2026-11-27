-- The public "today" page (upstream lapor-kejadian, row 36): an event shows once its report's last
-- field check is Valid by the BPBD of the report's own region. A check now keeps who made it, by role
-- and region; checks from before this are never counted, so they never show. Staff may pull an event
-- off the page and put it back: each pull is a row of its own.
ALTER TABLE field_check ADD COLUMN checker_role text CHECK (checker_role IS NULL OR checker_role IN ('deskOfficer', 'regionalOfficer'));
ALTER TABLE field_check ADD COLUMN checker_level text CHECK (checker_level IS NULL OR checker_level IN ('national', 'province', 'regency'));
ALTER TABLE field_check ADD COLUMN checker_code text;

CREATE TABLE today_pull (
  id integer PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  pulled integer NOT NULL CHECK (pulled IN (0, 1)),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL
);
CREATE INDEX today_pull_ticket ON today_pull (ticket_number, id);
CREATE TRIGGER today_pull_no_update BEFORE UPDATE ON today_pull
BEGIN SELECT RAISE(ABORT, 'today_pull is append-only'); END;
CREATE TRIGGER today_pull_no_delete BEFORE DELETE ON today_pull
BEGIN SELECT RAISE(ABORT, 'today_pull is append-only'); END;
