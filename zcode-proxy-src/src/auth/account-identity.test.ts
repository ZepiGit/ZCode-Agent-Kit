import { describe, expect, it } from "bun:test";
import { accountIdentity } from "./account-identity.js";

const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("accountIdentity", () => {
  it("prefers the OAuth userId over the JWT subject", () => {
    expect(accountIdentity({ userId: " user-1 ", jwt: jwt({ sub: "other" }) })).toBe("user-1");
  });

  it("falls back to the JWT subject when userId is absent or blank", () => {
    expect(accountIdentity({ jwt: jwt({ sub: "user-2", iat: 1 }) })).toBe("user-2");
    expect(accountIdentity({ userId: "  ", jwt: jwt({ sub: "user-2" }) })).toBe("user-2");
  });

  it("accepts a numeric subject as its decimal string", () => {
    expect(accountIdentity({ jwt: jwt({ sub: 12345 }) })).toBe("12345");
  });

  it("returns null when no subject can be derived", () => {
    expect(accountIdentity({})).toBeNull();
    expect(accountIdentity({ jwt: "synthetic-jwt-1" })).toBeNull();
    expect(accountIdentity({ jwt: "h.not-json.s" })).toBeNull();
    expect(accountIdentity({ jwt: jwt({ iat: 1 }) })).toBeNull();
    expect(accountIdentity({ jwt: jwt({ sub: "   " }) })).toBeNull();
    expect(accountIdentity({ jwt: jwt({ sub: Number.NaN }) })).toBeNull();
    expect(accountIdentity({ jwt: jwt({ sub: { id: 1 } }) })).toBeNull();
    expect(accountIdentity({ jwt: jwt(["sub"]) })).toBeNull();
  });
});
