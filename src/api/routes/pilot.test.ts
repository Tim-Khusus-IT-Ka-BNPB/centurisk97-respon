import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskPilotSchema, deskSummarySchema } from "../../contract/desk";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { sendDraft, startDraft } from "../../testing/walk";
import { api } from "../app";

vi.setConfig({ testTimeout: 60_000 });

const clock = manualClock("2026-11-25T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => {
  clock.advance(20_000);
  return api.app.fetch(request, bindings);
};
const staff = (index: number) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const desk = () => staff(2);
const list = async () => deskPilotSchema.parse((await desk().call("GET", "/desk/pilot")).json);
const actions = () =>
  query<{ action: string; ticket_number: null; staff_id: string }>`
    select action, ticket_number, staff_id from staff_action where action like 'pilot%' order by id`;
const changes = (key: string) =>
  query`select change, by_kind, by_id from pilot_change where number_key = ${key} order by id`;

describe("the list on the desk (AC-02, AC-04)", () => {
  test("a number is allowed and taken away", async () => {
    const { typed, stored } = freshNumber();
    const before = (await actions()).length;
    const added = await desk().call("POST", "/desk/pilot", { number: typed, officerRegency: "" });
    expect(added.status).toBe(200);
    const [item] = deskPilotSchema.parse(added.json).items;
    expect(item).toMatchObject({
      number: stored,
      officerRegency: null,
      addedBy: "Pusdalops BNPB, Petugas Uji",
      reports: 0,
      lastReportAt: null,
    });
    const key = item?.key as string;
    const again = await desk().call("POST", "/desk/pilot", { number: typed });
    expect([again.status, again.error.fields[0]?.copyKey]).toEqual([422, "fieldError.pilot.exists"]);
    const removed = await desk().call("DELETE", `/desk/pilot/${key}`, { confirm: true });
    expect(deskPilotSchema.parse(removed.json).items.map((one) => one.key)).not.toContain(key);
    // Once more changes nothing and is logged nowhere.
    expect((await desk().call("DELETE", `/desk/pilot/${key}`, { confirm: true })).status).toBe(200);
    expect((await actions()).slice(before)).toEqual([
      { action: "pilotAllow", ticket_number: null, staff_id: "staff-desk-1" },
      { action: "pilotRemove", ticket_number: null, staff_id: "staff-desk-1" },
    ]);
    expect(await changes(key)).toEqual([
      { change: "allowed", by_kind: "staff", by_id: "staff-desk-1" },
      { change: "removed", by_kind: "staff", by_id: "staff-desk-1" },
    ]);
  });

  test("it counts what came from its number in a chat", async () => {
    const { typed } = freshNumber();
    const [item] = deskPilotSchema.parse((await desk().call("POST", "/desk/pilot", { number: typed })).json).items;
    const [village] = await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
      where v.regency_code = '11.08' order by v.code limit 1`;
    const phone = browser(fetchApi);
    const tick = () => clock.advance(4000);
    const ticket = await sendDraft(phone, await startDraft(phone, typed), village?.code as string, { tick });
    await query`update report set door = 'chat' where ticket_number = ${ticket}`;
    expect((await list()).items.find((each) => each.key === item?.key)).toMatchObject({
      reports: 1,
      lastReportAt: { zone: "WIB" },
    });
  });

  test("a wrong number or BPBD is named on its field, and taking away asks for its confirm", async () => {
    const before = (await list()).items.length;
    const wrong = await desk().call("POST", "/desk/pilot", { number: "123", officerRegency: "ab" });
    expect([wrong.status, wrong.error.fields.map((field) => field.copyKey)]).toEqual([
      422,
      ["fieldError.number.format", "fieldError.officerRegency.tooShort"],
    ]);
    const key = (await list()).items[0]?.key;
    expect((await desk().call("DELETE", `/desk/pilot/${key}`, {})).status).toBe(400);
    expect((await desk().call("DELETE", "/desk/pilot/x", { confirm: true })).status).toBe(400);
    expect((await list()).items).toHaveLength(before);
  });

  test("it holds 500 numbers and no more", async () => {
    const { items } = await list();
    for (let n = items.length; n < 500; n += 1)
      await query`insert into pilot_number (number_key, number, added_by, added_at)
        values (${`full-${n}`}, ${`+62800${String(10_000_000 + n)}`}, 'uji', '2026-11-01T00:00:00.000Z')`;
    const full = await desk().call("POST", "/desk/pilot", { number: freshNumber().typed });
    expect([full.status, full.error.fields[0]?.copyKey, full.error.fields[0]?.params]).toEqual([
      422,
      "fieldError.pilot.full",
      { max: 500 },
    ]);
    await query`delete from pilot_number where number_key like 'full-%'`;
  });
});

describe("who may see and change it (AC-03)", () => {
  test("a regional officer is refused, a reporter and a signed-out caller are asked to sign in", async () => {
    const key = "0".repeat(64);
    const callers = [
      [staff(3), 403, "desk.notAllowed"],
      [staff(0), 401, "auth.staffSignInFirst"],
      [browser(fetchApi), 401, "auth.staffSignInFirst"],
    ] as const;
    for (const [caller, status, code] of callers)
      for (const answer of [
        await caller.call("GET", "/desk/pilot"),
        await caller.call("POST", "/desk/pilot", { number: freshNumber().typed }),
        await caller.call("DELETE", `/desk/pilot/${key}`, { confirm: true }),
      ])
        expect([answer.status, answer.error.error.code]).toEqual([status, code]);
    const may = async (index: number) =>
      deskSummarySchema.parse((await staff(index).call("GET", "/desk/summary")).json).mayManagePilot;
    expect([await may(2), await may(3)]).toEqual([true, false]);
  });

  test("each account has its hourly limit", async () => {
    const limited = testBindings({}, { clock: manualClock("2031-03-01T03:00:00.000Z") }).bindings;
    const phone = browser((request) => api.app.fetch(request, limited));
    phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
    let status = 200;
    for (let count = 0; count <= 120 && status !== 429; count += 1)
      ({ status } = await phone.call("DELETE", `/desk/pilot/${"0".repeat(64)}`, { confirm: true }));
    expect(status).toBe(429);
    expect((await phone.call("POST", "/desk/pilot", { number: "x" })).status).toBe(429);
  });
});
