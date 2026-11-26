import { describe, expect, test } from "vitest";
import type { DraftBody } from "../../contract/draft";
import { readExif } from "../../domain/jpeg";
import type { Database } from "../../platform/database";
import { runSweep } from "../../services/sweep";
import {
  browser,
  freshAddress,
  freshNumber,
  losesOnce,
  manualClock,
  query,
  TEST_ORIGIN,
  testBindings,
  testBucket,
  testDatabase,
} from "../../testing/api";
import { type ExifValues, exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
// A test may swap the database for one that loses a race; atPhotos puts the real one back.
let db: Database = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);

// Desa Cot Seumiyong, Aceh Utara (WIB). Its outline's centre is the report's place.
const VILLAGE = "11.08.03.2031";
const HERE = { lat: 5.14705, lon: 97.0482 };
const SIX_KM_NORTH = { lat: 5.20105, lon: 97.0482 };
const TWELVE_KM_NORTH = { lat: 5.25505, lon: 97.0482 };
const WIB = 420;
const camera = { make: "Uji", model: "Kamera" };

const tick = () => clock.advance(4000);
const justNow = () => exifDateTime(clock.now() - 20_000, WIB);

async function atPhotos(number = freshNumber().typed, phone = browser(fetchApi), village = VILLAGE) {
  db = testDatabase();
  const started = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number,
    privacyVersion: 2,
    agree: true,
  });
  const { draft } = await walkTo(phone, started.draft, village, {
    tick,
    stopAt: (current) => current.card.kind === "photos",
  });
  return { phone, draft, number };
}

type Device = { lat: number; lon: number; accuracy: number; readAt: number };

function photoForm(draft: DraftBody, bytes: Uint8Array, device: Device | null = null, turnKey = crypto.randomUUID()) {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
  form.set("revision", String(draft.revision));
  form.set("turnKey", turnKey);
  if (device) for (const [name, value] of Object.entries(device)) form.set(name, String(value));
  else for (const name of ["lat", "lon", "accuracy", "readAt"]) form.set(name, "");
  return form;
}

const fix = (point = HERE, accuracy = 30, ageMs = 60_000): Device => ({
  ...point,
  accuracy,
  readAt: clock.now() - ageMs,
});
const photosOf = (draft: DraftBody) => (draft.card.kind === "photos" ? draft.card.photos : []);
const send = (
  phone: Awaited<ReturnType<typeof atPhotos>>["phone"],
  draft: DraftBody,
  values: ExifValues,
  device: Device | null = null,
) => phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, cameraJpeg(values), device));

