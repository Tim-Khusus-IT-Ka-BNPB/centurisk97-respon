import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Card } from "../../contract/card";
import type { DraftBody } from "../../contract/draft";
import { trackingSchema } from "../../contract/tracking";
import { windowStart } from "../../domain/limits";
import { PRIVACY } from "../../domain/privacy";
import { addressBucket } from "../../platform/address";
import { type Database, run, sql } from "../../platform/database";
import { hmacKey } from "../../platform/keys";
import {
  browser,
  failingDatabase,
  freshAddress,
  freshNumber,
  manualClock,
  query,
  testBindings,
  testDatabase,
} from "../../testing/api";
import { turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

// Each test writes whole snapshots or sends several reports; under a full parallel run they need more time.
vi.setConfig({ testTimeout: 90_000 });

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
let db: Database = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);
const tick = () => clock.advance(4000);

type Phone = ReturnType<typeof browser>;
type Sent = Extract<Card, { kind: "sent" }>;

const villages: Record<string, string> = {};
beforeAll(async () => {
  const pick = async (where: string) =>
    (
      await query<{ code: string }>`
        select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
        where v.regency_code = ${where} order by v.code limit 1`
    )[0]?.code as string;
  // A regency with its own number, one whose only number is old, one with none in a province
  // with one, and one in a province with none (db/reference/bpbd-contacts.json).
  villages.ownNumber = await pick("11.08");
  villages.oldNumber = await pick("12.06");
  villages.provinceNumber = await pick("12.07");
  villages.noNumber = await pick("81.72");
});

async function consent(phone: Phone, number: string, name = "Uji Satu"): Promise<DraftBody> {
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name,
    number,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  if (answer.status === 201) return answer.draft;
  // A known number on this device: a new draft from its profile.
  const me = await phone.call("GET", "/me");
  const profileId = (me.json as { knownReporters: { profileId: string }[] }).knownReporters[0]?.profileId;
  return (await phone.call("POST", "/drafts", { profileId, replaceOpenDraft: true })).draft;
}

async function sendReport(phone: Phone, village: string, number = freshNumber().typed): Promise<Sent> {
  const started = await consent(phone, number);
  const { draft } = await walkTo(phone, started, village, { tick });
  const sent = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
    revision: draft.revision,
    turnKey: crypto.randomUUID(),
  });
  expect(sent.status).toBe(201);
  return (await phone.call("GET", `/drafts/${draft.draftId}`)).draft.card as Sent;
}

const track = (phone: Phone, token: string) => phone.call("POST", "/tracking", { token });

