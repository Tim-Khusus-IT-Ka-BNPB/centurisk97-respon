import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import provinceNames from "../../db/reference/provinces.json" with { type: "json" };
import { checkPlaceFile, type PlaceFileProblem, placeRecords, UPSTREAM_FLOOR } from "../../src/domain/placeFile.ts";
import { checkShapeFiles, type ShapeFileProblem } from "../../src/domain/shapeFile.ts";
import type { Database } from "../../src/platform/database.ts";
import { writeSnapshot } from "./snapshot.ts";

// Bundled with the code, so the import commands in the image need no file of the repo beside them.
const PROVINCES: Readonly<Record<string, string>> = provinceNames;

type ImportProblem = PlaceFileProblem | ShapeFileProblem | { readonly kind: "tooFewShapes"; readonly shapes: number };

export class PlaceFileRefused extends Error {
  constructor(problem: ImportProblem) {
    super(`Place file refused: ${JSON.stringify(problem)}`);
    this.name = "PlaceFileRefused";
  }
}

type Options = {
  readonly source: string;
  readonly withFloor: boolean;
  // One outline file, or a folder of them (upstream's public/geo/desa, one file per regency).
  readonly shapesPath: string;
};

async function shapeTexts(path: string): Promise<string[]> {
  if (!(await stat(path)).isDirectory()) return [await readFile(path, "utf8")];
  const names = (await readdir(path)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readFile(join(path, name), "utf8")));
}

// Reads a village file and its outlines, checks both against their contracts and writes them as
// the active snapshot. With the floor on, outlines for too few villages are refused as a false empty.
export async function readPlaceFile(db: Database, path: string, options: Options) {
  const text = await readFile(path, "utf8");
  const checked = checkPlaceFile(JSON.parse(text), PROVINCES, options.withFloor);
  if (!checked.ok) throw new PlaceFileRefused(checked.problem);
  const shapeFiles = await shapeTexts(options.shapesPath);
  const shapes = checkShapeFiles(shapeFiles.map((one) => JSON.parse(one)));
  if (!shapes.ok) throw new PlaceFileRefused(shapes.problem);
  const records = placeRecords(checked.file, PROVINCES);
  const villages = new Set(records.villages.map((village) => village.code));
  const matched = shapes.shapes.filter((shape) => villages.has(shape.code)).length;
  if (options.withFloor && matched < UPSTREAM_FLOOR.villages)
    throw new PlaceFileRefused({ kind: "tooFewShapes", shapes: matched });
  const checksum = createHash("sha256").update(text);
  for (const one of shapeFiles) checksum.update(one);
  const written = await writeSnapshot(db, records, shapes.shapes, {
    source: options.source,
    dataDate: checked.file.dataDate,
    checksum: checksum.digest("hex"),
  });
  return {
    written,
    dataDate: checked.file.dataDate,
    villages: records.villages.length,
    regencies: records.regencies.length,
    shapes: matched,
  };
}
