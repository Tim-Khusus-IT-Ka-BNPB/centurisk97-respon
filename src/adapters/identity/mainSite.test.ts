import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../../api/app";
import type { ApiBindings } from "../../api/context";
import type { Database } from "../../platform/database";
import { browser, query, testBindings, testDatabase } from "../../testing/api";
import { mainRun, mainSiteDatabase, mainToken } from "../../testing/mainSite";
import { MAIN_COOKIE, mainSiteIdentity, PROFILE_COOKIE, regencyKey, STAFF_COOKIE } from "./mainSite";

const NOW = Date.parse("2026-11-26T03:00:00.000Z");
const LATER = NOW + 3_600_000;
const clock = { now: () => NOW };
const { bindings } = testBindings({}, { clock });
let main: Database;
let identity: ReturnType<typeof mainSiteIdentity>;

const cookie = (name: string, token: string) => new Headers({ cookie: `${name}=${token}` });

// A staff session as upstream issues it; the account's fields may be changed.
async function staffSession(fields: { peran?: string; wilayah?: string; wajib_ganti?: number; until?: number } = {}) {
  const { token, sha } = await mainToken();
  const id = sha.slice(0, 16);
  await mainRun(
    main,
    "insert into staf (id, nama, peran, wilayah, wajib_ganti) values (?1, 'Uji Staf', ?2, ?3, ?4)",
    id,
    fields.peran ?? '["pusdalops"]',
    fields.wilayah ?? "[]",
    fields.wajib_ganti ?? 0,
  );
  await mainRun(main, "insert into staf_sesi values (?1, ?2, ?3)", sha, id, fields.until ?? LATER);
  return token;
}

type Account = {
  jenis: string;
  tingkat: string;
  wilayah: string;
  kunci: string;
  cakupan: string;
  prov: string | null;
  kab: string | null;
  dummy?: number;
};
async function account(fields: Account): Promise<string> {
  const id = (await mainToken()).sha.slice(0, 16);
  await mainRun(
    main,
    "insert into instansi_akun values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'aktif', ?9)",
    id,
    fields.jenis,
    fields.tingkat,
    fields.wilayah,
    fields.kunci,
    fields.cakupan,
    fields.prov,
    fields.kab,
    fields.dummy ?? 0,
  );
  return id;
}
async function profile(
  accountId: string,
  name: string,
  wa: string,
  fields: { status?: string; pin?: number; lastIn?: number } = {},
) {
  const id = (await mainToken()).sha.slice(0, 16);
  await mainRun(
    main,
    "insert into instansi_profil values (?1, ?2, ?3, 'Pusdalops', ?4, ?5, ?6, ?7)",
    id,
    accountId,
    name,
    wa,
    fields.pin ?? 0,
    fields.status ?? "aktif",
    fields.lastIn ?? null,
  );
  return id;
}
async function profileSession(accountId: string, profileId: string, until = LATER) {
  const { token, sha } = await mainToken();
  await mainRun(main, "insert into instansi_sesi_profil values (?1, ?2, ?3, ?4)", sha, profileId, accountId, until);
  return token;
}

const ACEH_UTARA = {
  jenis: "pemkab",
  tingkat: "kab",
  wilayah: "Pemerintah Kabupaten Aceh Utara",
  kunci: "aceh utara",
  cakupan: '["11"]',
  prov: "11",
};
let regency = "";
let province = "";
let village = "";

