-- Every download of the weekly counts (D93): who and when. The file itself is never kept: it is
-- made from the reports when it is asked for. Append-only.
CREATE TABLE aggregate_download (
  id integer PRIMARY KEY,
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL
);
CREATE TRIGGER aggregate_download_no_update BEFORE UPDATE ON aggregate_download
BEGIN SELECT RAISE(ABORT, 'aggregate_download is append-only'); END;
CREATE TRIGGER aggregate_download_no_delete BEFORE DELETE ON aggregate_download
BEGIN SELECT RAISE(ABORT, 'aggregate_download is append-only'); END;
