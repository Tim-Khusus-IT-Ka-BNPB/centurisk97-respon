-- When and where a video's own file says it was made (D77): the phone's movie header time and its
-- ISO 6709 point, kept as said; null when the file says nothing believable.
ALTER TABLE draft_video ADD COLUMN made_at text;
ALTER TABLE draft_video ADD COLUMN lat real;
ALTER TABLE draft_video ADD COLUMN lon real;
