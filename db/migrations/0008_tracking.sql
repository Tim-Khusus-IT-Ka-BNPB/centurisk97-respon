-- The tracking link's secret is made from the report by HMAC and never stored; this is its
-- SHA-256, which a tracking page's token is looked up by.
ALTER TABLE report ADD COLUMN tracking_hash text;
CREATE UNIQUE INDEX report_tracking_hash ON report (tracking_hash) WHERE tracking_hash IS NOT NULL;

-- The reporter's 1 to 5 rating of reporting one sent report. A new rating replaces the old one.
CREATE TABLE report_rating (
  report_id text PRIMARY KEY REFERENCES report (id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rated_at text NOT NULL
);

-- Small upstream reference files kept whole: the BPBD contact numbers and the preparedness
-- topics. Each name holds the file last imported, checked against its contract, with its data date.
CREATE TABLE reference_file (
  name text PRIMARY KEY CHECK (name IN ('bpbdContacts', 'education')),
  data_date text NOT NULL,
  source text NOT NULL,
  body text NOT NULL CHECK (json_valid(body)),
  checksum text NOT NULL,
  imported_at text NOT NULL
);
