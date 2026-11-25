import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskPilotSchema, deskReportSchema, deskSummarySchema } from "../../contract/desk";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { allow, chat, GATEWAY_SECRETS, gateway, known, numberKey, reach, sent } from "../../testing/gateway";
import { cameraJpeg } from "../../testing/photoBase";
import { api } from "../app";

vi.setConfig({ testTimeout: 60_000 });

const clock = manualClock("2026-11-25T03:00:00.000Z");
const { bindings } = testBindings({ GATEWAY_SECRETS }, { clock });
const fetchApi = (request: Request) => {
  clock.advance(20_000);
  return api.app.fetch(request, bindings);
};
const machine = gateway(fetchApi, { now: clock.now });
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
const changes = async (number: string) =>
  query`select change, by_kind, by_id from pilot_change where number_key = ${await numberKey(number)} order by id`;

describe("a number that is not allowed (AC-01)", () => {
  test("gets nothing from any route, and nothing of it is kept", async () => {
    const { stored } = freshNumber();
    const wa = stored.slice(1);
    const counts = () => query`select (select count(*) from chat_session) as sessions,
      (select count(*) from reporter) as reporters, (select count(*) from report_draft) as drafts,
      (select count(*) from rate_counter) as counters, (select count(*) from news_choice) as choices`;
    const before = await counts();
    for (const answer of [
      await machine.call("POST", "/pesan", { wa, teks: "banjir" }),
      await machine.call("POST", "/pesan", { wa, lokasi: { lat: 5.1, lon: 97.1 } }),
      await machine.call("POST", "/foto", { wa, data: btoa(String.fromCharCode(...cameraJpeg().subarray(0, 2000))) }),
    ]) {
      expect(answer.status).toBe(403);
      expect(answer.json).toEqual({ galat: "Nomor ini belum diizinkan memakai layanan lapor (masa uji)." });
    }
    expect(await counts()).toEqual(before);
  });

  test("taken away in the middle of a report, the chat falls silent and its news stops", async () => {
    const one = chat(fetchApi, { now: clock.now });
    const ticket = await sent(one);
    await one.send("ya");
    const waiting = async () =>
      ((await machine.call("GET", "/kabar")).json.kabar as { nomor: string }[]).filter((item) => item.nomor === ticket);
    expect(await waiting()).toHaveLength(1);
    await desk().call("DELETE", `/desk/pilot/${await numberKey(one.number)}`, { confirm: true });
    expect((await one.send("status")).status).toBe(403);
    expect((await one.photo(cameraJpeg())).status).toBe(403);
    expect(await waiting()).toEqual([]);
    // What it sent stays.
    expect((await desk().call("GET", `/desk/reports/${ticket}`)).status).toBe(200);
  });
});

describe("the list on the desk (AC-02, AC-04)", () => {
  test("a number is allowed, answered, read by the gateway, and taken away", async () => {
    const { typed, stored } = freshNumber();
    const before = (await actions()).length;
    const added = await desk().call("POST", "/desk/pilot", { number: typed, officerRegency: "" });
    expect(added.status).toBe(200);
    const [item] = deskPilotSchema.parse(added.json).items;
    expect(item).toMatchObject({
      key: await numberKey(stored),
      number: stored,
      officerRegency: null,
      addedBy: "Pusdalops BNPB, Petugas Uji",
      reports: 0,
      lastReportAt: null,
    });
    expect((await machine.call("GET", "/izin")).json.wa).toContain(stored.slice(1));
    expect((await machine.call("POST", "/pesan", { wa: stored.slice(1), teks: "lapor" })).text).toContain("1. Setuju");
    const again = await desk().call("POST", "/desk/pilot", { number: typed });
    expect([again.status, again.error.fields[0]?.copyKey]).toEqual([422, "fieldError.pilot.exists"]);
    const removed = await desk().call("DELETE", `/desk/pilot/${item?.key}`, { confirm: true });
    expect(deskPilotSchema.parse(removed.json).items.map((one) => one.key)).not.toContain(item?.key);
    expect((await machine.call("POST", "/pesan", { wa: stored.slice(1), teks: "lapor" })).status).toBe(403);
    expect((await machine.call("GET", "/izin")).json.wa).not.toContain(stored.slice(1));
    // Once more changes nothing and is logged nowhere.
    expect((await desk().call("DELETE", `/desk/pilot/${item?.key}`, { confirm: true })).status).toBe(200);
    expect((await actions()).slice(before)).toEqual([
      { action: "pilotAllow", ticket_number: null, staff_id: "staff-desk-1" },
      { action: "pilotRemove", ticket_number: null, staff_id: "staff-desk-1" },
    ]);
    expect(await changes(stored)).toEqual([
      { change: "allowed", by_kind: "staff", by_id: "staff-desk-1" },
      { change: "removed", by_kind: "staff", by_id: "staff-desk-1" },
    ]);
  });

  test("it counts what each chat sent", async () => {
    const one = chat(fetchApi, { now: clock.now });
    await sent(one);
    const item = (await list()).items.find((each) => each.number === one.number);
    expect(item).toMatchObject({ reports: 1, lastReportAt: { zone: "WIB" } });
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
    expect((await machine.call("POST", "/izin", { wa: freshNumber().stored })).status).toBe(400);
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
    const limited = testBindings({ GATEWAY_SECRETS }, { clock: manualClock("2031-03-01T03:00:00.000Z") }).bindings;
    const phone = browser((request) => api.app.fetch(request, limited));
    phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
    let status = 200;
    for (let count = 0; count <= 120 && status !== 429; count += 1)
      ({ status } = await phone.call("DELETE", `/desk/pilot/${"0".repeat(64)}`, { confirm: true }));
    expect(status).toBe(429);
    expect((await phone.call("POST", "/desk/pilot", { number: "x" })).status).toBe(429);
  });
});

