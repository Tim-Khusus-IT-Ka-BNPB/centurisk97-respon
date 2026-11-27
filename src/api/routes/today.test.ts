import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DeskReport, deskReportSchema } from "../../contract/desk";
import { type Today, todaySchema } from "../../contract/today";
import { windowStart } from "../../domain/limits";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import {
  browser,
  freshAddress,
  freshNumber,
  manualClock,
  query,
  testBindings,
  testDatabase,
  testEdgeStore,
} from "../../testing/api";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

// Far from the other files' clocks, so only this file's reports fall in the page's 24 hours.
const clock = manualClock("2027-02-10T03:00:00.000Z");
const open = testBindings({ TODAY_PAGE: "on" }, { clock }).bindings;
const shut = testBindings({}, { clock }).bindings;
const cached = testBindings({ TODAY_PAGE: "on" }, { clock, edge: testEdgeStore(clock) }).bindings;
const fetchWith = (bindings: ApiBindings) => (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const fetchApi = fetchWith(open);
const tick = () => clock.advance(4000);

const signedIn = (index: number, fetcher = fetchApi) => {
  const phone = browser(fetcher);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const DESK = 2;
const REGENCY = 3;
const PROVINCE = 4;

let aceh = "";
let sumut = "";
beforeAll(async () => {
  const village = async (regency: string) =>
    (
      await query<{ code: string }>`
        select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
        where v.regency_code like ${regency} order by v.code limit 1`
    )[0]?.code as string;
  [aceh, sumut] = await Promise.all([village("11.08"), village("12.%")]);
});

const sent = async (text: string, village = aceh) => {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed);
  const told = await phone.call("POST", `/drafts/${started.draftId}/turns`, turn(started, { kind: "freeText", text }));
  return sendDraft(phone, told.draft, village, { tick });
};
const read = async (ticket: string, index = DESK): Promise<DeskReport> =>
  deskReportSchema.parse((await signedIn(index).call("GET", `/desk/reports/${ticket}`)).json);
const checked = async (ticket: string, index: number, result = "valid") => {
  tick();
  const answer = await signedIn(index).call("POST", `/desk/reports/${ticket}/checks`, {
    result,
    note: "Dicek ke lokasi",
    boxes: {},
    revision: (await read(ticket, index)).revision,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
};
const pulled = async (ticket: string, pull: boolean) => {
  tick();
  return signedIn(REGENCY).call("POST", `/desk/reports/${ticket}/today`, { pulled: pull });
};
const page = async (search = "", fetcher = fetchApi): Promise<Today> => {
  const answer = await browser(fetcher).call("GET", `/today${search}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return todaySchema.parse(answer.json);
};
const regencyOf = async (village: string) =>
  (await query<{ name: string }>`select name from place_regency where code = ${village.slice(0, 5)} limit 1`)[0]
    ?.name as string;

describe("the today page", () => {
  test("is shut unless its switch is on, on the page and on the desk", async () => {
    const ticket = await sent("banjir");
    const answer = await browser(fetchWith(shut)).call("GET", "/today");
    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({ error: { code: "today.closed" } });
    expect(
      deskReportSchema.parse((await signedIn(DESK, fetchWith(shut)).call("GET", `/desk/reports/${ticket}`)).json),
    ).toMatchObject({ today: null });
    const pull = await signedIn(DESK, fetchWith(shut)).call("POST", `/desk/reports/${ticket}/today`, { pulled: true });
    expect(pull.status).toBe(404);
  });

  test("shows a report once the BPBD of its own region calls it valid, with nothing of who sent it", async () => {
    const ticket = await sent("banjir, tiga orang meninggal");
    expect((await read(ticket)).today).toEqual({
      conditions: { valid: false, bpbd: false, ticket: true, version: true, pull: true },
      shown: false,
    });
    await checked(ticket, DESK);
    expect((await read(ticket)).today).toMatchObject({ conditions: { valid: true, bpbd: false }, shown: false });
    expect((await page()).events).toEqual([]);

    await checked(ticket, REGENCY);
    expect((await read(ticket)).today).toMatchObject({ conditions: { valid: true, bpbd: true }, shown: true });
    const [card] = (await page()).events;
    expect(card).toMatchObject({
      hazardType: "flood",
      reporters: null,
      verifiedBy: { level: "regency", name: await regencyOf(aceh) },
      impact: { dead: { min: 3, max: 3 } },
    });
    expect(JSON.stringify(card)).not.toContain(ticket);
    expect(Number.isInteger((card?.centre?.lat as number) * 1e4)).toBe(true);

    expect((await pulled(ticket, true)).status).toBe(200);
    expect((await read(ticket)).today).toMatchObject({ conditions: { pull: false }, shown: false });
    expect((await page()).events).toEqual([]);
    expect((await pulled(ticket, false)).status).toBe(200);
    expect((await page()).events).toHaveLength(1);

    clock.advance(24 * 3_600_000);
    expect((await page()).events).toEqual([]);
  });

  test("gives one card per event, its figures a range and its reporters counted", async () => {
    const [first, second] = [await sent("banjir, dua orang meninggal"), await sent("banjir, lima orang meninggal")];
    await checked(first, REGENCY);
    await checked(second, REGENCY);
    const { events } = await page();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reporters: 2, impact: { dead: { min: 2, max: 5 } } });
    expect((await pulled(first, true)).status).toBe(200);
    expect((await page()).events).toEqual([]);
    expect((await pulled(first, false)).status).toBe(200);
  });

  test("names the province as the checker, and filters by province and hazard", async () => {
    const ticket = await sent("tanah longsor", sumut);
    await checked(ticket, PROVINCE);
    expect((await page("?province=12")).events).toEqual([
      expect.objectContaining({ hazardType: "landslide", verifiedBy: expect.objectContaining({ level: "province" }) }),
    ]);
    expect((await page()).events.map((event) => event.hazardType)).toEqual(["landslide", "flood"]);
    expect((await page("?province=12&hazard=flood")).events).toEqual([]);
    expect((await page("?hazard=landslide")).events).toHaveLength(1);
    expect((await browser(fetchApi).call("GET", "/today?kota=1")).status).toBe(400);
  });

  test("leaves out what is not known: the kind's detail, the time, and a village with no outline", async () => {
    clock.advance(24 * 3_600_000);
    const ticket = await sent("banjir");
    await checked(ticket, REGENCY);
    // Versions are append-only; this file's own database lets one be written as an older report's was.
    await query`drop trigger report_version_no_update`;
    await query`update report_version set fields = json_set(fields,
        '$.hazardSubtype', json('{"state":"value","value":"unknown"}'), '$.eventTime', json('{"state":"unknown"}'))
      where report_id = (select id from report where ticket_number = ${ticket})`;
    await query`delete from place_village_shape where code = ${aceh}`;
    expect((await page()).events).toEqual([
      expect.objectContaining({ hazardSubtype: null, eventTime: null, centre: null }),
    ]);
  });

  test("refuses an address that opens it too often", async () => {
    const phone = browser(fetchApi, freshAddress());
    const key = await hmacKey(open.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.feed', ${key}, ${new Date(windowStart("clockHour", clock.now()))}, 600)`;
    const refused = await phone.call("GET", "/today");
    expect(refused.status).toBe(429);
    expect(refused.json).toMatchObject({ error: { code: "limit.address.feed" } });
  });

  test("is kept a minute for everyone at the edge", async () => {
    clock.advance(24 * 3_600_000);
    const ticket = await sent("banjir");
    await checked(ticket, REGENCY);
    const fetcher = fetchWith(cached);
    expect((await page("", fetcher)).events).toHaveLength(1);
    expect((await pulled(ticket, true)).status).toBe(200);
    expect((await page("", fetcher)).events).toHaveLength(1);
    clock.advance(61_000);
    expect((await page("", fetcher)).events).toEqual([]);
  });
});
