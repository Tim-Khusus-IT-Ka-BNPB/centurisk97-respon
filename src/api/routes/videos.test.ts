import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { windowStart } from "../../domain/limits";
import { VIDEO } from "../../domain/video";
import { hmacKey } from "../../platform/keys";
import { sweepVideoUploads } from "../../services/videos";
import { browser, freshNumber, manualClock, query, TEST_ORIGIN, testBindings, testDatabase } from "../../testing/api";
import { walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";
import { rangeOf } from "./videos";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);
const VILLAGE = "11.08.03.2031";
const MB = 1_048_576;

type Phone = ReturnType<typeof browser>;
type Progress = { id: string; parts: number; partBytes: number; received: number[] };

async function atPhotos() {
  const phone = browser(fetchApi);
  const started = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Video",
    number: freshNumber().typed,
    privacyVersion: 2,
    agree: true,
  });
  const { draft } = await walkTo(phone, started.draft, VILLAGE, { tick, stopAt: (one) => one.card.kind === "photos" });
  return { phone, draft };
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
// An MP4 of this size whose movie header says 12.5 seconds.
function movie(bytes: number) {
  const file = new Uint8Array(bytes);
  file.set([
    ...u32(16),
    ...ascii("ftypisom"),
    ...u32(0),
    ...u32(24),
    ...ascii("mvhd"),
    0,
    0,
    0,
    0,
    ...u32(0),
    ...u32(0),
    ...u32(1000),
    ...u32(12_500),
  ]);
  return file;
}

