import { describe, expect, it } from "vitest";
import { makeTicket } from "./auth";

describe("auth helpers", () => {
  it("creates opaque join tickets", () => {
    expect(makeTicket()).toHaveLength(36);
  });
});
