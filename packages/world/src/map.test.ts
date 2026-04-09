import { describe, expect, it } from "vitest";
import { getHeightAt, getInitialChunks, getNeighborChunks, resolveChunkIdForPosition } from "./map";

describe("map chunking", () => {
  it("returns four initial chunks", () => {
    expect(getInitialChunks()).toHaveLength(4);
  });

  it("resolves chunk ids from world positions", () => {
    expect(resolveChunkIdForPosition(8, 8)).toBe("0:0");
    expect(resolveChunkIdForPosition(17, 9)).toBe("1:0");
  });

  it("returns neighboring chunks in bounds", () => {
    expect(getNeighborChunks("0:0").map((chunk) => chunk.id)).toEqual(["0:0", "1:0", "0:1", "1:1"]);
  });

  it("reads terrain heights", () => {
    expect(getHeightAt(9, 8)).toBeGreaterThan(getHeightAt(0, 20));
  });
});
