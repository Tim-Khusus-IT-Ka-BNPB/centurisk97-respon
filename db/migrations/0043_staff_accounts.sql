-- Staff who signed in through auth (centurisk97-auth), as their last sign-in described them. The id
-- is auth's subject; the role and region come from their memberships claim. BPBD officers with a
-- phone are the officers a BNPB officer may call about a report in their region.
CREATE TABLE staff_member (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  name text NOT NULL,
  position text NOT NULL,
  agency text NOT NULL,
  phone text,
  role text NOT NULL CHECK (role IN ('deskOfficer', 'regionalOfficer')),
  scope_level text NOT NULL CHECK (scope_level IN ('national', 'province', 'regency')),
  scope_code text,
  signed_in_at text NOT NULL,
  CHECK ((scope_level = 'national') = (scope_code IS NULL))
);
CREATE INDEX staff_member_scope ON staff_member (role, scope_level, scope_code);

-- A desk sign-in. Only a fingerprint of the cookie's token is kept.
CREATE TABLE staff_session (
  token_hash text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_member (id) ON DELETE CASCADE,
  expires_at text NOT NULL
);
CREATE INDEX staff_session_expiry ON staff_session (expires_at);