describe("the owner's command through a gateway", () => {
  test("allows, words anew and takes away, each named as that gateway's", async () => {
    const { typed, stored } = freshNumber();
    const before = (await actions()).length;
    expect(await machine.call("POST", "/izin", { wa: typed })).toMatchObject({ status: 200, json: { ok: true } });
    expect((await machine.call("POST", "/izin", { wa: stored.slice(1), peran: "bpbd", kab: "Kab. Uji" })).status).toBe(
      200,
    );
    expect((await list()).items.find((item) => item.number === stored)).toMatchObject({
      officerRegency: "Kab. Uji",
      addedBy: "uji-1",
    });
    expect((await machine.call("POST", "/izin", { wa: stored, cabut: true, kab: "x" })).status).toBe(200);
    expect((await machine.call("POST", "/izin", { wa: stored, cabut: true })).status).toBe(200);
    expect(await changes(stored)).toEqual([
      { change: "allowed", by_kind: "gateway", by_id: "uji-1" },
      { change: "allowed", by_kind: "gateway", by_id: "uji-1" },
      { change: "removed", by_kind: "gateway", by_id: "uji-1" },
    ]);
    expect(await actions()).toHaveLength(before);
  });

  test("what cannot be read is refused", async () => {
    for (const body of [
      { wa: "12" },
      { wa: "12", cabut: true },
      { wa: freshNumber().stored, peran: "bpbd" },
      { wa: freshNumber().stored, peran: "bpbd", kab: " " },
      { wa: freshNumber().stored, peran: "bpbd", kab: "ab" },
      { wa: freshNumber().stored, peran: "polisi" },
    ])
      expect((await machine.call("POST", "/izin", body)).status, JSON.stringify(body)).toBe(400);
  });

  test("a regency with no role allows it as anyone's", async () => {
    const { stored } = freshNumber();
    await machine.call("POST", "/izin", { wa: stored, kab: "Kab. Uji" });
    expect((await list()).items.find((item) => item.number === stored)?.officerRegency).toBeNull();
  });
});

describe("a claimed officer (AC-05)", () => {
  const officerReport = async (regency: string | null) => {
    const { stored } = freshNumber();
    await allow(stored, regency);
    const one = chat(fetchApi, { now: clock.now }, stored);
    for (const text of ["lapor", "1", "2", "Uji Dua", "Kabupaten Uji", "Staf"]) await one.send(text);
    await one.share(5.14705, 97.0482);
    await one.send("1");
    await reach(one, /^\*Ringkasan laporan/m);
    const { text } = await one.send("1");
    return (/LA-\d{6}-\d{2,}/.exec(text) as RegExpExecArray)[0];
  };
  const confirmed = async (ticket: string) =>
    deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json).officerConfirmed;

  test("is confirmed where the list says so, for a proved number alone, and a citizen never is", async () => {
    const ticket = await officerReport("Kabupaten Uji");
    expect(await confirmed(ticket)).toBe(true);
    await query`update report set number_unverified = 1 where ticket_number = ${ticket}`;
    expect(await confirmed(ticket)).toBe(false);
    expect(await confirmed(await officerReport(null))).toBe(false);
    const { stored } = freshNumber();
    await allow(stored, "Kabupaten Uji");
    const citizen = chat(fetchApi, { now: clock.now }, stored);
    expect(await confirmed(await sent(citizen))).toBe(false);
    await known(chat(fetchApi, { now: clock.now }));
  });
});
