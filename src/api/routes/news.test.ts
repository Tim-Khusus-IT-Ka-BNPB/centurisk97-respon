import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskReportSchema } from "../../contract/desk";
import { meResponseSchema } from "../../contract/draft";
import { ownReportDetailSchema } from "../../contract/ownReport";
import { trackingToken } from "../../services/tracking";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

type Phone = ReturnType<typeof browser>;
const desk = (): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
  return phone;
};
// Desa Cot Seumiyong, Aceh Utara.
const VILLAGE = "11.08.03.2031";

async function sentReport() {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed);
  const told = await phone.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir, tiga orang meninggal" }),
  );
  return { phone, ticket: await sendDraft(phone, told.draft, VILLAGE, { tick }) };
}
const read = async (ticket: string) =>
  deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
const onDesk = async (ticket: string, path: string, body: object = {}) => {
  tick();
  const { revision } = await read(ticket);
  const answer = await desk().call("POST", `/desk/reports/${ticket}/${path}`, { revision, ...body });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
};
const own = async (phone: Phone, ticket: string) =>
  ownReportDetailSchema.parse((await phone.call("GET", `/reports/${ticket}`)).json);
const told = async (phone: Phone, ticket: string) =>
  (await own(phone, ticket)).news.items.map((item) => [
    item.kind,
    item.kind === "status"
      ? item.status
      : item.kind === "reply"
        ? item.text
        : item.kind === "actions"
          ? item.actions
          : 0,
    item.isNew,
  ]);
const unread = async (phone: Phone, ticket: string) =>
  meResponseSchema.parse((await phone.call("GET", "/me")).json).reports.find((report) => report.ticketNumber === ticket)
    ?.unread;
const notices = (ticket: string) =>
  query<{ kind: string }>`select kind from notice where ticket_number = ${ticket} order by id`;
const act = (phone: Phone, ticket: string, what: string) => {
  tick();
  return phone.call("POST", `/reports/${ticket}/news`, { act: what });
};

describe("news of a report", () => {
  test("everything staff do that the reporter is told is a notice, counted until read", async () => {
    const { phone, ticket } = await sentReport();
    expect([await unread(phone, ticket), await told(phone, ticket)]).toEqual([0, []]);
    await onDesk(ticket, "view");
    await onDesk(ticket, "view");
    await onDesk(ticket, "replies", { text: "Terima kasih, kami cek" });
    await onDesk(ticket, "checks", { result: "partly", note: "Dicek ke desa", boxes: { dead: "2" } });
    await onDesk(ticket, "checks", { result: "valid", note: "Dicek lagi" });
    await onDesk(ticket, "status", { to: "in_handling", actions: ["evakuasi"], note: "Catatan dalam" });
    await onDesk(ticket, "actions", { otherAction: "Membuka dapur umum" });
    expect(await told(phone, ticket)).toEqual([
      ["actions", ["Membuka dapur umum"], true],
      ["actions", ["Evakuasi warga"], true],
      ["status", "in_handling", true],
      ["correction", 0, true],
      ["reply", "Terima kasih, kami cek", true],
      ["status", "under_review", true],
      ["status", "seen", true],
    ]);
    const stored = await notices(ticket);
    expect(stored.map((one) => one.kind)).toEqual([
      "status",
      "status",
      "reply",
      "correction",
      "status",
      "actions",
      "actions",
    ]);
    expect(await unread(phone, ticket)).toBe(stored.length);
    const [correction] = (await own(phone, ticket)).news.items.filter((item) => item.kind === "correction");
    expect(correction).toMatchObject({ version: 2, changes: [{ fieldId: "dead" }] });

    expect((await act(phone, ticket, "read")).status).toBe(204);
    expect(await unread(phone, ticket)).toBe(0);
    expect((await told(phone, ticket)).every(([, , isNew]) => isNew === false)).toBe(true);
    await onDesk(ticket, "status", { to: "closed", note: "Air sudah surut" });
    expect(await unread(phone, ticket)).toBe(1);
    expect((await told(phone, ticket))[0]).toEqual(["status", "closed", true]);
    expect(await notices(ticket)).toHaveLength(8);
  });

  test("an officer is never named and a note stays with staff, but the reason a report is set aside", async () => {
    const { phone, ticket } = await sentReport();
    await onDesk(ticket, "view");
    await onDesk(ticket, "status", { to: "under_review", note: "Catatan rahasia" });
    await onDesk(ticket, "checks", { result: "notValid", note: "Tidak ada kejadian" });
    const body = JSON.stringify((await own(phone, ticket)).news);
    expect(body).not.toContain("rahasia");
    expect(body).not.toContain("Petugas Uji");
    expect((await own(phone, ticket)).news.items[0]).toMatchObject({ status: "invalid", reason: "Tidak ada kejadian" });
    expect((await notices(ticket)).map((one) => one.kind)).toEqual(["status", "status", "status"]);
  });

  test("the reporter's own news, and who took the report, are no notice", async () => {
    const { phone, ticket } = await sentReport();
    tick();
    const started = await phone.call("POST", `/reports/${ticket}/follow-ups`);
    const { draftId } = started.json as { draftId: string };
    const { draft } = await phone.call("GET", `/drafts/${draftId}`);
    const words = await phone.call(
      "POST",
      `/drafts/${draftId}/turns`,
      turn(draft, { kind: "freeText", text: "satu orang hilang" }),
    );
    tick();
    const sent = await phone.call("POST", `/drafts/${draftId}/send`, {
      revision: words.draft.revision,
      turnKey: crypto.randomUUID(),
    });
    expect(sent.status).toBe(201);
    expect([await told(phone, ticket), await notices(ticket)]).toEqual([[], []]);
  });

  test("a reply to a new report tells each step it took; replies of one moment stay in order", async () => {
    const { phone, ticket } = await sentReport();
    await onDesk(ticket, "replies", { text: "Kami terima" });
    expect((await told(phone, ticket)).map(([kind, what]) => [kind, what])).toEqual([
      ["reply", "Kami terima"],
      ["status", "under_review"],
      ["status", "seen"],
    ]);
    expect(await unread(phone, ticket)).toBe(3);
  });
});

