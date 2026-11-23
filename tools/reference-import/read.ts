import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { checkPlaceFile, type PlaceFileProblem, placeRecords } from "../../src/domain/placeFile.ts";
import type { Database } from "../../src/platform/database.ts";
import { writeSnapshot } from "./snapshot.ts";

const PROVINCES = "db/reference/provinces.json";

export class PlaceFileRefused extends Error {
  constructor(problem: PlaceFileProblem) {
    super(`Place file refused: ${JSON.stringify(problem)}`);
    this.name = "PlaceFileRefused";
  }
}

type Options = { readonly source: string; readonly withFloor: boolean };

// Reads a village file, checks it against its contract and writes it as the active snapshot.
export async function readPlaceFile(db: Database, path: string, options: Options) {
  const text = await readFile(path, "utf8");
  const provinces: Record<string, string> = JSON.parse(await readFile(PROVINCES, "utf8"));
  const checked = checkPlaceFile(JSON.parse(text), provinces, options.withFloor);
  if (!checked.ok) throw new PlaceFileRefused(checked.problem);
  const records = placeRecords(checked.file, provinces);
  const checksum = createHash("sha256").update(text).digest("hex");
  const written = await writeSnapshot(db, records, {
    source: options.source,
    dataDate: checked.file.dataDate,
    checksum,
  });
  return {
    written,
    dataDate: checked.file.dataDate,
    villages: records.villages.length,
    regencies: records.regencies.length,
  };
}
