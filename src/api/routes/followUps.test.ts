import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DeskReport, deskQueueSchema, deskReportSchema, deskSummarySchema } from "../../contract/desk";
import type { DraftBody } from "../../contract/draft";
import { ownReportDetailSchema } from "../../contract/ownReport";
import type { Database } from "../../platform/database";
import { browser, freshNumber, losesOnce, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { pdfText } from "../../testing/documents";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { sendDraft, startDraft, turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const HOUR = 3_600_000;
const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
// A test may swap the database for one that loses a race.
let db: Database = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);
const tick = () => clock.advance(4000);

type Phone = ReturnType<typeof browser>;
const signedIn = (index: number): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const desk = () => signedIn(2);
// Desa Cot Seumiyong, Aceh Utara.
const VILLAGE = "11.08.03.2031";

// A sent flood report whose dead are not known, from a phone of its own.
async function sentReport(phone = browser(fetchApi), number = freshNumber().typed) {
  db = testDatabase();
  const ticket = await sendDraft(phone, await startDraft(phone, number), VILLAGE, {
    tick,
    overrides: {
      "numberForm:": () => ({ optionIds: ["allUnknown"] }),
      numberForm: () => ({ optionIds: ["allUnknown"] }),
    },
  });
  return { phone, ticket, number };
}

const start = (phone: Phone, ticket: string) => phone.call("POST", `/reports/${ticket}/follow-ups`);
async function opened(phone: Phone, ticket: string): Promise<DraftBody> {
  tick();
  const answer = await start(phone, ticket);
  expect(answer.status, JSON.stringify(answer.json)).toBe(201);
  return (await phone.call("GET", `/drafts/${(answer.json as { draftId: string }).draftId}`)).draft;
}
async function taken(phone: Phone, draft: DraftBody, body: Record<string, unknown>): Promise<DraftBody> {
  tick();
  const answer = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, body));
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return answer.draft;
}
const say = (phone: Phone, draft: DraftBody, text: string) => taken(phone, draft, { kind: "freeText", text });
const send = (phone: Phone, draft: DraftBody, turnKey = crypto.randomUUID()) => {
  tick();
  return phone.call("POST", `/drafts/${draft.draftId}/send`, { revision: draft.revision, turnKey });
};
const followUpOf = (draft: DraftBody) => (draft.card.kind === "summary" ? draft.card.followUp : null);
const own = async (phone: Phone, ticket: string) =>
  ownReportDetailSchema.parse((await phone.call("GET", `/reports/${ticket}`)).json);
const read = async (ticket: string): Promise<DeskReport> =>
  deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
const onDesk = async (ticket: string, path: string, body: object = {}) => {
  tick();
  const { revision } = await read(ticket);
  const answer = await desk().call("POST", `/desk/reports/${ticket}/${path}`, { revision, ...body });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
};
const versions = (ticket: string) =>
  query<{ version: number; fields: Record<string, { state: string; value?: unknown; quote?: string }> }>`
    select v.version, v.fields from report_version v join report r on r.id = v.report_id
    where r.ticket_number = ${ticket} order by v.version`;

