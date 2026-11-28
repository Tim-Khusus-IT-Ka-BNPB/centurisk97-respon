import * as oauth from "oauth4webapi";
import type { AuthSettings, SignInPort } from "../../ports/signIn";

const SCOPE = "openid profile email phone memberships";

export function oidcSignIn(settings: AuthSettings, fetcher: typeof fetch = fetch): SignInPort {
  const issuer = new URL(settings.issuer);
  // Local development runs auth over plain http on loopback; everywhere else it is https.
  const options = { [oauth.customFetch]: fetcher, [oauth.allowInsecureRequests]: issuer.protocol === "http:" };
  const client: oauth.Client = { client_id: settings.clientId, id_token_signed_response_alg: "ES256" };
  const authentication = oauth.ClientSecretBasic(settings.clientSecret);
  let discovered: Promise<oauth.AuthorizationServer> | null = null;
  const server = () => {
    discovered ??= oauth
      .discoveryRequest(issuer, options)
      .then((response) => oauth.processDiscoveryResponse(issuer, response))
      .catch((error: unknown) => {
        discovered = null;
        throw error;
      });
    return discovered;
  };

  return {
    async start(redirectUri) {
      const as = await server();
      const verifier = oauth.generateRandomCodeVerifier();
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const url = new URL(as.authorization_endpoint as string);
      url.search = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        state,
        nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString();
      return { url: url.href, verifier, state, nonce };
    },
    async finish({ currentUrl, redirectUri, verifier, state, nonce }) {
      try {
        const as = await server();
        const params = oauth.validateAuthResponse(as, client, currentUrl, state);
        const response = await oauth.authorizationCodeGrantRequest(
          as,
          client,
          authentication,
          params,
          redirectUri,
          verifier,
          options,
        );
        const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
          expectedNonce: nonce,
          requireIdToken: true,
        });
        return { ok: true, claims: oauth.getValidatedIdTokenClaims(result), idToken: result.id_token as string };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async endUrl(idToken, postLogoutRedirectUri) {
      const endpoint = (await server().catch(() => null))?.end_session_endpoint;
      if (endpoint === undefined) return null;
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        client_id: settings.clientId,
        ...(idToken === null ? {} : { id_token_hint: idToken }),
        post_logout_redirect_uri: postLogoutRedirectUri,
      }).toString();
      return url.href;
    },
  };
}
