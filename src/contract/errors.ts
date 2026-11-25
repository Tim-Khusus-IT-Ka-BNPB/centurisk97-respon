import { z } from "zod";
import { LIMIT_IDS, type LimitId } from "../domain/limits";
import { copyKeySchema, paramsSchema, timeSchema } from "./common";
import { draftBodySchema } from "./draft";

const ERROR_CODES = [
  "request.refused",
  "request.tooLarge",
  "request.unavailable",
  "request.invalidFields",
  "auth.signInFirst",
  "draft.notFound",
  "draft.changed",
  "draft.openExists",
  "draft.expired",
  "draft.nothingToUndo",
  "draft.backLimit",
  "turn.keyReused",
  "place.unavailable",
  "send.failed",
  "tracking.notFound",
  "report.notFound",
  "followUp.closed",
  "followUp.nothingNew",
  "followUp.finishFirst",
  "auth.staffSignInFirst",
  "desk.notAllowed",
  "desk.reportNotFound",
  "ticket.transitionRefused",
  "ticket.changed",
  "ticket.taken",
  "gateway.refused",
  "gateway.replayed",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number] | `limit.${LimitId}`;

const errorCodeSchema = z.enum([...ERROR_CODES, ...LIMIT_IDS.map((id) => `limit.${id}` as const)]);

// The copy key the client shows for an envelope code.
export function errorCopyKey(code: ErrorCode): string {
  if (code.startsWith("limit.")) return code;
  if (code === "draft.expired") return "card.expired.body";
  if (code === "draft.openExists") return "card.confirm.replaceDraft.body";
  return `error.${code}`;
}

// The body of every response that is not 2xx.
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: errorCodeSchema, copyKey: copyKeySchema, params: paramsSchema }),
  fields: z.array(z.object({ fieldId: z.string(), copyKey: copyKeySchema, params: paramsSchema })),
  retryAt: timeSchema.nullable(),
  // Sent on 409 and on limit refusals so the client redraws and keeps what was typed.
  draft: draftBodySchema.nullable(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
