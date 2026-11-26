import { parse } from "hono/utils/cookie";
import type { StaffScope } from "../../domain/deskRights";
import { type Database, row, rows, sql } from "../../platform/database";
import { hmacKey, sha256Hex } from "../../platform/keys";
import type { Clock } from "../../ports/clock";
import type { IdentityPort, Officer, Principal, StaffPrincipal } from "../../ports/identity";
import { DEVICE_COOKIE, deviceOf } from "./seeded";

// The main site's sign-in (upstream KEPUTUSAN-MASUK K21, K25), read from its own database: BNPB
// staff by their staff session, a BPBD officer by the profile they picked after the account's
// password, and a reporter by the WhatsApp code session, which never makes staff. Only token
// fingerprints are looked up, as upstream stores them. A typed number on this browser stays ours.
export const STAFF_COOKIE = "sesi_staf";
export const PROFILE_COOKIE = "sesi_profil";
export const MAIN_COOKIE = "sesi_masuk";

const TOKEN = /^[0-9a-f]{64}$/;
// Staff roles that work the report desk (upstream stafMeja).
const DESK_ROLES = ["pusdalops", "koordalops"];
// Local government accounts are the BPBD on the desk (upstream Q53).
const BPBD_KINDS = ["pemkab", "pemkot", "pemprov"];
const ROLE_NAMES: Readonly<Record<string, string>> = { pusdalops: "Pusdalops", koordalops: "Koordinator Pusdalops" };

