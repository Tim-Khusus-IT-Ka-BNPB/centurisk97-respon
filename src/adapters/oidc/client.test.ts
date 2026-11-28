import { describe, expect, test } from "vitest";
import { oidcSignIn } from "./client";

const ISSUER = "http://127.0.0.1:3100";
const CLIENT = { issuer: ISSUER, clientId: "respon", clientSecret: "a-client-secret-of-thirty-two-bytes" };
const CALLBACK = "http://localhost:5173/api/auth/callback";

const base64url = (data: Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const sha256 = async (text: string) =>
  base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));

// Auth as far as respon talks to it: discovery, the keys, and a token endpoint that checks the
// client, the code and the PKCE verifier before it signs an ID token for the nonce it was given.
async function fakeAuth(options: { readonly nonce?: string; readonly endSession?: boolean } = {}) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const calls: string[] = [];
  const pending = new Map<string, { challenge: string; nonce: string }>();

  const sign = async (claims: Record<string, unknown>) => {
    const text = `${base64url(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(text),
    );
    return `${text}.${base64url(new Uint8Array(signature))}`;
  };

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname === "/.well-known/openid-configuration")
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["ES256"],
        ...(options.endSession === false ? {} : { end_session_endpoint: `${ISSUER}/session/end` }),
      });
    if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
    const form = new URLSearchParams(await request.text());
    // Basic credentials are form-encoded first (RFC 6749, 2.3.1).
    const basic = atob((request.headers.get("authorization") ?? "").replace(/^Basic /, ""))
      .split(":")
      .map(decodeURIComponent);
    const code = pending.get(form.get("code") ?? "");
    if (basic[0] !== CLIENT.clientId || basic[1] !== CLIENT.clientSecret || !code)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    if ((await sha256(form.get("code_verifier") ?? "")) !== code.challenge)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const idToken = await sign({
      iss: ISSUER,
      aud: CLIENT.clientId,
      sub: "5f0c2b1e-7d4a-4c1e-9a53-0d6f1e2a3b4c",
      iat: now,
      exp: now + 300,
      nonce: options.nonce ?? code.nonce,
      name: "Petugas Uji",
      claims_version: 1,
    });
    return Response.json({ access_token: "an-access-token", token_type: "Bearer", expires_in: 300, id_token: idToken });
  };

  // What auth does when the person signs in: a code for the challenge and nonce of the request.
  const authorize = (url: string) => {
    const asked = new URL(url).searchParams;
    pending.set("a-code", { challenge: asked.get("code_challenge") ?? "", nonce: asked.get("nonce") ?? "" });
    return new URL(`${CALLBACK}?code=a-code&state=${asked.get("state")}`);
  };

  return { fetcher: fetcher as typeof fetch, calls, authorize };
}

describe("signing in through auth", () => {
  test("start asks auth for a code with PKCE, and discovery is fetched once", async () => {
    const auth = await fakeAuth();
    const signIn = oidcSignIn(CLIENT, auth.fetcher);
    const started = await signIn.start(CALLBACK);
    await signIn.start(CALLBACK);
    const asked = new URL(started.url);
    expect(`${asked.origin}${asked.pathname}`).toBe(`${ISSUER}/auth`);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      client_id: "respon",
      redirect_uri: CALLBACK,
      response_type: "code",
      scope: "openid profile email phone memberships",
      state: started.state,
      nonce: started.nonce,
      code_challenge: await sha256(started.verifier),
      code_challenge_method: "S256",
    });
    expect(auth.calls).toEqual(["/.well-known/openid-configuration"]);
  });

  test("finish trades the code for the person's claims", async () => {
    const auth = await fakeAuth();
    const signIn = oidcSignIn(CLIENT, auth.fetcher);
    const started = await signIn.start(CALLBACK);
    const finished = await signIn.finish({
      currentUrl: auth.authorize(started.url),
      redirectUri: CALLBACK,
      ...started,
    });
    expect(finished).toMatchObject({
      ok: true,
      claims: { sub: "5f0c2b1e-7d4a-4c1e-9a53-0d6f1e2a3b4c", name: "Petugas Uji" },
    });
    expect((finished as { idToken: string }).idToken.split(".")).toHaveLength(3);
  });

  test("a callback for another state, a token for another nonce or a wrong verifier is refused", async () => {
    const auth = await fakeAuth();
    const signIn = oidcSignIn(CLIENT, auth.fetcher);
    const started = await signIn.start(CALLBACK);
    const back = auth.authorize(started.url);
    expect(
      await signIn.finish({ currentUrl: back, redirectUri: CALLBACK, ...started, state: "another" }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await signIn.finish({ currentUrl: back, redirectUri: CALLBACK, ...started, verifier: "x".repeat(43) }),
    ).toMatchObject({ ok: false });
    const replayed = await fakeAuth({ nonce: "another-nonce" });
    const other = oidcSignIn(CLIENT, replayed.fetcher);
    const again = await other.start(CALLBACK);
    expect(
      await other.finish({ currentUrl: replayed.authorize(again.url), redirectUri: CALLBACK, ...again }),
    ).toMatchObject({
      ok: false,
    });
  });

  test("auth out of reach: start fails and the next start asks again; finish says why", async () => {
    const auth = await fakeAuth();
    let down = true;
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (down) throw "connection refused";
      return auth.fetcher(input, init);
    }) as typeof fetch;
    const signIn = oidcSignIn(CLIENT, fetcher);
    await expect(signIn.start(CALLBACK)).rejects.toBe("connection refused");
    down = false;
    const started = await signIn.start(CALLBACK);
    down = true;
    const finished = await signIn.finish({
      currentUrl: auth.authorize(started.url),
      redirectUri: CALLBACK,
      ...started,
    });
    expect(finished).toEqual({ ok: false, reason: "connection refused" });
  });
});

describe("signing out through auth", () => {
  const BACK = "http://localhost:5173/";

  test("goes to auth's end-session page with the ID token as the hint, and back to the start", async () => {
    const signIn = oidcSignIn(CLIENT, (await fakeAuth()).fetcher);
    const end = new URL((await signIn.endUrl("an-id-token", BACK)) as string);
    expect(`${end.origin}${end.pathname}`).toBe(`${ISSUER}/session/end`);
    expect(Object.fromEntries(end.searchParams)).toEqual({
      client_id: "respon",
      id_token_hint: "an-id-token",
      post_logout_redirect_uri: BACK,
    });
    const bare = new URL((await signIn.endUrl(null, BACK)) as string);
    expect(Object.fromEntries(bare.searchParams)).toEqual({ client_id: "respon", post_logout_redirect_uri: BACK });
  });

  test("with no end-session page named, or auth out of reach, there is none", async () => {
    expect(await oidcSignIn(CLIENT, (await fakeAuth({ endSession: false })).fetcher).endUrl("t", BACK)).toBeNull();
    const down = (() => {
      throw "connection refused";
    }) as unknown as typeof fetch;
    expect(await oidcSignIn(CLIENT, down).endUrl("t", BACK)).toBeNull();
  });
});
