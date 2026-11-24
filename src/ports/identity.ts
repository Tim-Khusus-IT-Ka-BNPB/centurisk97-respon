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
};

export type IdentityPort = {
  resolve(headers: Headers): Promise<Principal>;
};
