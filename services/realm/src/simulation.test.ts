import { describe, expect, it } from "vitest";
import { applyJump, createNpc, stepNpc } from "./simulation";
import type { PlayerEntity } from "./types";

describe("realm simulation", () => {
  it("applies jump only from the ground", () => {
    const player: PlayerEntity = {
      id: "c1",
      playerId: "p1",
      label: "Hero",
      bodyType: "male",
      position: { x: 8, y: 2, z: 8 },
      velocityY: 0,
      direction: { x: 0, z: 0 }
    };

    applyJump(player);
    expect(player.velocityY).toBeGreaterThan(0);
  });

  it("moves npc along patrol path", () => {
    const npc = createNpc("npc1", "Guide", [
      { x: 4, y: 1, z: 4 },
      { x: 6, y: 1, z: 4 }
    ]);
    const startX = npc.position.x;
    stepNpc(npc, 0.5);
    expect(npc.position.x).toBeGreaterThan(startX);
  });
});

