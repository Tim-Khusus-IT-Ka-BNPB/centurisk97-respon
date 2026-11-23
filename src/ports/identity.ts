// Who is calling. Resolved by the identity adapter before a route's policy runs.
export type Principal =
  | { readonly kind: "anonymous" }
  | { readonly kind: "device"; readonly deviceId: string }
  | { readonly kind: "session"; readonly reporterId: string }
  | { readonly kind: "staff"; readonly role: "deskOfficer" | "regionalOfficer" };

export type IdentityPort = {
  resolve(headers: Headers): Promise<Principal>;
};
