import type { StaffRole, StaffScope } from "../domain/deskRights";

// Who is calling. Resolved by the identity adapter before a route's policy runs.
export type Principal =
  | { readonly kind: "anonymous" }
  | { readonly kind: "device"; readonly deviceId: string }
  | { readonly kind: "session"; readonly reporterId: string }
  | StaffPrincipal;

// A staff account: who it is, the label the desk and the history show, and where it may work.
export type StaffPrincipal = {
  readonly kind: "staff";
  readonly staffId: string;
  readonly role: StaffRole;
  readonly label: string;
  readonly scope: StaffScope;
  // The officer's own profile behind a shared BPBD account; null for an account with none.
  readonly profile: OfficerProfile | null;
};

export type OfficerProfile = {
  readonly id: string;
  readonly name: string;
  readonly position: string;
  // The BPBD as it is named: "BPBD Kabupaten Contoh".
  readonly agency: string;
};

// A BPBD officer a BNPB officer may call about a report in their region, with their phone number.
export type Officer = OfficerProfile & {
  readonly level: "regency" | "province";
  readonly number: string;
};

export type IdentityPort = {
  resolve(headers: Headers): Promise<Principal>;
  // The officers of the BPBD of this village's regency, then of its province.
  officers(villageCode: string): Promise<readonly Officer[]>;
};
