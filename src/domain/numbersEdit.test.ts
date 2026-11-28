import { describe, expect, test } from "vitest";
import { type ContactFile, checkContactFile } from "./contacts";
import { checkFacilityFile, type FacilityFile } from "./facilities";
import { type ContactInput, editContacts, editFacilities, type FacilityInput } from "./numbersEdit";

const TODAY = "2026-11-28";

const CONTACTS = checkContactFile({
  sumber: "Uji",
  diperbarui: "2026-11-22",
  wilayah: {
    "1108": {
      nama: "Kab. Aceh Utara",
      bpbd: [
        { nomor: "0800-1108-0002", jenis: "kantor", url: null, tanggal: null },
        { nomor: "0800-1108-0001", jenis: "call_center", url: null, lama: true },
      ],
    },
    "12": { nama: "Provinsi Sumatera Utara", bpbd: [{ nomor: "0800-1200-0001", jenis: "pusdalops", url: null }] },
    "1207": {
      nama: "Kab. Deli Serdang",
      bpbd: [{ nomor: "0800-1207-0001", jenis: "wa", url: null }],
      damkar: [{ nomor: "113", jenis: "kantor", url: null }],
    },
  },
}) as ContactFile;

const number = (change: Partial<ContactInput> = {}): ContactInput => ({
  nomor: "0811 2222 3333",
  jenis: "wa",
  url: "",
  lama: false,
  ...change,
});

const errorsOf = (change: Partial<ContactInput>) => {
  const result = editContacts(CONTACTS, { kind: "add", code: "1108", number: number(change) }, "", TODAY);
  return result.ok ? [] : result.reason === "invalid" ? result.errors.map((error) => error.fieldId) : [result.reason];
};

