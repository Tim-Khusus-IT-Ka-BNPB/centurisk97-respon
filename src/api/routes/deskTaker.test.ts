import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskQueueSchema, deskReportSchema, deskResponseSchema, deskSummarySchema } from "../../contract/desk";
import { trackingToken } from "../../services/tracking";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

type Phone = ReturnType<typeof browser>;
const signedIn = (index: number): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const desk = () => signedIn(2);
// Two officers behind one BPBD account, and an account with no profile of its own.
const andi = () => signedIn(3);
const budi = () => signedIn(5);
const province = () => signedIn(4);
const ANDI = "Uji Andi, Pusdalops BPBD Kabupaten Uji Satu";

let village = "";
let provinceVillage = "";
const villageIn = async (prefix: string) =>
  (
    await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
      where v.code like ${`${prefix}%`} order by v.code limit 1`
  )[0]?.code as string;
beforeAll(async () => {
  village = await villageIn("11.08");
  provinceVillage = await villageIn("12.");
});

const sentReport = async (place = village) => {
  const phone = browser(fetchApi);
  return sendDraft(phone, await startDraft(phone, freshNumber().typed), place, { tick });
};
const read = async (phone: Phone, ticket: string) =>
  deskReportSchema.parse((await phone.call("GET", `/desk/reports/${ticket}`)).json);
const take = (phone: Phone, ticket: string) => phone.call("POST", `/desk/reports/${ticket}/take`);

describe("a report taken in hand", () => {
  test("names its officer on the desk, once, its status as it was, and never to the reporter", async () => {
    const ticket = await sentReport();
    expect((await read(andi(), ticket)).mayTake).toBe(true);
    const answer = await take(andi(), ticket);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const report = deskReportSchema.parse(answer.json);
    expect(report).toMatchObject({ status: "new", taker: ANDI, mayTake: false });
    expect(report.history.at(-1)).toMatchObject({ status: "new", event: "take", detail: { taker: ANDI } });
    const queue = deskQueueSchema.parse((await desk().call("GET", `/desk/reports?ticket=${ticket}`)).json);
    expect(queue.items[0]?.taker).toBe(ANDI);
    expect(
      await query`select from_status, to_status from ticket_history where ticket_number = ${ticket} and event = 'take'`,
    ).toEqual([{ from_status: "new", to_status: "new" }]);
    expect(await query`select action from staff_action where ticket_number = ${ticket}`).toEqual([{ action: "take" }]);
    const [row] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    const token = await trackingToken(bindings.settings.keyHmacSecret, row?.id as string);
    expect(JSON.stringify((await browser(fetchApi).call("POST", "/tracking", { token })).json)).not.toContain(
      "Uji Andi",
    );
  });

  test("is told to a second officer, also when both take it at once", async () => {
    const ticket = await sentReport();
    const both = await Promise.all([take(andi(), ticket), take(budi(), ticket)]);
    expect(both.map((one) => one.status).sort()).toEqual([200, 409]);
    const late = both.find((one) => one.status === 409);
    expect(late?.error.error.code).toBe("ticket.taken");
    expect(late?.error.error.params.taker).toMatch(/^Uji (Andi|Budi), /);
    expect((await take(andi(), ticket)).error.error.code).toBe("ticket.taken");
    expect(await query`select 1 from report_taker where ticket_number = ${ticket}`).toHaveLength(1);
  });

  test("is not for one closed or set aside, and one being opened is taken all the same", async () => {
    const ticket = await sentReport();
    await desk().call("POST", `/desk/reports/${ticket}/view`);
    const aside = await desk().call("POST", `/desk/reports/${ticket}/status`, {
      to: "invalid",
      note: "Laporan ganda",
      revision: 1,
    });
    expect(aside.status).toBe(200);
    expect((await read(andi(), ticket)).mayTake).toBe(false);
    expect((await take(andi(), ticket)).error.error.code).toBe("ticket.transitionRefused");
    // One opened while it is being taken is taken all the same, at whichever status it is in.
    const other = await sentReport();
    const [taken, viewed] = await Promise.all([
      take(andi(), other),
      desk().call("POST", `/desk/reports/${other}/view`),
    ]);
    expect([taken.status, viewed.status]).toEqual([200, 200]);
  });

  test("is for an officer with a profile, in their own region", async () => {
    const ticket = await sentReport();
    expect((await take(desk(), ticket)).error.error.code).toBe("desk.notAllowed");
    expect((await read(desk(), ticket)).mayTake).toBe(false);
    const elsewhere = await sentReport(provinceVillage);
    expect((await read(province(), elsewhere)).mayTake).toBe(false);
    expect((await take(province(), elsewhere)).error.error.code).toBe("desk.notAllowed");
    expect((await take(andi(), elsewhere)).status).toBe(404);
    expect((await take(browser(fetchApi), ticket)).status).toBe(401);
  });
});

describe("how fast each agency answers", () => {
  test("is the month's reports by regency, said only from 5 of them, for desk officers alone", async () => {
    const before = deskResponseSchema.parse((await desk().call("GET", "/desk/response?month=2026-11")).json);
    const count = before.agencies.find((one) => one.regencyCode === "11.08")?.reports ?? 0;
    for (let n = count; n < 5; n += 1) await sentReport();
    const response = deskResponseSchema.parse((await desk().call("GET", "/desk/response")).json);
    expect(response.month).toBe("2026-11");
    const own = response.agencies.find((one) => one.regencyCode === "11.08");
    expect(own?.regencyName).toBe("Aceh Utara");
    expect(own?.figures).toMatchObject({ taken: { count: expect.any(Number) }, dropped: 0 });
    const few = response.agencies.find((one) => one.regencyCode.startsWith("12."));
    expect(few?.figures ?? null).toBeNull();
    const names = response.agencies.map((one) => one.regencyName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "id")));
    const empty = deskResponseSchema.parse((await desk().call("GET", "/desk/response?month=2026-10")).json);
    expect(empty.agencies).toEqual([]);
    expect((await desk().call("GET", "/desk/response?month=november")).status).toBe(400);
    expect((await andi().call("GET", "/desk/response")).error.error.code).toBe("desk.notAllowed");
    const may = async (phone: Phone) =>
      deskSummarySchema.parse((await phone.call("GET", "/desk/summary")).json).mayReadResponse;
    expect([await may(desk()), await may(andi())]).toEqual([true, false]);
  });

  test("counts a report opened only when the BPBD of its own regency opens it, even after BNPB did; how easy reporting was is beside it", async () => {
    clock.set(Date.parse("2026-12-02T03:00:00.000Z"));
    const own: string[] = [];
    const elsewhere: string[] = [];
    for (let n = 0; n < 5; n += 1) own.push(await sentReport());
    for (let n = 0; n < 5; n += 1) elsewhere.push(await sentReport(provinceVillage));
    clock.advance(10 * 60_000);
    for (const ticket of [...own, ...elsewhere]) await desk().call("POST", `/desk/reports/${ticket}/view`);
    for (const ticket of elsewhere) await province().call("POST", `/desk/reports/${ticket}/view`);
    clock.advance(20 * 60_000);
    for (const ticket of own.slice(0, 3)) await andi().call("POST", `/desk/reports/${ticket}/view`);
    for (const [index, rating] of [5, 4, 4, 3, 2].entries())
      await query`insert into report_rating (report_id, rating, rated_at)
        select id, ${rating}, sent_at from report where ticket_number = ${own[index]}`;
    const response = deskResponseSchema.parse((await desk().call("GET", "/desk/response?month=2026-12")).json);
    const figures = (code: string) => response.agencies.find((one) => one.regencyCode === code)?.figures;
    expect(figures("11.08")).toMatchObject({ seen: { count: 3 }, notSeen: 2, dropped: 0 });
    expect(figures("11.08")?.seen?.median).toBeGreaterThanOrEqual(30);
    expect(figures("11.08")?.ease).toEqual({ count: 5, average: 3.6 });
    expect(figures(provinceVillage.slice(0, 5))).toMatchObject({ seen: null, notSeen: 5, ease: null });
  });
});
