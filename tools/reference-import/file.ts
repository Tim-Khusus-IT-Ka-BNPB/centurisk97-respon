import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { checkContactFile } from "../../src/domain/contacts.ts";
import { checkEducationFile } from "../../src/domain/education.ts";
import { checkForecastFile } from "../../src/domain/forecast.ts";
import { checkActionFile } from "../../src/domain/responseActions.ts";
import { checkVolcanoFile } from "../../src/domain/volcano.ts";
import { type Database, row, run, sql } from "../../src/platform/database.ts";

export type ReferenceName = "bpbdContacts" | "education" | "responseActions" | "forecast" | "volcanoes";

export class ReferenceFileRefused extends Error {
  constructor(name: ReferenceName) {
    super(`Reference file refused: ${name} does not match its contract`);
    this.name = "ReferenceFileRefused";
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
};

// Reads a small upstream file, checks it against its contract and keeps it whole as the one in
// use. The same file twice writes nothing.
export async function importReferenceFile(db: Database, name: ReferenceName, path: string, source: string) {
  const text = await readFile(path, "utf8");
  const dataDate = CHECKS[name](JSON.parse(text));
  if (dataDate === null) throw new ReferenceFileRefused(name);
  const checksum = createHash("sha256").update(text).digest("hex");
  const same = await row(db, sql`select 1 as one from reference_file where name = ${name} and checksum = ${checksum}`);
  if (same) return { written: false, dataDate };
  await run(
    db,
    sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
      values (${name}, ${dataDate}, ${source}, ${JSON.stringify(JSON.parse(text))}, ${checksum}, ${new Date()})
      on conflict (name) do update set data_date = excluded.data_date, source = excluded.source, body = excluded.body,
        checksum = excluded.checksum, imported_at = excluded.imported_at`,
  );
  return { written: true, dataDate };
}
