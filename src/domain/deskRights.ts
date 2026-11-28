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
  | "readIdentity"
  | "revealIdentity"
  // Give a reporter who calls their report's tracking link again, each time logged.
  | "giveTrackingLink"
  | "downloadDocument"
  // The weekly counts for research (K62): BNPB only until campus accounts come from the main site.
  | "downloadAggregates"
  // Stop the warnings to phones within one run, and send them again (M07).
  | "pauseWarnings"
  // Take a report out of the event its reporter joined (D106): BNPB only.
  | "releaseEvent"
  // See the region's BPBD officers and open their numbers, each time logged (PF-09): BNPB only.
  | "callOfficers"
  // Pull an event off the public today page, or put it back (upstream D8): BNPB and the region's BPBD.
  | "pullToday"
  // Hide a comment on the Alun-alun or show it again, and decide the figures read from it (D139).
  | "moderateComments"
  // The BPBD's follow-up files (M09): opened and kept by the regency's BPBD, read by BNPB with
  // personal values masked until shown in full, and closed only when BNPB accepts (Q2, Q6, Q15).
  | "readCases"
  | "leadCase"
  | "revealCase"
  | "acceptCase";

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
  readIdentity: ["deskOfficer"],
  revealIdentity: ["regionalOfficer"],
  giveTrackingLink: ["deskOfficer", "regionalOfficer"],
  downloadDocument: ["deskOfficer", "regionalOfficer"],
  downloadAggregates: ["deskOfficer"],
  pauseWarnings: ["deskOfficer"],
  releaseEvent: ["deskOfficer"],
  callOfficers: ["deskOfficer"],
  pullToday: ["deskOfficer", "regionalOfficer"],
  moderateComments: ["deskOfficer", "regionalOfficer"],
  readCases: ["deskOfficer", "regionalOfficer"],
  leadCase: ["regionalOfficer"],
  revealCase: ["deskOfficer"],
  acceptCase: ["deskOfficer"],
};

export const mayUse = (role: StaffRole, capability: DeskCapability): boolean => HOLDERS[capability].includes(role);
