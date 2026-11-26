import type { ErrorEnvelope } from "../../src/contract/errors";

// Every call a page makes from the browser goes through here. Pages that load with the server read
// through the context's api instead. The bodies are the API's own contract types, served by the
// same deploy, so they are not parsed a second time on the reporter's phone.
export type Answer<T> =
  | { readonly kind: "ok"; readonly body: T }
  | { readonly kind: "refused"; readonly status: number; readonly envelope: ErrorEnvelope }
  // No connection, or an answer that is not the API's.
  | { readonly kind: "unreachable" };

const BASE = "/api/lapor";
const JSON_HEADERS = { "content-type": "application/json", "x-lapor-client": "1" };

async function answerOf<T>(
  path: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
): Promise<Answer<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, init);
    return response.ok
      ? { kind: "ok", body: await read(response) }
      : { kind: "refused", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
  } catch {
    return { kind: "unreachable" };
  }
}

const posted = (body: unknown): RequestInit => ({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
const json = <T>(response: Response) => response.json() as Promise<T>;

export const getJson = <T>(path: string) => answerOf<T>(path, {}, json<T>);

export const postJson = <T>(path: string, body: unknown) => answerOf<T>(path, posted(body), json<T>);

// A file kept behind a body, such as a photo of the work behind the tracking link's secret.
export const postForFile = (path: string, body: unknown) =>
  answerOf<Blob>(path, posted(body), (response) => response.blob());

export const putJson = <T>(path: string, body: unknown) =>
  answerOf<T>(path, { ...posted(body), method: "PUT" }, json<T>);

// A post answered with no body.
export const postOnly = (path: string, body: unknown) => answerOf<null>(path, posted(body), async () => null);

// A part of a file as the request's whole body.
export const putBytes = <T>(path: string, bytes: Blob) =>
  answerOf<T>(path, { method: "PUT", headers: { "x-lapor-client": "1" }, body: bytes }, json<T>);

export const deleteJson = <T>(path: string) =>
  answerOf<T>(path, { method: "DELETE", headers: { "x-lapor-client": "1" } }, json<T>);
