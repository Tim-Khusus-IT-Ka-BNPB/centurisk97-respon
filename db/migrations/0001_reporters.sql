-- Instants are ISO 8601 text in UTC, ids are UUID text made by the app, JSON is text.
-- D1 has no roles: what the app may not change is held by triggers (see 0003).

-- Every guarded batch inserts here; a false condition breaks the check and rolls back the batch.
-- The batch deletes its own rows before it ends, so the table is always empty.
CREATE TABLE batch_guard (
  ok integer NOT NULL,
  CONSTRAINT batch_guard_held CHECK (ok = 1)
);

CREATE TABLE reporter (
  id text PRIMARY KEY,
  number text NOT NULL CHECK (
    number GLOB '+628[0-9]*' AND length(number) BETWEEN 12 AND 16 AND substr(number, 2) NOT GLOB '*[^0-9]*'
  ),
  number_key text NOT NULL UNIQUE,
  created_at text NOT NULL
);

CREATE TABLE device (
  id text PRIMARY KEY,
  key_fingerprint text NOT NULL UNIQUE,
  created_at text NOT NULL,
  last_seen_at text NOT NULL
);

CREATE TABLE reporter_profile (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES reporter (id),
  owner_slot text NOT NULL,
  device_id text REFERENCES device (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80 AND name NOT GLOB '*[0-9]*'),
  role text NOT NULL CHECK (role IN ('citizen', 'claimedOfficer')),
  officer_regency text CHECK (officer_regency IS NULL OR length(officer_regency) BETWEEN 3 AND 80),
  officer_position text CHECK (officer_position IS NULL OR length(officer_position) BETWEEN 2 AND 80),
  created_at text NOT NULL,
  last_used_at text NOT NULL,
  UNIQUE (reporter_id, owner_slot),
  -- The slot is the device id for a device binding, or "session" for a main-site session.
  CHECK ((device_id IS NULL AND owner_slot = 'session') OR (device_id IS NOT NULL AND owner_slot = device_id)),
  CHECK ((role = 'claimedOfficer') = (officer_regency IS NOT NULL AND officer_position IS NOT NULL))
);
CREATE INDEX reporter_profile_device ON reporter_profile (device_id);

CREATE TABLE reporter_consent (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES reporter_profile (id) ON DELETE CASCADE,
  privacy_version integer NOT NULL CHECK (privacy_version >= 1),
  agreed_at text NOT NULL
);
CREATE INDEX reporter_consent_profile ON reporter_consent (profile_id, agreed_at);

-- Local, test and staging only: the seeded identity adapter. The settings refuse it in production.
CREATE TABLE seeded_session (
  token_hash text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('reporter', 'staff')),
  reporter_id text REFERENCES reporter (id) ON DELETE CASCADE,
  staff_role text CHECK (staff_role IN ('deskOfficer', 'regionalOfficer')),
  CHECK ((kind = 'reporter') = (reporter_id IS NOT NULL AND staff_role IS NULL)),
  CHECK ((kind = 'staff') = (staff_role IS NOT NULL AND reporter_id IS NULL))
);
