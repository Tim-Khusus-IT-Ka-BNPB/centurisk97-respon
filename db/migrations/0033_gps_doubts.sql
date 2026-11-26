-- Why a photo's GPS may not be where the phone was (D11): zone, abroad, jump, as a JSON list; null for
-- a photo kept before the check or with no point.
ALTER TABLE draft_photo ADD COLUMN gps_doubts text CHECK (gps_doubts IS NULL OR json_valid(gps_doubts));
