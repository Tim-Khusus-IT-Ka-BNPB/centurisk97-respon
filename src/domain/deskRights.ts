// What each staff role may do on the desk. Checked in the service for every route and page, never
// by hiding a control (HF7).

export type StaffRole = "deskOfficer" | "regionalOfficer";

export type StaffScope =
  | { readonly level: "national" }
  | { readonly level: "province" | "regency"; readonly code: string };

export type DeskCapability =
  | "readQueue"
  | "readReport"
  | "markSeen"
  | "moveTicket"
  | "forwardTicket"
  | "reopenTicket"
  | "reply"
  | "checkField"
  | "addHandling"
  | "takeReport"
  | "readResponse"
  | "managePilot"
  | "readIdentity"
  | "revealIdentity"
  | "downloadDocument"
  // The weekly counts for research (K62): BNPB only until campus accounts come from the main site.
  | "downloadAggregates"
  // Stop the warnings to phones within one run, and send them again (M07).
  | "pauseWarnings"
  // Take a report out of the event its reporter joined (D106): BNPB only.
  | "releaseEvent";

// The roles holding each capability. A regional officer works only its own region (StaffScope),
// asks for a reporter's identity each time, and neither forwards nor reopens.
const HOLDERS: Readonly<Record<DeskCapability, readonly StaffRole[]>> = {
  readQueue: ["deskOfficer", "regionalOfficer"],
  readReport: ["deskOfficer", "regionalOfficer"],
  markSeen: ["deskOfficer", "regionalOfficer"],
  moveTicket: ["deskOfficer", "regionalOfficer"],
  forwardTicket: ["deskOfficer"],
  reopenTicket: ["deskOfficer"],
  reply: ["deskOfficer", "regionalOfficer"],
  checkField: ["deskOfficer", "regionalOfficer"],
  addHandling: ["deskOfficer", "regionalOfficer"],
  takeReport: ["regionalOfficer"],
  readResponse: ["deskOfficer"],
  managePilot: ["deskOfficer"],
  readIdentity: ["deskOfficer"],
  revealIdentity: ["regionalOfficer"],
  downloadDocument: ["deskOfficer", "regionalOfficer"],
  downloadAggregates: ["deskOfficer"],
  pauseWarnings: ["deskOfficer"],
  releaseEvent: ["deskOfficer"],
};

export const mayUse = (role: StaffRole, capability: DeskCapability): boolean => HOLDERS[capability].includes(role);
