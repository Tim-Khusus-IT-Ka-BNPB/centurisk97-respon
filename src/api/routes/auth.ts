import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { STAFF_SESSION_MS, signInStaff, staffCookieName } from "../../adapters/identity/auth";
import { staffAccountOf } from "../../domain/staffClaims";
import { isSignatureOf, signText } from "../../platform/keys";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, refusal } from "../route";

// Staff sign in through auth (centurisk97-auth): this sends them there, and takes them back in.

const SIGN_IN_SECONDS = 10 * 60;
const signInCookie = (secure: boolean) => (secure ? "__Host-respon_sign_in" : "respon_sign_in");
const isSecure = (c: ApiContext) => c.env.settings.appOrigin.startsWith("https://");
const callbackOf = (c: ApiContext) => `${c.env.settings.appOrigin}/api/auth/callback`;

// Where to land after signing in: a page of this site, never another host.
const landing = (back: string | undefined) => (back !== undefined && /^\/(?![/\\])/.test(back) ? back : "/desk");

// What the browser keeps between leaving for auth and coming back, signed so it cannot be forged.
type Pending = { readonly verifier: string; readonly state: string; readonly nonce: string; readonly back: string };

async function seal(secret: string, pending: Pending): Promise<string> {
  const text = btoa(JSON.stringify({ ...pending, back: encodeURIComponent(pending.back) }));
  return `${text}.${await signText(secret, text)}`;
}

async function unseal(secret: string, value: string | undefined): Promise<Pending | null> {
  const [text, signature] = (value ?? "").split(".");
  if (!text || !signature || !(await isSignatureOf(secret, text, signature))) return null;
  const pending = JSON.parse(atob(text)) as Pending;
  return { ...pending, back: decodeURIComponent(pending.back) };
}

export function addAuthRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/auth/sign-in",
      request: { query: z.object({ back: z.string().max(500).optional() }) },
      responses: {
        302: { description: "On to auth, to sign in there" },
        404: refusal("Staff sign in with seeded codes here"),
      },
    }),
    async (c) => {
      if (c.env.signIn === null) return refuse(c, 404, "request.refused");
      const started = await c.env.signIn.start(callbackOf(c));
      const pending = {
        verifier: started.verifier,
        state: started.state,
        nonce: started.nonce,
        back: landing(c.req.valid("query").back),
      };
      setCookie(c, signInCookie(isSecure(c)), await seal(c.env.settings.keyHmacSecret, pending), {
        httpOnly: true,
        secure: isSecure(c),
        sameSite: "Lax",
        path: "/",
        maxAge: SIGN_IN_SECONDS,
      });
      return c.redirect(started.url, 302);
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/auth/callback",
      responses: {
        302: { description: "Signed in and on to the page asked for, or back to the desk with why not" },
        404: refusal("Staff sign in with seeded codes here"),
      },
    }),
    async (c) => {
      if (c.env.signIn === null) return refuse(c, 404, "request.refused");
      const secure = isSecure(c);
      const pending = await unseal(c.env.settings.keyHmacSecret, getCookie(c, signInCookie(secure)));
      deleteCookie(c, signInCookie(secure), { path: "/", secure });
      if (pending === null) return c.redirect("/desk?signIn=failed", 302);
      const { back, ...flow } = pending;
      const finished = await c.env.signIn.finish({
        currentUrl: new URL(c.req.url),
        redirectUri: callbackOf(c),
        ...flow,
      });
      if (!finished.ok) {
        c.env.log.warn({ event: "auth.signInFailed", errorCode: "auth.signInFailed" });
        return c.redirect("/desk?signIn=failed", 302);
      }
      const account = staffAccountOf(finished.claims);
      if (account === null) return c.redirect("/desk?signIn=noAccess", 302);
      const token = await signInStaff(c.env.db, c.env.clock, account);
      setCookie(c, staffCookieName(secure), token, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: STAFF_SESSION_MS / 1000,
      });
      return c.redirect(back, 302);
    },
  );
}
