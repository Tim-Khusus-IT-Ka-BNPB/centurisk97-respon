import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskReportSchema } from "../../contract/desk";
import { ownReportDetailSchema } from "../../contract/ownReport";
import { LIMITS } from "../../domain/limits";
import { browser, freshNumber, manualClock, query, testBindings, testBucket, testDatabase } from "../../testing/api";
import { docxText, pdfText, unzipped } from "../../testing/documents";
import { exifDateTime } from "../../testing/jpegs";
import { cameraJpeg } from "../../testing/photoBase";
import { sendDraft, startDraft, turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

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
// A national desk officer, the BPBD of regency 11.08, and the BPBD of province 12.
const desk = () => signedIn(2);
const regency = () => signedIn(3);
const province = () => signedIn(4);

// Desa Cot Seumiyong, Aceh Utara.
const VILLAGE = "11.08.03.2031";
const NAME = "Cut Contoh Rahasia";

// A flood report that says three died, with this many photos.
async function sentReport(photos = 0): Promise<{ phone: Phone; ticket: string; number: string }> {
  const phone = browser(fetchApi);
  const number = freshNumber();
  const started = await startDraft(phone, number.typed, NAME);
  const told = await phone.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir, tiga orang meninggal" }),
  );
  let { draft } = await walkTo(phone, told.draft, VILLAGE, {
    tick,
    stopAt: (current) => current.card.kind === "photos",
  });
  for (let n = 0; n < photos; n += 1) {
    tick();
    const form = new FormData();
    const photo = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 20_000, 420) });
    form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
    form.set("revision", String(draft.revision));
    form.set("turnKey", crypto.randomUUID());
    for (const name of ["lat", "lon", "accuracy", "readAt"]) form.set(name, "");
    draft = (await phone.upload(`/drafts/${draft.draftId}/photos`, form)).draft;
  }
  const ticket = await sendDraft(phone, draft, VILLAGE, {
    tick,
    overrides: { photos: () => ({ optionIds: [photos > 0 ? "continue" : "cannotSend"] }) },
  });
  return { phone, ticket, number: number.stored };
}

const own = (phone: Phone, ticket: string, version = 1, format = "pdf") =>
  phone.file(`/reports/${ticket}/documents/${version}/${format}`);
const staffCopy = (phone: Phone, ticket: string, version = 1, format = "pdf") =>
  phone.file(`/desk/reports/${ticket}/documents`, { version, format });
