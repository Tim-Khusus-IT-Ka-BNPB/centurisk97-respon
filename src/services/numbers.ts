import {
  type NumbersArea,
  type NumbersFile,
  numbersAreas,
  numbersChanges,
  numbersRecord,
  saveNumbers,
} from "../adapters/postgres/numbers";
import type { DeskBpbdNumbers, DeskFacilityNumbers } from "../contract/numbers";
import { type ContactNumber, checkContactFile } from "../domain/contacts";
import { localDate } from "../domain/eventTime";
import { checkFacilityFile, type Facility } from "../domain/facilities";
import type { FieldError } from "../domain/identityForm";
import { type ContactEdit, type Edited, editContacts, editFacilities, type FacilityEdit } from "../domain/numbersEdit";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";
import { at } from "./draftView";

// BNPB keeps the BPBD numbers and the facility numbers on the desk: a page of each list, and edits
// one entry at a time over the version of the file the page was read from.

const PAGE_SIZE = 50;
const CHANGES_SHOWN = 20;

export type BpbdQuery = {
  readonly q: string;
  readonly page: number;
  // Only the areas with no number a reporter would be shown.
  readonly empty: boolean;
};

export type FacilityQuery = { readonly q: string; readonly kind: Facility[0] | null; readonly page: number };

const contactView = (one: ContactNumber) => ({
  nomor: one.nomor,
  jenis: one.jenis,
  url: one.url ?? null,
  lama: one.lama === true,
});

const facilityView = ([kind, lat, lon, name, phone]: Facility) => ({ kind, lat, lon, name, phone });

