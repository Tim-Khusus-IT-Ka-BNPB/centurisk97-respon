import { afterEach, describe, expect, test, vi } from "vitest";
import { envelope } from "../../src/api/envelope";
import { getJson, postForFile, postJson } from "./clientApi";

const calls: [string, RequestInit][] = [];
function answer(response: () => Response) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return response();
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("calls from the browser", () => {
  test("a read and a write answer their body; a write names its client and sends JSON", async () => {
    answer(() => Response.json({ n: 1 }));
    expect(await getJson<{ n: number }>("/desk/emergencies")).toEqual({ kind: "ok", body: { n: 1 } });
    expect(calls[0]).toEqual(["/api/lapor/desk/emergencies", {}]);
    expect(await postJson("/tracking", { token: "t" })).toEqual({ kind: "ok", body: { n: 1 } });
    expect(calls[1]?.[1]).toEqual({
      method: "POST",
      headers: { "content-type": "application/json", "x-lapor-client": "1" },
      body: '{"token":"t"}',
    });
  });

  test("a file comes back as it was sent", async () => {
    answer(() => new Response("foto"));
    const file = await postForFile("/tracking/photos", {});
    expect(file.kind === "ok" && (await file.body.text())).toBe("foto");
  });

  test("a refusal carries the API's envelope", async () => {
    const refused = envelope("tracking.notFound");
    answer(() => Response.json(refused, { status: 404 }));
    expect(await postJson("/tracking", {})).toEqual({ kind: "refused", status: 404, envelope: refused });
  });

  test("no connection, or an answer that is not the API's, is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await getJson("/x")).toEqual({ kind: "unreachable" });
    answer(() => new Response("<html>", { status: 200 }));
    expect(await getJson("/x")).toEqual({ kind: "unreachable" });
    answer(() => new Response("<html>", { status: 502 }));
    expect(await getJson("/x")).toEqual({ kind: "unreachable" });
  });
});
