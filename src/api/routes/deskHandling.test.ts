import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DeskReport, deskReportSchema, deskSummarySchema } from "../../contract/desk";
import { trackingSchema } from "../../contract/tracking";
import { trackingToken } from "../../services/tracking";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
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
const desk = () => signedIn(2);
const province = () => signedIn(4);

let village = "";
beforeAll(async () => {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

// A flood report that says three died.
const sentReport = async () => {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed);
  const told = await phone.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir, tiga orang meninggal" }),
  );
  return sendDraft(phone, told.draft, village, { tick });
};
const read = async (ticket: string): Promise<DeskReport> =>
  deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
const post = async (ticket: string, path: string, body: object, phone = desk()) => {
  tick();
  return phone.call("POST", `/desk/reports/${ticket}/${path}`, {
    revision: (await read(ticket)).revision,
    ...body,
  });
};
const move = (ticket: string, to: string, extra: object = {}) => post(ticket, "status", { to, ...extra });
// A report at the status named.
async function reportAt(status: "seen" | "under_review" | "in_handling"): Promise<string> {
  const ticket = await sentReport();
  await desk().call("POST", `/desk/reports/${ticket}/view`);
  if (status !== "seen") expect((await move(ticket, "under_review")).status).toBe(200);
  if (status === "in_handling") expect((await move(ticket, "in_handling", { actions: ["evakuasi"] })).status).toBe(200);
  return ticket;
}
const proofForm = (overrides: Record<string, string> = {}, bytes?: Uint8Array) => {
  const form = new FormData();
  const photo =
    bytes ?? cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 3_600_000, 420) });
  form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
  for (const [name, value] of Object.entries({
    lat: "5.14705",
    lon: "97.0482",
    accuracy: "20",
    readAt: String(clock.now() - 60_000),
    ...overrides,
  }))
    form.set(name, value);
  return form;
};
const upload = (ticket: string, form = proofForm(), phone = desk()) => {
  tick();
  return phone.upload(`/desk/reports/${ticket}/proofs`, form);
};
const token = async (ticket: string) => {
  const [report] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
  return trackingToken(bindings.settings.keyHmacSecret, report?.id as string);
};
const tracked = async (ticket: string) =>
  trackingSchema.parse((await browser(fetchApi).call("POST", "/tracking", { token: await token(ticket) })).json);
const actions = async (ticket: string) =>
  (await query<{ action: string }>`select action from staff_action where ticket_number = ${ticket} order by id`).map(
    (one) => one.action,
  );
const rowOf = (report: DeskReport, fieldId: string) =>
  report.groups.flatMap((group) => group.rows).find((row) => row.fieldId === fieldId);

