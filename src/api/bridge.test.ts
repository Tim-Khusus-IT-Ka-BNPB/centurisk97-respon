import { describe, expect, test } from "vitest";
import { createBridge } from "./bridge";

const ORIGIN = "http://localhost:5173";

function recorder() {
  const seen: Request[] = [];
  const fetchApi = async (request: Request) => {
    seen.push(request);
    return new Response("handled", { status: 201 });
  };
  return { seen, fetchApi };
}

describe("page to api bridge", () => {
  test("a form with a file goes as multipart, its boundary set by the runtime", async () => {
    const { seen, fetchApi } = recorder();
    const page = new Request(`${ORIGIN}/report/d`, { method: "POST", headers: { origin: ORIGIN } });
    const form = new FormData();
    form.set("photo", new File([new Uint8Array([1, 2])], "foto.jpg", { type: "image/jpeg" }));
    await createBridge(fetchApi, ORIGIN, page)("POST", "/drafts/d/photos", form);
    const [call] = seen as [Request];
    expect(call.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(((await call.formData()).get("photo") as File).size).toBe(2);
  });

  test("a page post becomes a JSON write from our origin, with cookie and address carried", async () => {
    const { seen, fetchApi } = recorder();
    const page = new Request(`${ORIGIN}/report`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: "device_key=abc",
        "cf-connecting-ip": "198.51.100.2",
        "x-forwarded-for": "10.0.0.1",
      },
    });
    const response = await createBridge(fetchApi, ORIGIN, page)("POST", "/consent", { agree: true });
    expect(response.status).toBe(201);
    const [call] = seen as [Request];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ORIGIN}/api/consent`);
    expect(Object.fromEntries(call.headers)).toEqual({
      origin: ORIGIN,
      "x-respon-client": "1",
      cookie: "device_key=abc",
      "cf-connecting-ip": "198.51.100.2",
      "content-type": "application/json",
    });
    expect(await call.json()).toEqual({ agree: true });
  });

  test("a page post from another origin or with none never reaches the api", async () => {
    for (const headers of [{ origin: "https://evil.example.test" }, {}] as Record<string, string>[]) {
      const { seen, fetchApi } = recorder();
      const page = new Request(`${ORIGIN}/report`, { method: "POST", headers });
      const response = await createBridge(fetchApi, ORIGIN, page)("DELETE", "/me/profiles/p1");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "request.refused" } });
      expect(seen).toHaveLength(0);
    }
  });

  test("a page read needs no origin and sends no body", async () => {
    const { seen, fetchApi } = recorder();
    await createBridge(fetchApi, ORIGIN, new Request(`${ORIGIN}/report/d1`))("GET", "/drafts/d1");
    const [call] = seen as [Request];
    expect(call.method).toBe("GET");
    expect(call.body).toBeNull();
    expect(Object.fromEntries(call.headers)).toEqual({ origin: ORIGIN, "x-respon-client": "1" });
  });
});
