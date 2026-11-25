-- An emergency report: how it reached the desk, and whether anyone is hurt, missing or trapped as
-- the reporter said.
ALTER TABLE report ADD COLUMN emergency text CHECK (emergency IN ('chat', 'oneTap'));
ALTER TABLE report ADD COLUMN emergency_victims text CHECK (emergency_victims IN ('yes', 'no', 'unknown'));
CREATE INDEX report_emergency ON report (sent_at) WHERE emergency IS NOT NULL;