describe("a check on site", () => {
  test("puts a figure right in a new version, told in the history, the reporter's own kept", async () => {
    const ticket = await reportAt("under_review");
    const before = await read(ticket);
    expect(before.revisable.find((one) => one.fieldId === "dead")).toMatchObject({ count: 3, unit: "people" });
    const answer = await post(ticket, "checks", {
      result: "partly",
      note: "Dicek ke kepala desa",
      boxes: { dead: "2", missing: "" },
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = deskReportSchema.parse(answer.json);
    expect(after.status).toBe("under_review");
    expect(after.impact.dead).toBe(2);
    expect(rowOf(after, "dead")).toMatchObject({
      value: { kind: "count", count: 2 },
      origin: "officer",
      quote: "Dicek ke kepala desa",
    });
    expect(after.history.at(-1)).toMatchObject({
      status: "under_review",
      event: "fieldCheck",
      note: "Dicek ke kepala desa",
      detail: { result: "partly", changes: [{ fieldId: "dead", from: 3, to: 2 }] },
    });
    const versions = await query<{ version: number; dead: number }>`
      select v.version, v.fields #> '{dead,value}' as dead from report_version v
      join report r on r.id = v.report_id where r.ticket_number = ${ticket} order by v.version`;
    expect(versions).toEqual([
      { version: 1, dead: 3 },
      { version: 2, dead: 2 },
    ]);
    expect(await query`select result, note, version from field_check where ticket_number = ${ticket}`).toEqual([
      { result: "partly", note: "Dicek ke kepala desa", version: 2 },
    ]);
    expect((await actions(ticket)).at(-1)).toBe("fieldCheck");
    // The queue and the counts read the newest figures too.
    await post(ticket, "checks", { result: "partly", note: "Semua selamat", boxes: { dead: "0" } });
    const held = deskSummarySchema.parse((await desk().call("GET", `/desk/summary?ticket=${ticket}`)).json).byHas;
    expect(held.victims).toBe(0);
  });

  test("that finds it right changes no value, and one on figures left as they were makes no version", async () => {
    const ticket = await reportAt("seen");
    const answer = await post(ticket, "checks", { result: "valid", note: "Sesuai laporan", boxes: { dead: "3" } });
    expect(answer.status).toBe(200);
    expect(deskReportSchema.parse(answer.json).status).toBe("seen");
    expect(await query`select version from field_check where ticket_number = ${ticket}`).toEqual([{ version: null }]);
  });

  test("valid with a figure changed, a wrong figure, and a short note are each refused on their field", async () => {
    const ticket = await reportAt("seen");
    const refused = async (body: object) => {
      const answer = await post(ticket, "checks", body);
      expect(answer.status).toBe(422);
      return answer.error.fields[0];
    };
    expect(await refused({ result: "valid", note: "Sesuai laporan", boxes: { dead: "2" } })).toMatchObject({
      fieldId: "result",
      copyKey: "fieldError.check.validWithChanges",
    });
    expect(await refused({ result: "partly", note: "Dicek", boxes: { dead: "dua" } })).toMatchObject({
      fieldId: "dead",
      copyKey: "fieldError.wholeNumber",
    });
    expect(await refused({ result: "valid", note: "Ok" })).toMatchObject({
      fieldId: "checkNote",
      copyKey: "fieldError.staffText.tooShort",
    });
    expect(await query`select 1 from field_check where ticket_number = ${ticket}`).toEqual([]);
  });

  test("that finds it not valid sets it aside, and the reporter reads the note", async () => {
    const ticket = await reportAt("under_review");
    const answer = await post(ticket, "checks", { result: "notValid", note: "Tidak ada kejadian di lokasi" });
    expect(deskReportSchema.parse(answer.json).status).toBe("invalid");
    expect((await tracked(ticket)).rejected).toMatchObject({ reason: "Tidak ada kejadian di lokasi" });
    // A report set aside is checked no more, nor is one never opened set aside by a check.
    const again = await post(ticket, "checks", { result: "valid", note: "Sesuai laporan" });
    expect(again.error.error.code).toBe("ticket.transitionRefused");
    const unopened = await sentReport();
    const early = await post(unopened, "checks", { result: "notValid", note: "Tidak ada kejadian" });
    expect(early.error.error.code).toBe("ticket.transitionRefused");
  });

  test("on an old reading, or at once with another, is refused with what the ticket became", async () => {
    const ticket = await reportAt("seen");
    const old = await post(ticket, "checks", { result: "valid", note: "Sesuai laporan", revision: 0 });
    expect(old.error.error).toMatchObject({ code: "ticket.changed", params: { status: "stage.short.seen" } });
    const { revision } = await read(ticket);
    const body = { result: "valid", note: "Sesuai laporan", revision };
    const both = await Promise.all([post(ticket, "checks", body), post(ticket, "checks", body)]);
    expect(both.map((one) => one.status).sort()).toEqual([200, 409]);
    expect(await query`select 1 from field_check where ticket_number = ${ticket}`).toHaveLength(1);
  });
});

describe("what was done", () => {
  test("is asked for when the work starts, from the hazard's actions or in other words", async () => {
    const ticket = await reportAt("under_review");
    const offered = (await read(ticket)).offeredActions;
    expect(offered).toContainEqual({ code: "evakuasi", label: "Evakuasi warga" });
    const bare = await move(ticket, "in_handling");
    expect(bare.status).toBe(422);
    expect(bare.error.fields).toEqual([{ fieldId: "actions", copyKey: "fieldError.actions.none", params: {} }]);
    const answer = await move(ticket, "in_handling", { actions: ["evakuasi"], otherAction: "Sedot sumur" });
    const report = deskReportSchema.parse(answer.json);
    expect(report.status).toBe("in_handling");
    expect(report.actions.map((one) => one.label)).toEqual(["Evakuasi warga", "Sedot sumur"]);
    expect(report.history.at(-1)).toMatchObject({
      event: "actions",
      detail: { actions: ["Evakuasi warga", "Sedot sumur"] },
    });
    expect((await actions(ticket)).slice(-2)).toEqual(["status", "handlingAction"]);
    expect((await tracked(ticket)).actions).toEqual(["Evakuasi warga", "Sedot sumur"]);
  });

  test("grows while the work goes on; one already told is kept once; on a report not handled it is refused", async () => {
    const ticket = await reportAt("in_handling");
    const answer = await post(ticket, "actions", { actions: ["logistik", "evakuasi"] });
    expect(deskReportSchema.parse(answer.json).actions.map((one) => one.label)).toEqual([
      "Evakuasi warga",
      "Distribusi logistik",
    ]);
    expect((await post(ticket, "actions", { actions: ["terbang"] })).error.fields).toMatchObject([
      { fieldId: "actions", copyKey: "fieldError.actions.unknown" },
    ]);
    const other = await reportAt("under_review");
    expect((await post(other, "actions", { actions: ["evakuasi"] })).error.error.code).toBe("ticket.transitionRefused");
    expect((await read(other)).actions).toEqual([]);
  });

  test("with no catalogue loaded only the officer's own words are taken", async () => {
    const [kept] = await query<{ body: string }>`select body from reference_file where name = 'responseActions'`;
    await query`delete from reference_file where name = 'responseActions'`;
    const ticket = await reportAt("under_review");
    expect((await read(ticket)).offeredActions).toEqual([]);
    expect((await move(ticket, "in_handling", { otherAction: "Evakuasi warga" })).status).toBe(200);
    await query`insert into reference_file (name, data_date, source, body, checksum, imported_at)
      values ('responseActions', 'versi 1', 'seed', ${kept?.body}, 'x', '2026-11-24T00:00:00.000Z')`;
  });
});

describe("photos of the work", () => {
  test("close a report with no reason, and the reporter's page shows them once it is closed", async () => {
    const ticket = await reportAt("in_handling");
    const bare = await move(ticket, "closed");
    expect(bare.error.fields).toEqual([
      { fieldId: "note", copyKey: "fieldError.closing.photoOrReason", params: { min: 5 } },
    ]);
    const answer = await upload(ticket);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [proof] = deskReportSchema.parse(answer.json).proofs;
    expect(proof).toMatchObject({ hasPoint: true, actor: "Pusdalops BNPB, Petugas Uji", at: { zone: "WIB" } });
    const id = proof?.proofId as string;
    const file = await desk().file(`/desk/proofs/${id}`);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect((await actions(ticket)).at(-1)).toBe("handlingProof");
    // Not on the tracking page, nor behind its link, before the report is closed.
    expect((await tracked(ticket)).proofs).toEqual([]);
    const link = { token: await token(ticket), proofId: id };
    expect((await browser(fetchApi).call("POST", "/tracking/photos", link)).status).toBe(404);
    expect((await move(ticket, "closed")).status).toBe(200);
    expect((await tracked(ticket)).proofs).toMatchObject([{ proofId: id }]);
    const shown = await browser(fetchApi).file("/tracking/photos", link);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/jpeg");
    // Another report's link, an unknown link and an unknown photo show nothing.
    for (const other of [
      { ...link, token: await token(await sentReport()) },
      { ...link, token: "0".repeat(32) },
      { ...link, token: "x" },
      { ...link, proofId: crypto.randomUUID() },
    ])
      expect((await browser(fetchApi).call("POST", "/tracking/photos", other)).status).toBe(404);
    await bindings.photos.delete([`handling/${ticket}/${id}.jpg`]);
    expect((await desk().call("GET", `/desk/proofs/${id}`)).status).toBe(404);
  });

  test("come from a camera, whole, and 10 at most; with no good reading no point is kept", async () => {
    const ticket = await reportAt("in_handling");
    const refused = async (form: FormData) => (await upload(ticket, form)).error.fields[0]?.copyKey;
    expect(await refused(proofForm({}, new Uint8Array(2000)))).toBe("fieldError.photo.proofFormat");
    const plain = cameraJpeg({});
    expect(await refused(proofForm({}, plain))).toBe("fieldError.photo.notCamera");
    const broken = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now(), 420) });
    expect(await refused(proofForm({}, broken.subarray(0, 1200)))).toBe("fieldError.photo.broken");
    const first = await upload(ticket, proofForm({ lat: "", lon: "", accuracy: "", readAt: "" }));
    expect(deskReportSchema.parse(first.json).proofs[0]?.hasPoint).toBe(false);
    for (let n = 1; n < 10; n += 1) expect((await upload(ticket)).status).toBe(200);
    expect(await refused(proofForm())).toBe("fieldError.photo.proofTooMany");
    expect((await read(ticket)).proofs).toHaveLength(10);
  });

  test("the last two at once keep one, and its file goes with the one refused", async () => {
    const ticket = await reportAt("in_handling");
    for (let n = 0; n < 9; n += 1) await upload(ticket);
    const both = await Promise.all([upload(ticket), upload(ticket)]);
    expect(both.map((one) => one.status).sort()).toEqual([200, 422]);
    expect((await read(ticket)).proofs).toHaveLength(10);
  });

  test("are taken only while the report is being handled", async () => {
    const ticket = await reportAt("under_review");
    expect((await upload(ticket)).error.error.code).toBe("ticket.transitionRefused");
  });
});

describe("who may work a report", () => {
  test("signed out no one, and an account of another region finds nothing", async () => {
    const ticket = await reportAt("in_handling");
    const proofId = deskReportSchema.parse((await upload(ticket)).json).proofs[0]?.proofId as string;
    const body = { result: "valid", note: "Sesuai laporan", revision: 9 };
    expect((await browser(fetchApi).call("POST", `/desk/reports/${ticket}/checks`, body)).status).toBe(401);
    for (const [path, sent] of [
      ["checks", body],
      ["actions", { actions: ["evakuasi"] }],
    ] as const)
      expect((await province().call("POST", `/desk/reports/${ticket}/${path}`, sent)).status).toBe(404);
    expect((await upload(ticket, proofForm(), province())).status).toBe(404);
    expect((await province().call("GET", `/desk/proofs/${proofId}`)).status).toBe(404);
    expect((await browser(fetchApi).call("GET", `/desk/proofs/${proofId}`)).status).toBe(401);
  });
});
