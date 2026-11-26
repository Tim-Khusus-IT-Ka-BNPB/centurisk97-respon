import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import {
  deskEmergenciesSchema,
  deskMapSchema,
  deskQueueSchema,
  deskReportSchema,
  deskSummarySchema,
} from "../../contract/desk";
import type { DraftBody } from "../../contract/draft";
import { trackingSchema } from "../../contract/tracking";
import { localClock } from "../../domain/eventTime";
import { windowStart } from "../../domain/limits";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchWith =
  (extra: Partial<ApiBindings> = {}) =>
  (request: Request) =>
    api.app.fetch(request, { ...bindings, ...extra, db: testDatabase() } satisfies ApiBindings);
const fetchApi = fetchWith();
const tick = () => clock.advance(4000);

const consentBody = (number?: string) => ({
  role: "citizen",
  name: "Uji Satu",
  ...(number === undefined ? {} : { number }),
  privacyVersion: 2,
  agree: true,
});
const sendBody = (draft: DraftBody) => ({ revision: draft.revision, turnKey: crypto.randomUUID() });

type Phone = ReturnType<typeof browser>;
const signedIn = (index: number): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const desk = () => signedIn(2);
// Desa Cot Seumiyong, Aceh Utara, inside its seed outline.
const HERE = { lat: 5.14705, lon: 97.0482, accuracyM: 12 };

const emergencies = async (phone = desk()) =>
  deskEmergenciesSchema.parse((await phone.call("GET", "/desk/emergencies")).json).emergencies;
// A phone whose owner has agreed before.
const boundPhone = async () => {
  const phone = browser(fetchApi);
  await startDraft(phone, freshNumber().typed);
  return phone;
};
const tap = (phone: Phone, point: object = HERE) => phone.call("POST", "/emergencies", point);

