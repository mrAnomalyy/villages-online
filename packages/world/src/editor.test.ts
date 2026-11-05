import { describe, expect, it } from "vitest";
import {
  addChunk,
  appendPatrolPoint,
  createNpcDefinition,
  deleteNpcDefinition,
  paintSurface,
  paintWater,
  removeChunk,
  removePatrolPoint,
  sculptTerrain,
  updateNpcDefinition,
} from "./editor";
import { loadPublishedMapAsset } from "./asset-store";

describe("editor map mutations", () => {
  it("adds and removes chunks", () => {
    const map = loadPublishedMapAsset();
    const withChunk = addChunk(map, 1, 0);
    expect(withChunk.chunks).toHaveLength(2);
    expect(withChunk.bounds.maxChunkX).toBe(1);

    const removed = removeChunk(withChunk, "1:0");
    expect(removed.chunks).toHaveLength(1);
  });

  it("sculpts terrain up and down", () => {
    const map = loadPublishedMapAsset();
    const targetRow = 28;
    const targetColumn = 28;
    const raised = sculptTerrain(map, {
      worldX: 56,
      worldZ: 56,
      radius: 1,
      delta: 1,
      intensity: 2,
    });
    expect(raised.chunks[0].heights[targetRow][targetColumn]).toBeGreaterThan(
      map.chunks[0].heights[targetRow][targetColumn]
    );

    const lowered = sculptTerrain(raised, {
      worldX: 56,
      worldZ: 56,
      radius: 1,
      delta: -1,
      intensity: 2,
    });
    expect(lowered.chunks[0].heights[targetRow][targetColumn]).toBeLessThan(
      raised.chunks[0].heights[targetRow][targetColumn]
    );
  });

  it("paints and clears water", () => {
    const map = loadPublishedMapAsset();
    const painted = paintWater(map, {
      worldX: 5,
      worldZ: 5,
      radius: 0,
      value: true,
    });
    expect(painted.chunks[0].water[2][2]).toBe(true);

    const cleared = paintWater(painted, {
      worldX: 5,
      worldZ: 111,
      radius: 0,
      value: false,
    });
    expect(cleared.chunks[0].water[55][2]).toBe(false);
  });

  it("paints and erases surface materials", () => {
    const map = loadPublishedMapAsset();
    expect(map.chunks[0].surface).toBeUndefined();

    // Paint cobblestone (2)
    const painted = paintSurface(map, {
      worldX: 5,
      worldZ: 5,
      radius: 0,
      materialId: 2,
    });
    expect(painted.chunks[0].surface).toBeDefined();
    expect(painted.chunks[0].surface![2][2]).toBe(2);

    // Paint dirt (1) in adjacent cell
    const withDirt = paintSurface(painted, {
      worldX: 7,
      worldZ: 5,
      radius: 0,
      materialId: 1,
    });
    expect(withDirt.chunks[0].surface![2][2]).toBe(2);
    expect(withDirt.chunks[0].surface![2][3]).toBe(1);

    // Erase back to meadow (0)
    const erased = paintSurface(withDirt, {
      worldX: 5,
      worldZ: 5,
      radius: 0,
      materialId: 0,
    });
    expect(erased.chunks[0].surface![2][2]).toBe(0);
    expect(erased.chunks[0].surface![2][3]).toBe(1);
  });

  it("paints surface across chunk boundaries", () => {
    const map = addChunk(loadPublishedMapAsset(), 1, 0);
    const painted = paintSurface(map, {
      worldX: map.chunkSize,
      worldZ: map.chunkSize / 2,
      radius: 4,
      materialId: 2,
    });

    const leftChunk = painted.chunks.find((chunk) => chunk.id === "0:0");
    const rightChunk = painted.chunks.find((chunk) => chunk.id === "1:0");
    expect(leftChunk?.surface).toBeDefined();
    expect(rightChunk?.surface).toBeDefined();

    // Check cells near boundary in both chunks are cobblestone
    const row = Math.floor(painted.chunkResolution / 2);
    expect(leftChunk!.surface![row][painted.chunkResolution - 1]).toBe(2);
    expect(rightChunk!.surface![row][0]).toBe(2);
  });

  it("sculpts across chunk boundaries", () => {
    const map = addChunk(loadPublishedMapAsset(), 1, 0);
    const beforeLeft = JSON.stringify(map.chunks.find((chunk) => chunk.id === "0:0")?.heights);
    const beforeRight = JSON.stringify(map.chunks.find((chunk) => chunk.id === "1:0")?.heights);
    const sculpted = sculptTerrain(map, {
      worldX: map.chunkSize - 0.25,
      worldZ: map.chunkSize / 2,
      radius: 2,
      delta: 1,
      intensity: 2,
    });

    const leftChunk = sculpted.chunks.find((chunk) => chunk.id === "0:0");
    const rightChunk = sculpted.chunks.find((chunk) => chunk.id === "1:0");
    expect(JSON.stringify(leftChunk?.heights)).not.toBe(beforeLeft);
    expect(JSON.stringify(rightChunk?.heights)).not.toBe(beforeRight);
  });

  it("creates, updates, and deletes NPCs", () => {
    const map = loadPublishedMapAsset();
    const created = createNpcDefinition(map, {
      label: "Scout",
      position: { x: 4, y: 1, z: 4 },
    });

    expect(created.map.npcs).toHaveLength(3);
    expect(created.npc.label).toBe("Scout");

    const updated = updateNpcDefinition(created.map, created.npc.id, {
      behavior: { type: "wandering", radius: 6 },
      label: "Scout Prime",
    });
    expect(updated.npcs.at(-1)?.label).toBe("Scout Prime");
    expect(updated.npcs.at(-1)?.behavior.type).toBe("wandering");

    const deleted = deleteNpcDefinition(updated, created.npc.id);
    expect(deleted.npcs).toHaveLength(2);
  });

  it("edits patrol points and falls back to standing", () => {
    const map = loadPublishedMapAsset();
    const appended = appendPatrolPoint(map, "guide", { x: 8, y: 1, z: 8 });
    const guide = appended.npcs.find((npc) => npc.id === "guide");
    expect(guide?.behavior.type).toBe("patrol");

    const withoutFirst = removePatrolPoint(appended, "guide", 0);
    const downgraded = removePatrolPoint(withoutFirst, "guide", 0);
    expect(downgraded.npcs.find((npc) => npc.id === "guide")?.behavior.type).toBe("standing");
  });
});
