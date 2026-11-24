import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  let status = responseStatusCode;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      status = 500;
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    },
  });
  // Wait for the whole document: a phone with no script must get the complete first question.
  await body.allReady;
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status });
}
