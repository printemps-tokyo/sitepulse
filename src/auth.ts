/**
 * Service-account authentication for the Google Analytics and Search Console APIs.
 *
 * A Google service account authenticates with a signed JWT ("two-legged
 * OAuth"): we build a claim set, sign it with the account's RSA private key
 * (via Node's built-in `crypto`, so there are no dependencies), and exchange
 * the assertion for a short-lived access token. The token-building steps are
 * pure; only the final token exchange touches the network.
 */

import { createSign } from "node:crypto";
import { exchange, type Sleep } from "./http.js";
import type { ServiceAccount } from "./types.js";

/** Read-only scopes for both APIs, space-delimited as the JWT claim takes them. */
export const SCOPES = "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Base64url-encode a string or buffer (no padding). */
export function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Build the JWT claim set for a service-account token request (pure). */
export function buildJwtClaim(
  clientEmail: string,
  scope: string,
  aud: string,
  iatSec: number,
): Record<string, string | number> {
  return {
    iss: clientEmail,
    scope,
    aud,
    iat: iatSec,
    exp: iatSec + 3600,
  };
}

/** Build and RS256-sign the JWT assertion for a service account. */
export function createAssertion(sa: ServiceAccount, scope: string, iatSec: number): string {
  const aud = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify(buildJwtClaim(sa.client_email, scope, aud, iatSec)));
  const signingInput = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

/** Exchange a service-account assertion for an access token (network). */
export async function requestAccessToken(
  sa: ServiceAccount,
  fetchFn: typeof fetch = fetch,
  iatSec: number = Math.floor(Date.now() / 1000),
  sleep?: Sleep,
): Promise<string> {
  const assertion = createAssertion(sa, SCOPES, iatSec);
  // Same timeout and retry as the API calls (see http.ts).
  const res = await exchange(
    sa.token_uri ?? DEFAULT_TOKEN_URI,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    },
    fetchFn,
    sleep,
  );
  if (!res.ok) {
    throw new Error(`token request failed (HTTP ${res.status}): ${res.text.slice(0, 300)}`);
  }
  const token = (JSON.parse(res.text) as { access_token?: string }).access_token;
  if (!token) {
    throw new Error("token request returned no access_token");
  }
  return token;
}
