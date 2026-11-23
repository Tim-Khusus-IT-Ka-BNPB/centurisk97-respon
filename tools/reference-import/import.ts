import { localDatabase } from "../../scripts/db/local.ts";
import { PlaceFileRefused, readPlaceFile } from "./read.ts";

// pnpm reference:import <file>: loads upstream's desa_cari.json into the local D1 database of
// APP_ENV as the new active place snapshot.
// The upstream floor applies, so a broken export that lists too few places is refused.
const [path] = process.argv.slice(2);
if (!path) {
  console.error("Usage: pnpm reference:import <path to desa_cari.json>");
  process.exit(2);
}

const { db, close } = await localDatabase();
try {
  const started = Date.now();
  const result = await readPlaceFile(db, path, { source: "upstream", withFloor: true });
  const state = result.written.kind === "written" ? `snapshot ${result.written.snapshotId} active` : "unchanged";
  console.log(
    `reference:import: ${state}, ${result.villages} villages, ${result.regencies} regencies, data date ${result.dataDate}, ${Date.now() - started} ms`,
  );
} catch (error: unknown) {
  if (error instanceof PlaceFileRefused) console.error(error.message);
  else {
    const code = /SQLITE_[A-Z_]+/.exec(String((error as Error | null)?.message))?.[0] ?? "unknown";
    console.error(`reference:import failed, ${code}`);
  }
  process.exitCode = 1;
} finally {
  await close();
}
