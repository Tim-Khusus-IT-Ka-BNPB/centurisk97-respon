-- A phone warned of its districts' outlook (M07, upstream pw_langganan). The push service's
-- address and the phone's keys, the district and what to be warned of: never a point.
CREATE TABLE warning_subscription (
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 1000 AND endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
  auth text NOT NULL CHECK (length(auth) BETWEEN 20 AND 30),
  district_code text NOT NULL CHECK (district_code GLOB '[0-9][0-9].[0-9][0-9].[0-9][0-9]'),
  regency_code text NOT NULL CHECK (regency_code GLOB '[0-9][0-9].[0-9][0-9]'),
  district_name text NOT NULL,
  hazards integer NOT NULL CHECK (hazards BETWEEN 1 AND 15),
  threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 3),
  created_at text NOT NULL,
  PRIMARY KEY (endpoint, district_code)
);

CREATE INDEX warning_subscription_regency ON warning_subscription (regency_code);
