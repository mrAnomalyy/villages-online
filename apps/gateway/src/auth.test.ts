import { describe, expect, it } from "vitest";
import { generateToken, hashToken, makeTicket } from "./auth";

describe("auth helpers", () => {
  it("creates opaque join tickets", () => {
    expect(makeTicket()).toHaveLength(36);
  });

  it("generates 48-character hex tokens", () => {
    const token = generateToken();
    expect(token).toHaveLength(48);
    expect(/^[0-9a-f]{48}$/.test(token)).toBe(true);
  });

  it("hashes tokens to 64-character sha256 hex strings", () => {
    const token = "my-secret-token";
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    // Deterministic hash
    expect(hashToken(token)).toBe(hash);
  });
});
