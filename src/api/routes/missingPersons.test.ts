import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { anonymiseMissing } from "../../adapters/d1/missingPersons";
import { windowStart } from "../../domain/limits";
import { CHAT_PHOTO } from "../../domain/photoChecks";
import { hmacKey } from "../../platform/keys";
import { browser, freshNumber, losesOnce, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { cameraJpeg } from "../../testing/photoBase";
import { startDraft } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 60_000 });

// 17:00 WIB on 26 November 2026.
const clock = manualClock("2026-11-26T10:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);

type Phone = ReturnType<typeof browser>;
const signedIn = (index: number, fetcher = fetchApi): Phone => {
  const phone = browser(fetcher);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const national = () => signedIn(2);
const regency = () => signedIn(3);
const province = () => signedIn(4);

let village = "";
beforeAll(async () => {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

const FIELDS = {
  name: "Siti Aminah",
  nickname: "Ani",
  relation: "child",
  sex: "female",
  age: "12",
  clothes: "Kaos merah, celana biru",
  marks: "",
  lastSeenDate: "2026-11-25",
  lastSeenTime: "14:30",
  personNumber: "",
  contactNumber: "0812 3456 7890",
  waitPlace: "Posko Desa Uji",
};

const form = (change: Record<string, string> = {}, photo?: Uint8Array) => {
  const body = new FormData();
  for (const [key, value] of Object.entries({ ...FIELDS, villageCode: village, ...change })) body.set(key, value);
  if (photo) body.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
  return body;
};

const reporter = async () => {
  const phone = browser(fetchApi);
  await startDraft(phone, freshNumber().typed);
  return phone;
};

const sent = async (phone: Phone, photo?: Uint8Array) => {
  const answer = await phone.upload("/missing", form({}, photo));
  expect(answer.status, JSON.stringify(answer.json)).toBe(201);
  return (answer.json as { id: string }).id;
};

const ids = async (phone: Phone, search = "") => {
  const answer = await phone.call("GET", `/desk/missing${search}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return (answer.json as { items: { id: string }[] }).items.map((one) => one.id);
};

describe("a missing person reported from a phone", () => {
  test("is kept with its photo, listed in Laporan saya, and read by the desk of its region alone", async () => {
    const phone = await reporter();
    const id = await sent(phone, cameraJpeg());
    const mine = await phone.call("GET", "/missing/mine");
    expect(mine.json).toEqual([
      { id, name: "Siti Aminah", status: "open", villageName: expect.any(String), createdAt: expect.any(String) },
    ]);
    expect(await ids(regency())).toContain(id);
    expect(await ids(national())).toContain(id);
    expect(await ids(province())).not.toContain(id);
    expect(await ids(regency(), "?status=foundSafe")).not.toContain(id);
    expect(await ids(regency(), "?status=open")).toContain(id);

    const one = await regency().call("GET", `/desk/missing/${id}`);
    expect(one.json).toMatchObject({
      id,
      status: "open",
      name: "Siti Aminah",
      nickname: "Ani",
      relation: "child",
      age: 12,
      marks: null,
      lastSeen: { date: "2026-11-25", time: "14:30", zone: "WIB" },
      contactNumber: "+6281234567890",
      reporterName: "Uji Satu",
      hasPhoto: true,
      history: [{ status: "open", note: null, actor: null }],
    });
    expect((await province().call("GET", `/desk/missing/${id}`)).status).toBe(404);
    const photo = await regency().file(`/desk/missing/${id}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect((await province().file(`/desk/missing/${id}/photo`)).status).toBe(404);
  });

  test("from a signed-in session, listed for its own reporter alone", async () => {
    for (const index of [0, 1]) await startDraft(signedIn(index), freshNumber().typed);
    const id = await sent(signedIn(0));
    expect(((await signedIn(0).call("GET", "/missing/mine")).json as { id: string }[]).map((one) => one.id)).toContain(
      id,
    );
    expect(
      ((await signedIn(1).call("GET", "/missing/mine")).json as { id: string }[]).map((one) => one.id),
    ).not.toContain(id);
  });

  test("an empty photo box sends none; the desk has no photo to show", async () => {
    const phone = await reporter();
    const body = form();
    body.set("photo", new File([], "kosong.jpg", { type: "image/jpeg" }));
    const answer = await phone.upload("/missing", body);
    expect(answer.status).toBe(201);
    const { id } = answer.json as { id: string };
    expect((await regency().call("GET", `/desk/missing/${id}`)).json).toMatchObject({ hasPhoto: false });
    expect((await regency().file(`/desk/missing/${id}/photo`)).status).toBe(404);
  });

  test("is refused on its fields, its place, its photo, and from a phone that never reported", async () => {
    const phone = await reporter();
    const wrong = await phone.upload("/missing", form({ name: "", age: "200", waitPlace: "" }));
    expect(wrong.status).toBe(422);
    expect(wrong.error.fields).toEqual([
      { fieldId: "name", copyKey: "fieldError.missing.name", params: {} },
      { fieldId: "age", copyKey: "fieldError.missing.age", params: {} },
      { fieldId: "waitPlace", copyKey: "fieldError.missing.waitPlace", params: {} },
    ]);
    const nowhere = await phone.upload("/missing", form({ villageCode: "99.99.99.9999" }));
    expect(nowhere.error.error.code).toBe("missing.placeUnknown");
    for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(CHAT_PHOTO.maxBytes + 1)]) {
      const blurred = await phone.upload("/missing", form({}, bytes));
      expect(blurred.status).toBe(422);
      expect(blurred.error.fields).toEqual([{ fieldId: "photo", copyKey: "fieldError.missing.photo", params: {} }]);
    }
    expect((await browser(fetchApi).upload("/missing", form())).status).toBe(401);
    // A phone whose reporter was taken off it is asked to report first.
    const me = (await phone.call("GET", "/me")).json as { knownReporters: { profileId: string }[] };
    await phone.call("DELETE", `/me/profiles/${me.knownReporters[0]?.profileId}`, { confirm: true });
    const gone = await phone.upload("/missing", form());
    expect(gone.status).toBe(401);
    expect(gone.error.error.code).toBe("auth.signInFirst");
    expect(await phone.call("GET", "/missing/mine")).toMatchObject({ status: 200, json: [] });
  });

  test("five a day from one number; a sixth is refused and its photo not kept", async () => {
    const phone = await reporter();
    for (let n = 0; n < 5; n++) await sent(phone);
    const removed = vi.spyOn(bindings.photos, "delete");
    const sixth = await phone.upload("/missing", form({}, cameraJpeg()));
    expect(sixth.status).toBe(429);
    expect(sixth.error.error.code).toBe("missing.tooMany");
    expect(removed).toHaveBeenCalledWith([expect.stringMatching(/^missing\/.+\.jpg$/)]);
    removed.mockRestore();
    expect((await phone.upload("/missing", form())).status).toBe(429);
    expect((await phone.call("GET", "/missing/mine")).json).toHaveLength(5);
  });
});

