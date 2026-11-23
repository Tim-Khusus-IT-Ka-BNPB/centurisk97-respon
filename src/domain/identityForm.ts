import { LENGTHS } from "./limits";
import { normaliseNumber } from "./phoneNumber";
import { tidy } from "./text";

export type ReporterRole = "citizen" | "claimedOfficer";

// One refusal of a form value. The rule names its copy key under fieldError.
export type FieldError = {
  readonly fieldId: string;
  readonly rule: string;
  readonly params: Readonly<Record<string, string | number>>;
};

export type IdentityInput = {
  readonly role: string;
  readonly name: string;
  // Absent on the session path: the session already knows the number.
  readonly number: string | null;
  readonly officerRegency: string;
  readonly officerPosition: string;
};

export type Identity = {
  readonly role: ReporterRole;
  readonly name: string;
  readonly number: string | null;
  readonly officerRegency: string | null;
  readonly officerPosition: string | null;
};

const DIGIT = /\d/;
const ROLES: Readonly<Record<string, ReporterRole>> = { citizen: "citizen", claimedOfficer: "claimedOfficer" };

function nameError(name: string): FieldError | null {
  const label = "identity.name.label";
  if (name === "") return { fieldId: "name", rule: "required", params: { label } };
  if (DIGIT.test(name)) return { fieldId: "name", rule: "name.digits", params: { label } };
  if (name.length < LENGTHS.name.min) return { fieldId: "name", rule: "name.tooShort", params: { label } };
  if (name.length > LENGTHS.name.max)
    return { fieldId: "name", rule: "name.tooLong", params: { label, length: name.length } };
  return null;
}

function officerError(fieldId: "officerRegency" | "officerPosition", value: string, label: string): FieldError | null {
  const { min, max } = LENGTHS[fieldId];
  if (value === "") return { fieldId, rule: "required", params: { label } };
  if (value.length < min) return { fieldId, rule: `${fieldId}.tooShort`, params: { label } };
  if (value.length > max) return { fieldId, rule: "text.tooLong", params: { label, length: value.length, max } };
  return null;
}

// Checks the identity and consent form. A name is never cut short: a long one is refused. The
// officer fields are read only for an officer, as a form with no script still sends them.
export function checkIdentity(input: IdentityInput): { identity: Identity } | { errors: FieldError[] } {
  const role = Object.hasOwn(ROLES, input.role) ? ROLES[input.role] : undefined;
  const name = tidy(input.name);
  const errors: FieldError[] = [];
  if (role === undefined) errors.push({ fieldId: "role", rule: "required", params: { label: "identity.role.label" } });
  const named = nameError(name);
  if (named) errors.push(named);
  let number: string | null = null;
  if (input.number !== null) {
    number = normaliseNumber(input.number);
    if (number === null)
      errors.push({ fieldId: "number", rule: "number.format", params: { label: "identity.number.label" } });
  }
  const officer = role === "claimedOfficer";
  const regency = tidy(input.officerRegency);
  const position = tidy(input.officerPosition);
  if (officer) {
    const regencyError = officerError("officerRegency", regency, "identity.officerRegency.label");
    if (regencyError) errors.push(regencyError);
    const positionError = officerError("officerPosition", position, "identity.officerPosition.label");
    if (positionError) errors.push(positionError);
  }
  if (errors.length > 0) return { errors };
  return {
    identity: {
      role: role as ReporterRole,
      name,
      number,
      officerRegency: officer ? regency : null,
      officerPosition: officer ? position : null,
    },
  };
}
