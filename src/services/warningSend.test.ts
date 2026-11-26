import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../db/synthetic/reporters";
import { api } from "../api/app";
import type { ApiBindings } from "../api/context";
import { warningControlSchema } from "../contract/warnings";
import { run, sql } from "../platform/database";
import { browser, manualClock, query, testBindings, testDatabase } from "../testing/api";
import { phone, vapidKeys } from "../testing/push";
import { messageOf, PER_RUN, sendWarnings } from "./warningSend";

vi.setConfig({ testTimeout: 60_000 });

// 26 November, 10.00 WIB: the seeded outlook, made at 06.00, is fresh.
const clock = manualClock("2026-11-26T03:00:00.000Z");
let bindings: ApiBindings;
let target = { p256dh: "", auth: "" };
beforeAll(async () => {
  const keys = await vapidKeys();
  bindings = testBindings(
    { PUSH_PUBLIC_KEY: keys.publicKey, PUSH_PRIVATE_KEY: keys.privateKey, PUSH_SUBJECT: keys.subject },
    { clock },
  ).bindings;
  const own = await phone();
  target = { p256dh: own.target.p256dh, auth: own.target.auth };
});

// Phones of Kab. Bogor alone: the warnings route test keeps its phones in Aceh Utara.
const PREFIX = "https://fcm.googleapis.com/fcm/send/kirim-";
const addPhone = (name: string, hazards: number, threshold: number, district = "32.01.01") =>
  run(
    testDatabase(),
    sql`insert into warning_subscription (endpoint, p256dh, auth, district_code, regency_code, district_name, hazards,
        threshold, created_at)
      values (${PREFIX + name}, ${target.p256dh}, ${target.auth}, ${district}, '32.01', 'Uji', ${hazards}, ${threshold},
        '2026-11-26T00:00:00.000Z')`,
  );

// A push service that answers each phone by its name's status, and keeps what it was handed.
const handed: Request[] = [];
const service = async (request: Request) => {
  handed.push(request);
  const status = Number(/-(\d{3})$/.exec(request.url)?.[1] ?? 201);
  if (status === 599) throw new TypeError("network lost");
  return new Response(null, { status });
};
const mine = () => handed.map((request) => request.url).filter((url) => url.startsWith(PREFIX));

const reset = async () => {
  handed.length = 0;
  const db = testDatabase();
  await run(db, sql`delete from warning_sent`);
  await run(db, sql`delete from warning_subscription where endpoint like ${`${PREFIX}%`}`);
};
afterEach(reset);

const desk = () => {
  const officer = browser((request) => api.app.fetch(request, { ...bindings, db: testDatabase() }));
  officer.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
  return officer;
};
const regional = () => {
  const officer = browser((request) => api.app.fetch(request, { ...bindings, db: testDatabase() }));
  officer.cookies.set("seeded_session", (SEEDED_SESSIONS[3] as { token: string }).token);
  return officer;
};