describe("the desk's work on a missing person", () => {
  test("found safe with a note, no second outcome, open again, each in its history", async () => {
    const id = await sent(await reporter());
    const move = (to: string, note?: string, phone = regency()) =>
      phone.call("POST", `/desk/missing/${id}/status`, note === undefined ? { to } : { to, note });
    clock.advance(60_000);
    expect((await move("foundSafe", `  Ditemukan di posko ${"x".repeat(400)} `)).json).toEqual({ status: "foundSafe" });
    const refused = await move("closed");
    expect(refused.status).toBe(409);
    expect(refused.error.error.code).toBe("missing.moveRefused");
    expect((await move("open", "foundSafe", province())).status).toBe(404);
    clock.advance(60_000);
    expect((await move("open", "   ")).status).toBe(200);
    const one = (await regency().call("GET", `/desk/missing/${id}`)).json as {
      history: { status: string; note: string | null; actor: string | null }[];
    };
    expect(one.history.map((row) => [row.status, row.note?.length ?? null, row.actor])).toEqual([
      ["open", null, null],
      ["foundSafe", 300, "BPBD Kabupaten Uji Satu, Petugas Uji"],
      ["open", null, "BPBD Kabupaten Uji Satu, Petugas Uji"],
    ]);
    expect((await query`select closed_at from missing_person where id = ${id}`)[0]).toEqual({ closed_at: null });
  });

  test("two officers at once: the one who lost is told, and nothing is written twice", async () => {
    const id = await sent(await reporter());
    const racer = (request: Request) =>
      api.app.fetch(request, { ...bindings, db: losesOnce("update missing_person set status") } satisfies ApiBindings);
    const lost = await signedIn(3, racer).call("POST", `/desk/missing/${id}/status`, { to: "toSar" });
    expect(lost.error.error.code).toBe("missing.moveRefused");
    expect(await query`select 1 from missing_person_history where missing_id = ${id}`).toHaveLength(1);
  });

  test("unknown ids are not found; a reporter never reaches the desk", async () => {
    const unknown = crypto.randomUUID();
    expect((await regency().call("GET", `/desk/missing/${unknown}`)).status).toBe(404);
    expect((await regency().call("POST", `/desk/missing/${unknown}/status`, { to: "closed" })).status).toBe(404);
    const phone = await reporter();
    expect((await phone.call("GET", "/desk/missing")).status).toBe(401);
  });

  test("past the hourly limit the desk's reads and moves are refused", async () => {
    const id = await sent(await reporter());
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-bpbd-12");
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    for (const [limitId, count] of [
      ["desk.read", 1200],
      ["desk.write", 120],
    ] as const)
      await query`insert into rate_counter (limit_id, subject_key, window_start, count) values (${limitId}, ${key}, ${window}, ${count})
        on conflict do update set count = excluded.count`;
    for (const path of ["/desk/missing", `/desk/missing/${id}`])
      expect((await province().call("GET", path)).error.error.code, path).toBe("limit.desk.read");
    expect((await province().file(`/desk/missing/${id}/photo`)).status).toBe(429);
    const move = await province().call("POST", `/desk/missing/${id}/status`, { to: "closed" });
    expect(move.error.error.code).toBe("limit.desk.write");
    await query`delete from rate_counter where subject_key = ${key}`;
  });
});

