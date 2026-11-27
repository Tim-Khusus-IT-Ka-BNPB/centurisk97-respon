import type { OneTapSent } from "../../src/contract/emergency";
import type { Answer } from "./clientApi";
import type { Position } from "./device";

// Reports made on this phone with no signal (LR-03 to LR-05): kept here, on this phone alone, until
// they reach the desk. Each has its id from the moment it was made, so a send repeated after a lost
// answer gives the same ticket.
// A camera photo kept with the report (LR-06): the prepared JPEG as text, and the phone's fix read
// when it was taken.
export type KeptPhoto = { readonly jpeg: string; readonly fix: Position | null };

export type OfflineReport = {
  readonly clientId: string;
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
  readonly takenAtMs: number;
  readonly hazardType?: string;
  readonly victims?: "yes" | "no" | "unknown";
  readonly photos?: readonly KeptPhoto[];
};

const KEY = "respon-offline-reports";

export function keptReports(): OfflineReport[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as OfflineReport[]) : [];
  } catch {
    return [];
  }
}

// Whether the phone kept them: storage refused (a private window) or full keeps nothing new.
function store(reports: readonly OfflineReport[]): boolean {
  try {
    if (reports.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(reports));
    return true;
  } catch {
    return false;
  }
}

export const keepReport = (report: OfflineReport): boolean =>
  store([...keptReports().filter((one) => one.clientId !== report.clientId), report]);

// Photos are kept as text, as the phone's storage holds only text.
export function photoText(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

// The form a kept photo goes in: its place among the report's photos, the phone's offset from UTC
// for a camera time written with none, and the fix read when it was taken.
export function keptPhotoForm(index: number, photo: KeptPhoto, offsetMinutes: number): FormData {
  const form = new FormData();
  const bytes = Uint8Array.from(atob(photo.jpeg), (character) => character.charCodeAt(0));
  form.set("photo", new File([bytes], "foto.jpg", { type: "image/jpeg" }));
  form.set("index", String(index));
  form.set("offset", String(offsetMinutes));
  if (photo.fix !== null) {
    const { lat, lon, accuracy, readAt } = photo.fix;
    for (const [name, value] of Object.entries({ lat, lon, accuracy, readAt })) form.set(name, String(value));
  }
  return form;
}

export function dropReport(clientId: string): void {
  store(keptReports().filter((one) => one.clientId !== clientId));
}

type Post = (body: OfflineReport) => Promise<Answer<OneTapSent>>;
type PostPhoto = (clientId: string, index: number, photo: KeptPhoto) => Promise<Answer<unknown>>;

// Not carried, or too soon after the last: it waits for the next time.
const waits = (answer: Answer<unknown>) =>
  answer.kind === "unreachable" || (answer.kind === "refused" && answer.status === 429);

// A sent report's photos, one at a time: how many were refused, or null when one has to wait.
async function sendPhotos(report: OfflineReport, postPhoto: PostPhoto): Promise<number | null> {
  let refused = 0;
  for (const [index, photo] of (report.photos ?? []).entries()) {
    const answer = await postPhoto(report.clientId, index, photo);
    if (waits(answer)) return null;
    if (answer.kind === "refused") refused += 1;
  }
  return refused;
}

// Sends what is kept, oldest first, each report with its photos. A refused report is dropped; one
// the network did not carry, or one sent too soon after the last, stays for the next time, and so
// does one whose photos did not all go: sent again, it is the same ticket and each photo is kept once.
export async function sendKept(
  post: Post,
  postPhoto: PostPhoto,
): Promise<{
  readonly sent: readonly OneTapSent[];
  readonly refused: number;
  readonly photosRefused: number;
  readonly left: number;
}> {
  const sent: OneTapSent[] = [];
  let refused = 0;
  let photosRefused = 0;
  for (const report of keptReports()) {
    const answer = await post(report);
    if (waits(answer)) break;
    if (answer.kind === "ok") {
      const photos = await sendPhotos(report, postPhoto);
      if (photos === null) break;
      photosRefused += photos;
      sent.push(answer.body);
    } else refused += 1;
    dropReport(report.clientId);
  }
  return { sent, refused, photosRefused, left: keptReports().length };
}