describe("BPBD numbers", () => {
  test("a number is added at the end of its area, and the file is dated today", () => {
    const added = editContacts(
      CONTACTS,
      { kind: "add", code: "1108", number: number({ nomor: " 0811 2222 3333 " }) },
      "",
      TODAY,
    );
    const after = { nomor: "0811 2222 3333", jenis: "wa", url: null };
    expect(added).toEqual({
      ok: true,
      file: {
        ...CONTACTS,
        diperbarui: TODAY,
        wilayah: {
          ...CONTACTS.wilayah,
          "1108": { nama: "Kab. Aceh Utara", bpbd: [...(CONTACTS.wilayah["1108"]?.bpbd ?? []), after] },
        },
      },
      entry: "1108",
      before: null,
      after,
    });
  });

  test("an area the file does not list yet is added under the place's name, in code order", () => {
    const added = editContacts(CONTACTS, { kind: "add", code: "1101", number: number() }, "Aceh Selatan", TODAY);
    if (!added.ok) throw new Error(added.reason);
    expect(Object.keys(added.file.wilayah)).toEqual(["12", "1101", "1108", "1207"]);
    expect(added.file.wilayah["1101"]).toEqual({
      nama: "Aceh Selatan",
      bpbd: [{ nomor: "0811 2222 3333", jenis: "wa", url: null }],
    });
  });

  test("with no file yet, the first number starts one of BNPB's own", () => {
    const added = editContacts(null, { kind: "add", code: "11", number: number() }, "Provinsi Aceh", TODAY);
    expect(added).toMatchObject({
      ok: true,
      file: {
        sumber: "Meja laporan BNPB",
        diperbarui: TODAY,
        wilayah: { "11": { nama: "Provinsi Aceh", bpbd: [{ nomor: "0811 2222 3333", jenis: "wa", url: null }] } },
      },
    });
  });

  test("a changed number keeps what else the file said of it, and is marked old only when asked", () => {
    const changed = editContacts(
      CONTACTS,
      {
        kind: "change",
        code: "1108",
        index: 0,
        number: number({ nomor: "0645 41234", jenis: "pusdalops", url: " https://bpbd.acehutarakab.go.id " }),
      },
      "",
      TODAY,
    );
    const after = { nomor: "0645 41234", jenis: "pusdalops", url: "https://bpbd.acehutarakab.go.id", tanggal: null };
    expect(changed).toMatchObject({
      ok: true,
      entry: "1108",
      before: { nomor: "0800-1108-0002", jenis: "kantor", url: null, tanggal: null },
      after,
    });
    if (!changed.ok) throw new Error(changed.reason);
    expect(changed.file.wilayah["1108"]?.bpbd).toEqual([after, CONTACTS.wilayah["1108"]?.bpbd?.[1]]);
    const current = { kind: "change", code: "1108", index: 1 } as const;
    const unmarked = editContacts(CONTACTS, { ...current, number: number({ jenis: "call_center" }) }, "", TODAY);
    expect(unmarked.ok && unmarked.after).toEqual({ nomor: "0811 2222 3333", jenis: "call_center", url: null });
    const marked = editContacts(CONTACTS, { ...current, number: number({ lama: true }) }, "", TODAY);
    expect(marked.ok && marked.after).toEqual({ nomor: "0811 2222 3333", jenis: "wa", url: null, lama: true });
  });

  test("a removed number leaves its area; an area with none left goes, unless it lists the fire brigade", () => {
    const one = editContacts(CONTACTS, { kind: "remove", code: "1108", index: 0 }, "", TODAY);
    expect(one).toMatchObject({ ok: true, entry: "1108", before: { nomor: "0800-1108-0002" }, after: null });
    expect(one.ok && one.file.wilayah["1108"]?.bpbd).toEqual([CONTACTS.wilayah["1108"]?.bpbd?.[1]]);
    const last = editContacts(CONTACTS, { kind: "remove", code: "12", index: 0 }, "", TODAY);
    expect(last.ok && Object.keys(last.file.wilayah)).toEqual(["1108", "1207"]);
    const brigade = editContacts(CONTACTS, { kind: "remove", code: "1207", index: 0 }, "", TODAY);
    expect(brigade.ok && brigade.file.wilayah["1207"]).toEqual({
      nama: "Kab. Deli Serdang",
      bpbd: [],
      damkar: [{ nomor: "113", jenis: "kantor", url: null }],
    });
  });

  test("a number that is not there is not found, and the file's last number cannot go", () => {
    const notFound = { ok: false, reason: "notFound" };
    expect(editContacts(CONTACTS, { kind: "change", code: "1101", index: 0, number: number() }, "", TODAY)).toEqual(
      notFound,
    );
    expect(editContacts(CONTACTS, { kind: "remove", code: "1108", index: 2 }, "", TODAY)).toEqual(notFound);
    expect(editContacts(null, { kind: "remove", code: "1108", index: 0 }, "", TODAY)).toEqual(notFound);
    const alone = checkContactFile({ ...CONTACTS, wilayah: { "12": CONTACTS.wilayah["12"] } });
    expect(editContacts(alone, { kind: "remove", code: "12", index: 0 }, "", TODAY)).toEqual({
      ok: false,
      reason: "emptied",
    });
  });

  test("a number is digits with the separators people write, 6 to 15 of them, in 30 characters at most", () => {
    for (const nomor of ["0800 1108 0001", "(0651) 22222", "0651.22222", "0800-1108-0001", "+62 651 22222", "123456"])
      expect(errorsOf({ nomor }), nomor).toEqual([]);
    for (const nomor of ["x0800110800", "0800110800x", "08 12+34 5678", "0812abc4567", "12345", ""])
      expect(errorsOf({ nomor }), nomor).toEqual(["nomor"]);
    expect(errorsOf({ nomor: "123456789012345" })).toEqual([]);
    expect(errorsOf({ nomor: "1234567890123456" })).toEqual(["nomor"]);
    const thirty = `1  ${"23456789012345".split("").join(" ")}`;
    expect([thirty.length, thirty.replace(/\D/g, "").length]).toEqual([30, 15]);
    expect(errorsOf({ nomor: ` ${thirty} ` })).toEqual([]);
    expect(errorsOf({ nomor: thirty.replace("1  ", "1   ") })).toEqual(["nomor"]);
  });

  test("its kind is one of the four, and its page an http or https address", () => {
    for (const jenis of ["call_center", "pusdalops", "wa", "kantor"]) expect(errorsOf({ jenis }), jenis).toEqual([]);
    expect(errorsOf({ jenis: "fax" })).toEqual(["jenis"]);
    const page = (length: number) => `https://bpbd.go.id/${"a".repeat(length - 19)}`;
    expect(page(300).length).toBe(300);
    for (const url of ["https://bpbd.go.id", "http://bpbd.go.id", page(300), ` ${page(300)} `, "   "])
      expect(errorsOf({ url }), url).toEqual([]);
    for (const url of ["ftp://bpbd.go.id", "bpbd.go.id", page(301)]) expect(errorsOf({ url }), url).toEqual(["url"]);
    const refused = editContacts(
      CONTACTS,
      { kind: "change", code: "12", index: 0, number: { nomor: "12", jenis: "fax", url: "x", lama: false } },
      "",
      TODAY,
    );
    expect(refused).toEqual({
      ok: false,
      reason: "invalid",
      errors: ["nomor", "jenis", "url"].map((fieldId) => ({ fieldId, rule: fieldId, params: {} })),
    });
  });
});

const FACILITIES = checkFacilityFile({
  dibuat: "2026-11-27",
  sumber: "OpenStreetMap",
  fasilitas: [
    ["rs", 4.15595, 96.13028, "RSUD Cut Nyak Dhien", "+626557009452"],
    ["polisi", 3.59, 98.67, "Polsek Medan Baru", "110"],
  ],
}) as FacilityFile;

const facility = (change: Partial<FacilityInput> = {}): FacilityInput => ({
  kind: "puskesmas",
  name: "Puskesmas Uji",
  phone: "0651 222 222",
  lat: "4.5",
  lon: "96.2",
  ...change,
});

