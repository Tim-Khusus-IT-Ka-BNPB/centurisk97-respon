import { envelope } from "./envelope";
import { API_BASE } from "./route";

type ApiMethod = "GET" | "POST" | "DELETE";

// Lets a page loader or form action call a Hono route inside the Worker, with no network, so
// policy and schemas are declared once and a page works with no script.
export type ApiCall = (method: ApiMethod, path: string, body?: unknown) => Promise<Response>;

const FORWARDED_HEADERS = ["cookie", "cf-connecting-ip"] as const;

export function createBridge(
  fetchApi: (request: Request) => Promise<Response>,
  appOrigin: string,
  pageRequest: Request,
): ApiCall {
  return async (method, path, body) => {
    // A page post is checked by its Origin here; the API then sees our own origin and client header.
    if (method !== "GET" && pageRequest.headers.get("origin") !== appOrigin) {
      return Response.json(envelope("request.refused"), { status: 403 });
    }
    const headers = new Headers({ origin: appOrigin, "x-lapor-client": "1" });
    for (const name of FORWARDED_HEADERS) {
      const value = pageRequest.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const init: RequestInit = { method, headers };
    // A form with a file travels as multipart; the runtime sets its boundary.
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    return fetchApi(new Request(new URL(`${API_BASE}${path}`, appOrigin), init));
  };
}
