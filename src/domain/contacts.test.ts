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
    ])
      expect(checkContactFile(broken)).toBeNull();
    expect(checkContactFile({ sumber: "x", diperbarui: "2026-11-22", wilayah: { "11": good } })).not.toBeNull();
  });
});