describe("an emergency told in the short conversation", () => {
  const walk = async (victims: string) => {
    const phone = browser(fetchApi);
    const started = await phone.call("POST", "/consent", { ...consentBody(freshNumber().typed), emergency: true });
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    let draft = started.draft;
    const send = async (body: Parameters<typeof turn>[1]) => {
      tick();
      const answer = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, body));
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      draft = answer.draft;
    };
    await send({ villageCode: "11.08.03.2031" });
    return { phone, draft: () => draft, send, victims };
  };

  test("asks what happened, whether anyone is hurt, and for photos, then goes to the desk as one", async () => {
    const { phone, draft, send } = await walk("yes");
    expect(draft().card).toMatchObject({
      kind: "choice",
      titleKey: "card.emergency.type.title",
      fieldId: "hazardType",
    });
    await send({ optionIds: ["flood"] });
    expect(draft().card).toMatchObject({
      kind: "choice",
      titleKey: "card.emergency.victims.title",
      fieldId: "emergencyVictims",
    });
    await send({ optionIds: ["yes"] });
    // Someone hurt: who is still trapped, and who needs medical help (K98).
    expect(draft().card).toMatchObject({
      kind: "choice",
      fieldId: "trapped",
      promptKey: "field.trapped.question.flood",
    });
    await send({ optionIds: ["seen"] });
    expect(draft().card).toMatchObject({ kind: "choice", fieldId: "medicalHelp" });
    await send({ optionIds: ["seriousInjuries"] });
    expect(draft().card.kind).toBe("photos");
    await send({ optionIds: ["cannotSend"] });
    expect(draft().card).toMatchObject({ kind: "summary", emergency: { victims: "yes" } });
    const sent = await phone.call("POST", `/drafts/${draft().draftId}/send`, sendBody(draft()));
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    const { ticketNumber } = sent.json as { ticketNumber: string };
    expect((await emergencies())[0]).toMatchObject({
      ticketNumber,
      kind: "chat",
      victims: "yes",
      hazardType: "flood",
      villageName: "Cot Seumiyong",
      sentAt: { zone: "WIB" },
    });
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticketNumber}`)).json);
    expect(report).toMatchObject({
      emergency: { kind: "chat", victims: "yes" },
      hazardSubtype: "unknown",
      eventTime: { kind: "dateTime", localDate: "2026-11-24", zone: "WIB" },
    });
    // Empty is not zero: what was not asked is not there.
    expect(report.impact.dead).toBeNull();
    const map = deskMapSchema.parse((await desk().call("GET", `/desk/map?ticket=${ticketNumber}`)).json);
    expect(map.points).toMatchObject([{ emergency: true }]);
  });

  test("leaves the alarm once an officer opens it", async () => {
    const { phone, draft, send } = await walk("no");
    for (const optionIds of [["earthquake"], ["no"], ["cannotSend"]]) await send({ optionIds });
    const sent = await phone.call("POST", `/drafts/${draft().draftId}/send`, sendBody(draft()));
    const { ticketNumber } = sent.json as { ticketNumber: string };
    const listed = async () => (await emergencies()).some((one) => one.ticketNumber === ticketNumber);
    expect(await listed()).toBe(true);
    const summary = deskSummarySchema.parse((await desk().call("GET", "/desk/summary?status=closed")).json);
    expect(summary.emergencies.some((one) => one.ticketNumber === ticketNumber)).toBe(true);
    await desk().call("POST", `/desk/reports/${ticketNumber}/view`);
    expect(await listed()).toBe(false);
  });

  test("a draft already open becomes one, its answers kept; a known reporter starts one with one tap", async () => {
    const phone = browser(fetchApi);
    const number = freshNumber().typed;
    const first = await startDraft(phone, number);
    tick();
    const placed = await phone.call(
      "POST",
      `/drafts/${first.draftId}/turns`,
      turn(first, { villageCode: "11.08.03.2031" }),
    );
    expect(placed.draft.card.kind).toBe("neighbourhood");
    const again = await phone.call("POST", "/consent", { ...consentBody(number), emergency: true });
    expect(again.draft.draftId).toBe(first.draftId);
    expect(again.draft.card).toMatchObject({ titleKey: "card.emergency.type.title" });
    const me = (await phone.call("GET", "/me")).json as { knownReporters: { profileId: string }[] };
    const started = await phone.call("POST", "/drafts", {
      profileId: me.knownReporters[0]?.profileId,
      replaceOpenDraft: true,
      emergency: true,
    });
    expect(started.status).toBe(201);
    const [row] = await query<{ fields: { emergency: unknown } }>`
      select fields from report_draft where id = ${(started.json as DraftBody).draftId}`;
    expect(row?.fields.emergency).toEqual({ victims: null });
  });
});

describe("one tap", () => {
  test("sends the phone's point under the reporter known there, with nothing else told", async () => {
    const phone = await boundPhone();
    const start = await phone.call("GET", "/emergencies/start");
    expect(start.json).toMatchObject({ name: "Uji Satu", contact: { level: "national" } });
    const sent = await tap(phone);
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    const body = sent.json as { ticketNumber: string; trackingToken: string; contact: { level: string } };
    expect(body.contact.level).not.toBe("national");
    expect((await emergencies())[0]).toMatchObject({
      ticketNumber: body.ticketNumber,
      kind: "oneTap",
      victims: "unknown",
      hazardType: "other",
      villageName: "Cot Seumiyong",
    });
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${body.ticketNumber}`)).json);
    expect(report).toMatchObject({ hazardSubtype: "unknown", emergency: { kind: "oneTap" } });
    const place = report.groups.flatMap((group) => group.rows).find((row) => row.fieldId === "place");
    expect(place).toMatchObject({ origin: "system", value: { precision: "gpsPoint", point: { accuracyM: 12 } } });
    const tracked = await browser(fetchApi).call("POST", "/tracking", { token: body.trackingToken });
    expect(trackingSchema.parse(tracked.json).hazardSubtype).toBeNull();
    // The next time, the place of the last report says who to call before the phone is read.
    expect((await phone.call("GET", "/emergencies/start")).json).toMatchObject({ contact: body.contact });
    // The conversation that was open is still there.
    const me = (await phone.call("GET", "/me")).json as { knownReporters: { openDraft: object | null }[] };
    expect(me.knownReporters[0]?.openDraft).not.toBeNull();
  });

  test("made with no signal: its kind and victims kept, its saved time a note only, and its id sends it once", async () => {
    const phone = await boundPhone();
    const clientId = crypto.randomUUID();
    const takenAtMs = clock.now() - 90 * 60_000;
    const offline = { ...HERE, hazardType: "flood", victims: "yes", takenAtMs, sentAtMs: clock.now(), clientId };
    const sent = await tap(phone, offline);
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    const body = sent.json as { ticketNumber: string; trackingToken: string };
    // Within 2 hours it still rings, marked as from offline.
    expect((await emergencies()).find((one) => one.ticketNumber === body.ticketNumber)).toMatchObject({
      kind: "oneTap",
      victims: "yes",
      hazardType: "flood",
    });
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${body.ticketNumber}`)).json);
    // The event is placed when it reached the desk; the phone's time is a note (LR-09).
    expect(report.eventTime).toMatchObject({ kind: "dateTime", localTime: localClock(clock.now(), "WIB") });
    expect(report.offline).toEqual({
      savedAt: { utc: new Date(takenAtMs).toISOString(), zone: "WIB" },
      late: false,
    });
    // The answer was lost and it is sent again: the same ticket, no second report.
    const again = await tap(phone, offline);
    expect([again.status, (again.json as { ticketNumber: string }).ticketNumber]).toEqual([201, body.ticketNumber]);
    expect((again.json as { trackingToken: string }).trackingToken).toBe(body.trackingToken);
    expect(await query`select count(*) as n from offline_send where client_id = ${clientId}`).toEqual([{ n: 1 }]);
  });

  test("its camera photos follow it, checked against when the phone saved it, at most 3, each kept once", async () => {
    clock.advance(31 * 60_000);
    const phone = await boundPhone();
    const clientId = crypto.randomUUID();
    const savedAt = clock.now() - 40 * 60_000;
    const sent = await tap(phone, { ...HERE, victims: "no", takenAtMs: savedAt, sentAtMs: clock.now(), clientId });
    const ticket = (sent.json as { ticketNumber: string }).ticketNumber;
    const jpeg = (takenMs: number) =>
      cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(takenMs, 420) });
    const photo = (
      index: number,
      bytes: Uint8Array,
      extra: Record<string, string> = {},
      from = phone,
      id = clientId,
    ) => {
      const form = new FormData();
      form.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
      form.set("index", String(index));
      for (const [name, value] of Object.entries(extra)) form.set(name, value);
      return from.upload(`/emergencies/${id}/photos`, form);
    };
    // Taken a minute before the save, forty minutes ago, with the phone's GPS read then: kept.
    const gps = { lat: "5.14705", lon: "97.0482", accuracy: "15", readAt: String(savedAt - 60_000), offset: "420" };
    const first = await photo(0, jpeg(savedAt - 60_000), gps);
    expect([first.status, first.json]).toEqual([201, { photos: 1 }]);
    // Sent again after a lost answer: kept once.
    expect((await photo(0, jpeg(savedAt - 60_000))).json).toEqual({ photos: 1 });
    // Taken 10 minutes before the save, or cut short: refused, and the report stays as it is.
    expect((await photo(1, jpeg(savedAt - 10 * 60_000))).error.fields[0]?.copyKey).toBe("fieldError.photo.notFresh");
    const whole = jpeg(savedAt);
    expect((await photo(1, whole.subarray(0, whole.length - 4000))).error.fields[0]?.copyKey).toBe(
      "fieldError.photo.broken",
    );
    expect((await photo(1, jpeg(savedAt + 60_000))).json).toEqual({ photos: 2 });
    expect((await photo(2, jpeg(savedAt))).json).toEqual({ photos: 3 });
    expect((await photo(3, jpeg(savedAt))).status).toBe(400);
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
    expect(report.photos.map((one) => one.badge).sort()).toEqual(["deviceGps", "none", "none"]);
    // A photo the report got some other way still counts toward the 3.
    await query`update draft_photo set id = lower(hex(randomblob(16)))
      where draft_id = (select draft_id from report where ticket_number = ${ticket})`;
    expect((await photo(0, jpeg(savedAt))).error.fields[0]?.copyKey).toBe("fieldError.photo.tooMany");
    // Another phone, a phone nobody agreed on, or an id never sent: no such report.
    expect((await photo(0, jpeg(savedAt), {}, await boundPhone())).status).toBe(404);
    expect((await photo(0, jpeg(savedAt), {}, signedIn(1))).status).toBe(404);
    expect((await photo(0, jpeg(savedAt), {}, phone, crypto.randomUUID())).status).toBe(404);
    // One sent at once has no save time: its photo is checked against now.
    const live = await boundPhone();
    const liveId = crypto.randomUUID();
    expect((await tap(live, { ...HERE, clientId: liveId })).status).toBe(201);
    expect((await photo(0, jpeg(clock.now() - 60_000), {}, live, liveId)).json).toEqual({ photos: 1 });
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('address.messages', ${key}, ${window}, 2000)
      on conflict do update set count = 2000`;
    expect((await photo(0, jpeg(savedAt))).error.error.code).toBe("limit.address.messages");
  });

  test("sent more than 2 hours after it was saved, by the phone's clock: marked late, and it does not ring", async () => {
    clock.advance(31 * 60_000);
    const phone = await boundPhone();
    // The phone's clock runs an hour slow; only the gap between its two times counts.
    const sentAtMs = clock.now() - 60 * 60_000;
    const late = await tap(phone, {
      ...HERE,
      victims: "yes",
      takenAtMs: sentAtMs - 2 * 3_600_000 - 1,
      sentAtMs,
      clientId: crypto.randomUUID(),
    });
    const ticket = (late.json as { ticketNumber: string }).ticketNumber;
    expect((await emergencies()).some((one) => one.ticketNumber === ticket)).toBe(false);
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
    expect(report.offline).toMatchObject({ late: true });
    expect(report.emergency).toMatchObject({ kind: "oneTap" });
  });

  test("a phone time that cannot be believed is no note and keeps the alarm; one sent at once is no kept report", async () => {
    clock.advance(31 * 60_000);
    const phone = await boundPhone();
    const sent = await tap(phone, {
      ...HERE,
      takenAtMs: clock.now() - 15 * 86_400_000,
      sentAtMs: clock.now(),
      clientId: crypto.randomUUID(),
    });
    const ticket = (sent.json as { ticketNumber: string }).ticketNumber;
    const report = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
    expect(report.eventTime).toMatchObject({ localTime: localClock(clock.now(), "WIB") });
    expect(report.offline).toEqual({ savedAt: null, late: false });
    expect((await emergencies()).some((one) => one.ticketNumber === ticket)).toBe(true);
    clock.advance(31 * 60_000);
    const live = await tap(phone, { ...HERE, clientId: crypto.randomUUID() });
    const liveReport = (
      await desk().call("GET", `/desk/reports/${(live.json as { ticketNumber: string }).ticketNumber}`)
    ).json as { offline: unknown };
    expect(liveReport.offline).toBeNull();
    expect((await tap(phone, { ...HERE, hazardType: "other" })).status).toBe(400);
  });

  test("opens again after 30 minutes, named in the refusal; two at once send one", async () => {
    const phone = await boundPhone();
    const both = await Promise.all([tap(phone), tap(phone)]);
    expect(both.map((one) => one.status).sort()).toEqual([201, 429]);
    const at = clock.now();
    clock.advance(10 * 60_000);
    const soon = await tap(phone);
    expect(soon.status).toBe(429);
    expect(soon.error.error.code).toBe("limit.oneTap.device");
    expect(soon.error.retryAt?.utc).toBe(new Date(at + 30 * 60_000).toISOString());
    clock.advance(20 * 60_000);
    expect((await tap(phone)).status).toBe(201);
  });

  test("is 3 a day for a number and 3 an hour from an address", async () => {
    const phone = await boundPhone();
    for (let n = 0; n < 3; n += 1) {
      expect((await tap(phone)).status).toBe(201);
      clock.advance(61 * 60_000);
    }
    expect((await tap(phone)).error.error.code).toBe("limit.oneTap.number");
    const shared = await boundPhone();
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(shared.address) as string);
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('address.oneTap', ${key}, ${window}, 3)`;
    expect((await tap(shared)).error.error.code).toBe("limit.address.oneTap");
  });

  test("a point outside Indonesia, or with no village near, is refused on the place; a failing place service too", async () => {
    const phone = await boundPhone();
    const refused = async (point: object, target = phone) => {
      const answer = await tap(target, point);
      expect(answer.status).toBe(422);
      return answer.error.fields[0];
    };
    expect(await refused({ lat: 48.8, lon: 2.3, accuracyM: 10 })).toMatchObject({
      fieldId: "place",
      copyKey: "fieldError.emergency.outside",
    });
    expect((await tap(phone, { lat: 500, lon: 2, accuracyM: 1 })).status).toBe(400);
    const faulty = browser(fetchWith({ settings: { ...bindings.settings, faultPlace: true } }), phone.address);
    for (const [name, value] of phone.cookies) faulty.cookies.set(name, value);
    expect(await refused(HERE, faulty)).toMatchObject({ copyKey: "fieldError.emergency.unavailable" });
  });

  test("a phone nobody has agreed on sends nothing and is kept nowhere", async () => {
    const stranger = browser(fetchApi);
    expect((await stranger.call("GET", "/emergencies/start")).status).toBe(401);
    expect((await tap(stranger)).status).toBe(401);
    const session = signedIn(1);
    expect((await session.call("GET", "/emergencies/start")).status).toBe(404);
    expect((await tap(session)).status).toBe(404);
  });

  test("a session's own reporter may, and is not marked as a typed number", async () => {
    const session = signedIn(0);
    await session.call("POST", "/consent", consentBody());
    const sent = await tap(session);
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    const { ticketNumber } = sent.json as { ticketNumber: string };
    const queue = deskQueueSchema.parse((await desk().call("GET", `/desk/reports?ticket=${ticketNumber}`)).json);
    expect(queue.items[0]).toMatchObject({ numberUnverified: false, emergency: { kind: "oneTap" } });
  });
});

describe("the desk's alarm", () => {
  test("is a regional account's own: another region's emergency never shows", async () => {
    const phone = await boundPhone();
    const { ticketNumber } = (await tap(phone)).json as { ticketNumber: string };
    const has = (list: { ticketNumber: string }[]) => list.some((one) => one.ticketNumber === ticketNumber);
    expect(has(await emergencies(signedIn(3)))).toBe(true);
    expect(has(await emergencies(signedIn(4)))).toBe(false);
  });

  test("is read by staff alone, 400 times an hour", async () => {
    expect((await browser(fetchApi).call("GET", "/desk/emergencies")).status).toBe(401);
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('desk.alarm', ${key}, ${window}, 400)
      on conflict do update set count = excluded.count`;
    expect((await desk().call("GET", "/desk/emergencies")).error.error.code).toBe("limit.desk.alarm");
    await query`delete from rate_counter where subject_key = ${key}`;
  });
});
