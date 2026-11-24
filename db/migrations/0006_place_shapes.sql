-- Simplified village outlines of a snapshot, for reading a GPS point as a village. The box and
-- the centre (the middle of the box, as upstream measures it) let a query narrow the candidates
-- before the outline itself is tested.
CREATE TABLE place_village_shape (
  snapshot_id integer NOT NULL,
  code text NOT NULL,
  min_lat real NOT NULL,
  min_lon real NOT NULL,
  max_lat real NOT NULL CHECK (max_lat >= min_lat),
  max_lon real NOT NULL CHECK (max_lon >= min_lon),
  centre_lat real NOT NULL,
  centre_lon real NOT NULL,
  rings text NOT NULL CHECK (json_valid(rings)),
  PRIMARY KEY (snapshot_id, code),
  FOREIGN KEY (snapshot_id, code) REFERENCES place_village (snapshot_id, code) ON DELETE CASCADE
);
CREATE INDEX place_village_shape_centre ON place_village_shape (snapshot_id, centre_lat, centre_lon);