describe("two years after it was closed", () => {
  test("a missing person keeps its village and outcome, and no name, number or photo", async () => {
    const id = await sent(await reporter(), cameraJpeg());
    const plain = await sent(await reporter());
    for (const one of [id, plain]) await regency().call("POST", `/desk/missing/${one}/status`, { to: "foundSafe" });
    const [{ key }] = (await query<{ key: string }>`select photo_key as key from missing_person where id = ${id}`) as [
      { key: string },
    ];
    const db = testDatabase();
    const later = new Date(clock.now() + 1000);
    expect(await anonymiseMissing(db, new Date(clock.now() - 1000), later, 100)).toBe(0);
    expect(await anonymiseMissing(db, later, later, 100)).toBeGreaterThan(0);
    const [row] = await query`select name, contact_number, photo_key, village_code, status, anonymised_at
      from missing_person where id = ${id}`;
    expect(row).toEqual({
      name: null,
      contact_number: null,
      photo_key: null,
      village_code: village,
      status: "foundSafe",
      anonymised_at: later.toISOString(),
    });
    expect(await query`select 1 from photo_removal where store_key = ${key}`).toHaveLength(1);
    expect(await query`select name from missing_person where id = ${plain}`).toEqual([{ name: null }]);
    // Anonymised, it moves no more.
    const move = await regency().call("POST", `/desk/missing/${id}/status`, { to: "open" });
    expect(move.error.error.code).toBe("missing.moveRefused");
  });
});
