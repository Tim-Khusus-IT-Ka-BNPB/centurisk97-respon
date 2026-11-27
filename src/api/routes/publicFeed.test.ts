import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskReportSchema } from "../../contract/desk";
import { type Feed, feedSchema, watchSchema } from "../../contract/publicFeed";
import { windowStart } from "../../domain/limits";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import {
  browser,
  freshAddress,
  freshNumber,
  manualClock,
  query,
  testBindings,
  testDatabase,
  testEdgeStore,
} from "../../testing/api";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

const signedIn = (index: number) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const desk = () => signedIn(2);
const otherProvince = () => signedIn(4);

let village = "";
let otherVillage = "";
beforeAll(async () => {
  const found = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = '11.08' order by v.code limit 2`;
  village = found[0]?.code as string;
  otherVillage = found[1]?.code as string;
});

// A flood report from a number of its own that says three died.
const sentReport = async (place = village, name = "Uji Satu") => {
  const phone = browser(fetchApi);
  const number = freshNumber();
  const started = await startDraft(phone, number.typed, name);
  const told = await phone.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir, tiga orang meninggal" }),
  );
  return { ticket: await sendDraft(phone, told.draft, place, { tick }), number: number.stored };
};
const revision = async (ticket: string) =>
  deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json).revision;
const move = async (ticket: string, to: string, extra: object = {}) => {
  tick();
  const moved = await desk().call("POST", `/desk/reports/${ticket}/status`, {
    to,
    revision: await revision(ticket),
    ...extra,
  });
  expect(moved.status, JSON.stringify(moved.json)).toBe(200);
};
const handled = async (ticket: string) => {
  await desk().call("POST", `/desk/reports/${ticket}/view`);
  await move(ticket, "under_review");
  await move(ticket, "in_handling", { actions: ["evakuasi"] });
};
const feed = async (query = "", phone = browser(fetchApi)) => {
  const answer = await phone.call("GET", `/feed${query}`);
  return { ...answer, feed: answer.status === 200 ? feedSchema.parse(answer.json) : (null as unknown as Feed) };
};
const proof = async (ticket: string) => {
  const form = new FormData();
  const photo = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 3_600_000, 420) });
  form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
  for (const [name, value] of Object.entries({
    lat: "5.14705",
    lon: "97.0482",
    accuracy: "20",
    readAt: String(clock.now() - 60_000),
  }))
    form.set(name, value);
  tick();
  const kept = deskReportSchema.parse((await desk().upload(`/desk/reports/${ticket}/proofs`, form)).json);
  return kept.proofs.at(-1)?.proofId as string;
};
const mark = (ticket: string, proofId: string, shown: boolean, phone = desk()) =>
  phone.call("POST", `/desk/reports/${ticket}/proofs/${proofId}/public`, { public: shown });

describe("the public feed", () => {
  test("shows a report only while it is handled or closed, never set aside, and nothing of its reporter", async () => {
    const { ticket, number } = await sentReport(village, "Uji Rahasia");
    const before = await feed();
    expect(before.status).toBe(200);
    expect(JSON.stringify(before.json)).not.toContain("Uji Rahasia");
    const count = before.feed.entries.length;
    await handled(ticket);
    const shown = await feed();
    expect(shown.feed.entries).toHaveLength(count + 1);
    const entry = shown.feed.entries[0];
    expect(entry).toMatchObject({
      hazardType: "flood",
      status: "in_handling",
      impact: { dead: 3 },
      reporters: null,
      proofs: [],
    });
    expect(entry?.place.regencyName).toBe("Aceh Utara");
    expect(entry?.centre).not.toBeNull();
    const text = JSON.stringify(shown.json);
    for (const hidden of ["Uji Rahasia", number, number.slice(3), ticket, "neighbourhood", "point"])
      expect(text).not.toContain(hidden);
    await move(ticket, "closed", { note: "Air sudah surut sepenuhnya" });
    expect((await feed()).feed.entries[0]).toMatchObject({ id: entry?.id, status: "closed" });

    const setAside = await sentReport();
    await desk().call("POST", `/desk/reports/${setAside.ticket}/view`);
    await move(setAside.ticket, "invalid", { note: "Laporan uji coba" });
    expect((await feed()).feed.entries.map((one) => one.id)).not.toContain(undefined);
    expect((await feed()).feed.entries).toHaveLength(count + 1);
  });

  test("reports of one event from two numbers are one entry, told by the newest handled", async () => {
    const first = await sentReport(otherVillage);
    const second = await sentReport(otherVillage);
    await handled(first.ticket);
    const alone = (await feed()).feed.entries[0];
    expect(alone?.reporters).toBe(2);
    await handled(second.ticket);
    const together = (await feed()).feed;
    expect(together.entries.filter((one) => one.id === alone?.id)).toHaveLength(1);
    expect(together.entries[0]).toMatchObject({ id: alone?.id, reporters: 2 });
    // The desk sees the cluster on each of its reports; another region's account sees none of it.
    const queued = (await desk().call("GET", `/desk/reports/${second.ticket}`)).json as { cluster: unknown };
    expect(queued.cluster).toEqual({
      tickets: [first.ticket, second.ticket],
      reporters: 2,
      strong: false,
      sameVillage: false,
    });
    const list = (await desk().call("GET", `/desk/reports?ticket=${first.ticket}`)).json as {
      items: { cluster: unknown }[];
    };
    expect(list.items[0]?.cluster).toEqual(queued.cluster);
    const elsewhere = (await otherProvince().call("GET", "/desk/reports")).json as { items: { cluster: unknown }[] };
    expect(elsewhere.items.every((item) => item.cluster === null)).toBe(true);
  });

  test("filters by hazard and province, and refuses any other query", async () => {
    const { ticket } = await sentReport();
    await handled(ticket);
    expect((await feed("?hazard=flood&province=11")).feed.entries.length).toBeGreaterThan(0);
    expect((await feed("?hazard=landslide")).feed.entries).toEqual([]);
    expect((await feed("?province=31")).feed.entries).toEqual([]);
    for (const refused of ["?hazard=other", "?province=1", "?name=x", "?hazard=flood&ticket=LA-1"])
      expect((await feed(refused)).status, refused).toBe(400);
  });

  test("a period shows the latest day with a report, or the last 3 or 7 days, or everything", async () => {
    const { ticket } = await sentReport();
    await handled(ticket);
    const all = (await feed()).feed.entries.length;
    expect(all).toBeGreaterThan(0);
    expect((await feed("?period=all")).feed.entries).toHaveLength(all);
    expect((await feed("?period=7")).feed.entries).toHaveLength(all);
    const now = clock.now();
    clock.set(now + 10 * 86_400_000);
    expect((await feed("?period=3")).feed.entries).toEqual([]);
    expect((await feed("?period=7")).feed.entries).toEqual([]);
    expect((await feed("?period=latest")).feed.entries.length).toBeGreaterThan(0);
    expect((await feed("?period=2")).status).toBe(400);
    clock.set(now);
  });

  test("a photo of the work shows only once an officer marks it, and goes when unmarked", async () => {
    const { ticket } = await sentReport();
    await handled(ticket);
    const proofId = await proof(ticket);
    const photo = (path = `/feed/proofs/${proofId}`) => browser(fetchApi).file(path);
    expect((await photo()).status).toBe(404);
    expect((await feed()).feed.entries[0]?.proofs).toEqual([]);

    expect((await mark(ticket, proofId, true, otherProvince())).status).toBe(404);
    expect((await mark("LA-010101-01", proofId, true)).status).toBe(404);
    const other = await sentReport();
    expect((await mark(other.ticket, proofId, true)).status).toBe(404);
    const marked = await mark(ticket, proofId, true);
    expect(marked.status).toBe(200);
    expect(deskReportSchema.parse(marked.json).proofs.at(-1)?.public).toBe(true);
    expect((await feed()).feed.entries[0]?.proofs).toEqual([proofId]);
    const shown = await photo();
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/jpeg");

    expect((await mark(ticket, proofId, false)).status).toBe(200);
    expect((await photo()).status).toBe(404);
    expect((await feed()).feed.entries[0]?.proofs).toEqual([]);
    expect(
      await query`select p.public, p.staff_label from proof_publication p join handling_proof h on h.id = p.proof_id
        where h.ticket_number = ${ticket} order by p.id`,
    ).toEqual([
      { public: 1, staff_label: "Pusdalops BNPB, Petugas Uji" },
      { public: 0, staff_label: "Pusdalops BNPB, Petugas Uji" },
    ]);
    expect((await photo(`/feed/proofs/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test("the 600th open in an hour from one address is the last", async () => {
    const phone = browser(fetchApi, freshAddress());
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.feed', ${key}, ${new Date(windowStart("clockHour", clock.now()))}, 599)`;
    expect((await feed("", phone)).status).toBe(200);
    const refused = await feed("", phone);
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.feed");
    expect((await phone.file(`/feed/proofs/${crypto.randomUUID()}`)).status).toBe(429);
  });
});

