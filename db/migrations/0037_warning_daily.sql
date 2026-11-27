-- At most one warning a day for a phone, regency and hazard, whichever trigger raised it (upstream
-- DP-13, D30: the outlook and the impact model's status file). The phone is a fingerprint of its
-- push address, never the address.
CREATE TABLE warning_daily (
  device text NOT NULL CHECK (length(device) = 16),
  regency_code text NOT NULL,
  hazard text NOT NULL CHECK (hazard IN ('BNJ', 'LSR', 'ASP', 'CEX')),
  wib_date text NOT NULL,
  PRIMARY KEY (device, regency_code, hazard, wib_date)
) WITHOUT ROWID;
