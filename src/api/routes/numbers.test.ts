import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import type { DeskBpbdNumbers, DeskFacilityNumbers } from "../../contract/numbers";
import { checkContactFile } from "../../domain/contacts";
import { checkFacilityFile } from "../../domain/facilities";
import { browser, losesOnce, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 60_000 });

// 17:00 WIB on 26 November 2026.
const clock = manualClock("2026-11-26T10:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);

const signedIn = (index: number, fetcher = fetchApi) => {
  const phone = browser(fetcher);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const bnpb = () => signedIn(2);
const bpbd = () => signedIn(3);

const BNPB = "Pusdalops BNPB, Petugas Uji";

const areas = async (search = "") => (await bnpb().call("GET", `/desk/numbers/bpbd${search}`)).json as DeskBpbdNumbers;
const facilities = async (search = "") =>
  (await bnpb().call("GET", `/desk/numbers/facilities${search}`)).json as DeskFacilityNumbers;

const stored = async (name: string) => {
  const [found] = await query<{ body: unknown; source: string; data_date: string; checksum: string }>`
    select body, source, data_date, checksum from reference_file where name = ${name}`;
  return found;
};

// The seed's own import, the first change of every file.
const imported = (at: unknown) => ({ at, change: "imported" });

const number = { nomor: "0656 21234", jenis: "pusdalops", url: "", lama: false };
const facility = { kind: "puskesmas", name: "Puskesmas Uji Baru", phone: "0651 222 222", lat: "4,5", lon: "96.2" };

describe("BPBD numbers on the desk", () => {
  test("BNPB reads every province and regency with its numbers, a page at a time, found by name", async () => {
    const [places] = await query<{ count: number }>`
      select count(*)::int + count(distinct r.province_code)::int as count
      from place_regency r join place_snapshot s on s.id = r.snapshot_id and s.active`;
    const first = await areas();
    expect(first).toMatchObject({
      checksum: (await stored("bpbdContacts"))?.checksum,
      total: places?.count,
      page: 1,
      pages: Math.ceil((places?.count as number) / 50),
    });
    expect(first.changes).toMatchObject([imported(first.changes[0]?.at)]);
    expect(first.areas).toHaveLength(50);
    expect(first.areas[0]).toEqual({
      code: "11",
      name: "Aceh",
      provinceName: "Aceh",
      level: "province",
      numbers: [{ index: 0, nomor: "123", jenis: "kantor", url: null, lama: false }],
    });
    expect((await areas("?q=%20ACEH%20UTARA")).areas).toEqual([
      {
        code: "1108",
        name: "Aceh Utara",
        provinceName: "Aceh",
        level: "regency",
        numbers: [
          { index: 0, nomor: "0800-1108-0002", jenis: "kantor", url: null, lama: false },
          { index: 1, nomor: "0800-1108-0001", jenis: "call_center", url: null, lama: false },
        ],
      },
    ]);
    const last = await areas("?page=999");
    expect(last.page).toBe(last.pages);
    expect((await areas("?q=karo&empty=1")).areas.map((area) => [area.code, area.numbers[0]?.lama])).toEqual([
      ["1206", true],
    ]);
    expect((await areas("?q=aceh%20utara&empty=1")).areas).toEqual([]);
  });

  test("a BPBD officer neither reads nor edits them, and the menu says who may", async () => {
    expect((await bpbd().call("GET", "/desk/numbers/bpbd")).status).toBe(403);
    expect((await bpbd().call("GET", "/desk/numbers/facilities")).status).toBe(403);
    const refused = await bpbd().call("POST", "/desk/numbers/bpbd", {
      checksum: null,
      edit: { kind: "remove", code: "1108", index: 0 },
    });
    expect(refused.status).toBe(403);
    const facilityRefused = await bpbd().call("POST", "/desk/numbers/facilities", {
      checksum: null,
      edit: { kind: "remove", index: 0 },
    });
    expect(facilityRefused.status).toBe(403);
    expect(((await bnpb().call("GET", "/desk/summary")).json as { mayEditNumbers: boolean }).mayEditNumbers).toBe(true);
    expect(((await bpbd().call("GET", "/desk/summary")).json as { mayEditNumbers: boolean }).mayEditNumbers).toBe(
      false,
    );
  });

  test("a number is added, changed and removed over the version read, and each change is logged", async () => {
    const send = async (checksum: string | null, edit: unknown) =>
      bnpb().call("POST", "/desk/numbers/bpbd", { checksum, edit });
    const read = (await areas()).checksum;
    const added = await send(read, { kind: "add", code: "1207", number });
    expect(added.status).toBe(200);
    const kept = await stored("bpbdContacts");
    expect(added.json).toEqual({ checksum: kept?.checksum });
    expect([kept?.source, kept?.data_date, checkContactFile(kept?.body) === null]).toEqual([
      "desk",
      "2026-11-26",
      false,
    ]);
    expect((await areas("?q=deli%20serdang")).areas[0]?.numbers).toEqual([
      { index: 0, nomor: "0656 21234", jenis: "pusdalops", url: null, lama: false },
    ]);
    const stale = await send(read, { kind: "change", code: "1207", index: 0, number: { ...number, lama: true } });
    expect([stale.status, stale.error.error.code]).toEqual([409, "numbers.changed"]);
    const changed = await send(kept?.checksum ?? null, {
      kind: "change",
      code: "1207",
      index: 0,
      number: { ...number, url: "https://bpbd.deliserdangkab.go.id", lama: true },
    });
    expect(changed.status).toBe(200);
    const removed = await send((changed.json as { checksum: string }).checksum, {
      kind: "remove",
      code: "1207",
      index: 0,
    });
    expect(removed.status).toBe(200);
    const after = checkContactFile((await stored("bpbdContacts"))?.body);
    expect(after?.wilayah["1207"]).toBeUndefined();
    const at = { utc: "2026-11-26T10:00:00.000Z", zone: "WIB" };
    const view = { nomor: "0656 21234", jenis: "pusdalops", url: null, lama: false };
    const marked = { ...view, url: "https://bpbd.deliserdangkab.go.id", lama: true };
    expect((await areas()).changes.slice(0, 3)).toMatchObject([
      { at, by: BNPB, change: "removed", entry: "Deli Serdang", before: marked, after: null },
      { at, by: BNPB, change: "changed", entry: "Deli Serdang", before: view, after: marked },
      { at, by: BNPB, change: "added", entry: "Deli Serdang", before: null, after: view },
    ]);
  });

  test("a refused value is named on its field; an unknown area or entry is not found", async () => {
    const { checksum } = await areas();
    const refused = await bnpb().call("POST", "/desk/numbers/bpbd", {
      checksum,
      edit: { kind: "add", code: "1108", number: { nomor: "12", jenis: "fax", url: "x", lama: false } },
    });
    expect([refused.status, refused.error.error.code]).toEqual([422, "request.invalidFields"]);
    expect(refused.error.fields).toEqual(
      ["nomor", "jenis", "url"].map((fieldId) => ({ fieldId, copyKey: `desk.numbers.error.${fieldId}`, params: {} })),
    );
    for (const edit of [
      { kind: "add", code: "9999", number },
      { kind: "change", code: "1108", index: 9, number },
    ]) {
      const missing = await bnpb().call("POST", "/desk/numbers/bpbd", { checksum, edit });
      expect([missing.status, missing.error.error.code]).toEqual([404, "numbers.notFound"]);
    }
  });

  test("an area only the file still keys is listed, and the file's last number cannot go", async () => {
    const own = {
      sumber: "Uji",
      diperbarui: "2026-11-22",
      wilayah: {
        "99": { nama: "Provinsi Uji", bpbd: [{ nomor: "0800-9900-0001", jenis: "kantor", url: null }] },
        "9901": { nama: "Kab. Uji", bpbd: [{ nomor: "0800-9901-0001", jenis: "kantor", url: null }] },
      },
    };
    await query`update reference_file set body = ${JSON.stringify(own)}, checksum = 'own' where name = 'bpbdContacts'`;
    expect((await areas("?q=uji")).areas.map((area) => [area.code, area.name, area.level])).toEqual([
      ["99", "Provinsi Uji", "province"],
      ["9901", "Kab. Uji", "regency"],
    ]);
    const first = await bnpb().call("POST", "/desk/numbers/bpbd", {
      checksum: "own",
      edit: { kind: "remove", code: "9901", index: 0 },
    });
    const last = await bnpb().call("POST", "/desk/numbers/bpbd", {
      checksum: (first.json as { checksum: string }).checksum,
      edit: { kind: "remove", code: "99", index: 0 },
    });
    expect([last.status, last.error.error.code]).toEqual([409, "numbers.emptied"]);
  });

  test("an edit that loses a race to another is answered as changed, and nothing is kept", async () => {
    const before = await stored("bpbdContacts");
    const racer = (request: Request) =>
      api.app.fetch(request, { ...bindings, db: losesOnce("insert into reference_change") } satisfies ApiBindings);
    const lost = await signedIn(2, racer).call("POST", "/desk/numbers/bpbd", {
      checksum: before?.checksum,
      edit: { kind: "add", code: "1108", number },
    });
    expect([lost.status, lost.error.error.code]).toEqual([409, "numbers.changed"]);
    expect((await stored("bpbdContacts"))?.checksum).toBe(before?.checksum);
  });

  test("with no file yet, every area is listed without numbers and the first number starts one", async () => {
    await query`delete from reference_file where name = 'bpbdContacts'`;
    const none = await areas("?q=deli");
    expect(none).toMatchObject({ checksum: null, areas: [{ code: "1207", numbers: [] }] });
    const unknown = await bnpb().call("POST", "/desk/numbers/bpbd", {
      checksum: null,
      edit: { kind: "add", code: "9999", number },
    });
    expect(unknown.status).toBe(404);
    const first = await bnpb().call("POST", "/desk/numbers/bpbd", {
      checksum: null,
      edit: { kind: "add", code: "1207", number },
    });
    expect(first.status).toBe(200);
    expect(checkContactFile((await stored("bpbdContacts"))?.body)).toMatchObject({
      sumber: "Meja laporan BNPB",
      wilayah: { "1207": { nama: "Deli Serdang", bpbd: [{ nomor: "0656 21234", jenis: "pusdalops", url: null }] } },
    });
  });
});

describe("facility numbers on the desk", () => {
  test("BNPB reads the facilities a page at a time, found by name, number and kind", async () => {
    const all = checkFacilityFile((await stored("facilityNumbers"))?.body)?.fasilitas ?? [];
    const first = await facilities();
    expect(first).toMatchObject({ total: all.length, page: 1, pages: Math.ceil(all.length / 50) });
    expect(first.changes).toMatchObject([imported(first.changes[0]?.at)]);
    const [kind, lat, lon, name, phone] = all[0] ?? [];
    expect(first.facilities[0]).toEqual({ index: 0, kind, lat, lon, name, phone });
    const found = await facilities("?q=rsud%20cut%20nyak");
    expect(found.facilities.map((one) => one.name)).toEqual(["RSUD Cut Nyak Dhien"]);
    expect((await facilities(`?q=${encodeURIComponent(phone as string)}`)).facilities[0]?.name).toBe(name);
    const police = await facilities("?kind=polisi");
    expect(police.total).toBe(all.filter((one) => one[0] === "polisi").length);
    expect(police.facilities.every((one) => one.kind === "polisi")).toBe(true);
  });

  test("a facility is added, changed and removed over the version read, and each change is logged", async () => {
    const send = async (checksum: string | null, edit: unknown) =>
      bnpb().call("POST", "/desk/numbers/facilities", { checksum, edit });
    const { checksum, total } = await facilities();
    const added = await send(checksum, { kind: "add", facility });
    expect(added.status).toBe(200);
    const [mine] = (await facilities("?q=uji%20baru")).facilities;
    expect(mine).toEqual({
      index: total,
      kind: "puskesmas",
      lat: 4.5,
      lon: 96.2,
      name: "Puskesmas Uji Baru",
      phone: "+62651222222",
    });
    const kept = await stored("facilityNumbers");
    expect([kept?.source, kept?.data_date]).toEqual(["desk", "2026-11-26"]);
    const refused = await send(kept?.checksum ?? null, { kind: "add", facility: { ...facility, lat: "7" } });
    expect(refused.error.fields).toEqual([{ fieldId: "point", copyKey: "desk.numbers.error.point", params: {} }]);
    const changed = await send(kept?.checksum ?? null, {
      kind: "change",
      index: total,
      facility: { ...facility, name: "Puskesmas Uji Lama" },
    });
    const removed = await send((changed.json as { checksum: string }).checksum, { kind: "remove", index: total });
    expect(removed.status).toBe(200);
    expect((await facilities()).total).toBe(total);
    const missing = await send((removed.json as { checksum: string }).checksum, { kind: "remove", index: total });
    expect([missing.status, missing.error.error.code]).toEqual([404, "numbers.notFound"]);
    const stale = await send(checksum, { kind: "remove", index: 0 });
    expect([stale.status, stale.error.error.code]).toEqual([409, "numbers.changed"]);
    const at = { utc: "2026-11-26T10:00:00.000Z", zone: "WIB" };
    const view = { kind: "puskesmas", lat: 4.5, lon: 96.2, name: "Puskesmas Uji Baru", phone: "+62651222222" };
    const renamed = { ...view, name: "Puskesmas Uji Lama" };
    expect((await facilities()).changes.slice(0, 3)).toMatchObject([
      { at, by: BNPB, change: "removed", entry: "Puskesmas Uji Lama", before: renamed, after: null },
      { at, by: BNPB, change: "changed", entry: "Puskesmas Uji Lama", before: view, after: renamed },
      { at, by: BNPB, change: "added", entry: "Puskesmas Uji Baru", before: null, after: view },
    ]);
  });

  test("with no file yet, the list is empty and the first facility starts one", async () => {
    await query`delete from reference_file where name = 'facilityNumbers'`;
    expect(await facilities()).toMatchObject({ checksum: null, total: 0, page: 1, pages: 1, facilities: [] });
    const first = await bnpb().call("POST", "/desk/numbers/facilities", {
      checksum: null,
      edit: { kind: "add", facility },
    });
    expect(first.status).toBe(200);
    expect(checkFacilityFile((await stored("facilityNumbers"))?.body)).toMatchObject({
      sumber: "Meja laporan BNPB",
      fasilitas: [["puskesmas", 4.5, 96.2, "Puskesmas Uji Baru", "+62651222222"]],
    });
    const again = await bnpb().call("POST", "/desk/numbers/facilities", {
      checksum: null,
      edit: { kind: "add", facility },
    });
    expect([again.status, again.error.error.code]).toEqual([409, "numbers.changed"]);
  });
});
