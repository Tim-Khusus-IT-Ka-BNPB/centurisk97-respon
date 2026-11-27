import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Database, rows, sql } from "../src/platform/database.ts";
import { importReferenceFile, ReferenceFileRefused } from "../tools/reference-import/file.ts";

const db = (globalThis as { testD1?: Database }).testD1 as Database;
let folder = "";
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "reference-import-"));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const stored = async () =>
  rows<{ name: string; data_date: string; source: string }>(
    db,
    sql`select name, data_date, source from reference_file order by name`,
  );

describe("reference file importer", () => {
  test("the seeded files are in place, and the same file twice writes nothing", async () => {
    expect(await stored()).toEqual([
      { name: "bpbdContacts", data_date: "2026-11-22", source: "seed" },
      { name: "education", data_date: "2026-11-19", source: "seed" },
      { name: "forecast", data_date: "2026-11-26", source: "seed" },
      { name: "responseActions", data_date: "versi 1", source: "seed" },
      { name: "volcanoes", data_date: "2026-11-10", source: "seed" },
    ]);
    expect(await importReferenceFile(db, "education", "db/reference/education.json", "upstream")).toEqual({
      written: false,
      dataDate: "2026-11-19",
    });
  });

  test("a new file replaces the old one with its data date; a broken one is refused and nothing changes", async () => {
    const path = join(folder, "kontak.json");
    const file = {
      sumber: "uji",
      diperbarui: "2026-11-30",
      wilayah: { "11": { nama: "A", bpbd: [{ nomor: "0800-1100-0009", jenis: "kantor", url: null }] } },
    };
    await writeFile(path, JSON.stringify(file));
    expect(await importReferenceFile(db, "bpbdContacts", path, "upstream")).toEqual({
      written: true,
      dataDate: "2026-11-30",
    });
    await writeFile(path, JSON.stringify({ ...file, wilayah: {} }));
    const before = await stored();
    await expect(importReferenceFile(db, "bpbdContacts", path, "upstream")).rejects.toBeInstanceOf(
      ReferenceFileRefused,
    );
    await expect(importReferenceFile(db, "education", path, "upstream")).rejects.toThrow("education does not match");
    await expect(importReferenceFile(db, "responseActions", path, "upstream")).rejects.toBeInstanceOf(
      ReferenceFileRefused,
    );
    await expect(importReferenceFile(db, "forecast", path, "upstream")).rejects.toBeInstanceOf(ReferenceFileRefused);
    expect(await stored()).toEqual(before);
    await importReferenceFile(db, "bpbdContacts", "db/reference/bpbd-contacts.json", "seed");
  });
});
