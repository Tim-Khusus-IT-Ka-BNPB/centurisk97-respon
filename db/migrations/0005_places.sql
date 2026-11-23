CREATE TABLE place_snapshot (
  id integer PRIMARY KEY,
  source text NOT NULL,
  data_date text NOT NULL,
  imported_at text NOT NULL,
  village_count integer NOT NULL CHECK (village_count > 0),
  regency_count integer NOT NULL CHECK (regency_count > 0),
  checksum text NOT NULL,
  active integer NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
);
-- At most one snapshot is the one searched.
CREATE UNIQUE INDEX place_snapshot_one_active ON place_snapshot (active) WHERE active = 1;

CREATE TABLE place_regency (
  snapshot_id integer NOT NULL REFERENCES place_snapshot (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code GLOB '[0-9][0-9].[0-9][0-9]'),
  name text NOT NULL,
  province_code text NOT NULL,
  province_name text NOT NULL,
  village_count integer NOT NULL CHECK (village_count >= 0),
  search_text text NOT NULL,
  PRIMARY KEY (snapshot_id, code)
);

CREATE TABLE place_district (
  snapshot_id integer NOT NULL,
  code text NOT NULL CHECK (
    length(code) = 8 AND substr(code, 3, 1) = '.' AND substr(code, 6, 1) = '.' AND code NOT GLOB '*[^0-9.]*'
  ),
  name text NOT NULL,
  regency_code text NOT NULL,
  regency_name text NOT NULL,
  province_code text NOT NULL,
  province_name text NOT NULL,
  village_count integer NOT NULL CHECK (village_count > 0),
  search_text text NOT NULL,
  PRIMARY KEY (snapshot_id, code),
  FOREIGN KEY (snapshot_id, regency_code) REFERENCES place_regency (snapshot_id, code) ON DELETE CASCADE
);
CREATE INDEX place_district_regency ON place_district (snapshot_id, regency_code);

CREATE TABLE place_village (
  snapshot_id integer NOT NULL REFERENCES place_snapshot (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (
    length(code) = 13 AND substr(code, 3, 1) = '.' AND substr(code, 6, 1) = '.' AND substr(code, 9, 1) = '.'
    AND code NOT GLOB '*[^0-9.]*'
  ),
  name text NOT NULL,
  district_name text NOT NULL,
  regency_code text NOT NULL,
  regency_name text NOT NULL,
  province_code text NOT NULL,
  province_name text NOT NULL,
  search_text text NOT NULL,
  PRIMARY KEY (snapshot_id, code),
  FOREIGN KEY (snapshot_id, regency_code) REFERENCES place_regency (snapshot_id, code) ON DELETE CASCADE
);
CREATE INDEX place_village_regency ON place_village (snapshot_id, regency_code, name);