const added = (change: Partial<FacilityInput>) => {
  const result = editFacilities(FACILITIES, { kind: "add", facility: facility(change) }, TODAY);
  return result.ok ? result.after : result.reason === "invalid" ? result.errors.map((error) => error.fieldId) : [];
};

describe("facility numbers", () => {
  test("a facility is added at the end, its name trimmed, its number dialable and its place read", () => {
    const result = editFacilities(
      FACILITIES,
      { kind: "add", facility: facility({ name: "  Puskesmas Uji ", lat: "4,5", lon: " 96.2 " }) },
      TODAY,
    );
    const after = ["puskesmas", 4.5, 96.2, "Puskesmas Uji", "+62651222222"];
    expect(result).toEqual({
      ok: true,
      file: { dibuat: TODAY, sumber: "OpenStreetMap", fasilitas: [...FACILITIES.fasilitas, after] },
      entry: "Puskesmas Uji",
      before: null,
      after,
    });
    expect(editFacilities(null, { kind: "add", facility: facility() }, TODAY)).toMatchObject({
      ok: true,
      file: { dibuat: TODAY, sumber: "Meja laporan BNPB", fasilitas: [after] },
    });
  });

  test("a facility is changed or removed in place, named by its name", () => {
    const changed = editFacilities(
      FACILITIES,
      { kind: "change", index: 1, facility: facility({ kind: "polisi", name: "Polsek Medan Kota", phone: "110" }) },
      TODAY,
    );
    const after = ["polisi", 4.5, 96.2, "Polsek Medan Kota", "110"];
    expect(changed).toEqual({
      ok: true,
      file: { ...FACILITIES, dibuat: TODAY, fasilitas: [FACILITIES.fasilitas[0], after] },
      entry: "Polsek Medan Kota",
      before: FACILITIES.fasilitas[1],
      after,
    });
    const removed = editFacilities(FACILITIES, { kind: "remove", index: 0 }, TODAY);
    expect(removed).toEqual({
      ok: true,
      file: { ...FACILITIES, dibuat: TODAY, fasilitas: [FACILITIES.fasilitas[1]] },
      entry: "RSUD Cut Nyak Dhien",
      before: FACILITIES.fasilitas[0],
      after: null,
    });
  });

  test("one that is not there is not found, and the last one cannot go", () => {
    const notFound = { ok: false, reason: "notFound" };
    expect(editFacilities(FACILITIES, { kind: "change", index: 2, facility: facility() }, TODAY)).toEqual(notFound);
    expect(editFacilities(FACILITIES, { kind: "remove", index: 9 }, TODAY)).toEqual(notFound);
    expect(editFacilities(null, { kind: "remove", index: 0 }, TODAY)).toEqual(notFound);
    const alone = checkFacilityFile({ ...FACILITIES, fasilitas: [FACILITIES.fasilitas[0]] });
    expect(editFacilities(alone, { kind: "remove", index: 0 }, TODAY)).toEqual({ ok: false, reason: "emptied" });
  });

  test("a national number gets +62; short and international numbers stay as typed", () => {
    for (const phone of ["0651 222 222", "(0651)222222", "0651.222.222", "0651-222-222"])
      expect((added({ phone }) as unknown[])[4], phone).toBe("+62651222222");
    expect((added({ phone: "081234567" }) as unknown[])[4]).toBe("+6281234567");
    for (const phone of ["08123456", "112", "123456780", "+6281234567890"])
      expect((added({ phone }) as unknown[])[4], phone).toBe(phone);
  });

  test("its kind is one of four, its name 2 to 120 letters, its number dialable and its place in Indonesia", () => {
    for (const kind of ["rs", "puskesmas", "polisi", "damkar"]) expect((added({ kind }) as unknown[])[0]).toBe(kind);
    expect(added({ kind: "klinik" })).toEqual(["kind"]);
    expect((added({ name: "RS" }) as unknown[])[3]).toBe("RS");
    expect((added({ name: "R".repeat(120) }) as unknown[])[3]).toBe("R".repeat(120));
    expect(added({ name: " R " })).toEqual(["name"]);
    expect(added({ name: "R".repeat(121) })).toEqual(["name"]);
    expect(added({ phone: "12" })).toEqual(["phone"]);
    expect(added({ phone: "0812abc4567" })).toEqual(["phone"]);
    expect(added({ lat: "abc" })).toEqual(["point"]);
    expect(added({ lat: "7" })).toEqual(["point"]);
    expect(added({ lon: "" })).toEqual(["point"]);
    expect(
      editFacilities(
        FACILITIES,
        { kind: "add", facility: { kind: "x", name: "", phone: "", lat: "", lon: "" } },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
      errors: ["kind", "name", "phone", "point"].map((fieldId) => ({ fieldId, rule: fieldId, params: {} })),
    });
  });
});
