import { describe, expect, test } from "vitest";
import { type Database, row, rows, run, sql } from "../src/platform/database.ts";
import { sha256Hex } from "../src/platform/keys.ts";
import { COLUMN_CLASSES } from "./columnClasses.ts";
import { SEEDED_SESSIONS } from "./synthetic/reporters.ts";

// Runs against this file's migrated and seeded in-memory D1 database (db/testDatabase.ts).
const db = (globalThis as { testD1?: Database }).testD1 as Database;
const NOW = "2026-11-23T03:00:00.000Z";

// What the database said to a write: ok, or the kind of rule that refused it.
async function refusal(text: ReturnType<typeof sql>): Promise<string> {
  try {
    await run(db, text);
    return "ok";
  } catch (error) {
    const message = String((error as Error).message);
    for (const rule of ["UNIQUE", "CHECK", "FOREIGN KEY", "append-only"]) if (message.includes(rule)) return rule;
    return message;
  }
}

async function reporterRow(numberKey: string): Promise<string> {
  const id = crypto.randomUUID();
  await run(
    db,
    sql`insert into reporter (id, number, number_key, created_at) values (${id}, '+6280000000009', ${numberKey}, ${NOW})`,
  );
  return id;
}

describe("schema", () => {
  test("every column has a class and every table a retention rule", async () => {
    const found = await rows<{ table_name: string; column_name: string }>(
      db,
      sql`select m.name as table_name, p.name as column_name
        from sqlite_master m join pragma_table_info(m.name) p
        where m.type = 'table' and m.name not like 'sqlite_%' and m.name not like '_cf_%' and m.name not like 'd1_%'`,
    );
    const tables: Record<string, string[]> = {};
    for (const one of found) tables[one.table_name] = [...(tables[one.table_name] ?? []), one.column_name];
    expect(Object.keys(tables).sort()).toEqual(Object.keys(COLUMN_CLASSES).sort());
    for (const [table, columns] of Object.entries(tables)) {
      expect(columns.sort(), table).toEqual(Object.keys(COLUMN_CLASSES[table]?.columns ?? {}).sort());
      expect(COLUMN_CLASSES[table]?.retention).not.toBe("");
    }
  });

  test("sent versions and ticket history cannot be changed or removed, nor a report under them", async () => {
    const reporterId = await reporterRow("k-append");
    const draftId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const ticket = "LA-231126-01";
    await run(
      db,
      sql`insert into report_draft (id, reporter_id, owner_slot, state, created_at, last_acted_at, ended_at)
        values (${draftId}, ${reporterId}, 'session', 'sent', ${NOW}, ${NOW}, ${NOW})`,
    );
    await run(
      db,
      sql`insert into report (id, ticket_number, draft_id, reporter_id, number_key, owner_slot, number_unverified,
          hazard_type, village_code, district_code, regency_code, province_code, sent_at)
        values (${reportId}, ${ticket}, ${draftId}, ${reporterId}, 'k-append', 'session', 0, 'flood',
          '11.08.01.2001', '11.08.01', '11.08', '11', ${NOW})`,
    );
    await run(
      db,
      sql`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
          privacy_version, consent_agreed_at, complete_percent, created_at)
        values (${reportId}, 1, '{}', 'Uji Satu', '+6280000000009', 'citizen', 1, ${NOW}, 40, ${NOW})`,
    );
    await run(
      db,
      sql`insert into ticket (ticket_number, report_id, status, updated_at) values (${ticket}, ${reportId}, 'new', ${NOW})`,
    );
    await run(
      db,
      sql`insert into ticket_history (ticket_number, to_status, actor, at) values (${ticket}, 'new', 'system', ${NOW})`,
    );
    expect(await refusal(sql`update report_version set complete_percent = 41`)).toBe("append-only");
    expect(await refusal(sql`delete from report_version`)).toBe("append-only");
    expect(await refusal(sql`update ticket_history set note = 'x'`)).toBe("append-only");
    expect(await refusal(sql`delete from ticket_history`)).toBe("append-only");
    expect(await refusal(sql`delete from report where id = ${reportId}`)).toBe("FOREIGN KEY");
    // A staff row names its officer; a system row names none.
    const history = (actor: string, id: string | null, label: string | null) =>
      sql`insert into ticket_history (ticket_number, to_status, actor, actor_id, actor_label, at)
        values (${ticket}, 'seen', ${actor}, ${id}, ${label}, ${NOW})`;
    expect(await refusal(history("staff", null, null))).toBe("CHECK");
    expect(await refusal(history("system", "s1", "Uji"))).toBe("CHECK");
    expect(await refusal(history("staff", "s1", "Uji"))).toBe("ok");
    const action = (name: string) =>
      sql`insert into staff_action (ticket_number, staff_id, staff_label, staff_kind, action, at)
        values (${ticket}, 's1', 'Uji', 'deskOfficer', ${name}, ${NOW})`;
    expect(await refusal(action("delete"))).toBe("CHECK");
    expect(await refusal(action("view"))).toBe("ok");
    expect(await refusal(sql`update staff_action set action = 'status'`)).toBe("append-only");
    expect(await refusal(sql`delete from staff_action`)).toBe("append-only");
    const reply = (text: string) =>
      sql`insert into report_reply (ticket_number, staff_id, staff_label, text, at)
        values (${ticket}, 's1', 'Uji', ${text}, ${NOW})`;
    expect(await refusal(reply(""))).toBe("CHECK");
    expect(await refusal(reply("a".repeat(1001)))).toBe("CHECK");
    expect(await refusal(reply("Kami cek"))).toBe("ok");
    expect(await refusal(sql`update report_reply set text = 'x'`)).toBe("append-only");
    expect(await refusal(sql`delete from report_reply`)).toBe("append-only");
  });

  test("one open draft per number and slot, enforced by the database", async () => {
    const reporterId = await reporterRow("k-open");
    const draft = (state: string, fields: string | null, ended: string | null) =>
      sql`insert into report_draft (id, reporter_id, owner_slot, state, fields, created_at, last_acted_at, ended_at)
        values (${crypto.randomUUID()}, ${reporterId}, 'session', ${state}, ${fields}, ${NOW}, ${NOW}, ${ended})`;
    expect(await refusal(draft("place", null, null))).toBe("ok");
    expect(await refusal(draft("asking", null, null))).toBe("UNIQUE");
    expect(await refusal(draft("cancelled", null, NOW))).toBe("ok");
    // A final draft holds no personal content.
    expect(await refusal(draft("expired", "{}", NOW))).toBe("CHECK");
  });

  test("stored values the schema refuses", async () => {
    const number = (value: string) =>
      sql`insert into reporter (id, number, number_key, created_at) values (${crypto.randomUUID()}, ${value}, ${crypto.randomUUID()}, ${NOW})`;
    expect(await refusal(number("080000000001"))).toBe("CHECK");
    expect(await refusal(number("+628000000"))).toBe("CHECK");
    expect(await refusal(number("+62800000000a"))).toBe("CHECK");
    expect(await refusal(sql`insert into ticket_day_counter (wib_date, last_n) values ('2026-11-23', 0)`)).toBe(
      "CHECK",
    );
    expect(await refusal(sql`insert into batch_guard (ok) values (0)`)).toBe("CHECK");
    expect(
      await refusal(sql`insert into report_draft (id, reporter_id, owner_slot, state, fields, created_at, last_acted_at)
      values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'x', 'place', 'not json', ${NOW}, ${NOW})`),
    ).toBe("CHECK");
  });

  test("place codes keep their shape", async () => {
    const regency = (code: string) =>
      sql`insert into place_regency (snapshot_id, code, name, province_code, province_name, village_count, search_text)
        values ((select id from place_snapshot where active = 1), ${code}, 'Uji', '11', 'Aceh', 0, 'uji')`;
    expect(await refusal(regency("1.081"))).toBe("CHECK");
    expect(await refusal(regency("99.99"))).toBe("ok");
    const village = (code: string) =>
      sql`insert into place_village (snapshot_id, code, name, district_name, regency_code, regency_name, province_code,
          province_name, search_text)
        values ((select id from place_snapshot where active = 1), ${code}, 'Uji', 'Uji', '99.99', 'Uji', '11', 'Aceh', 'uji')`;
    expect(await refusal(village("99.99.01.2001"))).toBe("ok");
    expect(await refusal(village("99.99.012.001"))).toBe("CHECK");
    expect(await refusal(village("99.99.01.200a"))).toBe("CHECK");
  });
});

