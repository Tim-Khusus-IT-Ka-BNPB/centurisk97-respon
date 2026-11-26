-- Upstream's three-day outlook per regency (prediksi.json, PW F-3) joins the reference files: read,
-- never recomputed. A check cannot be changed in place, so the table is made again with its rows.
CREATE TABLE reference_file_next (
  name text PRIMARY KEY CHECK (name IN ('bpbdContacts', 'education', 'responseActions', 'forecast')),
  data_date text NOT NULL,
  source text NOT NULL,
  body text NOT NULL CHECK (json_valid(body)),
  checksum text NOT NULL,
  imported_at text NOT NULL
);
INSERT INTO reference_file_next SELECT name, data_date, source, body, checksum, imported_at FROM reference_file;
DROP TABLE reference_file;
ALTER TABLE reference_file_next RENAME TO reference_file;
