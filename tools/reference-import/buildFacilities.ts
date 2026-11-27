import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkFacilityFile, FACILITY_KINDS } from "../../src/domain/facilities.ts";

// Builds the facility numbers file from upstream's per-province files (public/data/osm_nasional/
// <province>.json): the hospitals, health centres, police and fire stations that have a number.
// pnpm reference:facilities <upstream osm_nasional folder> > db/reference/facility-numbers.json
const folder = process.argv[2];
if (!folder) {
  console.error("Usage: pnpm reference:facilities <upstream osm_nasional folder>");
  process.exit(1);
}
const fasilitas: unknown[] = [];
for (const name of (await readdir(folder)).filter((one) => /^\d{2}\.json$/.test(one)).sort()) {
  const province = JSON.parse(await readFile(join(folder, name), "utf8")) as Record<string, unknown[][]>;
  for (const kind of FACILITY_KINDS)
    for (const [lat, lon, title, phone] of province[kind] ?? [])
      if (typeof phone === "string" && phone !== "") fasilitas.push([kind, lat, lon, title, phone]);
}
const file = {
  dibuat: new Date().toISOString().slice(0, 10),
  sumber: "OpenStreetMap, nomor dari Overture Maps Places",
  fasilitas,
};
if (checkFacilityFile(file) === null) {
  console.error("The files do not make a facility file that passes its contract");
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(file)}\n`);
