import type { Database } from "../../src/platform/database.ts";
import { readPlaceFile } from "../../tools/reference-import/read.ts";

// The pinned village file: a small cut of upstream's desa_cari.json in the same shape, holding
// what the tests need (more than 10 "sukamaju" villages, one large regency, a WIT and a WITA
// regency). It is far below the upstream floor, so it is loaded with the floor off.
const VILLAGES = "db/reference/villages.json";

export default async function seedPlaces(db: Database): Promise<void> {
  await readPlaceFile(db, VILLAGES, { source: "seed", withFloor: false });
}
