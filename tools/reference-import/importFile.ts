import { localDatabase } from "../../scripts/db/local.ts";
import { sqlState } from "../../src/platform/database.ts";
import { DeskEditsKept, importReferenceFile, ReferenceFileRefused, type ReferenceName } from "./file.ts";

// pnpm reference:import-file <name> <file> [--replace-desk-edits]: loads one of upstream's reference
// files (contacts, education, response actions, forecast, volcanoes, facility numbers) into the
// database at DATABASE_URL, checked against its contract first. A file BNPB edited on the desk since
// its last import is kept, unless --replace-desk-edits is given. In the image: node build/node/import-file.js.
const REPLACE = "--replace-desk-edits";
const given = process.argv.slice(2);
const [name, path] = given.filter((one) => one !== REPLACE);
const NAMES: readonly (string | undefined)[] = [
  "bpbdContacts",
  "education",
  "responseActions",
  "forecast",
  "volcanoes",
  "facilityNumbers",
];
if (!NAMES.includes(name) || !path) {
  console.error(
    `Usage: pnpm reference:import-file <bpbdContacts|education|responseActions|forecast|volcanoes|facilityNumbers> <path to the file> [${REPLACE}]`,
  );
  process.exit(2);
}

const { db, close } = await localDatabase();
try {
  const result = await importReferenceFile(db, name as ReferenceName, path, "upstream", given.includes(REPLACE));
  console.log(
    `reference:import-file: ${name} ${result.written ? "written" : "unchanged"}, data date ${result.dataDate}`,
  );
} catch (error: unknown) {
  if (error instanceof ReferenceFileRefused || error instanceof DeskEditsKept) console.error(error.message);
  else
    console.error(
      `reference:import-file failed, ${sqlState(error) ?? (error instanceof Error ? error.name : "unknown")}`,
    );
  process.exitCode = 1;
} finally {
  await close();
}
