import { describe, expect, it } from "vitest";
import { loadPublishedMapAsset } from "./asset-store";
import { getHeightAt, getNeighborChunks, getWaterAt, parseMapAsset, resolveChunkIdForPosition } from "./map";

describe("map asset loading", () => {
  it("loads the published starter map", () => {
    const map = loadPublishedMapAsset();

    expect(map.mapId).toBe("starter-valley");
    expect(map.chunks).toHaveLength(1);
    expect(map.npcs).toHaveLength(2);
  });

  it("resolves chunk ids from world positions", () => {
    expect(resolveChunkIdForPosition(8, 8)).toBe("0:0");
    expect(resolveChunkIdForPosition(17, 9)).toBe("1:0");
  });

  it("returns neighboring chunks in bounds", () => {
    const map = loadPublishedMapAsset();
    expect(getNeighborChunks(map, "0:0").map((chunk) => chunk.id)).toEqual(["0:0"]);
  });

  it("reads terrain heights and water masks", () => {
    const map = loadPublishedMapAsset();
    expect(getHeightAt(map, 7, 7)).toBeGreaterThan(getHeightAt(map, 2, 12));
    expect(getWaterAt(map, 5, 13)).toBe(true);
    expect(getWaterAt(map, 5, 5)).toBe(false);
  });

  it("rejects invalid chunk shapes", () => {
    expect(() =>
      parseMapAsset({
        version: 1,
        mapId: "broken",
        name: "Broken",
        chunkSize: 16,
        chunkResolution: 16,
        waterLevel: 0.5,
        chunks: [
          {
            id: "0:0",
            x: 0,
            z: 0,
            size: 16,
            resolution: 16,
            heights: [[1]],
            water: [[false]],
          },
        ],
        npcs: [],
      })
    ).toThrow(/must have 16 rows/);
  });
});