describe("stopping the news", () => {
  test("no notice is written and nothing is marked, the words stay readable, and the desk is told", async () => {
    const { phone, ticket } = await sentReport();
    await onDesk(ticket, "view");
    expect((await act(phone, ticket, "stop")).status).toBe(204);
    const before = await notices(ticket);
    expect((await read(ticket)).newsStopped).toBe(true);
    await onDesk(ticket, "replies", { text: "Kami cek" });
    await onDesk(ticket, "status", { to: "in_handling", actions: ["evakuasi"] });
    await onDesk(ticket, "checks", { result: "partly", note: "Dicek ke desa", boxes: { dead: "1" } });
    await onDesk(ticket, "actions", { otherAction: "Membuka dapur umum" });
    expect(await notices(ticket)).toEqual(before);
    expect(await unread(phone, ticket)).toBe(0);
    const page = await own(phone, ticket);
    expect(page.news.stopped).toBe(true);
    expect(page.news.items.some((item) => item.isNew)).toBe(false);
    expect(page.news.items.filter((item) => item.kind === "reply")).toHaveLength(1);
    expect(page.tracking.stages.find((stage) => stage.status === "in_handling")?.reachedAt).not.toBeNull();

    expect((await act(phone, ticket, "start")).status).toBe(204);
    expect((await read(ticket)).newsStopped).toBe(false);
    // What came while it was stopped is not new now.
    expect(await unread(phone, ticket)).toBe(0);
    expect((await own(phone, ticket)).news.items.some((item) => item.isNew)).toBe(false);
    await onDesk(ticket, "status", { to: "closed", note: "Air sudah surut" });
    expect(await unread(phone, ticket)).toBe(1);
  });

  test("reading while it is stopped leaves it stopped", async () => {
    const { phone, ticket } = await sentReport();
    await act(phone, ticket, "stop");
    await act(phone, ticket, "read");
    expect((await own(phone, ticket)).news.stopped).toBe(true);
  });
});

describe("whose news it is", () => {
  test("another phone and a signed-out caller get none of it, and the tracking link shows a reply's words alone", async () => {
    const { phone, ticket } = await sentReport();
    await onDesk(ticket, "replies", { text: "Kami cek ke rumah Anda" });
    const other = browser(fetchApi);
    await startDraft(other, freshNumber().typed);
    for (const what of ["read", "stop", "start"]) expect((await act(other, ticket, what)).status).toBe(404);
    expect((await act(browser(fetchApi), ticket, "stop")).status).toBe(401);
    expect((await act(desk(), ticket, "stop")).status).toBe(404);
    expect((await act(phone, "LA-010101-01", "stop")).status).toBe(404);
    expect((await act(phone, ticket, "burn")).status).toBe(400);
    expect((await own(phone, ticket)).news.stopped).toBe(false);
    const [report] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    const token = await trackingToken(bindings.settings.keyHmacSecret, report?.id as string);
    const tracked = await browser(fetchApi).call("POST", "/tracking", { token });
    expect(tracked.status).toBe(200);
    expect(JSON.stringify(tracked.json)).toContain("Kami cek ke rumah Anda");
    expect(JSON.stringify(tracked.json)).not.toMatch(/Petugas Uji|Pusdalops/);
  });

  test("past the hourly limit it is told when to try again", async () => {
    const { phone, ticket } = await sentReport();
    expect((await act(phone, ticket, "read")).status).toBe(204);
    await query`update rate_counter set count = 120 where limit_id = 'news.hour'`;
    expect((await act(phone, ticket, "read")).error.error.code).toBe("limit.news.hour");
  });
});
