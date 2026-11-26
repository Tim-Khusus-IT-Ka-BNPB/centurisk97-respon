import type { Database } from "../platform/database";
import { sha256Hex } from "../platform/keys";

// The main site's sign-in tables, as upstream's migrations make them (0029, 0030, 0133, 0152, 0166),
// cut to the columns the upstream identity adapter reads. Synthetic rows only.
const TABLES = [
  `CREATE TABLE IF NOT EXISTS staf (id TEXT PRIMARY KEY, nama TEXT NOT NULL, peran TEXT NOT NULL,
    wilayah TEXT NOT NULL DEFAULT '[]', wajib_ganti INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'aktif')`,
  `CREATE TABLE IF NOT EXISTS staf_sesi (token_sha TEXT PRIMARY KEY, staf_id TEXT NOT NULL, kedaluwarsa INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS instansi_akun (id TEXT PRIMARY KEY, jenis TEXT NOT NULL, tingkat TEXT NOT NULL,
    wilayah TEXT NOT NULL, kunci_wilayah TEXT NOT NULL, cakupan TEXT NOT NULL, prov TEXT, kab TEXT,
    status TEXT NOT NULL, dummy INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS instansi_profil (id TEXT PRIMARY KEY, akun_id TEXT NOT NULL, nama TEXT NOT NULL,
    jabatan TEXT NOT NULL, wa TEXT NOT NULL, pin_wajib_ganti INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
    terakhir_masuk INTEGER)`,
  `CREATE TABLE IF NOT EXISTS instansi_sesi_profil (sesi_sha TEXT PRIMARY KEY, profil_id TEXT NOT NULL,
    akun_id TEXT NOT NULL, kedaluwarsa INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mk_akun (id TEXT PRIMARY KEY, wa TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aktif')`,
  `CREATE TABLE IF NOT EXISTS mk_sesi (token_sha TEXT PRIMARY KEY, mk_id TEXT NOT NULL, habis INTEGER NOT NULL)`,
];

export async function mainSiteDatabase(): Promise<Database> {
  const db = (globalThis as { testMainD1?: Database }).testMainD1 as Database;
  await db.batch(TABLES.map((statement) => db.prepare(statement)));
  return db;
}

// A session token as upstream issues it (64 hex), and the fingerprint it stores.
export async function mainToken(): Promise<{ token: string; sha: string }> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { token, sha: await sha256Hex(token) };
}

export async function mainRun(db: Database, statement: string, ...values: unknown[]): Promise<void> {
  await db
    .prepare(statement)
    .bind(...values)
    .run();
}
