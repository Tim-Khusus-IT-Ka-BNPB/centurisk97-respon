-- Videos of the scene (M05 TASK-003, upstream D77, D79, D89, D90, lapor_unggah). An upload is
-- open while its parts arrive, each part's tag kept as it lands; a video made whole and checked
-- joins its draft as photos do, and leaves with it.
CREATE TABLE video_upload (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  store_key text NOT NULL UNIQUE,
  upload_id text NOT NULL,
  bytes integer NOT NULL CHECK (bytes BETWEEN 1000 AND 31457280),
  parts text NOT NULL DEFAULT '{}' CHECK (json_valid(parts)),
  browser_seconds real CHECK (browser_seconds IS NULL OR browser_seconds >= 0),
  started_at text NOT NULL,
  touched_at text NOT NULL
);
CREATE INDEX video_upload_draft ON video_upload (draft_id);
CREATE INDEX video_upload_touched ON video_upload (touched_at);

CREATE TABLE draft_video (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  store_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  container text NOT NULL CHECK (container IN ('mp4', 'mov', 'webm')),
  seconds integer NOT NULL CHECK (seconds BETWEEN 0 AND 61),
  received_at text NOT NULL
);
CREATE INDEX draft_video_draft ON draft_video (draft_id, received_at);
CREATE TRIGGER draft_video_removed AFTER DELETE ON draft_video
BEGIN INSERT OR IGNORE INTO photo_removal (store_key, queued_at) VALUES (old.store_key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); END;
