import { describe, expect, test } from "vitest";
import { authIdentity } from "../../adapters/identity/auth";
import type { SignInPort } from "../../ports/signIn";
import { fromBrowser, manualClock, testBindings } from "../../testing/api";
import { api } from "../app";
import type { ApiBindings } from "../context";

const clock = manualClock("2026-11-28T03:00:00.000Z");
const { bindings: seeded, lines } = testBindings({}, { clock });

const claims = (memberships: unknown[]) => ({
  sub: "5f0c2b1e-7d4a-4c1e-9a53-0d6f1e2a3b4c",
  name: "Petugas Uji",
  memberships,
  claims_version: 1,
});
const PUSDALOPS = claims([
  {
    organization: { id: "o1", kind: "bnpb", name: "BNPB", level: "national", region: null },
    role: "pusdalops",
    position: "Analis",
  },
]);

// Auth as respon's sign-in port sees it: start always sends to the same place, finish answers what
// the test set, and remembers what it was asked.
function fakeSignIn(answer: () => Awaited<ReturnType<SignInPort["finish"]>>) {
  const asked: Parameters<SignInPort["finish"]>[0][] = [];
  const port: SignInPort = {
    start: async () => ({ url: "http://127.0.0.1:3100/auth?client_id=respon", verifier: "v", state: "s", nonce: "n" }),
    finish: async (input) => {
      asked.push(input);
      return answer();
    },
  };
  return { port, asked };
}

// One browser with its own cookies, reading redirects instead of following them.
function browserOn(bindings: ApiBindings) {
  const cookies = new Map<string, string>();
  return {
    cookies,
    async get(path: string, method = "GET") {
      const headers: Record<string, string> = {
        ...fromBrowser,
        origin: "http://localhost:5173",
        "x-respon-client": "1",
      };
      if (cookies.size > 0) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await api.app.fetch(new Request(`http://localhost/api${path}`, { method, headers }), bindings);
      for (const line of response.headers.getSetCookie()) {
        const [name, value] = (line.split(";")[0] as string).split("=") as [string, string];
        if (value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
      return response;
    },
  };
}

const withAuth = (answer: () => Awaited<ReturnType<SignInPort["finish"]>>) => {
  const signIn = fakeSignIn(answer);
  const bindings: ApiBindings = { ...seeded, identity: authIdentity(seeded.db, clock, false), signIn: signIn.port };
  return { bindings, asked: signIn.asked, browser: browserOn(bindings) };
};

describe("signing staff in through auth", () => {
  test("sign-in sends the browser to auth, and the callback lets it into the desk page it asked for", async () => {
    const { browser, asked } = withAuth(() => ({ ok: true, claims: PUSDALOPS }));
    const leaving = await browser.get("/auth/sign-in?back=%2Fdesk%2Fresponse");
    expect(leaving.status).toBe(302);
    expect(leaving.headers.get("location")).toBe("http://127.0.0.1:3100/auth?client_id=respon");
    expect(browser.cookies.has("respon_sign_in")).toBe(true);

    const back = await browser.get("/auth/callback?code=c&state=s");
    expect(back.headers.get("location")).toBe("/desk/response");
    expect(asked).toEqual([
      {
        currentUrl: new URL("http://localhost/api/auth/callback?code=c&state=s"),
        redirectUri: "http://localhost:5173/api/auth/callback",
        verifier: "v",
        state: "s",
        nonce: "n",
      },
    ]);
    expect(browser.cookies.has("respon_sign_in")).toBe(false);
    expect((await browser.get("/desk/summary")).status).toBe(200);

    expect((await browser.get("/desk/session", "DELETE")).status).toBe(204);
    expect(browser.cookies.has("respon_staff")).toBe(false);
    expect((await browser.get("/desk/summary")).status).toBe(401);
  });

  test("over HTTPS both cookies carry the __Host- prefix and are secure", async () => {
    const { bindings: https } = testBindings({ APP_ORIGIN: "https://localhost:5173" }, { clock });
    const signIn = fakeSignIn(() => ({ ok: true, claims: PUSDALOPS }));
    const browser = browserOn({ ...https, identity: authIdentity(https.db, clock, true), signIn: signIn.port });
    await browser.get("/auth/sign-in");
    expect(browser.cookies.has("__Host-respon_sign_in")).toBe(true);
    const back = await browser.get("/auth/callback?code=c&state=s");
    expect(back.headers.get("set-cookie")).toMatch(/__Host-respon_staff=[^;]+;.*Secure/);
    expect(signIn.asked[0]?.redirectUri).toBe("https://localhost:5173/api/auth/callback");
    expect((await browser.get("/desk/summary")).status).toBe(200);
  });

  test("a page of another host, or none, lands on the desk", async () => {
    for (const back of [
      "",
      "?back=%2F%2Fevil.example%2Fdesk",
      "?back=https%3A%2F%2Fevil.example",
      "?back=%2F%5Cevil.example",
    ]) {
      const { browser } = withAuth(() => ({ ok: true, claims: PUSDALOPS }));
      await browser.get(`/auth/sign-in${back}`);
      expect((await browser.get("/auth/callback?code=c&state=s")).headers.get("location")).toBe("/desk");
    }
  });

  test("a callback without the browser's own pending sign-in, or with a forged one, fails", async () => {
    const { browser, asked } = withAuth(() => ({ ok: true, claims: PUSDALOPS }));
    expect((await browser.get("/auth/callback?code=c&state=s")).headers.get("location")).toBe("/desk?signIn=failed");
    await browser.get("/auth/sign-in");
    const [text] = (browser.cookies.get("respon_sign_in") as string).split(".");
    browser.cookies.set("respon_sign_in", `${text}.forged`);
    expect((await browser.get("/auth/callback?code=c&state=s")).headers.get("location")).toBe("/desk?signIn=failed");
    expect(asked).toEqual([]);
  });

  test("auth refusing the code fails the sign-in and logs it without the reason", async () => {
    const { browser } = withAuth(() => ({ ok: false, reason: "invalid_grant for code c" }));
    await browser.get("/auth/sign-in");
    expect((await browser.get("/auth/callback?code=c&state=s")).headers.get("location")).toBe("/desk?signIn=failed");
    expect(browser.cookies.has("respon_staff")).toBe(false);
    expect(
      lines.some((line) => line.event === "auth.signInFailed" && !JSON.stringify(line).includes("invalid_grant")),
    ).toBe(true);
  });

  test("a person whose memberships open no desk is told so", async () => {
    const { browser } = withAuth(() => ({ ok: true, claims: claims([]) }));
    await browser.get("/auth/sign-in");
    expect((await browser.get("/auth/callback?code=c&state=s")).headers.get("location")).toBe("/desk?signIn=noAccess");
    expect(browser.cookies.has("respon_staff")).toBe(false);
  });

  test("a staff route tells the page where to sign in, only where auth does it", async () => {
    const { browser } = withAuth(() => ({ ok: true, claims: PUSDALOPS }));
    expect((await browser.get("/desk/summary")).headers.get("x-sign-in")).toBe("/api/auth/sign-in");
    const local = browserOn(seeded);
    const refused = await local.get("/desk/summary");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("x-sign-in")).toBeNull();
  });

  test("with seeded codes there is no sign-in through auth", async () => {
    const local = browserOn(seeded);
    expect((await local.get("/auth/sign-in")).status).toBe(404);
    expect((await local.get("/auth/callback")).status).toBe(404);
  });
});
