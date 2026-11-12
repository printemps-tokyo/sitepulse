/**
 * Service-account authentication for the Google Analytics and Search Console APIs.
 *
 * The token exchange itself is shared with the sibling tools
 * (src/shared/google-auth.ts); this file only fixes the scope.
 */

import { requestServiceAccountToken, type ServiceAccount } from "./shared/google-auth.js";
import type { Sleep } from "./shared/http.js";

export { base64url, buildJwtClaim, createAssertion } from "./shared/google-auth.js";

/** Read-only scopes for both APIs, space-delimited as the JWT claim takes them. */
export const SCOPES = "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";

/** Exchange a service-account assertion for an access token (network). */
export function requestAccessToken(
  sa: ServiceAccount,
  fetchFn: typeof fetch = fetch,
  iatSec: number = Math.floor(Date.now() / 1000),
  sleep?: Sleep,
): Promise<string> {
  return requestServiceAccountToken(sa, SCOPES, fetchFn, iatSec, sleep);
}
