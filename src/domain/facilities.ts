// The numbers of the hospitals, health centres, police and fire stations near a place (upstream's
// public/data/osm_nasional files: OpenStreetMap points, their numbers matched from Overture Maps
// Places, 26 Nov). Only places with a number are kept. Read as they are. No imports, so the Node
// builder shares this contract.
export const FACILITY_KINDS = ["rs", "puskesmas", "polisi", "damkar"] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

export type Facility = readonly [kind: FacilityKind, lat: number, lon: number, name: string, phone: string];

export type FacilityFile = {
  readonly dibuat: string;
  readonly sumber: string;
  readonly fasilitas: readonly Facility[];
};

// A number a phone can call: a plus and digits, or a short service number.
export const FACILITY_PHONE = /^(\+\d{8,15}|\d{3,12})$/;

const isFacility = (value: unknown) => {
  const one = value as readonly unknown[] | null;
  return (
    Array.isArray(one) &&
    FACILITY_KINDS.includes(one[0] as FacilityKind) &&
    typeof one[1] === "number" &&
    typeof one[2] === "number" &&
    typeof one[3] === "string" &&
    FACILITY_PHONE.test(String(one[4]))
  );
};

export function checkFacilityFile(json: unknown): FacilityFile | null {
  const file = json as Partial<FacilityFile> | null;
  if (typeof file?.sumber !== "string" || typeof file.dibuat !== "string" || Number.isNaN(Date.parse(file.dibuat)))
    return null;
  return Array.isArray(file.fasilitas) && file.fasilitas.length > 0 && file.fasilitas.every(isFacility)
    ? (file as FacilityFile)
    : null;
}
