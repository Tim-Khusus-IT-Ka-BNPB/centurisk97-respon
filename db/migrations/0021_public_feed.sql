-- Whether a photo of the work shows on the public feed (D88, Q47): an officer marks each photo,
-- since one may show a victim's face or a number plate. The newest row of a photo holds; who
-- marked it and when stay here. Append-only.
CREATE TABLE proof_publication (
  id integer PRIMARY KEY,
  proof_id text NOT NULL REFERENCES handling_proof (id),
  public integer NOT NULL CHECK (public IN (0, 1)),
  staff_id text NOT NULL,
  staff_label text NOT NULL,
  at text NOT NULL
);
CREATE INDEX proof_publication_proof ON proof_publication (proof_id, id);
CREATE TRIGGER proof_publication_no_update BEFORE UPDATE ON proof_publication
BEGIN SELECT RAISE(ABORT, 'proof_publication is append-only'); END;
CREATE TRIGGER proof_publication_no_delete BEFORE DELETE ON proof_publication
BEGIN SELECT RAISE(ABORT, 'proof_publication is append-only'); END;

-- The feed lists handled reports newest first.
CREATE INDEX ticket_status ON ticket (status);
