import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DraftBody } from "../../contract/draft";
import type { ErrorCode } from "../../contract/errors";
import type { FieldError } from "../../domain/identityForm";
import { LIMITS } from "../../domain/limits";
import type { DeviceFix } from "../../domain/photoChecks";
import { sha256Hex } from "../../platform/keys";
import type { LimitRefusal } from "../../services/limits";
import type { Answer } from "../../services/turn";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";

export const fieldErrors = (errors: readonly FieldError[]) =>
  errors.map((error) => ({ fieldId: error.fieldId, copyKey: `fieldError.${error.rule}`, params: { ...error.params } }));

// A limit refusal names the limit, its number, the time to try again with its zone, and keeps the draft.
export function limitRefused(c: ApiContext, refusal: LimitRefusal, draft: DraftBody | null): Response {
  const zone = draft?.keptUntil.zone ?? "WIB";
  return refuse(c, 429, `limit.${refusal.limitId}`, {
    params: { limit: LIMITS[refusal.limitId].max },
    retryAt: refusal.retryAtMs === null ? null : { utc: new Date(refusal.retryAtMs).toISOString(), zone },
    draft,
  });
}

// One answer of a draft service as an HTTP response.
export function answered(c: ApiContext, answer: Answer): Response {
  switch (answer.kind) {
    case "ok":
      return c.json(answer.body, answer.status as ContentfulStatusCode);
    case "notFound":
      return refuse(c, 404, "draft.notFound");
    case "expired":
      return refuse(c, 410, "draft.expired");
    case "keyReused":
      return refuse(c, 422, "turn.keyReused");
    case "changed":
      return refuse(c, 409, "draft.changed", { draft: answer.draft });
    case "invalid":
      return refuse(c, 422, answer.code as ErrorCode, { fields: fieldErrors(answer.errors), draft: answer.draft });
    default:
      return limitRefused(c, answer.refusal, answer.draft);
  }
}

// The fingerprint of a turn request, without its key, to tell a retry from a different answer.
export async function requestHash(body: Readonly<Record<string, unknown>>): Promise<string> {
  const { turnKey: _key, ...rest } = body;
  return sha256Hex(JSON.stringify(rest));
}

const finite = (max: number) => z.coerce.number().refine((value) => Number.isFinite(value) && Math.abs(value) <= max);

// A box the page left empty arrives as "": no reading was sent.
export const optionalBox = <T extends z.ZodType>(schema: T) => z.union([z.literal(""), schema]).optional();

export const isSet = <T>(value: T | "" | undefined): value is T => value !== undefined && value !== "";

// A photo as a multipart form, so the page's own form posts it with no script. The device reading
// comes only from a page with script.
export const photoForm = z.object({
  photo: z.instanceof(File).openapi({ type: "string", format: "binary" }),
  lat: optionalBox(finite(90)),
  lon: optionalBox(finite(180)),
  accuracy: optionalBox(finite(1e7)),
  readAt: optionalBox(z.coerce.number().int().nonnegative()),
});

// The device's reading, when all of it was sent.
export function deviceFix(form: z.infer<typeof photoForm>): DeviceFix | null {
  return isSet(form.lat) && isSet(form.lon) && isSet(form.accuracy) && isSet(form.readAt)
    ? { lat: form.lat, lon: form.lon, accuracyM: form.accuracy, readAtMs: form.readAt }
    : null;
}

export const jpegFile = (description: string) => ({
  description,
  content: { "image/jpeg": { schema: z.string() } },
});