// One page of a list, the page asked kept within it.
function paged<T>(all: readonly T[], asked: number) {
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(asked, pages);
  return { total: all.length, page, pages, items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

// The latest changes; an entry is shown by its name where one is known (an area's, for its code).
async function changesOf<S, T>(
  bindings: ServiceBindings,
  name: NumbersFile,
  view: (stored: S) => T,
  names: ReadonlyMap<string, string> = new Map(),
) {
  return (await numbersChanges(bindings.db, name, CHANGES_SHOWN)).map((one) => {
    const at = { id: one.id, at: atWib(one.at) };
    if (one.change === "imported") return { ...at, change: one.change };
    const entry = one.entry as string;
    return {
      ...at,
      change: one.change,
      by: one.staff_label as string,
      entry: names.get(entry) ?? entry,
      before: one.before === null ? null : view(one.before as S),
      after: one.after === null ? null : view(one.after as S),
    };
  });
}

const atWib = (stored: string) => at(Date.parse(stored), "WIB");

const matches = (words: string, text: string) => text.toLowerCase().includes(words.trim().toLowerCase());

export async function deskBpbdNumbers(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: BpbdQuery,
): Promise<DeskAnswer<DeskBpbdNumbers>> {
  const refused = await admitted(bindings, staff, "editNumbers", "desk.read");
  if (refused) return refused;
  const [record, places] = await Promise.all([numbersRecord(bindings.db, "bpbdContacts"), numbersAreas(bindings.db)]);
  const file = checkContactFile(record?.body ?? null);
  const known = new Set(places.map((area) => area.code));
  // An area the file keys that the place data no longer has is still listed, so it can be put right.
  const others = Object.entries(file?.wilayah ?? {})
    .filter(([code]) => !known.has(code))
    .map(
      ([code, area]): NumbersArea => ({
        code,
        name: area.nama,
        provinceName: "",
        level: code.length === 2 ? "province" : "regency",
      }),
    );
  const areas = [...places, ...others]
    .map((area) => ({
      ...area,
      numbers: (file?.wilayah[area.code]?.bpbd ?? []).map((one, index) => ({ index, ...contactView(one) })),
    }))
    .filter(
      (area) =>
        matches(query.q, `${area.code} ${area.name} ${area.provinceName}`) &&
        (!query.empty || area.numbers.every((one) => one.lama)),
    );
  const { items, ...shown } = paged(areas, query.page);
  return {
    kind: "ok",
    body: {
      checksum: record?.checksum ?? null,
      ...shown,
      areas: items,
      changes: await changesOf(
        bindings,
        "bpbdContacts",
        contactView,
        new Map([...places, ...others].map((area) => [area.code, area.name])),
      ),
    },
  };
}

export async function deskFacilityNumbers(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: FacilityQuery,
): Promise<DeskAnswer<DeskFacilityNumbers>> {
  const refused = await admitted(bindings, staff, "editNumbers", "desk.read");
  if (refused) return refused;
  const record = await numbersRecord(bindings.db, "facilityNumbers");
  const facilities = (checkFacilityFile(record?.body ?? null)?.fasilitas ?? [])
    .map((one, index) => ({ index, ...facilityView(one) }))
    .filter((one) => (query.kind === null || one.kind === query.kind) && matches(query.q, `${one.name} ${one.phone}`));
  const { items, ...shown } = paged(facilities, query.page);
  return {
    kind: "ok",
    body: {
      checksum: record?.checksum ?? null,
      ...shown,
      facilities: items,
      changes: await changesOf(bindings, "facilityNumbers", facilityView),
    },
  };
}

export type NumbersEdited =
  | DeskAnswer<{ readonly checksum: string }>
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
  // Another edit or an import came first.
  | { readonly kind: "changed" }
  // The file would be left with nothing in it.
  | { readonly kind: "emptied" };

const CHANGE = { add: "added", change: "changed", remove: "removed" } as const;

async function saved<F>(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  file: { readonly name: NumbersFile; readonly startedFrom: string | null; readonly today: string },
  kind: keyof typeof CHANGE,
  result: Edited<F>,
): Promise<NumbersEdited> {
  if (!result.ok)
    return result.reason === "invalid" ? { kind: "invalid", errors: result.errors } : { kind: result.reason };
  const checksum = await saveNumbers(bindings.db, {
    name: file.name,
    body: result.file,
    dataDate: file.today,
    startedFrom: file.startedFrom,
    entry: result.entry,
    change: CHANGE[kind],
    before: result.before,
    after: result.after,
    staff: { id: staff.staffId, label: staff.label },
    at: new Date(bindings.clock.now()),
  });
  return checksum === null ? { kind: "changed" } : { kind: "ok", body: { checksum } };
}

// startedFrom is the checksum the page was read with: an edit over any other version is refused,
// so a stale page never changes the wrong entry.
export async function editBpbdNumbers(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  startedFrom: string | null,
  edit: ContactEdit,
): Promise<NumbersEdited> {
  const refused = await admitted(bindings, staff, "editNumbers", "desk.write");
  if (refused) return refused;
  const [record, places] = await Promise.all([numbersRecord(bindings.db, "bpbdContacts"), numbersAreas(bindings.db)]);
  if ((record?.checksum ?? null) !== startedFrom) return { kind: "changed" };
  const file = checkContactFile(record?.body ?? null);
  const name = places.find((area) => area.code === edit.code)?.name ?? file?.wilayah[edit.code]?.nama;
  if (name === undefined) return { kind: "notFound" };
  const today = localDate(bindings.clock.now(), "WIB");
  return saved(
    bindings,
    staff,
    { name: "bpbdContacts", startedFrom, today },
    edit.kind,
    editContacts(file, edit, name, today),
  );
}

export async function editFacilityNumbers(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  startedFrom: string | null,
  edit: FacilityEdit,
): Promise<NumbersEdited> {
  const refused = await admitted(bindings, staff, "editNumbers", "desk.write");
  if (refused) return refused;
  const record = await numbersRecord(bindings.db, "facilityNumbers");
  if ((record?.checksum ?? null) !== startedFrom) return { kind: "changed" };
  const today = localDate(bindings.clock.now(), "WIB");
  return saved(
    bindings,
    staff,
    { name: "facilityNumbers", startedFrom, today },
    edit.kind,
    editFacilities(checkFacilityFile(record?.body ?? null), edit, today),
  );
}