describe("seed", () => {
  test("the pinned villages hold what the tests need", async () => {
    const counts = await row(
      db,
      sql`select
        (select count(*) from place_snapshot where active = 1) as active,
        (select count(*) from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
          where v.search_text like '%sukamaju%') as sukamaju,
        (select count(*) from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
          where v.province_code in ('81', '82', '91', '92', '93', '94', '95', '96')) as wit,
        (select data_date from place_snapshot where active = 1) as data_date`,
    );
    expect(counts).toEqual({ active: 1, sukamaju: 71, wit: 31, data_date: "2026-10-25" });
    const largest = await row(
      db,
      sql`select r.code, r.village_count from place_regency r join place_snapshot s on s.id = r.snapshot_id and s.active = 1
        order by r.village_count desc limit 1`,
    );
    expect(largest).toEqual({ code: "11.08", village_count: 844 });
  });

  test("seeded sessions are stored by fingerprint only", async () => {
    const sessions = await rows<{ token_hash: string; kind: string }>(
      db,
      sql`select token_hash, kind from seeded_session order by kind`,
    );
    const expected = await Promise.all(SEEDED_SESSIONS.map(async (session) => sha256Hex(session.token)));
    expect(sessions.map((one) => one.token_hash).sort()).toEqual(expected.sort());
    const tokens: string[] = SEEDED_SESSIONS.map((session) => session.token);
    expect(sessions.some((one) => tokens.includes(one.token_hash))).toBe(false);
  });
});
