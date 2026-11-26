import type { OneTapSent } from "../../src/contract/emergency";
import type { Answer } from "./clientApi";

// Reports made on this phone with no signal (LR-03 to LR-05): kept here, on this phone alone, until
// they reach the desk. Each has its id from the moment it was made, so a send repeated after a lost
// answer gives the same ticket.
export type OfflineReport = {
  readonly clientId: string;
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
  readonly takenAtMs: number;
  readonly hazardType?: string;
  readonly victims?: "yes" | "no" | "unknown";
};

const KEY = "lapor-offline-reports";

export function keptReports(): OfflineReport[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as OfflineReport[]) : [];
  } catch {
    return [];
  }
}

function store(reports: readonly OfflineReport[]): void {
  try {
    if (reports.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(reports));
  } catch {
    // Storage refused (a private window): the report stays on screen only.
  }
}

export const keepReport = (report: OfflineReport): void =>
  store([...keptReports().filter((one) => one.clientId !== report.clientId), report]);

export const dropReport = (clientId: string): void => store(keptReports().filter((one) => one.clientId !== clientId));

type Post = (body: OfflineReport) => Promise<Answer<OneTapSent>>;

// Sends what is kept, oldest first. A refused report is dropped; one the network did not carry, or
// one sent too soon after the last, stays for the next time.
export async function sendKept(post: Post): Promise<{
  readonly sent: readonly OneTapSent[];
  readonly refused: number;
  readonly left: number;
}> {
  const sent: OneTapSent[] = [];
  let refused = 0;
  for (const report of keptReports()) {
    const answer = await post(report);
    // Not carried, or too soon after the last: it waits for the next time.
    if (answer.kind === "unreachable" || (answer.kind === "refused" && answer.status === 429)) break;
    dropReport(report.clientId);
    if (answer.kind === "ok") sent.push(answer.body);
    else refused += 1;
  }
  return { sent, refused, left: keptReports().length };
}