describe("photos", () => {
  test("a camera photo with good device GPS shows that badge, its time with the zone, and the camera as time source", async () => {
    const { phone, draft } = await atPhotos();
    expect(draft.card).toMatchObject({ kind: "photos", photos: [], max: 10, options: [{ id: "cannotSend" }] });
    const kept = await send(phone, draft, { ...camera, dateTime: justNow() }, fix());
    expect(kept.status).toBe(200);
    expect(photosOf(kept.draft)).toEqual([
      {
        photoId: expect.any(String),
        badge: "deviceGps",
        far: false,
        takenAt: { utc: new Date(clock.now() - 20_000).toISOString(), zone: "WIB" },
        timeSource: "photoData",
        point: { lat: HERE.lat, lon: HERE.lon },
        accuracyM: 30,
      },
    ]);
    expect(kept.draft.card).toMatchObject({ params: { count: 1, max: 10 }, options: [{ id: "continue" }] });
    // With no camera time, the device reading's time is used.
    const second = await send(phone, kept.draft, camera, fix());
    expect(photosOf(second.draft)[1]).toMatchObject({ timeSource: "deviceGps" });
  });

  test("each refused photo gives its own message and the count does not change; two failures show the earlier row", async () => {
    const { phone, draft } = await atPhotos();
    const cases: [ExifValues, Device | null, string][] = [
      [{ dateTime: justNow() }, null, "notCamera"],
      [{ ...camera, dateTime: exifDateTime(clock.now() - 6 * 60_000, WIB) }, null, "notFresh"],
      [{ ...camera, dateTime: justNow(), point: SIX_KM_NORTH }, fix(), "farFromDevice"],
      [{ dateTime: exifDateTime(clock.now() - 6 * 60_000, WIB) }, null, "notCamera"],
    ];
    for (const [values, device, rule] of cases) {
      const refused = await send(phone, draft, values, device);
      expect(refused.status, rule).toBe(422);
      expect(refused.error.fields).toEqual([{ fieldId: "photo", copyKey: `fieldError.photo.${rule}`, params: {} }]);
    }
    const png = new FormData();
    png.set("photo", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", { type: "image/png" }));
    png.set("revision", String(draft.revision));
    png.set("turnKey", crypto.randomUUID());
    expect((await phone.upload(`/drafts/${draft.draftId}/photos`, png)).error.fields[0]?.copyKey).toBe(
      "fieldError.photo.notCamera",
    );
    expect(await query`select 1 from draft_photo where draft_id = ${draft.draftId}`).toHaveLength(0);
  });

  test("weak GPS and no place in the photo keeps it without a place; the summary counts what the database holds", async () => {
    const { phone, draft } = await atPhotos();
    const first = await send(phone, draft, camera, fix(HERE, 1500));
    expect(photosOf(first.draft)[0]).toMatchObject({
      badge: "none",
      point: null,
      accuracyM: null,
      timeSource: "upload",
    });
    const second = await send(phone, first.draft, { ...camera, point: HERE });
    expect(photosOf(second.draft)[1]).toMatchObject({
      badge: "photoData",
      point: { lat: expect.closeTo(HERE.lat, 4) },
    });
    const summary = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(second.draft, { optionIds: ["continue"] }),
    );
    expect(summary.draft.card.kind).toBe("summary");
    const [counted] = await query<{ count: number; with_place: number }>`
      select count(*) as count, count(lat) as with_place from draft_photo where draft_id = ${draft.draftId}`;
    expect(summary.draft.card.kind === "summary" && summary.draft.card.photos).toEqual({
      count: counted?.count,
      withPlace: counted?.with_place,
    });
    expect(counted).toEqual({ count: 2, with_place: 1 });
  });

  test("a photo 12 km from the report's place is kept with the far badge", async () => {
    const { phone, draft } = await atPhotos();
    const far = await send(phone, draft, camera, fix(TWELVE_KM_NORTH));
    expect(photosOf(far.draft)[0]).toMatchObject({ badge: "deviceGps", far: true });
  });

  test("a phone clock in another zone, a network abroad, or a jump is marked on the photo, never refused (D11)", async () => {
    const { phone, draft } = await atPhotos();
    const first = photoForm(draft, cameraJpeg(camera), fix());
    first.set("zone", "Asia/Makassar");
    const kept = await phone.upload(`/drafts/${draft.draftId}/photos`, first);
    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    tick();
    // About 111 km north a minute later, from a network the edge reads as Singapore.
    const second = photoForm(kept.draft, cameraJpeg(camera), fix({ lat: HERE.lat + 1, lon: HERE.lon }, 30, 0));
    second.set("zone", "Asia/Jakarta");
    const headers = {
      "cf-connecting-ip": phone.address,
      origin: TEST_ORIGIN,
      "x-lapor-client": "1",
      "cf-ipcountry": "SG",
      cookie: [...phone.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    };
    const jumped = await fetchApi(
      new Request(`http://localhost/api/lapor/drafts/${draft.draftId}/photos`, {
        method: "POST",
        headers,
        body: second,
      }),
    );
    expect(jumped.status).toBe(200);
    tick();
    // A photo with a phone in the place's own zone, near the last one, raises no doubt.
    const calm = photoForm(
      (await jumped.json()) as DraftBody,
      cameraJpeg(camera),
      fix({ lat: HERE.lat + 1, lon: HERE.lon }),
    );
    calm.set("zone", "Asia/Jakarta");
    expect((await phone.upload(`/drafts/${draft.draftId}/photos`, calm)).status).toBe(200);
    expect(
      await query`select gps_doubts from draft_photo where draft_id = (select id from report_draft where id = ${draft.draftId})
        order by received_at, id`,
    ).toEqual([{ gps_doubts: '["zone"]' }, { gps_doubts: '["abroad","jump"]' }, { gps_doubts: null }]);
  });

  test("the 10th photo is kept, an 11th is refused, and the two step endings need photos or none", async () => {
    const { phone, draft } = await atPhotos();
    // The walk to the photo step spent most of this minute's messages.
    clock.advance(60_000);
    expect(
      (await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { optionIds: ["continue"] }))).status,
    ).toBe(409);
    let current = draft;
    for (let n = 1; n <= 10; n++) {
      const kept = await send(phone, current, camera);
      expect(kept.status, `photo ${n}`).toBe(200);
      current = kept.draft;
    }
    expect(photosOf(current)).toHaveLength(10);
    const eleventh = await send(phone, current, camera);
    expect(eleventh.error.fields[0]?.copyKey).toBe("fieldError.photo.tooMany");
    expect(
      (await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(current, { optionIds: ["cannotSend"] }))).status,
    ).toBe(409);
    const done = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(current, { optionIds: ["continue"] }));
    expect(done.draft.card.kind).toBe("summary");
    expect((await send(phone, done.draft, camera)).error.fields[0]?.copyKey).toBe("fieldError.photo.notNow");
  });

  test("a stored file opens for its own device only, and carries none of the photo's metadata", async () => {
    const { phone, draft, number } = await atPhotos();
    const kept = await send(phone, draft, { ...camera, point: HERE, dateTime: justNow() });
    const photoId = photosOf(kept.draft)[0]?.photoId as string;
    const path = `/drafts/${draft.draftId}/photos/${photoId}`;
    const own = await phone.file(path);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/jpeg");
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(readExif(own.bytes)).toBeNull();
    expect((await browser(fetchApi).file(path)).status).toBe(404);
    const other = browser(fetchApi);
    await other.call("POST", "/consent", { role: "citizen", name: "Uji Satu", number, privacyVersion: 2, agree: true });
    expect((await other.file(path)).status).toBe(404);
    expect((await phone.file(`/drafts/${draft.draftId}/photos/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await phone.file(`/drafts/${draft.draftId}/photos/not-an-id`)).status).toBe(400);
  });

  test("a retry with the same key replays, the key with another photo is refused, and an old revision is told it changed", async () => {
    const { phone, draft } = await atPhotos();
    const key = crypto.randomUUID();
    const bytes = cameraJpeg(camera);
    const first = await phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, bytes, null, key));
    const again = await phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, bytes, null, key));
    expect(again.json).toEqual(first.json);
    const other = await phone.upload(
      `/drafts/${draft.draftId}/photos`,
      photoForm(draft, cameraJpeg({ make: "Lain" }), null, key),
    );
    expect(other.status).toBe(422);
    const stale = await phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, bytes));
    expect(stale.status).toBe(409);
    expect(await query`select 1 from draft_photo where draft_id = ${draft.draftId}`).toHaveLength(1);
  });

  const takeBack = (
    phone: Awaited<ReturnType<typeof atPhotos>>["phone"],
    draft: DraftBody,
    photoId: string,
    turnKey = crypto.randomUUID(),
  ) => phone.call("DELETE", `/drafts/${draft.draftId}/photos/${photoId}`, { revision: draft.revision, turnKey });

  test("a photo sent by mistake is taken back with its file, and only by the one who sent it", async () => {
    const { phone, draft } = await atPhotos();
    const first = (await send(phone, draft, camera)).draft;
    const kept = (await send(phone, first, camera, fix())).draft;
    const [wrong, right] = photosOf(kept).map((photo) => photo.photoId) as [string, string];
    const stranger = browser(fetchApi);
    await stranger.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      number: freshNumber().typed,
      privacyVersion: 2,
      agree: true,
    });
    expect((await takeBack(stranger, kept, wrong)).status).toBe(404);
    expect((await takeBack(phone, kept, crypto.randomUUID())).status).toBe(404);
    expect((await takeBack(phone, first, wrong)).status).toBe(409);
    const key = crypto.randomUUID();
    const gone = await takeBack(phone, kept, wrong, key);
    expect(gone.status).toBe(200);
    expect(photosOf(gone.draft).map((photo) => photo.photoId)).toEqual([right]);
    expect(gone.draft.card).toMatchObject({ params: { count: 1, max: 10 } });
    // A retry replays; the key for another photo is refused.
    expect((await takeBack(phone, kept, wrong, key)).json).toEqual(gone.json);
    expect((await takeBack(phone, kept, right, key)).status).toBe(422);
    expect((await phone.file(`/drafts/${draft.draftId}/photos/${wrong}`)).status).toBe(404);
    await runSweep(bindings.db, bindings.photos, clock, bindings.log);
    expect(await testBucket().get(`photos/${draft.draftId}/${wrong}.jpg`)).toBeNull();
    expect(await testBucket().get(`photos/${draft.draftId}/${right}.jpg`)).not.toBeNull();
    const on = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(gone.draft, { kind: "answer", optionIds: ["continue"] }),
    );
    const late = await takeBack(phone, on.draft, right);
    expect([late.status, late.error.fields[0]?.copyKey]).toEqual([422, "fieldError.photo.notNow"]);
  });

  test("a photo is taken back once, and not past a limit", async () => {
    const { phone, draft } = await atPhotos();
    const kept = (await send(phone, draft, camera)).draft;
    const [only] = photosOf(kept).map((photo) => photo.photoId) as [string];
    db = losesOnce("delete from draft_photo");
    expect((await takeBack(phone, kept, only)).status).toBe(409);
    const key = crypto.randomUUID();
    db = losesOnce("delete from draft_photo", async (write) => void (await write()));
    const replayed = await takeBack(phone, kept, only, key);
    expect([replayed.status, photosOf(replayed.draft)]).toEqual([200, []]);
    await query`update rate_counter set count = 20 where limit_id = 'message.minute'`;
    expect((await takeBack(phone, replayed.draft, only)).status).toBe(429);
  });

  test("a cancelled draft takes its photos along, and the sweep deletes their files", async () => {
    const { phone, draft } = await atPhotos();
    const kept = await send(phone, draft, camera);
    const [photo] = await query<{
      store_key: string;
    }>`select store_key from draft_photo where draft_id = ${draft.draftId}`;
    const key = (photo as { store_key: string }).store_key;
    expect(await testBucket().get(key)).not.toBeNull();
    const asked = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(kept.draft, { kind: "cancel" }));
    await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(asked.draft, { kind: "confirm" }));
    expect(await query`select 1 from draft_photo where draft_id = ${draft.draftId}`).toHaveLength(0);
    expect(await query`select 1 from photo_removal where store_key = ${key}`).toHaveLength(1);
    const counts = await runSweep(bindings.db, bindings.photos, clock, bindings.log);
    expect(counts.photoFilesRemoved).toBeGreaterThanOrEqual(1);
    expect(await testBucket().get(key)).toBeNull();
    expect(await query`select 1 from photo_removal where store_key = ${key}`).toHaveLength(0);
  });

  test("a row that loses its race takes its file with it; a retry that won meanwhile replays", async () => {
    const { phone, draft } = await atPhotos();
    db = losesOnce("insert into draft_photo");
    const lost = await phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, cameraJpeg(camera)));
    expect(lost.status).toBe(409);
    expect(await query`select 1 from draft_photo where draft_id = ${draft.draftId}`).toHaveLength(0);
    expect(await query`select 1 from photo_removal where store_key like ${`photos/${draft.draftId}/%`}`).toHaveLength(
      0,
    );

    const key = crypto.randomUUID();
    // The same photo with the same key landed first: its own write runs, then this one loses.
    db = losesOnce("insert into draft_photo", async (write) => void (await write()));
    const fresh = (await phone.call("GET", `/drafts/${draft.draftId}`)).draft;
    const replayed = await phone.upload(
      `/drafts/${draft.draftId}/photos`,
      photoForm(fresh, cameraJpeg(camera), null, key),
    );
    expect(replayed.status).toBe(200);
    expect(photosOf(replayed.draft)).toHaveLength(1);
  });

  test("a photo for a draft not the caller's, past a limit, broken, or with its file gone is refused", async () => {
    const { phone, draft } = await atPhotos();
    const stranger = browser(fetchApi);
    await stranger.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      number: freshNumber().typed,
      privacyVersion: 2,
      agree: true,
    });
    expect(
      (await stranger.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, cameraJpeg(camera)))).status,
    ).toBe(404);

    // A file whose picture stops before its scan ends passes the checks and cannot be stripped.
    const whole = cameraJpeg({ ...camera, dateTime: justNow() });
    const cut = whole.subarray(0, whole.length - 4000);
    const broken = await phone.upload(`/drafts/${draft.draftId}/photos`, photoForm(draft, cut));
    expect(broken.error.fields[0]?.copyKey).toBe("fieldError.photo.broken");

    const kept = await send(phone, draft, camera);
    const photoId = photosOf(kept.draft)[0]?.photoId as string;
    const [row] = await query<{ store_key: string }>`select store_key from draft_photo where id = ${photoId}`;
    await testBucket().delete([(row as { store_key: string }).store_key]);
    expect((await phone.file(`/drafts/${draft.draftId}/photos/${photoId}`)).status).toBe(404);

    // The hourly limit of one address, reached by photos.
    const crowded = browser(fetchApi, freshAddress());
    const { draft: other } = await atPhotos(freshNumber().typed, crowded);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      select limit_id, subject_key, window_start, 10000 from rate_counter
      where limit_id = 'address.messages' and window_start = (select max(window_start) from rate_counter where limit_id = 'address.messages')
      on conflict do update set count = 10000`;
    const limited = await crowded.upload(`/drafts/${other.draftId}/photos`, photoForm(other, cameraJpeg(camera)));
    expect(limited.status).toBe(429);
  });

  test("a camera time with no offset is read in the page's own zone when it sends one", async () => {
    const { phone, draft } = await atPhotos();
    const form = photoForm(draft, cameraJpeg({ ...camera, dateTime: exifDateTime(clock.now() - 20_000, 480) }));
    form.set("offset", "480");
    const kept = await phone.upload(`/drafts/${draft.draftId}/photos`, form);
    expect(photosOf(kept.draft)[0]).toMatchObject({
      timeSource: "photoData",
      takenAt: { utc: new Date(clock.now() - 20_000).toISOString() },
    });
  });

  test("a village picked by search with no outline gives photos no far badge", async () => {
    const [plain] = await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
      where v.code <> ${VILLAGE} and v.regency_code = '11.08' order by v.code desc limit 1`;
    const code = (plain as { code: string }).code;
    await query`delete from place_village_shape where code = ${code}`;
    const { phone, draft } = await atPhotos(freshNumber().typed, browser(fetchApi), code);
    const kept = await send(phone, draft, camera, fix({ lat: 0.5, lon: 100 }));
    expect(photosOf(kept.draft)[0]).toMatchObject({ badge: "deviceGps", far: false });
  });

  test("the sweep removes the files of several photos in one batch", async () => {
    const { phone, draft } = await atPhotos();
    const one = await send(phone, draft, camera);
    await send(phone, one.draft, camera);
    const keys = (
      await query<{ store_key: string }>`select store_key from draft_photo where draft_id = ${draft.draftId}`
    ).map((photo) => photo.store_key);
    await query`delete from draft_photo where draft_id = ${draft.draftId}`;
    await runSweep(bindings.db, bindings.photos, clock, bindings.log);
    for (const key of keys) expect(await testBucket().get(key)).toBeNull();
  });
});
