import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DeskReport, deskReportSchema } from "../../contract/desk";
import { trackingSchema } from "../../contract/tracking";
import { windowStart } from "../../domain/limits";
import { hmacKey } from "../../platform/keys";
import { trackingToken } from "../../services/tracking";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft } from "../../testing/walk";
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

const sentReport = async () => {
  const phone = browser(fetchApi);
  return sendDraft(phone, await startDraft(phone, freshNumber().typed), village, { tick });
};
const read = async (ticket: string) =>
  deskReportSchema.parse((await deskOfficer().call("GET", `/desk/reports/${ticket}`)).json);
// A report an officer has opened.
const seenReport = async () => {
  const ticket = await sentReport();
  await deskOfficer().call("POST", `/desk/reports/${ticket}/view`);
  return ticket;
};
const move = async (ticket: string, to: string, note = "", revision?: number) => {
  tick();
  return deskOfficer().call("POST", `/desk/reports/${ticket}/status`, {
    to,
    note,
    revision: revision ?? (await read(ticket)).revision,
  });
};
const reply = (ticket: string, text: string) => deskOfficer().call("POST", `/desk/reports/${ticket}/replies`, { text });
const history = (ticket: string) =>
  query<{ from_status: string | null; to_status: string; note: string | null; actor_label: string | null }>`
    select from_status, to_status, note, actor_label from ticket_history where ticket_number = ${ticket} order by id`;
const actions = async (ticket: string) =>
  (await query<{ action: string }>`select action from staff_action where ticket_number = ${ticket} order by id`).map(
    (one) => one.action,
  );
const tracked = async (ticket: string) => {
  const [report] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
  const token = await trackingToken(bindings.settings.keyHmacSecret, report?.id as string);
  return trackingSchema.parse((await browser(fetchApi).call("POST", "/tracking", { token })).json);
};

