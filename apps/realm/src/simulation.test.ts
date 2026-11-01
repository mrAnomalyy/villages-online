import { describe, expect, it } from "vitest";
import { applyJump, createNpc, stepNpc } from "./simulation";
import type { PlayerEntity } from "./types";
import { getHeightAt } from "@villages/world";
import { loadPublishedMapAsset } from "@villages/world/asset-store";

describe("realm simulation", () => {
  it("applies jump only from the ground", () => {
    const map = loadPublishedMapAsset();
    const ground = getHeightAt(map, 8, 8) + 1;
    const player: PlayerEntity = {
      id: "c1",
      playerId: "p1",
      label: "Hero",
      bodyType: "male",
      position: { x: 8, y: ground, z: 8 },
      velocityY: 0,
      direction: { x: 0, z: 0 },
    };

    applyJump(player, map);
    expect(player.velocityY).toBeGreaterThan(0);
  });

  it("moves npc along patrol path", () => {
    const map = loadPublishedMapAsset();
    const npc = createNpc(
      {
        id: "npc1",
        label: "Guide",
        position: { x: 4, y: 1, z: 4 },
        behavior: {
          type: "patrol",
          points: [
            { x: 4, y: 1, z: 4 },
            { x: 6, y: 1, z: 4 },
          ],
        },
      },
      map
    );
    const startX = npc.position.x;
    stepNpc(npc, 0.5, map);
    expect(npc.position.x).toBeGreaterThan(startX);
  });

  it("keeps standing npc grounded", () => {
    const map = loadPublishedMapAsset();
    const ground = getHeightAt(map, 7, 7) + 1;
    const npc = createNpc(
      {
        id: "npc2",
        label: "Guide",
        position: { x: 7, y: 99, z: 7 },
        behavior: { type: "standing" },
      },
      map
    );

    stepNpc(npc, 0.5, map);
    expect(npc.position.y).toBeCloseTo(ground);
  });

  it("assigns a wandering target and moves", () => {
    const map = loadPublishedMapAsset();
    const npc = createNpc(
      {
        id: "npc3",
        label: "Wanderer",
        position: { x: 9, y: 1, z: 9 },
        behavior: { type: "wandering", radius: 3 },
      },
      map
    );
    const start = { ...npc.position };

    stepNpc(npc, 0.5, map);
    expect(Math.hypot(npc.position.x - start.x, npc.position.z - start.z)).toBeGreaterThan(0);
  });
});
