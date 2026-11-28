import type { Settings } from "../platform/settings";

export type AuthSettings = NonNullable<Settings["auth"]>;

type SignInStart = {
  readonly url: string;
  readonly verifier: string;
  readonly state: string;
  readonly nonce: string;
};

type SignInFinish = { readonly ok: true; readonly claims: unknown } | { readonly ok: false; readonly reason: string };

// Signing in through auth (centurisk97-auth), an OpenID Connect provider: authorization code with PKCE.
export type SignInPort = {
  start(redirectUri: string): Promise<SignInStart>;
  finish(input: {
    readonly currentUrl: URL;
    readonly redirectUri: string;
    readonly verifier: string;
    readonly state: string;
    readonly nonce: string;
  }): Promise<SignInFinish>;
};
