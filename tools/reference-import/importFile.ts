import { localDatabase } from "../../scripts/db/local.ts";
import { importReferenceFile, ReferenceFileRefused, type ReferenceName } from "./file.ts";

// pnpm reference:import-file <bpbdContacts|education> <file>: loads upstream's
// public/data/bpbd_kontak.json or public/lapor/edukasi.json into the local D1 database of APP_ENV.
const [name, path] = process.argv.slice(2);
if ((name !== "bpbdContacts" && name !== "education") || !path) {
  console.error("Usage: pnpm reference:import-file <bpbdContacts|education> <path to the file>");
  process.exit(2);
}

const { db, close } = await localDatabase();
try {
  const result = await importReferenceFile(db, name as ReferenceName, path, "upstream");
  console.log(
    `reference:import-file: ${name} ${result.written ? "written" : "unchanged"}, data date ${result.dataDate}`,
  );
} catch (error: unknown) {
  if (error instanceof ReferenceFileRefused) console.error(error.message);
  else console.error(`reference:import-file failed, ${/SQLITE_[A-Z_]+/.exec(String(error))?.[0] ?? "unknown"}`);
  process.exitCode = 1;
} finally {
  await close();
}
