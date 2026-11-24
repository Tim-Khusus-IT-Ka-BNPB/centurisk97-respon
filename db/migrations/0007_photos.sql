-- Photos taken in the photo step of a draft. The file lives in the photo store under store_key,
-- with its metadata stripped; what the checks read from it is kept here.
CREATE TABLE draft_photo (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  store_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  lat real CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon real CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  accuracy_m real CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  badge text NOT NULL CHECK (badge IN ('deviceGps', 'photoData', 'none')),
  far integer NOT NULL CHECK (far IN (0, 1)),
  taken_at text,
  time_source text NOT NULL CHECK (time_source IN ('photoData', 'deviceGps', 'upload')),
  received_at text NOT NULL,
  CHECK ((lat IS NULL) = (lon IS NULL)),
  CHECK ((badge = 'none') = (lat IS NULL)),
  CHECK (badge = 'deviceGps' OR accuracy_m IS NULL)
);
CREATE INDEX draft_photo_draft ON draft_photo (draft_id, received_at);

-- Files whose row is gone, however it went (a draft cancelled, expired or removed with its
-- number): the sweep deletes each file from the store, then its row here.
CREATE TABLE photo_removal (
  store_key text PRIMARY KEY,
  queued_at text NOT NULL
);
CREATE TRIGGER draft_photo_removed AFTER DELETE ON draft_photo
BEGIN INSERT OR IGNORE INTO photo_removal (store_key, queued_at) VALUES (old.store_key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); END;
