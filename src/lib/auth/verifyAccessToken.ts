/**
 * Cryptographic verification of WorkOS AuthKit access tokens.
 *
 * This does real signature verification against WorkOS's published JWKS
 * (via `jose`'s `createRemoteJWKSet`) plus issuer/audience checks — never
 * a bare `jwt.decode()`. Throws on any failure; callers must not swallow
 * the specific reason into a response body (avoid leaking verification
 * internals), but 401-ing on any thrown error is expected and correct.
 *
 * Never logs the token or any part of it.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { getMcpResourceUrl, getWorkosAuthkitDomain } from "./config";

// Cache the remote JWKS resolver across requests/invocations (jose handles
// its own key-set caching/refresh internally). Recreated only if the
// configured AuthKit domain changes, which practically never happens at
// runtime but keeps this safe under test/config changes.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let cachedJwksDomain: string | undefined;

function getJwks(authkitDomain: string) {
  if (!cachedJwks || cachedJwksDomain !== authkitDomain) {
    cachedJwks = createRemoteJWKSet(new URL(`${authkitDomain}/oauth2/jwks`));
    cachedJwksDomain = authkitDomain;
  }

  return cachedJwks;
}

/**
 * Verifies a WorkOS AuthKit access token's signature, issuer, and
 * audience. Returns the decoded, verified payload on success.
 *
 * Throws (e.g. `JWSSignatureVerificationFailed`, `JWTClaimValidationFailed`,
 * `JWTExpired`, or a plain config `Error`) on any failure.
 */
export async function verifyWorkosAccessToken(token: string): Promise<JWTPayload> {
  const authkitDomain = getWorkosAuthkitDomain();
  const resourceUrl = getMcpResourceUrl();

  const { payload } = await jwtVerify(token, getJwks(authkitDomain), {
    issuer: authkitDomain,
    audience: resourceUrl,
  });

  return payload;
}
