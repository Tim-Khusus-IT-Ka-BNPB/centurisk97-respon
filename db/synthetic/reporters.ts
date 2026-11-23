// The one source of synthetic reporters for seeds, tests and walks. 0800 numbers are a
// toll-free service prefix and cannot be a person's phone. Nothing here is a real person.
export const SYNTHETIC_REPORTERS = [
  { label: "A", typed: "0800 0000 0001", stored: "+6280000000001", name: "Uji Satu" },
  { label: "B", typed: "0800 0000 0002", stored: "+6280000000002", name: "Uji Dua" },
  { label: "C", typed: "0800 0000 0003", stored: "+6280000000003", name: "Uji Tiga" },
  { label: "D", typed: "0800 0000 0004", stored: "+6280000000004", name: "Uji Empat" },
  { label: "E", typed: "0800 0000 0005", stored: "+6280000000005", name: "Uji Lima" },
  // The sixth number on one device, for the device limit of 5.
  { label: "F", typed: "0800 0000 0006", stored: "+6280000000006", name: "Uji Enam" },
] as const;

export type SyntheticLabel = (typeof SYNTHETIC_REPORTERS)[number]["label"];

// Seeded identity sessions (local, test and staging only; refused in production). The cookie
// "seeded_session" carries the token; only its SHA-256 is stored.
export const SEEDED_SESSIONS = [
  { token: "seeded-session-reporter-a-local-only", kind: "reporter", reporter: "A", staffRole: null },
  { token: "seeded-session-reporter-b-local-only", kind: "reporter", reporter: "B", staffRole: null },
  { token: "seeded-session-desk-officer-local-only", kind: "staff", reporter: null, staffRole: "deskOfficer" },
] as const satisfies readonly {
  token: string;
  kind: "reporter" | "staff";
  reporter: SyntheticLabel | null;
  staffRole: "deskOfficer" | null;
}[];