// "Kabupaten Bogor", "Kab. Bogor" and "Bogor" are one regency; "Kota Administrasi X" is "Kota X".
export const regencyKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^kota administrasi\s+/, "kota ")
    .replace(/^(kabupaten|kab\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

// Upstream keeps numbers as "62..." digits; ours carry the plus.
const stored = (wa: string) => `+${wa}`;

const fingerprint = async (token: string | undefined) =>
  token !== undefined && TOKEN.test(token) ? sha256Hex(token) : null;

type StaffRow = { id: string; nama: string; peran: string; wilayah: string };

async function staffOf(main: Database, token: string | undefined, nowMs: number): Promise<StaffPrincipal | null> {
  const hash = await fingerprint(token);
  if (hash === null) return null;
  const found = await row<StaffRow>(
    main,
    sql`select s.id, s.nama, s.peran, s.wilayah from staf_sesi x join staf s on s.id = x.staf_id
      where x.token_sha = ${hash} and x.kedaluwarsa > ${nowMs} and s.status = 'aktif' and s.wajib_ganti = 0`,
  );
  if (found === null) return null;
  const roles = JSON.parse(found.peran) as string[];
  const role = DESK_ROLES.find((one) => roles.includes(one));
  const provinces = JSON.parse(found.wilayah) as string[];
  // The desk works one region per account: national, or one province.
  if (role === undefined || provinces.length > 1) return null;
  const [province] = provinces;
  return {
    kind: "staff",
    staffId: `staf:${found.id}`,
    role: "deskOfficer",
    label: `${ROLE_NAMES[role]} BNPB, ${found.nama}`,
    scope: province === undefined ? { level: "national" } : { level: "province", code: province },
    profile: null,
  };
}

type AccountRow = {
  akun_id: string;
  jenis: string;
  tingkat: string;
  wilayah: string;
  prov: string | null;
  kab: string | null;
};

// The regency an account works, by its code or, as upstream often keeps it, by its name.
async function regencyOf(db: Database, province: string, kab: string): Promise<{ code: string; name: string } | null> {
  if (/^\d{2}\.\d{2}$/.test(kab)) {
    const named = await row<{ name: string }>(
      db,
      sql`select r.name from place_regency r join place_snapshot s on s.id = r.snapshot_id and s.active = 1
        where r.code = ${kab}`,
    );
    return named === null || !kab.startsWith(province) ? null : { code: kab, name: named.name };
  }
  const found = await rows<{ code: string; name: string }>(
    db,
    sql`select r.code, r.name from place_regency r join place_snapshot s on s.id = r.snapshot_id and s.active = 1
      where r.province_code = ${province}`,
  );
  return found.find((one) => regencyKey(one.name) === regencyKey(kab)) ?? null;
}

// "BPBD Kabupaten Aceh Utara", "BPBD Kota Bogor", "BPBD Provinsi Aceh".
const agencyOf = (level: StaffScope["level"], name: string) =>
  level === "province" ? `BPBD ${name}` : /^kota /i.test(name) ? `BPBD ${name}` : `BPBD Kabupaten ${name}`;

async function areaOf(db: Database, account: AccountRow): Promise<{ scope: StaffScope; agency: string } | null> {
  const province = account.prov ?? "";
  if (!BPBD_KINDS.includes(account.jenis) || !/^\d{2}$/.test(province)) return null;
  if (account.tingkat === "prov")
    return { scope: { level: "province", code: province }, agency: agencyOf("province", account.wilayah) };
  const regency = await regencyOf(db, province, account.kab ?? "");
  return regency === null
    ? null
    : { scope: { level: "regency", code: regency.code }, agency: agencyOf("regency", regency.name) };
}

async function officerOf(
  db: Database,
  main: Database,
  token: string | undefined,
  nowMs: number,
): Promise<StaffPrincipal | null> {
  const hash = await fingerprint(token);
  if (hash === null) return null;
  const found = await row<AccountRow & { profil_id: string; nama: string; jabatan: string; pin_wajib_ganti: number }>(
    main,
    sql`select p.id profil_id, p.nama, p.jabatan, p.pin_wajib_ganti, a.id akun_id, a.jenis, a.tingkat, a.wilayah,
        coalesce(a.prov, case when a.tingkat = 'prov' then json_extract(a.cakupan, '$[0]') end) prov, a.kab
      from instansi_sesi_profil x
        join instansi_profil p on p.id = x.profil_id and p.status = 'aktif'
        join instansi_akun a on a.id = x.akun_id and a.status = 'aktif'
      where x.sesi_sha = ${hash} and x.kedaluwarsa > ${nowMs}`,
  );
  // A PIN still to change opens nothing on the desk, as upstream.
  if (found === null || found.pin_wajib_ganti === 1) return null;
  const area = await areaOf(db, found);
  if (area === null) return null;
  return {
    kind: "staff",
    staffId: `akun:${found.akun_id}`,
    role: "regionalOfficer",
    label: `${area.agency}, ${found.nama}`,
    scope: area.scope,
    profile: { id: found.profil_id, name: found.nama, position: found.jabatan, agency: area.agency },
  };
}

// The code session's number is a reporter of ours, made the first time it is seen.
async function reporterOf(
  db: Database,
  main: Database,
  secret: string,
  token: string | undefined,
  nowMs: number,
): Promise<Principal | null> {
  const hash = await fingerprint(token);
  if (hash === null) return null;
  const found = await row<{ wa: string }>(
    main,
    sql`select a.wa from mk_sesi s join mk_akun a on a.id = s.mk_id
      where s.token_sha = ${hash} and s.habis > ${nowMs} and a.status = 'aktif'`,
  );
  if (found === null) return null;
  const number = stored(found.wa);
  const reporter = await row<{ id: string }>(
    db,
    sql`insert into reporter (id, number, number_key, created_at)
      values (${crypto.randomUUID()}, ${number}, ${await hmacKey(secret, "number", number)}, ${new Date(nowMs)})
      on conflict (number_key) do update set number = excluded.number
      returning id`,
  );
  return { kind: "session", reporterId: (reporter as { id: string }).id };
}

type ProfileRow = { id: string; akun_id: string; nama: string; jabatan: string; wa: string };

// The active profiles of the regency's BPBD, then of the province's (upstream pfPicAkunProv).
async function officersIn(db: Database, main: Database, villageCode: string): Promise<readonly Officer[]> {
  const province = villageCode.slice(0, 2);
  const accounts = await rows<AccountRow & { id: string }>(
    main,
    sql`select id, id akun_id, jenis, tingkat, wilayah, prov, kab from instansi_akun
      where status = 'aktif' and dummy = 0
        and ((tingkat = 'kab' and prov = ${province} and jenis in ('pemkab', 'pemkot'))
          or (jenis = 'pemprov' and kunci_wilayah = ${province}))`,
  );
  const areas = new Map<string, { level: Officer["level"]; agency: string }>();
  for (const account of accounts) {
    const area = await areaOf(db, { ...account, prov: account.prov ?? province });
    if (area?.scope.level === "province") areas.set(account.id, { level: "province", agency: area.agency });
    else if (area?.scope.level === "regency" && area.scope.code === villageCode.slice(0, 5))
      areas.set(account.id, { level: "regency", agency: area.agency });
  }
  if (areas.size === 0) return [];
  const profiles = await rows<ProfileRow>(
    main,
    sql`select id, akun_id, nama, jabatan, wa from instansi_profil
      where akun_id in (select value from json_each(${JSON.stringify([...areas.keys()])})) and status = 'aktif'
      order by terakhir_masuk desc, nama`,
  );
  return profiles
    .map((profile) => {
      const area = areas.get(profile.akun_id) as { level: Officer["level"]; agency: string };
      return {
        id: profile.id,
        name: profile.nama,
        position: profile.jabatan,
        agency: area.agency,
        level: area.level,
        number: stored(profile.wa),
      };
    })
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "regency" ? -1 : 1));
}

export function mainSiteIdentity(db: Database, main: Database, clock: Clock, hmacSecret: string): IdentityPort {
  return {
    async resolve(headers) {
      const cookies = parse(headers.get("cookie") ?? "");
      const nowMs = clock.now();
      return (
        (await staffOf(main, cookies[STAFF_COOKIE], nowMs)) ??
        (await officerOf(db, main, cookies[PROFILE_COOKIE], nowMs)) ??
        (await reporterOf(db, main, hmacSecret, cookies[MAIN_COOKIE], nowMs)) ??
        deviceOf(db, clock, cookies[DEVICE_COOKIE])
      );
    },
    officers: (villageCode) => officersIn(db, main, villageCode),
  };
}
