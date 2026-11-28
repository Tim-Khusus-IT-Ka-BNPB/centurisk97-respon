import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type CaseView, caseListSchema, caseViewSchema } from "../../contract/cases";
import { deskReportSchema } from "../../contract/desk";
import { windowStart } from "../../domain/limits";
import { hmacKey } from "../../platform/keys";
import { ERASE_AFTER_MS, erasePersonalData } from "../../services/cases";
import {
  browser,
  freshNumber,
  loseInserts,
  manualClock,
  query,
  testBindings,
  testBucket,
  testDatabase,
} from "../../testing/api";
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
const staff = (index: number): Phone => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const DESK = 2;
const REGENCY = 3;
const PROVINCE = 4;

let aceh = "";
let sumut = "";
beforeAll(async () => {
  const first = async (regency: string) =>
    (
      await query<{ code: string }>`
        select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
        where v.regency_code like ${regency} order by v.code limit 1`
    )[0]?.code as string;
  [aceh, sumut] = await Promise.all([first("11.08"), first("12.%")]);
});

const sent = async (village = aceh) => {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed);
  const told = await phone.call(
    "POST",
    `/drafts/${started.draftId}/turns`,
    turn(started, { kind: "freeText", text: "banjir" }),
  );
  return sendDraft(phone, told.draft, village, { tick });
};
const opened = async () => {
  const ticket = await sent();
  const answer = await staff(REGENCY).call("POST", `/desk/reports/${ticket}/case`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return { ticket, fileId: (answer.json as { fileId: string }).fileId };
};
const clockDay = () => new Date(clock.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const view = async (fileId: string, phone = staff(REGENCY)): Promise<CaseView> => {
  const answer = await phone.call("GET", `/cases/${fileId}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return caseViewSchema.parse(answer.json);
};
const save = (fileId: string, body: object, phone = staff(REGENCY)) => {
  tick();
  return phone.call("POST", `/cases/${fileId}/records`, body);
};
const idOf = (answer: { json: unknown }) => (answer.json as { recordId: string }).recordId;
const fields = (answer: { error: { fields: { fieldId: string }[] } }) => answer.error.fields.map((one) => one.fieldId);

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
const SHELTER = {
  kind: "shelter",
  values: {
    name: "Meunasah Uji",
    village: "Uji",
    placeKind: "concentrated",
    placeType: "worship",
    openedOn: "2026-11-24",
    needWater: true,
    needFood: true,
    needClothing: false,
    needHealth: false,
    needHousing: true,
    needEducation: false,
  },
};
const evacuee = (shelter: string, more: object = {}) => ({
  kind: "evacuee",
  values: {
    shelter,
    name: "Uji Dua",
    age: 30,
    sex: "female",
    homeVillage: "Uji",
    entered: "2026-11-24",
    head: "self",
    phone: "0800 0000 0001",
    nik: "3201010101010001",
    ...more,
  },
});
const photoForm = (more: Record<string, string> = {}, values: Parameters<typeof cameraJpeg>[0] = {}) => {
  const form = new FormData();
  const bytes = cameraJpeg({
    make: "Uji",
    model: "Kamera",
    dateTime: exifDateTime(clock.now() - 3_600_000, 420),
    ...values,
  });
  form.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
  for (const [name, value] of Object.entries(more)) form.set(name, value);
  return form;
};

describe("a follow-up file", () => {
  test("is offered on the report's desk page to the BPBD of its regency, and named there once open", async () => {
    const ticket = await sent();
    const desk = async (index: number) =>
      deskReportSchema.parse((await staff(index).call("GET", `/desk/reports/${ticket}`)).json).caseFile;
    expect(await desk(REGENCY)).toEqual({ file: null, mayOpen: true });
    expect(await desk(DESK)).toBeNull();
    const { fileId } = (await staff(REGENCY).call("POST", `/desk/reports/${ticket}/case`)).json as { fileId: string };
    expect(await desk(REGENCY)).toEqual({ file: { id: fileId, status: "open" }, mayOpen: true });
    expect(await desk(DESK)).toEqual({ file: { id: fileId, status: "open" }, mayOpen: false });
    // A file of another regency, as a desk might see it, is not named.
    await query`update case_file set regency_code = '11.09' where id = ${fileId}`;
    expect(await desk(REGENCY)).toBeNull();
  });

  test("is opened once from a report by the BPBD of its regency", async () => {
    const { ticket, fileId } = await opened();
    expect((await staff(REGENCY).call("POST", `/desk/reports/${ticket}/case`)).json).toEqual({ fileId });
    const bnpb = await staff(DESK).call("POST", `/desk/reports/${ticket}/case`);
    expect([bnpb.status, bnpb.error.error.code]).toEqual([403, "desk.notAllowed"]);
    expect((await staff(PROVINCE).call("POST", `/desk/reports/${ticket}/case`)).status).toBe(404);
    const listed = (phone: Phone) => phone.call("GET", "/desk/cases").then((one) => caseListSchema.parse(one.json));
    expect((await listed(staff(REGENCY))).files.map((one) => one.id)).toContain(fileId);
    expect((await listed(staff(DESK))).files.map((one) => one.id)).toContain(fileId);
    expect((await listed(staff(PROVINCE))).files).toEqual([]);
    const file = await view(fileId);
    expect(file).toMatchObject({
      file: { ticketNumber: ticket, regencyCode: "11.08", status: "open", fields: {}, nil: [] },
      access: "lead",
      day: "2026-11-24",
      records: [],
      members: [],
    });
    expect(file.final.status).toBe("doneNoted");
  });

  test("holds records numbered per kind, each checked, with its flags, photos still to take and totals", async () => {
    const { fileId } = await opened();
    const house = await save(fileId, HOUSE);
    expect(house.status, JSON.stringify(house.json)).toBe(200);
    expect((await save(fileId, HOUSE)).status).toBe(200);
    const wrong = await save(fileId, {
      kind: "house",
      values: { ...HOUSE.values, damage: "total", people: undefined },
    });
    expect([wrong.status, fields(wrong)]).toEqual([422, ["damage", "people"]]);
    expect(wrong.error.fields[0]).toMatchObject({ copyKey: "fieldError.case.value" });
    const file = await view(fileId);
    expect(file.records.map((one) => [one.kind, one.seq])).toEqual([
      ["house", 1],
      ["house", 2],
    ]);
    expect(file.records[0]).toMatchObject({
      id: idOf(house),
      personal: { headOfFamily: "Uji Satu" },
      flags: ["noPoint"],
      missingPhotos: { photo: 2, face: 0 },
      revision: 0,
      by: "BPBD Kabupaten Uji Satu, Petugas Uji",
    });
    expect(file.recap).toMatchObject({ housesHeavy: 2, housesFlooded: 2, dead: null });
    expect(file.filled).toEqual(expect.arrayContaining(["housesHeavy", "housesFlooded"]));
    // A typed point, the same twice, is flagged as one place.
    const placed = await save(fileId, { ...HOUSE, point: { lat: 5.1, lon: 97.2 } });
    await save(fileId, { ...HOUSE, point: { lat: 5.1, lon: 97.2 } });
    const again = (await view(fileId)).records.find((one) => one.id === idOf(placed));
    expect(again).toMatchObject({ point: { lat: 5.1, lon: 97.2 }, flags: ["samePoint"] });
  });

  test("ties an evacuee to a shelter and a head of family of its own file", async () => {
    const { fileId } = await opened();
    const other = await opened();
    const shelter = idOf(await save(fileId, SHELTER));
    const elsewhere = idOf(await save(other.fileId, SHELTER));
    const head = await save(fileId, evacuee(shelter));
    expect(head.status, JSON.stringify(head.json)).toBe(200);
    const child = await save(
      fileId,
      evacuee(shelter, { name: "Uji Tiga", age: 8, head: idOf(head), phone: undefined, nik: undefined }),
    );
    expect(child.status, JSON.stringify(child.json)).toBe(200);
    const astray = await save(fileId, evacuee(elsewhere, { head: "fedcba9876543210" }));
    expect(fields(astray)).toEqual(["head", "shelter"].sort().reverse());
    const file = await view(fileId);
    expect(file.recap).toMatchObject({ displaced: 2, displacedAdultFemale: 1, displacedChildFemale: 1 });
    expect(file.records.find((one) => one.id === idOf(head))).toMatchObject({
      flags: [],
      missingPhotos: { photo: 0, face: 1 },
      personal: { name: "Uji Dua", phone: "+6280000000001", nik: "3201010101010001" },
    });
    const twin = await save(fileId, evacuee(shelter, { name: "Uji Kembar" }));
    expect((await view(fileId)).records.find((one) => one.id === idOf(twin))?.flags).toEqual(["sameNik"]);
    // A need tied to a shelter of another file is refused.
    const need = {
      kind: "need",
      values: { shelter: elsewhere, item: "water", amount: 10, unit: "galon", urgent: true },
    };
    expect(fields(await save(fileId, need))).toEqual(["shelter"]);
  });

  test("a record is changed from the revision read, or set aside with its reason; a resend is one record", async () => {
    const { fileId } = await opened();
    const house = idOf(await save(fileId, HOUSE));
    await save(fileId, SHELTER);
    const change = (body: object) => staff(REGENCY).call("POST", `/cases/${fileId}/records/${house}`, body);
    const changed = await change({ values: { ...HOUSE.values, damage: "light" }, revision: 0 });
    expect(changed.status, JSON.stringify(changed.json)).toBe(200);
    const stale = await change({ values: HOUSE.values, revision: 0 });
    expect([stale.status, stale.error.error.code]).toEqual([409, "cases.changed"]);
    expect(fields(await change({ values: { ...HOUSE.values, people: -1 }, revision: 1 }))).toEqual(["people"]);
    const moved = await change({ values: HOUSE.values, point: { lat: 5.2, lon: 97.3 }, revision: 1 });
    expect(moved.status).toBe(200);
    expect((await view(fileId)).records[0]).toMatchObject({
      revision: 2,
      point: { lat: 5.2, lon: 97.3 },
      data: { damage: "heavy" },
    });
    const unknown = await staff(REGENCY).call("POST", `/cases/${fileId}/records/0123456789abcdef`, {
      values: HOUSE.values,
      revision: 0,
    });
    expect(unknown.status).toBe(404);
    const cancel = (reason: string, id = house) =>
      staff(REGENCY).call("POST", `/cases/${fileId}/records/${id}/cancel`, { reason });
    expect(fields(await cancel("x"))).toEqual(["reason"]);
    expect((await cancel("  salah   ketik ")).status).toBe(200);
    expect((await cancel("salah ketik lagi")).status).toBe(404);
    const file = await view(fileId);
    expect(file.records[0]).toMatchObject({ cancelledReason: "salah ketik" });
    expect(file.recap.housesHeavy).toBeNull();
    const first = await save(fileId, { ...HOUSE, clientId: "phone-0001" });
    const again = await save(fileId, { ...HOUSE, clientId: "phone-0001" });
    expect(idOf(again)).toBe(idOf(first));
    expect((await view(fileId)).records).toHaveLength(3);
    // BNPB reads a file but never fills it.
    expect(
      (await staff(DESK).call("POST", `/cases/${fileId}/records/${house}`, { values: HOUSE.values, revision: 3 }))
        .status,
    ).toBe(403);
    expect(
      (await staff(DESK).call("POST", `/cases/${fileId}/records/${house}/cancel`, { reason: "salah" })).status,
    ).toBe(403);
  });

  test("a record lost to a closing in the same moment is told the file is closed", async () => {
    const { fileId } = await opened();
    // The closing wins between the check and the write: the batch's own guard refuses it.
    const undo = await loseInserts("closed_meanwhile", "case_record", "new.by_label = 'Uji Ras'");
    const added = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: "Uji Ras",
      number: "0800 1111 0009",
    });
    const member = browser(fetchApi);
    await member.call("POST", `/case-links/${(added.json as { link: string }).link.slice(-32)}`);
    const lost = await save(fileId, HOUSE, member);
    expect([lost.status, lost.error.error.code]).toEqual([409, "cases.closed"]);
    await undo();
  });

  test("marks a metric none apart from not recorded, and a record of it drops the mark", async () => {
    const { fileId } = await opened();
    const nil = async (metric: string, value: boolean) =>
      staff(REGENCY).call("POST", `/cases/${fileId}/nil`, {
        metric,
        nil: value,
        revision: (await view(fileId)).file.revision,
      });
    expect((await nil("dead", true)).status).toBe(200);
    expect((await nil("dead", true)).status).toBe(200);
    expect((await view(fileId)).recap.dead).toBe(0);
    expect((await view(fileId)).file.nil).toEqual(["dead"]);
    expect(fields(await nil("colour", true))).toEqual(["metric"]);
    await save(fileId, HOUSE);
    expect(fields(await nil("housesHeavy", true))).toEqual(["metric"]);
    expect((await nil("housesHeavy", false)).status).toBe(200);
    const victim = {
      kind: "victim",
      values: {
        status: "dead",
        name: "Uji",
        age: 40,
        sex: "male",
        village: "Uji",
        contactName: "Uji",
        contactPhone: "none",
      },
    };
    expect((await save(fileId, victim)).status).toBe(200);
    expect((await view(fileId)).file.nil).toEqual([]);
    expect((await view(fileId)).recap.dead).toBe(1);
    const stale = await staff(REGENCY).call("POST", `/cases/${fileId}/nil`, {
      metric: "missing",
      nil: true,
      revision: 0,
    });
    expect([stale.status, stale.error.error.code]).toEqual([409, "cases.changed"]);
  });

  test("keeps the file's own values as a patch from the revision read", async () => {
    const { fileId } = await opened();
    const set = async (value: unknown, revision?: number) =>
      staff(REGENCY).call("POST", `/cases/${fileId}/fields`, {
        fields: value,
        revision: revision ?? (await view(fileId)).file.revision,
      });
    expect((await set({ emergencyStatus: "emergencyResponse", post: { name: "Posko Uji" } })).status).toBe(200);
    expect((await set({ post: { phone: "0645123456" } })).status).toBe(200);
    expect((await view(fileId)).file.fields).toEqual({
      emergencyStatus: "emergencyResponse",
      post: { name: "Posko Uji", phone: "0645123456" },
    });
    expect(fields(await set({ emergencyStatus: "panic", decreeDate: "2026-12-01" }))).toEqual([
      "emergencyStatus",
      "decreeDate",
    ]);
    const stale = await set({ efforts: "Evakuasi" }, 0);
    expect([stale.status, stale.error.error.code]).toEqual([409, "cases.changed"]);
  });
});

describe("the team", () => {
  test("a member joins by a one-time link, fills records, and never keeps the file", async () => {
    const { fileId } = await opened();
    const added = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: " Uji  Anggota ",
      number: "0800 1111 0001",
    });
    expect(added.status, JSON.stringify(added.json)).toBe(200);
    const { memberId, link } = added.json as { memberId: string; link: string };
    expect(link).toMatch(/^http:\/\/localhost:\d+\/cases\/join\/[0-9a-f]{32}$/);
    const token = link.slice(-32);
    const member = browser(fetchApi);
    expect((await member.call("GET", `/cases/${fileId}`)).status).toBe(401);
    const joined = await member.call("POST", `/case-links/${token}`);
    expect([joined.status, joined.json]).toEqual([200, { fileId }]);
    expect(member.cookies.get("case_access")).toMatch(/^[0-9a-f]{64}$/);
    const twice = await browser(fetchApi).call("POST", `/case-links/${token}`);
    expect([twice.status, twice.error.error.code]).toEqual([404, "cases.linkUsed"]);
    const mine = await view(fileId, member);
    expect(mine).toMatchObject({ access: "team", members: [] });
    expect((await save(fileId, HOUSE, member)).status).toBe(200);
    expect((await view(fileId)).records[0]?.by).toBe("Uji Anggota");
    expect((await member.call("POST", `/cases/${fileId}/fields`, { fields: {}, revision: 0 })).status).toBe(401);
    const other = await opened();
    expect((await member.call("GET", `/cases/${other.fileId}`)).status).toBe(404);
    expect((await save("0000000000000000", HOUSE, member)).status).toBe(404);
    expect((await save(other.fileId, HOUSE, member)).status).toBe(404);
    const team = (await view(fileId)).members;
    expect(team).toEqual([
      { id: memberId, name: "Uji Anggota", number: "+6280011110001", active: true, linkPending: false },
    ]);
    const renewed = await staff(REGENCY).call("POST", `/cases/${fileId}/members/${memberId}/link`);
    expect((renewed.json as { link: string }).link).not.toBe(link);
    expect((await view(fileId)).members[0]?.linkPending).toBe(true);
    expect((await staff(REGENCY).call("POST", `/cases/${fileId}/members/${memberId}/remove`)).status).toBe(200);
    expect((await member.call("GET", `/cases/${fileId}`)).status).toBe(401);
    expect((await staff(REGENCY).call("POST", `/cases/${fileId}/members/${memberId}/remove`)).status).toBe(404);
    expect((await staff(REGENCY).call("POST", `/cases/${fileId}/members/${memberId}/link`)).status).toBe(404);
    const nameless = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, { name: "U", number: "12" });
    expect(fields(nameless)).toEqual(["name", "number"]);
    expect((await member.call("GET", `/cases/${fileId}`, undefined)).status).toBe(401);
    const forged = browser(fetchApi);
    forged.cookies.set("case_access", "zz");
    expect((await forged.call("GET", `/cases/${fileId}`)).status).toBe(401);
    clock.advance(31 * 24 * 3_600_000);
    const late = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: "Uji Telat",
      number: "0800 1111 0002",
    });
    const lateToken = (late.json as { link: string }).link.slice(-32);
    clock.advance(31 * 24 * 3_600_000);
    expect((await browser(fetchApi).call("POST", `/case-links/${lateToken}`)).status).toBe(404);
  });
});

describe("other readers", () => {
  test("BNPB reads personal values masked until it shows one, each showing logged; and may take a member off", async () => {
    const { fileId } = await opened();
    const shelter = idOf(await save(fileId, SHELTER));
    const person = idOf(await save(fileId, evacuee(shelter)));
    const added = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: "Uji Anggota",
      number: "0800 1111 0003",
    });
    const bnpb = await view(fileId, staff(DESK));
    expect(bnpb.access).toBe("bnpb");
    expect(bnpb.records.find((one) => one.id === person)?.personal).toEqual({
      name: "U*** D***",
      phone: "**********0001",
      nik: "************0001",
    });
    expect(bnpb.members[0]?.number).toBe("**********0003");
    const shown = await staff(DESK).call("POST", `/cases/${fileId}/records/${person}/reveal`);
    expect(shown.json).toEqual({ personal: { name: "Uji Dua", phone: "+6280000000001", nik: "3201010101010001" } });
    expect((await staff(REGENCY).call("POST", `/cases/${fileId}/records/${person}/reveal`)).status).toBe(403);
    expect((await staff(DESK).call("POST", `/cases/${fileId}/records/0123456789abcdef/reveal`)).status).toBe(404);
    const log = await query<{ action: string; who_id: string }>`
      select action, who_id from case_access where file_id = ${fileId} and action = 'reveal'`;
    expect(log).toEqual([{ action: "reveal", who_id: "staff-desk-1" }]);
    expect((await save(fileId, HOUSE, staff(DESK))).status).toBe(403);
    const memberId = (added.json as { memberId: string }).memberId;
    expect((await staff(DESK).call("POST", `/cases/${fileId}/members/${memberId}/remove`)).status).toBe(200);
    expect((await staff(DESK).call("POST", `/cases/${fileId}/fields`, { fields: {}, revision: 0 })).status).toBe(403);
    expect(
      (await staff(DESK).call("POST", `/cases/${fileId}/nil`, { metric: "dead", nil: true, revision: 0 })).status,
    ).toBe(403);
    expect(
      (await staff(DESK).call("POST", `/cases/${fileId}/members`, { name: "Uji", number: "0800 1111 0004" })).status,
    ).toBe(403);
    expect((await staff(DESK).call("POST", `/cases/${fileId}/members/${memberId}/link`)).status).toBe(403);
    expect(
      (await staff(REGENCY).call("POST", "/cases/0000000000000000/fields", { fields: {}, revision: 0 })).status,
    ).toBe(404);
    expect((await staff(DESK).call("POST", "/cases/0000000000000000/members/0123456789abcdef/remove")).status).toBe(
      404,
    );
    expect((await staff(PROVINCE).call("POST", `/cases/${fileId}/members/${memberId}/remove`)).status).toBe(404);
  });

  test("a province reads its regencies' totals only; another region nothing", async () => {
    const ticket = await sent(sumut);
    await query`insert into case_file (id, ticket_number, regency_code, opened_by, opened_at)
      values ('1200000000000001', ${ticket}, ${sumut.slice(0, 5)}, 'Uji', ${new Date(clock.now())})`;
    await query`insert into case_record (id, file_id, kind, seq, data, personal, by_label, created_at, updated_at)
      values ('1200000000000002', '1200000000000001', 'house', 1, ${JSON.stringify({ damage: "heavy" })}, '{}', 'Uji',
        ${new Date(clock.now())}, ${new Date(clock.now())})`;
    const province = await view("1200000000000001", staff(PROVINCE));
    expect(province).toMatchObject({ access: "province", records: [], members: [], recap: { housesHeavy: 1 } });
    expect((await staff(REGENCY).call("GET", "/cases/1200000000000001")).status).toBe(404);
    expect((await staff(PROVINCE).call("GET", "/cases/0000000000000000")).status).toBe(404);
  });
});

describe("photos", () => {
  test("of a record from a camera, placed by the phone or the photo, a face only where asked", async () => {
    const { fileId } = await opened();
    const house = idOf(await save(fileId, HOUSE));
    const upload = (form: FormData, record = house, phone = staff(REGENCY)) => {
      tick();
      return phone.upload(`/cases/${fileId}/records/${record}/media`, form);
    };
    const fix = { lat: "5.14705", lon: "97.0482", accuracy: "20", readAt: String(clock.now()) };
    expect((await upload(photoForm(fix))).status).toBe(200);
    expect((await upload(photoForm({}, { point: { lat: 5.15, lon: 97.05 } }))).status).toBe(200);
    expect((await upload(photoForm({}, { dateTime: undefined }))).status).toBe(200);
    const file = await view(fileId);
    expect(file.records[0]).toMatchObject({
      media: [{ badge: "gps" }, { badge: "exif" }, { badge: "none" }],
      missingPhotos: { photo: 0, face: 0 },
      shownPoint: { lat: 5.14705, lon: 97.0482 },
      flags: [],
    });
    const refused = await upload(photoForm({ face: "1" }));
    expect([refused.status, refused.error.fields[0]?.copyKey]).toEqual([422, "fieldError.photo.faceNotAsked"]);
    const plain = new FormData();
    plain.set("photo", new File([new Uint8Array(cameraJpeg())], "foto.jpg", { type: "image/jpeg" }));
    expect((await upload(plain)).error.fields[0]?.copyKey).toBe("fieldError.photo.notCamera");
    const tiny = new FormData();
    tiny.set("photo", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
    expect((await upload(tiny)).error.fields[0]?.copyKey).toBe("fieldError.photo.proofFormat");
    const cut = new FormData();
    const whole = cameraJpeg({ make: "Uji", model: "Kamera", dateTime: exifDateTime(clock.now(), 420) });
    cut.set("photo", new File([new Uint8Array(whole.subarray(0, 1200))], "foto.jpg", { type: "image/jpeg" }));
    expect((await upload(cut)).error.fields[0]?.copyKey).toBe("fieldError.photo.broken");
    expect((await upload(photoForm(), house, staff(DESK))).status).toBe(403);
    for (let n = 3; n < 6; n += 1) expect((await upload(photoForm())).status).toBe(200);
    expect((await upload(photoForm())).error.fields[0]?.copyKey).toBe("fieldError.photo.proofTooMany");
    expect((await upload(photoForm(), "0123456789abcdef")).status).toBe(404);
    const shelter = idOf(await save(fileId, SHELTER));
    const person = idOf(await save(fileId, evacuee(shelter)));
    expect((await upload(photoForm({ face: "1" }), person)).status).toBe(200);
    const face = (await view(fileId)).records.find((one) => one.id === person);
    expect(face).toMatchObject({ media: [{ kind: "face" }], missingPhotos: { face: 0 } });
    const mediaId = file.records[0]?.media[0]?.id as string;
    const read = await staff(REGENCY).file(`/cases/${fileId}/media/${mediaId}`);
    expect([read.status, read.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect((await staff(PROVINCE).file(`/cases/${fileId}/media/${mediaId}`)).status).toBe(404);
    expect((await staff(REGENCY).file(`/cases/${fileId}/media/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await staff(REGENCY).file(`/cases/0000000000000000/media/${mediaId}`)).status).toBe(404);
    await testBucket().delete([`cases/${fileId}/${mediaId}.jpg`]);
    expect((await staff(REGENCY).file(`/cases/${fileId}/media/${mediaId}`)).status).toBe(404);
    const logged = await query<{
      n: number;
    }>`select count(*) as n from case_access where file_id = ${fileId} and action = 'media'`;
    expect(logged[0]?.n).toBe(1);
  });
});

