-- The BPBD's follow-up data after a first report (upstream "Data lanjutan BPBD", M09). One file per
-- report, kept by the BPBD accounts of its regency; team members join by a one-time link that
-- becomes a cookie of their own (D20). Records keep their personal values apart (D4); a record is
-- never deleted, only cancelled with its reason.
CREATE TABLE case_file (
  id text PRIMARY KEY CHECK (length(id) = 16),
  ticket_number text NOT NULL UNIQUE REFERENCES ticket (ticket_number),
  regency_code text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'proposed', 'done', 'doneNoted')),
  fields text NOT NULL DEFAULT '{}' CHECK (json_valid(fields)),
  nil text NOT NULL DEFAULT '[]' CHECK (json_valid(nil)),
  revision integer NOT NULL DEFAULT 0,
  opened_by text NOT NULL,
  opened_at text NOT NULL,
  -- When BNPB accepted its closing: five years of personal data run from here (D23).
  accepted_at text,
  erased_at text
);
CREATE INDEX case_file_regency ON case_file (regency_code, status);

CREATE TABLE case_member (
  id text PRIMARY KEY CHECK (length(id) = 16),
  file_id text NOT NULL REFERENCES case_file (id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  number text NOT NULL,
  -- SHA-256 of the one-time link; cleared once it is exchanged.
  link_hash text UNIQUE,
  link_expires_at text,
  -- SHA-256 of the member's own cookie.
  session_hash text UNIQUE,
  session_expires_at text,
  added_by text NOT NULL,
  added_at text NOT NULL,
  removed_at text
);
CREATE INDEX case_member_file ON case_member (file_id);

CREATE TABLE case_record (
  id text PRIMARY KEY CHECK (length(id) = 16),
  file_id text NOT NULL REFERENCES case_file (id),
  kind text NOT NULL CHECK (kind IN ('house', 'infrastructure', 'shelter', 'evacuee', 'victim', 'business', 'need')),
  seq integer NOT NULL,
  data text NOT NULL CHECK (json_valid(data)),
  personal text NOT NULL CHECK (json_valid(personal)),
  lat real,
  lon real,
  cancelled_reason text,
  -- The phone's own id for a save made with no signal: sent again, it is one record.
  client_id text,
  revision integer NOT NULL DEFAULT 0,
  by_label text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (file_id, kind, seq),
  UNIQUE (file_id, client_id)
);
CREATE INDEX case_record_file ON case_record (file_id, kind, seq);

CREATE TABLE case_media (
  id text PRIMARY KEY,
  record_id text NOT NULL REFERENCES case_record (id),
  file_id text NOT NULL REFERENCES case_file (id),
  kind text NOT NULL CHECK (kind IN ('photo', 'face', 'video')),
  object_key text NOT NULL,
  lat real,
  lon real,
  badge text NOT NULL CHECK (badge IN ('gps', 'exif', 'none')),
  taken_at text,
  by_label text NOT NULL,
  at text NOT NULL,
  erased_at text
);
CREATE INDEX case_media_record ON case_media (record_id);

-- Every change, never changed itself: general values in full, personal ones by fingerprint only (D4).
CREATE TABLE case_trail (
  id integer PRIMARY KEY,
  file_id text NOT NULL REFERENCES case_file (id),
  record_id text,
  action text NOT NULL CHECK (action IN ('open', 'add', 'change', 'cancel', 'media', 'nil', 'fields', 'memberAdd',
    'memberRemove', 'memberLink', 'close', 'accept', 'reopen', 'erase')),
  detail text CHECK (detail IS NULL OR json_valid(detail)),
  by_label text NOT NULL,
  at text NOT NULL
);
CREATE INDEX case_trail_file ON case_trail (file_id, at);
CREATE TRIGGER case_trail_no_update BEFORE UPDATE ON case_trail
BEGIN SELECT RAISE(ABORT, 'case_trail is append-only'); END;
CREATE TRIGGER case_trail_no_delete BEFORE DELETE ON case_trail
BEGIN SELECT RAISE(ABORT, 'case_trail is append-only'); END;

-- Each opening of a file, each personal value shown in full and each media file read (D22).
CREATE TABLE case_access (
  id integer PRIMARY KEY,
  file_id text NOT NULL REFERENCES case_file (id),
  record_id text,
  action text NOT NULL CHECK (action IN ('open', 'reveal', 'media')),
  who_id text NOT NULL,
  who_label text NOT NULL,
  at text NOT NULL
);
CREATE INDEX case_access_file ON case_access (file_id, at);
CREATE TRIGGER case_access_no_update BEFORE UPDATE ON case_access
BEGIN SELECT RAISE(ABORT, 'case_access is append-only'); END;
CREATE TRIGGER case_access_no_delete BEFORE DELETE ON case_access
BEGIN SELECT RAISE(ABORT, 'case_access is append-only'); END;

-- A closing sealed as a version with no personal value (D14); a version is never overwritten.
CREATE TABLE case_version (
  file_id text NOT NULL REFERENCES case_file (id),
  version integer NOT NULL CHECK (version >= 1),
  body text NOT NULL CHECK (json_valid(body)),
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  sealed_by text NOT NULL,
  at text NOT NULL,
  PRIMARY KEY (file_id, version)
);
CREATE TRIGGER case_version_no_update BEFORE UPDATE ON case_version
BEGIN SELECT RAISE(ABORT, 'case_version is append-only'); END;
CREATE TRIGGER case_version_no_delete BEFORE DELETE ON case_version
BEGIN SELECT RAISE(ABORT, 'case_version is append-only'); END;
