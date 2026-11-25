import { checkIdentity, type FieldError, type IdentityInput, type ReporterRole } from "../identityForm";
import { tidy } from "../text";
import { type Choice, type Day, readChoice } from "./reply";

// Where a chat stands beside its draft: who is being asked for, or the second half of an answer.

// Consent given in the chat, carried until the reporter is known.
type Agreed = { readonly agreedAtMs: number; readonly emergency: boolean };

export type IdentityStep =
  | { readonly kind: "consent"; readonly emergency: boolean }
  | ({ readonly kind: "role" } & Agreed)
  | ({ readonly kind: "name"; readonly role: ReporterRole } & Agreed)
  | ({ readonly kind: "officerRegency"; readonly name: string } & Agreed)
  | ({ readonly kind: "officerPosition"; readonly name: string; readonly officerRegency: string } & Agreed);

// A village, or a regency or district whose villages may be listed.
export type ListedPlace = { readonly level: "regency" | "district" | "village"; readonly code: string };
export type ListedArea = { readonly level: "regency" | "district"; readonly code: string };

// Half an answer to the question of one revision of the draft; it says nothing about any other.
export type CardStep =
  | {
      readonly kind: "places";
      readonly revision: number;
      readonly places: readonly ListedPlace[];
      readonly area: ListedArea | null;
    }
  | { readonly kind: "hour"; readonly revision: number; readonly day: Day }
  | { readonly kind: "other"; readonly revision: number; readonly picked: readonly string[] }
  | { readonly kind: "groups"; readonly revision: number };

// An event told while no report is open: which report it is about, or a new one.
export type TicketStep = {
  readonly kind: "aboutTicket";
  readonly tickets: readonly string[];
  readonly mayBeNew: boolean;
  readonly text: string;
};

// After the first report of a number: whether news of it may come in the chat (D32).
type NewsStep = { readonly kind: "wantNews"; readonly ticketNumber: string };

export type ChatStep = IdentityStep | CardStep | TicketStep | NewsStep;

const IDENTITY_KINDS: readonly string[] = ["consent", "role", "name", "officerRegency", "officerPosition"];

export const isIdentityStep = (step: ChatStep): step is IdentityStep => IDENTITY_KINDS.includes(step.kind);

// A card step of another revision is of a question already answered.
export const cardStepAt = (step: ChatStep | null, revision: number): CardStep | null =>
  step !== null && "revision" in step && step.revision === revision ? step : null;

export type IdentityMove =
  | { readonly kind: "ask"; readonly step: IdentityStep }
  | { readonly kind: "declined" }
  // Not one of the answers offered.
  | { readonly kind: "unclear" }
  | { readonly kind: "invalid"; readonly rule: string; readonly params: Readonly<Record<string, string | number>> }
  | {
      readonly kind: "known";
      readonly identity: Omit<IdentityInput, "number">;
      readonly agreedAtMs: number;
      readonly emergency: boolean;
    };

// One answer held against the rule of its own box on the identity form.
function boxError(box: "name" | "officerRegency" | "officerPosition", text: string): FieldError | undefined {
  const checked = checkIdentity({
    role: "claimedOfficer",
    name: text,
    number: null,
    officerRegency: text,
    officerPosition: text,
  });
  return "errors" in checked ? checked.errors.find((error) => error.fieldId === box) : undefined;
}

// The words of the answers come from the catalogue; "ya" and "warga" are read like their numbers.
export function identityMove(
  step: IdentityStep,
  text: string,
  choices: readonly Choice[],
  nowMs: number,
): IdentityMove {
  if (step.kind === "consent" || step.kind === "role") {
    const read = readChoice(text, choices);
    if (read.kind !== "picked") return { kind: "unclear" };
    const [picked] = read.ids;
    if (step.kind === "consent")
      return picked === "agree"
        ? { kind: "ask", step: { kind: "role", agreedAtMs: nowMs, emergency: step.emergency } }
        : { kind: "declined" };
    return { kind: "ask", step: { ...step, kind: "name", role: picked as ReporterRole } };
  }
  const error = boxError(step.kind, text);
  if (error) return { kind: "invalid", rule: error.rule, params: error.params };
  const value = tidy(text);
  const { agreedAtMs, emergency } = step;
  if (step.kind === "name")
    return step.role === "citizen"
      ? {
          kind: "known",
          identity: { role: "citizen", name: value, officerRegency: "", officerPosition: "" },
          agreedAtMs,
          emergency,
        }
      : { kind: "ask", step: { kind: "officerRegency", name: value, agreedAtMs, emergency } };
  if (step.kind === "officerRegency")
    return {
      kind: "ask",
      step: { kind: "officerPosition", name: step.name, officerRegency: value, agreedAtMs, emergency },
    };
  return {
    kind: "known",
    identity: {
      role: "claimedOfficer",
      name: step.name,
      officerRegency: step.officerRegency,
      officerPosition: value,
    },
    agreedAtMs,
    emergency,
  };
}