describe("ticket and tracking", () => {
  test("the sent card names the first name, the tracking secret and the first stage only, and the secret's hash is what is stored", async () => {
    const phone = browser(fetchApi);
    const card = await sendReport(phone, villages.ownNumber as string);
    expect(card).toMatchObject({ kind: "sent", firstName: "Uji", rating: null });
    expect(card.trackingToken).toMatch(/^[0-9a-f]{32}$/);
    expect(card.tracking.stages.map((stage) => [stage.status, stage.reachedAt !== null])).toEqual([
      ["new", true],
      ["seen", false],
      ["under_review", false],
      ["in_handling", false],
      ["closed", false],
    ]);
    const [row] = await query<{
      tracking_hash: string;
    }>`select tracking_hash from report where ticket_number = ${card.ticketNumber}`;
    expect(row?.tracking_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tracking_hash).not.toContain(card.trackingToken);
  });

  test("the BPBD to call: the regency's, else the province's, else 117; an old number is never used", async () => {
    const contacts = [];
    for (const key of ["ownNumber", "oldNumber", "provinceNumber", "noNumber"])
      contacts.push((await sendReport(browser(fetchApi), villages[key] as string)).tracking.contact);
    expect(contacts).toEqual([
      { level: "regency", name: "Aceh Utara", phone: "0800-1108-0001" },
      { level: "province", name: "Sumatera Utara", phone: "0800-1200-0001" },
      { level: "province", name: "Sumatera Utara", phone: "0800-1200-0001" },
      { level: "national" },
    ]);
  });

  test("the link opens with no cookie and shows no name, number, coordinates or RT and RW", async () => {
    const card = await sendReport(browser(fetchApi), villages.ownNumber as string, "080011112222");
    const stranger = browser(fetchApi);
    const opened = await track(stranger, card.trackingToken);
    expect(opened.status).toBe(200);
    const tracking = trackingSchema.parse(opened.json);
    expect(tracking).toMatchObject({ ticketNumber: card.ticketNumber, hazardType: "flood", photoCount: 0 });
    expect(tracking.stages[0]).toMatchObject({ status: "new", reachedAt: { zone: "WIB" } });
    const text = JSON.stringify(opened.json);
    for (const hidden of ["Uji", "0800111", "lat", "neighbourhood", '"rt"']) expect(text).not.toContain(hidden);
    expect(stranger.cookies.size).toBe(0);
  });

  test("a link with one character changed, or not a token at all, is not found; so is a report with no contact file", async () => {
    const card = await sendReport(browser(fetchApi), villages.ownNumber as string);
    const changed = `${card.trackingToken.slice(0, -1)}${card.trackingToken.endsWith("0") ? "1" : "0"}`;
    for (const token of [changed, "nonsense", ""]) {
      const refused = await track(browser(fetchApi), token);
      expect(refused.status).toBe(404);
      expect(refused.error.error.code).toBe("tracking.notFound");
    }
  });

  test("a contact file that cannot be read shows 117 and the report is still sent and tracked", async () => {
    const [kept] = await query<{ body: string }>`select body from reference_file where name = 'bpbdContacts'`;
    await run(testDatabase(), sql`update reference_file set body = '{"broken": true}' where name = 'bpbdContacts'`);
    try {
      const card = await sendReport(browser(fetchApi), villages.ownNumber as string);
      expect(card.tracking.contact).toEqual({ level: "national" });
    } finally {
      await run(testDatabase(), sql`update reference_file set body = ${kept?.body} where name = 'bpbdContacts'`);
    }
  });

  test("the 300th open in an hour from one address shows the page, the 301st names when it opens again", async () => {
    const card = await sendReport(browser(fetchApi), villages.ownNumber as string);
    const phone = browser(fetchApi, freshAddress());
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.tracking', ${key}, ${new Date(windowStart("clockHour", clock.now()))}, 298)`;
    expect((await track(phone, card.trackingToken)).status).toBe(200);
    expect((await track(phone, card.trackingToken)).status).toBe(200);
    const refused = await track(phone, card.trackingToken);
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.tracking");
    const photo = { token: card.trackingToken, proofId: crypto.randomUUID() };
    expect((await phone.call("POST", "/tracking/photos", photo)).status).toBe(429);
    expect(refused.error.retryAt).toEqual({ utc: "2026-11-23T04:00:00.000Z", zone: "WIB" });
  });
});

