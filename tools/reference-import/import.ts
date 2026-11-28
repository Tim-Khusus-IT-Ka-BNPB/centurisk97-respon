import { dirname, resolve } from "node:path";
import { localDatabase } from "../../scripts/db/local.ts";
import { sqlState } from "../../src/platform/database.ts";
import { PlaceFileRefused, readPlaceFile } from "./read.ts";

// pnpm reference:import <file> [outlines]: loads upstream's desa_cari.json and its village
// outlines into the database at DATABASE_URL as the new active place snapshot. In the image:
// node build/node/import-places.js. The outlines
// default to upstream's layout, public/geo/desa beside public/data.
// The upstream floor applies, so a broken export that lists too few places is refused.
const [path, outlines] = process.argv.slice(2);
if (!path) {
  console.error("Usage: pnpm reference:import <path to desa_cari.json> [path to geo/desa]");
  process.exit(2);
}

const { db, close } = await localDatabase();
try {
  const started = Date.now();
  const shapesPath = outlines ?? resolve(dirname(path), "../geo/desa");
  const result = await readPlaceFile(db, path, { source: "upstream", withFloor: true, shapesPath });
  const state = result.written.kind === "written" ? `snapshot ${result.written.snapshotId} active` : "unchanged";
  console.log(
    `reference:import: ${state}, ${result.villages} villages, ${result.regencies} regencies, ${result.shapes} outlines, data date ${result.dataDate}, ${Date.now() - started} ms`,
  );
} catch (error: unknown) {
  if (error instanceof PlaceFileRefused) console.error(error.message);
  else {
    console.error(`reference:import failed, ${sqlState(error) ?? (error instanceof Error ? error.name : "unknown")}`);
  }
  process.exitCode = 1;
} finally {
  await close();
}
