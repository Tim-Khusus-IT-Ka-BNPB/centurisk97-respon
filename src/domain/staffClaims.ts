import { z } from "zod";
import type { StaffRole, StaffScope } from "./deskRights";

// What auth says about a person, version 1 (centurisk97-auth README). Kinds and roles not known
// here are ignored, so auth may add them without breaking the desk.
const membership = z.object({
  organization: z.object({
    kind: z.string(),
    name: z.string(),
    level: z.enum(["national", "province", "regency"]),
    region: z.string().nullable(),
  }),
  role: z.string(),
  position: z.string().nullable(),
});

const claims = z.object({
  sub: z.string().min(1).max(64),
  name: z.string().min(1),
  phone_number: z.string().optional(),
  memberships: z.array(membership).default([]),
  claims_version: z.literal(1),
});

export type StaffAccount = {
  readonly id: string;
  readonly name: string;
  readonly position: string;
  readonly agency: string;
  readonly phone: string | null;
  readonly role: StaffRole;
  readonly scope: StaffScope;
};

const DESK_ROLES = new Set(["pusdalops", "koordalops"]);
const REGION = { province: /^\d{2}$/, regency: /^\d{2}\.\d{2}$/ } as const;

// The desk account a person's claims make, or null when no membership opens the desk. BNPB's
// pusdalops and koordalops work the whole country; a BPBD officer works their province or regency.
export function staffAccountOf(raw: unknown): StaffAccount | null {
  const parsed = claims.safeParse(raw);
  if (!parsed.success) return null;
  const { sub, name, phone_number, memberships } = parsed.data;
  const base = { id: sub, name, phone: phone_number ?? null };
  const bnpb = memberships.find((one) => one.organization.kind === "bnpb" && DESK_ROLES.has(one.role));
  if (bnpb)
    return {
      ...base,
      position: bnpb.position ?? "",
      agency: bnpb.organization.name,
      role: "deskOfficer",
      scope: { level: "national" },
    };
  for (const one of memberships) {
    const { kind, level, region, name: agency } = one.organization;
    if (
      kind !== "bpbd" ||
      one.role !== "officer" ||
      level === "national" ||
      // Stryker disable next-line ConditionalExpression: a null region never matches a region pattern either
      region === null ||
      !REGION[level].test(region)
    )
      continue;
    return { ...base, position: one.position ?? "", agency, role: "regionalOfficer", scope: { level, code: region } };
  }
  return null;
}
