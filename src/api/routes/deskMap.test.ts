import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskGallerySchema, deskMapSchema, deskReportSchema } from "../../contract/desk";
import type { DraftBody } from "../../contract/draft";
import { windowStart } from "../../domain/limits";
import { hmacKey } from "../../platform/keys";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { sendDraft, startDraft, turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

// Desa Cot Seumiyong, Aceh Utara: its seed outline's centre and a point inside it.
const VILLAGE = "11.08.03.2031";
const INSIDE = { lat: 5.14705, lon: 97.0482 };

type Phone = ReturnType<typeof browser>;

const deskOfficer = () => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
  return phone;
};

// A report placed by searching the village, or by a GPS reading confirmed as that village.
async function report(how: "search" | "gps", photos = 0): Promise<string> {
  const phone = browser(fetchApi);
  let draft: DraftBody = await startDraft(phone, freshNumber().typed);
  if (how === "gps") {
    const read = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "locate", values: { lat: String(INSIDE.lat), lon: String(INSIDE.lon), accuracy: "12" } }),
    );
    draft = (await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(read.draft, { optionIds: ["confirm"] })))
      .draft;
  }
  if (photos > 0) {
    ({ draft } = await walkTo(phone, draft, VILLAGE, { tick, stopAt: (current) => current.card.kind === "photos" }));
    for (let n = 0; n < photos; n += 1) draft = await upload(phone, draft);
  }
  return sendDraft(phone, draft, VILLAGE, {
    tick,
    overrides: { photos: () => ({ optionIds: [photos > 0 ? "continue" : "cannotSend"] }) },
  });
}

async function upload(phone: Phone, draft: DraftBody): Promise<DraftBody> {
  const form = new FormData();
  const bytes = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 20_000, 420) });
  form.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
  form.set("revision", String(draft.revision));
  form.set("turnKey", crypto.randomUUID());
  for (const [name, value] of Object.entries({ ...INSIDE, accuracy: 30, readAt: clock.now() - 60_000 }))
    form.set(name, String(value));
  const answer = await phone.upload(`/drafts/${draft.draftId}/photos`, form);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return answer.draft;
}

describe("the desk map", () => {
  test("a GPS report sits at its reading, a searched one at its village's centre marked as village level", async () => {
    const gps = await report("gps");
    const searched = await report("search");
    const answer = await deskOfficer().call("GET", "/desk/map");
    expect(answer.status).toBe(200);
    const map = deskMapSchema.parse(answer.json);
    const [shape] = await query<{ centre_lat: number; centre_lon: number }>`
      select s.centre_lat, s.centre_lon from place_village_shape s join place_snapshot p on p.id = s.snapshot_id and p.active
      where s.code = ${VILLAGE}`;
    expect(map.points.find((point) => point.ticketNumber === gps)).toMatchObject({
      precision: "gpsPoint",
      lat: INSIDE.lat,
      lon: INSIDE.lon,
      villageName: "Cot Seumiyong",
      status: "new",
      hazardType: "flood",
    });
    expect(map.points.find((point) => point.ticketNumber === searched)).toMatchObject({
      precision: "villageLevel",
      lat: shape?.centre_lat,
      lon: shape?.centre_lon,
    });
    const [counted] = await query<{ total: number }>`select count(*) as total from report`;
    expect(map.points).toHaveLength(counted?.total as number);
    expect(map.cut).toBe(false);
  });

  test("a report carries its own point, and none where its village has no outline", async () => {
    const ticket = await report("gps");
    const read = async () =>
      deskReportSchema.parse((await deskOfficer().call("GET", `/desk/reports/${ticket}`)).json).point;
    expect(await read()).toMatchObject({ ticketNumber: ticket, precision: "gpsPoint", ...INSIDE });
    const other = await report("search");
    await query`update report set village_code = '11.08.03.9999' where ticket_number = ${other}`;
    const answer = await deskOfficer().call("GET", `/desk/reports/${other}`);
    expect(deskReportSchema.parse(answer.json).point).toBeNull();
    await query`update report set village_code = ${VILLAGE} where ticket_number = ${other}`;
  });

  test("the queue's filters apply, and a wrong ticket number is refused on its field", async () => {
    const ticket = await report("search");
    const map = deskMapSchema.parse((await deskOfficer().call("GET", `/desk/map?ticket=${ticket}`)).json);
    expect(map.points.map((point) => point.ticketNumber)).toEqual([ticket]);
    expect(deskMapSchema.parse((await deskOfficer().call("GET", "/desk/map?hazardType=drought")).json).points).toEqual(
      [],
    );
    expect((await deskOfficer().call("GET", "/desk/map?ticket=0800")).status).toBe(422);
    expect((await deskOfficer().call("GET", "/desk/photos?ticket=0800")).status).toBe(422);
  });

  test("past the hourly limit the map, the gallery and a photo are refused", async () => {
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('desk.read', ${key}, ${window}, 1200)
      on conflict (limit_id, subject_key, window_start) do update set count = excluded.count`;
    const id = crypto.randomUUID();
    for (const path of ["/desk/map", "/desk/photos", `/desk/photos/${id}`, `/desk/proofs/${id}`])
      expect((await deskOfficer().call("GET", path)).status).toBe(429);
    await query`delete from rate_counter where subject_key = ${key}`;
  });

  test("signed out or as a reporter there is no map, gallery or photo", async () => {
    for (const path of ["/desk/map", "/desk/photos", `/desk/photos/${crypto.randomUUID()}`])
      expect((await browser(fetchApi).call("GET", path)).status).toBe(401);
  });
});

describe("the gallery", () => {
  test("lists each photo with its badge and times, the report shows its own, and staff open the file", async () => {
    const ticket = await report("search", 1);
    const gallery = deskGallerySchema.parse((await deskOfficer().call("GET", `/desk/photos?ticket=${ticket}`)).json);
    expect(gallery.photos).toEqual([
      {
        photoId: expect.any(String),
        ticketNumber: ticket,
        badge: "deviceGps",
        far: false,
        takenAt: { utc: expect.any(String), zone: "WIB" },
        receivedAt: { utc: expect.any(String), zone: "WIB" },
        doubts: [],
      },
    ]);
    const photoId = gallery.photos[0]?.photoId as string;
    // A photo a GPS doubt was raised for says so.
    await query`update draft_photo set gps_doubts = '["zone"]' where id = ${photoId}`;
    const doubted = deskGallerySchema.parse((await deskOfficer().call("GET", `/desk/photos?ticket=${ticket}`)).json);
    expect(doubted.photos[0]?.doubts).toEqual(["zone"]);
    const detail = deskReportSchema.parse((await deskOfficer().call("GET", `/desk/reports/${ticket}`)).json);
    expect(detail.photos.map((photo) => photo.photoId)).toEqual([photoId]);
    const file = await deskOfficer().file(`/desk/photos/${photoId}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect([...file.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    // A device or a stranger cannot read it here.
    expect((await browser(fetchApi).file(`/desk/photos/${photoId}`)).status).toBe(401);
  });

  test("a photo with no sent report, or whose file is gone, is not found", async () => {
    expect((await deskOfficer().call("GET", `/desk/photos/${crypto.randomUUID()}`)).status).toBe(404);
    const ticket = await report("search", 1);
    const [photo] = await query<{ id: string; store_key: string }>`
      select p.id, p.store_key from draft_photo p join report r on r.draft_id = p.draft_id where r.ticket_number = ${ticket}`;
    await bindings.photos.delete([photo?.store_key as string]);
    expect((await deskOfficer().call("GET", `/desk/photos/${photo?.id}`)).status).toBe(404);
  });
});