describe("a closed file", () => {
  test("takes no record, value or mark", async () => {
    const { fileId } = await opened();
    const house = idOf(await save(fileId, HOUSE));
    await query`update case_file set status = 'proposed' where id = ${fileId}`;
    const closed = (answer: { status: number; error: { error: { code: string } } }) => [
      answer.status,
      answer.error.error.code,
    ];
    expect(closed(await save(fileId, HOUSE))).toEqual([409, "cases.closed"]);
    expect(closed(await staff(REGENCY).call("POST", `/cases/${fileId}/fields`, { fields: {}, revision: 0 }))).toEqual([
      409,
      "cases.closed",
    ]);
    expect(
      closed(await staff(REGENCY).call("POST", `/cases/${fileId}/nil`, { metric: "dead", nil: true, revision: 0 })),
    ).toEqual([409, "cases.closed"]);
    expect((await view(fileId)).file.status).toBe("proposed");
    void house;
  });
});

describe("closing", () => {
  const VICTIM = {
    kind: "victim",
    values: {
      status: "missing",
      name: "Uji Hilang",
      age: 40,
      sex: "male",
      village: "Uji",
      contactName: "Uji",
      contactPhone: "none",
      lastSeenPlace: "Sungai",
      lastSeenOn: "2026-11-24",
      search: "searching",
    },
  };
  const close = async (fileId: string, endedOn: string, phone = staff(REGENCY), revision?: number) =>
    phone.call("POST", `/cases/${fileId}/close`, {
      endedOn,
      note: " Air surut ",
      revision: revision ?? (await view(fileId)).file.revision,
    });

  test("seals the totals and the state it ends in, with no personal value; BNPB accepts and the ticket closes", async () => {
    const { ticket, fileId } = await opened();
    await save(fileId, VICTIM);
    expect(fields(await close(fileId, "2026-11-23"))).toEqual(["endedOn"]);
    const member = await staff(REGENCY).call("POST", `/cases/${fileId}/members`, {
      name: "Uji Anggota",
      number: "0800 1111 0005",
    });
    expect((await close(fileId, clockDay(), browser(fetchApi))).status).toBe(401);
    expect((await close(fileId, clockDay(), staff(DESK))).status).toBe(403);
    const stale = await close(fileId, clockDay(), staff(REGENCY), 0);
    expect([stale.status, stale.error.error.code]).toEqual([409, "cases.changed"]);
    expect((await close(fileId, clockDay())).status).toBe(200);
    const sealed = await view(fileId);
    expect(sealed.file.status).toBe("proposed");
    expect(sealed.versions).toEqual([
      expect.objectContaining({
        version: 1,
        by: "BPBD Kabupaten Uji Satu, Petugas Uji",
        final: expect.objectContaining({
          status: "doneNoted",
          reasons: expect.arrayContaining([{ metric: "missing", value: 1 }]),
        }),
        closing: { endedOn: clockDay(), note: "Air surut" },
      }),
    ]);
    const [kept] = await query<{ body: unknown }>`select body from case_version where file_id = ${fileId}`;
    expect(JSON.stringify(kept?.body)).not.toContain("Uji Hilang");
    expect(kept?.body).toHaveProperty("recap");
    expect((await close(fileId, clockDay())).status).toBe(409);
    expect((await staff(REGENCY).call("POST", `/cases/${fileId}/accept`)).status).toBe(403);
    expect((await staff(DESK).call("POST", "/cases/0000000000000000/accept")).status).toBe(404);
    tick();
    expect((await staff(DESK).call("POST", `/cases/${fileId}/accept`)).status).toBe(200);
    expect((await view(fileId)).file.status).toBe("doneNoted");
    const report = deskReportSchema.parse((await staff(DESK).call("GET", `/desk/reports/${ticket}`)).json);
    expect(report.status).toBe("closed");
    expect(report.history.at(-1)).toMatchObject({ status: "closed", note: "Ditutup dari data lanjutan BPBD" });
    expect((await staff(DESK).call("POST", `/cases/${fileId}/accept`)).status).toBe(409);
    void member;
  });

  test("ends done only with no one missing, no one displaced and nothing cut, each known", async () => {
    const { fileId } = await opened();
    for (const metric of ["missing", "displaced", "infrastructureCut"]) {
      const answer = await staff(REGENCY).call("POST", `/cases/${fileId}/nil`, {
        metric,
        nil: true,
        revision: (await view(fileId)).file.revision,
      });
      expect(answer.status, metric).toBe(200);
    }
    expect((await close(fileId, clockDay())).status).toBe(200);
    expect((await view(fileId)).versions[0]?.final.status).toBe("done");
    // Another desk accepts in the same moment: this one's batch loses and is told so.
    // A trigger takes no bound value: the file's id, 16 hex digits, goes in as text.
    const undo = await loseInserts(
      "accepted_meanwhile",
      "case_trail",
      `new.file_id = '${fileId}' and new.action = 'accept'`,
    );
    expect((await staff(DESK).call("POST", `/cases/${fileId}/accept`)).status).toBe(409);
    await undo();
    expect((await staff(DESK).call("POST", `/cases/${fileId}/accept`)).status).toBe(200);
    expect((await view(fileId)).file.status).toBe("done");
  });

  test("BNPB opens a file again with its reason; its versions stay", async () => {
    const { fileId } = await opened();
    const reopen = (reason: string, phone = staff(DESK), id = fileId) =>
      phone.call("POST", `/cases/${id}/reopen`, { reason });
    expect((await reopen("salah tutup")).status).toBe(409);
    expect((await close(fileId, clockDay())).status).toBe(200);
    expect(fields(await reopen("x"))).toEqual(["reason"]);
    expect((await reopen("salah tutup", staff(REGENCY))).status).toBe(403);
    expect((await reopen("salah tutup", staff(DESK), "0000000000000000")).status).toBe(404);
    expect((await reopen("  korban hilang  ditemukan ")).status).toBe(200);
    expect((await view(fileId)).file.status).toBe("open");
    expect((await close(fileId, clockDay())).status).toBe(200);
    expect((await view(fileId)).versions.map((one) => one.version)).toEqual([1, 2]);
    const trail = await query<{ action: string; detail: string }>`
      select action, detail from case_trail where file_id = ${fileId} and action = 'reopen'`;
    expect(trail.map((one) => one.detail)).toEqual([{ reason: "korban hilang ditemukan" }]);
  });

  test("five years after its closing was accepted, a file's personal values, faces and photos of the missing go", async () => {
    const { fileId } = await opened();
    const shelter = idOf(await save(fileId, SHELTER));
    const person = idOf(await save(fileId, evacuee(shelter)));
    const missing = idOf(await save(fileId, VICTIM));
    const house = idOf(await save(fileId, HOUSE));
    const upload = (record: string, more: Record<string, string> = {}) => {
      tick();
      return staff(REGENCY).upload(`/cases/${fileId}/records/${record}/media`, photoForm(more));
    };
    expect((await upload(person, { face: "1" })).status).toBe(200);
    expect((await upload(missing)).status).toBe(200);
    expect((await upload(house)).status).toBe(200);
    await staff(REGENCY).call("POST", `/cases/${fileId}/members`, { name: "Uji Anggota", number: "0800 1111 0006" });
    expect((await close(fileId, clockDay())).status).toBe(200);
    expect((await staff(DESK).call("POST", `/cases/${fileId}/accept`)).status).toBe(200);
    const keys = await query<{
      object_key: string;
      record_id: string;
    }>`select object_key, record_id from case_media where file_id = ${fileId}`;
    expect(await erasePersonalData(bindings)).toBe(0);
    clock.advance(ERASE_AFTER_MS + 1000);
    expect(await erasePersonalData(bindings)).toBeGreaterThanOrEqual(1);
    const records = await query<{
      id: string;
      personal: unknown;
      data: unknown;
    }>`select id, personal, data from case_record where file_id = ${fileId}`;
    expect(records.map((one) => one.personal)).toEqual(records.map(() => ({})));
    expect(records.find((one) => one.id === house)?.data).toMatchObject({ damage: "heavy" });
    const left = await Promise.all(
      keys.map(async (one) => [one.record_id, (await testBucket().get(one.object_key)) !== null]),
    );
    expect(Object.fromEntries(left)).toEqual({ [person]: false, [missing]: false, [house]: true });
    const [member] = await query<{ number: string }>`select number from case_member where file_id = ${fileId}`;
    expect(member?.number).toBe("");
    const [trail] = await query<{
      detail: string;
    }>`select detail from case_trail where file_id = ${fileId} and action = 'erase'`;
    expect(trail?.detail).toEqual({ media: 2 });
    expect(await erasePersonalData(bindings)).toBe(0);
  });
});

describe("limits", () => {
  test("a desk account over its hour is refused on the file too", async () => {
    const { fileId } = await opened();
    const key = await hmacKey(bindings.settings.keyHmacSecret, "subject", "staff:staff-desk-1");
    const window = new Date(windowStart("clockHour", clock.now()));
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('desk.write', ${key}, ${window}, 120), ('desk.read', ${key}, ${window}, 1200)
      on conflict (limit_id, subject_key, window_start) do update set count = excluded.count`;
    expect((await staff(DESK).call("GET", "/desk/cases")).status).toBe(429);
    expect((await staff(DESK).call("POST", `/cases/${fileId}/members/0123456789abcdef/remove`)).status).toBe(429);
  });
});
