import { type Database, row, run, sql } from "../../src/platform/database.ts";
import { hmacKey, sha256Hex } from "../../src/platform/keys.ts";
import { SEEDED_SESSIONS, SYNTHETIC_REPORTERS } from "../synthetic/reporters.ts";

// Seeded identities for the seeded identity adapter: reporter rows for the session numbers and
// the session rows themselves. Safe to run again.
export default async function seedIdentities(db: Database): Promise<void> {
  const secret = process.env.KEY_HMAC_SECRET;
  if (!secret) throw new Error("Setting KEY_HMAC_SECRET is missing. It must equal the one in .dev.vars.");
  for (const session of SEEDED_SESSIONS) {
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
      sql`insert into seeded_session (token_hash, kind, reporter_id, staff_role)
        values (${await sha256Hex(session.token)}, ${session.kind}, ${reporterId}, ${session.staffRole})
        on conflict (token_hash) do nothing`,
    );
  }
}
