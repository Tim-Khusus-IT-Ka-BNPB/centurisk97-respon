import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskQueueSchema, deskReportSchema, deskSummarySchema } from "../../contract/desk";
import type { ModelRequest } from "../../domain/modelRequest";
import type { Database } from "../../platform/database";
import type { ModelPort } from "../../ports/model";
import { browser, freshNumber, losesOnce, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock(Date.UTC(2071, 0, 1) + Math.floor(Math.random() * 1e11));
const tick = () => clock.advance(4000);

// A model that finds every report it judges made up, and reads nothing from any message.
const judged: ModelRequest[] = [];
const doubting: ModelPort = {
  extract: async (request) => {
    if (!request.system.startsWith("You check a disaster report")) return null;
    judged.push(request);
    return { plausible: "unlikely", concerns: ["test"] };
  },
};
const MODEL_ON = { MODEL_MODE: "recorded", MODEL_BASE_URL: "http://localhost:8790", MODEL_NAME: "recorded" };
const off = testBindings({}, { clock }).bindings;
const on = testBindings(MODEL_ON, { clock, model: doubting }).bindings;
const fetchWith =
  (bindings: ApiBindings, db: Database = testDatabase()) =>
  (request: Request) =>
    api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);

type Phone = ReturnType<typeof browser>;
const signedIn = (index: number, db?: Database): Phone => {
  const phone = browser(fetchWith(off, db));
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
// A national desk officer, the BPBD of regency 11.08, and the BPBD of province 12.
const desk = () => signedIn(2);
const regency = () => signedIn(3);
const province = () => signedIn(4);

let villages: Record<"aceh" | "sumut", string> = { aceh: "", sumut: "" };
let sumutRegency = "";
const names = { aceh: "", sumut: "", sumutRegency: "" };

beforeAll(async () => {
  const [aceh] = await query<{ code: string; regency_name: string }>`
    select v.code, a.name as regency_name from place_village v
    join place_snapshot s on s.id = v.snapshot_id and s.active
    join place_regency a on a.snapshot_id = s.id and a.code = v.regency_code
    where v.regency_code = '11.08' order by v.code limit 1`;
  const [sumut] = await query<{ code: string; regency_code: string; regency_name: string; province_name: string }>`
    select v.code, v.regency_code, a.name as regency_name, a.province_name from place_village v
    join place_snapshot s on s.id = v.snapshot_id and s.active
    join place_regency a on a.snapshot_id = s.id and a.code = v.regency_code
    where v.regency_code like '12.%' order by v.code limit 1`;
  villages = { aceh: aceh?.code as string, sumut: sumut?.code as string };
  sumutRegency = sumut?.regency_code as string;
  Object.assign(names, {
    aceh: aceh?.regency_name,
    sumut: sumut?.province_name,
    sumutRegency: sumut?.regency_name,
  });
});

// The plain walk tells of someone trapped and badly hurt; these tell of nobody, so no life is at risk.
const NOBODY_TRAPPED = {
  "choice:trapped": () => ({ optionIds: ["noneKnown"] }),
  "choice:medicalHelp": () => ({ optionIds: ["handled"] }),
};

async function reportIn(village: string, bindings = off, number = freshNumber().typed): Promise<string> {
  const phone = browser(fetchWith(bindings));
  return sendDraft(phone, await startDraft(phone, number), village, { tick, overrides: NOBODY_TRAPPED });
}

const read = async (phone: Phone, ticket: string) =>
  deskReportSchema.parse((await phone.call("GET", `/desk/reports/${ticket}`)).json);
const tickets = async (phone: Phone, search = "") =>
  deskQueueSchema.parse((await phone.call("GET", `/desk/reports${search}`)).json).items.map((one) => one.ticketNumber);
const assign = async (phone: Phone, ticket: string, area: string, revision?: number) => {
  tick();
  return phone.call("POST", `/desk/reports/${ticket}/assignment`, {
    area,
    revision: revision ?? (await read(desk(), ticket)).revision,
  });
};
const stored = async (ticket: string) =>
  (
    await query<{ assigned_area: string; held: boolean; triage_tier: string; triage_reasons: string[] }>`
      select assigned_area, held, triage_tier, triage_reasons from ticket where ticket_number = ${ticket}`
  )[0];

describe("a report sent goes to its regency's BPBD at once", () => {
  test("with the model off nothing is held, and the desk reads why it is as sure as it is", async () => {
    const ticket = await reportIn(villages.aceh);
    expect(await stored(ticket)).toMatchObject({ assigned_area: "11.08", held: false });
    const report = await read(desk(), ticket);
    expect(report.assignment).toEqual({ area: "11.08", name: names.aceh, held: false });
    expect(report.triage.reasons).toContain("modelOff");
    expect(report.triage.reasons).not.toContain("modelUnlikely");
    expect(await tickets(regency())).toContain(ticket);
    expect((await read(regency(), ticket)).assignment.held).toBe(false);
  });

  test("one the model doubts waits for Pusdalops: no BPBD sees it until it is given", async () => {
    const number = freshNumber().typed;
    const ticket = await reportIn(villages.aceh, on, number);
    expect(await stored(ticket)).toMatchObject({ assigned_area: "11.08", held: true, triage_tier: "rendah" });
    expect((await stored(ticket))?.triage_reasons).toEqual(expect.arrayContaining(["modelUnlikely", "concern.test"]));
    // The model read the report's words and values, never the reporter's number.
    const asked = judged.at(-1) as ModelRequest;
    expect(asked.user).toContain("<report>");
    expect(asked.user).not.toContain(number.replace(/\D/g, "").slice(-8));
    expect((await regency().call("GET", `/desk/reports/${ticket}`)).status).toBe(404);
    expect(await tickets(regency())).not.toContain(ticket);
    expect(await tickets(desk(), "?has=held")).toContain(ticket);
    const summary = deskSummarySchema.parse((await desk().call("GET", "/desk/summary")).json);
    expect(summary.byHas.held).toBeGreaterThan(0);
    const given = await assign(desk(), ticket, "11.08");
    expect(given.status).toBe(200);
    const report = deskReportSchema.parse(given.json);
    expect(report.assignment).toEqual({ area: "11.08", name: names.aceh, held: false });
    expect(report.history.at(-1)).toMatchObject({ event: "assigned", detail: { area: names.aceh } });
    expect(await tickets(regency())).toContain(ticket);
    expect(await tickets(desk(), "?has=held")).not.toContain(ticket);
    const logged = await query<{ action: string }>`
      select action from staff_action where ticket_number = ${ticket} order by id`;
    expect(logged.map((one) => one.action)).toContain("assign");
  });

  test("forwarding a held report releases it to its BPBD", async () => {
    const ticket = await reportIn(villages.aceh, on);
    expect((await stored(ticket))?.held).toBe(true);
    await desk().call("POST", `/desk/reports/${ticket}/view`);
    for (const to of ["under_review", "forwarded"]) {
      tick();
      const moved = await desk().call("POST", `/desk/reports/${ticket}/status`, {
        to,
        note: "",
        revision: (await read(desk(), ticket)).revision,
      });
      expect(moved.status, to).toBe(200);
    }
    expect((await stored(ticket))?.held).toBe(false);
    expect(await tickets(regency())).toContain(ticket);
  });
});

describe("Pusdalops gives a ticket to another BPBD", () => {
  let ticket = "";
  beforeAll(async () => {
    ticket = await reportIn(villages.aceh);
  });

  test("the BPBD it had loses it, the one given it sees it, and the history names it", async () => {
    const toProvince = await assign(desk(), ticket, "12");
    expect(toProvince.status).toBe(200);
    expect(deskReportSchema.parse(toProvince.json).assignment).toEqual({ area: "12", name: names.sumut, held: false });
    expect((await regency().call("GET", `/desk/reports/${ticket}`)).status).toBe(404);
    expect(await tickets(province())).toContain(ticket);
    const toRegency = await assign(desk(), ticket, sumutRegency);
    expect(deskReportSchema.parse(toRegency.json).history.at(-1)).toMatchObject({
      event: "assigned",
      detail: { area: names.sumutRegency },
      status: "new",
    });
    // A BPBD of the province sees every ticket given to its regencies.
    expect(await tickets(province())).toContain(ticket);
    expect(await tickets(regency())).not.toContain(ticket);
    expect(await stored(ticket)).toMatchObject({ assigned_area: sumutRegency });
  });

  test("a BPBD may not give it on, an unknown area or an old revision is refused, and so is a closed ticket", async () => {
    const own = await reportIn(villages.aceh);
    const refused = await assign(regency(), own, "12");
    expect(refused.status).toBe(403);
    expect(refused.error.error.code).toBe("desk.notAllowed");
    for (const area of ["99.99", "99", "aceh", "11.08.01"]) {
      const unknown = await assign(desk(), own, area);
      expect(unknown.status, area).toBe(422);
      expect(unknown.error.error.code).toBe("request.invalidFields");
    }
    const revision = (await read(desk(), own)).revision;
    expect((await assign(desk(), own, "12", revision)).status).toBe(200);
    const late = await assign(desk(), own, "11.08", revision);
    expect(late.status).toBe(409);
    expect(late.error.error.code).toBe("ticket.changed");
    const raced = signedIn(2, losesOnce("update ticket set assigned_area"));
    const lost = await raced.call("POST", `/desk/reports/${own}/assignment`, {
      area: "11.08",
      revision: (await read(desk(), own)).revision,
    });
    expect(lost.status).toBe(409);
    expect(lost.error.error.code).toBe("ticket.changed");
    await query`update ticket set status = 'invalid' where ticket_number = ${own}`;
    const ended = await assign(desk(), own, "11.08");
    expect(ended.status).toBe(409);
    expect(ended.error.error.code).toBe("ticket.transitionRefused");
    expect((await assign(desk(), "LA-010170-99", "11.08", 0)).status).toBe(404);
  });

  test("the areas it can be given to: every province before its regencies, for Pusdalops only", async () => {
    const answer = await desk().call("GET", "/desk/areas");
    expect(answer.status).toBe(200);
    const areas = (answer.json as { areas: { area: string; name: string; level: string }[] }).areas;
    const codes = areas.map((one) => one.area);
    expect(codes.indexOf("11")).toBeLessThan(codes.indexOf("11.08"));
    expect(areas.find((one) => one.area === "11.08")).toEqual({ area: "11.08", name: names.aceh, level: "regency" });
    expect(areas.find((one) => one.area === "12")).toEqual({ area: "12", name: names.sumut, level: "province" });
    expect(new Set(codes).size).toBe(codes.length);
    expect((await regency().call("GET", "/desk/areas")).status).toBe(403);
  });
});

describe("what the reporter's number sent before", () => {
  test("a report found not true lowers the next one; one handled raises it", async () => {
    const number = freshNumber().typed;
    const first = await reportIn(villages.aceh, off, number);
    await query`update ticket set status = 'invalid' where ticket_number = ${first}`;
    expect((await stored(await reportIn(villages.aceh, off, number)))?.triage_reasons).toContain("invalidBefore");
    const other = freshNumber().typed;
    const handled = await reportIn(villages.aceh, off, other);
    await query`update ticket set status = 'closed' where ticket_number = ${handled}`;
    const next = (await stored(await reportIn(villages.aceh, off, other)))?.triage_reasons;
    expect(next).toContain("handledBefore");
    expect(next).not.toContain("invalidBefore");
  });
});
