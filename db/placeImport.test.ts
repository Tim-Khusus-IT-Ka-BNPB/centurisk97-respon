import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Database, rows, sql } from "../src/platform/database.ts";
import { PlaceFileRefused, readPlaceFile } from "../tools/reference-import/read.ts";

// The importer writes to this file's own in-memory D1 database, as pnpm reference:import writes
// to the local one.
const db = (globalThis as { testD1?: Database }).testD1 as Database;
const query = <T>(strings: TemplateStringsArray, ...values: unknown[]) => rows<T>(db, sql(strings, ...values));
const SEED = "db/reference/villages.json";
const SHAPES = "db/reference/village-shapes.json";
let folder = "";
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "place-import-"));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const snapshots = async () =>
  query<{ id: number; source: string; active: number; data_date: string }>`
    select id, source, active, data_date from place_snapshot order by id`;

describe("place importer", () => {
  test("an upstream file under the floor is refused as a false empty and nothing is written", async () => {
    const before = await snapshots();
    const refused = readPlaceFile(db, SEED, { source: "upstream", withFloor: true, shapesPath: SHAPES });
    await expect(refused).rejects.toBeInstanceOf(PlaceFileRefused);
    await expect(refused).rejects.toThrow('"kind":"tooFew","villages":967,"regencies":52');
    expect(await snapshots()).toEqual(before);
  });

  test("a file that breaks its contract is refused before anything is written", async () => {
    const before = await snapshots();
    const path = join(folder, "broken.json");
    await writeFile(path, JSON.stringify({ dibuat: "2026-10-25", sumber: "x", kab: {}, baris: [["1", "a", "b"]] }));
    await expect(readPlaceFile(db, path, { source: "upstream", withFloor: false, shapesPath: SHAPES })).rejects.toThrow(
      '"kind":"row"',
    );
    expect(await snapshots()).toEqual(before);
  });

  test("a folder of outline files is read file by file; a broken one is refused before anything is written", async () => {
    const shapes = JSON.parse(await readFile(SHAPES, "utf8")) as { features: unknown[] };
    const dir = join(folder, "desa");
    await mkdir(dir);
    await writeFile(join(dir, "a.json"), JSON.stringify({ ...shapes, features: shapes.features.slice(0, 500) }));
    await writeFile(join(dir, "b.json"), JSON.stringify({ ...shapes, features: shapes.features.slice(500) }));
    await writeFile(join(dir, "notes.txt"), "not an outline file");
    const path = join(folder, "folder.json");
    await writeFile(path, `${await readFile(SEED, "utf8")}\n\n`);
    const result = await readPlaceFile(db, path, { source: "upstream", withFloor: false, shapesPath: dir });
    expect(result).toMatchObject({ written: { kind: "written" }, shapes: 967 });
    await writeFile(join(dir, "c.json"), JSON.stringify({ type: "Feature" }));
    const before = await snapshots();
    await expect(readPlaceFile(db, SEED, { source: "seed", withFloor: false, shapesPath: dir })).rejects.toThrow(
      '"kind":"shape"',
    );
    expect(await snapshots()).toEqual(before);
    await readPlaceFile(db, SEED, { source: "seed", withFloor: false, shapesPath: SHAPES });
  });

  test("a country file with outlines for too few of its villages is refused as a false empty", async () => {
    // 500 regencies of 161 villages each: over the floor, with the seed outlines only.
    const provinces = Object.keys(JSON.parse(await readFile("db/reference/provinces.json", "utf8")));
    const kab: Record<string, string> = {};
    const baris: [string, string, string][] = [];
    for (let r = 0; r < 500; r++) {
      const code = `${provinces[r % provinces.length]}.${String(50 + Math.floor(r / provinces.length)).padStart(2, "0")}`;
      kab[code] = `Kabupaten Uji ${r}`;
      for (let v = 0; v < 161; v++) baris.push([`${code}.01.${String(1000 + v)}`, `Desa ${v}`, "Uji"]);
    }
    const path = join(folder, "country.json");
    await writeFile(path, JSON.stringify({ dibuat: "2026-10-25", sumber: "uji", kab, baris }));
    await expect(readPlaceFile(db, path, { source: "upstream", withFloor: true, shapesPath: SHAPES })).rejects.toThrow(
      '"kind":"tooFewShapes","shapes":0',
    );
  });

  test("the active file again writes nothing", async () => {
    const result = await readPlaceFile(db, SEED, { source: "seed", withFloor: false, shapesPath: SHAPES });
    expect(result).toEqual({
      written: { kind: "unchanged" },
      dataDate: "2026-10-25",
      villages: 967,
      regencies: 52,
      shapes: 967,
    });
  });

  test("a new file becomes the one searched with its data date and districts, and two snapshots are kept", async () => {
    const path = join(folder, "changed.json");
    await writeFile(path, `${await readFile(SEED, "utf8")}\n`);
    const result = await readPlaceFile(db, path, { source: "upstream", withFloor: false, shapesPath: SHAPES });
    expect(result.written.kind).toBe("written");
    const id = result.written.kind === "written" ? result.written.snapshotId : 0;
    const [counts] = await query<{ villages: number; districts: number; regencies: number }>`
      select (select count(*) from place_village where snapshot_id = ${id}) as villages,
        (select count(*) from place_district where snapshot_id = ${id}) as districts,
        (select count(*) from place_regency where snapshot_id = ${id}) as regencies`;
    expect(counts).toEqual({ villages: 967, districts: 105, regencies: 52 });
    const [searchText] = await query<{ search_text: string }>`
      select search_text from place_district where snapshot_id = ${id} and name = 'Sukamaju'`;
    expect(searchText?.search_text).toBe("sukamaju luwu utara");
    expect((await snapshots()).filter((row) => row.active)).toEqual([
      { id, source: "upstream", active: 1, data_date: "2026-10-25" },
    ]);

    const restored = await readPlaceFile(db, SEED, { source: "seed", withFloor: false, shapesPath: SHAPES });
    expect(restored.written.kind).toBe("written");
    const kept = await snapshots();
    expect(kept.map((row) => [row.source, row.active])).toEqual([
      ["upstream", 0],
      ["seed", 1],
    ]);
  });
});