describe("a ticket moved along", () => {
  test("holds its new status, one history row with the note, one logged action, and shows the reporter the stage", async () => {
    const ticket = await seenReport();
    const before = await read(ticket);
    expect(before.nextStatuses).toEqual([
      { status: "under_review", note: "optional" },
      { status: "invalid", note: "reason" },
    ]);
    const answer = await move(ticket, "under_review", " Dicek ke BPBD ");
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after: DeskReport = deskReportSchema.parse(answer.json);
    expect(after.status).toBe("under_review");
    expect(after.revision).toBe(before.revision + 1);
    expect(after.history.at(-1)).toMatchObject({
      status: "under_review",
      note: "Dicek ke BPBD",
      actor: "Pusdalops BNPB, Petugas Uji",
    });
    expect(await history(ticket)).toHaveLength(3);
    expect(await actions(ticket)).toEqual(["view", "status"]);
    const shown = await tracked(ticket);
    expect(shown.stages[2]).toMatchObject({ status: "under_review", reachedAt: { zone: "WIB" } });
    // Nothing staff wrote for themselves reaches the reporter.
    expect(JSON.stringify(shown)).not.toMatch(/Dicek ke BPBD|Petugas Uji/);
  });

  test("a move the table does not allow is refused and nothing is written", async () => {
    const ticket = await sentReport();
    const answer = await move(ticket, "in_handling", "Sudah berangkat");
    expect(answer.status).toBe(409);
    expect(answer.error.error.code).toBe("ticket.transitionRefused");
    expect(await history(ticket)).toHaveLength(1);
    expect(await actions(ticket)).toEqual([]);
    expect((await read(ticket)).status).toBe("new");
    expect((await move(ticket, "elsewhere")).status).toBe(400);
  });

  test("two officers at once: one moves it, the other is told what it became and writes nothing", async () => {
    const ticket = await seenReport();
    const { revision } = await read(ticket);
    const post = () =>
      deskOfficer().call("POST", `/desk/reports/${ticket}/status`, { to: "under_review", note: "", revision });
    const answers = await Promise.all([post(), post()]);
    expect(answers.map((one) => one.status).sort()).toEqual([200, 409]);
    const late = answers.find((one) => one.status === 409);
    expect(late?.error.error).toMatchObject({
      code: "ticket.changed",
      params: { status: "stage.short.under_review" },
    });
    expect((await history(ticket)).filter((row) => row.to_status === "under_review")).toHaveLength(1);
    expect(await actions(ticket)).toEqual(["view", "status"]);
    // A change made on an old reading is refused before it is tried.
    expect((await move(ticket, "in_handling", "Tim berangkat", revision)).error.error.code).toBe("ticket.changed");
  });

  test("reopening needs a note, named on its field; with one the later stages are ahead again", async () => {
    const ticket = await seenReport();
    for (const [to, note] of [
      ["under_review", ""],
      ["in_handling", "Tim berangkat"],
      ["closed", "Air sudah surut"],
    ] as const)
      expect((await move(ticket, to, note)).status, to).toBe(200);
    // Every stage done, each at its history row's time.
    const done = await tracked(ticket);
    const [...rows] = await query<{ to_status: string; at: string }>`
      select to_status, at from ticket_history where ticket_number = ${ticket} order by id`;
    expect(done.stages.map((stage) => [stage.status, stage.reachedAt?.utc])).toEqual(
      rows.map((row) => [row.to_status, row.at]),
    );
    const bare = await move(ticket, "under_review");
    expect(bare.status).toBe(422);
    expect(bare.error.fields).toEqual([
      { fieldId: "note", copyKey: "fieldError.required", params: { label: "desk.move.note.required" } },
    ]);
    expect((await move(ticket, "under_review", "Banjir datang lagi")).status).toBe(200);
    expect((await tracked(ticket)).stages.map((stage) => stage.reachedAt !== null)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  test("set aside needs a reason of 5 characters, which is all the reporter reads of it", async () => {
    const ticket = await seenReport();
    const short = await move(ticket, "invalid", "dup");
    expect(short.status).toBe(422);
    expect(short.error.fields).toEqual([
      { fieldId: "note", copyKey: "fieldError.staffReason.tooShort", params: { min: 5 } },
    ]);
    expect((await tracked(ticket)).rejected).toBeNull();
    expect((await move(ticket, "invalid", "Laporan ganda dari kejadian yang sama")).status).toBe(200);
    const shown = await tracked(ticket);
    expect(shown.rejected).toMatchObject({
      reason: "Laporan ganda dari kejadian yang sama",
      at: { zone: "WIB" },
    });
    expect(JSON.stringify(shown)).not.toContain("Petugas Uji");
    expect((await move(ticket, "under_review", "Ternyata kejadian lain")).status).toBe(200);
    expect((await tracked(ticket)).rejected).toBeNull();
  });
});

describe("a reply to the reporter", () => {
  test("is kept with its officer and time, and a seen ticket is under review", async () => {
    const ticket = await seenReport();
    tick();
    const answer = await reply(ticket, " Terima kasih, kami cek ");
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const report = deskReportSchema.parse(answer.json);
    expect(report.status).toBe("under_review");
    expect(report.replies).toEqual([
      {
        text: "Terima kasih, kami cek",
        actor: "Pusdalops BNPB, Petugas Uji",
        at: { utc: new Date(clock.now()).toISOString(), zone: "WIB" },
      },
    ]);
    expect(await actions(ticket)).toEqual(["view", "reply"]);
    // It does not reach the reporter's page yet.
    expect(JSON.stringify(await tracked(ticket))).not.toContain("kami cek");
  });

  test("on a ticket nobody opened passes through seen, so no stage is skipped", async () => {
    const ticket = await sentReport();
    tick();
    expect((await reply(ticket, "Kami cek")).status).toBe(200);
    expect((await history(ticket)).map((row) => [row.from_status, row.to_status])).toEqual([
      [null, "new"],
      ["new", "seen"],
      ["seen", "under_review"],
    ]);
  });

  test("later ones leave the status as it is", async () => {
    const ticket = await seenReport();
    await move(ticket, "under_review");
    await move(ticket, "in_handling", "Tim berangkat");
    tick();
    const report = deskReportSchema.parse((await reply(ticket, "Tim sudah jalan")).json);
    expect(report.status).toBe("in_handling");
    expect(await history(ticket)).toHaveLength(4);
  });

  test("an empty or too long one is refused on its field", async () => {
    const ticket = await seenReport();
    expect((await reply(ticket, "  ")).error.fields).toMatchObject([
      { fieldId: "reply", copyKey: "fieldError.required" },
    ]);
    const long = await reply(ticket, "a".repeat(1001));
    expect(long.status).toBe(422);
    expect(long.error.fields).toMatchObject([{ fieldId: "reply", copyKey: "fieldError.text.tooLong" }]);
    expect(await query`select 1 from report_reply where ticket_number = ${ticket}`).toEqual([]);
  });
});

describe("who may change a ticket", () => {
  const paths = (ticket: string) =>
    [
      [`/desk/reports/${ticket}/status`, { to: "under_review", note: "", revision: 1 }],
      [`/desk/reports/${ticket}/replies`, { text: "Kami cek" }],
    ] as const;

  test("signed out or as a reporter, no one", async () => {
    const ticket = await seenReport();
    for (const [path, body] of paths(ticket)) {
      expect((await browser(fetchApi).call("POST", path, body)).status).toBe(401);
      expect((await signedIn(0).call("POST", path, body)).status).toBe(401);
    }
    expect(await actions(ticket)).toEqual(["view"]);
  });

  test("an unknown ticket is not found", async () => {
    for (const [path, body] of paths("LA-010126-99"))
      expect((await deskOfficer().call("POST", path, body)).error.error.code).toBe("desk.reportNotFound");
  });

  test("past the hourly limit both are refused", async () => {
    const ticket = await seenReport();
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('desk.write', ${key}, ${window}, 120)
      on conflict do update set count = excluded.count`;
    for (const [path, body] of paths(ticket)) expect((await deskOfficer().call("POST", path, body)).status).toBe(429);
    await query`delete from rate_counter where subject_key = ${key}`;
  });
});
