import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { VIDEO } from "../../domain/video";
import { sweepCaseVideoUploads } from "../../services/caseVideos";
import { browser, freshNumber, manualClock, query, TEST_ORIGIN, testBindings, testDatabase } from "../../testing/api";
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
type Progress = { readonly id: string; readonly parts: number; readonly received: number[] };
const staff = (index: number): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const REGENCY = 3;
const DESK = 2;

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const MP4_EPOCH_S = 2_082_844_800;
// An MP4 of 12.5 s with its made time and, unless told, its point.
function movie(bytes: number, madeMs: number | null = clock.now() - 600_000, placed = true) {
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
    ...u32(madeMs === null ? 0 : madeMs / 1000 + MP4_EPOCH_S),
    ...u32(0),
    ...u32(1000),
    ...u32(12_500),
    ...(placed ? ascii("+05.1470+097.0482/") : []),
  ]);
  return file;
}

let village = "";
beforeAll(async () => {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

const HOUSE = {
  kind: "house",
  values: {
    headOfFamily: "Uji Satu",
    village: "Uji",
    district: "Baktiya",
    address: "Dusun Satu",
    damage: "heavy",
    flooded: true,
    occupancy: "displaced",
    people: 4,
  },
};
// A file of a sent flood, with a house and an evacuee's shelter in it.
async function fileWithHouse() {
  const reporter = browser(fetchApi);
  const started = await startDraft(reporter, freshNumber().typed);
  const told = await reporter.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir" }),
  );
  const ticket = await sendDraft(reporter, told.draft, village, { tick });
  const { fileId } = (await staff(REGENCY).call("POST", `/desk/reports/${ticket}/case`)).json as { fileId: string };
  const house = (await staff(REGENCY).call("POST", `/cases/${fileId}/records`, HOUSE)).json as { recordId: string };
  return { fileId, house: house.recordId };
}

const putPart = (path: string, bytes: Uint8Array, phone = staff(REGENCY)) => {
  const cookie = [...phone.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  return fetchApi(
    new Request(`http://localhost/api${path}`, {
      method: "PUT",
      headers: { "cf-connecting-ip": phone.address, origin: TEST_ORIGIN, "x-respon-client": "1", cookie },
      body: new Uint8Array(bytes),
    }),
  );
};

async function upload(base: string, file: Uint8Array, seconds: number | null = null) {
  const started = await staff(REGENCY).call("POST", base, { bytes: file.length, seconds });
  const progress = started.json as Progress;
  for (let n = 0; n < (progress.parts ?? 0); n += 1)
    await putPart(`${base}/${progress.id}/parts/${n}`, file.slice(n * VIDEO.partBytes, (n + 1) * VIDEO.partBytes));
  return { started, done: await staff(REGENCY).call("POST", `${base}/${progress.id}/complete`) };
}

describe("a record's video", () => {
  test("is sent in parts, read by its own bytes, kept with its record and played by range", async () => {
    const { fileId, house } = await fileWithHouse();
    const base = `/cases/${fileId}/records/${house}/videos`;
    expect((await staff(REGENCY).call("GET", base)).json).toEqual([]);
    const file = movie(VIDEO.partBytes + 2000);
    const started = await staff(REGENCY).call("POST", base, { bytes: file.length, seconds: 12.5 });
    const progress = started.json as Progress;
    expect(progress).toMatchObject({ parts: 2, received: [] });
    const first = await putPart(`${base}/${progress.id}/parts/0`, file.slice(0, VIDEO.partBytes));
    expect(((await first.json()) as Progress).received).toEqual([0]);
    expect(((await staff(REGENCY).call("GET", `${base}/${progress.id}`)).json as Progress).received).toEqual([0]);
    const early = await staff(REGENCY).call("POST", `${base}/${progress.id}/complete`);
    expect(early.error.fields[0]?.copyKey).toBe("fieldError.video.partsMissing");
    const cut = await putPart(`${base}/${progress.id}/parts/1`, file.slice(VIDEO.partBytes, VIDEO.partBytes + 10));
    expect(cut.status).toBe(422);
    expect((await putPart(`${base}/${progress.id}/parts/2`, file.slice(0, 10))).status).toBe(404);
    await putPart(`${base}/${progress.id}/parts/1`, file.slice(VIDEO.partBytes));
    const done = await staff(REGENCY).call("POST", `${base}/${progress.id}/complete`);
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json).toEqual([{ id: progress.id, seconds: 13, container: "mp4" }]);
    const view = (await staff(REGENCY).call("GET", `/cases/${fileId}`)).json as {
      records: { id: string; media: { id: string; kind: string; badge: string }[] }[];
    };
    expect(view.records.find((one) => one.id === house)?.media).toEqual([
      { id: progress.id, kind: "video", badge: "exif" },
    ]);
    const played = await staff(DESK).file(`/cases/${fileId}/media/${progress.id}`);
    expect([played.status, played.headers.get("content-type"), played.headers.get("accept-ranges")]).toEqual([
      200,
      "video/mp4",
      "bytes",
    ]);
    const part = await fetchApi(
      new Request(`http://localhost/api/cases/${fileId}/media/${progress.id}`, {
        headers: {
          "cf-connecting-ip": "2001:db8::1",
          "x-respon-client": "1",
          cookie: `seeded_session=${(SEEDED_SESSIONS[DESK] as { token: string }).token}`,
          range: "bytes=0-99",
        },
      }),
    );
    expect([part.status, part.headers.get("content-range")]).toEqual([206, `bytes 0-99/${file.length}`]);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  test("is refused when too big, too long, too many, not a video, or for a record that takes none", async () => {
    const { fileId, house } = await fileWithHouse();
    const base = `/cases/${fileId}/records/${house}/videos`;
    const refused = async (body: object) => (await staff(REGENCY).call("POST", base, body)).error.fields[0]?.copyKey;
    expect(await refused({ bytes: 10, seconds: null })).toBe("fieldError.video.tooBig");
    expect(await refused({ bytes: VIDEO.maxBytes + 1, seconds: null })).toBe("fieldError.video.tooBig");
    expect(await refused({ bytes: 5000, seconds: VIDEO.maxSeconds + 2 })).toBe("fieldError.video.tooLong");
    const junk = await upload(base, new Uint8Array(5000));
    expect(junk.done.error.fields[0]?.copyKey).toMatch(/^fieldError\.video\./);
    for (let n = 0; n < VIDEO.perReport; n += 1)
      expect((await upload(base, movie(5000, null, false))).done.status).toBe(200);
    expect(await refused({ bytes: 5000, seconds: null })).toBe("fieldError.video.tooMany");
    const [kept] = (await staff(REGENCY).call("GET", base)).json as { id: string }[];
    const taken = await staff(REGENCY).call("DELETE", `${base}/${kept?.id}`);
    expect((taken.json as unknown[]).length).toBe(VIDEO.perReport - 1);
    expect((await staff(REGENCY).call("DELETE", `${base}/${kept?.id}`)).status).toBe(404);
    const shelter = await staff(REGENCY).call("POST", `/cases/${fileId}/records`, {
      kind: "business",
      values: { type: "rice", village: "Uji", amount: 2, unit: "hectare" },
    });
    const other = `/cases/${fileId}/records/${(shelter.json as { recordId: string }).recordId}/videos`;
    expect((await staff(REGENCY).call("GET", other)).error.fields[0]?.copyKey).toBe("fieldError.video.notNow");
    expect((await staff(REGENCY).call("GET", `/cases/${fileId}/records/0123456789abcdef/videos`)).status).toBe(404);
    expect((await staff(REGENCY).call("GET", `${base}/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await staff(DESK).call("GET", base)).status).toBe(403);
    expect((await staff(REGENCY).call("POST", other, { bytes: 5000, seconds: null })).status).toBe(422);
    expect((await staff(REGENCY).call("DELETE", `${other}/${crypto.randomUUID()}`)).status).toBe(422);
    expect((await staff(REGENCY).call("GET", `${other}/${crypto.randomUUID()}`)).status).toBe(422);
    expect((await putPart(`${base}/${crypto.randomUUID()}/parts/0`, new Uint8Array(10))).status).toBe(404);
    expect((await staff(REGENCY).call("POST", `${base}/${crypto.randomUUID()}/complete`)).status).toBe(404);
  });

  test("a team member sends one too", async () => {
    const { fileId, house } = await fileWithHouse();
    const added = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: "Uji Anggota",
      number: "0800 1111 0007",
    });
    const member = browser(fetchApi);
    await member.call("POST", `/case-links/${(added.json as { link: string }).link.slice(-32)}`);
    const started = await member.call("POST", `/cases/${fileId}/records/${house}/videos`, {
      bytes: 5000,
      seconds: null,
    });
    expect(started.status, JSON.stringify(started.json)).toBe(200);
  });

  test("two at once on one record at most; a third waits", async () => {
    const { fileId, house } = await fileWithHouse();
    const base = `/cases/${fileId}/records/${house}/videos`;
    for (let n = 0; n < VIDEO.openUploads; n += 1)
      expect((await staff(REGENCY).call("POST", base, { bytes: 5000, seconds: null })).status).toBe(200);
    expect((await staff(REGENCY).call("POST", base, { bytes: 5000, seconds: null })).error.fields[0]?.copyKey).toBe(
      "fieldError.video.busy",
    );
    expect(await sweepCaseVideoUploads(bindings)).toBe(0);
    clock.advance(25 * 3_600_000);
    // The store failing to give one up does not keep its row.
    const failing = { ...bindings.photos, abortUpload: () => Promise.reject(new Error("gone")) };
    expect(await sweepCaseVideoUploads({ ...bindings, photos: failing })).toBeGreaterThanOrEqual(VIDEO.openUploads);
    expect((await staff(REGENCY).call("POST", base, { bytes: 5000, seconds: null })).status).toBe(200);
  });

  test("a third kept is refused even when both were sent at once", async () => {
    const { fileId, house } = await fileWithHouse();
    const base = `/cases/${fileId}/records/${house}/videos`;
    const open = async () => {
      const file = movie(5000, null, false);
      const started = (await staff(REGENCY).call("POST", base, { bytes: file.length, seconds: null })).json as Progress;
      await putPart(`${base}/${started.id}/parts/0`, file);
      return started.id;
    };
    const [a, b] = [await open(), await open()];
    expect((await staff(REGENCY).call("POST", `${base}/${a}/complete`)).status).toBe(200);
    for (let n = 1; n < VIDEO.perReport; n += 1)
      expect((await upload(base, movie(5000, null, false))).done.status).toBe(200);
    expect((await staff(REGENCY).call("POST", `${base}/${b}/complete`)).error.fields[0]?.copyKey).toBe(
      "fieldError.video.tooMany",
    );
  });
});
