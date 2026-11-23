import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type ErrorCode, type ErrorEnvelope, errorCopyKey } from "../contract/errors";
import type { ApiContext } from "./context";

type Extra = Partial<Pick<ErrorEnvelope, "fields" | "retryAt" | "draft">> & {
  readonly params?: ErrorEnvelope["error"]["params"];
};

export function envelope(code: ErrorCode, extra: Extra = {}): ErrorEnvelope {
  return {
    error: { code, copyKey: errorCopyKey(code), params: extra.params ?? {} },
    fields: extra.fields ?? [],
    retryAt: extra.retryAt ?? null,
    draft: extra.draft ?? null,
  };
}

// Every refusal answers with the one error envelope.
export function refuse(c: ApiContext, status: ContentfulStatusCode, code: ErrorCode, extra: Extra = {}): Response {
  return c.json(envelope(code, extra), status);
}