// A part's raw bytes, as the page sends them.
const putPart = (phone: Phone, path: string, bytes: Uint8Array) => {
  const cookie = [...phone.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  return fetchApi(
    new Request(`http://localhost/api/lapor${path}`, {
      method: "PUT",
      headers: { "cf-connecting-ip": phone.address, origin: TEST_ORIGIN, "x-lapor-client": "1", cookie },
      body: new Uint8Array(bytes),
    }),
  );
};

async function upload(phone: Phone, draftId: string, file: Uint8Array, seconds: number | null = null) {
  const started = await phone.call("POST", `/drafts/${draftId}/videos`, { bytes: file.length, seconds });
  const progress = started.json as Progress;
  for (let n = 0; n < (progress.parts ?? 0); n += 1)
    await putPart(
      phone,
      `/drafts/${draftId}/videos/${progress.id}/parts/${n}`,
      file.slice(n * VIDEO.partBytes, (n + 1) * VIDEO.partBytes),
    );
  return { started, id: progress.id };
}

describe("a video of the scene", () => {
  test("sent in parts in any order, picked up where it stopped, made whole, kept, and played on the desk", async () => {
    const { phone, draft } = await atPhotos();
    const file = movie(6 * MB);
    const started = await phone.call("POST", `/drafts/${draft.draftId}/videos`, { bytes: file.length, seconds: null });
    expect(started.status).toBe(200);
    const { id } = started.json as Progress;
    expect(started.json).toEqual({ id, parts: 2, partBytes: 5 * MB, received: [] });
    const base = `/drafts/${draft.draftId}/videos/${id}`;
    // The second part first; then the line drops and the page asks what has landed.
    expect(await (await putPart(phone, `${base}/parts/1`, file.slice(5 * MB))).json()).toMatchObject({ received: [1] });
    expect((await phone.call("GET", base)).json).toMatchObject({ received: [1] });
    expect((await phone.call("POST", `${base}/complete`)).error.fields).toMatchObject([
      { fieldId: "video", copyKey: "fieldError.video.partsMissing" },
    ]);
    expect((await putPart(phone, `${base}/parts/0`, file.slice(0, 5 * MB - 1))).status).toBe(422);
    expect((await putPart(phone, `${base}/parts/2`, file.slice(0, 10))).status).toBe(404);
    await putPart(phone, `${base}/parts/0`, file.slice(0, 5 * MB));
    const kept = await phone.call("POST", `${base}/complete`);
    expect(kept.status).toBe(200);
    expect(kept.json).toEqual([{ id, seconds: 13, container: "mp4" }]);
    expect((await phone.call("GET", `/drafts/${draft.draftId}/videos`)).json).toEqual(kept.json);
    expect(await query`select 1 from video_upload where id = ${id}`).toEqual([]);

    // Sent with the report, the desk plays it, a range at a time.
    const { draft: summary } = await walkTo(phone, draft, VILLAGE, { tick });
    const sent = await phone.call("POST", `/drafts/${summary.draftId}/send`, {
      revision: summary.revision,
      turnKey: crypto.randomUUID(),
    });
    const ticket = (sent.json as { ticketNumber: string }).ticketNumber;
    const desk = browser(fetchApi);
    desk.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
    const report = (await desk.call("GET", `/desk/reports/${ticket}`)).json as { videos: unknown };
    expect(report.videos).toEqual([{ id, seconds: 13, container: "mp4" }]);
    const play = (range?: string) =>
      fetchApi(
        new Request(`http://localhost/api/lapor/desk/reports/${ticket}/videos/${id}`, {
          headers: {
            "cf-connecting-ip": desk.address,
            cookie: `seeded_session=${(SEEDED_SESSIONS[2] as { token: string }).token}`,
            ...(range ? { range } : {}),
          },
        }),
      );
    const whole = await play();
    expect([whole.status, whole.headers.get("content-type"), whole.headers.get("accept-ranges")]).toEqual([
      200,
      "video/mp4",
      "bytes",
    ]);
    expect((await whole.arrayBuffer()).byteLength).toBe(6 * MB);
    const part = await play("bytes=0-99");
    expect([part.status, part.headers.get("content-range"), (await part.arrayBuffer()).byteLength]).toEqual([
      206,
      `bytes 0-99/${6 * MB}`,
      100,
    ]);
    expect((await play()).status).toBe(200);
    // Another region's officer finds no such report; past the hourly limit the desk is refused.
    const province = (SEEDED_SESSIONS[4] as { token: string }).token;
    const elsewhere = await fetchApi(
      new Request(`http://localhost/api/lapor/desk/reports/${ticket}/videos/${id}`, {
        headers: { "cf-connecting-ip": desk.address, cookie: `seeded_session=${province}` },
      }),
    );
    expect(elsewhere.status).toBe(404);
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('desk.read', ${key}, ${window}, 1200)
      on conflict do update set count = excluded.count`;
    expect((await play()).status).toBe(429);
    await query`delete from rate_counter where subject_key = ${key}`;
    const other = await fetchApi(
      new Request(`http://localhost/api/lapor/desk/reports/${ticket}/videos/${crypto.randomUUID()}`, {
        headers: {
          "cf-connecting-ip": desk.address,
          cookie: `seeded_session=${(SEEDED_SESSIONS[2] as { token: string }).token}`,
        },
      }),
    );
    expect(other.status).toBe(404);
  });

  test("refused: too big, too long, not a video, and a fourth; a refused video leaves nothing behind", async () => {
    const { phone, draft } = await atPhotos();
    const start = (body: object) => phone.call("POST", `/drafts/${draft.draftId}/videos`, body);
    expect((await start({ bytes: 30 * MB + 1, seconds: null })).error.fields[0]?.copyKey).toBe(
      "fieldError.video.tooBig",
    );
    expect((await start({ bytes: 999, seconds: null })).status).toBe(422);
    expect((await start({ bytes: 5000, seconds: 62 })).error.fields[0]?.copyKey).toBe("fieldError.video.tooLong");
    const junk = await upload(phone, draft.draftId, new Uint8Array(5000).fill(7));
    const refused = await phone.call("POST", `/drafts/${draft.draftId}/videos/${junk.id}/complete`);
    expect(refused.error.fields[0]?.copyKey).toBe("fieldError.video.notVideo");
    expect(await query`select 1 from video_upload where id = ${junk.id}`).toEqual([]);
    for (let n = 0; n < 3; n += 1) {
      const one = await upload(phone, draft.draftId, movie(4000));
      expect((await phone.call("POST", `/drafts/${draft.draftId}/videos/${one.id}/complete`)).status).toBe(200);
    }
    expect((await start({ bytes: 5000, seconds: null })).error.fields[0]?.copyKey).toBe("fieldError.video.tooMany");
    const [first] = (await phone.call("GET", `/drafts/${draft.draftId}/videos`)).json as { id: string }[];
    const back = await phone.call("DELETE", `/drafts/${draft.draftId}/videos/${first?.id}`);
    expect(back.json).toHaveLength(2);
    expect((await phone.call("DELETE", `/drafts/${draft.draftId}/videos/${first?.id}`)).status).toBe(404);
  });

  test("two open at once at most; one with no new part for a day is given up by the sweep", async () => {
    const { phone, draft } = await atPhotos();
    const start = () => phone.call("POST", `/drafts/${draft.draftId}/videos`, { bytes: 5000, seconds: null });
    const [a, b] = [await start(), await start()];
    expect((await start()).error.fields[0]?.copyKey).toBe("fieldError.video.busy");
    clock.advance(24 * 3_600_000 + 1);
    // A store that cannot give the upload up still lets the row go.
    const failing = { ...bindings.photos, abortUpload: () => Promise.reject(new Error("gone")) };
    expect(await sweepVideoUploads({ ...bindings, photos: failing, db: testDatabase() })).toBeGreaterThanOrEqual(2);
    expect((await phone.call("GET", `/drafts/${draft.draftId}/videos`)).status).toBe(410);
    for (const one of [a, b])
      expect(await query`select 1 from video_upload where id = ${(one.json as Progress).id}`).toEqual([]);
  });

  test("a video is asked for only at the photo step, and only by its owner", async () => {
    const { phone, draft } = await atPhotos();
    const stranger = browser(fetchApi);
    expect(
      (await stranger.call("POST", `/drafts/${draft.draftId}/videos`, { bytes: 5000, seconds: null })).status,
    ).toBe(401);
    const { draft: summary } = await walkTo(phone, draft, VILLAGE, { tick });
    expect(summary.card.kind).toBe("summary");
    const late = await phone.call("POST", `/drafts/${draft.draftId}/videos`, { bytes: 5000, seconds: null });
    expect(late.error.fields[0]?.copyKey).toBe("fieldError.video.notNow");
  });
});

