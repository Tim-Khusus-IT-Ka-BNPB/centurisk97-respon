import { describe, expect, test } from "vitest";
import { browser, testBindings, testDatabase } from "../../testing/api";
import { api } from "../app";

const { bindings } = testBindings();
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db: testDatabase() });

describe("language preference", () => {
  test("a language offered is kept for a year; one not offered is refused", async () => {
    const phone = browser(fetchApi);
    expect((await phone.call("POST", "/preferences/language", { language: "id" })).status).toBe(204);
    expect(phone.cookies.get("bahasa")).toBe("id");
    expect((await phone.call("POST", "/preferences/language", { language: "en" })).status).toBe(204);
    expect((await phone.call("POST", "/preferences/language", { language: "fr" })).status).toBe(400);
    expect((await phone.call("POST", "/preferences/language", { language: "klingon" })).status).toBe(400);
  });
});

describe("theme preference", () => {
  test("light and dark are kept for a year; anything else is refused", async () => {
    const phone = browser(fetchApi);
    expect((await phone.call("POST", "/preferences/theme", { theme: "dark" })).status).toBe(204);
    expect(phone.cookies.get("theme")).toBe("dark");
    expect((await phone.call("POST", "/preferences/theme", { theme: "light" })).status).toBe(204);
    expect(phone.cookies.get("theme")).toBe("light");
    expect((await phone.call("POST", "/preferences/theme", { theme: "device" })).status).toBe(400);
  });

  test("the cookie is HttpOnly and SameSite Lax, Secure over https", async () => {
    const set = (origin: string) =>
      fetchApi(
        new Request(`${origin}/api/lapor/preferences/theme`, {
          method: "POST",
          headers: {
            "cf-connecting-ip": "198.51.100.40",
            origin: "http://localhost:5173",
            "x-lapor-client": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ theme: "light" }),
        }),
      );
    expect((await set("http://localhost")).headers.get("set-cookie")).toBe(
      "theme=light; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax",
    );
    expect((await set("https://localhost")).headers.get("set-cookie")).toContain("; Secure;");
  });
});
