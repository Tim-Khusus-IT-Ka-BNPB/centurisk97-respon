import { localDatabase } from "../../scripts/db/local.ts";
import { placeQueryWords } from "../../src/domain/placeText.ts";
import { type Database, row, sql } from "../../src/platform/database.ts";

// pnpm reference:timing: times the place search on the active snapshot of the local D1 database,
// through the same repository functions the API uses. Run it after importing the full file.
type Hits = { readonly items: readonly { readonly level: string; readonly name: string }[]; readonly total: number };
type Area = { readonly level: "regency" | "district"; readonly code: string };
type Places = {
  activeSnapshot(db: Database): Promise<{ id: number; dataDate: string } | null>;
  searchCountry(db: Database, snapshotId: number, words: readonly string[], limit: number): Promise<Hits>;
  searchArea(db: Database, snapshotId: number, area: Area, words: readonly string[], limit: number): Promise<Hits>;
};
// Loaded by address: the repository is compiled with the Worker's settings, not the scripts'.
const places = (await import(new URL("../../src/adapters/postgres/places.ts", import.meta.url).href)) as Places;

const RUNS = 21;
const COUNTRY = ["sukamaju", "suka", "jaya", "aceh", "sari", "kota bandung", "mekar jaya garut", "zzqx", "su ka ma"];
const AREAS: readonly (readonly [Area, string])[] = [
  [{ level: "regency", code: "11.08" }, ""],
  [{ level: "regency", code: "11.08" }, "blang"],
  [{ level: "district", code: "11.08.01" }, ""],
];

const { db, close } = await localDatabase();
async function timed(label: string, run: () => Promise<Hits>): Promise<void> {
  const times: number[] = [];
  let last: Hits = { items: [], total: 0 };
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    last = await run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)] as number;
  const worst = times[RUNS - 1] as number;
  console.log(
    `${label}: total ${last.total}, shown ${last.items.length}, median ${median.toFixed(1)} ms, max ${worst.toFixed(1)} ms`,
  );
}

try {
  const snapshot = await places.activeSnapshot(db);
  if (snapshot === null) throw new Error("No active place snapshot. Run pnpm reference:import first.");
  const count = await row<{ villages: number }>(
    db,
    sql`select village_count as villages from place_snapshot where id = ${snapshot.id}`,
  );
  console.log(
    `snapshot ${snapshot.id}, ${count?.villages} villages, data date ${snapshot.dataDate}, ${RUNS} runs each`,
  );
  for (const query of COUNTRY) {
    await timed(`country "${query}"`, () => places.searchCountry(db, snapshot.id, placeQueryWords(query), 10));
  }
  for (const [area, query] of AREAS) {
    await timed(`${area.level} ${area.code} "${query}"`, () =>
      places.searchArea(db, snapshot.id, area, placeQueryWords(query), 40),
    );
  }
} finally {
  await close();
}
