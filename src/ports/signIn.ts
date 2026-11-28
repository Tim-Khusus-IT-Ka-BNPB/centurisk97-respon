import type { Settings } from "../platform/settings";

export type AuthSettings = NonNullable<Settings["auth"]>;

type SignInStart = {
  readonly url: string;
  readonly verifier: string;
  readonly state: string;
  readonly nonce: string;
};

// The claims, and the ID token they came in, kept to sign out of auth with.
type SignInFinish =
  | { readonly ok: true; readonly claims: unknown; readonly idToken: string }
  | { readonly ok: false; readonly reason: string };

// Signing in through auth (centurisk97-auth), an OpenID Connect provider: authorization code with PKCE.
// Signing out leaves through auth's end-session page, so auth's own session ends too.
export type SignInPort = {
  start(redirectUri: string): Promise<SignInStart>;
  finish(input: {
    readonly currentUrl: URL;
    readonly redirectUri: string;
    readonly verifier: string;
    readonly state: string;
    readonly nonce: string;
  }): Promise<SignInFinish>;
  // Auth's end-session page for this sign-in, back to the address given; null when auth names none
  // or is out of reach, and the person is signed out of respon alone.
  endUrl(idToken: string | null, postLogoutRedirectUri: string): Promise<string | null>;
};