describe("news for a sent report", () => {
  test("told in words it becomes version 2 with its quote, its change listed and the first version unchanged", async () => {
    const { phone, ticket } = await sentReport();
    const before = await versions(ticket);
    const draft = await opened(phone, ticket);
    expect(draft).toMatchObject({ state: "summary", followUpOf: ticket, canGoBack: false });
    expect(draft.card).toMatchObject({
      titleKey: "card.followUp.title",
      params: { ticketNumber: ticket },
      followUp: { ticketNumber: ticket, changes: [], mayAddPhotos: true },
    });
    const told = await say(phone, draft, "dua orang meninggal");
    expect(followUpOf(told)?.changes).toMatchObject([
      { fieldId: "dead", from: { state: "confirmedUnknown" }, to: { state: "value", value: { count: 2 } } },
    ]);

    const sent = await send(phone, told);
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    expect(sent.json).toMatchObject({ ticketNumber: ticket });
    const after = await versions(ticket);
    expect(after.map((one) => one.version)).toEqual([1, 2]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]?.fields.dead).toMatchObject({ value: 2, quote: "dua orang meninggal" });

    const report = await read(ticket);
    const row = report.history.at(-1);
    expect(row).toMatchObject({ status: "new", actor: null, event: "followUp", detail: { version: 2 } });
    expect(report.history).toHaveLength(2);
    expect(report.reporterWords.at(-1)?.text).toBe("dua orang meninggal");
    expect(report.impact.dead).toBe(2);
    const pdf = pdfText((await phone.file(`/reports/${ticket}/documents/2/pdf`)).bytes);
    expect(pdf).toContain("Isian Semula Menjadi Meninggal tidak tahu 2 orang Bencana");
    expect((await own(phone, ticket)).versions[0]).toMatchObject({ version: 2, madeBy: "reporter" });

    // The draft is over: it tells of its report, and a retry makes nothing more.
    const ended = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(ended.draft.card).toMatchObject({ kind: "followUpEnded", outcome: "sent", ticketNumber: ticket });
    expect((await send(phone, told)).status).toBe(200);
    expect(await versions(ticket)).toHaveLength(2);
  });

  test("a group picked asks only what may change, never the hazard, the place or the time", async () => {
    const { phone, ticket } = await sentReport();
    let draft = await opened(phone, ticket);
    const groups = draft.card.kind === "summary" ? draft.card.groups : [];
    expect(groups.find((group) => group.groupId === "event")?.rows.map((row) => row.fieldId)).toEqual(["chronology"]);
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "event" });
    expect(draft.card.kind).toBe("chronologyStep");
    draft = await taken(phone, draft, { kind: "back" });
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "displacement" });
    draft = await taken(phone, draft, { values: { displacedPeople: "30", displacedFamilies: "" } });
    // The count opens the question that follows it.
    expect(draft.card).toMatchObject({ kind: "textQuestion", fieldId: "shelters" });
    draft = await taken(phone, draft, { values: { shelters: "Balai desa" } });
    expect(followUpOf(draft)?.changes.map((change) => change.fieldId)).toEqual(["displacedPeople", "shelters"]);
    expect((await send(phone, draft)).status).toBe(201);
    const [, second] = await versions(ticket);
    expect(second?.fields).toMatchObject({
      displacedPeople: { value: 30 },
      displacedFamilies: { state: "confirmedUnknown" },
      shelters: { value: "Balai desa" },
    });
  });

  test("a correction an officer made meanwhile is kept; a check on the older values is refused", async () => {
    const { phone, ticket } = await sentReport();
    let draft = await say(phone, await opened(phone, ticket), "30 orang mengungsi");
    draft = await taken(phone, draft, { optionIds: ["unknown"] });
    await onDesk(ticket, "view");
    await onDesk(ticket, "checks", { result: "partly", note: "Dicek ke desa", boxes: { dead: "1" } });
    const stale = await read(ticket);
    expect((await send(phone, draft)).status).toBe(201);
    const [, , third] = await versions(ticket);
    expect(third?.fields).toMatchObject({ dead: { value: 1, origin: "officer" }, displacedPeople: { value: 30 } });
    const late = await desk().call("POST", `/desk/reports/${ticket}/checks`, {
      result: "partly",
      note: "Dicek lagi",
      boxes: { dead: "4" },
      revision: stale.revision,
    });
    expect(late.status).toBe(409);
    expect(await versions(ticket)).toHaveLength(3);
  });

  test("photos join the report, counted with the version they came with", async () => {
    const { phone, ticket } = await sentReport();
    let draft = await opened(phone, ticket);
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "photos" });
    expect(draft).toMatchObject({ state: "photos", card: { kind: "photos", max: 10 } });
    const form = new FormData();
    const photo = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 20_000, 420) });
    form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
    form.set("revision", String(draft.revision));
    form.set("turnKey", crypto.randomUUID());
    for (const name of ["lat", "lon", "accuracy", "readAt"]) form.set(name, "");
    draft = (await phone.upload(`/drafts/${draft.draftId}/photos`, form)).draft;
    draft = await taken(phone, draft, { optionIds: ["continue"] });
    expect(draft.card).toMatchObject({ kind: "summary", photos: { count: 1 }, followUp: { changes: [] } });
    expect((await send(phone, draft)).status).toBe(201);
    const report = await read(ticket);
    expect([report.photos.length, report.photoCount]).toEqual([1, 1]);
    expect((await desk().file(`/desk/photos/${report.photos[0]?.photoId}`)).status).toBe(200);
    const first = pdfText((await phone.file(`/reports/${ticket}/documents/1/pdf`)).bytes);
    expect(first).toContain("Pelapor tidak mengirim foto.");
    const second = pdfText((await phone.file(`/reports/${ticket}/documents/2/pdf`)).bytes);
    expect(second).toContain("Tidak ada isian yang berubah. 1 foto baru.");
    expect(second).toContain("Foto 1.");
  });

  test("a report holds twenty photos at most", async () => {
    const { phone, ticket } = await sentReport();
    const [report] = await query<{ draft_id: string }>`select draft_id from report where ticket_number = ${ticket}`;
    const add = async (n: number) => {
      for (let i = 0; i < n; i += 1)
        await query`insert into draft_photo (id, draft_id, store_key, bytes, badge, far, taken_at, time_source, received_at)
          values (${crypto.randomUUID()}, ${report?.draft_id}, ${crypto.randomUUID()}, 1000, 'none', 0,
            ${new Date(clock.now())}, 'upload', ${new Date(clock.now())})`;
    };
    await add(19);
    let draft = await opened(phone, ticket);
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "photos" });
    expect(draft.card).toMatchObject({ kind: "photos", max: 1 });
    const upload = async () => {
      tick();
      const form = new FormData();
      const photo = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 20_000, 420) });
      form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
      form.set("revision", String(draft.revision));
      form.set("turnKey", crypto.randomUUID());
      for (const name of ["lat", "lon", "accuracy", "readAt"]) form.set(name, "");
      return phone.upload(`/drafts/${draft.draftId}/photos`, form);
    };
    const kept = await upload();
    expect(kept.status).toBe(200);
    draft = kept.draft;
    const refused = await upload();
    expect([refused.status, refused.error.fields[0]?.copyKey]).toEqual([422, "fieldError.photo.tooMany"]);
    draft = await taken(phone, draft, { optionIds: ["continue"] });
    expect(followUpOf(draft)?.mayAddPhotos).toBe(false);
  });

  test("nothing new is nothing sent: an empty box or a value told again changes nothing", async () => {
    const { phone, ticket } = await sentReport();
    let draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    expect((await send(phone, draft)).status).toBe(201);
    draft = await opened(phone, ticket);
    draft = await say(phone, draft, "dua orang meninggal");
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "victims" });
    draft = await taken(phone, draft, { values: { dead: "", missing: "", injured: "tidak tahu" } });
    expect(followUpOf(draft)?.changes).toEqual([]);
    const answer = await send(phone, draft);
    expect([answer.status, answer.error.error.code]).toEqual([422, "followUp.nothingNew"]);
    expect(answer.error.draft?.draftId).toBe(draft.draftId);
    expect(await versions(ticket)).toHaveLength(2);
  });

  test("news an officer has already put right the same way is nothing new", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    await onDesk(ticket, "view");
    await onDesk(ticket, "checks", { result: "partly", note: "Dicek ke desa", boxes: { dead: "2" } });
    expect((await send(phone, draft)).error.error.code).toBe("followUp.nothingNew");
    expect(await versions(ticket)).toHaveLength(2);
  });

  test("a one-tap report may still be told its hazard, which the desk then shows", async () => {
    const { phone } = await sentReport();
    const tap = await phone.call("POST", "/emergencies", { lat: 5.14705, lon: 97.0482, accuracyM: 20 });
    expect(tap.status, JSON.stringify(tap.json)).toBe(201);
    const { ticketNumber: ticket } = tap.json as { ticketNumber: string };
    let draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    expect((await send(phone, draft)).status).toBe(201);
    expect((await read(ticket)).hazardType).toBe("other");
    draft = await opened(phone, ticket);
    draft = await taken(phone, draft, { kind: "editGroup", groupId: "event" });
    expect(draft.card).toMatchObject({ kind: "choice", fieldId: "hazardType" });
    draft = await taken(phone, draft, { optionIds: ["flood"] });
    expect(draft.card).toMatchObject({ kind: "choice", fieldId: "hazardSubtype" });
    ({ draft } = await walkTo(phone, draft, VILLAGE, { tick }));
    expect(
      followUpOf(draft)
        ?.changes.map((change) => change.fieldId)
        .slice(0, 3),
    ).toEqual(["hazardType", "hazardSubtype", "chronology"]);
    expect((await send(phone, draft)).status).toBe(201);
    const report = await read(ticket);
    expect([report.hazardType, report.emergency?.kind]).toEqual(["flood", "oneTap"]);
    expect((await own(phone, ticket)).tracking.hazardType).toBe("flood");
  });

  test("news is dropped after a confirm that names its report, which stays as it was", async () => {
    const { phone, ticket } = await sentReport();
    let draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    draft = await taken(phone, draft, { kind: "cancel" });
    expect(draft.card).toMatchObject({
      kind: "confirm",
      confirmId: "cancelFollowUp",
      params: { ticketNumber: ticket },
    });
    draft = await taken(phone, draft, { kind: "confirm" });
    expect(draft.card).toMatchObject({ kind: "followUpEnded", outcome: "cancelled" });
    expect(await versions(ticket)).toHaveLength(1);
    // It may be started again.
    expect((await opened(phone, ticket)).draftId).not.toBe(draft.draftId);
  });
});