describe("the public feed at the edge", () => {
  test("is read once a minute for each filter at a data centre, every reader handed the kept one", async () => {
    // The cache's own clock, as the walk below moves the test's by minutes.
    const kept = manualClock("2026-11-24T03:00:00.000Z");
    const cached = testBindings({}, { clock, edge: testEdgeStore(kept) }).bindings;
    const cachedApi = (request: Request) =>
      api.app.fetch(request, { ...cached, db: testDatabase() } satisfies ApiBindings);
    const read = async (query = "") => feedSchema.parse((await browser(cachedApi).call("GET", `/feed${query}`)).json);
    const first = await read();
    const flood = await read("?hazard=flood&period=7");
    const [far] = await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
      where v.regency_code = '11.08' order by v.code limit 1 offset 9`;
    const { ticket } = await sentReport(far?.code);
    await handled(ticket);
    expect(await read()).toEqual(first);
    expect(await read("?hazard=flood&period=7")).toEqual(flood);
    expect((await read("?hazard=flood")).entries[0]?.status).toBe("in_handling");
    kept.advance(60_000);
    expect((await read()).entries).toHaveLength(first.entries.length + 1);
  });
});

describe("what is on watch", () => {
  test("the outlook's regencies at Waspada or above and the volcanoes at Siaga or Awas, each from its file", async () => {
    const phone = browser(fetchApi);
    const watch = watchSchema.parse((await phone.call("GET", "/feed/watch")).json);
    expect(watch.forecast?.regencies.map((one) => [one.regencyName, one.level])).toEqual([
      ["Kab. Bogor", 3],
      ["Kab. Aceh Utara", 2],
    ]);
    expect(watch.volcanoes?.counts).toEqual([42, 24, 3, 0]);
    expect(watch.volcanoes?.raised.map((one) => one.name)).toEqual(["Anak Krakatau", "Merapi", "Semeru"]);
    expect(watch.volcanoes?.source).toMatch(/^MAGMA Indonesia/);
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    const window = new Date(windowStart("clockHour", clock.now())).toISOString();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values ('address.feed', ${key}, ${window}, 600)
      on conflict do update set count = 600`;
    expect((await phone.call("GET", "/feed/watch")).status).toBe(429);
  });

  test("a file missing is cannot know, never calm", async () => {
    await query`delete from reference_file where name in ('forecast', 'volcanoes')`;
    expect((await browser(fetchApi).call("GET", "/feed/watch")).json).toEqual({ forecast: null, volcanoes: null });
  });
});
