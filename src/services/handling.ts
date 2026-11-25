import { addActions, addFieldCheck, addProof, proofKey } from "../adapters/d1/handling";
import type { DeskReport } from "../contract/desk";
import { type CheckResult, checkFieldCheck, revised } from "../domain/fieldCheck";
import type { FieldStates } from "../domain/fieldState";
import { checkActions, checkProof } from "../domain/handling";
import { readExif, stripJpeg } from "../domain/jpeg";
import type { DeviceFix } from "../domain/photoChecks";
import { NEXT_STATUSES } from "../domain/ticketMoves";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, changeTicket, type DeskChange, type DeskPhotoFile, offeredActions } from "./desk";

const DONE: readonly DeskReport["status"][] = ["closed", "invalid"];

// What an officer found on site. Not valid sets the report aside with the note; a correction makes
// a new version of its values.
export async function checkInField(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  check: {
    readonly result: CheckResult;
    readonly note: string;
    readonly boxes: Readonly<Record<string, string>>;
    readonly revision: number;
  },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "checkField", ticketNumber, async (found, at) => {
    if (found.revision !== check.revision) return { kind: "changed", status: found.status };
    if (DONE.includes(found.status)) return { kind: "transitionRefused" };
    const to = check.result === "notValid" ? "invalid" : found.status;
    if (to !== found.status && !NEXT_STATUSES[found.status].includes(to)) return { kind: "transitionRefused" };
    const states = found.states as FieldStates;
    const checked = checkFieldCheck(states, check.result, check.note, check.boxes);
    if (checked.kind === "invalid") return checked;
    const done = await addFieldCheck(
      bindings.db,
      staff,
      ticketNumber,
      {
        reportId: found.reportId,
        result: check.result,
        note: checked.note,
        changes: checked.changes,
        next: checked.changes.length === 0 ? null : revised(states, checked.changes, checked.note),
        from: found.status,
        to,
        revision: check.revision,
      },
      at,
    );
    return done ? null : { kind: "changed", status: found.status };
  });
}

// More done about a report that is being handled.
export async function addHandling(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  typed: { readonly actions: readonly string[]; readonly otherAction: string },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "addHandling", ticketNumber, async (found, at) => {
    const offered = await offeredActions(bindings, found.hazardType);
    const checked = checkActions(offered, typed.actions, typed.otherAction);
    if (checked.kind === "invalid") return checked;
    return (await addActions(bindings.db, staff, ticketNumber, checked.actions, at))
      ? null
      : { kind: "transitionRefused" };
  });
}

const photoError = (rule: string): DeskChange => ({
  kind: "invalid",
  error: { fieldId: "proof", rule: `photo.${rule}`, params: {} },
});

// A photo of the work, while the report is being handled. Its metadata is stripped and the file
// stored before its row; a row that does not land takes its file with it.
export async function addHandlingProof(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  upload: { readonly bytes: Uint8Array; readonly device: DeviceFix | null },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "addHandling", ticketNumber, async (found, at) => {
    if (found.status !== "in_handling") return { kind: "transitionRefused" };
    const checked = checkProof({
      bytes: upload.bytes,
      exif: readExif(upload.bytes),
      nowMs: at.getTime(),
      device: upload.device,
      count: found.handling.proofs.length,
    });
    if (checked.kind === "refused") return photoError(checked.rule);
    const clean = stripJpeg(upload.bytes);
    if (clean === null) return photoError("broken");
    const id = crypto.randomUUID();
    const storeKey = `handling/${ticketNumber}/${id}.jpg`;
    await bindings.photos.put(storeKey, clean);
    const kept = await addProof(
      bindings.db,
      staff,
      ticketNumber,
      { id, storeKey, bytes: clean.length, fix: checked.fix },
      at,
    );
    if (kept) return null;
    await bindings.photos.delete([storeKey]);
    return photoError("proofTooMany");
  });
}

export async function deskProofFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  proofId: string,
): Promise<DeskPhotoFile> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  const key = await proofKey(bindings.db, staff.scope, proofId);
  const bytes = key === null ? null : await bindings.photos.get(key);
  return bytes === null ? { kind: "notFound" } : { kind: "file", bytes };
}
