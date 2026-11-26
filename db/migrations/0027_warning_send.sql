-- The highest level sent per regency, hazard and day: only a rise is sent again (upstream pw_status).
CREATE TABLE warning_sent (
  regency_code text NOT NULL CHECK (regency_code GLOB '[0-9][0-9].[0-9][0-9]'),
  hazard text NOT NULL CHECK (hazard IN ('BNJ', 'LSR', 'ASP', 'CEX')),
  date text NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 3),
  PRIMARY KEY (regency_code, hazard, date)
) WITHOUT ROWID;

-- Staff pause and resume the sending (upstream pw_kendali); the newest row holds. Append-only.
CREATE TABLE warning_pause (
  id integer PRIMARY KEY,
  paused integer NOT NULL CHECK (paused IN (0, 1)),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL
);
CREATE TRIGGER warning_pause_no_update BEFORE UPDATE ON warning_pause
BEGIN SELECT RAISE(ABORT, 'warning_pause is append-only'); END;
CREATE TRIGGER warning_pause_no_delete BEFORE DELETE ON warning_pause
BEGIN SELECT RAISE(ABORT, 'warning_pause is append-only'); END;
