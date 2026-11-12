// Shared verbatim by ga4, gsc and sitepulse, like src/shared/.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  base64url,
  buildJwtClaim,
  createAssertion,
  requestServiceAccountToken,
  DEFAULT_TOKEN_URI,
} from "../../src/shared/google-auth.js";

const noSleep = async (): Promise<void> => {};

function serviceAccount(tokenUri?: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = {
    client_email: "svc@proj.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    ...(tokenUri ? { token_uri: tokenUri } : {}),
  };
  return { sa, publicKey };
}

describe("base64url", () => {
  it("encodes without padding", () => {
    expect(base64url("hello")).toBe("aGVsbG8");
  });
});

describe("buildJwtClaim", () => {
  it("sets the standard fields and a one-hour expiry", () => {
    const claim = buildJwtClaim("svc@p.iam.gserviceaccount.com", "scope-x", "https://aud", 1000);
    expect(claim).toEqual({
      iss: "svc@p.iam.gserviceaccount.com",
      scope: "scope-x",
      aud: "https://aud",
      iat: 1000,
      exp: 4600,
    });
  });
});

describe("createAssertion", () => {
  it("produces a JWT whose signature verifies against the public key", () => {
    const { sa, publicKey } = serviceAccount("https://oauth2.googleapis.com/token");
    const jwt = createAssertion(sa, "scope-y", 1234);
    const [header, claim, signature] = jwt.split(".");

    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${claim}`)
      .verify(publicKey, Buffer.from(signature as string, "base64url"));
    expect(verified).toBe(true);

    const decoded = JSON.parse(Buffer.from(claim as string, "base64url").toString());
    expect(decoded.iss).toBe(sa.client_email);
    expect(decoded.aud).toBe(sa.token_uri);
    expect(decoded.scope).toBe("scope-y");
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it("uses the default token endpoint as the audience when the key has none", () => {
    const { sa } = serviceAccount();
    const claim = createAssertion(sa, "s", 1).split(".")[1] as string;
    expect(JSON.parse(Buffer.from(claim, "base64url").toString()).aud).toBe(DEFAULT_TOKEN_URI);
  });
});

describe("requestServiceAccountToken", () => {
  it("posts a jwt-bearer grant carrying the scope and returns the token", async () => {
    const { sa } = serviceAccount();
    const seen: { url: string; body: string }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body) });
      return new Response('{"access_token":"t"}');
    }) as unknown as typeof fetch;
    expect(await requestServiceAccountToken(sa, "a b", fn, 1_700_000_000, noSleep)).toBe("t");
    expect(seen[0]?.url).toBe(DEFAULT_TOKEN_URI);
    const form = new URLSearchParams(seen[0]?.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const claim = (form.get("assertion") as string).split(".")[1] as string;
    expect(JSON.parse(Buffer.from(claim, "base64url").toString()).scope).toBe("a b");
  });

  it("retries the token request on a server error", async () => {
    const { sa } = serviceAccount();
    let n = 0;
    const fn = (async () => {
      n++;
      return n === 1 ? new Response("x", { status: 503 }) : new Response('{"access_token":"t"}');
    }) as typeof fetch;
    expect(await requestServiceAccountToken(sa, "s", fn, 1_700_000_000, noSleep)).toBe("t");
    expect(n).toBe(2);
  });

  it("reports a refused request with its status and body", async () => {
    const { sa } = serviceAccount();
    const fn = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch;
    await expect(requestServiceAccountToken(sa, "s", fn, 1, noSleep)).rejects.toThrow(
      'token request failed (HTTP 400): {"error":"invalid_grant"}',
    );
  });

  it("rejects a response without an access token", async () => {
    const { sa } = serviceAccount();
    const fn = (async () => new Response("{}")) as typeof fetch;
    await expect(requestServiceAccountToken(sa, "s", fn, 1, noSleep)).rejects.toThrow("no access_token");
  });
});
