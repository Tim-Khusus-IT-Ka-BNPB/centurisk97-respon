import type { Database } from "../../src/platform/database.ts";
import { importReferenceFile } from "../../tools/reference-import/file.ts";

// Synthetic stand-ins for upstream's contact and preparedness files, in their shapes. The contact
// numbers are 0800 numbers, never an agency's real line. Covered: a regency with its own number,
// a regency whose only number is marked old, a province with a number, and a province with none.
export default async function seedReference(db: Database): Promise<void> {
  await importReferenceFile(db, "bpbdContacts", "db/reference/bpbd-contacts.json", "seed");
  await importReferenceFile(db, "education", "db/reference/education.json", "seed");
  // The action labels and codes are upstream's own (owner's yes, 2026-11-25); they name no one.
  await importReferenceFile(db, "responseActions", "db/reference/response-actions.json", "seed");
  // A made-up outlook in upstream's shape for two seeded regencies: never a real forecast.
  await importReferenceFile(db, "forecast", "db/reference/forecast.json", "seed");
  // Upstream's copy of MAGMA's public volcano status, as it was on its date.
  await importReferenceFile(db, "volcanoes", "db/reference/volcanoes.json", "seed");
  // Upstream's facility numbers for all of Indonesia, as built on its date (pnpm reference:facilities).
  await importReferenceFile(db, "facilityNumbers", "db/reference/facility-numbers.json", "seed");
  // Upstream's gathering of BNPB's daily report and its news, as it was on its day.
  await importReferenceFile(db, "officialEvents", "db/reference/kabar.json", "seed");
}
