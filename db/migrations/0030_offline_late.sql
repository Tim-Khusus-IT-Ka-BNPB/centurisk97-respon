-- A report kept on a phone with no signal (LR-09), told apart from one sent at once under the same
-- id: when the phone saved it, a note only (null when the phone's clock could not be believed), and
-- whether it reached the desk more than 2 hours after, so it no longer rings as a live emergency.
ALTER TABLE offline_send ADD COLUMN kept integer NOT NULL DEFAULT 0 CHECK (kept IN (0, 1));
ALTER TABLE offline_send ADD COLUMN saved_at text;
ALTER TABLE offline_send ADD COLUMN late integer NOT NULL DEFAULT 0 CHECK (late IN (0, 1));
