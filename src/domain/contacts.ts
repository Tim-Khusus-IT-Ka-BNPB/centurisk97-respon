// Upstream's BPBD contact file (public/data/bpbd_kontak.json): per province ("16") and regency
// ("1101") the agency's numbers, each with its kind and source page, some marked old. No imports,
// so the Node import scripts share this contract.

type ContactNumber = {
  readonly nomor: string;
  readonly jenis: string;
  readonly url: string | null;
  readonly lama?: boolean;
};

type AreaEntry = { readonly nama: string; readonly bpbd: readonly ContactNumber[] };

export type ContactFile = {
  readonly sumber: string;
  readonly diperbarui: string;
  readonly wilayah: Readonly<Record<string, AreaEntry>>;
};

const AREA_KEY = /^\d{2}(\d{2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isNumber = (value: unknown): value is ContactNumber => {
  const item = value as Partial<ContactNumber> | null;
  return (
    typeof item?.nomor === "string" &&
    typeof item.jenis === "string" &&
    (item.url === null || item.url === undefined || typeof item.url === "string") &&
    (item.lama === undefined || typeof item.lama === "boolean")
  );
};

const isEntry = (value: unknown): value is AreaEntry => {
  const entry = value as Partial<AreaEntry> | null;
  return typeof entry?.nama === "string" && Array.isArray(entry.bpbd) && entry.bpbd.every(isNumber);
};

// The file as its contract says, or null. An empty list of areas is a broken export, not a country.
export function checkContactFile(json: unknown): ContactFile | null {
  const file = json as Partial<ContactFile> | null;
  if (typeof file?.sumber !== "string" || typeof file.diperbarui !== "string" || !DATE.test(file.diperbarui))
    return null;
  const areas = file.wilayah;
  // Only a plain object: not null, not a list, not a function.
  if (Object.getPrototypeOf(areas ?? 0) !== Object.prototype) return null;
  const entries = Object.entries(areas as object);
  if (entries.length === 0 || !entries.every(([key, entry]) => AREA_KEY.test(key) && isEntry(entry))) return null;
  return file as ContactFile;
}

// Upstream's order: the call centre first, then the operations room, WhatsApp, the office.
const RANK: Readonly<Record<string, number>> = { call_center: 0, pusdalops: 1, wa: 2, kantor: 3 };

export type BpbdContact =
  | { readonly level: "regency" | "province"; readonly phone: string; readonly kind: string }
  | { readonly level: "national" };

// The number a reporter is shown: the regency's BPBD, else its province's, else BNPB's 117 (K88).
// A number marked old, or with fewer than 6 digits, is never shown; none is ever made up.
export function pickContact(file: ContactFile | null, villageCode: string): BpbdContact {
  const usable = (key: string) =>
    (file?.wilayah[key]?.bpbd ?? [])
      .filter((item) => item.lama !== true && item.nomor.replace(/\D/g, "").length >= 6)
      .sort((a, b) => (RANK[a.jenis] ?? 4) - (RANK[b.jenis] ?? 4));
  const regency = usable(villageCode.slice(0, 5).replace(".", ""))[0];
  if (regency) return { level: "regency", phone: regency.nomor, kind: regency.jenis };
  const province = usable(villageCode.slice(0, 2))[0];
  if (province) return { level: "province", phone: province.nomor, kind: province.jenis };
  return { level: "national" };
}