const correct = async (ticket: string, boxes: object) => {
  tick();
  const { revision } = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
  const answer = await desk().call("POST", `/desk/reports/${ticket}/checks`, {
    result: "partly",
    note: "Dicek ke kantor desa",
    boxes,
    revision,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
};
const actions = async (ticket: string) =>
  (await query<{ action: string }>`select action from staff_action where ticket_number = ${ticket} order by id`).map(
    (one) => one.action,
  );

describe("a report as a file", () => {
  test("its reporter downloads both formats, with every value and where it came from, and nobody named", async () => {
    const { phone, ticket, number } = await sentReport();
    const pdf = await own(phone, ticket);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe(`attachment; filename="Laporan ${ticket} versi 1.pdf"`);
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    expect(pdf.headers.get("x-robots-tag")).toBe("noindex");
    const docx = await own(phone, ticket, 1, "docx");
    expect(docx.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    for (const text of [pdfText(pdf.bytes), await docxText(docx.bytes)]) {
      for (const words of [
        ticket,
        "Bencana Banjir",
        "Desa/Kel. Cot Seumiyong",
        "3 orang meninggal",
        'Dari kata pelapor: "tiga orang meninggal"',
        "Laporan warga, belum terverifikasi",
        "Belum diverifikasi",
        "Pelapor tidak mengirim foto.",
      ])
        expect(text).toContain(words);
      for (const secret of [NAME, "Cut", number, number.slice(-8)]) expect(text).not.toContain(secret);
    }
  });

  test("what is not known, none and a number are never told the same", async () => {
    const { phone, ticket } = await sentReport();
    const text = pdfText((await own(phone, ticket)).bytes);
    // Asked for with "Tidak ada semua" but for the dead, who were told in words.
    expect(text).toContain("Korban jiwa: 3 orang meninggal; hilang dan luka-luka tidak ada.");
    expect(text).toContain("Pengungsi: tidak ada.");
    expect(text).toContain("Layanan terganggu: tidak tahu.");
  });

  test("a correction makes a new document that lists exactly what changed; the first stays as it was", async () => {
    const { phone, ticket } = await sentReport();
    const first = await own(phone, ticket);
    await correct(ticket, { dead: "2" });
    expect(await own(phone, ticket)).toMatchObject({ bytes: first.bytes });
    expect(pdfText(first.bytes)).not.toContain("Perubahan dari versi");

    const mine = pdfText((await own(phone, ticket, 2)).bytes);
    expect(mine).toContain("Perubahan dari versi 1 Dikoreksi petugas setelah pengecekan lapangan");
    expect(mine).toContain("Isian Semula Menjadi Meninggal 3 orang 2 orang Bencana Banjir");
    // The officer's note is for staff.
    expect(mine).not.toContain("Dicek ke kantor desa");
    const theirs = pdfText((await staffCopy(desk(), ticket, 2)).bytes);
    expect(theirs).toContain("Catatan petugas: Dicek ke kantor desa");
    expect(theirs).toContain('Koreksi lapangan: "Dicek ke kantor desa"');
    const word = await staffCopy(desk(), ticket, 2, "docx");
    expect(await docxText(word.bytes)).toContain("Meninggal 3 orang 2 orang");

    const page = ownReportDetailSchema.parse((await phone.call("GET", `/reports/${ticket}`)).json);
    expect(page.versions.map(({ version, madeBy, changes }) => [version, madeBy, changes.length])).toEqual([
      [2, "officer", 1],
      [1, "reporter", 0],
    ]);
    expect(page.versions[0]?.changes[0]).toMatchObject({
      fieldId: "dead",
      from: { value: { kind: "count", count: 3 } },
      to: { value: { kind: "count", count: 2 } },
    });
    expect(deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json).versions).toEqual(
      page.versions,
    );
  });

  test("photos are in it with their badges; one gone from the store is counted as left out", async () => {
    const { phone, ticket } = await sentReport(3);
    const pdf = await own(phone, ticket);
    const text = pdfText(pdf.bytes);
    for (const n of [1, 2, 3]) expect(text).toContain(`Foto ${n}. Tanpa lokasi`);
    expect(new TextDecoder("latin1").decode(pdf.bytes).match(/\/Subtype \/Image/g)).toHaveLength(4);
    const word = await unzipped((await own(phone, ticket, 1, "docx")).bytes);
    expect([...word.keys()].filter((name) => name.startsWith("word/media/"))).toHaveLength(4);

    const [photo] = await query<{ store_key: string }>`
      select p.store_key from draft_photo p join report r on r.draft_id = p.draft_id
      where r.ticket_number = ${ticket} order by p.received_at limit 1`;
    await testBucket().delete([photo?.store_key as string]);
    const less = pdfText((await own(phone, ticket)).bytes);
    expect(less).toContain("1 foto lain tidak dimuat di dokumen ini.");
    expect(less).not.toContain("Foto 3.");
  });

  test("an emergency, and a claimed officer's, say so", async () => {
    const phone = browser(fetchApi);
    const started = await phone.call("POST", "/consent", {
      role: "claimedOfficer",
      name: NAME,
      number: freshNumber().typed,
      officerRegency: "Aceh Utara",
      officerPosition: "Kepala Seksi Rahasia",
      privacyVersion: 1,
      agree: true,
      emergency: true,
    });
    const ticket = await sendDraft(phone, started.draft, VILLAGE, { tick });
    const text = pdfText((await own(phone, ticket)).bytes);
    expect(text).toContain("Laporan darurat. Pelapor menyebut ada orang terluka, hilang, atau terjebak.");
    expect(text).toContain("mengaku petugas BPBD");
    expect(text).toContain("Instansi yang disebut BPBD Aceh Utara");
    expect(text).not.toContain("Rahasia");
    // What an emergency never asked is not known.
    expect(text).toContain("Korban jiwa: belum diketahui.");
    expect(text).toContain("Kebutuhan mendesak: belum didata");
  });
});

describe("who may download", () => {
  test("another phone, a signed-out caller and a version that is not there are told there is none", async () => {
    const { phone, ticket } = await sentReport();
    const other = browser(fetchApi);
    await startDraft(other, freshNumber().typed);
    for (const caller of [other, browser(fetchApi), desk()]) expect((await own(caller, ticket)).status).toBe(404);
    expect((await own(phone, ticket, 2)).status).toBe(404);
    expect((await own(phone, "LA-010101-01")).status).toBe(404);
    expect((await phone.file(`/reports/${ticket}/documents/1/exe`)).status).toBe(400);
    expect((await other.call("GET", `/reports/${ticket}`)).status).toBe(404);
    expect((await browser(fetchApi).call("GET", `/reports/${ticket}`)).status).toBe(401);
  });

  test("staff whose region holds it, each download logged once; nobody else, and nothing logged for them", async () => {
    const { phone, ticket } = await sentReport();
    expect((await staffCopy(regency(), ticket)).status).toBe(200);
    expect((await staffCopy(desk(), ticket, 1, "docx")).status).toBe(200);
    expect(await actions(ticket)).toEqual(["document", "document"]);
    expect((await staffCopy(province(), ticket)).status).toBe(404);
    expect((await staffCopy(desk(), ticket, 2)).status).toBe(404);
    expect((await staffCopy(desk(), "LA-010101-01")).status).toBe(404);
    expect((await staffCopy(phone, ticket)).status).toBe(401);
    expect((await staffCopy(browser(fetchApi), ticket)).status).toBe(401);
    expect(await actions(ticket)).toHaveLength(2);
  });

  // Puts the counter this caller just raised at its most.
  const spend = (limitId: keyof typeof LIMITS) =>
    query`update rate_counter set count = ${LIMITS[limitId].max} where limit_id = ${limitId}`;

  test("past the hourly limit the reporter is told when to download again", async () => {
    const { phone, ticket } = await sentReport();
    expect((await own(phone, ticket)).status).toBe(200);
    await spend("document.hour");
    const answer = await phone.call("GET", `/reports/${ticket}/documents/1/pdf`);
    expect(answer.status).toBe(429);
    expect(answer.error.error).toMatchObject({ code: "limit.document.hour", params: { limit: 120 } });
    expect(answer.error.retryAt).not.toBeNull();
    clock.advance(3_600_000);
    expect((await own(phone, ticket)).status).toBe(200);
  });

  test("past the address limit the report page is refused with its time", async () => {
    const { phone, ticket } = await sentReport();
    expect((await phone.call("GET", `/reports/${ticket}`)).status).toBe(200);
    await spend("address.draftReads");
    expect((await phone.call("GET", `/reports/${ticket}`)).error.error.code).toBe("limit.address.draftReads");
  });

  test("past the desk's limit a download is refused and not logged", async () => {
    const { ticket } = await sentReport();
    const officer = desk();
    expect((await staffCopy(officer, ticket)).status).toBe(200);
    await spend("desk.write");
    expect((await staffCopy(officer, ticket)).status).toBe(429);
    expect(await actions(ticket)).toEqual(["document"]);
    clock.advance(3_600_000);
  });
});

test("the photos of the work open for the reporter once the report is closed, and for nobody else", async () => {
  const { phone, ticket } = await sentReport();
  await desk().call("POST", `/desk/reports/${ticket}/view`);
  const move = async (to: string, extra: object = {}) => {
    tick();
    const { revision } = deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
    return desk().call("POST", `/desk/reports/${ticket}/status`, { to, revision, ...extra });
  };
  await move("under_review");
  await move("in_handling", { actions: ["evakuasi"] });
  const form = new FormData();
  const photo = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now() - 60_000, 420) });
  form.set("photo", new File([new Uint8Array(photo)], "foto.jpg", { type: "image/jpeg" }));
  for (const name of ["lat", "lon", "accuracy", "readAt"]) form.set(name, "");
  expect((await desk().upload(`/desk/reports/${ticket}/proofs`, form)).status).toBe(200);
  const [proof] = await query<{ id: string }>`select id from handling_proof where ticket_number = ${ticket}`;
  const path = `/reports/${ticket}/proofs/${proof?.id}`;
  expect((await phone.file(path)).status).toBe(404);
  expect((await move("closed")).status).toBe(200);
  const file = await phone.file(path);
  expect([file.status, file.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
  expect((await browser(fetchApi).file(path)).status).toBe(404);
});
