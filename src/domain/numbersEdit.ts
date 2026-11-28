import { type ContactFile, type ContactNumber, checkContactFile } from "./contacts";
import { checkFacilityFile, FACILITY_KINDS, FACILITY_PHONE, type Facility, type FacilityFile } from "./facilities";
import { inIndonesia } from "./geo";
import type { FieldError } from "./identityForm";

// BNPB keeps the BPBD numbers and the facility numbers on the desk, one entry at a time. Every edit
// leaves the whole file valid, since the ticket card, /track and the nearby numbers read it whole.

// The kinds of BPBD number, in the order a reporter is shown them.
export const CONTACT_KINDS = ["call_center", "pusdalops", "wa", "kantor"] as const;

// One BPBD number and one facility as staff typed them, before they are read.
export type ContactInput = {
  readonly nomor: string;
  readonly jenis: string;
  readonly url: string;
  readonly lama: boolean;
};

export type FacilityInput = {
  readonly kind: string;
  readonly name: string;
  readonly phone: string;
  readonly lat: string;
  readonly lon: string;
};

export type ContactEdit =
  | { readonly kind: "add"; readonly code: string; readonly number: ContactInput }
  | { readonly kind: "change"; readonly code: string; readonly index: number; readonly number: ContactInput }
  | { readonly kind: "remove"; readonly code: string; readonly index: number };

export type FacilityEdit =
  | { readonly kind: "add"; readonly facility: FacilityInput }
  | { readonly kind: "change"; readonly index: number; readonly facility: FacilityInput }
  | { readonly kind: "remove"; readonly index: number };

// An edit kept: the whole file after it, and the one entry before and after, for the change log.
export type Edited<F> =
  | { readonly ok: true; readonly file: F; readonly entry: string; readonly before: unknown; readonly after: unknown }
  | { readonly ok: false; readonly reason: "invalid"; readonly errors: readonly FieldError[] }
  // No such entry, or a file left with nothing in it.
  | { readonly ok: false; readonly reason: "notFound" | "emptied" };

// Where a file starts when none was ever loaded.
const SOURCE = "Meja laporan BNPB";

// A BPBD number: digits, with the spaces, dots, dashes and brackets people write them with.
const NUMBER_TEXT = /^\+?[\d\s().-]+$/;

const refused = (fieldId: string): FieldError => ({ fieldId, rule: fieldId, params: {} });

const isWebAddress = (text: string) => URL.canParse(text) && ["http:", "https:"].includes(new URL(text).protocol);

function contactErrors(input: ContactInput): FieldError[] {
  const nomor = input.nomor.trim();
  const digits = nomor.replace(/\D/g, "").length;
  const url = input.url.trim();
  return [
    NUMBER_TEXT.test(nomor) && nomor.length <= 30 && digits >= 6 && digits <= 15 ? null : refused("nomor"),
    (CONTACT_KINDS as readonly string[]).includes(input.jenis) ? null : refused("jenis"),
    url === "" || (url.length <= 300 && isWebAddress(url)) ? null : refused("url"),
  ].filter((error) => error !== null);
}

// The number as the file keeps it. A changed number keeps what else the file said of it (its
// date); "lama" is written only when set.
function numberOf(input: ContactInput, before: object): ContactNumber {
  const kept = Object.fromEntries(Object.entries(before).filter(([key]) => key !== "lama"));
  const url = input.url.trim();
  const number = { ...kept, nomor: input.nomor.trim(), jenis: input.jenis, url: url === "" ? null : url };
  return input.lama ? { ...number, lama: true } : number;
}

// A number a phone can dial: separators dropped, the 0 of a national number turned into +62.
function facilityPhone(text: string): string {
  const plain = text.replace(/[\s().-]/g, "");
  return plain.startsWith("0") && plain.length >= 9 ? `+62${plain.slice(1)}` : plain;
}

// "4,15595" or "4.15595".
const degrees = (text: string) => Number(text.replace(",", "."));

function facilityOf(input: FacilityInput): { readonly facility: Facility } | { readonly errors: FieldError[] } {
  const name = input.name.trim();
  const phone = facilityPhone(input.phone);
  const point = { lat: degrees(input.lat), lon: degrees(input.lon) };
  const errors = [
    (FACILITY_KINDS as readonly string[]).includes(input.kind) ? null : refused("kind"),
    name.length >= 2 && name.length <= 120 ? null : refused("name"),
    FACILITY_PHONE.test(phone) ? null : refused("phone"),
    inIndonesia(point) ? null : refused("point"),
  ].filter((error) => error !== null);
  if (errors.length > 0) return { errors };
  return { facility: [input.kind as Facility[0], point.lat, point.lon, name, phone] };
}

// The list after an edit: one added at the end, or the one at the index replaced or dropped.
function edited<T>(
  list: readonly T[],
  edit: { readonly kind: "add" } | { readonly kind: "change" | "remove"; readonly index: number },
  after: T | null,
): readonly T[] {
  if (edit.kind === "add") return [...list, after as T];
  return list.flatMap((one, index) => (index !== edit.index ? [one] : after === null ? [] : [after]));
}

const NOT_FOUND = { ok: false, reason: "notFound" } as const;
const EMPTIED = { ok: false, reason: "emptied" } as const;

// One BPBD number of an area added, changed or removed. areaName names an area the file does not list
// yet. An area left with no number of either kind leaves the file.
export function editContacts(
  file: ContactFile | null,
  edit: ContactEdit,
  areaName: string,
  today: string,
): Edited<ContactFile> {
  const areas = file?.wilayah ?? {};
  const area = areas[edit.code];
  const numbers = area?.bpbd ?? [];
  const before = edit.kind === "add" ? null : numbers[edit.index];
  if (before === undefined) return NOT_FOUND;
  let after: ContactNumber | null = null;
  if (edit.kind !== "remove") {
    const errors = contactErrors(edit.number);
    if (errors.length > 0) return { ok: false, reason: "invalid", errors };
    after = numberOf(edit.number, before ?? {});
  }
  const bpbd = edited(numbers, edit, after);
  const entry = { ...(area ?? { nama: areaName }), bpbd };
  const keep = bpbd.length > 0 || "damkar" in entry;
  const wilayah = keep
    ? { ...areas, [edit.code]: entry }
    : Object.fromEntries(Object.entries(areas).filter(([code]) => code !== edit.code));
  const result = checkContactFile({ sumber: file?.sumber ?? SOURCE, diperbarui: today, wilayah });
  return result === null ? EMPTIED : { ok: true, file: result, entry: edit.code, before, after };
}

// One facility added, changed or removed.
export function editFacilities(file: FacilityFile | null, edit: FacilityEdit, today: string): Edited<FacilityFile> {
  const all = file?.fasilitas ?? [];
  const before = edit.kind === "add" ? null : all[edit.index];
  if (before === undefined) return NOT_FOUND;
  let after: Facility | null = null;
  if (edit.kind !== "remove") {
    const read = facilityOf(edit.facility);
    if ("errors" in read) return { ok: false, reason: "invalid", errors: read.errors };
    after = read.facility;
  }
  const result = checkFacilityFile({
    dibuat: today,
    sumber: file?.sumber ?? SOURCE,
    fasilitas: edited(all, edit, after),
  });
  const entry = (after ?? (before as Facility))[3];
  return result === null ? EMPTIED : { ok: true, file: result, entry, before, after };
}