describe("when news is taken", () => {
  const refusal = async (phone: Phone, ticket: string) => {
    const answer = await start(phone, ticket);
    return [answer.status, answer.error.error.code, answer.error.error.params.reason];
  };

  test("until the 72nd hour; at the 73rd it is refused with the reason, at the start and at the send", async () => {
    const { phone, ticket } = await sentReport();
    const [report] = await query<{ sent_at: string }>`select sent_at from report where ticket_number = ${ticket}`;
    const sentAt = Date.parse(report?.sent_at as string);
    expect((await own(phone, ticket)).followUp).toEqual({
      state: "open",
      until: { utc: new Date(sentAt + 72 * HOUR).toISOString(), zone: "WIB" },
    });
    const now = clock.now();
    clock.set(sentAt + 72 * HOUR - 30_000);
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    clock.set(sentAt + 73 * HOUR);
    const late = await send(phone, draft);
    expect([late.status, late.error.error.code, late.error.error.params.reason]).toEqual([
      409,
      "followUp.closed",
      "followUp.closed.tooLate",
    ]);
    expect(late.error.draft?.draftId).toBe(draft.draftId);
    expect(await versions(ticket)).toHaveLength(1);
    expect(await refusal(phone, ticket)).toEqual([409, "followUp.closed", "followUp.closed.tooLate"]);
    expect((await own(phone, ticket)).followUp).toEqual({ state: "closed", reason: "tooLate" });
    clock.set(now + 100 * HOUR);
  });

  test("not once the report is set aside", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    await onDesk(ticket, "view");
    await onDesk(ticket, "status", { to: "invalid", note: "Laporan ganda" });
    expect((await send(phone, draft)).error.error.params.reason).toBe("followUp.closed.ended");
    expect(await refusal(phone, ticket)).toEqual([409, "followUp.closed", "followUp.closed.ended"]);
  });

  test("not past ten versions", async () => {
    const { phone, ticket } = await sentReport();
    await query`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
        privacy_version, consent_agreed_at, complete_percent, created_at)
      select v.report_id, 10, v.fields, v.reporter_name, v.reporter_number, v.reporter_role, v.privacy_version,
        v.consent_agreed_at, v.complete_percent, v.created_at
      from report_version v join report r on r.id = v.report_id where r.ticket_number = ${ticket}`;
    expect(await refusal(phone, ticket)).toEqual([409, "followUp.closed", "followUp.closed.tooMany"]);
  });

  test("not while a report is being written on the phone; the refusal leads to it, and news resumes", async () => {
    const { phone, ticket, number } = await sentReport();
    tick();
    const writing = await startDraft(phone, number);
    const answer = await start(phone, ticket);
    expect([answer.status, answer.error.error.code, answer.error.error.params.draftId]).toEqual([
      409,
      "followUp.finishFirst",
      writing.draftId,
    ]);
    // Left alone for a day it has expired, and no longer stands in the way.
    clock.advance(25 * HOUR);
    const draft = await opened(phone, ticket);
    expect((await opened(phone, ticket)).draftId).toBe(draft.draftId);
    const me = await phone.call("GET", "/me");
    expect((me.json as { knownReporters: { openDraft: unknown }[] }).knownReporters[0]?.openDraft).toMatchObject({
      draftId: draft.draftId,
      followUpOf: ticket,
    });
    // A new report over open news asks first.
    const { profileId } = (me.json as { knownReporters: { profileId: string }[] }).knownReporters[0] as {
      profileId: string;
    };
    expect((await phone.call("POST", "/drafts", { profileId })).error.error.code).toBe("draft.openExists");
  });

  test("news that expired leads back to its report, which is as it was", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    clock.advance(25 * HOUR);
    const after = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(after.draft.card).toMatchObject({ kind: "followUpEnded", outcome: "cancelled", ticketNumber: ticket });
    expect((await send(phone, draft)).status).toBe(409);
    expect(await versions(ticket)).toHaveLength(1);
  });

  test("an emergency started over open news is an emergency; the news is dropped", async () => {
    const { phone, ticket, number } = await sentReport();
    const news = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    const answer = await phone.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Satu",
      number,
      privacyVersion: 1,
      agree: true,
      emergency: true,
    });
    expect(answer.status).toBe(201);
    expect(answer.draft).toMatchObject({ state: "place", followUpOf: null });
    expect((await phone.call("GET", `/drafts/${news.draftId}`)).draft.card).toMatchObject({ outcome: "cancelled" });
    expect(await versions(ticket)).toHaveLength(1);
  });

  test("not for a number removed from the phone", async () => {
    const { phone, ticket } = await sentReport();
    const me = (await phone.call("GET", "/me")).json as { knownReporters: { profileId: string }[] };
    const { profileId } = me.knownReporters[0] as { profileId: string };
    const draft = await opened(phone, ticket);
    expect((await phone.call("DELETE", `/me/profiles/${profileId}`, { confirm: true })).status).toBe(204);
    expect(await refusal(phone, ticket)).toEqual([409, "followUp.closed", "followUp.closed.noProfile"]);
    expect((await phone.call("GET", `/drafts/${draft.draftId}`)).draft.card).toMatchObject({
      kind: "followUpEnded",
      outcome: "cancelled",
    });
  });

  test("never from another phone, signed out or for a ticket that is not there, and nothing is written", async () => {
    const { phone, ticket } = await sentReport();
    const other = browser(fetchApi);
    await startDraft(other, freshNumber().typed);
    expect((await start(other, ticket)).status).toBe(404);
    expect((await start(browser(fetchApi), ticket)).status).toBe(401);
    expect((await start(desk(), ticket)).status).toBe(404);
    expect((await start(phone, "LA-010101-01")).status).toBe(404);
    expect(
      await query`select id from report_draft where follow_up_of is not null and state = 'summary'
      and follow_up_of = (select id from report where ticket_number = ${ticket})`,
    ).toEqual([]);
  });

  test("twenty starts a minute from one number, then it waits", async () => {
    const { phone, ticket } = await sentReport();
    clock.advance(120_000);
    await start(phone, ticket);
    await query`update rate_counter set count = 20 where limit_id = 'message.minute'`;
    expect((await start(phone, ticket)).error.error.code).toBe("limit.message.minute");
    clock.advance(120_000);
  });
});

