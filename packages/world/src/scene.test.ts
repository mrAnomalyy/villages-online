import * as core from "@babylonjs/core";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { describe, expect, it } from "vitest";
import { createEmptyChunk } from "./map";
import { buildTerrainScene } from "./scene";

function findVertexHeight(
  positions: ArrayLike<number>,
  targetX: number,
  targetZ: number,
  offsetX = 0,
  offsetZ = 0
): number | null {
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] + offsetX;
    const y = positions[index + 1];
    const z = positions[index + 2] + offsetZ;
    if (Math.abs(x - targetX) < 1e-4 && Math.abs(z - targetZ) < 1e-4) {
      return y;
    }
  }

  return null;
}

describe("terrain scene mesh mapping", () => {
  it("maps chunk rows to increasing world z without mirroring", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    try {
      const chunk = createEmptyChunk(0, 0, 4, 4, 0);
      chunk.heights = [
        [10, 11, 12, 13],
        [20, 21, 22, 23],
        [30, 31, 32, 33],
        [40, 41, 42, 43],
      ];
      chunk.water = [
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
      ];

      const terrain = buildTerrainScene(
        core,
        scene,
        {
          chunks: [chunk],
          waterLevel: 0,
        },
        {
          dynamicTerrain: true,
          flatShaded: false,
        }
      );

      const mesh = terrain.terrainMeshes[0];
      const positions = mesh?.getVerticesData(core.VertexBuffer.PositionKind) ?? [];
      const offsetX = mesh?.position.x ?? 0;
      const offsetZ = mesh?.position.z ?? 0;

      expect(findVertexHeight(positions, 0, 0, offsetX, offsetZ)).toBe(10);
      expect(findVertexHeight(positions, 4, 0, offsetX, offsetZ)).toBe(13);
      expect(findVertexHeight(positions, 0, 4, offsetX, offsetZ)).toBe(40);
      expect(findVertexHeight(positions, 4, 4, offsetX, offsetZ)).toBe(43);

      terrain.dispose();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
