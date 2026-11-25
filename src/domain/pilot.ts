import type { FieldError } from "./identityForm";
import { LENGTHS } from "./limits";
import { normaliseNumber } from "./phoneNumber";
import { tidy } from "./text";

// The WhatsApp pilot is closed (K2): only numbers on this list reach the report flow in a chat.

// As many as a gateway reads.
export const PILOT_MAX = 500;

export type PilotNumber = {
  readonly number: string;
  // Allowed as an officer of this BPBD, which confirms a claimed officer (D19).
  readonly officerRegency: string | null;
};

// A number to allow, as typed; a BPBD left empty allows it as anyone's.
export function checkPilotNumber(typed: string, regency: string): PilotNumber | { readonly errors: FieldError[] } {
  const errors: FieldError[] = [];
  const number = normaliseNumber(typed);
  if (number === null)
    errors.push({ fieldId: "number", rule: "number.format", params: { label: "desk.pilot.number" } });
  const officerRegency = tidy(regency);
  const { min, max } = LENGTHS.officerRegency;
  const label = "desk.pilot.regency";
  if (officerRegency !== "" && officerRegency.length < min)
    errors.push({ fieldId: "officerRegency", rule: "officerRegency.tooShort", params: { label } });
  if (officerRegency.length > max)
    errors.push({
      fieldId: "officerRegency",
      rule: "text.tooLong",
      params: { label, length: officerRegency.length, max },
    });
  if (errors.length > 0) return { errors };
  return { number: number as string, officerRegency: officerRegency === "" ? null : officerRegency };
}
