// What each staff role may do on the desk. Checked in the service for every route and page, never
// by hiding a control (HF7).

export type StaffRole = "deskOfficer" | "regionalOfficer";

export type StaffScope =
  | { readonly level: "national" }
  | { readonly level: "province" | "regency"; readonly code: string };

export type DeskCapability = "readQueue" | "readReport" | "markSeen" | "moveTicket" | "reply";

// The roles holding each capability. Regional officers wait on region scope (M02 TASK-004).
const HOLDERS: Readonly<Record<DeskCapability, readonly StaffRole[]>> = {
  readQueue: ["deskOfficer"],
  readReport: ["deskOfficer"],
  markSeen: ["deskOfficer"],
  moveTicket: ["deskOfficer"],
  reply: ["deskOfficer"],
};

export const mayUse = (role: StaffRole, capability: DeskCapability): boolean => HOLDERS[capability].includes(role);
