import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { base64url, buildJwtClaim, createAssertion } from "../src/auth.js";

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
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const sa = {
      client_email: "svc@proj.iam.gserviceaccount.com",
      private_key: pem,
      token_uri: "https://oauth2.googleapis.com/token",
    };

    const jwt = createAssertion(sa, "scope-y", 1234);
    const [header, claim, signature] = jwt.split(".");

    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${claim}`)
      .verify(publicKey, Buffer.from(signature as string, "base64url"));
    expect(verified).toBe(true);

    const decoded = JSON.parse(Buffer.from(claim as string, "base64url").toString());
    expect(decoded.iss).toBe(sa.client_email);
    expect(decoded.aud).toBe(sa.token_uri);
    expect(decoded.exp - decoded.iat).toBe(3600);
  });
});
