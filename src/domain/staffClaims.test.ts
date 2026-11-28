import { describe, expect, test } from "vitest";
import { staffAccountOf } from "./staffClaims";

const organization = (kind: string, level: string, region: string | null, name = "Organisasi Uji") => ({
  id: "0b6f1c6e-0000-4000-8000-000000000001",
  kind,
  name,
  level,
  region,
});

const claimsWith = (...memberships: unknown[]) => ({
  sub: "5f0c2b1e-7d4a-4c1e-9a53-0d6f1e2a3b4c",
  name: "Petugas Uji",
  email: "petugas@bnpb.go.id",
  email_verified: true,
  phone_number: "+6281200000000",
  memberships,
  claims_version: 1,
});

describe("the desk account claims make", () => {
  test("BNPB's pusdalops works the whole country as a desk officer", () => {
    const pusdalops = {
      organization: organization("bnpb", "national", null, "BNPB"),
      role: "pusdalops",
      position: "Analis",
    };
    expect(staffAccountOf(claimsWith(pusdalops))).toEqual({
      id: "5f0c2b1e-7d4a-4c1e-9a53-0d6f1e2a3b4c",
      name: "Petugas Uji",
      position: "Analis",
      agency: "BNPB",
      phone: "+6281200000000",
      role: "deskOfficer",
      scope: { level: "national" },
    });
  });

  test("koordalops opens the desk too, and a missing position is blank", () => {
    const koordalops = { organization: organization("bnpb", "national", null), role: "koordalops", position: null };
    expect(staffAccountOf(claimsWith(koordalops))).toMatchObject({ role: "deskOfficer", position: "" });
  });

  test("a BPBD officer works their regency or their province", () => {
    const regency = {
      organization: organization("bpbd", "regency", "11.08", "BPBD Kabupaten Uji"),
      role: "officer",
      position: null,
    };
    expect(staffAccountOf(claimsWith(regency))).toMatchObject({
      role: "regionalOfficer",
      agency: "BPBD Kabupaten Uji",
      scope: { level: "regency", code: "11.08" },
    });
    const province = { organization: organization("bpbd", "province", "11"), role: "officer", position: "Kepala" };
    expect(staffAccountOf(claimsWith(province))).toMatchObject({ scope: { level: "province", code: "11" } });
  });

  test("a BNPB desk role wins over a BPBD one", () => {
    const regency = { organization: organization("bpbd", "regency", "11.08"), role: "officer", position: null };
    const pusdalops = { organization: organization("bnpb", "national", null), role: "pusdalops", position: null };
    expect(staffAccountOf(claimsWith(regency, pusdalops))).toMatchObject({ role: "deskOfficer" });
  });

  test("memberships that open no desk are passed over: admins, unknown kinds and roles, bad regions", () => {
    const skipped = [
      { organization: organization("bnpb", "national", null), role: "admin", position: null },
      { organization: organization("basarnas", "regency", "11.08"), role: "officer", position: null },
      { organization: organization("bpbd", "regency", "11.08"), role: "viewer", position: null },
      { organization: organization("bpbd", "national", null), role: "officer", position: null },
      { organization: organization("bpbd", "regency", null), role: "officer", position: null },
      { organization: organization("bpbd", "regency", "11"), role: "officer", position: null },
      { organization: organization("bpbd", "province", "11.08"), role: "officer", position: null },
    ];
    expect(staffAccountOf(claimsWith(...skipped))).toBeNull();
    const province = { organization: organization("bpbd", "province", "12"), role: "officer", position: null };
    expect(staffAccountOf(claimsWith(...skipped, province))).toMatchObject({
      scope: { level: "province", code: "12" },
    });
  });

  test("no memberships, no phone: no desk, and no phone kept", () => {
    const { phone_number: _phone, memberships: _memberships, ...bare } = claimsWith();
    expect(staffAccountOf(bare)).toBeNull();
    const pusdalops = { organization: organization("bnpb", "national", null), role: "pusdalops", position: null };
    expect(staffAccountOf({ ...bare, memberships: [pusdalops] })).toMatchObject({ phone: null });
  });

  test("claims of another version, or not claims at all, make no account", () => {
    const pusdalops = { organization: organization("bnpb", "national", null), role: "pusdalops", position: null };
    expect(staffAccountOf({ ...claimsWith(pusdalops), claims_version: 2 })).toBeNull();
    expect(staffAccountOf({ ...claimsWith(pusdalops), sub: "" })).toBeNull();
    expect(staffAccountOf(null)).toBeNull();
  });
});
