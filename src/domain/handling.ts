import type { FieldError } from "./identityForm";
import { type Exif, isJpeg } from "./jpeg";
import { LENGTHS } from "./limits";
import type { DeviceFix } from "./photoChecks";
import { PHOTO, usableFix } from "./photoChecks";
import type { ResponseAction } from "./responseActions";
import { textError } from "./ticketMoves";

// What an agency did about a report (K70, D111, D112): actions from its hazard's catalogue or in
// its own words, and photos of the work.

export type TakenAction = { readonly code: string | null; readonly label: string };

export type ActionsCheck =
  | { readonly kind: "ok"; readonly actions: readonly TakenAction[] }
  | { readonly kind: "invalid"; readonly error: FieldError };

const invalid = (fieldId: string, rule: string): ActionsCheck => ({
  kind: "invalid",
  error: { fieldId, rule, params: {} },
});

export function checkActions(
  offered: readonly ResponseAction[],
  codes: readonly string[],
  typedOther: string,
): ActionsCheck {
  const picked = offered.filter((action) => codes.includes(action.code));
  if (codes.some((code) => !offered.some((action) => action.code === code)))
    return invalid("actions", "actions.unknown");
  const other = typedOther.trim();
  if (other !== "") {
    const error = textError(
      "otherAction",
      "desk.actions.other",
      other,
      LENGTHS.otherAction.min,
      LENGTHS.otherAction.max,
    );
    if (error) return { kind: "invalid", error };
  } else if (picked.length === 0) return invalid("actions", "actions.none");
  return {
    kind: "ok",
    actions: [...picked, ...(other === "" ? [] : [{ code: null, label: other }])],
  };
}

export const PROOF = { max: 10, maxBytes: 3 * 1024 * 1024 } as const;

type ProofInput = {
  readonly bytes: Uint8Array;
  readonly exif: Exif | null;
  readonly nowMs: number;
  readonly device: DeviceFix | null;
  // Photos of the work already kept for this report.
  readonly count: number;
};

export type ProofCheck =
  | { readonly kind: "refused"; readonly rule: "notCamera" | "proofFormat" | "proofTooMany" }
  | { readonly kind: "kept"; readonly fix: DeviceFix | null };

// A photo of the work comes from a camera. It may be sent long after it was taken, so unlike a
// reporter's it is not asked to be new; the officer's own reading is kept when it is good enough.
export function checkProof({ bytes, exif, nowMs, device, count }: ProofInput): ProofCheck {
  if (!isJpeg(bytes) || bytes.length < PHOTO.minBytes || bytes.length > PROOF.maxBytes)
    return { kind: "refused", rule: "proofFormat" };
  if (exif === null || !exif.camera) return { kind: "refused", rule: "notCamera" };
  if (count >= PROOF.max) return { kind: "refused", rule: "proofTooMany" };
  return { kind: "kept", fix: usableFix(device, nowMs) };
}