describe("two at once", () => {
  test("two sends of one draft make one version; the same key replays, another key is told it is sent", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    const key = crypto.randomUUID();
    const answers = await Promise.all([send(phone, draft, key), send(phone, draft)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 201]);
    expect(await versions(ticket)).toHaveLength(2);
    const again = await send(phone, draft, key);
    expect([200, 422]).toContain(again.status);
  });

  test("a key used again for the same send replays it; for another draft revision it is refused", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    const key = crypto.randomUUID();
    expect((await send(phone, draft, key)).status).toBe(201);
    expect((await send(phone, draft, key)).status).toBe(200);
    const other = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: draft.revision + 1,
      turnKey: key,
    });
    expect([other.status, other.error.error.code]).toEqual([422, "turn.keyReused"]);
  });

  test("a send on an older revision is told the draft changed", async () => {
    const { phone, ticket } = await sentReport();
    const first = await opened(phone, ticket);
    await say(phone, first, "dua orang meninggal");
    expect((await send(phone, first)).status).toBe(409);
    expect(await versions(ticket)).toHaveLength(1);
  });

  test("a send or a start that loses its race decides again on what is there now", async () => {
    const { phone, ticket } = await sentReport();
    db = losesOnce("insert into report_draft");
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    db = losesOnce("update ticket set revision");
    expect((await send(phone, draft)).status).toBe(201);
    db = testDatabase();
    expect(await versions(ticket)).toHaveLength(2);
  });

  test("a draft removed with its number while its send is decided is not found", async () => {
    const { phone, ticket } = await sentReport();
    const draft = await say(phone, await opened(phone, ticket), "dua orang meninggal");
    db = losesOnce("update ticket set revision", async () => {
      await query`delete from draft_message where draft_id = ${draft.draftId}`;
      await query`delete from turn_reply where draft_id = ${draft.draftId}`;
      await query`delete from report_draft where id = ${draft.draftId}`;
    });
    expect((await send(phone, draft)).status).toBe(404);
    db = testDatabase();
    expect(await versions(ticket)).toHaveLength(1);
  });
});

describe("on the desk", () => {
  test("news marks the report until an officer acts on it; reading it or taking a copy is not acting", async () => {
    const { phone, ticket } = await sentReport();
    await onDesk(ticket, "view");
    expect((await read(ticket)).news).toBe(false);
    expect((await send(phone, await say(phone, await opened(phone, ticket), "dua orang meninggal"))).status).toBe(201);
    const listed = async () =>
      deskQueueSchema
        .parse((await desk().call("GET", "/desk/reports?has=news")).json)
        .items.map((item) => item.ticketNumber);
    const counted = async () => deskSummarySchema.parse((await desk().call("GET", "/desk/summary")).json).byHas.news;
    expect((await read(ticket)).news).toBe(true);
    expect(await listed()).toContain(ticket);
    expect(await counted()).toBe((await listed()).length);
    await onDesk(ticket, "view");
    expect((await desk().file(`/desk/reports/${ticket}/documents`, { version: 2, format: "pdf" })).status).toBe(200);
    expect((await read(ticket)).news).toBe(true);
    await onDesk(ticket, "status", { to: "under_review" });
    expect((await read(ticket)).news).toBe(false);
    expect(await listed()).not.toContain(ticket);
  });
});