beforeAll(async () => {
  main = await mainSiteDatabase();
  identity = mainSiteIdentity(testDatabase(), main, clock, bindings.settings.keyHmacSecret);
  regency = await account({ ...ACEH_UTARA, kab: "11.08" });
  province = await account({
    jenis: "pemprov",
    tingkat: "prov",
    wilayah: "Provinsi Aceh",
    kunci: "11",
    cakupan: '["11"]',
    prov: null,
    kab: null,
  });
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

describe("BNPB staff by their staff session", () => {
  test("Pusdalops and its coordinators work the desk, nationally or in their one province", async () => {
    expect(await identity.resolve(cookie(STAFF_COOKIE, await staffSession()))).toMatchObject({
      kind: "staff",
      role: "deskOfficer",
      label: "Pusdalops BNPB, Uji Staf",
      scope: { level: "national" },
      profile: null,
    });
    const coordinator = await staffSession({ peran: '["koordalops","pimpinan"]', wilayah: '["32"]' });
    expect(await identity.resolve(cookie(STAFF_COOKIE, coordinator))).toMatchObject({
      label: "Koordinator Pusdalops BNPB, Uji Staf",
      scope: { level: "province", code: "32" },
    });
  });

  test("another role, many provinces, a password still to change, an ended or forged session: nobody", async () => {
    for (const token of [
      await staffSession({ peran: '["tmc"]' }),
      await staffSession({ wilayah: '["11","12"]' }),
      await staffSession({ wajib_ganti: 1 }),
      await staffSession({ until: NOW }),
      (await mainToken()).token,
      "not-a-token",
    ])
      expect(await identity.resolve(cookie(STAFF_COOKIE, token))).toEqual({ kind: "anonymous" });
  });
});

describe("a BPBD officer by the profile they picked", () => {
  test("a regency account by its code or its name, a province account by its scope, each with the officer", async () => {
    const andi = await profile(regency, "Uji Andi", "628001108001");
    expect(await identity.resolve(cookie(PROFILE_COOKIE, await profileSession(regency, andi)))).toEqual({
      kind: "staff",
      staffId: `akun:${regency}`,
      role: "regionalOfficer",
      label: "BPBD Kabupaten Aceh Utara, Uji Andi",
      scope: { level: "regency", code: "11.08" },
      profile: { id: andi, name: "Uji Andi", position: "Pusdalops", agency: "BPBD Kabupaten Aceh Utara" },
    });
    const named = await account({ ...ACEH_UTARA, kunci: "aceh utara 2", kab: "Kabupaten Aceh Utara" });
    const sari = await profile(named, "Uji Sari", "628001108003");
    expect(await identity.resolve(cookie(PROFILE_COOKIE, await profileSession(named, sari)))).toMatchObject({
      scope: { level: "regency", code: "11.08" },
    });
    const city = await account({
      ...ACEH_UTARA,
      jenis: "pemkot",
      kunci: "kota",
      prov: "12",
      cakupan: '["12"]',
      kab: "Kota Administrasi Pematangsiantar",
    });
    const budi = await profile(city, "Uji Budi", "628001272001");
    expect(await identity.resolve(cookie(PROFILE_COOKIE, await profileSession(city, budi)))).toMatchObject({
      label: "BPBD Kota Pematangsiantar, Uji Budi",
      scope: { level: "regency", code: "12.72" },
    });
    const dewi = await profile(province, "Uji Dewi", "628001100001");
    expect(await identity.resolve(cookie(PROFILE_COOKIE, await profileSession(province, dewi)))).toMatchObject({
      label: "BPBD Provinsi Aceh, Uji Dewi",
      scope: { level: "province", code: "11" },
    });
  });

  test("a PIN to change, another kind of agency, or a regency the place data has not: nobody", async () => {
    const pin = await profile(regency, "Uji Pin", "628001108009", { pin: 1 });
    const police = await account({ ...ACEH_UTARA, jenis: "polres", kunci: "polres", kab: "11.08" });
    const unknown = await account({ ...ACEH_UTARA, kunci: "nowhere", kab: "Kabupaten Tidak Ada" });
    const elsewhere = await account({ ...ACEH_UTARA, kunci: "elsewhere", kab: "12.01" });
    const missing = await account({ ...ACEH_UTARA, kunci: "missing", kab: "11.99" });
    const noProvince = await account({ ...ACEH_UTARA, kunci: "no province", prov: null, kab: "11.08" });
    const noRegency = await account({ ...ACEH_UTARA, kunci: "no regency", kab: null });
    const sessions = [
      await profileSession(regency, pin),
      ...(await Promise.all(
        [police, unknown, elsewhere, missing, noProvince, noRegency].map(async (id) =>
          profileSession(id, await profile(id, "Uji X", "628001100009")),
        ),
      )),
      await profileSession(regency, await profile(regency, "Uji Lama", "628001108008"), NOW),
    ];
    for (const token of sessions)
      expect(await identity.resolve(cookie(PROFILE_COOKIE, token))).toEqual({ kind: "anonymous" });
  });
});

describe("a reporter by the WhatsApp code session", () => {
  test("is a reporter of ours, made once; never staff; an ended one is nobody", async () => {
    const { token, sha } = await mainToken();
    const person = sha.slice(0, 16);
    await mainRun(main, "insert into mk_akun (id, wa) values (?1, '628001234567')", person);
    await mainRun(main, "insert into mk_sesi values (?1, ?2, ?3)", sha, person, LATER);
    const first = await identity.resolve(cookie(MAIN_COOKIE, token));
    expect(first).toMatchObject({ kind: "session" });
    expect(await identity.resolve(cookie(MAIN_COOKIE, token))).toEqual(first);
    expect(await query`select number from reporter where id = ${(first as { reporterId: string }).reporterId}`).toEqual(
      [{ number: "+628001234567" }],
    );
    const ended = await mainToken();
    await mainRun(main, "insert into mk_sesi values (?1, ?2, ?3)", ended.sha, person, NOW);
    expect(await identity.resolve(cookie(MAIN_COOKIE, ended.token))).toEqual({ kind: "anonymous" });
    expect(await identity.resolve(new Headers())).toEqual({ kind: "anonymous" });
  });
});

describe("the officers a BNPB officer may call", () => {
  test("the regency's active officers first, most recently in first, then the province's; no test accounts", async () => {
    const officers = mainSiteIdentity(testDatabase(), await mainSiteDatabase(), clock, bindings.settings.keyHmacSecret);
    const before = (await officers.officers(village)).length;
    await profile(regency, "Uji Baru", "628001108010", { lastIn: NOW });
    await profile(regency, "Uji Cabut", "628001108011", { status: "dicabut" });
    const test1 = await account({ ...ACEH_UTARA, kunci: "dummy", kab: "11.08", dummy: 1 });
    await profile(test1, "Uji Dummy", "628001108012");
    const found = await officers.officers(village);
    expect(found).toHaveLength(before + 1);
    expect(found[0]).toEqual({
      id: expect.any(String),
      name: "Uji Baru",
      position: "Pusdalops",
      agency: "BPBD Kabupaten Aceh Utara",
      level: "regency",
      number: "+628001108010",
    });
    expect(found.map((one) => one.level).indexOf("province")).toBeGreaterThan(
      found.map((one) => one.level).lastIndexOf("regency"),
    );
    expect(found.some((one) => one.name === "Uji Cabut" || one.name === "Uji Dummy")).toBe(false);
    expect(await officers.officers("94.71.01.1001")).toEqual([]);
  });

  test("on the desk, a staff session opens a report's officers through the adapter", async () => {
    const fetchApi = (request: Request) =>
      api.app.fetch(request, { ...bindings, db: testDatabase(), identity } satisfies ApiBindings);
    const phone = browser(fetchApi);
    phone.cookies.set(STAFF_COOKIE, await staffSession());
    const queue = await phone.call("GET", "/desk/reports");
    expect(queue.status).toBe(200);
    expect(queue.json).toMatchObject({ account: { label: "Pusdalops BNPB, Uji Staf" } });
  });
});

test("regency names compare as upstream does", () => {
  expect(regencyKey("Kabupaten  Aceh Utara")).toBe("aceh utara");
  expect(regencyKey("Kab. Bogor")).toBe("bogor");
  expect(regencyKey("Kota Administrasi Jakarta Timur")).toBe("kota jakarta timur");
  expect(regencyKey("Kota Bogor")).not.toBe(regencyKey("Bogor"));
});
