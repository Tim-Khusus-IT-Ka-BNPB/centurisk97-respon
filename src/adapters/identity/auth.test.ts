import { describe, expect, test } from "vitest";
import type { StaffAccount } from "../../domain/staffClaims";
import { manualClock, query, testDatabase } from "../../testing/api";
import { authIdentity, STAFF_SESSION_MS, signInStaff, signOutStaff, staffCookieName } from "./auth";

const clock = manualClock("2026-11-28T03:00:00.000Z");
const db = testDatabase();
const identity = authIdentity(db, clock, false);
const asCookie = (token: string) => new Headers({ cookie: `${staffCookieName(false)}=${token}` });

let counter = 0;
const account = (overrides: Partial<StaffAccount> = {}): StaffAccount => {
  counter += 1;
  return {
    id: `auth-subject-${counter}`,
    name: `Petugas Auth ${counter}`,
    position: "Analis",
    agency: "BNPB",
    phone: null,
    role: "deskOfficer",
    scope: { level: "national" },
    ...overrides,
  };
};

describe("staff signed in through auth", () => {
  test("a session names the person as their claims did, with their own profile", async () => {
    const pusdalops = account();
    const token = await signInStaff(db, clock, pusdalops);
    expect(await identity.resolve(asCookie(token))).toEqual({
      kind: "staff",
      staffId: pusdalops.id,
      role: "deskOfficer",
      label: pusdalops.name,
      scope: { level: "national" },
      profile: { id: pusdalops.id, name: pusdalops.name, position: "Analis", agency: "BNPB" },
    });
    const [stored] = await query<{
      token_hash: string;
    }>`select token_hash from staff_session where staff_id = ${pusdalops.id}`;
    expect(stored?.token_hash).not.toBe(token);
  });

  test("signing in again keeps the claims as they are now", async () => {
    const officer = account({ role: "regionalOfficer", scope: { level: "regency", code: "11.08" } });
    await signInStaff(db, clock, officer);
    const moved = { ...officer, name: "Nama Baru", scope: { level: "province", code: "11" } } as const;
    const token = await signInStaff(db, clock, moved);
    expect(await identity.resolve(asCookie(token))).toMatchObject({
      label: "Nama Baru",
      role: "regionalOfficer",
      scope: { level: "province", code: "11" },
    });
  });

  test("a session ends when it expires or on signing out, and ended ones are cleared at the next sign-in", async () => {
    const pusdalops = account();
    const first = await signInStaff(db, clock, pusdalops);
    clock.advance(STAFF_SESSION_MS);
    expect(await identity.resolve(asCookie(first))).toEqual({ kind: "anonymous" });
    const second = await signInStaff(db, clock, pusdalops);
    expect(await query`select 1 from staff_session where staff_id = ${pusdalops.id}`).toHaveLength(1);
    await signOutStaff(db, second);
    expect(await identity.resolve(asCookie(second))).toEqual({ kind: "anonymous" });
  });

  test("an unknown token, or none, leaves the browser to its device key", async () => {
    expect(await identity.resolve(asCookie("not-a-token-we-issued"))).toEqual({ kind: "anonymous" });
    expect(await identity.resolve(new Headers())).toEqual({ kind: "anonymous" });
  });

  test("over HTTPS the cookie carries the __Host- prefix", () => {
    expect(staffCookieName(true)).toBe("__Host-respon_staff");
    expect(staffCookieName(false)).toBe("respon_staff");
  });
});

describe("officers to call about a report", () => {
  test("BPBD officers with a phone, of the village's regency first, then of its province", async () => {
    const region = "92.04";
    const regency = account({
      name: "B Kabupaten",
      phone: "+6281200000001",
      role: "regionalOfficer",
      scope: { level: "regency", code: region },
    });
    const province = account({
      name: "A Provinsi",
      phone: "+6281200000002",
      role: "regionalOfficer",
      scope: { level: "province", code: "92" },
    });
    const noPhone = account({ role: "regionalOfficer", scope: { level: "regency", code: region } });
    const elsewhere = account({
      phone: "+6281200000003",
      role: "regionalOfficer",
      scope: { level: "regency", code: "92.05" },
    });
    const desk = account({ phone: "+6281200000004" });
    for (const one of [regency, province, noPhone, elsewhere, desk]) await signInStaff(db, clock, one);
    expect(await identity.officers(`${region}.01.2001`)).toEqual([
      {
        id: regency.id,
        name: "B Kabupaten",
        position: "Analis",
        agency: "BNPB",
        number: "+6281200000001",
        level: "regency",
      },
      {
        id: province.id,
        name: "A Provinsi",
        position: "Analis",
        agency: "BNPB",
        number: "+6281200000002",
        level: "province",
      },
    ]);
  });
});
