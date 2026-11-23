-- One row per limit, subject and fixed window. The subject is an HMAC key, never a number or an address.
CREATE TABLE rate_counter (
  limit_id text NOT NULL,
  subject_key text NOT NULL,
  window_start text NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (limit_id, subject_key, window_start)
);
CREATE INDEX rate_counter_window ON rate_counter (window_start);

-- Model calls of one number on one WIB day, across devices. Aborted calls count.
CREATE TABLE model_usage (
  number_key text NOT NULL,
  wib_date text NOT NULL,
  calls integer NOT NULL CHECK (calls >= 0),
  PRIMARY KEY (number_key, wib_date)
);