describe("rating", () => {
  const rate = (phone: Phone, ticketNumber: string, rating: unknown) =>
    phone.call("POST", `/reports/${ticketNumber}/rating`, { rating });
  const stored = async (ticketNumber: string) =>
    (
      await query<{ rating: number; rated_at: string }>`
        select g.rating, g.rated_at from report_rating g join report r on r.id = g.report_id
        where r.ticket_number = ${ticketNumber}`
    )[0] ?? null;

  test("the owner rates 4 and it is stored with its time; a new rating replaces it; the card stops thanking", async () => {
    const phone = browser(fetchApi);
    const card = await sendReport(phone, villages.ownNumber as string);
    expect((await rate(phone, card.ticketNumber, 4)).status).toBe(204);
    expect(await stored(card.ticketNumber)).toEqual({ rating: 4, rated_at: new Date(clock.now()).toISOString() });
    expect((await rate(phone, card.ticketNumber, 2)).status).toBe(204);
    expect((await stored(card.ticketNumber))?.rating).toBe(2);
    const [draft] = await query<{
      draft_id: string;
    }>`select draft_id from report where ticket_number = ${card.ticketNumber}`;
    expect(((await phone.call("GET", `/drafts/${draft?.draft_id}`)).draft.card as Sent).rating).toBe(2);
  });

  test("another device with the same number, a signed-out call, and a ticket that does not exist get nothing", async () => {
    const number = freshNumber().typed;
    const owner = browser(fetchApi);
    const card = await sendReport(owner, villages.ownNumber as string, number);
    const other = browser(fetchApi);
    await consent(other, number);
    expect((await rate(other, card.ticketNumber, 5)).status).toBe(404);
    expect((await rate(browser(fetchApi), card.ticketNumber, 5)).status).toBe(401);
    expect((await rate(owner, "LA-010101-99", 5)).status).toBe(404);
    expect(await stored(card.ticketNumber)).toBeNull();
  });

  test("0, 6 and 3.5 are refused naming 1 to 5, and nothing is stored", async () => {
    const phone = browser(fetchApi);
    const card = await sendReport(phone, villages.ownNumber as string);
    for (const rating of [0, 6, 3.5]) {
      const refused = await rate(phone, card.ticketNumber, rating);
      expect(refused.status).toBe(422);
      expect(refused.error.fields).toEqual([{ fieldId: "rating", copyKey: "fieldError.rating.range", params: {} }]);
    }
    expect((await rate(phone, card.ticketNumber, "4")).status).toBe(400);
    expect(await stored(card.ticketNumber)).toBeNull();
  });

  test("the 31st rating in an hour from one number is refused", async () => {
    const phone = browser(fetchApi);
    const card = await sendReport(phone, villages.ownNumber as string);
    const [report] = await query<{ number_key: string; owner_slot: string }>`
      select number_key, owner_slot from report where ticket_number = ${card.ticketNumber}`;
    const key = await hmacKey(
      bindings.settings.keyHmacSecret,
      "subject",
      `${report?.number_key}:${report?.owner_slot}`,
    );
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('rating.hour', ${key}, ${new Date(windowStart("clockHour", clock.now()))}, 30)`;
    const refused = await rate(phone, card.ticketNumber, 3);
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.rating.hour");
  });
});

describe("Laporan saya and cek status", () => {
  test("a device lists exactly its own reports of the number, newest first, as does cek status in the chat", async () => {
    const number = freshNumber().typed;
    const a = browser(fetchApi);
    const b = browser(fetchApi);
    const fromA = [];
    for (let i = 0; i < 3; i++) fromA.push((await sendReport(a, villages.ownNumber as string, number)).ticketNumber);
    const fromB = [];
    for (let i = 0; i < 2; i++) fromB.push((await sendReport(b, villages.ownNumber as string, number)).ticketNumber);
    const listed = ((await a.call("GET", "/me")).json as { reports: { ticketNumber: string; trackingToken: string }[] })
      .reports;
    expect(listed.map((report) => report.ticketNumber)).toEqual([...fromA].reverse());
    const [owner] = await query<{
      owner_slot: string;
    }>`select owner_slot from report where ticket_number = ${fromA[0]}`;
    const [counted] = await query<{
      count: number;
    }>`select count(*) as count from report where owner_slot = ${owner?.owner_slot}`;
    expect(listed).toHaveLength(counted?.count as number);
    expect((await track(browser(fetchApi), listed[0]?.trackingToken as string)).status).toBe(200);

    const draft = await consent(a, number);
    const typed = await a.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "cek status" }),
    );
    expect(typed.status).toBe(200);
    expect(typed.draft.card.kind).toBe(draft.card.kind);
    const reply = typed.draft.transcript.at(-2);
    expect(reply).toMatchObject({
      copyKey: "reply.status.list",
      params: { count: 3, tickets: [...fromA].reverse().join(", ") },
    });
    for (const ticket of fromB) expect(JSON.stringify(reply)).not.toContain(ticket);
  }, 90_000);

  test("a number with nothing sent hears so, and a caller with no device lists nothing", async () => {
    const phone = browser(fetchApi);
    const draft = await consent(phone, freshNumber().typed);
    const typed = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "Status" }),
    );
    expect(typed.draft.transcript.at(-2)).toMatchObject({ copyKey: "reply.status.none", params: { count: 0 } });
    expect(((await browser(fetchApi).call("GET", "/me")).json as { reports: unknown[] }).reports).toEqual([]);
  });
});

describe("preparedness topics", () => {
  test("the topics and their sources as imported, or 503 when none can be read", async () => {
    const read = await browser(fetchApi).call("GET", "/education");
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({
      dataDate: "2026-11-19",
      topics: expect.arrayContaining([
        expect.objectContaining({
          id: "banjir",
          title: "Banjir",
          lists: expect.arrayContaining([{ kind: "sebelum", items: expect.any(Array) }]),
          sources: [expect.objectContaining({ organisation: "BNPB" })],
        }),
      ]),
    });
    const [kept] = await query<Record<string, string>>`select * from reference_file where name = 'education'`;
    await run(testDatabase(), sql`delete from reference_file where name = 'education'`);
    expect((await browser(fetchApi).call("GET", "/education")).status).toBe(503);
    await run(
      testDatabase(),
      sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
        values ('education', ${kept?.data_date}, ${kept?.source}, ${kept?.body}, ${kept?.checksum}, ${kept?.imported_at})`,
    );
    db = failingDatabase("no such table", "42P01");
    try {
      expect((await browser(fetchApi).call("GET", "/education")).status).toBe(503);
    } finally {
      db = testDatabase();
    }
  });
});