describe("whose and when", () => {
  test("another reporter's draft and an unknown upload are not found; a draft moved past photos takes none", async () => {
    const { phone, draft } = await atPhotos();
    const { phone: other } = await atPhotos();
    const base = `/drafts/${draft.draftId}/videos`;
    const open = await phone.call("POST", base, { bytes: 4000, seconds: null });
    const id = (open.json as Progress).id;
    for (const [method, path] of [
      ["POST", base],
      ["GET", base],
      ["GET", `${base}/${id}`],
      ["POST", `${base}/${id}/complete`],
      ["DELETE", `${base}/${id}`],
    ] as const)
      expect(
        (
          await other.call(
            method,
            path,
            method === "POST" && path === base ? { bytes: 4000, seconds: null } : undefined,
          )
        ).status,
        `${method} ${path}`,
      ).toBe(404);
    expect((await putPart(other, `${base}/${id}/parts/0`, movie(4000))).status).toBe(404);
    const unknown = crypto.randomUUID();
    expect((await phone.call("GET", `${base}/${unknown}`)).status).toBe(404);
    expect((await putPart(phone, `${base}/${unknown}/parts/0`, movie(4000))).status).toBe(404);
    expect((await phone.call("POST", `${base}/${unknown}/complete`)).status).toBe(404);

    await putPart(phone, `${base}/${id}/parts/0`, movie(4000));
    const { draft: summary } = await walkTo(phone, draft, VILLAGE, { tick });
    expect(summary.card.kind).toBe("summary");
    expect((await phone.call("POST", `${base}/${id}/complete`)).error.fields[0]?.copyKey).toBe(
      "fieldError.video.notNow",
    );
    expect(await query`select 1 from video_upload where id = ${id}`).toEqual([]);
    expect((await phone.call("DELETE", `${base}/${id}`)).error.fields[0]?.copyKey).toBe("fieldError.video.notNow");
  });

  test("a fourth made whole while three were sent is refused at its end", async () => {
    const { phone, draft } = await atPhotos();
    const base = `/drafts/${draft.draftId}/videos`;
    for (let n = 0; n < 2; n += 1) {
      const one = await upload(phone, draft.draftId, movie(4000));
      await phone.call("POST", `${base}/${one.id}/complete`);
    }
    const [third, fourth] = [
      await upload(phone, draft.draftId, movie(4000)),
      await upload(phone, draft.draftId, movie(4000)),
    ];
    expect((await phone.call("POST", `${base}/${third.id}/complete`)).status).toBe(200);
    expect((await phone.call("POST", `${base}/${fourth.id}/complete`)).error.fields[0]?.copyKey).toBe(
      "fieldError.video.tooMany",
    );
  });
});

describe("the store's ranges", () => {
  test("a key with no file has no range", async () => {
    expect(await bindings.photos.range(`videos/none/${crypto.randomUUID()}`, 0, 10)).toBeNull();
  });
});

describe("a range a player asks for", () => {
  test("a start and an end, a start alone, the last bytes, or none", () => {
    expect(rangeOf("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(rangeOf("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf("bytes=990-2000", 1000)).toEqual({ start: 990, end: 999 });
    expect(rangeOf("bytes=-2000", 1000)).toEqual({ start: 0, end: 999 });
    expect([
      rangeOf(undefined, 1000),
      rangeOf("bytes=-", 1000),
      rangeOf("bytes=5-1", 1000),
      rangeOf("items=0-1", 1000),
    ]).toEqual([null, null, null, null]);
  });
});
