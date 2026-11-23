CREATE TABLE report_draft (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES reporter (id) ON DELETE CASCADE,
  profile_id text REFERENCES reporter_profile (id) ON DELETE SET NULL,
  owner_slot text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'place', 'place_confirm', 'neighbourhood', 'asking', 'guided_chronology', 'free_story', 'photos', 'summary',
    'sent', 'cancelled', 'expired'
  )),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  fields text CHECK (fields IS NULL OR json_valid(fields)),
  back_stack text CHECK (back_stack IS NULL OR json_valid(back_stack)),
  asked text NOT NULL DEFAULT '{}' CHECK (json_valid(asked)),
  off_topic_count integer NOT NULL DEFAULT 0 CHECK (off_topic_count >= 0),
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls >= 0),
  templates_only integer NOT NULL DEFAULT 0 CHECK (templates_only IN (0, 1)),
  village_code text,
  hazard_type text,
  -- What the reporter still has to be shown after a turn (a danger warning, the 112 line), as copy
  -- keys. Every turn ends in a redirect, so the next read shows them once and clears them.
  pending_notices text CHECK (pending_notices IS NULL OR json_valid(pending_notices)),
  created_at text NOT NULL,
  last_acted_at text NOT NULL,
  ended_at text,
  end_reason text CHECK (end_reason IN ('sent', 'cancelled', 'expired', 'removedNumber')),
  -- A final draft holds no personal content.
  CHECK (state NOT IN ('sent', 'cancelled', 'expired') OR (fields IS NULL AND back_stack IS NULL AND ended_at IS NOT NULL))
);
-- One open draft per number per device or session, enforced here.
CREATE UNIQUE INDEX report_draft_one_open ON report_draft (reporter_id, owner_slot)
  WHERE state NOT IN ('sent', 'cancelled', 'expired');
CREATE INDEX report_draft_last_acted ON report_draft (last_acted_at) WHERE state NOT IN ('sent', 'cancelled', 'expired');
CREATE INDEX report_draft_ended ON report_draft (ended_at) WHERE ended_at IS NOT NULL;

CREATE TABLE draft_message (
  id integer PRIMARY KEY,
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  speaker text NOT NULL CHECK (speaker IN ('reporter', 'assistant')),
  text_masked text,
  copy_key text,
  -- The question an assistant line asked, beside its heading, so the history shows the question
  -- itself (a guided step's heading is only its progress).
  prompt_key text,
  params text CHECK (params IS NULL OR json_valid(params)),
  card_kind text,
  created_at text NOT NULL,
  UNIQUE (draft_id, seq),
  CHECK ((speaker = 'reporter') = (text_masked IS NOT NULL AND copy_key IS NULL))
);

CREATE TABLE turn_reply (
  draft_id text NOT NULL REFERENCES report_draft (id) ON DELETE CASCADE,
  turn_key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL CHECK (json_valid(body)),
  created_at text NOT NULL,
  PRIMARY KEY (draft_id, turn_key)
);
CREATE INDEX turn_reply_created ON turn_reply (created_at);
