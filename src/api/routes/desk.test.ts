import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import {
  type DeskQueue,
  type DeskReport,
  deskMapSchema,
  deskQueueSchema,
  deskReportSchema,
  deskSummarySchema,
} from "../../contract/desk";
import { trackingSchema } from "../../contract/tracking";
import { periodStart } from "../../domain/deskQueue";
import { windowStart } from "../../domain/limits";
import { hmacKey } from "../../platform/keys";
import { trackingToken } from "../../services/tracking";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

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
const deskOfficer = () => signedIn(2);

let village = "";
beforeAll(async () => {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

// A typed number's report, walked with the model off.
const typedReport = async () => {
  const phone = browser(fetchApi);
  return sendDraft(phone, await startDraft(phone, freshNumber().typed), village, { tick });
};

const queue = async (phone: Phone, search = "") => {
  const answer = await phone.call("GET", `/desk/reports${search}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return deskQueueSchema.parse(answer.json) as DeskQueue;
};

const detail = async (phone: Phone, ticket: string) => {
  const answer = await phone.call("GET", `/desk/reports/${ticket}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return deskReportSchema.parse(answer.json) as DeskReport;
};

describe("who reaches the desk", () => {
  test("signed out, a reporter device and a reporter session are asked to sign in as staff, on every route", async () => {
    const ticket = await typedReport();
    const device = browser(fetchApi);
    await startDraft(device, freshNumber().typed);
    const callers = [browser(fetchApi), device, signedIn(0)];
    for (const caller of callers) {
      for (const [method, path] of [
        ["GET", "/desk/reports"],
        ["GET", `/desk/reports/${ticket}`],
        ["POST", `/desk/reports/${ticket}/view`],
      ] as const) {
        const answer = await caller.call(method, path);
        expect(answer.status, `${method} ${path}`).toBe(401);
        expect(answer.error.error.code).toBe("auth.staffSignInFirst");
        expect(JSON.stringify(answer.json)).not.toContain(ticket);
      }
    }
  });

  test("a write without the client header is refused before anything is written", async () => {
    const ticket = await typedReport();
    const cookie = `seeded_session=${(SEEDED_SESSIONS[2] as { token: string }).token}`;
    const response = await fetchApi(
      new Request(`http://localhost/api/lapor/desk/reports/${ticket}/view`, {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.9", origin: "http://localhost:5173", cookie },
      }),
    );
    expect(response.status).toBe(403);
    expect(await query`select 1 from staff_action where ticket_number = ${ticket}`).toEqual([]);
  });

  test("an unknown ticket is not found", async () => {
    const answer = await deskOfficer().call("GET", "/desk/reports/LA-010150-01");
    expect(answer.status).toBe(404);
    expect(answer.error.error.code).toBe("desk.reportNotFound");
    expect((await deskOfficer().call("POST", "/desk/reports/LA-010150-01/view")).status).toBe(404);
  });
});

describe("the queue", () => {
  test("a ticket a week in one status is late; a move to another status starts it again", async () => {
    const ticket = await typedReport();
    const now = clock.now();
    expect((await detail(deskOfficer(), ticket)).overdue).toBe(false);
    clock.set(now + 8 * 86_400_000);
    expect((await detail(deskOfficer(), ticket)).overdue).toBe(true);
    expect((await queue(deskOfficer(), `?ticket=${ticket}`)).items[0]?.overdue).toBe(true);
    await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    expect((await detail(deskOfficer(), ticket)).overdue).toBe(false);
    clock.set(now);
  });

  test("lists every sent report newest first, counted as the database counts, and marks typed numbers", async () => {
    const typed = await typedReport();
    tick();
    const session = signedIn(1);
    const fromSession = await sendDraft(session, await startDraft(session, freshNumber().typed), village, { tick });
    const listed = await queue(deskOfficer());
    const [counted] = await query<{ total: number }>`select count(*) as total from report`;
    expect(listed.total).toBe(counted?.total);
    expect(listed.account.label).toBe("Pusdalops BNPB, Petugas Uji");
    const sentAt = listed.items.map((item) => item.sentAt.utc);
    expect(sentAt).toEqual([...sentAt].sort().reverse());
    expect(listed.items.find((item) => item.ticketNumber === typed)).toMatchObject({
      numberUnverified: true,
      status: "new",
      hazardType: "flood",
      reporter: { name: "Uji Satu", role: "citizen" },
      sentAt: { zone: "WIB" },
    });
    expect(listed.items.find((item) => item.ticketNumber === fromSession)?.numberUnverified).toBe(false);
    expect(JSON.stringify(listed)).not.toMatch(/\+62\d/);
  });

  test("filters by status, hazard type, period and ticket number, each count equal to the database's", async () => {
    const ticket = await typedReport();
    await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    const seen = await queue(deskOfficer(), "?status=seen&hazardType=flood");
    const [counted] = await query<{ total: number }>`
      select count(*) as total from report r join ticket t on t.report_id = r.id
      where t.status = 'seen' and r.hazard_type = 'flood'`;
    expect(seen.total).toBe(counted?.total);
    expect(seen.items.every((item) => item.status === "seen" && item.hazardType === "flood")).toBe(true);
    expect(
      (await queue(deskOfficer(), `?ticket=${ticket.toLowerCase()}`)).items.map((item) => item.ticketNumber),
    ).toEqual([ticket]);
    expect((await queue(deskOfficer(), "?hazardType=drought")).total).toBe(0);
    const today = await queue(deskOfficer(), "?period=today");
    expect(today.items.map((item) => item.ticketNumber)).toContain(ticket);
    clock.advance(8 * 86_400_000);
    expect((await queue(deskOfficer(), "?period=week")).items.map((item) => item.ticketNumber)).not.toContain(ticket);
    expect((await queue(deskOfficer(), "?period=month")).items.map((item) => item.ticketNumber)).toContain(ticket);
  });

  test("a searched number that is not a ticket number is refused on its field", async () => {
    const answer = await deskOfficer().call("GET", "/desk/reports?ticket=0800");
    expect(answer.status).toBe(422);
    expect(answer.error.fields).toEqual([{ fieldId: "ticket", copyKey: "fieldError.ticketNumber.format", params: {} }]);
  });

  test("pages of 50, with the page count", async () => {
    const listed = await queue(deskOfficer(), "?page=2");
    expect(listed.page).toBe(2);
    expect(listed.pageCount).toBe(Math.ceil(listed.total / 50));
    expect(listed.items.length).toBe(Math.max(0, Math.min(50, listed.total - 50)));
  });
});

describe("counts for the queues and the chips", () => {
  test("each status and hazard counts the reports the other filters leave, equal to the database", async () => {
    const ticket = await typedReport();
    await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    const answer = await deskOfficer().call("GET", "/desk/summary?status=seen&period=today");
    expect(answer.status).toBe(200);
    const summary = deskSummarySchema.parse(answer.json);
    const since = new Date(periodStart("today", clock.now()) as number).toISOString();
    const byStatus = await query<{ status: string; total: number }>`
      select t.status, count(*) as total from report r join ticket t on t.report_id = r.id
      where r.sent_at >= ${since} group by t.status`;
    for (const status of ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"] as const)
      expect(summary.byStatus[status], status).toBe(byStatus.find((one) => one.status === status)?.total ?? 0);
    const [flood] = await query<{ total: number }>`
      select count(*) as total from report r join ticket t on t.report_id = r.id
      where r.sent_at >= ${since} and t.status = 'seen' and r.hazard_type = 'flood'`;
    expect(summary.byHazard.flood).toBe(flood?.total);
    expect(summary.total).toBe(summary.byStatus.seen);
    const all = deskSummarySchema.parse((await deskOfficer().call("GET", "/desk/summary")).json);
    const [counted] = await query<{ total: number }>`select count(*) as total from report`;
    expect(all.total).toBe(counted?.total);
  });

  test("a holding counts the reports with a figure above zero, and filters every view the same", async () => {
    const before = deskSummarySchema.parse((await deskOfficer().call("GET", "/desk/summary")).json).byHas;
    const phone = browser(fetchApi);
    const started = await startDraft(phone, freshNumber().typed);
    const told = await phone.call(
      "POST",
      `/drafts/${started.draftId}/turns`,
      turn(started, { kind: "freeText", text: "banjir, dua orang meninggal" }),
    );
    // Two dead; missing, hurt and houses left empty; nobody displaced: only the dead count.
    const ticket = await sendDraft(phone, told.draft, village, {
      tick,
      overrides: {
        numberForm: (card) =>
          "groupId" in card && card.groupId === "victims"
            ? { values: { missing: "", injured: "", housesHeavy: "" } }
            : { optionIds: ["allNone"] },
      },
    });
    const after = deskSummarySchema.parse((await deskOfficer().call("GET", "/desk/summary")).json).byHas;
    expect(after).toEqual({ ...before, victims: before.victims + 1 });
    const shows = async (has: string) => {
      const answer = await deskOfficer().call("GET", `/desk/reports?has=${has}&ticket=${ticket}`);
      return deskQueueSchema.parse(answer.json).total;
    };
    expect([await shows("victims"), await shows("displaced"), await shows("houses"), await shows("photos")]).toEqual([
      1, 0, 0, 0,
    ]);
    const map = deskMapSchema.parse((await deskOfficer().call("GET", `/desk/map?has=victims&ticket=${ticket}`)).json);
    expect(map.points).toHaveLength(1);
    expect((await deskOfficer().call("GET", "/desk/reports?has=everything")).status).toBe(400);
  });

  test("a wrong ticket number is refused", async () => {
    expect((await deskOfficer().call("GET", "/desk/summary?ticket=0800")).status).toBe(422);
  });
});

describe("a report on the desk", () => {
  test("every value shows where it came from, and empty is never zero", async () => {
    const phone = browser(fetchApi);
    const started = await startDraft(phone, freshNumber().typed);
    // The story told before any question: the count is read from the reporter's own words.
    const told = await phone.call(
      "POST",
      `/drafts/${started.draftId}/turns`,
      turn(started, { kind: "freeText", text: "banjir, dua orang meninggal" }),
    );
    expect(told.status).toBe(200);
    const ticket = await sendDraft(phone, told.draft, village, {
      tick,
      overrides: {
        numberForm: (card) =>
          "groupId" in card && card.groupId === "victims"
            ? { values: { missing: "", injured: "", housesHeavy: "" } }
            : { optionIds: ["allNone"] },
      },
    });
    const report = await detail(deskOfficer(), ticket);
    const rows = report.groups.flatMap((group) => group.rows);
    const row = (fieldId: string) => rows.find((one) => one.fieldId === fieldId);
    expect(row("dead")).toMatchObject({ state: "value", value: { kind: "count", count: 2 }, origin: "quote" });
    expect(row("dead")?.quote).toContain("dua orang meninggal");
    expect(row("hazardType")).toMatchObject({ origin: "tappedOption", quote: null });
    expect(row("missing")).toMatchObject({ state: "confirmedUnknown", value: null });
    expect(report.impact).toEqual({
      dead: 2,
      missing: null,
      injured: null,
      displaced: 0,
      houses: { count: 0, partial: false },
    });
    expect(report.reporter).toMatchObject({ role: "citizen", identity: { name: "Uji Satu", officerRegency: null } });
    expect(report.reporter.identity?.number).toMatch(/^\+628\d+$/);
    expect(report.numberUnverified).toBe(true);
    expect(report.reporterWords.map((word) => word.text)).toContain("banjir, dua orang meninggal");
    expect(report.history).toEqual([
      {
        status: "new",
        at: expect.objectContaining({ zone: "WIB" }),
        actor: null,
        note: null,
        forwardedTo: null,
        event: null,
        detail: null,
      },
    ]);
  });

  test("a subtype the reporter did not know reads as unknown on the queue", async () => {
    const phone = browser(fetchApi);
    const ticket = await sendDraft(phone, await startDraft(phone, freshNumber().typed), village, {
      tick,
      overrides: { "choice:hazardSubtype": () => ({ optionIds: ["unknown"] }) },
    });
    const listed = await queue(deskOfficer(), `?ticket=${ticket}`);
    expect(listed.items[0]?.hazardSubtype).toBe("unknown");
  });

  test("opening a new report makes it seen once, logs every open, and the tracking page shows the stage", async () => {
    const phone = browser(fetchApi);
    const ticket = await sendDraft(phone, await startDraft(phone, freshNumber().typed), village, { tick });
    const read = await detail(deskOfficer(), ticket);
    expect(read.status).toBe("new");
    expect(await query`select 1 from staff_action where ticket_number = ${ticket}`).toEqual([]);
    tick();
    const opened = await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    expect(opened.status).toBe(200);
    const seen = deskReportSchema.parse(opened.json);
    expect(seen.status).toBe("seen");
    expect(seen.history.at(-1)).toMatchObject({ status: "seen", actor: "Pusdalops BNPB, Petugas Uji" });
    await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    expect(
      await query`select to_status, actor, actor_id from ticket_history where ticket_number = ${ticket} order by id`,
    ).toEqual([
      { to_status: "new", actor: "system", actor_id: null },
      { to_status: "seen", actor: "staff", actor_id: "staff-desk-1" },
    ]);
    expect(await query`select staff_id, staff_kind, action from staff_action where ticket_number = ${ticket}`).toEqual([
      { staff_id: "staff-desk-1", staff_kind: "deskOfficer", action: "view" },
      { staff_id: "staff-desk-1", staff_kind: "deskOfficer", action: "view" },
    ]);
    const [report] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    const token = await trackingToken(bindings.settings.keyHmacSecret, report?.id as string);
    const tracked = trackingSchema.parse((await browser(fetchApi).call("POST", "/tracking", { token })).json);
    expect(tracked.stages[1]).toMatchObject({ status: "seen", reachedAt: { zone: "WIB" } });
    expect(JSON.stringify(tracked)).not.toContain("Petugas Uji");
  });

  test("two officers opening a new report at once move it once", async () => {
    const ticket = await typedReport();
    await Promise.all([
      deskOfficer().call("POST", `/desk/reports/${ticket}/view`),
      deskOfficer().call("POST", `/desk/reports/${ticket}/view`),
    ]);
    expect(await query`select to_status from ticket_history where ticket_number = ${ticket}`).toHaveLength(2);
    expect(await query`select 1 from staff_action where ticket_number = ${ticket}`).toHaveLength(2);
  });

  test("past the hourly limit an account's reads and writes are refused with the time to try again", async () => {
    const ticket = await typedReport();
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    for (const [limitId, count] of [
      ["desk.read", 1200],
      ["desk.write", 120],
    ] as const)
      await query`insert into rate_counter (limit_id, subject_key, window_start, count) values (${limitId}, ${key}, ${window}, ${count})
        on conflict do update set count = excluded.count`;
    const read = await deskOfficer().call("GET", "/desk/reports");
    expect(read.status).toBe(429);
    expect(read.error).toMatchObject({
      error: { code: "limit.desk.read", params: { limit: 1200 } },
      retryAt: { zone: "WIB" },
    });
    for (const path of ["/desk/summary", `/desk/reports/${ticket}`])
      expect((await deskOfficer().call("GET", path)).status, path).toBe(429);
    const write = await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
    expect(write.error.error.code).toBe("limit.desk.write");
    await query`delete from rate_counter where subject_key = ${key}`;
  });
});

describe("seeded staff sign-in", () => {
  test("a staff code signs in and opens the desk; an unknown code or a reporter's code does not", async () => {
    const phone = browser(fetchApi);
    for (const code of ["nope", (SEEDED_SESSIONS[0] as { token: string }).token]) {
      const refused = await phone.call("POST", "/desk/session", { code });
      expect(refused.status).toBe(422);
      expect(refused.error.fields).toEqual([{ fieldId: "code", copyKey: "fieldError.staffCode.unknown", params: {} }]);
    }
    expect(phone.cookies.size).toBe(0);
    const signed = await phone.call("POST", "/desk/session", {
      code: ` ${(SEEDED_SESSIONS[2] as { token: string }).token} `,
    });
    expect(signed.status).toBe(204);
    expect((await phone.call("GET", "/desk/reports")).status).toBe(200);
    expect((await phone.call("DELETE", "/desk/session")).status).toBe(204);
    expect(phone.cookies.get("seeded_session")).toBe("");
  });

  test("the cookie is HttpOnly and SameSite Lax, Secure over https", async () => {
    const signIn = (origin: string) =>
      fetchApi(
        new Request(`${origin}/api/lapor/desk/session`, {
          method: "POST",
          headers: {
            "cf-connecting-ip": "198.51.100.77",
            origin: "http://localhost:5173",
            "x-lapor-client": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: (SEEDED_SESSIONS[2] as { token: string }).token }),
        }),
      );
    expect((await signIn("http://localhost")).headers.get("set-cookie")).toMatch(/; Path=\/; HttpOnly; SameSite=Lax$/);
    expect((await signIn("https://localhost")).headers.get("set-cookie")).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
  });

  test("with the upstream identity there is no seeded sign-in", async () => {
    const upstream = { ...bindings, settings: { ...bindings.settings, identityAdapter: "upstream" as const } };
    const phone = browser((request) => api.app.fetch(request, { ...upstream, db: testDatabase() }));
    expect((await phone.call("POST", "/desk/session", { code: "x" })).status).toBe(404);
  });

  test("an address is limited to 30 sign-ins an hour", async () => {
    const phone = browser(fetchApi);
    for (let attempt = 0; attempt < 30; attempt += 1) await phone.call("POST", "/desk/session", { code: "nope" });
    const refused = await phone.call("POST", "/desk/session", { code: "nope" });
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.staffSignIn");
  });
});
