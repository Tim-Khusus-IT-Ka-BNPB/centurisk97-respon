import { describe, expect, test } from "vitest";
import { checkContactFile, pickContact } from "./contacts";

const item = (nomor: string, jenis: string, extra: object = {}) => ({
  nomor,
  jenis,
  url: null,
  tanggal: null,
  ...extra,
});
const file = (wilayah: object) => checkContactFile({ sumber: "uji", diperbarui: "2026-11-22", wilayah });

describe("contact file", () => {
  test("the regency's best number first, by kind; then the province; then BNPB", () => {
    const contacts = file({
      "1108": { nama: "Kab. A", bpbd: [item("0800-1108-0002", "kantor"), item("0800-1108-0001", "call_center")] },
      "1109": { nama: "Kab. B", bpbd: [item("0800-1109-0009", "lain"), item("0800-1109-0003", "wa")] },
      "11": { nama: "Prov", bpbd: [item("0800-1100-0001", "pusdalops")] },
    });
    expect(pickContact(contacts, "11.08.01.2001")).toEqual({
      level: "regency",
      phone: "0800-1108-0001",
      kind: "call_center",
    });
    expect(pickContact(contacts, "11.09.01.2001")).toEqual({ level: "regency", phone: "0800-1109-0003", kind: "wa" });
    expect(pickContact(contacts, "11.10.01.2001")).toEqual({
      level: "province",
      phone: "0800-1100-0001",
      kind: "pusdalops",
    });
    expect(pickContact(contacts, "12.01.01.2001")).toEqual({ level: "national" });
    expect(pickContact(null, "11.08.01.2001")).toEqual({ level: "national" });
  });

  test("an old number, a short one, or an unknown kind behind a known one is passed over", () => {
    const contacts = file({
      "1108": {
        nama: "Kab. A",
        bpbd: [item("0800-1108-0001", "call_center", { lama: true }), item("123", "pusdalops")],
      },
      "1109": { nama: "Kab. B", bpbd: [item("0800-1109-0001", "lain"), item("0800-1109-0002", "lain")] },
    });
    expect(pickContact(contacts, "11.08.01.2001")).toEqual({ level: "national" });
    expect(pickContact(contacts, "11.09.01.2001")).toMatchObject({ phone: "0800-1109-0001" });
  });

  test("a file that breaks its contract is refused", () => {
    const good = { nama: "A", bpbd: [item("0800-1108-0001", "kantor")] };
    for (const broken of [
      null,
      { sumber: "x", diperbarui: "22 Nov", wilayah: { "11": good } },
      { sumber: 1, diperbarui: "2026-11-22", wilayah: { "11": good } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: [] },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: null },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: {} },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "1": good } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A", bpbd: "x" } } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A", bpbd: [{ nomor: 1, jenis: "x" }] } } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A", bpbd: [item("1", "x", { url: 3 })] } } },
      {
        sumber: "x",
        diperbarui: "2026-11-22",
        wilayah: { "11": { nama: "A", bpbd: [item("1", "x", { lama: "ya" })] } },
      },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": null } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A" } } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A", damkar: "x" } } },
      { sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": { nama: "A", damkar: [{ nomor: 1, jenis: "x" }] } } },
    ])
      expect(checkContactFile(broken)).toBeNull();
    expect(checkContactFile({ sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": good } })).not.toBeNull();
  });

  test("each rule of the contract, on a file that only that rule refuses", () => {
    const good = { nama: "Kab. A", bpbd: [item("0800-1108-0001", "kantor")] };
    const at = (wilayah: object, extra: object = {}) =>
      checkContactFile({ sumber: "uji", diperbarui: "2026-11-22", wilayah, ...extra });
    expect(at({ "1108": good })).not.toBeNull();
    expect(at({ "1108": { nama: "Kab. A", bpbd: [{ nomor: "0800-1108-0001", jenis: "wa" }] } })).not.toBeNull();
    expect(
      at({ "1108": { ...good, bpbd: [item("0800-1108-0001", "wa", { url: "https://bpbd.test/" })] } }),
    ).not.toBeNull();
    for (const [wilayah, extra] of [
      [{ "1108": { ...good, bpbd: [null] } }, {}],
      [{ "1108": { ...good, bpbd: [item("0800-1108-0001", "wa", { jenis: 1 })] } }, {}],
      [{ "1108": { ...good, bpbd: [item("0800-1108-0001", "wa", { url: 5 })] } }, {}],
      [{ "1108": { ...good, bpbd: [...good.bpbd, null] } }, {}],
      [{ "1108": good, x: good }, {}],
      [{ "111": good }, {}],
      [{ x11: good }, {}],
      [{ "1108": good }, { diperbarui: ["2026-11-22"] }],
      [{ "1108": good }, { diperbarui: "2026-11-22x" }],
      [{ "1108": good }, { diperbarui: "x2026-11-22" }],
      [Object.assign(() => undefined, { "1108": good }), {}],
    ] as const)
      expect(at(wilayah, extra), JSON.stringify([wilayah, extra])).toBeNull();
  });

  test("an area may list its fire brigade beside or instead of its BPBD; only the BPBD is shown", () => {
    const damkar = [item("0851-0500-4113", "damkar")];
    const onlyFire = file({
      "1173": { nama: "Kota Lhokseumawe", damkar },
      "11": { nama: "Aceh", bpbd: [item("0651-34783", "kantor")] },
    });
    expect(onlyFire).not.toBeNull();
    expect(pickContact(onlyFire, "11.73.01.1001")).toEqual({ level: "province", phone: "0651-34783", kind: "kantor" });
    const both = file({ "1173": { nama: "Kota Lhokseumawe", damkar, bpbd: [item("0645-40001", "kantor")] } });
    expect(pickContact(both, "11.73.01.1001")).toEqual({ level: "regency", phone: "0645-40001", kind: "kantor" });
  });

  test("six digits is a number to show; five with a dash in them is not", () => {
    const one = (nomor: string) =>
      pickContact(file({ "1108": { nama: "Kab. A", bpbd: [item(nomor, "wa")] } }), "11.08.01.2001");
    expect(one("123456")).toEqual({ level: "regency", phone: "123456", kind: "wa" });
    expect(one("12-345")).toEqual({ level: "national" });
  });
});
