import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import {
  deskGallerySchema,
  deskIdentitySchema,
  deskMapSchema,
  deskQueueSchema,
  deskReportSchema,
  deskSummarySchema,
} from "../../contract/desk";
import { trackingSchema } from "../../contract/tracking";
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
// A national desk officer, the BPBD of regency 11.08, and the BPBD of province 12.
const desk = () => signedIn(2);
const regency = () => signedIn(3);
const province = () => signedIn(4);

// One sent report in each place: in the regency, and in two regencies of the province.
const reports = { regency: "", provinceA: "", provinceB: "" };
let provinceRegencies: string[] = [];

async function reportIn(regencyCode: string): Promise<string> {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = ${regencyCode} order by v.code limit 1`;
  const phone = browser(fetchApi);
  return sendDraft(phone, await startDraft(phone, freshNumber().typed), found?.code as string, { tick });
}

beforeAll(async () => {
  provinceRegencies = (
    await query<{ regency_code: string }>`
      select distinct v.regency_code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
      where v.regency_code like '12.%' order by v.regency_code limit 2`
  ).map((one) => one.regency_code);
  expect(provinceRegencies).toHaveLength(2);
  reports.regency = await reportIn("11.08");
  reports.provinceA = await reportIn(provinceRegencies[0] as string);
  reports.provinceB = await reportIn(provinceRegencies[1] as string);
}, 120_000);

const tickets = async (phone: Phone, search = "") =>
  deskQueueSchema
    .parse((await phone.call("GET", `/desk/reports${search}`)).json)
    .items.map((item) => item.ticketNumber)
    .sort();
const read = async (phone: Phone, ticket: string) =>
  deskReportSchema.parse((await phone.call("GET", `/desk/reports/${ticket}`)).json);
const actions = (ticket: string) =>
  query<{ staff_id: string; staff_kind: string; action: string }>`
    select staff_id, staff_kind, action from staff_action where ticket_number = ${ticket} order by id`;
const move = async (phone: Phone, ticket: string, to: string, note = "") => {
  tick();
  return phone.call("POST", `/desk/reports/${ticket}/status`, {
    to,
    note,
    revision: (await read(desk(), ticket)).revision,
  });
};

describe("a regional account's desk", () => {
  test("holds only the reports of its regency, or of every regency of its province, each count the database's", async () => {
    expect(await tickets(regency())).toEqual([reports.regency]);
    expect(await tickets(province())).toEqual([reports.provinceA, reports.provinceB].sort());
    expect(await tickets(desk())).toEqual(Object.values(reports).sort());
    for (const [phone, count] of [
      [regency(), 1],
      [province(), 2],
      [desk(), 3],
    ] as const) {
      const summary = deskSummarySchema.parse((await phone.call("GET", "/desk/summary")).json);
      expect(summary.total).toBe(count);
      expect(Object.values(summary.byStatus).reduce((sum, n) => sum + n, 0)).toBe(count);
      expect(Object.values(summary.byHazard).reduce((sum: number, n) => sum + (n as number), 0)).toBe(count);
      const queue = deskQueueSchema.parse((await phone.call("GET", "/desk/reports")).json);
      expect(queue.total).toBe(count);
      const map = deskMapSchema.parse((await phone.call("GET", "/desk/map")).json);
      expect(map.points.length).toBeLessThanOrEqual(count);
    }
    expect((await regency().call("GET", "/desk/summary")).json).toMatchObject({
      account: { label: "BPBD Kabupaten Uji Satu, Petugas Uji" },
    });
    expect(deskMapSchema.parse((await regency().call("GET", "/desk/map")).json).points).toMatchObject([
      { ticketNumber: reports.regency },
    ]);
  });

  test("a report outside it is as if it were not there, on every route, and nothing is written", async () => {
    const outside = reports.provinceA;
    const { revision } = await read(desk(), outside);
    expect(await tickets(regency(), `?ticket=${outside}`)).toEqual([]);
    for (const [method, path, body] of [
      ["GET", `/desk/reports/${outside}`, undefined],
      ["POST", `/desk/reports/${outside}/view`, undefined],
      ["POST", `/desk/reports/${outside}/identity`, undefined],
      ["POST", `/desk/reports/${outside}/status`, { to: "under_review", note: "", revision }],
      ["POST", `/desk/reports/${outside}/replies`, { text: "Kami cek" }],
    ] as const) {
      const answer = await regency().call(method, path, body);
      expect(answer.status, path).toBe(404);
      expect(answer.error.error.code).toBe("desk.reportNotFound");
    }
    const [draft] = await query<{ draft_id: string }>`select draft_id from report where ticket_number = ${outside}`;
    const photo = crypto.randomUUID();
    await query`insert into draft_photo (id, draft_id, store_key, bytes, badge, far, taken_at, time_source, received_at)
      values (${photo}, ${draft?.draft_id}, ${`photos/${photo}`}, 3, 'none', 0, ${"2026-11-24T03:00:00.000Z"}, 'upload', ${"2026-11-24T03:00:00.000Z"})`;
    await bindings.photos.put(`photos/${photo}`, new Uint8Array([1, 2, 3]));
    expect((await desk().file(`/desk/photos/${photo}`)).status).toBe(200);
    expect((await regency().call("GET", `/desk/photos/${photo}`)).status).toBe(404);
    expect(deskGallerySchema.parse((await regency().call("GET", "/desk/photos")).json).photos).toEqual([]);
    expect(deskGallerySchema.parse((await province().call("GET", "/desk/photos")).json).photos).toMatchObject([
      { photoId: photo },
    ]);
    expect(await actions(outside)).toEqual([]);
    expect((await read(desk(), outside)).status).toBe("new");
  });

  test("works a report of its own: seen, moved, answered, each logged as its own", async () => {
    const ticket = await reportIn("11.08");
    expect((await regency().call("POST", `/desk/reports/${ticket}/view`)).status).toBe(200);
    expect((await move(regency(), ticket, "under_review")).status).toBe(200);
    expect((await regency().call("POST", `/desk/reports/${ticket}/replies`, { text: "Kami cek" })).status).toBe(200);
    expect(await actions(ticket)).toEqual(
      ["view", "status", "reply"].map((action) => ({
        staff_id: "staff-bpbd-1108",
        staff_kind: "regionalOfficer",
        action,
      })),
    );
  });

  test("may not forward or reopen, and is not offered either; a desk officer may", async () => {
    const ticket = await reportIn("11.08");
    await regency().call("POST", `/desk/reports/${ticket}/view`);
    await move(regency(), ticket, "under_review");
    expect((await read(regency(), ticket)).nextStatuses.map((next) => next.status)).toEqual(["in_handling", "invalid"]);
    const forwarded = await move(regency(), ticket, "forwarded");
    expect(forwarded.status).toBe(403);
    expect(forwarded.error.error.code).toBe("desk.notAllowed");
    expect((await move(desk(), ticket, "forwarded")).status).toBe(200);
    await move(regency(), ticket, "in_handling", "Tim berangkat");
    await move(regency(), ticket, "closed", "Air sudah surut");
    expect((await read(regency(), ticket)).nextStatuses).toEqual([]);
    expect((await move(regency(), ticket, "under_review", "Buka lagi")).error.error.code).toBe("desk.notAllowed");
    expect((await move(regency(), ticket, "forwarded")).status).toBe(403);
    expect((await move(desk(), ticket, "under_review", "Buka lagi")).status).toBe(200);
  });
});

describe("a report forwarded", () => {
  test("names the regency whose desk it went to, and the reporter sees it went to the local BPBD", async () => {
    const ticket = await reportIn("11.08");
    await desk().call("POST", `/desk/reports/${ticket}/view`);
    await move(desk(), ticket, "under_review");
    await move(desk(), ticket, "forwarded");
    const report = await read(desk(), ticket);
    expect(report.history.at(-1)).toMatchObject({ status: "forwarded", forwardedTo: report.place.regencyName });
    expect(report.history[0]?.forwardedTo).toBeNull();
    const [row] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    const token = await trackingToken(bindings.settings.keyHmacSecret, row?.id as string);
    const tracked = trackingSchema.parse((await browser(fetchApi).call("POST", "/tracking", { token })).json);
    expect(tracked.stages[3]).toMatchObject({ status: "forwarded", reachedAt: { zone: "WIB" } });
  });
});

describe("a reporter's identity", () => {
  test("is not in a regional account's queue or report until asked for, and each ask is logged once", async () => {
    const ticket = reports.regency;
    const queue = await regency().call("GET", "/desk/reports");
    const report = await regency().call("GET", `/desk/reports/${ticket}`);
    const shown = await read(desk(), ticket);
    for (const answer of [queue, report]) {
      const text = JSON.stringify(answer.json);
      expect(text).not.toContain('Uji Satu"');
      expect(text).not.toContain(shown.reporter.identity?.number);
    }
    expect(deskReportSchema.parse(report.json).reporter).toEqual({ role: "citizen", identity: null });
    expect(deskQueueSchema.parse(queue.json).items[0]?.reporter).toEqual({ name: null, role: "citizen" });
    const before = (await actions(ticket)).length;
    const asked = await regency().call("POST", `/desk/reports/${ticket}/identity`);
    expect(asked.status).toBe(200);
    expect(deskIdentitySchema.parse(asked.json)).toEqual(shown.reporter.identity);
    expect((await actions(ticket)).slice(before)).toEqual([
      { staff_id: "staff-bpbd-1108", staff_kind: "regionalOfficer", action: "identityView" },
    ]);
  });

  test("a desk officer sees it with no extra step, and has none to ask", async () => {
    expect((await read(desk(), reports.regency)).reporter.identity?.name).toBe("Uji Satu");
    const asked = await desk().call("POST", `/desk/reports/${reports.regency}/identity`);
    expect(asked.error.error.code).toBe("desk.notAllowed");
  });
});
