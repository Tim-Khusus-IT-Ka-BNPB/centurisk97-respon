-- The WhatsApp door. Each write a gateway sends names a message id of its own, used once: a replay
-- finds its row here and is refused. Swept after 2 days, well past the minutes a signature is good.
CREATE TABLE gateway_message (
  gateway_id text NOT NULL,
  message_id text NOT NULL,
  received_at text NOT NULL,
  PRIMARY KEY (gateway_id, message_id)
);
CREATE INDEX gateway_message_received ON gateway_message (received_at);

-- Where a chat stands beside its draft: who is being asked for, half an answer, the location last
-- shared. Before consent it holds the number's key and that consent was asked, nothing else.
CREATE TABLE chat_session (
  number_key text PRIMARY KEY,
  step text CHECK (step IS NULL OR json_valid(step)),
  shared_point text CHECK (shared_point IS NULL OR json_valid(shared_point)),
  updated_at text NOT NULL
);
CREATE INDEX chat_session_updated ON chat_session (updated_at);

-- Which door a report came through.
ALTER TABLE report ADD COLUMN door text NOT NULL DEFAULT 'web' CHECK (door IN ('web', 'chat'));

-- A photo sent in a chat is placed by the location shared there and timed by its message. A check
-- cannot be changed in place, so the table is made again with its rows, its index and its trigger.
CREATE TABLE draft_photo_next (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  store_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  lat real CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon real CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  accuracy_m real CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  badge text NOT NULL CHECK (badge IN ('deviceGps', 'photoData', 'chatLocation', 'none')),
  far integer NOT NULL CHECK (far IN (0, 1)),
  taken_at text,
  time_source text NOT NULL CHECK (time_source IN ('photoData', 'deviceGps', 'upload', 'chatMessage')),
  received_at text NOT NULL,
  version integer CHECK (version IS NULL OR version >= 2),
  CHECK ((lat IS NULL) = (lon IS NULL)),
  CHECK ((badge = 'none') = (lat IS NULL)),
  CHECK (badge = 'deviceGps' OR accuracy_m IS NULL)
);
INSERT INTO draft_photo_next (id, draft_id, store_key, bytes, lat, lon, accuracy_m, badge, far, taken_at, time_source, received_at, version)
  SELECT id, draft_id, store_key, bytes, lat, lon, accuracy_m, badge, far, taken_at, time_source, received_at, version FROM draft_photo;
DROP TABLE draft_photo;
ALTER TABLE draft_photo_next RENAME TO draft_photo;
CREATE INDEX draft_photo_draft ON draft_photo (draft_id, received_at);
CREATE TRIGGER draft_photo_removed AFTER DELETE ON draft_photo
BEGIN INSERT OR IGNORE INTO photo_removal (store_key, queued_at) VALUES (old.store_key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); END;
