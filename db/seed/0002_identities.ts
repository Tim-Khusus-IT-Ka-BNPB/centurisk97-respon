import { type Database, row, run, sql } from "../../src/platform/database.ts";
import { hmacKey, sha256Hex } from "../../src/platform/keys.ts";
import { SEEDED_SESSIONS, SYNTHETIC_REPORTERS } from "../synthetic/reporters.ts";

// Seeded identities for the seeded identity adapter: reporter rows for the session numbers and
// the session rows themselves. Safe to run again.
export default async function seedIdentities(db: Database): Promise<void> {
  const secret = process.env.KEY_HMAC_SECRET;
  if (!secret) throw new Error("Setting KEY_HMAC_SECRET is missing. It must equal the one in .dev.vars.");
  for (const session of SEEDED_SESSIONS) {
    const staff = session.staff as (typeof SEEDED_SESSIONS)[number]["staff"];
    let reporterId: string | null = null;
    if (session.reporter !== null) {
      const reporter = SYNTHETIC_REPORTERS.find((candidate) => candidate.label === session.reporter);
      if (!reporter) throw new Error(`No synthetic reporter ${session.reporter}`);
      const numberKey = await hmacKey(secret, "number", reporter.stored);
      const stored = await row<{ id: string }>(
        db,
        sql`insert into reporter (id, number, number_key, created_at)
          values (${crypto.randomUUID()}, ${reporter.stored}, ${numberKey}, ${new Date()})
          on conflict (number_key) do update set number = excluded.number
          returning id`,
      );
      reporterId = (stored as { id: string }).id;
    }
    await run(
      db,
      sql`insert into seeded_session (token_hash, kind, reporter_id, staff_role, staff_id, staff_label, scope_level, scope_code,
          profile_id, profile_name, profile_position, agency)
        values (${await sha256Hex(session.token)}, ${session.kind}, ${reporterId}, ${staff?.role ?? null}, ${staff?.id ?? null},
          ${staff?.label ?? null}, ${staff === null ? null : (staff.scope?.level ?? "national")}, ${staff?.scope?.code ?? null},
          ${staff?.profile?.id ?? null}, ${staff?.profile?.name ?? null}, ${staff?.profile?.position ?? null},
          ${staff?.profile?.agency ?? null})
        on conflict (token_hash) do update set staff_role = excluded.staff_role, staff_id = excluded.staff_id,
          staff_label = excluded.staff_label, scope_level = excluded.scope_level, scope_code = excluded.scope_code, profile_id = excluded.profile_id,
          profile_name = excluded.profile_name, profile_position = excluded.profile_position, agency = excluded.agency`,
    );
  }
}
