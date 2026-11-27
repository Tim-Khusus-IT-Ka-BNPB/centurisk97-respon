-- A video of a follow-up record, sent in parts so a broken send goes on where it stopped (upstream
-- LJ-18, as a report's own videos in 0029). Once whole and read, it joins the record's media.
CREATE TABLE case_video_upload (
  id text PRIMARY KEY,
  file_id text NOT NULL REFERENCES case_file (id),
  record_id text NOT NULL REFERENCES case_record (id),
  store_key text NOT NULL UNIQUE,
  upload_id text NOT NULL,
  bytes integer NOT NULL CHECK (bytes BETWEEN 1000 AND 31457280),
  parts text NOT NULL DEFAULT '{}' CHECK (json_valid(parts)),
  browser_seconds real CHECK (browser_seconds IS NULL OR browser_seconds >= 0),
  started_at text NOT NULL,
  touched_at text NOT NULL
);
CREATE INDEX case_video_upload_record ON case_video_upload (record_id);
CREATE INDEX case_video_upload_touched ON case_video_upload (touched_at);

-- A video's length and container, kept with its media row.
ALTER TABLE case_media ADD COLUMN seconds real;
ALTER TABLE case_media ADD COLUMN container text;
