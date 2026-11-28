import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { checkContactFile } from "../../src/domain/contacts.ts";
import { checkEducationFile } from "../../src/domain/education.ts";
import { checkFacilityFile } from "../../src/domain/facilities.ts";
import { checkForecastFile } from "../../src/domain/forecast.ts";
import { checkActionFile } from "../../src/domain/responseActions.ts";
import { checkVolcanoFile } from "../../src/domain/volcano.ts";
import { type Database, row, sql } from "../../src/platform/database.ts";

export type ReferenceName =
  | "bpbdContacts"
  | "education"
  | "responseActions"
  | "forecast"
  | "volcanoes"
  | "facilityNumbers";

export class ReferenceFileRefused extends Error {
  constructor(name: ReferenceName) {
    super(`Reference file refused: ${name} does not match its contract`);
    this.name = "ReferenceFileRefused";
  }
}

// BNPB changed the file on the desk since it was last imported: an import would wipe those edits.
export class DeskEditsKept extends Error {
  constructor(name: ReferenceName) {
    super(
      `Reference file kept: ${name} has edits made on the desk. Run again with --replace-desk-edits to replace them`,
    );
    this.name = "DeskEditsKept";
  }
}

// The data date each file names, or its version when it names none, once it passed its contract.
const CHECKS: Readonly<Record<ReferenceName, (json: unknown) => string | null>> = {
  bpbdContacts: (json) => checkContactFile(json)?.diperbarui ?? null,
  education: (json) => checkEducationFile(json)?.dibuat ?? null,
  responseActions: (json) => {
    const file = checkActionFile(json);
    return file === null ? null : `versi ${file.versi}`;
  },
  forecast: (json) => checkForecastFile(json)?.dibuat.slice(0, 10) ?? null,
  volcanoes: (json) => checkVolcanoFile(json)?.dibuat.slice(0, 10) ?? null,
  facilityNumbers: (json) => checkFacilityFile(json)?.dibuat ?? null,
};

// Reads a small upstream file, checks it against its contract and keeps it whole as the one in
// use, logged as imported. The same file twice writes nothing. A file edited on the desk since is
// replaced only when asked to.
export async function importReferenceFile(
  db: Database,
  name: ReferenceName,
  path: string,
  source: string,
  replaceDeskEdits = false,
) {
  const text = await readFile(path, "utf8");
  const dataDate = CHECKS[name](JSON.parse(text));
  if (dataDate === null) throw new ReferenceFileRefused(name);
  const checksum = createHash("sha256").update(text).digest("hex");
  const current = await row<{ checksum: string; source: string }>(
    db,
    sql`select checksum, source from reference_file where name = ${name}`,
  );
  if (current?.checksum === checksum) return { written: false, dataDate };
  if (current?.source === "desk" && !replaceDeskEdits) throw new DeskEditsKept(name);
  const now = new Date();
  await db.batch([
    sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
      values (${name}, ${dataDate}, ${source}, ${JSON.stringify(JSON.parse(text))}, ${checksum}, ${now})
      on conflict (name) do update set data_date = excluded.data_date, source = excluded.source, body = excluded.body,
        checksum = excluded.checksum, imported_at = excluded.imported_at`,
    sql`insert into reference_change (name, change, at) values (${name}, 'imported', ${now})`,
  ]);
  return { written: true, dataDate };
}