describe("sending the warnings", () => {
  test("each phone hears once of its own rise; gone phones are dropped; the same rise is not sent again", async () => {
    await reset();
    await addPhone("all", 15, 1);
    await addPhone("all", 15, 1, "32.01.02");
    await addPhone("floodAwas", 1, 3);
    await addPhone("slideSiaga", 2, 3);
    await addPhone("gone-410", 15, 1);
    await addPhone("lost-404", 15, 1);
    await addPhone("broken-500", 15, 1);
    await addPhone("cut-599", 15, 1);
    const counts = await sendWarnings(bindings, service);
    expect(mine().sort()).toEqual(
      ["all", "broken-500", "cut-599", "floodAwas", "gone-410", "lost-404"].map((name) => PREFIX + name),
    );
    expect(counts.gone).toBeGreaterThanOrEqual(2);
    expect(counts.failed).toBeGreaterThanOrEqual(2);
    expect(
      await query`select 1 from warning_subscription where endpoint in (${`${PREFIX}gone-410`}, ${`${PREFIX}lost-404`})`,
    ).toEqual([]);
    expect(
      await query`select hazard, date, level from warning_sent where regency_code = '32.01' order by hazard, date`,
    ).toEqual([
      { hazard: "BNJ", date: "2026-11-28", level: 3 },
      { hazard: "LSR", date: "2026-11-27", level: 1 },
      { hazard: "LSR", date: "2026-11-28", level: 2 },
    ]);
    const request = handed.find((one) => one.url === `${PREFIX}all`) as Request;
    expect(request.headers.get("content-encoding")).toBe("aes128gcm");
    handed.length = 0;
    await sendWarnings(bindings, service);
    expect(mine()).toEqual([]);
  });

  test("the message names the level, the hazard and the regency, says it is not BMKG's, and opens Info daerah", () => {
    expect(
      messageOf({ regencyCode: "32.01", regencyName: "Kab. Bogor", hazard: "BNJ", date: "2026-11-28", level: 3 }),
    ).toEqual({
      title: "Prakiraan Awas banjir di Kab. Bogor",
      body: "Sabtu, 28 November. Prakiraan Pantau Bencana, bukan peringatan resmi BMKG. Buka untuk melihat yang perlu disiapkan dan nomor darurat.",
      url: "/lapor/info?kab=32.01",
    });
  });

  test("nothing goes with no push keys, or with no outlook to read", async () => {
    await reset();
    await addPhone("all", 15, 1);
    const shut = testBindings({}, { clock }).bindings;
    expect(await sendWarnings(shut, service)).toEqual({ sent: 0, gone: 0, failed: 0 });
    const db = testDatabase();
    const [kept] = await query<Record<string, string>>`select * from reference_file where name = 'forecast'`;
    await run(db, sql`delete from reference_file where name = 'forecast'`);
    try {
      expect(await sendWarnings(bindings, service)).toEqual({ sent: 0, gone: 0, failed: 0 });
    } finally {
      await run(
        db,
        sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
          values ('forecast', ${kept?.data_date}, ${kept?.source}, ${kept?.body}, ${kept?.checksum}, ${kept?.imported_at})`,
      );
    }
    expect(mine()).toEqual([]);
  });

  test(`at most ${PER_RUN} phones a run: the regencies left wait for the next run`, async () => {
    await reset();
    await run(
      testDatabase(),
      sql`with recursive k(i) as (select 1 union all select i + 1 from k where i < ${PER_RUN})
        insert into warning_subscription (endpoint, p256dh, auth, district_code, regency_code, district_name, hazards,
          threshold, created_at)
        select ${PREFIX} || 'aceh-' || i, ${target.p256dh}, ${target.auth}, '11.08.01', '11.08', 'Uji', 15, 1,
          '2026-11-26T00:00:00.000Z' from k`,
    );
    await addPhone("bogor", 15, 1);
    await sendWarnings(bindings, service);
    expect(mine()).not.toContain(`${PREFIX}bogor`);
    expect(await query`select 1 from warning_sent where regency_code = '32.01'`).toEqual([]);
    handed.length = 0;
    await sendWarnings(bindings, service);
    expect(mine()).toEqual([`${PREFIX}bogor`]);
  });
});

describe("the desk's pause", () => {
  test("an officer pauses: the next run sends nothing; resumed, it sends", async () => {
    await reset();
    await addPhone("all", 15, 1);
    const before = await desk().call("GET", "/desk/warnings");
    expect(warningControlSchema.parse(before.json)).toMatchObject({ open: true, phones: expect.any(Number) });
    const paused = await desk().call("POST", "/desk/warnings", { paused: true });
    expect(paused.status).toBe(200);
    expect(paused.json).toMatchObject({
      paused: true,
      by: "Pusdalops BNPB, Petugas Uji",
      at: "2026-11-26T03:00:00.000Z",
    });
    try {
      expect(await sendWarnings(bindings, service)).toEqual({ sent: 0, gone: 0, failed: 0 });
      expect((await desk().call("GET", "/desk/warnings")).json).toMatchObject({ paused: true });
    } finally {
      expect((await desk().call("POST", "/desk/warnings", { paused: false })).json).toMatchObject({ paused: false });
    }
    await sendWarnings(bindings, service);
    expect(mine()).toEqual([`${PREFIX}all`]);
  });

  test("a regional officer may not, and with no push keys the desk says warnings are shut", async () => {
    expect((await regional().call("GET", "/desk/warnings")).status).toBe(403);
    expect((await regional().call("POST", "/desk/warnings", { paused: true })).status).toBe(403);
    const shut = browser((request) =>
      api.app.fetch(request, { ...testBindings({}, { clock }).bindings, db: testDatabase() }),
    );
    shut.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
    expect((await shut.call("GET", "/desk/warnings")).json).toMatchObject({ open: false });
  });
});
